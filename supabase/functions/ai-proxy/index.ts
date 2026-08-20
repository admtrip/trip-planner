// Trippy AI proxy — Phase 1.
//
// Model: OpenAI (Responses API), not Claude — a deliberate deviation
// from the approved PRD, which specifies "calls the Claude API (Sonnet)."
// Kept here for the record: if that matters later, swapping the model
// layer back means touching only callOpenAI/callWithStructuredOutput
// below, not any of the business logic in the action handlers.
//
// The React client never calls the OpenAI API directly — it only calls
// this function, the same boundary Card IQ's simplefin-sync draws around
// SimpleFIN. Three actions:
//
//   { action: 'destination_suggestions', trip_id, previously_shown? }
//     Returns a structured list of destination suggestions for a trip
//     the caller already has (or is deciding on), based on their own
//     survey answers (including continent/climate/max-flight-hours
//     preference), this-or-that signals, taste profile, and every
//     exclusion signal (visited, durable, per-trip). Also reads the
//     caller's suggestion_feedback history so liked patterns are leaned
//     into and "not for me" ones aren't repeated. previously_shown is an
//     optional array of titles the client already displayed this
//     session — pass it on a "Refresh" tap so a re-roll doesn't just
//     repeat cards the user hasn't reacted to yet. Returns JSON only —
//     nothing is written to itinerary_items here. The client inserts
//     whichever suggestions the user actually accepts, individually or
//     in bulk, consistent with "suggest, never silently modify." A
//     "like" or "not for me" tap on a card is a plain client-side
//     upsert into suggestion_feedback (owner-scoped RLS already allows
//     it) — no Edge Function action needed for that.
//
//   { action: 'decision_progress', trip_id }
//     Returns { responded_count, total_members } for a 'deciding' trip —
//     a count only, never the responses themselves, since members can't
//     read each other's trip_survey_responses rows directly (RLS is
//     owner-scoped). Lets the UI show "3 of 4 have answered" without
//     opening up read access to anyone's actual answers.
//
//   { action: 'group_decision_aggregate', trip_id }
//     For a trip in 'deciding' status: aggregates every responding
//     member's survey + this-or-that + taste profile (via the service
//     role client — this is the one place cross-member data is read) and
//     posts the resulting destination options directly as itinerary_items
//     (status 'suggested', category 'destination'), so they're immediately
//     voteable through the existing suggestion_votes mechanism. Unlike
//     destination_suggestions, this one does write to the DB — that's the
//     whole point of "posted automatically as a poll."
//
//   { action: 'refresh_taste_profile' }
//     Synthesizes the caller's collected this-or-that + survey responses
//     into taste_profile.signals and a first summary_text, so Account
//     settings has real content right after onboarding instead of sitting
//     empty until a later phase's trip-recap job exists. This is NOT the
//     full post-trip-completion regeneration described in the PRD's
//     Shared Infrastructure section (that's Phase 5, driven by trip
//     recaps) — just enough to seed the profile now.
//
// Every call requires a signed-in user (Authorization header, checked via
// auth.getUser()). destination_suggestions and refresh_taste_profile only
// ever touch the caller's own rows, which RLS already allows through the
// regular authed client. group_decision_aggregate is the only action that
// needs the service-role client, to read other members' rows and write
// the resulting suggestions on their behalf.

import { createClient } from 'npm:@supabase/supabase-js@2'

const OPENAI_MODEL = 'gpt-5.6-luna'
const WEB_SEARCH_TOOL = { type: 'web_search' }

// OpenAI's strict json_schema mode requires every object to enumerate
// its properties with additionalProperties: false, and every property
// to be listed in required (no optional keys) — stricter than what the
// schema needed under Claude's tool-input-schema format.
const SUGGESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: "Tripr's item category. Use 'destination' for a place-level suggestion; 'activity', 'food', 'excursion', or 'hotel' for an itinerary-item-level suggestion once a destination is already set.",
          },
          title: { type: 'string' },
          description: { type: 'string' },
          cost_tier: { type: 'string', enum: ['budget', 'moderate', 'splurge'] },
          why_this_fits: {
            type: 'string',
            description: "One short line. For group aggregation, if members' inputs conflict, name the tension here rather than silently picking a lowest-common-denominator option.",
          },
          source: {
            type: 'string',
            enum: ['survey', 'taste_profile', 'both'],
            description: 'Whether this suggestion mainly came from this trip\'s survey answers, the taste profile, or both.',
          },
        },
        required: ['category', 'title', 'description', 'cost_tier', 'why_this_fits', 'source'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
}

