import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const GRADIENT = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
const FONT = "'Inter', 'Helvetica Neue', sans-serif"

const ITEM_TYPES = [
  { value: 'activity', label: '🏄 Activity' },
  { value: 'food', label: '🍽️ Food' },
  { value: 'hotel', label: '🏨 Hotel' },
  { value: 'travel', label: '✈️ Travel' },
  { value: 'note', label: '📝 Note' },
]

const BOOKING_CATEGORIES = [
  { value: 'flight', label: '✈️ Flight' },
  { value: 'hotel', label: '🏨 Hotel' },
  { value: 'car', label: '🚗 Car rental' },
  { value: 'excursion', label: '🎟️ Excursion' },
  { value: 'other', label: '📦 Other' },
]

function bookingBorderColor(booking, userId) {
  if (booking.split_type === 'equal' || booking.split_type === 'some') return '#1D9E75'
  if (booking.is_private) return '#B4B2A9'
  if (booking.booked_by === userId) return '#7F77DD'
  return '#378ADD'
}

function bookingBadge(booking, userId) {
  if (booking.split_type === 'solo' && booking.is_private) return { label: '🔒 Private', bg: '#F1EFE8', color: '#5F5E5A' }
  if (booking.split_type === 'solo') return { label: '👤 Solo', bg: '#EEEDFE', color: '#534AB7' }
  return { label: '👥 Group', bg: '#E1F5EE', color: '#0F6E56' }
}

