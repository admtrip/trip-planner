-- Trippy AI Layer — Phase 1 (Foundation)
-- Run this in the Supabase SQL editor for your project. Not a migration
-- harness — Tripr's schema isn't version-controlled elsewhere either, so
-- this file is scoped to just the new pieces this phase adds, the same
-- unversioned-but-documented convention the rest of the schema already
-- follows.
--
-- SECURITY MODEL:
-- taste_profile, this_or_that_responses, and trip_survey_responses all
-- have RLS enabled and scoped to auth.uid() = user_id — a user can only
-- ever read or write their own rows via the anon/authenticated client.
-- Group Destination Decision Mode's cross-member aggregation happens
-- exclusively inside the ai-proxy Edge Function using the service role
-- key, the same boundary Card IQ uses for simplefin_credentials: no
-- client-side policy ever grants one member visibility into another
-- member's raw survey/this-or-that answers.
--
-- TIMESTAMP CONVENTION:
-- Audit columns (created_at/updated_at recording "when was this row
-- written") use timestamptz throughout, matching normal Postgres/Supabase
-- default and Card IQ's own schema. The one exception is
-- trips.decision_response_deadline and trip_survey_responses'
-- created_at/updated_at, which follow Tripr's existing itinerary
-- convention of naive `timestamp` for trip-local wall-clock values (see
-- itinerary_items.check_in/check_out + item_timezone) rather than an
-- absolute instant.

-- ---------------------------------------------------------------------
-- trips: nullable destination + Group Destination Decision Mode status
-- ---------------------------------------------------------------------

alter table trips alter column destination drop not null;

alter table trips add column status text not null default 'active'
  check (status in ('active', 'deciding'));

-- Organizer's coarse constraint for a 'deciding' trip when no destination
-- is set yet — e.g. { "continent": "Europe" } or { "max_flight_hours": 5 }
-- or { "climate": "warm" }. Shape is intentionally loose since the AI
-- proxy is the only reader; no app code branches on specific keys.
alter table trips add column decision_region_filter jsonb;

-- Trip-local wall-clock deadline, naive — same convention as
-- itinerary_items.check_in/check_out. After this passes, aggregation can
-- run automatically with whoever has responded so far.
alter table trips add column decision_response_deadline timestamp;

alter table trips add column decision_resolved_at timestamp;

-- ---------------------------------------------------------------------
-- taste_profile: one row per user, durable signal learned across trips
-- ---------------------------------------------------------------------

create table taste_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  -- Structured signals: category weights, budget-tier pattern, pace,
  -- keyed by persona so a solo/work trip doesn't skew leisure signal and
  -- vice versa, e.g. { "leisure": { "pace": "relaxed", ... }, "work": {...} }.
  -- destinations_visited is deliberately NOT stored here — the ai-proxy
  -- Edge Function derives it live from trips/trip_members at request
  -- time so it can never go stale.
  signals jsonb not null default '{}',

  -- Durable, account-level "never suggest this" list — distinct from a
  -- trip_survey_responses.excluded_regions row, which is "not this
  -- trip" only. A first-class column rather than living inside signals
  -- jsonb so Account settings can render/edit it directly without
  -- needing to understand the LLM-authored shape of signals.
  excluded_regions text[] not null default '{}',

  -- LLM-generated natural-language preference summary. User-editable
  -- from Account settings. Null until the first refresh_taste_profile
  -- call has something to summarize.
  summary_text text,

  -- Per-feature AI opt-in/out. Only keys for features that exist ship
  -- with a default here; later phases add their own key when they ship
  -- rather than being pre-seeded now. App code treats a missing key as
  -- "on" (features are on by default per the PRD).
  ai_toggles jsonb not null default '{"destination_suggestions": true}',

  last_regenerated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table taste_profile enable row level security;

create policy "Users can view their own taste profile"
  on taste_profile for select
  using (auth.uid() = user_id);

create policy "Users can insert their own taste profile"
  on taste_profile for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own taste profile"
  on taste_profile for update
  using (auth.uid() = user_id);

-- No delete policy on purpose. "Reset my recommendations" is an UPDATE
-- that nulls signals/summary_text/excluded_regions — the row itself,
-- and everything else the user has ever done in the app, stays intact.

-- ---------------------------------------------------------------------
-- this_or_that_responses: forced-choice signal, general or per-trip
-- ---------------------------------------------------------------------

-- trip_id null = the general/onboarding round that feeds the account-
-- level taste profile. trip_id set = a per-trip round (Group Destination
-- Decision Mode members answering individually, or a returning user's
-- optional per-trip refresh).
create table this_or_that_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id bigint references trips(id) on delete cascade,
  axis text not null check (
    axis in ('pace', 'setting', 'food_style', 'lodging', 'activity_type', 'social_scale', 'splurge')
  ),
  choice text not null,
  created_at timestamptz not null default now(),

  -- Postgres treats NULLs as distinct in a plain UNIQUE constraint (so a
  -- bare (user_id, trip_id, axis) constraint would let the general round
  -- accumulate duplicate rows instead of upserting), and a client upsert
  -- via PostgREST can't target a partial index as its conflict arbiter
  -- (no way to pass the matching WHERE clause through .upsert()). A
  -- generated column that coalesces the null case to a fixed sentinel
  -- sidesteps both problems: one plain, full unique index below, and a
  -- single onConflict target that works for both the general and
  -- per-trip round from the client.
  -- Sentinel is -1, not a nil UUID, now that trip_id matches trips.id's
  -- real type (bigint) — identity/serial columns only ever hand out
  -- positive values, so -1 can never collide with a real trip.
  trip_scope bigint generated always as (coalesce(trip_id, -1)) stored
);