// Not run in strict mode below — signals is intentionally freeform
// (LLM-authored, keyed by persona), which strict mode's "every object
// must enumerate its properties" rule can't express.
const TASTE_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    summary_text: {
      type: 'string',
      description: 'A short, plain-language paragraph describing this traveler\'s preferences — the kind of thing a friend would say about how they like to travel.',
    },
    signals: {
      type: 'object',
      description: "Structured signal, keyed by persona ('leisure' and/or 'work') so a business trip doesn't skew leisure suggestions. Each persona's value should capture pace, budget-tier pattern, and category weights inferred from the responses.",
      additionalProperties: true,
    },
  },
  required: ['summary_text', 'signals'],
  additionalProperties: false,
}

async function callOpenAI(apiKey, { input, tools, textFormat }) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: OPENAI_MODEL, input, tools, text: textFormat ? { format: textFormat } : undefined }),
  })
  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

// The Responses API's convenience `output_text` field covers the common
// case; falling back to walking `output` covers a response that also
// contains web_search_call items alongside the final message.
function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text) return response.output_text
  const message = (response.output ?? []).find((item) => item.type === 'message')
  const textPart = message?.content?.find((c) => c.type === 'output_text')
  return textPart?.text ?? null
}

// Web search (when requested) and the structured final answer happen in
// one call — unlike Claude's forced-tool-choice approach, which needed a
// fallback second turn, the Responses API's json_schema text format
// doesn't conflict with also giving the model a tool to call first.
async function callWithStructuredOutput(apiKey, { systemPrompt, userPrompt, schemaName, schema, useWebSearch, strict = true }) {
  const tools = useWebSearch ? [WEB_SEARCH_TOOL] : []
  const response = await callOpenAI(apiKey, {
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    tools,
    textFormat: { type: 'json_schema', name: schemaName, schema, strict },
  })
  const text = extractOutputText(response)
  if (!text) throw new Error(`OpenAI did not return structured output for ${schemaName}.`)
  return JSON.parse(text)
}

function categorySchemaText() {
  return [
    "- destination: a place-level suggestion (used when a trip has no destination yet).",
    "- hotel: lodging.",
    "- activity: a single activity.",
    "- food: a restaurant/food & drink pick.",
    "- excursion: a bookable tour/excursion (needs confirmation).",
  ].join('\n')
}

function hardConstraintsText(survey) {
  const lines = []
  if (survey?.dietary_restrictions?.length) lines.push(`Dietary restrictions (hard constraint, never override): ${survey.dietary_restrictions.join(', ')}`)
  if (survey?.accessibility_needs) lines.push(`Accessibility needs (hard constraint, never override): ${survey.accessibility_needs}`)
  if (survey?.travel_with_kids) lines.push('Traveling with kids (hard constraint, never override).')
  if (survey?.budget_tier) lines.push(`Budget tier: ${survey.budget_tier}${survey.is_splurge ? ' (this trip is explicitly flagged as a splurge — it\'s fine to exceed the usual tier, but label those options clearly)' : ' (do not suggest options that clearly exceed this tier without labeling them as a splurge)'}`)
  return lines.join('\n') || 'None stated.'
}

// Continent/climate/distance are much bigger destination-narrowing
// signals than the this-or-that style axes, so they're surfaced as
// their own block rather than folded into hardConstraintsText — strong
// preferences, but (unlike dietary/accessibility/kids) not absolute
// rules the model must refuse to ever cross.
function travelPreferencesText(survey) {
  const lines = []
  if (survey?.continent_preference?.length) lines.push(`Continent preference: ${survey.continent_preference.join(', ')}`)
  if (survey?.climate_preference && survey.climate_preference !== 'no_preference') lines.push(`Climate preference: ${survey.climate_preference}`)
  if (survey?.max_flight_hours != null) lines.push(`Max flight time: ${survey.max_flight_hours} hours from the traveler's home airport`)
  return lines.join('\n') || 'No stated preference — anywhere is fine.'
}