function App() {
  const [user, setUser] = useState(null)
  const [trips, setTrips] = useState([])
  const [selectedTrip, setSelectedTrip] = useState(null)
  const [activeTab, setActiveTab] = useState('master')
  const [masterView, setMasterView] = useState('group')
  const [tripName, setTripName] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [joinMessage, setJoinMessage] = useState('')

  const [items, setItems] = useState([])
  const [editingItem, setEditingItem] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newType, setNewType] = useState('activity')
  const [newStartTime, setNewStartTime] = useState('')
  const [newEndTime, setNewEndTime] = useState('')
  const [newStatus, setNewStatus] = useState('suggested')
  const [newNotes, setNewNotes] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newIsPrepaid, setNewIsPrepaid] = useState(false)
  const [newCost, setNewCost] = useState('')
  const [newPaidBy, setNewPaidBy] = useState('')
  const [newSplitType, setNewSplitType] = useState('all')
  const [newSplitMethod, setNewSplitMethod] = useState('even')
  const [newSelectedMembers, setNewSelectedMembers] = useState([])
  const [newCustomAmounts, setNewCustomAmounts] = useState({})

  const [bookings, setBookings] = useState([])
  const [editingBooking, setEditingBooking] = useState(null)
  const [members, setMembers] = useState([])
  const [bTitle, setBTitle] = useState('')
  const [bCategory, setBCategory] = useState('flight')
  const [bConfirmation, setBConfirmation] = useState('')
  const [bCost, setBCost] = useState('')
  const [bPaidBy, setBPaidBy] = useState('')
  const [bSplitType, setBSplitType] = useState('all')
  const [bSplitMethod, setBSplitMethod] = useState('even')
  const [bSelectedMembers, setBSelectedMembers] = useState([])
  const [bCustomAmounts, setBCustomAmounts] = useState({})
  const [bCheckIn, setBCheckIn] = useState('')
  const [bCheckOut, setBCheckOut] = useState('')
  const [bNotes, setBNotes] = useState('')
  const [bTravelerName, setBTravelerName] = useState('')
  const [bTravelerUserId, setBTravelerUserId] = useState('')
  const [bIsPrivate, setBIsPrivate] = useState(false)

  const [splits, setSplits] = useState([])
  const [iSplits, setISplits] = useState([])
  const [logisticsFilter, setLogisticsFilter] = useState('all')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
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
    const { data: ownedTrips } = await supabase.from('trips').select('*').eq('created_by', user.id)
    const { data: memberTrips } = await supabase.from('trip_members').select('trip_id').eq('user_id', user.id)
    let sharedTrips = []
    if (memberTrips?.length > 0) {
      const { data } = await supabase.from('trips').select('*').in('id', memberTrips.map(m => m.trip_id))
      sharedTrips = data || []
    }
    const allTrips = [...(ownedTrips || []), ...sharedTrips]
    setTrips(allTrips.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i))
  }

  async function fetchMembers(tripId) {
    const { data: memberRows } = await supabase.from('trip_members').select('user_id').eq('trip_id', tripId)
    const { data: tripData } = await supabase.from('trips').select('created_by').eq('id', tripId).single()
    const allIds = [...new Set([...(memberRows || []).map(m => m.user_id), tripData?.created_by].filter(Boolean))]
    const list = allIds.map(uid => ({
      user_id: uid,
      display_name: uid === user.id ? user.user_metadata?.full_name || 'You' : `Member (${uid.slice(0, 6)})`
    }))
    setMembers(list)
    setBPaidBy(user.id)
    setNewPaidBy(user.id)
    setBSelectedMembers(allIds)
    setNewSelectedMembers(allIds)
  }

  async function fetchItems(tripId) {
    const { data, error } = await supabase.from('itinerary_items').select('*').eq('trip_id', tripId).order('day_date').order('start_time')
    if (!error) setItems(data)
  }

  async function fetchBookings(tripId) {
    const { data, error } = await supabase.from('bookings').select('*').eq('trip_id', tripId).order('created_at')
    if (!error) setBookings(data)
  }

  async function fetchSplits(tripId) {
    const { data: bRows } = await supabase.from('bookings').select('id').eq('trip_id', tripId)
    if (!bRows?.length) { setSplits([]); return }
    const { data, error } = await supabase.from('booking_splits').select('*').in('booking_id', bRows.map(b => b.id))
    if (!error) setSplits(data || [])
  }

  async function fetchISplits(tripId) {
    const { data: iRows } = await supabase.from('itinerary_items').select('id').eq('trip_id', tripId)
    if (!iRows?.length) { setISplits([]); return }
    const { data, error } = await supabase.from('itinerary_splits').select('*').in('item_id', iRows.map(i => i.id))
    if (!error) setISplits(data || [])
  }

  async function createTrip() {
    if (!tripName || !destination) return
    const { data, error } = await supabase.from('trips').insert({
      name: tripName, destination, start_date: startDate || null, end_date: endDate || null, created_by: user.id
    }).select().single()
    if (!error && data) {
      await supabase.from('trip_members').insert({ trip_id: data.id, user_id: user.id, role: 'owner' })
      setTripName(''); setDestination(''); setStartDate(''); setEndDate('')
      fetchTrips()
    }
  }

  async function deleteTrip(tripId) {
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
    setNewTitle(''); setNewDate(''); setNewType('activity')
    setNewStartTime(''); setNewEndTime(''); setNewStatus('suggested')
    setNewNotes(''); setNewAddress('')
    setNewIsPrepaid(false); setNewCost(''); setNewPaidBy(user.id)
    setNewSplitType('all'); setNewSplitMethod('even')
    setNewSelectedMembers(members.map(m => m.user_id)); setNewCustomAmounts({})
  }

  function startEditItem(item) {
    setEditingItem(item)
    setNewTitle(item.title); setNewDate(item.day_date); setNewType(item.type)
    setNewStartTime(item.start_time || ''); setNewEndTime(item.end_time || '')
    setNewStatus(item.status); setNewNotes(item.notes || ''); setNewAddress(item.address || '')
    setNewIsPrepaid(item.is_prepaid || false); setNewCost(item.cost || '')
    setNewPaidBy(item.paid_by || user.id)
    setNewSplitType(item.split_type === 'solo' ? 'solo' : item.split_type === 'equal' ? 'all' : 'some')
    setNewSplitMethod(item.split_method || 'even')
    setNewSelectedMembers(item.split_members || members.map(m => m.user_id))
    setNewCustomAmounts(item.custom_amounts || {})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveItem() {
    if (!newTitle || !newDate) return
    const cost = newCost ? parseFloat(newCost) : null
    const splitMembers = getItemSplitMembers()

    const itemData = {
      title: newTitle, day_date: newDate, type: newType,
      status: newStatus, start_time: newStartTime || null,
      notes: newNotes || null, address: newAddress || null,
      is_prepaid: newIsPrepaid, cost: newIsPrepaid ? cost : null,
      paid_by: newIsPrepaid ? newPaidBy : null,
      split_type: newIsPrepaid ? (newSplitType === 'all' ? 'equal' : newSplitType) : 'solo',
      split_method: newIsPrepaid ? newSplitMethod : null,
      split_members: newIsPrepaid && newSplitType === 'some' ? newSelectedMembers : null,
      custom_amounts: newIsPrepaid && newSplitMethod === 'custom' ? newCustomAmounts : null
    }

    if (editingItem) {
      await supabase.from('itinerary_items').update(itemData).eq('id', editingItem.id)
      if (newIsPrepaid && cost && splitMembers.length > 0) {
        await supabase.from('itinerary_splits').delete().eq('item_id', editingItem.id)
        await supabase.from('itinerary_splits').insert(splitMembers.map(uid => ({
          item_id: editingItem.id, user_id: uid,
          amount_owed: newSplitMethod === 'even' ? getItemEvenAmount() : parseFloat(newCustomAmounts[uid] || 0),
          paid: uid === newPaidBy
        })))
      }
    } else {
      const { data: newItem, error } = await supabase.from('itinerary_items').insert({
        ...itemData, trip_id: selectedTrip.id, added_by: user.id
      }).select().single()
      if (!error && newItem && newIsPrepaid && cost && splitMembers.length > 0) {
        await supabase.from('itinerary_splits').insert(splitMembers.map(uid => ({
          item_id: newItem.id, user_id: uid,
          amount_owed: newSplitMethod === 'even' ? getItemEvenAmount() : parseFloat(newCustomAmounts[uid] || 0),
          paid: uid === newPaidBy
        })))
      }
    }
    resetItemForm()
    fetchItems(selectedTrip.id)
    fetchISplits(selectedTrip.id)
  }

  async function deleteItem(itemId) {
    await supabase.from('itinerary_splits').delete().eq('item_id', itemId)
    await supabase.from('itinerary_items').delete().eq('id', itemId)
    fetchItems(selectedTrip.id)
    fetchISplits(selectedTrip.id)
  }

  function getBSplitMembers() {
    if (bSplitType === 'solo') return []
    if (bSplitType === 'all') return members.map(m => m.user_id)
    return bSelectedMembers
  }

  function getBEvenAmount() {
    const sm = getBSplitMembers()
    if (!bCost || sm.length === 0) return 0
    return parseFloat((parseFloat(bCost) / sm.length).toFixed(2))
  }

  function resetBookingForm() {
    setEditingBooking(null)
    setBTitle(''); setBCategory('flight'); setBConfirmation(''); setBCost('')
    setBPaidBy(user.id); setBSplitType('all'); setBSplitMethod('even')
    setBSelectedMembers(members.map(m => m.user_id)); setBCustomAmounts({})
    setBCheckIn(''); setBCheckOut(''); setBNotes('')
    setBTravelerName(''); setBTravelerUserId(user.id); setBIsPrivate(false)
  }

  function startEditBooking(booking) {
    setEditingBooking(booking)
    setBTitle(booking.title); setBCategory(booking.category)
    setBConfirmation(booking.confirmation || ''); setBCost(booking.total_cost || '')
    setBPaidBy(booking.paid_by || booking.booked_by)
    setBSplitType(booking.split_type === 'solo' ? 'solo' : booking.split_type === 'equal' ? 'all' : 'some')
    setBSplitMethod('even'); setBSelectedMembers(members.map(m => m.user_id))
    setBCheckIn(booking.check_in ? booking.check_in.slice(0, 16) : '')
    setBCheckOut(booking.check_out ? booking.check_out.slice(0, 16) : '')
    setBNotes(booking.notes || ''); setBTravelerName(booking.traveler_name || '')
    setBTravelerUserId(booking.traveler_user_id || user.id)
    setBIsPrivate(booking.is_private || false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveBooking() {
    if (!bTitle) return
    const cost = bCost ? parseFloat(bCost) : null
    const splitMembers = getBSplitMembers()
    const bookingData = {
      category: bCategory, title: bTitle, confirmation: bConfirmation || null,
      total_cost: cost, split_type: bSplitType === 'solo' ? 'solo' : bSplitType === 'all' ? 'equal' : 'some',
      paid_by: bPaidBy || user.id, check_in: bCheckIn || null, check_out: bCheckOut || null,
      notes: bNotes || null, traveler_name: bTravelerName || null,
      traveler_user_id: bTravelerUserId || null, is_private: bIsPrivate
    }
    if (editingBooking) {
      await supabase.from('bookings').update(bookingData).eq('id', editingBooking.id)
      if (cost && splitMembers.length > 0) {
        await supabase.from('booking_splits').delete().eq('booking_id', editingBooking.id)
        await supabase.from('booking_splits').insert(splitMembers.map(uid => ({
          booking_id: editingBooking.id, user_id: uid,
          amount_owed: bSplitMethod === 'even' ? getBEvenAmount() : parseFloat(bCustomAmounts[uid] || 0),
          paid: uid === (bPaidBy || user.id)
        })))
      }
      setEditingBooking(null)
    } else {
      const { data: booking, error } = await supabase.from('bookings').insert({
        ...bookingData, trip_id: selectedTrip.id, booked_by: user.id
      }).select().single()
      if (!error && booking && cost && splitMembers.length > 0) {
        await supabase.from('booking_splits').insert(splitMembers.map(uid => ({
          booking_id: booking.id, user_id: uid,
          amount_owed: bSplitMethod === 'even' ? getBEvenAmount() : parseFloat(bCustomAmounts[uid] || 0),
          paid: uid === (bPaidBy || user.id)
        })))
      }
    }
    resetBookingForm()
    fetchBookings(selectedTrip.id)
    fetchSplits(selectedTrip.id)
  }

  async function deleteBooking(bookingId) {
    await supabase.from('booking_splits').delete().eq('booking_id', bookingId)
    await supabase.from('bookings').delete().eq('id', bookingId)
    fetchBookings(selectedTrip.id)
    fetchSplits(selectedTrip.id)
  }

  async function markSplitPaid(splitId) {
    await supabase.from('booking_splits').update({ paid: true, paid_at: new Date().toISOString() }).eq('id', splitId)
    fetchSplits(selectedTrip.id)
  }

  async function markISplitPaid(splitId) {
    await supabase.from('itinerary_splits').update({ paid: true, paid_at: new Date().toISOString() }).eq('id', splitId)
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

  function groupByDate(arr) {
    return arr.reduce((groups, item) => {
      const date = item.day_date || item.date_key
      if (!groups[date]) groups[date] = []
      groups[date].push(item)
      return groups
    }, {})
  }

  function formatDate(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  function formatTime(t) {
    if (!t) return null
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
  }

  function typeColor(type) {
    return { activity: '#667eea', food: '#f093fb', hotel: '#4facfe', travel: '#43e97b', note: '#a8edea' }[type] || '#667eea'
  }

  function mapsLink(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
  }

  function categoryIcon(cat) {
    return { flight: '✈️', hotel: '🏨', car: '🚗', excursion: '🎟️', other: '📦' }[cat] || '📦'
  }

  function getMemberName(uid) {
    return members.find(m => m.user_id === uid)?.display_name || uid?.slice(0, 6) || 'Unknown'
  }

  function computeTransfers() {
    const balances = {}
    members.forEach(m => { balances[m.user_id] = 0 })
    splits.forEach(split => {
      if (split.paid) return
      const booking = bookings.find(b => b.id === split.booking_id)
      if (!booking) return
      const paidBy = booking.paid_by || booking.booked_by
      balances[paidBy] = (balances[paidBy] || 0) + split.amount_owed
      balances[split.user_id] = (balances[split.user_id] || 0) - split.amount_owed
    })
    iSplits.forEach(split => {
      if (split.paid) return
      const item = items.find(i => i.id === split.item_id)
      if (!item) return
      const paidBy = item.paid_by
      if (!paidBy) return
      balances[paidBy] = (balances[paidBy] || 0) + split.amount_owed
      balances[split.user_id] = (balances[split.user_id] || 0) - split.amount_owed
    })
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

  function buildMasterTimeline(view) {
    const allItems = []
    items.forEach(item => {
      if (view === 'personal') {
        const isForMe = item.added_by === user.id ||
          item.paid_by === user.id ||
          (item.split_members && item.split_members.includes(user.id)) ||
          (item.split_type === 'equal' && item.is_prepaid)
        if (!isForMe) return
      }
      allItems.push({ ...item, _source: 'itinerary', date_key: item.day_date })
    })
    bookings.forEach(booking => {
      if (booking.is_private && booking.booked_by !== user.id) return
      if (view === 'personal') {
        const isForMe = booking.booked_by === user.id ||
          booking.paid_by === user.id ||
          booking.traveler_user_id === user.id
        if (!isForMe) return
      }
      const dateKey = booking.check_in
        ? booking.check_in.slice(0, 10)
        : selectedTrip?.start_date || null
      if (!dateKey) return
      allItems.push({ ...booking, _source: 'booking', date_key: dateKey })
    })
    allItems.sort((a, b) => {
      if (a.date_key < b.date_key) return -1
      if (a.date_key > b.date_key) return 1
      const aTime = a.start_time || a.check_in?.slice(11, 16) || '00:00'
      const bTime = b.start_time || b.check_in?.slice(11, 16) || '00:00'
      return aTime.localeCompare(bTime)
    })
    return allItems
  }

  const inputStyle = {
    width: '100%', padding: '12px 16px', border: '1.5px solid #e8e8f0',
    borderRadius: '12px', fontSize: '14px', boxSizing: 'border-box',
    outline: 'none', background: '#fafafa', color: '#1a1a2e'
  }

  const tabStyle = (active) => ({
    flex: 1, padding: '9px 4px', border: 'none', borderRadius: '10px',
    background: active ? GRADIENT : 'transparent',
    color: active ? 'white' : '#888',
    fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: FONT
  })

  const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '3px 5px', lineHeight: 1 }
  const sectionBox = { background: '#f8f8ff', borderRadius: '12px', padding: '14px', marginBottom: '10px' }

  const memberChip = (selected, onClick, label) => (
    <button key={label} onClick={onClick} style={{
      padding: '7px 14px', border: `1.5px solid ${selected ? '#667eea' : '#e8e8f0'}`,
      borderRadius: '20px', background: selected ? '#EEEDFE' : 'white',
      color: selected ? '#534AB7' : '#888', fontSize: '13px', cursor: 'pointer', fontWeight: '500'
    }}>{label}</button>
  )

  const splitSection = (
    splitType, setSplitType,
    splitMethod, setSplitMethod,
    selectedMems, setSelectedMems,
    customAmounts, setCustomAmounts,
    cost, evenAmount,
    getSplitMems,
    isPrivate = null, setIsPrivate = null
  ) => (
    <div style={sectionBox}>
      <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '8px' }}>Split between</label>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {['all', 'some', 'solo'].map(type => (
          <button key={type} onClick={() => setSplitType(type)} style={{
            flex: 1, padding: '8px', border: `1.5px solid ${splitType === type ? '#667eea' : '#e8e8f0'}`,
            borderRadius: '10px', background: splitType === type ? '#EEEDFE' : 'white',
            color: splitType === type ? '#534AB7' : '#888', fontSize: '13px', cursor: 'pointer', fontWeight: '500'
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
          <label style={{ fontSize: '13px', color: '#555', cursor: 'pointer' }}>🔒 Keep private (only visible to me)</label>
        </div>
      )}
      {splitType !== 'solo' && (
        <>
          <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', margin: '10px 0 8px' }}>How to split?</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: splitMethod === 'custom' ? '10px' : '0' }}>
            {['even', 'custom'].map(method => (
              <button key={method} onClick={() => setSplitMethod(method)} style={{
                flex: 1, padding: '8px', border: `1.5px solid ${splitMethod === method ? '#667eea' : '#e8e8f0'}`,
                borderRadius: '10px', background: splitMethod === method ? '#EEEDFE' : 'white',
                color: splitMethod === method ? '#534AB7' : '#888', fontSize: '13px', cursor: 'pointer', fontWeight: '500'
              }}>
                {method === 'even' ? `⚖️ Evenly${cost ? ` ($${evenAmount}/pp)` : ''}` : '✏️ Custom'}
              </button>
            ))}
          </div>
          {splitMethod === 'custom' && (
            <div style={{ marginTop: '10px' }}>
              {getSplitMems().map(uid => (
                <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#555', minWidth: '80px' }}>{getMemberName(uid)}</span>
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
      <div style={{ minHeight: '100vh', background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <div style={{ background: 'white', borderRadius: '24px', padding: '48px', width: '100%', maxWidth: '400px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✈️</div>
          <h1 style={{ fontSize: '32px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 8px' }}>Trip Planner</h1>
          <p style={{ color: '#888', fontSize: '15px', margin: '0 0 32px' }}>Plan trips together, stress-free</p>
          <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })}
            style={{ width: '100%', padding: '14px', border: 'none', borderRadius: '12px', background: GRADIENT, color: 'white', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  if (selectedTrip) {
    const visibleBookings = bookings.filter(b => !b.is_private || b.booked_by === user.id)
    const totalCost = visibleBookings.reduce((sum, b) => sum + (b.total_cost || 0), 0)
    const transfers = computeTransfers()
    const myUnsettledBSplits = splits.filter(s => s.user_id === user.id && !s.paid)
    const myUnsettledISplits = iSplits.filter(s => s.user_id === user.id && !s.paid)
    const totalOwed = [...myUnsettledBSplits, ...myUnsettledISplits].reduce((sum, s) => sum + s.amount_owed, 0)
    const masterTimeline = buildMasterTimeline(masterView)
    const masterGrouped = groupByDate(masterTimeline)
    const masterDates = Object.keys(masterGrouped).sort()
    const filteredBookings = logisticsFilter === 'all' ? visibleBookings
      : visibleBookings.filter(b => logisticsFilter === 'booked' ? b.confirmation : !b.confirmation)

    return (
      <div style={{ minHeight: '100vh', background: '#f0f2ff', fontFamily: FONT }}>
        <div style={{ background: GRADIENT, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <button onClick={() => { setSelectedTrip(null); setActiveTab('master') }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', fontSize: '13px', cursor: 'pointer', padding: '0 0 4px', display: 'block' }}>← Back</button>
            <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'white', margin: 0 }}>{selectedTrip.name}</h1>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px', margin: 0 }}>📍 {selectedTrip.destination}</p>
          </div>
          <button onClick={() => generateInviteLink(selectedTrip.id)} style={{ padding: '7px 14px', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: '10px', background: 'transparent', color: 'white', fontSize: '12px', cursor: 'pointer' }}>
            {copiedId === selectedTrip.id ? '✅ Copied!' : '🔗 Invite'}
          </button>
        </div>

        <div style={{ background: 'white', padding: '10px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', gap: '4px', maxWidth: '560px', margin: '0 auto', background: '#f0f2ff', borderRadius: '12px', padding: '4px' }}>
            <button style={tabStyle(activeTab === 'master')} onClick={() => setActiveTab('master')}>🗺️ Master</button>
            <button style={tabStyle(activeTab === 'itinerary')} onClick={() => setActiveTab('itinerary')}>🗓️ Itinerary</button>
            <button style={tabStyle(activeTab === 'logistics')} onClick={() => setActiveTab('logistics')}>📋 Logistics</button>
            <button style={tabStyle(activeTab === 'settleup')} onClick={() => setActiveTab('settleup')}>💰 Settle Up</button>
          </div>
        </div>

        <div style={{ maxWidth: '560px', margin: '0 auto', padding: '20px 16px' }}>

          {/* MASTER TAB */}
          {activeTab === 'master' && (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', background: 'white', borderRadius: '14px', padding: '6px', boxShadow: '0 2px 12px rgba(102,126,234,0.08)' }}>
                {['group', 'personal'].map(view => (
                  <button key={view} onClick={() => setMasterView(view)} style={{
                    flex: 1, padding: '10px', border: 'none', borderRadius: '10px',
                    background: masterView === view ? GRADIENT : 'transparent',
                    color: masterView === view ? 'white' : '#888',
                    fontSize: '14px', fontWeight: '600', cursor: 'pointer', fontFamily: FONT
                  }}>
                    {view === 'group' ? '👥 Group view' : '👤 My view'}
                  </button>
                ))}
              </div>

              {masterDates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa', fontSize: '14px', background: 'white', borderRadius: '20px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗺️</div>
                  {masterView === 'personal' ? 'Nothing assigned to you yet.' : 'No itinerary or bookings yet — add items to get started!'}
                </div>
              ) : (
                masterDates.map(date => (
                  <div key={date} style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px', paddingLeft: '4px' }}>
                      {formatDate(date)}
                    </h3>
                    {masterGrouped[date].map((item, idx) => {
                      const isBooking = item._source === 'booking'
                      const borderColor = isBooking
                        ? bookingBorderColor(item, user.id)
                        : typeColor(item.type)
                      const badge = isBooking ? bookingBadge(item, user.id) : {
                        label: item.status === 'booked' ? '✅ Booked' : '💡 Suggested',
                        bg: item.status === 'booked' ? '#e8f5e9' : '#fff8e1',
                        color: item.status === 'booked' ? '#2e7d32' : '#f57f17'
                      }
                      return (
                        <div key={idx} style={{ background: 'white', borderRadius: '16px', padding: '14px 18px', marginBottom: '8px', boxShadow: '0 2px 12px rgba(102,126,234,0.08)', borderLeft: `4px solid ${borderColor}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '14px' }}>
                                  {isBooking ? categoryIcon(item.category) : ITEM_TYPES.find(t => t.value === item.type)?.label.split(' ')[0]}
                                </span>
                                <p style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e', margin: 0 }}>{item.title}</p>
                              </div>
                              <p style={{ color: '#888', fontSize: '11px', margin: '0 0 3px' }}>
                                {isBooking
                                  ? item.check_in ? new Date(item.check_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''
                                  : formatTime(item.start_time)}
                                {!isBooking && item.end_time && ` – ${formatTime(item.end_time)}`}
                              </p>
                              {isBooking && item.traveler_name && (
                                <p style={{ fontSize: '11px', color: '#667eea', margin: '0 0 3px' }}>👤 {item.traveler_name}</p>
                              )}
                              {isBooking && (item.paid_by || item.booked_by) && (
                                <p style={{ fontSize: '11px', color: '#888', margin: '0 0 3px' }}>💳 Paid by: {getMemberName(item.paid_by || item.booked_by)}</p>
                              )}
                              {!isBooking && item.is_prepaid && item.cost && (
                                <p style={{ fontSize: '11px', color: '#888', margin: '0 0 3px' }}>💳 ${item.cost} · paid by {getMemberName(item.paid_by)}</p>
                              )}
                              {isBooking && item.total_cost && (
                                <p style={{ fontSize: '11px', color: '#1a1a2e', margin: '0 0 3px', fontWeight: '500' }}>${item.total_cost.toLocaleString()}</p>
                              )}
                              {item.address && (
                                <a href={mapsLink(item.address)} target="_blank" rel="noreferrer"
                                  style={{ fontSize: '11px', color: '#667eea', textDecoration: 'none' }}>
                                  📍 {item.address} ↗
                                </a>
                              )}
                            </div>
                            <span style={{ fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px', background: badge.bg, color: badge.color, flexShrink: 0, marginLeft: '8px' }}>
                              {badge.label}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </>
          )}

          {/* ITINERARY TAB */}
          {activeTab === 'itinerary' && (
            <>
              <div style={{ background: 'white', borderRadius: '20px', padding: '24px', marginBottom: '28px', boxShadow: '0 4px 24px rgba(102,126,234,0.1)' }}>
                <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 16px' }}>
                  {editingItem ? '✏️ Edit item' : '＋ Add to itinerary'}
                </h2>
                <input placeholder="What are you doing?" value={newTitle} onChange={e => setNewTitle(e.target.value)} style={{ ...inputStyle, marginBottom: '10px' }} />
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Date</label>
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Start time</label>
                    <input type="time" value={newStartTime} onChange={e => setNewStartTime(e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>End time</label>
                    <input type="time" value={newEndTime} onChange={e => setNewEndTime(e.target.value)} style={inputStyle} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Type</label>
                    <select value={newType} onChange={e => setNewType(e.target.value)} style={inputStyle}>
                      {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Status</label>
                    <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={inputStyle}>
                      <option value="suggested">💡 Suggested</option>
                      <option value="booked">✅ Booked</option>
                    </select>
                  </div>
                </div>
                <input placeholder="📍 Address (optional)" value={newAddress} onChange={e => setNewAddress(e.target.value)} style={{ ...inputStyle, marginBottom: '10px' }} />
                <textarea placeholder="📝 Notes (optional)" value={newNotes} onChange={e => setNewNotes(e.target.value)}
                  style={{ ...inputStyle, marginBottom: '12px', minHeight: '70px', resize: 'vertical', fontFamily: FONT }} />

                {/* Pre-paid toggle */}
                <div style={{ ...sectionBox, marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: newIsPrepaid ? '14px' : '0' }}>
                    <input type="checkbox" id="isPrepaid" checked={newIsPrepaid} onChange={e => setNewIsPrepaid(e.target.checked)} />
                    <label htmlFor="isPrepaid" style={{ fontSize: '14px', color: '#1a1a2e', cursor: 'pointer', fontWeight: '500' }}>
                      💳 This was pre-paid
                    </label>
                  </div>
                  {newIsPrepaid && (
                    <>
                      <div style={sectionBox}>
                        <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '8px' }}>Who paid?</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {members.map(m => memberChip(
                            newPaidBy === m.user_id,
                            () => setNewPaidBy(m.user_id),
                            m.user_id === user.id ? 'Me' : m.display_name
                          ))}
                        </div>
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Total cost ($)</label>
                        <input type="number" placeholder="0.00" value={newCost} onChange={e => setNewCost(e.target.value)} style={inputStyle} />
                      </div>
                      {splitSection(
                        newSplitType, setNewSplitType,
                        newSplitMethod, setNewSplitMethod,
                        newSelectedMembers, setNewSelectedMembers,
                        newCustomAmounts, setNewCustomAmounts,
                        newCost, getItemEvenAmount(),
                        getItemSplitMembers
                      )}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  {editingItem && <button onClick={resetItemForm} style={{ flex: 1, padding: '13px', border: '1.5px solid #e8e8f0', borderRadius: '12px', background: 'white', color: '#555', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>}
                  <button onClick={saveItem} style={{ flex: 2, padding: '13px', border: 'none', borderRadius: '12px', background: GRADIENT, color: 'white', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
                    {editingItem ? 'Save changes' : 'Add to itinerary'}
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa', fontSize: '14px', background: 'white', borderRadius: '20px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗓️</div>
                  No items yet!
                </div>
              ) : (
                Object.entries(groupByDate(items.map(i => ({ ...i, date_key: i.day_date })))).sort().map(([date, dayItems]) => (
                  <div key={date} style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px', paddingLeft: '4px' }}>
                      {formatDate(date)}
                    </h3>
                    {dayItems.map(item => (
                      <div key={item.id} style={{ background: editingItem?.id === item.id ? '#f0f2ff' : 'white', borderRadius: '16px', padding: '14px 18px', marginBottom: '8px', boxShadow: '0 2px 12px rgba(102,126,234,0.08)', borderLeft: `4px solid ${typeColor(item.type)}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e', margin: '0 0 3px' }}>{item.title}</p>
                            <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>
                              {formatTime(item.start_time)}{item.end_time && ` – ${formatTime(item.end_time)}`}
                              {item.start_time && ' · '}{ITEM_TYPES.find(t => t.value === item.type)?.label}
                            </p>
                            {item.is_prepaid && item.cost && (
                              <p style={{ fontSize: '12px', color: '#667eea', margin: '3px 0 0', fontWeight: '500' }}>
                                💳 ${item.cost} prepaid · {getMemberName(item.paid_by)}
                              </p>
                            )}
                            {item.address && (
                              <a href={mapsLink(item.address)} target="_blank" rel="noreferrer"
                                style={{ display: 'inline-block', fontSize: '12px', color: '#667eea', textDecoration: 'none', marginTop: '3px' }}>
                                📍 {item.address} ↗
                              </a>
                            )}
                            {item.notes && (
                              <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0', background: '#f8f8ff', padding: '6px 10px', borderRadius: '8px' }}>{item.notes}</p>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                            <span style={{ fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px', background: item.status === 'booked' ? '#e8f5e9' : '#fff8e1', color: item.status === 'booked' ? '#2e7d32' : '#f57f17' }}>
                              {item.status === 'booked' ? '✅ Booked' : '💡 Suggested'}
                            </span>
                            <button onClick={() => startEditItem(item)} style={{ ...iconBtn, color: '#667eea' }}>✏️</button>
                            <button onClick={() => deleteItem(item.id)} style={{ ...iconBtn, color: '#ccc' }}>✕</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </>
          )}

          {/* LOGISTICS TAB */}
          {activeTab === 'logistics' && (
            <>
              {visibleBookings.length > 0 && (
                <div style={{ background: GRADIENT, borderRadius: '16px', padding: '16px 20px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px', margin: '0 0 2px' }}>Total booked</p>
                    <p style={{ color: 'white', fontSize: '24px', fontWeight: '700', margin: 0 }}>${totalCost.toLocaleString()}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px', margin: '0 0 2px' }}>Bookings</p>
                    <p style={{ color: 'white', fontSize: '24px', fontWeight: '700', margin: 0 }}>{visibleBookings.length}</p>
                  </div>
                </div>
              )}

              {/* Filter toggles */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                {['all', 'booked', 'suggested'].map(f => (
                  <button key={f} onClick={() => setLogisticsFilter(f)} style={{
                    padding: '7px 14px', border: `1.5px solid ${logisticsFilter === f ? '#667eea' : '#e8e8f0'}`,
                    borderRadius: '20px', background: logisticsFilter === f ? '#EEEDFE' : 'white',
                    color: logisticsFilter === f ? '#534AB7' : '#888', fontSize: '12px', cursor: 'pointer', fontWeight: '500'
                  }}>
                    {f === 'all' ? '📋 All' : f === 'booked' ? '✅ Confirmed' : '💡 Unconfirmed'}
                  </button>
                ))}
              </div>

              <div style={{ background: 'white', borderRadius: '20px', padding: '24px', marginBottom: '24px', boxShadow: '0 4px 24px rgba(102,126,234,0.1)' }}>
                <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 16px' }}>
                  {editingBooking ? '✏️ Edit booking' : '＋ Add booking'}
                </h2>
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Category</label>
                  <select value={bCategory} onChange={e => setBCategory(e.target.value)} style={inputStyle}>
                    {BOOKING_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <input placeholder="Title (e.g. United ORD → PDL)" value={bTitle} onChange={e => setBTitle(e.target.value)} style={{ ...inputStyle, marginBottom: '10px' }} />
                <input placeholder="Confirmation # (optional)" value={bConfirmation} onChange={e => setBConfirmation(e.target.value)} style={{ ...inputStyle, marginBottom: '10px' }} />
                <div style={sectionBox}>
                  <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '8px' }}>Who is this for?</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {members.map(m => memberChip(bTravelerUserId === m.user_id, () => { setBTravelerUserId(m.user_id); setBTravelerName(m.display_name) }, m.user_id === user.id ? 'Me' : m.display_name))}
                  </div>
                  <input placeholder="Or type a name (non-member)" value={bTravelerName} onChange={e => { setBTravelerName(e.target.value); setBTravelerUserId('') }} style={{ ...inputStyle, fontSize: '13px' }} />
                </div>
                <div style={sectionBox}>
                  <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '8px' }}>Who paid?</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {members.map(m => memberChip(bPaidBy === m.user_id, () => setBPaidBy(m.user_id), m.user_id === user.id ? 'Me' : m.display_name))}
                  </div>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Total cost ($)</label>
                  <input type="number" placeholder="0.00" value={bCost} onChange={e => setBCost(e.target.value)} style={inputStyle} />
                </div>
                {splitSection(
                  bSplitType, setBSplitType, bSplitMethod, setBSplitMethod,
                  bSelectedMembers, setBSelectedMembers, bCustomAmounts, setBCustomAmounts,
                  bCost, getBEvenAmount(), getBSplitMembers, bIsPrivate, setBIsPrivate
                )}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Check-in / Departure</label>
                    <input type="datetime-local" value={bCheckIn} onChange={e => setBCheckIn(e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '5px' }}>Check-out / Arrival</label>
                    <input type="datetime-local" value={bCheckOut} onChange={e => setBCheckOut(e.target.value)} style={inputStyle} />
                  </div>
                </div>
                <textarea placeholder="📝 Notes (optional)" value={bNotes} onChange={e => setBNotes(e.target.value)}
                  style={{ ...inputStyle, marginBottom: '16px', minHeight: '70px', resize: 'vertical', fontFamily: FONT }} />
                <div style={{ display: 'flex', gap: '10px' }}>
                  {editingBooking && <button onClick={resetBookingForm} style={{ flex: 1, padding: '13px', border: '1.5px solid #e8e8f0', borderRadius: '12px', background: 'white', color: '#555', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>}
                  <button onClick={saveBooking} style={{ flex: 2, padding: '13px', border: 'none', borderRadius: '12px', background: GRADIENT, color: 'white', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>
                    {editingBooking ? 'Save changes' : 'Add booking'}
                  </button>
                </div>
              </div>

              {filteredBookings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa', fontSize: '14px', background: 'white', borderRadius: '20px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
                  No bookings yet!
                </div>
              ) : (
                filteredBookings.map(booking => {
                  const badge = bookingBadge(booking, user.id)
                  const borderColor = bookingBorderColor(booking, user.id)
                  return (
                    <div key={booking.id} style={{ background: editingBooking?.id === booking.id ? '#f0f2ff' : 'white', borderRadius: '16px', padding: '14px 18px', marginBottom: '10px', boxShadow: '0 2px 12px rgba(102,126,234,0.08)', borderLeft: `4px solid ${borderColor}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '16px' }}>{categoryIcon(booking.category)}</span>
                            <p style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e', margin: 0 }}>{booking.title}</p>
                            <span style={{ fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px', background: badge.bg, color: badge.color }}>{badge.label}</span>
                          </div>
                          {(booking.traveler_name || booking.traveler_user_id) && (
                            <p style={{ fontSize: '12px', color: '#667eea', margin: '0 0 3px', fontWeight: '500' }}>
                              👤 For: {booking.traveler_name || getMemberName(booking.traveler_user_id)}
                            </p>
                          )}
                          <p style={{ fontSize: '12px', color: '#888', margin: '0 0 3px' }}>
                            💳 Paid by: <span style={{ fontWeight: '500', color: '#1a1a2e' }}>{getMemberName(booking.paid_by || booking.booked_by)}</span>
                          </p>
                          {booking.confirmation && (
                            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 3px' }}>
                              Confirmation: <span style={{ fontFamily: 'monospace', color: '#667eea' }}>{booking.confirmation}</span>
                            </p>
                          )}
                          {booking.total_cost && (
                            <p style={{ fontSize: '13px', color: '#1a1a2e', margin: '0 0 3px', fontWeight: '500' }}>
                              ${booking.total_cost.toLocaleString()}
                              <span style={{ color: '#888', fontWeight: '400' }}> · {badge.label.replace(/[👥👤🔒]/g, '').trim()}</span>
                            </p>
                          )}
                          {booking.check_in && (
                            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 3px' }}>
                              {new Date(booking.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              {booking.check_out && ` → ${new Date(booking.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                          )}
                          {booking.notes && <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0', background: '#f8f8ff', padding: '6px 10px', borderRadius: '8px' }}>{booking.notes}</p>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                          <button onClick={() => startEditBooking(booking)} style={{ ...iconBtn, color: '#667eea' }}>✏️</button>
                          <button onClick={() => deleteBooking(booking.id)} style={{ ...iconBtn, color: '#ccc' }}>✕</button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </>
          )}

          {/* SETTLE UP TAB */}
          {activeTab === 'settleup' && (
            <>
              <div style={{ background: GRADIENT, borderRadius: '20px', padding: '24px', marginBottom: '20px', textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', margin: '0 0 4px' }}>You owe</p>
                <p style={{ color: 'white', fontSize: '36px', fontWeight: '700', margin: '0 0 4px' }}>${totalOwed.toFixed(2)}</p>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', margin: 0 }}>outstanding across all bookings & activities</p>
              </div>

              {transfers.length > 0 && (
                <div style={{ background: 'white', borderRadius: '20px', padding: '20px', marginBottom: '20px', boxShadow: '0 4px 24px rgba(102,126,234,0.1)' }}>
                  <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 14px' }}>Recommended transfers</h2>
                  {transfers.map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < transfers.length - 1 ? '0.5px solid #e8e8f0' : 'none' }}>
                      <div>
                        <p style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e', margin: '0 0 2px' }}>
                          {getMemberName(t.from)} → {getMemberName(t.to)}
                        </p>
                        <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>${t.amount.toFixed(2)}</p>
                      </div>
                      {t.from === user.id && <span style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '20px', background: '#fff8e1', color: '#f57f17' }}>You owe this</span>}
                      {t.to === user.id && <span style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '20px', background: '#e8f5e9', color: '#2e7d32' }}>Owed to you</span>}
                    </div>
                  ))}
                </div>
              )}

              <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 12px' }}>Your outstanding items</h2>
              {myUnsettledBSplits.length === 0 && myUnsettledISplits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 24px', color: '#aaa', fontSize: '14px', background: 'white', borderRadius: '20px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎉</div>
                  You're all settled up!
                </div>
              ) : (
                <>
                  {myUnsettledBSplits.map(split => {
                    const booking = bookings.find(b => b.id === split.booking_id)
                    if (!booking) return null
                    return (
                      <div key={split.id} style={{ background: 'white', borderRadius: '16px', padding: '14px 18px', marginBottom: '8px', boxShadow: '0 2px 12px rgba(102,126,234,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e', margin: '0 0 2px' }}>{booking.title}</p>
                          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                            {categoryIcon(booking.category)} ${split.amount_owed.toFixed(2)} owed to {getMemberName(booking.paid_by || booking.booked_by)}
                          </p>
                        </div>
                        <button onClick={() => markSplitPaid(split.id)} style={{ padding: '8px 12px', border: 'none', borderRadius: '10px', background: GRADIENT, color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Mark paid ✓
                        </button>
                      </div>
                    )
                  })}
                  {myUnsettledISplits.map(split => {
                    const item = items.find(i => i.id === split.item_id)
                    if (!item) return null
                    return (
                      <div key={split.id} style={{ background: 'white', borderRadius: '16px', padding: '14px 18px', marginBottom: '8px', boxShadow: '0 2px 12px rgba(102,126,234,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e', margin: '0 0 2px' }}>{item.title}</p>
                          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                            🗓️ ${split.amount_owed.toFixed(2)} owed to {getMemberName(item.paid_by)}
                          </p>
                        </div>
                        <button onClick={() => markISplitPaid(split.id)} style={{ padding: '8px 12px', border: 'none', borderRadius: '10px', background: GRADIENT, color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Mark paid ✓
                        </button>
                      </div>
                    )
                  })}
                </>
              )}

              {[...splits.filter(s => s.paid && s.user_id === user.id), ...iSplits.filter(s => s.paid && s.user_id === user.id)].length > 0 && (
                <>
                  <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a2e', margin: '20px 0 12px' }}>Settled ✅</h2>
                  {splits.filter(s => s.paid && s.user_id === user.id).map(split => {
                    const booking = bookings.find(b => b.id === split.booking_id)
                    if (!booking) return null
                    return (
                      <div key={split.id} style={{ background: 'white', borderRadius: '16px', padding: '12px 18px', marginBottom: '8px', opacity: 0.6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontWeight: '600', fontSize: '13px', color: '#1a1a2e', margin: '0 0 2px' }}>{booking.title}</p>
                          <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>${split.amount_owed.toFixed(2)} · paid</p>
                        </div>
                        <span>✅</span>
                      </div>
                    )
                  })}
                  {iSplits.filter(s => s.paid && s.user_id === user.id).map(split => {
                    const item = items.find(i => i.id === split.item_id)
                    if (!item) return null
                    return (
                      <div key={split.id} style={{ background: 'white', borderRadius: '16px', padding: '12px 18px', marginBottom: '8px', opacity: 0.6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontWeight: '600', fontSize: '13px', color: '#1a1a2e', margin: '0 0 2px' }}>{item.title}</p>
                          <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>${split.amount_owed.toFixed(2)} · paid</p>
                        </div>
                        <span>✅</span>
                      </div>
                    )
                  })}
                </>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2ff', fontFamily: FONT }}>
      <div style={{ background: GRADIENT, padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'white', margin: '0 0 2px' }}>✈️ Trip Planner</h1>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '14px', margin: 0 }}>Hey, {user.user_metadata.full_name?.split(' ')[0]}!</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '600', fontSize: '15px' }}>
            {user.user_metadata.full_name?.charAt(0)}
          </div>
          <button onClick={signOut} style={{ padding: '8px 16px', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: '10px', background: 'transparent', color: 'white', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: '520px', margin: '0 auto', padding: '32px 24px' }}>
        {joinMessage && (
          <div style={{ background: '#e8f5e9', border: '1.5px solid #a5d6a7', borderRadius: '12px', padding: '14px 18px', marginBottom: '24px', color: '#2e7d32', fontSize: '14px', fontWeight: '500' }}>
            🎉 {joinMessage}
          </div>
        )}
        <div style={{ background: 'white', borderRadius: '20px', padding: '28px', marginBottom: '32px', boxShadow: '0 4px 24px rgba(102,126,234,0.1)' }}>
          <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 20px' }}>＋ Create a new trip</h2>
          <input placeholder="Trip name (e.g. Azores Girls Trip)" value={tripName} onChange={e => setTripName(e.target.value)} style={{ ...inputStyle, marginBottom: '12px' }} />
          <input placeholder="Destination (e.g. São Miguel, Azores)" value={destination} onChange={e => setDestination(e.target.value)} style={{ ...inputStyle, marginBottom: '12px' }} />
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '6px' }}>Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#888', fontWeight: '500', display: 'block', marginBottom: '6px' }}>End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <button onClick={createTrip} style={{ width: '100%', padding: '14px', border: 'none', borderRadius: '12px', background: GRADIENT, color: 'white', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>Create trip</button>
        </div>

        <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 16px' }}>Your trips</h2>
        {trips.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa', fontSize: '14px', background: 'white', borderRadius: '20px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🗺️</div>
            No trips yet — create your first one above!
          </div>
        ) : (
          trips.map(trip => (
            <div key={trip.id} style={{ position: 'relative', marginBottom: '12px' }}>
              <div onClick={() => setSelectedTrip(trip)} style={{ background: GRADIENT, borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 24px rgba(102,126,234,0.2)', textAlign: 'center', cursor: 'pointer' }}>
                <p style={{ fontWeight: '700', fontSize: '22px', color: 'white', margin: '0 0 6px' }}>{trip.name}</p>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '14px', margin: '0 0 6px' }}>📍 {trip.destination}</p>
                {trip.start_date && (
                  <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: 0 }}>
                    {new Date(trip.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {trip.end_date && ` → ${new Date(trip.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  </p>
                )}
              </div>
              <button onClick={e => { e.stopPropagation(); deleteTrip(trip.id) }} style={{
                position: 'absolute', top: '12px', right: '12px', background: 'rgba(255,255,255,0.2)',
                border: 'none', borderRadius: '8px', color: 'white', fontSize: '13px', cursor: 'pointer', padding: '4px 10px'
              }}>✕ Delete</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default App