alter table this_or_that_responses enable row level security;

create policy "Users manage their own this-or-that responses"
  on this_or_that_responses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create unique index this_or_that_unique
  on this_or_that_responses (user_id, trip_scope, axis);

-- ---------------------------------------------------------------------
-- trip_survey_responses: per-trip survey, one row per responding member
-- ---------------------------------------------------------------------

-- Keyed by (trip_id, user_id) rather than living as columns on trips so
-- Group Destination Decision Mode's per-member answers and a normal
-- trip's single (creator) answer share one schema instead of two.
create table trip_survey_responses (
  id uuid primary key default gen_random_uuid(),
  trip_id bigint not null references trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  vibe text,
  budget_tier text,
  group_size int,
  who_for text, -- solo / couple / friend_group / family_with_kids / work_offsite

  -- Normal trip: free-text destination/region hint. Deciding-mode
  -- members leave this null — trips.decision_region_filter (organizer-
  -- set) is the constraint used instead, so suggestions have something
  -- to anchor to without every member re-specifying it.
  region text,

  -- Structured location-narrowing signals, asked on every trip (not
  -- just Group Destination Decision Mode) — these narrow candidate
  -- destinations far more than the this-or-that style axes do.
  continent_preference text[], -- e.g. {'US'}, {'Europe','Asia'}; null/empty = no preference
  climate_preference text check (climate_preference in ('warm', 'cool', 'no_preference')),
  max_flight_hours int, -- null = no distance constraint

  -- Preference-based exclusion for THIS trip only ("not this time"), as
  -- opposed to taste_profile.excluded_regions below, which is durable
  -- ("never suggest this"). Distinct from the destinations_visited
  -- exclusion list, which the Edge Function derives automatically from
  -- past trips — this one is a deliberate choice, not visit history.
  excluded_regions text[],

  -- Hard constraints (PRD: never inferred or overridden by the taste
  -- profile, applies to every AI feature that touches suggestions).
  dietary_restrictions text[],
  accessibility_needs text,
  travel_with_kids boolean,

  is_splurge boolean,

  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),

  unique (trip_id, user_id)
);

alter table trip_survey_responses enable row level security;

create policy "Users manage their own trip survey response"
  on trip_survey_responses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- NOTE: the two policies above assume auth.uid() = user_id is a
-- sufficient boundary on their own (no explicit trip-membership check),
-- since a non-member has no legitimate way to obtain a trip_id to write
-- against — trips are invite-gated. trip_members/invites RLS isn't
-- version-controlled in this repo, so sanity-check this assumption
-- against whatever policy those tables actually carry in your live
-- project before relying on it in production.

-- ---------------------------------------------------------------------
-- itinerary_items: two nullable columns so AI-suggested destinations
-- can be posted through the EXISTING suggestion_votes voting mechanism
-- instead of a new one being built for Group Destination Decision Mode.
-- ---------------------------------------------------------------------

alter table itinerary_items add column ai_reasoning text; -- the "why this fits" line
alter table itinerary_items add column ai_source text
  check (ai_source in ('survey', 'taste_profile', 'both'));

-- ---------------------------------------------------------------------
-- suggestion_feedback: the PRD's "not for me" feedback loop — a
-- lightweight per-suggestion signal, separate from simply ignoring a
-- card, that feeds future suggestions and refresh_taste_profile instead
-- of just disappearing. Suggestions from destination_suggestions are
-- never persisted anywhere unless accepted, so feedback references a
-- suggestion by title/category rather than an itinerary_items FK.
-- ---------------------------------------------------------------------

create table suggestion_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id bigint not null references trips(id) on delete cascade,
  suggestion_title text not null,
  suggestion_category text,
  feedback text not null check (feedback in ('liked', 'not_for_me')),
  created_at timestamptz not null default now(),
  unique (user_id, trip_id, suggestion_title)
);

alter table suggestion_feedback enable row level security;

create policy "Users manage their own suggestion feedback"
  on suggestion_feedback for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