async function deriveDestinationsVisited(client, userId) {
  const { data: ownedTrips } = await client.from('trips').select('id, destination').eq('created_by', userId)
  const { data: memberRows } = await client.from('trip_members').select('trip_id').eq('user_id', userId)
  const memberTripIds = (memberRows ?? []).map((r) => r.trip_id)
  let memberTrips = []
  if (memberTripIds.length) {
    const { data } = await client.from('trips').select('id, destination').in('id', memberTripIds)
    memberTrips = data ?? []
  }
  const all = [...(ownedTrips ?? []), ...memberTrips]
  return [...new Set(all.map((t) => t.destination).filter(Boolean))]
}

// Merges the three separate exclusion signals into one "never suggest
// these" list: visit history (automatic), the durable account-level
// list (taste_profile.excluded_regions — "never"), and any per-trip
// survey rows' excluded_regions ("not this trip"). Accepts one or many
// survey rows so it works for both a single respondent and Group
// Destination Decision Mode's multiple members.
function mergeExclusions(destinationsVisited, tasteProfiles, surveys) {
  const profiles = Array.isArray(tasteProfiles) ? tasteProfiles : [tasteProfiles]
  const surveyRows = Array.isArray(surveys) ? surveys : [surveys]
  const durable = profiles.flatMap((p) => p?.excluded_regions ?? [])
  const perTrip = surveyRows.flatMap((s) => s?.excluded_regions ?? [])
  return [...new Set([...destinationsVisited, ...durable, ...perTrip])]
}

async function fetchThisOrThat(client, userId, tripId) {
  let query = client.from('this_or_that_responses').select('axis, choice').eq('user_id', userId)
  query = tripId ? query.eq('trip_id', tripId) : query.is('trip_id', null)
  const { data } = await query
  return data ?? []
}

async function fetchTasteProfile(client, userId) {
  const { data } = await client.from('taste_profile').select('summary_text, signals, excluded_regions').eq('user_id', userId).maybeSingle()
  return data
}

// The PRD's "not for me" feedback loop: prior liked/rejected suggestion
// titles for this user, across all their trips, so a "refresh" doesn't
// just repeat what was already dismissed and leans toward what stuck.
async function fetchSuggestionFeedback(client, userId) {
  const { data } = await client.from('suggestion_feedback').select('suggestion_title, feedback').eq('user_id', userId)
  const rows = data ?? []
  return {
    liked: rows.filter((r) => r.feedback === 'liked').map((r) => r.suggestion_title),
    notForMe: rows.filter((r) => r.feedback === 'not_for_me').map((r) => r.suggestion_title),
  }
}

