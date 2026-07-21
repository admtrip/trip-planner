import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App as CapacitorApp } from '@capacitor/app'

// ---------- Palette: minimal but fun — one vivid accent, clean sans everywhere ----------
const ACCENT = '#7A3350'
const ACCENT_DARK = '#4A1F30'
const ACCENT_LIGHT = '#F1E0E7'
const ACCENT_TEXT = '#5C2438'
const TEAL = '#0891B2'
const GOLD = '#F5A623'
const PLUM = '#7C3AED'
const INK = '#1C1917'
const MUTED = '#8A8378'
const CARD_BORDER = '#F0EDE8'
const BG = '#FAFAF8'
const GRADIENT = '#4A1F30'
const BG_GRADIENT = 'linear-gradient(135deg, #8B4160 0%, #3D1626 100%)'
const FONT = "'DM Sans', system-ui, sans-serif"

// Category colors — chosen for maximum visual distinction between item types
// on the Map legend, pins, and Itinerary cards (separate from the app's main accent color).
const CAT_ACTIVITY = '#8AA37A'
const CAT_FOOD = '#B58A6A'
const CAT_EXCURSION = '#C46A86'
const CAT_HOTEL = '#7B3A7A'
const CAT_CAR = '#2D3A66'
const CAT_FLIGHT = '#3A1C33'

// Every real-world IANA timezone the browser knows about (~400), so nothing
// is ever missing. Falls back to a short curated list on very old browsers
// that don't support Intl.supportedValuesOf.
const CURATED_FALLBACK_TIMEZONES = [
  'America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles',
  'Pacific/Honolulu', 'Atlantic/Azores', 'Europe/Lisbon', 'Europe/Madrid',
  'Europe/Paris', 'Europe/Rome', 'Europe/London', 'Europe/Athens',
  'Asia/Tokyo', 'Asia/Bangkok', 'Australia/Sydney', 'UTC',
]
const ALL_TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return CURATED_FALLBACK_TIMEZONES
  }
})()

function timezoneLabel(tz) {
  return tz ? tz.replace(/_/g, ' ') : tz
}

const CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'MXN', label: 'MXN — Mexican Peso' },
  { code: 'BRL', label: 'BRL — Brazilian Real' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'CNY', label: 'CNY — Chinese Yuan' },
  { code: 'KRW', label: 'KRW — South Korean Won' },
  { code: 'THB', label: 'THB — Thai Baht' },
  { code: 'AED', label: 'AED — UAE Dirham' },
  { code: 'PLN', label: 'PLN — Polish Zloty' },
  { code: 'SGD', label: 'SGD — Singapore Dollar' },
  { code: 'NZD', label: 'NZD — New Zealand Dollar' },
  { code: 'ZAR', label: 'ZAR — South African Rand' },
  { code: 'HKD', label: 'HKD — Hong Kong Dollar' },
  { code: 'TRY', label: 'TRY — Turkish Lira' },
  { code: 'PHP', label: 'PHP — Philippine Peso' },
]

const TYPE_CONFIG = {
  activity:  { label: '🏄 Activity',      color: CAT_ACTIVITY,  timing: 'single', confirmation: false },
  food:      { label: '🍽️ Food & Drinks', color: CAT_FOOD,      timing: 'single', confirmation: false },
  excursion: { label: '🎟️ Excursion',     color: CAT_EXCURSION, timing: 'single', confirmation: true  },
  hotel:     { label: '🏨 Hotel',         color: CAT_HOTEL,     timing: 'stay',   confirmation: true, inLabel: 'Check-in',  outLabel: 'Check-out' },
  car:       { label: '🚗 Car Rental',    color: CAT_CAR,       timing: 'stay',   confirmation: true, inLabel: 'Pickup',    outLabel: 'Return'     },
  flight:    { label: '✈️ Flight',        color: CAT_FLIGHT,    timing: 'flight', confirmation: true  },
  note:      { label: '📝 Note',          color: MUTED,         timing: 'single', confirmation: false },
  expense:   { label: '💵 Expense',       color: CAT_FOOD,      timing: 'none',   confirmation: false },
}

function bookingBorderColor(booking, userId) {
  if (booking.split_type === 'equal' || booking.split_type === 'some') return TEAL
  if (booking.is_private) return MUTED
  if (booking.booked_by === userId) return ACCENT
  return PLUM
}

function categoryIcon(cat) {
  return { flight: '✈️', hotel: '🏨', car: '🚗', excursion: '🎟️', other: '📦' }[cat] || '📦'
}

function formatDateTime(dt) {
  if (!dt) return ''
  const [datePart, timePart] = dt.split('T')
  if (!datePart) return ''
  const [year, month, day] = datePart.split('-').map(Number)
  const dateObj = new Date(year, month - 1, day)
  const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (!timePart) return dateStr
  const [hourStr, minStr] = timePart.split(':')
  let hour = parseInt(hourStr)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12 || 12
  return `${dateStr}, ${hour}:${minStr} ${ampm}`
}

function timeOnly(dt) {
  if (!dt) return ''
  const timePart = dt.split('T')[1]
  if (!timePart) return ''
  const [hourStr, minStr] = timePart.split(':')
  let hour = parseInt(hourStr)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12 || 12
  return `${hour}:${minStr} ${ampm}`
}

function dateKeyFromDateTime(dt) {
  if (!dt) return null
  return dt.split('T')[0]
}

function timeKeyFromDateTime(dt) {
  if (!dt) return '00:00'
  const timePart = dt.split('T')[1]
  return timePart ? timePart.slice(0, 5) : '00:00'
}

function formatTime(t) {
  if (!t) return null
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function mapsLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

// Straight-line distance in km between two {lat,lng} points — a free proxy
// for "how close together are these," since real driving/walking time would
// require enabling Google's paid Distance Matrix API.
function haversineKm(a, b) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Same localStorage cache key as the Map tab uses, so an address geocoded
// once (from either feature) is never looked up twice.
function geocodeAddressCached(geocoder, address) {
  const cacheKey = `tripmap:geocode:${address}`
  const cached = localStorage.getItem(cacheKey)
  if (cached) return Promise.resolve(JSON.parse(cached))
  return new Promise(resolve => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
        localStorage.setItem(cacheKey, JSON.stringify(loc))
        resolve(loc)
      } else resolve(null)
    })
  })
}

// Builds one Google Maps link that routes through every addressed item in
// roughly chronological order — opens the whole trip as a real route in the
// native Google Maps app (or its website) instead of one pin at a time.
// Note: Google's free directions links support a limited number of stops
// (historically ~9-10) — if a trip has more, only the first ones are used.
function buildDirectionsLink(itemsWithAddress) {
  const withAddress = itemsWithAddress.filter(i => i.address)
  if (withAddress.length === 0) return null
  const sortKey = i => {
    const datePart = i.day_date || (i.check_in ? i.check_in.split('T')[0] : '') || ''
    const timePart = i.start_time || (i.check_in ? (i.check_in.split('T')[1] || '00:00') : '00:00')
    return `${datePart}T${timePart}`
  }
  const sorted = [...withAddress].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  const addresses = sorted.map(i => encodeURIComponent(i.address))
  if (addresses.length === 1) return mapsLink(sorted[0].address)
  const origin = addresses[0]
  const destination = addresses[addresses.length - 1]
  const waypoints = addresses.slice(1, -1).slice(0, 8).join('|') // cap well under Google's practical limit
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`
  if (waypoints) url += `&waypoints=${waypoints}`
  return url
}

function contrastTextColor(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return INK
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return brightness > 0.55 ? INK : '#FFFFFF'
}

function getItemDayKey(item) {
  if (item.day_date) return item.day_date
  if (item.check_in) return item.check_in.split('T')[0]
  return null
}

// ---------- Offline cache ----------
// Every fetch below writes its result here on success. If a fetch fails
// (most likely because there's no connection), we fall back to whatever
// was last cached so the trip is still viewable, just not editable.
function cacheSet(key, data) {
  try { localStorage.setItem(`tripCache:${key}`, JSON.stringify({ data, cachedAt: Date.now() })) } catch {}
}
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(`tripCache:${key}`)
    return raw ? JSON.parse(raw).data : null
  } catch { return null }
}

// ---------- Google Maps loader (shared by Map tab + address autocomplete) ----------
function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve(window.google.maps)
    const existing = document.getElementById('google-maps-script')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google.maps))
      existing.addEventListener('error', reject)
      return
    }
    const script = document.createElement('script')
    script.id = 'google-maps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    script.onload = () => resolve(window.google.maps)
    script.onerror = reject
    document.head.appendChild(script)
  })
}

function makeMarkerIcon(maps, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z" fill="${color}"/>
    <circle cx="15" cy="15" r="6" fill="#faf7f2"/>
  </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(30, 40),
    anchor: new maps.Point(15, 40),
  }
}

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#faf7f2' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5a5650' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#faf7f2' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cdeef0' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

function MapTab({ items }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef([])
  const [status, setStatus] = useState('loading')
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  const geocodeAddress = useCallback((geocoder, address) => {
    const cacheKey = `tripmap:geocode:${address}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) return Promise.resolve(JSON.parse(cached))
    return new Promise((resolve) => {
      geocoder.geocode({ address }, (results, geoStatus) => {
        if (geoStatus === 'OK' && results[0]) {
          const loc = { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
          localStorage.setItem(cacheKey, JSON.stringify(loc))
          resolve(loc)
        } else resolve(null)
      })
    })
  }, [])

  useEffect(() => {
    if (!apiKey) { setStatus('nokey'); return }
    let cancelled = false
    async function init() {
      try {
        const maps = await loadGoogleMaps(apiKey)
        if (cancelled || !mapRef.current) return
        if (!mapInstance.current) {
          mapInstance.current = new maps.Map(mapRef.current, {
            zoom: 12, center: { lat: 20, lng: 0 }, styles: MAP_STYLE,
            streetViewControl: false, mapTypeControl: false,
          })
        }
        const geocoder = new maps.Geocoder()
        const bounds = new maps.LatLngBounds()
        const newMarkers = []
        const withAddress = items.filter(i => i.address)
        for (const item of withAddress) {
          const position = await geocodeAddress(geocoder, item.address)
          if (!position) continue
          const color = TYPE_CONFIG[item.type]?.color || TEAL
          const marker = new maps.Marker({ position, map: mapInstance.current, title: item.title, icon: makeMarkerIcon(maps, color) })
          const info = new maps.InfoWindow({
            content: `<div style="font-family:${FONT};padding:2px 4px;min-width:140px;">
              <div style="font-weight:600;color:${INK};">${item.title}</div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:${color};margin-top:2px;">
                ${TYPE_CONFIG[item.type]?.label.replace(/^[^ ]+ /, '') || item.type}
              </div>
              <a href="${mapsLink(item.address)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:12px;color:${ACCENT_TEXT};text-decoration:none;">
                📍 Open in Google Maps
              </a>
            </div>`
          })
          marker.addListener('click', () => info.open(mapInstance.current, marker))
          bounds.extend(position)
          newMarkers.push(marker)
        }
        markersRef.current.forEach(m => m.setMap(null))
        markersRef.current = newMarkers
        if (newMarkers.length > 0) {
          mapInstance.current.fitBounds(bounds)
          if (newMarkers.length === 1) mapInstance.current.setZoom(15)
        }
        setStatus('ready')
      } catch (err) {
        console.error('Map failed to load:', err)
        if (!cancelled) setStatus('error')
      }
    }
    init()
    return () => { cancelled = true }
  }, [items, apiKey, geocodeAddress])

  if (status === 'nokey') {
    return (
      <div style={{ background: 'white', borderRadius: '24px', padding: '32px 24px', textAlign: 'center', color: MUTED, fontSize: '14px' }}>
        Add a Google Maps API key to <code>.env.local</code> as <code>VITE_GOOGLE_MAPS_API_KEY</code> to enable the map.
      </div>
    )
  }

  const legendEntries = Object.entries(TYPE_CONFIG).filter(([k]) => k !== 'note' && k !== 'expense')
  const directionsUrl = buildDirectionsLink(items)

  return (
    <>
      {directionsUrl && (
        <a href={directionsUrl} target="_blank" rel="noopener noreferrer" style={{
          display: 'block', textAlign: 'center', textDecoration: 'none', marginBottom: '14px',
          background: 'white', border: `1.5px solid ${CARD_BORDER}`, borderRadius: '14px', padding: '12px',
          color: ACCENT_TEXT, fontSize: '13px', fontWeight: '700', fontFamily: FONT
        }}>
          🗺️ Open full route in Google Maps
        </a>
      )}
      <div style={{ position: 'relative', width: '100%', height: '520px', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(28,25,23,0.06)' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 12, left: 12, background: 'white', padding: '10px 14px', borderRadius: 14, boxShadow: '0 1px 8px rgba(0,0,0,0.15)', fontFamily: FONT }}>
        {legendEntries.map(([key, cfg]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: INK }}>{cfg.label.replace(/^[^ ]+ /, '')}</span>
          </div>
        ))}
      </div>
      {status === 'error' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(250,250,248,0.92)', fontSize: 14, color: MUTED, textAlign: 'center', padding: 24 }}>
          Map couldn't load — check your API key and that Maps JavaScript + Places + Geocoding APIs are enabled.
        </div>
      )}
      </div>
    </>
  )
}