Deno.serve(async (req) => {
  try {
    const body = await req.json()
    const { action } = body

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) throw new Error('OPENAI_API_KEY is not configured.')

    const authed = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: req.headers.get('Authorization') } } }
    )

    const {
      data: { user },
      error: userError,
    } = await authed.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (action === 'destination_suggestions') {
      // previously_shown: titles the client already displayed this
      // session (e.g. a "Refresh" tap) — kept separate from persisted
      // suggestion_feedback so an un-reacted-to card still isn't just
      // repeated verbatim on refresh.
      const { trip_id, previously_shown } = body
      if (!trip_id) {
        return new Response(JSON.stringify({ error: 'trip_id is required.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const { data: survey } = await authed
        .from('trip_survey_responses')
        .select('*')
        .eq('trip_id', trip_id)
        .eq('user_id', user.id)
        .maybeSingle()

      const [thisOrThat, tasteProfile, destinationsVisited, feedback] = await Promise.all([
        fetchThisOrThat(authed, user.id, trip_id),
        fetchTasteProfile(authed, user.id),
        deriveDestinationsVisited(authed, user.id),
        fetchSuggestionFeedback(authed, user.id),
      ])

      const exclusions = mergeExclusions(destinationsVisited, tasteProfile, survey)

      const systemPrompt = `You are Trippy's trip-planning assistant. You suggest destinations and itinerary items — you never book anything, move money, or silently modify a user's trip. Every suggestion must be reviewed and accepted by a human before it takes effect.

Tripr's item categories:
${categorySchemaText()}

This trip's survey answers take precedence over the taste profile wherever the two conflict (e.g. a usually-budget traveler marking this specific trip as a splurge) — the taste profile only fills in what the survey doesn't cover.`

      const userPrompt = `Survey for this trip: ${JSON.stringify(survey ?? {})}
Travel preferences: ${travelPreferencesText(survey)}
This-or-that signals for this trip: ${JSON.stringify(thisOrThat)}
Taste profile summary: ${tasteProfile?.summary_text ?? 'None yet — this is a new user.'}
Taste profile structured signals: ${JSON.stringify(tasteProfile?.signals ?? {})}
Never suggest any of these (already visited, or explicitly excluded — this trip or durably): ${JSON.stringify(exclusions)}
Previously liked suggestions (lean toward this pattern): ${JSON.stringify(feedback.liked)}
Previously dismissed as "not for me" (do not repeat these or very similar options): ${JSON.stringify(feedback.notForMe)}
Already shown this session, don't repeat verbatim even if not yet reacted to: ${JSON.stringify(previously_shown ?? [])}
Hard constraints:
${hardConstraintsText(survey)}

Use web search so suggestions reflect current information, not stale training data. Suggest 3-6 destinations or itinerary items depending on whether this trip already has a destination (survey.region set = suggest itinerary items; unset = suggest destinations).`

      const result = await callWithStructuredOutput(openaiKey, {
        systemPrompt,
        userPrompt,
        schemaName: 'trippy_suggestions',
        schema: SUGGESTIONS_SCHEMA,
        useWebSearch: true,
      })

      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (action === 'decision_progress') {
      // Members can't SELECT each other's trip_survey_responses rows
      // (RLS is owner-scoped, per Group Privacy) so the client has no
      // way to know how many people have responded without this — a
      // count only, never the responses themselves.
      const { trip_id } = body
      if (!trip_id) {
        return new Response(JSON.stringify({ error: 'trip_id is required.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
      const { data: membership } = await admin.from('trip_members').select('user_id').eq('trip_id', trip_id).eq('user_id', user.id).maybeSingle()
      const { data: trip } = await admin.from('trips').select('created_by').eq('id', trip_id).single()
      if (trip?.created_by !== user.id && !membership) {
        return new Response(JSON.stringify({ error: 'Not a member of this trip.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const { data: memberRows } = await admin.from('trip_members').select('user_id').eq('trip_id', trip_id)
      const { data: surveyRows } = await admin.from('trip_survey_responses').select('user_id').eq('trip_id', trip_id)
      const totalMembers = new Set([...(memberRows ?? []).map((m) => m.user_id), trip?.created_by].filter(Boolean)).size
      const respondedCount = new Set((surveyRows ?? []).map((s) => s.user_id)).size
      return new Response(JSON.stringify({ responded_count: respondedCount, total_members: totalMembers }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (action === 'group_decision_aggregate') {
      const { trip_id } = body
      if (!trip_id) {
        return new Response(JSON.stringify({ error: 'trip_id is required.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Cross-member aggregation is the one thing in this function that
      // needs to see beyond the caller's own rows — same reason
      // simplefin-sync uses a service-role client for simplefin_credentials.
      const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

      const { data: trip, error: tripError } = await admin.from('trips').select('*').eq('id', trip_id).single()
      if (tripError || !trip) {
        return new Response(JSON.stringify({ error: 'Trip not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (trip.status !== 'deciding') {
        return new Response(JSON.stringify({ error: 'This trip is not in decision mode.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Only the organizer or a trip member can trigger aggregation.
      const { data: membership } = await admin
        .from('trip_members')
        .select('user_id')
        .eq('trip_id', trip_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (trip.created_by !== user.id && !membership) {
        return new Response(JSON.stringify({ error: 'Not a member of this trip.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const { data: surveys } = await admin.from('trip_survey_responses').select('*').eq('trip_id', trip_id)
      const { data: thisOrThatRows } = await admin.from('this_or_that_responses').select('user_id, axis, choice').eq('trip_id', trip_id)

      const respondingUserIds = [...new Set((surveys ?? []).map((s) => s.user_id))]
      const { data: profiles } = await admin.from('taste_profile').select('user_id, summary_text, signals, excluded_regions').in('user_id', respondingUserIds.length ? respondingUserIds : ['00000000-0000-0000-0000-000000000000'])

      // No single "visited" list here — each member has their own
      // history, and the whole point of a group trip is going somewhere
      // together, so only the explicit exclusions (durable + per-trip)
      // are treated as hard "never suggest" — a place one member has
      // visited before isn't automatically off-limits for the group.
      const exclusions = mergeExclusions([], profiles ?? [], surveys ?? [])

      const systemPrompt = `You are Trippy's trip-planning assistant, running Group Destination Decision Mode: a group hasn't picked a destination yet, and you're proposing a shortlist for them to vote on. You never pick for the group — you propose options and, where members' stated preferences conflict, you say so plainly in why_this_fits rather than silently averaging into a lowest-common-denominator pick. Never surface any individual member's name or which specific preference is theirs — describe the reasoning in terms of the suggestion itself ("matches this trip's activity-heavy pace"), not any one person.

Tripr's item categories:
${categorySchemaText()}`

      const userPrompt = `Organizer's coarse constraint for this trip: ${JSON.stringify(trip.decision_region_filter ?? {})}
Responding members' survey answers, including each member's own continent/climate/max-flight-hours preference: ${JSON.stringify(surveys ?? [])}
Responding members' this-or-that signals: ${JSON.stringify(thisOrThatRows ?? [])}
Responding members' taste profiles: ${JSON.stringify(profiles ?? [])}
Never suggest any of these — every member's durable and per-trip exclusions combined: ${JSON.stringify(exclusions)}

Use web search so suggestions reflect current information. Propose 3-6 destination options (category: 'destination') the whole group can vote on.`

      const result = await callWithStructuredOutput(openaiKey, {
        systemPrompt,
        userPrompt,
        schemaName: 'trippy_suggestions',
        schema: SUGGESTIONS_SCHEMA,
        useWebSearch: true,
      })

      const rows = (result.suggestions ?? []).map((s) => ({
        trip_id,
        title: s.title,
        type: 'destination',
        status: 'suggested',
        notes: s.description,
        cost: null,
        ai_reasoning: s.why_this_fits,
        ai_source: s.source,
        added_by: user.id,
      }))

      const { data: inserted, error: insertError } = await admin.from('itinerary_items').insert(rows).select()
      if (insertError) throw insertError

      return new Response(JSON.stringify({ suggestions: inserted }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (action === 'refresh_taste_profile') {
      const [generalThisOrThat, surveyRows, feedback] = await Promise.all([
        fetchThisOrThat(authed, user.id, null),
        authed.from('trip_survey_responses').select('*').eq('user_id', user.id).then((r) => r.data ?? []),
        fetchSuggestionFeedback(authed, user.id),
      ])

      if (!generalThisOrThat.length && !surveyRows.length) {
        return new Response(JSON.stringify({ error: 'Nothing to synthesize yet — complete onboarding first.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const systemPrompt = `You are Trippy's trip-planning assistant. Synthesize a traveler's onboarding this-or-that answers, any per-trip survey responses, and their suggestion feedback history into a short, plain-language taste profile the traveler can read and edit themselves. Track solo/work and group/leisure trips as distinct patterns within the signal object rather than one blended average, since a business trip shouldn't skew leisure suggestions.`

      const userPrompt = `Onboarding this-or-that answers: ${JSON.stringify(generalThisOrThat)}
Per-trip survey answers so far: ${JSON.stringify(surveyRows)}
Suggestions this user has liked: ${JSON.stringify(feedback.liked)}
Suggestions this user marked "not for me": ${JSON.stringify(feedback.notForMe)}`

      const result = await callWithStructuredOutput(openaiKey, {
        systemPrompt,
        userPrompt,
        schemaName: 'trippy_taste_profile',
        schema: TASTE_PROFILE_SCHEMA,
        useWebSearch: false,
        strict: false,
      })

      // excluded_regions is deliberately left out of this upsert — it's
      // a user-edited field (Account settings writes it directly), and
      // an LLM-driven refresh here should never silently overwrite what
      // the user explicitly set.
      const { error: upsertError } = await authed
        .from('taste_profile')
        .upsert(
          {
            user_id: user.id,
            summary_text: result.summary_text,
            signals: result.signals,
            last_regenerated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
      if (upsertError) throw upsertError

      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: `Unknown action "${action}".` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message ?? 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