// ---------- Address input with Google Places autocomplete ----------
function AddressInput({ value, onChange, onPlaceSelected, placeholder, style }) {
  const inputRef = useRef(null)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    if (!apiKey || !inputRef.current) return
    let autocomplete
    let listener
    loadGoogleMaps(apiKey).then(maps => {
      if (!inputRef.current || !maps.places) return
      autocomplete = new maps.places.Autocomplete(inputRef.current, { types: ['geocode', 'establishment'] })
      listener = autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        if (place?.formatted_address) onChange(place.formatted_address)
        else if (place?.name) onChange(place.name)
        if (onPlaceSelected && place?.geometry?.location) {
          onPlaceSelected({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() })
        }
      })
    }).catch(err => console.error('Places autocomplete failed to load:', err))
    return () => { if (listener) listener.remove() }
  }, [apiKey])

  return (
    <input
      ref={inputRef}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={style}
    />
  )
}

function App() {
  const [user, setUser] = useState(null)
  const editFormRef = useRef(null)
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [providerToken, setProviderToken] = useState(null)
  const [trips, setTrips] = useState([])
  const [selectedTrip, setSelectedTrip] = useState(null)
  const [editingTrip, setEditingTrip] = useState(null)
  const [activeTab, setActiveTab] = useState('master')
  const [masterView, setMasterView] = useState('group')
  const [selectedDay, setSelectedDay] = useState(null)
  const [geoCache, setGeoCache] = useState({})
  const [tripName, setTripName] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [timezone, setTimezone] = useState('America/Chicago')
  const [timezoneAuto, setTimezoneAuto] = useState(false)
  const [showTimezoneField, setShowTimezoneField] = useState(false)
  const [localCurrency, setLocalCurrency] = useState('USD')
  const [fxRates, setFxRates] = useState({ USD: 1 }) // currency code -> USD rate, fetched per currency actually used
  const [copiedId, setCopiedId] = useState(null)
  const [joinMessage, setJoinMessage] = useState('')

  const [items, setItems] = useState([])
  const [editingItem, setEditingItem] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState('activity')
  const [newStatus, setNewStatus] = useState('suggested')
  const [newDate, setNewDate] = useState('')
  const [newStartTime, setNewStartTime] = useState('')
  const [newEndTime, setNewEndTime] = useState('')
  const [newCheckIn, setNewCheckIn] = useState('')
  const [newCheckOut, setNewCheckOut] = useState('')
  const [newDeparture, setNewDeparture] = useState('')
  const [newArrival, setNewArrival] = useState('')
  const [newConfirmation, setNewConfirmation] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newItemTimezone, setNewItemTimezone] = useState('')
  const [showItemTimezoneField, setShowItemTimezoneField] = useState(false)
  const [newNotes, setNewNotes] = useState('')
  const [newTravelerUserId, setNewTravelerUserId] = useState('')
  const [newTravelerName, setNewTravelerName] = useState('')
  const [newIsPrivate, setNewIsPrivate] = useState(false)
  const [newIsPrepaid, setNewIsPrepaid] = useState(false)
  const [newCost, setNewCost] = useState('')
  const [newCostCurrency, setNewCostCurrency] = useState('USD')
  const [newPaidBy, setNewPaidBy] = useState('')
  const [newSplitType, setNewSplitType] = useState('all')
  const [newSplitMethod, setNewSplitMethod] = useState('even')
  const [newSelectedMembers, setNewSelectedMembers] = useState([])
  const [newCustomAmounts, setNewCustomAmounts] = useState({})

  const [bookings, setBookings] = useState([])
  const [members, setMembers] = useState([])

  const [showAddExpense, setShowAddExpense] = useState(false)
  const [expTitle, setExpTitle] = useState('')
  const [expCost, setExpCost] = useState('')
  const [expCostCurrency, setExpCostCurrency] = useState('USD')
  const [expPaidBy, setExpPaidBy] = useState('')
  const [expSplitType, setExpSplitType] = useState('all')
  const [expSplitMethod, setExpSplitMethod] = useState('even')
  const [expSelectedMembers, setExpSelectedMembers] = useState([])
  const [expCustomAmounts, setExpCustomAmounts] = useState({})

  const [splits, setSplits] = useState([])
  const [iSplits, setISplits] = useState([])
  const [showCountedItems, setShowCountedItems] = useState(false)
  const [syncingCalendar, setSyncingCalendar] = useState(false)

  useEffect(() => {
    function goOnline() { setIsOnline(true) }
    function goOffline() { setIsOnline(false) }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // On native (iOS/Android), Google sign-in has to open in the system
  // browser rather than the app's own web view. This listens for the app
  // being reopened via the com.aditi.trippy://callback custom URL scheme
  // once that sign-in completes, and turns the tokens in that URL into a
  // real Supabase session.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listener = CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
      if (!url.includes('callback')) return
      await Browser.close().catch(() => {})
      const hashPart = url.split('#')[1]
      if (!hashPart) return
      const params = new URLSearchParams(hashPart)
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token')
      const provider_token = params.get('provider_token')
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token })
        if (error) {
          console.error('Failed to set session from native sign-in callback:', error)
          return
        }
        if (provider_token) {
          sessionStorage.setItem('gcal_provider_token', provider_token)
          setProviderToken(provider_token)
        }
      }
    })
    return () => { listener.then(l => l.remove()) }
  }, [])

  async function signInWithGoogle() {
    const redirectTo = Capacitor.isNativePlatform() ? 'com.aditi.trippy://callback' : window.location.origin
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: Capacitor.isNativePlatform(),
        scopes: 'https://www.googleapis.com/auth/calendar.events',
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    })
    if (error) { console.error('Sign-in failed to start:', error); return }
    if (Capacitor.isNativePlatform() && data?.url) {
      await Browser.open({ url: data.url })
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      const token = session?.provider_token || sessionStorage.getItem('gcal_provider_token')
      setProviderToken(token || null)
    })
    supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      if (session?.provider_token) {
        sessionStorage.setItem('gcal_provider_token', session.provider_token)
        setProviderToken(session.provider_token)
      } else if (!session) {
        sessionStorage.removeItem('gcal_provider_token')
        setProviderToken(null)
      }
    })
  }, [])

  useEffect(() => {
    if (user) { fetchTrips(); handleInviteToken() }
  }, [user])

  useEffect(() => {
    if (selectedTrip) {
      fetchItems(selectedTrip.id)
      fetchBookings(selectedTrip.id)
      fetchMembers(selectedTrip.id)
      fetchSplits(selectedTrip.id)
      fetchISplits(selectedTrip.id)
    }
  }, [selectedTrip])

  // Whenever the items list changes, make sure we have a live USD rate for
  // every currency actually used on a cost — since costs can now be entered
  // per-item, a trip can easily mix USD, EUR, etc. in the same list.
  useEffect(() => {
    const currenciesUsed = new Set(items.filter(i => i.cost).map(i => i.cost_currency || 'USD'))
    currenciesUsed.forEach(code => { if (!(code in fxRates)) fetchFxRate(code) })
  }, [items])

  // Geocodes every unique address across all items (suggested and booked)
  // so the Suggestions tab can cluster nearby ones together and flag
  // proximity to already-booked days. Shares its cache with the Map tab.
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!apiKey) return
    const addresses = [...new Set(items.filter(i => i.address).map(i => i.address))]
    const missing = addresses.filter(a => !(a in geoCache))
    if (missing.length === 0) return
    let cancelled = false
    loadGoogleMaps(apiKey).then(async maps => {
      const geocoder = new maps.Geocoder()
      const updates = {}
      for (const addr of missing) {
        const loc = await geocodeAddressCached(geocoder, addr)
        updates[addr] = loc // cache a null too, so we don't keep retrying a bad address
      }
      if (!cancelled) setGeoCache(prev => ({ ...prev, ...updates }))
    }).catch(err => console.error('Geocoding for suggestions failed:', err))
    return () => { cancelled = true }
  }, [items])

  // Live exchange rate via Frankfurter (free, no API key). Stores 1 unit of
  // `currencyCode` in USD terms into the shared fxRates map.
  async function fetchFxRate(currencyCode) {
    if (!currencyCode || currencyCode === 'USD') { setFxRates(prev => ({ ...prev, USD: 1 })); return }
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${currencyCode}`)
      const data = await res.json()
      if (data.rates?.USD) setFxRates(prev => ({ ...prev, [currencyCode]: data.rates.USD }))
      else console.error('FX rate lookup returned no rate:', data)
    } catch (err) {
      console.error('FX rate lookup failed:', err)
    }
  }

  // Converts an amount in `currency` to USD using the live rate, if we have
  // one yet — returns null while the rate is still loading so callers can
  // hide the conversion rather than show a wrong number.
  function toUSD(amount, currency) {
    if (!amount) return 0
    const code = currency || 'USD'
    if (code === 'USD') return amount
    const rate = fxRates[code]
    return rate ? amount * rate : null
  }

  function usdEquivalent(amount, currency) {
    if (!amount) return null
    const code = currency || 'USD'
    if (code === 'USD') return null
    const converted = toUSD(amount, code)
    return converted != null ? converted.toFixed(2) : null
  }

  async function handleInviteToken() {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('invite')
    if (!token) return
    const { data: invite, error } = await supabase.from('invites').select('*').eq('token', token).single()
    if (error || !invite) { setJoinMessage('Invalid or expired invite link.'); return }
    const { data: existing } = await supabase.from('trip_members').select('*').eq('trip_id', invite.trip_id).eq('user_id', user.id).single()
    if (!existing) {
      await supabase.from('trip_members').insert({ trip_id: invite.trip_id, user_id: user.id, role: 'member' })
      setJoinMessage('You joined the trip!')
    } else {
      setJoinMessage('You are already on this trip!')
    }
    window.history.replaceState({}, '', '/')
    fetchTrips()
  }

  async function fetchTrips() {
    try {
      const { data: ownedTrips } = await supabase.from('trips').select('*').eq('created_by', user.id)
      const { data: memberTrips } = await supabase.from('trip_members').select('trip_id').eq('user_id', user.id)
      let sharedTrips = []
      if (memberTrips?.length > 0) {
        const { data } = await supabase.from('trips').select('*').in('id', memberTrips.map(m => m.trip_id))
        sharedTrips = data || []
      }
      const allTrips = [...(ownedTrips || []), ...sharedTrips]
      const deduped = allTrips.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
      setTrips(deduped)
      cacheSet(`trips:${user.id}`, deduped)
    } catch (err) {
      console.error('Failed to fetch trips (using cached copy if available):', err)
      const cached = cacheGet(`trips:${user.id}`)
      if (cached) setTrips(cached)
    }
  }

  async function fetchMembers(tripId) {
    try {
      const { data: memberRows } = await supabase.from('trip_members').select('user_id').eq('trip_id', tripId)
      const { data: tripData } = await supabase.from('trips').select('created_by').eq('id', tripId).single()
      const allIds = [...new Set([...(memberRows || []).map(m => m.user_id), tripData?.created_by].filter(Boolean))]
      const { data: profileRows, error: profileError } = await supabase.from('profiles').select('id, full_name').in('id', allIds)
      if (profileError) console.error('Failed to load profiles for member names:', profileError)
      const nameById = {}
      ;(profileRows || []).forEach(p => { nameById[p.id] = p.full_name })
      const list = allIds.map(uid => ({
        user_id: uid,
        display_name: uid === user.id ? (user.user_metadata?.full_name || 'You') : (nameById[uid] || `Member (${uid.slice(0, 6)})`)
      }))
      setMembers(list)
      cacheSet(`members:${tripId}`, list)
      setNewPaidBy(user.id)
      setExpPaidBy(user.id)
      setNewSelectedMembers(allIds)
      setExpSelectedMembers(allIds)
    } catch (err) {
      console.error('Failed to fetch members (using cached copy if available):', err)
      const cached = cacheGet(`members:${tripId}`)
      if (cached) setMembers(cached)
    }
  }

  async function fetchItems(tripId) {
    try {
      const { data, error } = await supabase.from('itinerary_items').select('*').eq('trip_id', tripId).order('day_date').order('start_time')
      if (error) throw error
      setItems(data)
      cacheSet(`items:${tripId}`, data)
    } catch (err) {
      console.error('Failed to fetch items (using cached copy if available):', err)
      const cached = cacheGet(`items:${tripId}`)
      if (cached) setItems(cached)
    }
  }

  async function fetchBookings(tripId) {
    try {
      const { data, error } = await supabase.from('bookings').select('*').eq('trip_id', tripId).order('created_at')
      if (error) throw error
      setBookings(data)
      cacheSet(`bookings:${tripId}`, data)
    } catch (err) {
      console.error('Failed to fetch bookings (using cached copy if available):', err)
      const cached = cacheGet(`bookings:${tripId}`)
      if (cached) setBookings(cached)
    }
  }

  async function fetchSplits(tripId) {
    try {
      const { data: bRows } = await supabase.from('bookings').select('id').eq('trip_id', tripId)
      if (!bRows?.length) { setSplits([]); cacheSet(`splits:${tripId}`, []); return }
      const { data, error } = await supabase.from('booking_splits').select('*').in('booking_id', bRows.map(b => b.id))
      if (error) throw error
      setSplits(data || [])
      cacheSet(`splits:${tripId}`, data || [])
    } catch (err) {
      console.error('Failed to fetch splits (using cached copy if available):', err)
      const cached = cacheGet(`splits:${tripId}`)
      if (cached) setSplits(cached)
    }
  }

  async function fetchISplits(tripId) {
    try {
      const { data: iRows } = await supabase.from('itinerary_items').select('id').eq('trip_id', tripId)
      if (!iRows?.length) { setISplits([]); cacheSet(`isplits:${tripId}`, []); return }
      const { data, error } = await supabase.from('itinerary_splits').select('*').in('item_id', iRows.map(i => i.id))
      if (error) throw error
      setISplits(data || [])
      cacheSet(`isplits:${tripId}`, data || [])
    } catch (err) {
      console.error('Failed to fetch item splits (using cached copy if available):', err)
      const cached = cacheGet(`isplits:${tripId}`)
      if (cached) setISplits(cached)
    }
  }

  async function detectTimezoneForDestination(lat, lng) {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!apiKey) return
    try {
      const timestamp = Math.floor(Date.now() / 1000)
      const res = await fetch(`https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${apiKey}`)
      const data = await res.json()
      if (data.status === 'OK' && data.timeZoneId) {
        setTimezone(data.timeZoneId)
        setTimezoneAuto(true)
      } else {
        console.error('Timezone lookup failed:', data.status, data.errorMessage)
      }
    } catch (err) {
      console.error('Timezone lookup error:', err)
    }
  }

  function startEditTrip(trip) {
    setEditingTrip(trip)
    setTripName(trip.name); setDestination(trip.destination)
    setStartDate(trip.start_date || ''); setEndDate(trip.end_date || '')
    setTimezone(trip.timezone || 'America/Chicago'); setTimezoneAuto(false)
    setLocalCurrency(trip.local_currency || 'USD')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEditTrip() {
    setEditingTrip(null)
    setTripName(''); setDestination(''); setStartDate(''); setEndDate('')
    setTimezone('America/Chicago'); setTimezoneAuto(false)
    setLocalCurrency('USD')
  }

  async function createTrip() {
    if (!tripName || !destination) return
    if (!isOnline) { alert("You're offline — trips can't be created or edited until you're back online."); return }
    if (editingTrip) {
      const { error } = await supabase.from('trips').update({
        name: tripName, destination, start_date: startDate || null, end_date: endDate || null, timezone,
        local_currency: localCurrency
      }).eq('id', editingTrip.id)
      if (error) { console.error('Failed to update trip:', error); alert('Could not save changes: ' + error.message); return }
      cancelEditTrip()
      fetchTrips()
      return
    }
    const { data, error } = await supabase.from('trips').insert({
      name: tripName, destination, start_date: startDate || null, end_date: endDate || null,
      timezone, local_currency: localCurrency, created_by: user.id
    }).select().single()
    if (error) { console.error('Failed to create trip:', error); alert('Could not create trip: ' + error.message); return }
    if (data) {
      await supabase.from('trip_members').insert({ trip_id: data.id, user_id: user.id, role: 'owner' })
      setTripName(''); setDestination(''); setStartDate(''); setEndDate(''); setLocalCurrency('USD')
      fetchTrips()
    }
  }

  async function deleteTrip(tripId) {
    if (!isOnline) { alert("You're offline — deleting a trip requires a connection."); return }
    if (!window.confirm('Delete this trip and all its items? This cannot be undone.')) return
    await supabase.from('itinerary_items').delete().eq('trip_id', tripId)
    await supabase.from('bookings').delete().eq('trip_id', tripId)
    await supabase.from('trip_members').delete().eq('trip_id', tripId)
    await supabase.from('invites').delete().eq('trip_id', tripId)
    await supabase.from('trips').delete().eq('id', tripId)
    fetchTrips()
  }

  function getItemSplitMembers() {
    if (newSplitType === 'solo') return []
    if (newSplitType === 'all') return members.map(m => m.user_id)
    return newSelectedMembers
  }

  function getItemEvenAmount() {
    const sm = getItemSplitMembers()
    if (!newCost || sm.length === 0) return 0
    return parseFloat((parseFloat(newCost) / sm.length).toFixed(2))
  }

  function resetItemForm() {
    setEditingItem(null)
    setNewTitle(''); setNewType('activity'); setNewStatus('suggested')
    setNewDate(''); setNewStartTime(''); setNewEndTime('')
    setNewCheckIn(''); setNewCheckOut(''); setNewDeparture(''); setNewArrival('')
    setNewConfirmation(''); setNewAddress(''); setNewItemTimezone(''); setShowItemTimezoneField(false); setNewNotes('')
    setNewTravelerUserId(''); setNewTravelerName(''); setNewIsPrivate(false)
    setNewIsPrepaid(false); setNewCost(''); setNewCostCurrency('USD'); setNewPaidBy(user.id)
    setNewSplitType('all'); setNewSplitMethod('even')
    setNewSelectedMembers(members.map(m => m.user_id)); setNewCustomAmounts({})
  }

  function startEditItem(item) {
    setEditingItem(item)
    setNewTitle(item.title); setNewType(item.type); setNewStatus(item.status)
    setNewDate(item.day_date || '')
    setNewStartTime(item.start_time || ''); setNewEndTime(item.end_time || '')
    setNewCheckIn(item.check_in ? item.check_in.slice(0, 16) : '')
    setNewCheckOut(item.check_out ? item.check_out.slice(0, 16) : '')
    setNewDeparture(item.departure_location || ''); setNewArrival(item.arrival_location || '')
    setNewConfirmation(item.confirmation || '')
    setNewAddress(item.address || ''); setNewItemTimezone(item.item_timezone || ''); setNewNotes(item.notes || '')
    setNewTravelerUserId(item.traveler_user_id || ''); setNewTravelerName(item.traveler_name || '')
    setNewIsPrivate(item.is_private || false)
    setNewIsPrepaid(item.is_prepaid || false); setNewCost(item.cost || ''); setNewCostCurrency(item.cost_currency || 'USD')
    setNewPaidBy(item.paid_by || user.id)
    setNewSplitType(item.split_type === 'solo' ? 'solo' : item.split_type === 'equal' ? 'all' : 'some')
    setNewSplitMethod(item.split_method || 'even')
    setNewSelectedMembers(item.split_members || members.map(m => m.user_id))
    setNewCustomAmounts(item.custom_amounts || {})
    setActiveTab('plan')
    setTimeout(() => {
      editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  // Requires the 'calendar.events' scope granted at sign-in. Returns true/false
  // so callers can tell whether the event actually landed, not just that we tried.
  // Updates the SAME calendar event on subsequent calls (tracked via
  // item.google_event_id) instead of creating a new one every time.
  async function pushToGoogleCalendar(item) {
    if (!providerToken || !selectedTrip) return false
    const timing = TYPE_CONFIG[item.type]?.timing || 'single'
    if (timing === 'none') return false // off-itinerary expenses don't go to Calendar
    const tz = item.item_timezone || selectedTrip.timezone || 'UTC'
    let startDateTime, endDateTime

    if (timing === 'single') {
      if (!item.day_date) return false
      const startT = (item.start_time || '09:00').slice(0, 5)
      const endT = (item.end_time || item.start_time || '10:00').slice(0, 5)
      startDateTime = `${item.day_date}T${startT}:00`
      endDateTime = `${item.day_date}T${endT}:00`
    } else {
      // 'stay' or 'flight' — both store their two datetimes in check_in / check_out
      if (!item.check_in) return false
      startDateTime = item.check_in.length === 16 ? `${item.check_in}:00` : item.check_in
      endDateTime = item.check_out ? (item.check_out.length === 16 ? `${item.check_out}:00` : item.check_out) : startDateTime
    }

    const event = {
      summary: item.title,
      location: item.address || undefined,
      description: item.notes || undefined,
      start: { dateTime: startDateTime, timeZone: tz },
      end: { dateTime: endDateTime, timeZone: tz },
    }

    const isUpdate = !!item.google_event_id
    const url = isUpdate
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${item.google_event_id}`
      : 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

    console.log('Pushing calendar event:', JSON.stringify(event, null, 2))

    try {
      const res = await fetch(url, {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${providerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Calendar sync failed:', res.status, err)
        // The saved event was deleted manually on Calendar — recreate it fresh instead of failing forever
        if (isUpdate && res.status === 404) {
          return pushToGoogleCalendar({ ...item, google_event_id: null })
        }
        return false
      }
      const data = await res.json()
      if (!isUpdate && data.id && item.id) {
        await supabase.from('itinerary_items').update({ google_event_id: data.id }).eq('id', item.id)
      }
      return true
    } catch (err) {
      console.error('Calendar sync error:', err)
      return false
    }
  }

  // Lets any trip member pull the whole itinerary into THEIR OWN calendar on
  // demand (auto-sync on save only reaches the person who added/edited the
  // item). Tracks already-synced items per-user in localStorage so repeat
  // clicks don't create duplicate events — but only marks an item as synced
  // once the API call has actually succeeded.
  async function syncMyCalendar() {
    if (!providerToken) {
      alert('Calendar access not granted yet. Sign out and back in, and approve calendar access when Google asks.')
      return
    }
    setSyncingCalendar(true)
    let synced = 0, skipped = 0, failed = 0
    for (const item of items) {
      const timing = TYPE_CONFIG[item.type]?.timing || 'single'
      if (timing === 'none') continue
      const trackKey = `calendarSynced:${user.id}:${item.id}`
      if (localStorage.getItem(trackKey)) { skipped++; continue }
      const ok = await pushToGoogleCalendar(item)
      if (ok) {
        localStorage.setItem(trackKey, 'true')
        synced++
      } else {
        failed++
      }
    }
    setSyncingCalendar(false)
    let msg = `Added ${synced} item${synced === 1 ? '' : 's'} to your Google Calendar.`
    if (skipped > 0) msg += ` (${skipped} already synced previously.)`
    if (failed > 0) msg += ` ⚠️ ${failed} failed — check the browser console for the exact error.`
    alert(msg)
  }

  async function saveItem() {
    if (!newTitle) return
    if (!isOnline) { alert("You're offline — this will save once you're back online. Hold onto your changes for now."); return }
    try {
      await saveItemInner()
    } catch (err) {
      console.error('Unexpected error while saving item:', err)
      alert('Something went wrong saving this item: ' + (err?.message || 'unknown error') + '\n\nCheck the console for details.')
    }
  }

  async function saveItemInner() {
    console.log('[saveItem] started. type=', newType, 'title=', newTitle)
    const timing = TYPE_CONFIG[newType]?.timing || 'single'
    console.log('[saveItem] timing=', timing)
    const cost = newCost ? parseFloat(newCost) : null
    const splitMembers = getItemSplitMembers()
    console.log('[saveItem] splitMembers=', splitMembers)
    const splitMembersToRecord = splitMembers.filter(uid => uid !== newPaidBy)

    const itemData = {
      title: newTitle, type: newType, status: newStatus,
      day_date: timing === 'single' ? (newDate || null) : null,
      start_time: timing === 'single' ? (newStartTime || null) : null,
      end_time: timing === 'single' ? (newEndTime || null) : null,
      check_in: (timing === 'stay' || timing === 'flight') ? (newCheckIn || null) : null,
      check_out: (timing === 'stay' || timing === 'flight') ? (newCheckOut || null) : null,
      departure_location: timing === 'flight' ? (newDeparture || null) : null,
      arrival_location: timing === 'flight' ? (newArrival || null) : null,
      confirmation: TYPE_CONFIG[newType]?.confirmation ? (newConfirmation || null) : null,
      address: newAddress || null, item_timezone: newItemTimezone || null, notes: newNotes || null,
      traveler_user_id: newTravelerUserId || null, traveler_name: newTravelerName || null,
      is_private: newIsPrivate,
      is_prepaid: newIsPrepaid, cost: newIsPrepaid ? cost : null, cost_currency: newIsPrepaid ? newCostCurrency : null,
      paid_by: newIsPrepaid ? newPaidBy : null,
      split_type: newIsPrepaid ? (newSplitType === 'all' ? 'equal' : newSplitType) : 'solo',
      split_method: newIsPrepaid ? newSplitMethod : null,
      split_members: newIsPrepaid && newSplitType === 'some' ? newSelectedMembers : null,
      custom_amounts: newIsPrepaid && newSplitMethod === 'custom' ? newCustomAmounts : null
    }
    console.log('[saveItem] itemData built:', itemData)

    if (editingItem) {
      console.log('[saveItem] taking UPDATE path for existing item', editingItem.id)
      const { error: updateError } = await supabase.from('itinerary_items').update(itemData).eq('id', editingItem.id)
      console.log('[saveItem] update result, error=', updateError)
      if (updateError) {
        console.error('Failed to update item:', updateError)
        alert('Could not save changes: ' + updateError.message)
        return
      }
      await supabase.from('itinerary_splits').delete().eq('item_id', editingItem.id)
      if (newIsPrepaid && cost && splitMembersToRecord.length > 0) {
        const { error: splitError } = await supabase.from('itinerary_splits').insert(splitMembersToRecord.map(uid => ({
          item_id: editingItem.id, user_id: uid,
          amount_owed: newSplitMethod === 'even' ? getItemEvenAmount() : parseFloat(newCustomAmounts[uid] || 0),
          paid: false
        })))
        if (splitError) console.error('Failed to save splits:', splitError)
      }
      pushToGoogleCalendar({ ...itemData, id: editingItem.id, google_event_id: editingItem.google_event_id })
    } else {
      console.log('[saveItem] taking INSERT path for new item')
      const { data: newItem, error } = await supabase.from('itinerary_items').insert({
        ...itemData, trip_id: selectedTrip.id, added_by: user.id
      }).select().single()
      console.log('[saveItem] insert result, newItem=', newItem, 'error=', error)
      if (error) {
        console.error('Failed to add item:', error)
        alert('Could not add item: ' + error.message)
        return
      }
      if (newItem && newIsPrepaid && cost && splitMembersToRecord.length > 0) {
        const { error: splitError } = await supabase.from('itinerary_splits').insert(splitMembersToRecord.map(uid => ({
          item_id: newItem.id, user_id: uid,
          amount_owed: newSplitMethod === 'even' ? getItemEvenAmount() : parseFloat(newCustomAmounts[uid] || 0),
          paid: false
        })))
        if (splitError) console.error('Failed to save splits:', splitError)
      }
      if (newItem) pushToGoogleCalendar(newItem)
    }
    console.log('[saveItem] done, resetting form and refetching')
    resetItemForm()
    fetchItems(selectedTrip.id)
    fetchISplits(selectedTrip.id)
  }

  async function toggleItemStatus(item) {
    if (!isOnline) { alert("You're offline — this requires a connection."); return }
    const newStatusValue = item.status === 'suggested' ? 'booked' : 'suggested'
    const label = newStatusValue === 'booked' ? 'Booked ✅' : 'Suggested 💡'
    if (!window.confirm(`Mark "${item.title}" as ${label}?`)) return
    const { error } = await supabase.from('itinerary_items').update({ status: newStatusValue }).eq('id', item.id)
    if (error) { console.error('Failed to update status:', error); alert('Could not update status: ' + error.message); return }
    fetchItems(selectedTrip.id)
  }

  async function deleteItem(itemId) {
    if (!isOnline) { alert("You're offline — deleting requires a connection."); return }
    const item = items.find(i => i.id === itemId)
    const confirmMsg = item?.google_event_id
      ? `Delete "${item.title}"? This will also remove it from your Google Calendar.`
      : `Delete "${item?.title || 'this item'}"?`
    if (!window.confirm(confirmMsg)) return
    if (item?.google_event_id && providerToken) {
      try {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${item.google_event_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${providerToken}` }
        })
      } catch (err) {
        console.error('Failed to remove calendar event:', err)
      }
    }
    await supabase.from('itinerary_splits').delete().eq('item_id', itemId)
    await supabase.from('itinerary_items').delete().eq('id', itemId)
    fetchItems(selectedTrip.id)
    fetchISplits(selectedTrip.id)
  }

  // Swaps sort_order between an item and its neighbor within the same
  // subsection (a day's planned list, or a day's suggestions list), so
  // reordering never affects items elsewhere in the trip.
  async function moveItem(item, direction, siblings) {
    if (!isOnline) { alert("You're offline — reordering requires a connection."); return }
    const idx = siblings.findIndex(i => i.id === item.id)
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || targetIdx < 0 || targetIdx >= siblings.length) return
    const neighbor = siblings[targetIdx]
    const itemOrder = item.sort_order ?? idx
    const neighborOrder = neighbor.sort_order ?? targetIdx
    await Promise.all([
      supabase.from('itinerary_items').update({ sort_order: neighborOrder }).eq('id', item.id),
      supabase.from('itinerary_items').update({ sort_order: itemOrder }).eq('id', neighbor.id),
    ])
    fetchItems(selectedTrip.id)
  }

  function getExpSplitMembers() {
    if (expSplitType === 'solo') return []
    if (expSplitType === 'all') return members.map(m => m.user_id)
    return expSelectedMembers
  }
  function getExpEvenAmount() {
    const sm = getExpSplitMembers()
    if (!expCost || sm.length === 0) return 0
    return parseFloat((parseFloat(expCost) / sm.length).toFixed(2))
  }
  function resetExpenseForm() {
    setShowAddExpense(false)
    setExpTitle(''); setExpCost(''); setExpCostCurrency('USD'); setExpPaidBy(user.id)
    setExpSplitType('all'); setExpSplitMethod('even')
    setExpSelectedMembers(members.map(m => m.user_id)); setExpCustomAmounts({})
  }
  async function saveExpense() {
    if (!expTitle || !expCost) return
    if (!isOnline) { alert("You're offline — this will save once you're back online."); return }
    const cost = parseFloat(expCost)
    const splitMembers = getExpSplitMembers()
    const splitMembersToRecord = splitMembers.filter(uid => uid !== expPaidBy)
    const { data: newItem, error } = await supabase.from('itinerary_items').insert({
      trip_id: selectedTrip.id, added_by: user.id,
      title: expTitle, type: 'expense', status: 'booked',
      is_prepaid: true, cost, cost_currency: expCostCurrency, paid_by: expPaidBy,
      split_type: expSplitType === 'all' ? 'equal' : expSplitType,
      split_method: expSplitMethod,
      split_members: expSplitType === 'some' ? expSelectedMembers : null,
      custom_amounts: expSplitMethod === 'custom' ? expCustomAmounts : null
    }).select().single()
    if (error) { console.error('Failed to add expense:', error); alert('Could not add expense: ' + error.message); return }
    if (newItem && splitMembersToRecord.length > 0) {
      const { error: splitError } = await supabase.from('itinerary_splits').insert(splitMembersToRecord.map(uid => ({
        item_id: newItem.id, user_id: uid,
        amount_owed: expSplitMethod === 'even' ? getExpEvenAmount() : parseFloat(expCustomAmounts[uid] || 0),
        paid: false
      })))
      if (splitError) console.error('Failed to save splits:', splitError)
    }
    resetExpenseForm()
    fetchItems(selectedTrip.id)
    fetchISplits(selectedTrip.id)
  }

  async function generateInviteLink(tripId) {
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36)
    await supabase.from('invites').insert({ trip_id: tripId, token, created_by: user.id })
    const link = `${window.location.origin}?invite=${token}`
    await navigator.clipboard.writeText(link)
    setCopiedId(tripId)
    setTimeout(() => setCopiedId(null), 3000)
  }

  async function signOut() { await supabase.auth.signOut() }

  function getMemberName(uid) {
    return members.find(m => m.user_id === uid)?.display_name || uid?.slice(0, 6) || 'Unknown'
  }

  function computeBalances() {
    const balances = {}
    members.forEach(m => { balances[m.user_id] = 0 })
    splits.forEach(split => {
      if (split.paid) return
      const booking = bookings.find(b => b.id === split.booking_id)
      if (!booking) return
      const paidBy = booking.paid_by || booking.booked_by
      const amountUsd = toUSD(split.amount_owed, 'USD') // legacy bookings have no currency field — treated as USD
      if (amountUsd == null) return
      balances[paidBy] = (balances[paidBy] || 0) + amountUsd
      balances[split.user_id] = (balances[split.user_id] || 0) - amountUsd
    })
    iSplits.forEach(split => {
      if (split.paid) return
      const item = items.find(i => i.id === split.item_id)
      if (!item || !item.paid_by) return
      const amountUsd = toUSD(split.amount_owed, item.cost_currency)
      if (amountUsd == null) return // rate still loading — this split's contribution appears once it arrives
      balances[item.paid_by] = (balances[item.paid_by] || 0) + amountUsd
      balances[split.user_id] = (balances[split.user_id] || 0) - amountUsd
    })
    return balances
  }

  function computeTransfers() {
    const balances = computeBalances()
    const creditors = [], debtors = []
    Object.entries(balances).forEach(([uid, bal]) => {
      if (bal > 0.01) creditors.push({ uid, amount: bal })
      else if (bal < -0.01) debtors.push({ uid, amount: -bal })
    })
    const transfers = [], cred = creditors.map(c => ({ ...c })), debt = debtors.map(d => ({ ...d }))
    let ci = 0, di = 0
    while (ci < cred.length && di < debt.length) {
      const amount = Math.min(cred[ci].amount, debt[di].amount)
      transfers.push({ from: debt[di].uid, to: cred[ci].uid, amount: parseFloat(amount.toFixed(2)) })
      cred[ci].amount -= amount; debt[di].amount -= amount
      if (cred[ci].amount < 0.01) ci++
      if (debt[di].amount < 0.01) di++
    }
    return transfers
  }

  function computeTotalsPaid() {
    const paid = {}
    members.forEach(m => { paid[m.user_id] = 0 })
    items.forEach(i => {
      if (i.is_prepaid && i.cost && i.paid_by) {
        const usd = toUSD(i.cost, i.cost_currency)
        if (usd != null) paid[i.paid_by] = (paid[i.paid_by] || 0) + usd
      }
    })
    bookings.forEach(b => { const p = b.paid_by || b.booked_by; if (b.total_cost && p) paid[p] = (paid[p] || 0) + b.total_cost })
    return paid
  }

  function unpaidBreakdown() {
    const rows = []
    splits.forEach(s => {
      if (s.paid) return
      const booking = bookings.find(b => b.id === s.booking_id)
      if (!booking) return
      rows.push({ title: booking.title, debtor: s.user_id, creditor: booking.paid_by || booking.booked_by, amount: s.amount_owed })
    })
    iSplits.forEach(s => {
      if (s.paid) return
      const item = items.find(i => i.id === s.item_id)
      if (!item || !item.paid_by) return
      rows.push({ title: item.title, debtor: s.user_id, creditor: item.paid_by, amount: s.amount_owed })
    })
    return rows
  }

  async function markTransferPaid(fromUid, toUid) {
    const bSplitIds = splits.filter(s => {
      if (s.paid || s.user_id !== fromUid) return false
      const booking = bookings.find(b => b.id === s.booking_id)
      return booking && (booking.paid_by || booking.booked_by) === toUid
    }).map(s => s.id)
    const iSplitIds = iSplits.filter(s => {
      if (s.paid || s.user_id !== fromUid) return false
      const item = items.find(i => i.id === s.item_id)
      return item && item.paid_by === toUid
    }).map(s => s.id)
    if (bSplitIds.length > 0) await supabase.from('booking_splits').update({ paid: true, paid_at: new Date().toISOString() }).in('id', bSplitIds)
    if (iSplitIds.length > 0) await supabase.from('itinerary_splits').update({ paid: true, paid_at: new Date().toISOString() }).in('id', iSplitIds)
    fetchSplits(selectedTrip.id)
    fetchISplits(selectedTrip.id)
  }

  function buildMasterTimeline(view) {
    const dated = [], undated = []
    items.forEach(item => {
      if (view === 'personal') {
        const isForMe = item.added_by === user.id || item.paid_by === user.id ||
          (item.split_members && item.split_members.includes(user.id)) ||
          (item.split_type === 'equal' && item.is_prepaid)
        if (!isForMe) return
      }
      if (view === 'bookings' && item.status !== 'booked') return
      const timing = TYPE_CONFIG[item.type]?.timing || 'single'
      if (timing === 'stay' || timing === 'flight') {
        // Hotels/cars/flights get TWO timeline entries — one on the
        // check-in/departure day, one on the check-out/arrival day —
        // both pointing at the same underlying item for edit/delete.
        const startRole = timing === 'stay' ? 'checkin' : 'depart'
        const endRole = timing === 'stay' ? 'checkout' : 'arrive'
        let placed = false
        if (item.check_in) {
          dated.push({ ...item, _source: 'itinerary', date_key: item.check_in.split('T')[0], _occurrence: startRole })
          placed = true
        }
        if (item.check_out) {
          dated.push({ ...item, _source: 'itinerary', date_key: item.check_out.split('T')[0], _occurrence: endRole })
          placed = true
        }
        if (!placed) undated.push({ ...item, _source: 'itinerary' })
        return
      }
      const dayKey = getItemDayKey(item)
      if (dayKey) dated.push({ ...item, _source: 'itinerary', date_key: dayKey })
      else undated.push({ ...item, _source: 'itinerary' })
    })
    bookings.forEach(booking => {
      if (booking.is_private && booking.booked_by !== user.id) return
      if (view === 'personal') {
        const isForMe = booking.booked_by === user.id || booking.paid_by === user.id || booking.traveler_user_id === user.id
        if (!isForMe) return
      }
      const dateKey = booking.check_in ? dateKeyFromDateTime(booking.check_in) : selectedTrip?.start_date || null
      if (!dateKey) { undated.push({ ...booking, _source: 'booking' }); return }
      dated.push({ ...booking, _source: 'booking', date_key: dateKey })
    })
    dated.sort((a, b) => {
      if (a.date_key < b.date_key) return -1
      if (a.date_key > b.date_key) return 1
      if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0)
      const aTime = a._occurrence === 'checkout' || a._occurrence === 'arrive' ? timeKeyFromDateTime(a.check_out)
        : a._occurrence === 'checkin' || a._occurrence === 'depart' ? timeKeyFromDateTime(a.check_in)
        : (a.start_time || timeKeyFromDateTime(a.check_in))
      const bTime = b._occurrence === 'checkout' || b._occurrence === 'arrive' ? timeKeyFromDateTime(b.check_out)
        : b._occurrence === 'checkin' || b._occurrence === 'depart' ? timeKeyFromDateTime(b.check_in)
        : (b.start_time || timeKeyFromDateTime(b.check_in))
      return aTime.localeCompare(bTime)
    })
    return { dated, undated }
  }

  // "Suggestions" for a day are activities marked suggested with no fixed
  // time yet — everything else (booked, or suggested-but-timed) counts as
  // planned and stays in the main time-ordered list.
  function isUntimedSuggestion(item) {
    const timing = TYPE_CONFIG[item.type]?.timing || 'single'
    return item.status === 'suggested' && timing === 'single' && !item.start_time
  }

  function itemSubtitle(item, isBooking) {
    if (isBooking) {
      return item.check_in ? formatDateTime(item.check_in).split(', ')[1] || formatDateTime(item.check_in) : ''
    }
    const timing = TYPE_CONFIG[item.type]?.timing || 'single'
    if (timing === 'stay') {
      const inLabel = TYPE_CONFIG[item.type]?.inLabel || 'In'
      const outLabel = TYPE_CONFIG[item.type]?.outLabel || 'Out'
      if (item._occurrence === 'checkin') return item.check_in ? `${inLabel}: ${formatDateTime(item.check_in)}` : ''
      if (item._occurrence === 'checkout') return item.check_out ? `${outLabel}: ${formatDateTime(item.check_out)}` : ''
      return [item.check_in && `${inLabel} ${formatDateTime(item.check_in)}`, item.check_out && `${outLabel} ${formatDateTime(item.check_out)}`].filter(Boolean).join(' → ')
    }
    if (timing === 'flight') {
      if (item._occurrence === 'depart') return `Departs${item.departure_location ? ' ' + item.departure_location : ''}${item.check_in ? ' · ' + timeOnly(item.check_in) : ''}`
      if (item._occurrence === 'arrive') return `Arrives${item.arrival_location ? ' ' + item.arrival_location : ''}${item.check_out ? ' · ' + timeOnly(item.check_out) : ''}`
      const dep = item.departure_location ? `${item.departure_location}${item.check_in ? ' ' + timeOnly(item.check_in) : ''}` : ''
      const arr = item.arrival_location ? `${item.arrival_location}${item.check_out ? ' ' + timeOnly(item.check_out) : ''}` : ''
      return [dep, arr].filter(Boolean).join(' → ')
    }
    if (timing === 'none') return ''
    return `${formatTime(item.start_time) || ''}${item.end_time ? ` – ${formatTime(item.end_time)}` : ''}`
  }

  function renderTimelineItem(item, key, isLast) {
    const isBooking = item._source === 'booking'
    const color = isBooking ? bookingBorderColor(item, user.id) : (TYPE_CONFIG[item.type]?.color || TEAL)
    const icon = isBooking ? categoryIcon(item.category) : (TYPE_CONFIG[item.type]?.label.split(' ')[0] || '📝')
    const subtitle = itemSubtitle(item, isBooking)
    return (
      <div key={key} style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '22px', flexShrink: 0 }}>
          <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: color, marginTop: '14px', flexShrink: 0 }} />
          {!isLast && <div style={{ width: '2px', flex: 1, background: CARD_BORDER, marginTop: '4px' }} />}
        </div>
        <div style={{ flex: 1, background: 'white', borderRadius: '20px', padding: '14px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(28,25,23,0.05)', display: 'flex', gap: '12px', position: 'relative' }}>
          {!isBooking && (
            <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '2px' }}>
              <button onClick={() => startEditItem(item)} style={{ ...iconBtn, color: ACCENT }} title="Edit">✏️</button>
              <button onClick={() => deleteItem(item.id)} style={{ ...iconBtn, color: '#d6d3d1' }} title="Delete">✕</button>
            </div>
          )}
          <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingRight: isBooking ? 0 : '48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <h3 style={{ fontWeight: '700', fontSize: '15px', color: INK, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</h3>
              {item.address && (
                <a href={mapsLink(item.address)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontSize: '13px', flexShrink: 0 }} title="Open in Google Maps">📍</a>
              )}
            </div>
            {subtitle && <p style={{ color: MUTED, fontSize: '12px', margin: '2px 0 0' }}>{subtitle}</p>}
            {(item.traveler_name || item.traveler_user_id) && (
              <p style={{ fontSize: '12px', color: ACCENT_TEXT, margin: '2px 0 0' }}>👤 {item.traveler_name || getMemberName(item.traveler_user_id)}</p>
            )}
            {!isBooking && item.is_prepaid && item.cost && (
              <p style={{ fontSize: '11px', color: MUTED, margin: '4px 0 0' }}>
                💵 {item.cost} {item.cost_currency && item.cost_currency !== 'USD' ? item.cost_currency : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  function renderCard(item, key, coloredBg = false, siblings = null) {
    const isBooking = item._source === 'booking'
    const borderColor = isBooking ? bookingBorderColor(item, user.id) : (TYPE_CONFIG[item.type]?.color || TEAL)
    const icon = isBooking ? categoryIcon(item.category) : (TYPE_CONFIG[item.type]?.label.split(' ')[0] || '📝')
    const subtitle = itemSubtitle(item, isBooking)
    const occurrenceLabel = (() => {
      if (item._occurrence === 'checkin') return `${TYPE_CONFIG[item.type]?.inLabel || 'Check-in'}: `
      if (item._occurrence === 'checkout') return `${TYPE_CONFIG[item.type]?.outLabel || 'Check-out'}: `
      if (item._occurrence === 'depart') return 'Departs: '
      if (item._occurrence === 'arrive') return 'Arrives: '
      return ''
    })()
    const showCost = !isBooking && item.is_prepaid && item.cost && item._occurrence !== 'checkout' && item._occurrence !== 'arrive'

    // On the Itinerary tab, suggested (unconfirmed) items get a flat neutral
    // background regardless of category; booked items get their full
    // category color, with text color auto-picked for readability.
    const isSuggested = item.status === 'suggested'
    const cardBg = coloredBg ? (isSuggested ? '#EFE9E2' : borderColor) : 'white'
    const textColor = coloredBg ? contrastTextColor(cardBg) : INK
    const mutedTextColor = coloredBg ? (textColor === '#FFFFFF' ? 'rgba(255,255,255,0.8)' : 'rgba(28,25,23,0.65)') : MUTED

    // Long-press (press and hold ~550ms) on an Itinerary card toggles it
    // between Suggested and Booked — a quick shortcut so confirming a
    // suggestion doesn't require opening the full edit form.
    let pressTimer = null
    const longPressHandlers = (coloredBg && !isBooking) ? {
      onPointerDown: () => { pressTimer = setTimeout(() => toggleItemStatus(item), 550) },
      onPointerUp: () => clearTimeout(pressTimer),
      onPointerLeave: () => clearTimeout(pressTimer),
      onPointerCancel: () => clearTimeout(pressTimer),
    } : {}

    return (
      <div key={key} {...longPressHandlers} style={{
        background: cardBg, borderRadius: '20px', padding: '18px 20px', marginBottom: '14px',
        boxShadow: '0 1px 3px rgba(28,25,23,0.05)', position: 'relative',
        touchAction: longPressHandlers.onPointerDown ? 'manipulation' : undefined,
        ...(coloredBg ? {} : { borderLeft: `4px solid ${borderColor}` })
      }}>
        {!isBooking && siblings && siblings.length > 1 && (
          <div style={{ position: 'absolute', top: '14px', left: '16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <button onClick={() => moveItem(item, 'up', siblings)} style={{ ...iconBtn, color: coloredBg ? textColor : ACCENT, opacity: coloredBg ? 0.75 : 0.7, fontSize: '11px', padding: '2px 4px' }} title="Move up">▲</button>
            <button onClick={() => moveItem(item, 'down', siblings)} style={{ ...iconBtn, color: coloredBg ? textColor : ACCENT, opacity: coloredBg ? 0.75 : 0.7, fontSize: '11px', padding: '2px 4px' }} title="Move down">▼</button>
          </div>
        )}
        {!isBooking && (
          <div style={{ position: 'absolute', top: '14px', right: '16px', display: 'flex', gap: '4px' }}>
            <button onClick={() => startEditItem(item)} style={{ ...iconBtn, color: coloredBg ? textColor : ACCENT, opacity: coloredBg ? 0.85 : 1 }} title="Edit">✏️</button>
            <button onClick={() => deleteItem(item.id)} style={{ ...iconBtn, color: coloredBg ? textColor : '#d6d3d1', opacity: coloredBg ? 0.6 : 1 }} title="Delete">✕</button>
          </div>
        )}
        <div style={{ paddingRight: isBooking ? 0 : '56px', paddingLeft: (!isBooking && siblings && siblings.length > 1) ? '26px' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ fontWeight: '700', fontSize: '17px', color: textColor, margin: 0 }}>
              {icon} {occurrenceLabel}{item.title}
            </h3>
            {item.address && (
              <a href={mapsLink(item.address)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontSize: '15px' }} title="Open in Google Maps">
                📍
              </a>
            )}
          </div>
          {subtitle && <p style={{ color: mutedTextColor, fontSize: '13px', margin: '4px 0 0' }}>{subtitle}</p>}
          {item.confirmation && (
            <p style={{ fontSize: '12px', color: mutedTextColor, margin: '4px 0 0' }}>Confirmation: <span style={{ fontFamily: 'monospace', color: coloredBg ? textColor : ACCENT_TEXT }}>{item.confirmation}</span></p>
          )}
          {(item.traveler_name || item.traveler_user_id) && (
            <p style={{ fontSize: '13px', color: coloredBg ? textColor : ACCENT_TEXT, margin: '4px 0 0' }}>👤 {item.traveler_name || getMemberName(item.traveler_user_id)}</p>
          )}
          {item.notes && (
            <p style={{ fontSize: '13px', color: coloredBg ? textColor : '#57534e', margin: '8px 0 0', background: coloredBg ? 'rgba(255,255,255,0.15)' : '#FAFAF8', padding: '8px 12px', borderRadius: '10px' }}>{item.notes}</p>
          )}
          {showCost && (
            <p style={{ fontSize: '12px', color: mutedTextColor, margin: '8px 0 0' }}>
              💵 {item.cost} {item.cost_currency && item.cost_currency !== 'USD' ? item.cost_currency : ''}
              {usdEquivalent(item.cost, item.cost_currency) && <span> (~${usdEquivalent(item.cost, item.cost_currency)} USD)</span>}
            </p>
          )}
        </div>
      </div>
    )
  }

  const inputStyle = {
    width: '100%', padding: '12px 16px', border: `1.5px solid ${CARD_BORDER}`,
    borderRadius: '14px', fontSize: '16px', boxSizing: 'border-box',
    outline: 'none', background: '#FBFBFA', color: INK, fontFamily: FONT
  }

  // date/time/datetime-local inputs on iOS can silently ignore width:100%
  // because of their native picker's own internal sizing — stripping the
  // default appearance forces our own box model (and width) to take over.
  const dateTimeInputStyle = {
    ...inputStyle,
    WebkitAppearance: 'none',
    appearance: 'none',
    display: 'block',
    minWidth: '100%',
  }

  const tabStyle = (active) => ({
    flex: 1, padding: '10px 2px', border: 'none', borderRadius: '14px',
    background: active ? GRADIENT : 'transparent',
    color: active ? 'white' : MUTED,
    fontSize: '12px', fontWeight: active ? '700' : '500', cursor: 'pointer', fontFamily: FONT,
    boxShadow: active ? '0 4px 12px rgba(255,90,95,0.3)' : 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'all 0.15s',
    whiteSpace: 'nowrap'
  })

  const subToggleStyle = (active) => ({
    flex: 1, padding: '10px 4px', border: 'none', borderRadius: '12px',
    background: active ? GRADIENT : 'transparent',
    color: active ? 'white' : MUTED,
    fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT,
    boxShadow: active ? '0 2px 8px rgba(255,90,95,0.25)' : 'none',
    whiteSpace: 'nowrap'
  })

  const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '3px 5px', lineHeight: 1 }
  const sectionBox = { background: '#FAFAF8', borderRadius: '14px', padding: '14px', marginBottom: '10px' }

  const memberChip = (selected, onClick, label) => (
    <button key={label} onClick={onClick} style={{
      padding: '7px 14px', border: `1.5px solid ${selected ? ACCENT : CARD_BORDER}`,
      borderRadius: '20px', background: selected ? ACCENT_LIGHT : 'white',
      color: selected ? ACCENT_TEXT : MUTED, fontSize: '13px', cursor: 'pointer', fontWeight: '600', fontFamily: FONT
    }}>{label}</button>
  )

  const splitSection = (splitType, setSplitType, splitMethod, setSplitMethod, selectedMems, setSelectedMems, customAmounts, setCustomAmounts, cost, evenAmount, getSplitMems, isPrivate = null, setIsPrivate = null) => (
    <div style={sectionBox}>
      <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '8px' }}>Split between</label>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {['all', 'some', 'solo'].map(type => (
          <button key={type} onClick={() => setSplitType(type)} style={{
            flex: 1, padding: '8px', border: `1.5px solid ${splitType === type ? ACCENT : CARD_BORDER}`,
            borderRadius: '12px', background: splitType === type ? ACCENT_LIGHT : 'white',
            color: splitType === type ? ACCENT_TEXT : MUTED, fontSize: '13px', cursor: 'pointer', fontWeight: '600', fontFamily: FONT
          }}>
            {type === 'all' ? '👥 Everyone' : type === 'some' ? '🔀 Some' : '👤 Solo'}
          </button>
        ))}
      </div>
      {splitType === 'some' && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {members.map(m => memberChip(
            selectedMems.includes(m.user_id),
            () => setSelectedMems(prev => prev.includes(m.user_id) ? prev.filter(id => id !== m.user_id) : [...prev, m.user_id]),
            m.user_id === user.id ? 'Me' : m.display_name
          ))}
        </div>
      )}
      {splitType === 'solo' && isPrivate !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
          <label style={{ fontSize: '13px', color: '#57534e', cursor: 'pointer' }}>🔒 Keep private (only visible to me)</label>
        </div>
      )}
      {splitType !== 'solo' && (
        <>
          <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', margin: '10px 0 8px' }}>How to split?</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: splitMethod === 'custom' ? '10px' : '0' }}>
            {['even', 'custom'].map(method => (
              <button key={method} onClick={() => setSplitMethod(method)} style={{
                flex: 1, padding: '8px', border: `1.5px solid ${splitMethod === method ? ACCENT : CARD_BORDER}`,
                borderRadius: '12px', background: splitMethod === method ? ACCENT_LIGHT : 'white',
                color: splitMethod === method ? ACCENT_TEXT : MUTED, fontSize: '13px', cursor: 'pointer', fontWeight: '600', fontFamily: FONT
              }}>
                {method === 'even' ? `⚖️ Evenly${cost ? ` ($${evenAmount}/pp)` : ''}` : '✏️ Custom'}
              </button>
            ))}
          </div>
          {splitMethod === 'custom' && (
            <div style={{ marginTop: '10px' }}>
              {getSplitMems().map(uid => (
                <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#57534e', minWidth: '80px' }}>{getMemberName(uid)}</span>
                  <input type="number" placeholder="0.00" value={customAmounts[uid] || ''}
                    onChange={e => setCustomAmounts(prev => ({ ...prev, [uid]: e.target.value }))}
                    style={{ ...inputStyle, fontSize: '13px' }} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: BG_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <div style={{ background: 'white', borderRadius: '28px', padding: '48px', width: '100%', maxWidth: '400px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✈️</div>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: INK, margin: '0 0 8px' }}>Trip Planner</h1>
          <p style={{ color: MUTED, fontSize: '15px', margin: '0 0 32px' }}>Plan trips together, stress-free</p>
          <button onClick={signInWithGoogle}
            style={{ width: '100%', padding: '14px', border: 'none', borderRadius: '16px', background: ACCENT, color: 'white', fontSize: '16px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT }}>
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  if (selectedTrip) {
    const transfers = computeTransfers()
    const balances = computeBalances()
    const totalsPaid = computeTotalsPaid()
    const myNet = balances[user.id] || 0
    const totalTripSpend = items.filter(i => i.is_prepaid && i.cost).reduce((s, i) => s + (toUSD(i.cost, i.cost_currency) || 0), 0) +
      bookings.filter(b => b.total_cost).reduce((s, b) => s + b.total_cost, 0)
    const myTransfers = transfers.filter(t => t.from === user.id || t.to === user.id)
    const otherTransfers = transfers.filter(t => t.from !== user.id && t.to !== user.id)
    const breakdown = unpaidBreakdown()
    const masterTimeline = buildMasterTimeline(masterView)
    const masterGrouped = {}
    masterTimeline.dated.forEach(i => { (masterGrouped[i.date_key] = masterGrouped[i.date_key] || []).push(i) })
    const masterDates = Object.keys(masterGrouped).sort()
    const datedItems = items.filter(i => getItemDayKey(i))
    const undatedItems = items.filter(i => !getItemDayKey(i))
    const itineraryGrouped = {}
    datedItems.forEach(i => { const k = getItemDayKey(i); (itineraryGrouped[k] = itineraryGrouped[k] || []).push(i) })
    const itineraryDates = Object.keys(itineraryGrouped).sort()
    const mapItems = [...items, ...bookings.map(b => ({ ...b, type: b.category }))]

    return (
      <div style={{ minHeight: '100vh', background: BG, fontFamily: FONT }}>
        <div style={{ background: BG_GRADIENT, padding: 'max(48px, calc(20px + env(safe-area-inset-top))) 24px 32px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <button onClick={() => { setSelectedTrip(null); setActiveTab('master') }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: '14px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: FONT }}>
              ← Back
            </button>
            <button onClick={() => generateInviteLink(selectedTrip.id)} style={{ padding: '8px 16px', border: '1px solid rgba(255,255,255,0.35)', borderRadius: '999px', background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(4px)', color: 'white', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT }}>
              {copiedId === selectedTrip.id ? '✅ Copied!' : '🔗 Invite'}
            </button>
          </div>
          <h1 style={{ fontSize: '36px', fontWeight: '800', color: 'white', margin: 0, textAlign: 'center' }}>{selectedTrip.name}</h1>
          {members.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '14px' }}>
              {members.slice(0, 5).map((m, i) => (
                <div key={m.user_id} title={m.display_name} style={{
                  width: '30px', height: '30px', borderRadius: '50%', background: 'rgba(255,255,255,0.95)', color: ACCENT_DARK,
                  fontWeight: '800', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginLeft: i === 0 ? 0 : '-8px', border: '2px solid rgba(225,68,72,0.9)'
                }}>
                  {(m.display_name || '?').charAt(0).toUpperCase()}
                </div>
              ))}
              {members.length > 5 && (
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', color: 'white', fontWeight: '700', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '-8px', border: '2px solid rgba(225,68,72,0.9)' }}>
                  +{members.length - 5}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ maxWidth: '560px', margin: '-20px auto 0', padding: '0 20px 40px', position: 'relative', zIndex: 10 }}>

          {!isOnline && (
            <div style={{ background: '#3A3530', color: 'white', borderRadius: '14px', padding: '10px 16px', marginBottom: '16px', fontSize: '13px', fontWeight: '600', textAlign: 'center' }}>
              📡 You're offline — showing your last saved trip. Changes won't save until you're back online.
            </div>
          )}

          <div style={{ background: 'white', borderRadius: '20px', padding: '6px', boxShadow: '0 8px 24px rgba(28,25,23,0.1)', display: 'flex', gap: '4px', marginBottom: '20px' }}>
            <button style={tabStyle(activeTab === 'master')} onClick={() => setActiveTab('master')}>🗺️ Itinerary</button>
            <button style={tabStyle(activeTab === 'plan')} onClick={() => setActiveTab('plan')}>📝 Plan</button>
            <button style={tabStyle(activeTab === 'map')} onClick={() => setActiveTab('map')}>🌐 Map</button>
            <button style={tabStyle(activeTab === 'settleup')} onClick={() => setActiveTab('settleup')}>💰 Settle Up</button>
          </div>

          {activeTab === 'master' && (
            <>
              <button onClick={syncMyCalendar} disabled={syncingCalendar} style={{
                width: '100%', padding: '12px', border: `1.5px solid ${CARD_BORDER}`, borderRadius: '14px',
                background: 'white', color: ACCENT_TEXT, fontSize: '13px', fontWeight: '700', cursor: syncingCalendar ? 'default' : 'pointer',
                fontFamily: FONT, marginBottom: '14px', opacity: syncingCalendar ? 0.6 : 1
              }}>
                {syncingCalendar ? 'Syncing…' : '📅 Sync my Calendar'}
              </button>
              <div style={{ background: '#F0EFEA', borderRadius: '14px', padding: '4px', display: 'flex', gap: '4px', marginBottom: '28px' }}>
                {['group', 'personal', 'bookings', 'suggestions'].map(view => (
                  <button key={view} onClick={() => setMasterView(view)} style={subToggleStyle(masterView === view)}>
                    {view === 'group' ? 'Group view' : view === 'personal' ? 'My view' : view === 'bookings' ? 'Bookings' : 'Suggestions'}
                  </button>
                ))}
              </div>
              {masterView === 'suggestions' ? (
                (() => {
                  const CLUSTER_KM = 1.5   // suggestions closer than this get grouped together
                  const NEARBY_BOOKED_KM = 10 // worth flagging as "near your [day] plans" within this range

                  const allSuggested = items.filter(i => i.status === 'suggested')
                  if (allSuggested.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '48px 24px', color: MUTED, fontSize: '14px', background: 'white', borderRadius: '24px' }}>
                        <div style={{ fontSize: '32px', marginBottom: '12px' }}>💡</div>
                        No suggestions yet — set an item's status to "Suggested" to see it here.
                      </div>
                    )
                  }

                  const withGeo = allSuggested
                    .filter(i => i.address && geoCache[i.address])
                    .map(i => ({ ...i, _geo: geoCache[i.address] }))
                  const withoutGeo = allSuggested.filter(i => !i.address || !geoCache[i.address])

                  const bookedWithGeo = items
                    .filter(i => i.status === 'booked' && i.address && geoCache[i.address] && getItemDayKey(i))
                    .map(i => ({ ...i, _geo: geoCache[i.address], _day: getItemDayKey(i) }))

                  function nearestBookedNote(geo) {
                    let best = null
                    bookedWithGeo.forEach(b => {
                      const d = haversineKm(geo, b._geo)
                      if (d <= NEARBY_BOOKED_KM && (!best || d < best.dist)) best = { dist: d, item: b }
                    })
                    if (!best) return null
                    const distLabel = best.dist < 1 ? `${Math.round(best.dist * 1000)}m` : `${best.dist.toFixed(1)}km`
                    return `📍 ~${distLabel} from your ${formatDate(best.item._day)} plans (${best.item.title})`
                  }

                  // Greedy proximity clustering: each unclustered suggestion seeds a
                  // new group, pulling in every other unclustered one within range.
                  const clusters = []
                  const used = new Set()
                  withGeo.forEach((item, i) => {
                    if (used.has(i)) return
                    const cluster = [item]
                    used.add(i)
                    withGeo.forEach((other, j) => {
                      if (used.has(j)) return
                      if (haversineKm(item._geo, other._geo) <= CLUSTER_KM) {
                        cluster.push(other)
                        used.add(j)
                      }
                    })
                    clusters.push(cluster)
                  })

                  return (
                    <>
                      {clusters.map((cluster, ci) => (
                        <div key={ci} style={{ marginBottom: '28px' }}>
                          <h3 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px', textAlign: 'center' }}>
                            📍 {cluster.length > 1 ? `${cluster.length} suggestions within ~${CLUSTER_KM}km of each other` : cluster[0].address}
                          </h3>
                          {cluster.map((item, idx) => {
                            const note = nearestBookedNote(item._geo)
                            return (
                              <div key={idx}>
                                {renderCard(item, `sugg-${ci}-${idx}`, true)}
                                {note && <p style={{ fontSize: '12px', color: ACCENT_TEXT, margin: '-8px 0 14px', paddingLeft: '4px' }}>{note}</p>}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                      {withoutGeo.length > 0 && (
                        <div style={{ marginBottom: '28px' }}>
                          <h3 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px', textAlign: 'center' }}>
                            📍 No location set
                          </h3>
                          {withoutGeo.map((item, idx) => renderCard(item, `sugg-noloc-${idx}`, true))}
                        </div>
                      )}
                    </>
                  )
                })()
              ) : masterDates.length === 0 && masterTimeline.undated.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: MUTED, fontSize: '14px', background: 'white', borderRadius: '24px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗺️</div>
                  {masterView === 'personal' ? 'Nothing assigned to you yet.' : masterView === 'bookings' ? 'Nothing booked yet — confirmed items will show up here.' : 'No itinerary or bookings yet — add items to get started!'}
                </div>
              ) : (
                <>
                  {masterTimeline.undated.length > 0 && (
                    <div style={{ marginBottom: '28px' }}>
                      <h3 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px', textAlign: 'center' }}>💵 New Expenses</h3>
                      {masterTimeline.undated.map((item, idx) => renderCard(item, `undated-${idx}`, true))}
                    </div>
                  )}
                  {(() => {
                    const todayKey = new Date().toISOString().split('T')[0]
                    const effectiveDay = (selectedDay && (selectedDay === 'ALL' || masterDates.includes(selectedDay))) ? selectedDay
                      : (masterDates.includes(todayKey) ? todayKey : masterDates[0])
                    const showingAll = effectiveDay === 'ALL'
                    const daysToRender = showingAll ? masterDates : [effectiveDay]
                    return (
                      <>
                        {masterDates.length > 1 && (
                          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '18px', WebkitOverflowScrolling: 'touch' }}>
                            <button onClick={() => setSelectedDay('ALL')} style={{
                              flexShrink: 0, padding: '8px 14px', borderRadius: '999px', cursor: 'pointer', fontFamily: FONT,
                              border: showingAll ? 'none' : `1.5px solid ${CARD_BORDER}`,
                              background: showingAll ? '#4A1F30' : 'white',
                              color: showingAll ? 'white' : INK,
                              fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap'
                            }}>
                              Full Itinerary
                            </button>
                            {masterDates.map(date => {
                              const isToday = date === todayKey
                              const isActive = date === effectiveDay
                              const shortLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
                              return (
                                <button key={date} onClick={() => setSelectedDay(date)} style={{
                                  flexShrink: 0, padding: '8px 14px', borderRadius: '999px', cursor: 'pointer', fontFamily: FONT,
                                  border: isActive ? 'none' : `1.5px solid ${CARD_BORDER}`,
                                  background: isActive ? '#4A1F30' : 'white',
                                  color: isActive ? 'white' : INK,
                                  fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap'
                                }}>
                                  {shortLabel}{isToday ? ' · Today' : ''}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {daysToRender.map(day => {
                          const plannedInDay = masterGrouped[day].filter(i => !isUntimedSuggestion(i))
                          const suggestedInDay = masterGrouped[day].filter(i => isUntimedSuggestion(i))
                          return (
                            <div key={day} style={{ marginBottom: '28px' }}>
                              <h3 style={{ fontSize: '22px', fontWeight: '800', color: '#4A1F30', margin: '0 0 14px', textAlign: 'left', paddingBottom: '8px', borderBottom: '2px solid #4A1F30' }}>{formatDate(day)}</h3>
                              {plannedInDay.map((item, idx) => renderCard(item, `${day}-planned-${idx}`, true, plannedInDay))}
                              {suggestedInDay.length > 0 && (
                                <>
                                  <h4 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, margin: plannedInDay.length > 0 ? '18px 0 10px' : '0 0 10px' }}>💡 Suggestions:</h4>
                                  {suggestedInDay.map((item, idx) => renderCard(item, `${day}-suggested-${idx}`, true, suggestedInDay))}
                                </>
                              )}
                            </div>
                          )
                        })}
                      </>
                    )
                  })()}
                </>
              )}
            </>
          )}

          {activeTab === 'plan' && (
            <>
              <div ref={editFormRef} style={{ background: 'white', borderRadius: '24px', padding: '24px', marginBottom: '28px', boxShadow: '0 1px 3px rgba(28,25,23,0.05)' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '800', color: INK, margin: '0 0 16px' }}>
                  {editingItem ? '✏️ Edit item' : '＋ Add to trip'}
                </h2>

                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Type</label>
                  <select value={newType} onChange={e => setNewType(e.target.value)} style={inputStyle}>
                    {Object.entries(TYPE_CONFIG).filter(([k]) => k !== 'expense').map(([k, cfg]) => <option key={k} value={k}>{cfg.label}</option>)}
                  </select>
                </div>

                <input placeholder="Title" value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputStyle, marginBottom: '10px' }} />

                {TYPE_CONFIG[newType]?.timing === 'single' && (
                  <>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Date</label>
                      <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={dateTimeInputStyle} />
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Start time</label>
                        <input type="time" value={newStartTime} onChange={e => setNewStartTime(e.target.value)} style={dateTimeInputStyle} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>End time</label>
                        <input type="time" value={newEndTime} onChange={e => setNewEndTime(e.target.value)} style={dateTimeInputStyle} />
                      </div>
                    </div>
                  </>
                )}

                {TYPE_CONFIG[newType]?.timing === 'stay' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>{TYPE_CONFIG[newType].inLabel}</label>
                      <input type="datetime-local" value={newCheckIn} onChange={e => setNewCheckIn(e.target.value)} style={dateTimeInputStyle} />
                    </div>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>{TYPE_CONFIG[newType].outLabel}</label>
                      <input type="datetime-local" value={newCheckOut} onChange={e => setNewCheckOut(e.target.value)} style={dateTimeInputStyle} />
                    </div>
                  </div>
                )}

                {TYPE_CONFIG[newType]?.timing === 'flight' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Departs from</label>
                      <input placeholder="ORD" value={newDeparture} onChange={e => setNewDeparture(e.target.value)} style={{ ...inputStyle, marginBottom: '8px' }} />
                      <input type="datetime-local" value={newCheckIn} onChange={e => setNewCheckIn(e.target.value)} style={dateTimeInputStyle} />
                    </div>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Arrives at</label>
                      <input placeholder="LAS" value={newArrival} onChange={e => setNewArrival(e.target.value)} style={{ ...inputStyle, marginBottom: '8px' }} />
                      <input type="datetime-local" value={newCheckOut} onChange={e => setNewCheckOut(e.target.value)} style={dateTimeInputStyle} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Status</label>
                    <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={inputStyle}>
                      <option value="suggested">💡 Suggested</option>
                      <option value="booked">✅ Booked</option>
                    </select>
                  </div>
                  {TYPE_CONFIG[newType]?.confirmation && (
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Confirmation #</label>
                      <input value={newConfirmation} onChange={e => setNewConfirmation(e.target.value)} style={inputStyle} />
                    </div>
                  )}
                </div>

                <AddressInput
                  placeholder="📍 Address (optional) — start typing"
                  value={newAddress}
                  onChange={val => { setNewAddress(val); setNewItemTimezone('') }}
                  onPlaceSelected={({ lat, lng }) => {
                    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
                    if (!apiKey) return
                    const timestamp = Math.floor(Date.now() / 1000)
                    fetch(`https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${apiKey}`)
                      .then(r => r.json())
                      .then(data => { if (data.status === 'OK' && data.timeZoneId) setNewItemTimezone(data.timeZoneId) })
                      .catch(err => console.error('Item timezone lookup failed:', err))
                  }}
                  style={{ ...inputStyle, marginBottom: '4px' }}
                />

                {TYPE_CONFIG[newType]?.timing !== 'none' && (
                  <div style={{ marginBottom: '10px' }}>
                    {showItemTimezoneField ? (
                      <>
                        <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>
                          Timezone for this stop {newItemTimezone && <span style={{ color: TEAL }}>· detected from address</span>}
                        </label>
                        <select value={newItemTimezone || selectedTrip.timezone} onChange={e => setNewItemTimezone(e.target.value)} style={inputStyle}>
                          {ALL_TIMEZONES.map(tz => <option key={tz} value={tz}>{timezoneLabel(tz)}</option>)}
                        </select>
                      </>
                    ) : (
                      <button onClick={() => setShowItemTimezoneField(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '11px', color: MUTED, textAlign: 'left' }}>
                        🕒 Timezone: <span style={{ fontWeight: '600', color: INK }}>{timezoneLabel(newItemTimezone || selectedTrip.timezone)}</span>
                        {newItemTimezone && newItemTimezone !== selectedTrip.timezone && <span style={{ color: TEAL }}> · detected from address</span>}
                        <span style={{ textDecoration: 'underline', marginLeft: '6px' }}>change</span>
                      </button>
                    )}
                  </div>
                )}

                <textarea placeholder="📝 Notes (optional)" value={newNotes} onChange={e => setNewNotes(e.target.value)} style={{ ...inputStyle, marginBottom: '12px', minHeight: '70px', resize: 'vertical' }} />

                {TYPE_CONFIG[newType]?.confirmation && (
                  <div style={sectionBox}>
                    <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '8px' }}>Who is this for?</label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      {members.map(m => memberChip(newTravelerUserId === m.user_id, () => { setNewTravelerUserId(m.user_id); setNewTravelerName(m.display_name) }, m.user_id === user.id ? 'Me' : m.display_name))}
                    </div>
                    <input placeholder="Or type a name (non-member)" value={newTravelerName} onChange={e => { setNewTravelerName(e.target.value); setNewTravelerUserId('') }} style={{ ...inputStyle, fontSize: '13px' }} />
                  </div>
                )}

                <div style={{ ...sectionBox, marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: newIsPrepaid ? '14px' : '0' }}>
                    <input type="checkbox" id="isPrepaid" checked={newIsPrepaid} onChange={e => setNewIsPrepaid(e.target.checked)} />
                    <label htmlFor="isPrepaid" style={{ fontSize: '14px', color: INK, cursor: 'pointer', fontWeight: '600' }}>💳 This was pre-paid</label>
                  </div>
                  {newIsPrepaid && (
                    <>
                      <div style={sectionBox}>
                        <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '8px' }}>Who paid?</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {members.map(m => memberChip(newPaidBy === m.user_id, () => setNewPaidBy(m.user_id), m.user_id === user.id ? 'Me' : m.display_name))}
                        </div>
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '5px' }}>Total cost</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input type="number" placeholder="0.00" value={newCost} onChange={e => setNewCost(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                          <select value={newCostCurrency} onChange={e => setNewCostCurrency(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                          </select>
                        </div>
                        {usdEquivalent(parseFloat(newCost), newCostCurrency) && (
                          <p style={{ fontSize: '11px', color: TEAL, margin: '4px 0 0' }}>≈ ${usdEquivalent(parseFloat(newCost), newCostCurrency)} USD</p>
                        )}
                      </div>
                      {splitSection(newSplitType, setNewSplitType, newSplitMethod, setNewSplitMethod, newSelectedMembers, setNewSelectedMembers, newCustomAmounts, setNewCustomAmounts, newCost, getItemEvenAmount(), getItemSplitMembers, newIsPrivate, setNewIsPrivate)}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  {editingItem && <button onClick={resetItemForm} style={{ flex: 1, padding: '13px', border: `1.5px solid ${CARD_BORDER}`, borderRadius: '14px', background: 'white', color: '#57534e', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT }}>Cancel</button>}
                  <button onClick={saveItem} style={{ flex: 2, padding: '13px', border: 'none', borderRadius: '14px', background: ACCENT, color: 'white', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT }}>
                    {editingItem ? 'Save changes' : 'Add to trip'}
                  </button>
                </div>
              </div>

              {undatedItems.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px', textAlign: 'center' }}>💵 New Expenses</h3>
                  {undatedItems.map(item => renderCard(item, item.id))}
                </div>
              )}

              {itineraryDates.length === 0 && undatedItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: MUTED, fontSize: '14px', background: 'white', borderRadius: '24px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗓️</div>
                  No items yet!
                </div>
              ) : (
                itineraryDates.map(date => (
                  <div key={date} style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px', textAlign: 'center' }}>{formatDate(date)}</h3>
                    {itineraryGrouped[date].map(item => renderCard(item, item.id))}
                  </div>
                ))
              )}

              {bookings.length > 0 && (
                <div style={{ marginTop: '32px' }}>
                  <h3 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px', textAlign: 'center' }}>📦 Older bookings (view only)</h3>
                  {bookings.map((b, idx) => renderCard({ ...b, _source: 'booking' }, `legacy-${idx}`))}
                </div>
              )}
            </>
          )}

          {activeTab === 'map' && <MapTab items={mapItems} />}

          {activeTab === 'settleup' && (
            <>
              <div style={{ background: BG_GRADIENT, borderRadius: '24px', padding: '24px', marginBottom: '20px', textAlign: 'center', position: 'relative' }}>
                <button onClick={() => setShowAddExpense(v => !v)} title="Add an expense" style={{
                  position: 'absolute', top: '16px', right: '16px',
                  width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                  background: 'rgba(255,255,255,0.25)', color: 'white', fontSize: '18px', fontWeight: '700', cursor: 'pointer', lineHeight: 1
                }}>
                  {showAddExpense ? '×' : '+'}
                </button>
                <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '13px', margin: '0 0 4px' }}>
                  {myNet > 0.01 ? "You're owed overall" : myNet < -0.01 ? 'You owe overall' : "You're settled up"}
                </p>
                <p style={{ color: 'white', fontSize: '32px', fontWeight: '800', margin: 0 }}>${Math.abs(myNet).toFixed(2)}</p>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px', margin: '6px 0 0' }}>Total trip spend: ${totalTripSpend.toFixed(2)}</p>
              </div>

              {showAddExpense && (
                <div style={{ background: 'white', borderRadius: '24px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(28,25,23,0.05)' }}>
                  <input placeholder="What was it for? (e.g. Uber to the club)" value={expTitle} onChange={e => setExpTitle(e.target.value)} style={{ ...inputStyle, marginBottom: '10px' }} />
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                    <input type="number" placeholder="Total cost" value={expCost} onChange={e => setExpCost(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                    <select value={expCostCurrency} onChange={e => setExpCostCurrency(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                  </div>
                  {usdEquivalent(parseFloat(expCost), expCostCurrency) && (
                    <p style={{ fontSize: '11px', color: TEAL, margin: '0 0 10px' }}>≈ ${usdEquivalent(parseFloat(expCost), expCostCurrency)} USD</p>
                  )}
                  {!usdEquivalent(parseFloat(expCost), expCostCurrency) && <div style={{ marginBottom: '10px' }} />}
                  <div style={sectionBox}>
                    <label style={{ fontSize: '11px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '8px' }}>Who paid?</label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {members.map(m => memberChip(expPaidBy === m.user_id, () => setExpPaidBy(m.user_id), m.user_id === user.id ? 'Me' : m.display_name))}
                    </div>
                  </div>
                  {splitSection(expSplitType, setExpSplitType, expSplitMethod, setExpSplitMethod, expSelectedMembers, setExpSelectedMembers, expCustomAmounts, setExpCustomAmounts, expCost, getExpEvenAmount(), getExpSplitMembers)}
                  <button onClick={saveExpense} style={{ width: '100%', padding: '13px', border: 'none', borderRadius: '14px', background: ACCENT, color: 'white', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT, marginTop: '4px' }}>
                    Add expense
                  </button>
                </div>
              )}

              <div style={{ background: 'white', borderRadius: '24px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(28,25,23,0.05)' }}>
                <h2 style={{ fontSize: '16px', fontWeight: '800', color: INK, margin: '0 0 14px' }}>Your balance</h2>
                {myTransfers.length === 0 ? (
                  <p style={{ fontSize: '13px', color: MUTED, margin: 0 }}>You're all settled up with everyone. 🎉</p>
                ) : (
                  myTransfers.map((t, i) => {
                    const iOwe = t.from === user.id
                    const otherUid = iOwe ? t.to : t.from
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < myTransfers.length - 1 ? `0.5px solid ${CARD_BORDER}` : 'none' }}>
                        <div>
                          <p style={{ fontWeight: '700', fontSize: '14px', color: INK, margin: '0 0 2px' }}>
                            {iOwe ? `You owe ${getMemberName(otherUid)}` : `${getMemberName(otherUid)} owes you`}
                          </p>
                          <p style={{ fontSize: '12px', color: MUTED, margin: 0 }}>${t.amount.toFixed(2)}</p>
                        </div>
                        <button onClick={() => markTransferPaid(t.from, t.to)} style={{ padding: '8px 14px', border: 'none', borderRadius: '999px', background: ACCENT, color: 'white', fontSize: '12px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: FONT }}>
                          Mark paid ✓
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              {otherTransfers.length > 0 && (
                <div style={{ background: 'white', borderRadius: '24px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(28,25,23,0.05)' }}>
                  <h2 style={{ fontSize: '15px', fontWeight: '800', color: INK, margin: '0 0 14px' }}>Rest of the group</h2>
                  {otherTransfers.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < otherTransfers.length - 1 ? `0.5px solid ${CARD_BORDER}` : 'none' }}>
                      <p style={{ fontSize: '13px', color: '#57534e', margin: 0 }}>{getMemberName(t.from)} → {getMemberName(t.to)}</p>
                      <p style={{ fontSize: '13px', color: MUTED, margin: 0 }}>${t.amount.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: 'white', borderRadius: '24px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(28,25,23,0.05)' }}>
                <button onClick={() => setShowCountedItems(v => !v)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <h2 style={{ fontSize: '15px', fontWeight: '800', color: INK, margin: 0 }}>What's counted ({breakdown.length})</h2>
                  <span style={{ color: MUTED, fontSize: '13px' }}>{showCountedItems ? '▲ Hide' : '▼ Show'}</span>
                </button>
                {showCountedItems && (
                  <div style={{ marginTop: '14px' }}>
                    {breakdown.length === 0 ? (
                      <p style={{ fontSize: '13px', color: MUTED, margin: 0 }}>Nothing outstanding right now.</p>
                    ) : (
                      breakdown.map((row, i) => (
                        <div key={i} style={{ padding: '8px 0', borderBottom: i < breakdown.length - 1 ? `0.5px solid ${CARD_BORDER}` : 'none' }}>
                          <p style={{ fontSize: '13px', color: INK, margin: '0 0 2px', fontWeight: '600' }}>{row.title}</p>
                          <p style={{ fontSize: '12px', color: MUTED, margin: 0 }}>{getMemberName(row.debtor)} owes {getMemberName(row.creditor)} · ${row.amount.toFixed(2)}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {undatedItems.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '11px', fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px', textAlign: 'center' }}>New Expenses</h3>
                  {undatedItems.map(item => renderCard(item, item.id))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: FONT }}>
      <div style={{ background: BG_GRADIENT, padding: 'max(50px, calc(32px + env(safe-area-inset-top))) 24px 48px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ fontSize: '22px', lineHeight: '28px' }}>✈️</span>
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'white', margin: '0 0 2px' }}>Trip Planner</h1>
              <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', margin: 0 }}>Hey, {user.user_metadata.full_name?.split(' ')[0]}!</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '15px' }}>
              {user.user_metadata.full_name?.charAt(0)}
            </div>
            <button onClick={signOut} style={{ padding: '8px 16px', border: '1px solid rgba(255,255,255,0.35)', borderRadius: '999px', background: 'rgba(255,255,255,0.18)', color: 'white', fontSize: '13px', cursor: 'pointer', fontWeight: '600', fontFamily: FONT }}>Sign out</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '520px', margin: '-24px auto 0', padding: '0 24px 32px' }}>
        {joinMessage && (
          <div style={{ background: '#E0F2F4', border: `1px solid ${TEAL}`, borderRadius: '14px', padding: '14px 18px', marginBottom: '24px', color: '#0B4F5C', fontSize: '14px', fontWeight: '600' }}>
            🎉 {joinMessage}
          </div>
        )}
        <div style={{ background: 'white', borderRadius: '24px', padding: '28px', marginBottom: '32px', boxShadow: '0 8px 24px rgba(28,25,23,0.1)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '800', color: INK, margin: '0 0 20px' }}>
            {editingTrip ? '✏️ Edit trip' : '＋ Create a new trip'}
          </h2>
          <input placeholder="Trip name (e.g. Azores Girls Trip)" value={tripName} onChange={e => setTripName(e.target.value)} style={{ ...inputStyle, marginBottom: '12px' }} />
          <AddressInput
            placeholder="Destination (e.g. São Miguel, Azores)"
            value={destination}
            onChange={val => { setDestination(val); setTimezoneAuto(false) }}
            onPlaceSelected={({ lat, lng }) => detectTimezoneForDestination(lat, lng)}
            style={{ ...inputStyle, marginBottom: '12px' }}
          />
          <div style={{ marginBottom: '12px' }}>
            {showTimezoneField ? (
              <>
                <label style={{ fontSize: '12px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '6px' }}>
                  Destination timezone {timezoneAuto && <span style={{ color: TEAL }}>· auto-detected</span>}
                </label>
                <select value={timezone} onChange={e => { setTimezone(e.target.value); setTimezoneAuto(false) }} style={inputStyle}>
                  {ALL_TIMEZONES.map(tz => <option key={tz} value={tz}>{timezoneLabel(tz)}</option>)}
                </select>
              </>
            ) : (
              <button onClick={() => setShowTimezoneField(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px', color: MUTED, textAlign: 'left' }}>
                🕒 Timezone: <span style={{ fontWeight: '600', color: INK }}>{timezoneLabel(timezone)}</span>
                {timezoneAuto && <span style={{ color: TEAL }}> · auto-detected</span>}
                <span style={{ textDecoration: 'underline', marginLeft: '6px' }}>change</span>
              </button>
            )}
          </div>
          <div style={{ marginBottom: '20px', width: '100%' }}>
            <div style={{ marginBottom: '12px', width: '100%' }}>
              <label style={{ fontSize: '12px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '6px' }}>Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={dateTimeInputStyle} />
            </div>
            <div style={{ width: '100%' }}>
              <label style={{ fontSize: '12px', color: MUTED, fontWeight: '600', display: 'block', marginBottom: '6px' }}>End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={dateTimeInputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            {editingTrip && <button onClick={cancelEditTrip} style={{ flex: 1, padding: '14px', border: `1.5px solid ${CARD_BORDER}`, borderRadius: '16px', background: 'white', color: '#57534e', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT }}>Cancel</button>}
            <button onClick={createTrip} style={{ flex: editingTrip ? 2 : 1, width: editingTrip ? 'auto' : '100%', padding: '14px', border: 'none', borderRadius: '16px', background: ACCENT, color: 'white', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: FONT }}>
              {editingTrip ? 'Save changes' : 'Create trip'}
            </button>
          </div>
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: '800', color: INK, margin: '0 0 16px' }}>Your trips</h2>
        {trips.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: MUTED, fontSize: '14px', background: 'white', borderRadius: '24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗺️</div>
            No trips yet — create your first one above!
          </div>
        ) : (
          trips.map(trip => (
            <div key={trip.id} style={{ position: 'relative', marginBottom: '12px' }}>
              <div onClick={() => setSelectedTrip(trip)} style={{ background: BG_GRADIENT, borderRadius: '24px', padding: '28px 24px', boxShadow: '0 8px 24px rgba(255,90,95,0.25)', textAlign: 'center', cursor: 'pointer' }}>
                <p style={{ fontWeight: '800', fontSize: '22px', color: 'white', margin: '0 0 6px', padding: '0 22px' }}>{trip.name}</p>
                <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', margin: '0 0 6px' }}>📍 {trip.destination}</p>
                {trip.start_date && (
                  <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', margin: 0 }}>
                    {new Date(trip.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {trip.end_date && ` → ${new Date(trip.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  </p>
                )}
              </div>
              <button onClick={e => { e.stopPropagation(); deleteTrip(trip.id) }} style={{ position: 'absolute', top: '14px', left: '14px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: '16px', cursor: 'pointer', padding: '4px', lineHeight: 1 }} title="Delete trip">✕</button>
              <button onClick={e => { e.stopPropagation(); startEditTrip(trip) }} style={{ position: 'absolute', top: '14px', right: '14px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: '16px', cursor: 'pointer', padding: '4px', lineHeight: 1 }} title="Edit trip">✏️</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App
