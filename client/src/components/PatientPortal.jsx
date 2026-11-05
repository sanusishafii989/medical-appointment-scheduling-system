import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight,
  Clock3, LayoutDashboard, LogOut, MapPin, Search, Settings, Stethoscope,
  UserRound, UsersRound, X,
} from 'lucide-react';
import PatientAccountSettings from './PatientAccountSettings.jsx';

const BASE = '/access/patient';
const TIME_ZONE = 'Africa/Lagos';
const PAGE_SIZE = 20;
const PAGE_META = {
  dashboard: ['Dashboard', 'Your care, appointments, and next steps in one place.'],
  appointments: ['Appointments', 'Review and manage your upcoming and past visits.'],
  doctors: ['My doctors', 'Doctors connected to your appointment history.'],
  'find-care': ['Find care', 'Search doctors and choose an appointment time.'],
  waitlist: ['Waitlist', 'Manage your open-slot requests and appointment offers.'],
  notifications: ['Notifications', 'Appointment confirmations and reminder updates.'],
  settings: ['Settings', 'Manage your contact details and reminder preferences.'],
};
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'doctors', label: 'My doctors', icon: UsersRound },
  { id: 'find-care', label: 'Find care', icon: Stethoscope },
  { id: 'waitlist', label: 'Waitlist', icon: Clock3 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function dateKey(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function formatDate(value, options = { weekday:'long', month:'long', day:'numeric', year:'numeric' }) {
  return value ? new Intl.DateTimeFormat('en-NG', { ...options, timeZone: TIME_ZONE }).format(new Date(value)) : '—';
}
function formatTime(value) {
  return value ? new Intl.DateTimeFormat('en-NG', { timeZone: TIME_ZONE, hour:'numeric', minute:'2-digit' }).format(new Date(value)) : '—';
}
function titleCase(value = '') { return value.toLowerCase().replaceAll('_', ' '); }
function initials(value = '') { return value.trim().split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase() || 'CS'; }

function Status({ value }) { return <span className={`patient-status status-${value.toLowerCase()}`}>{titleCase(value)}</span>; }

function AppointmentCard({ appointment, onCancel, onReschedule, onCalendar, onDownload, busy, compact = false }) {
  const canManage = ['PENDING','CONFIRMED'].includes(appointment.status) && new Date(appointment.startAt).getTime() - Date.now() >= 2 * 60 * 60 * 1000;
  return <article className={`patient-appointment-card${compact ? ' compact' : ''}`}>
    <div className="patient-appointment-date"><strong>{new Intl.DateTimeFormat('en-NG',{timeZone:TIME_ZONE,month:'short',day:'numeric'}).format(new Date(appointment.startAt))}</strong><span>{formatTime(appointment.startAt)}</span><small>to {formatTime(appointment.endAt)}</small></div>
    <div className="patient-appointment-info"><strong>{appointment.doctor.user.name}</strong><span>{appointment.doctor.specialization} · {appointment.doctor.department.name}</span><small>{appointment.reason || 'No reason added'}</small></div>
    <div className="patient-appointment-state"><Status value={appointment.status} /><span>{formatDate(appointment.startAt,{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</span></div>
    {!compact && <div className="patient-appointment-actions"><button type="button" onClick={() => onCalendar(appointment)}><CalendarPlus size={14}/>Google Calendar</button><button type="button" onClick={() => onDownload(appointment.id)}>Download .ics</button>{canManage && <><button type="button" disabled={busy} onClick={() => onReschedule(appointment)}>Reschedule</button><button className="patient-cancel-action" type="button" disabled={busy} onClick={() => onCancel(appointment.id)}>Cancel</button></>}</div>}
  </article>;
}

export default function PatientPortal({ user, onSignOut, onUserUpdated, apiRequest, apiUrl }) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = location.pathname.replace(/\/+$/, '').split('/').pop();
  const [appointments, setAppointments] = useState({ appointments: [], pagination: { page:1, pageSize:PAGE_SIZE, total:0 } });
  const [appointmentPeriod, setAppointmentPeriod] = useState('upcoming');
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [pastCount, setPastCount] = useState(0);
  const [notifications, setNotifications] = useState({ notifications:[], unread:0, pagination:{page:1,pageSize:PAGE_SIZE,total:0} });
  const [notificationFilter, setNotificationFilter] = useState('all');
  const [notificationPage, setNotificationPage] = useState(1);
  const [waitlist, setWaitlist] = useState([]);
  const [myDoctors, setMyDoctors] = useState([]);
  const [loadingMyDoctors, setLoadingMyDoctors] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorSearch, setDoctorSearch] = useState(new URLSearchParams(location.search).get('search') || '');
  const [departmentId, setDepartmentId] = useState(() => new URLSearchParams(location.search).get('departmentId') || '');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(() => {
    const requestedDate = new URLSearchParams(location.search).get('date') || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && !Number.isNaN(Date.parse(`${requestedDate}T00:00:00`)) ? requestedDate : dateKey();
  });
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [reason, setReason] = useState('');
  const [rescheduleId, setRescheduleId] = useState('');
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [notificationsRefresh, setNotificationsRefresh] = useState(0);
  const [waitlistRefresh, setWaitlistRefresh] = useState(0);

  useEffect(() => {
    if (!PAGE_META[page]) navigate(`${BASE}/dashboard`, { replace:true });
  }, [page, navigate]);

  useEffect(() => {
    if (location.state?.reschedule) {
      const appointment = location.state.reschedule;
      setRescheduleId(appointment.id); setDoctorId(appointment.doctor.id); setDate(dateKey(new Date(appointment.startAt)));
      setNotice('Choose a new time for your appointment. The current booking stays active until the change succeeds.');
      navigate(`${BASE}/find-care`, { replace:true, state:null });
    }
  }, [location.state, navigate]);

  useEffect(() => {
    let active = true; setAppointmentsLoading(true);
    apiRequest(`/appointments?page=${appointmentPage}&period=${appointmentPeriod}`)
      .then((result) => { if (active) { setAppointments(result); } })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setAppointmentsLoading(false); });
    return () => { active = false; };
  }, [apiRequest, appointmentPage, appointmentPeriod, refreshKey]);

  useEffect(() => {
    apiRequest('/appointments?page=1&period=upcoming').then((r) => setUpcomingCount(r.pagination.total)).catch(() => {});
    apiRequest('/appointments?page=1&period=past').then((r) => setPastCount(r.pagination.total)).catch(() => {});
  }, [apiRequest, refreshKey]);

  useEffect(() => {
    let active = true;
    apiRequest(`/notifications?page=${notificationPage}&read=${notificationFilter}`)
      .then((r) => { if (active) setNotifications(r); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [apiRequest, notificationFilter, notificationPage, notificationsRefresh]);

  useEffect(() => {
    let active = true;
    apiRequest('/waitlist').then((r) => { if (active) setWaitlist(r.waitlist); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [apiRequest, waitlistRefresh]);

  useEffect(() => {
    if (page !== 'find-care') return undefined;
    let active = true;
    apiRequest('/doctors/departments').then((r) => { if (active) setDepartments(r.departments); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [apiRequest, page]);

  useEffect(() => {
    if (page !== 'find-care') return undefined;
    let active = true; setLoadingDoctors(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(); if (doctorSearch.trim()) params.set('search', doctorSearch.trim()); if (departmentId) params.set('departmentId', departmentId);
      apiRequest(`/doctors${params.size ? `?${params}` : ''}`).then((r) => { if (!active) return; setDoctors(r.doctors); setDoctorId((current) => current && r.doctors.some((d) => d.id === current) ? current : (r.doctors[0]?.id || '')); })
        .catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoadingDoctors(false); });
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [apiRequest, page, doctorSearch, departmentId]);

  useEffect(() => {
    if (page !== 'doctors') return undefined;
    let active = true; setLoadingMyDoctors(true);
    apiRequest('/appointments/doctors')
      .then((r) => { if (active) setMyDoctors(r.doctors); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoadingMyDoctors(false); });
    return () => { active = false; };
  }, [apiRequest, page, refreshKey]);

  useEffect(() => {
    if (page !== 'find-care' || !doctorId || !date) { setSlots([]); return undefined; }
    let active = true; setLoadingSlots(true);
    apiRequest(`/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`)
      .then((r) => { if (active) setSlots(r.slots); }).catch((e) => { if (active) { setSlots([]); setError(e.message); } })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [apiRequest, page, doctorId, date]);

  useEffect(() => { setSelectedSlot(null); }, [doctorId, date]);

  async function bookSlot(slot) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest(rescheduleId ? `/appointments/${encodeURIComponent(rescheduleId)}/reschedule` : '/appointments', {
        method:rescheduleId ? 'PATCH' : 'POST',
        body:JSON.stringify(rescheduleId ? { startAt:slot.startAt } : { doctorId, startAt:slot.startAt, reason }),
      });
      const action = rescheduleId ? 'Appointment rescheduled' : 'Appointment booked';
      setNotice(result.emailSent ? `${action}. A confirmation email was sent.` : `${action}. In-app updates are available in Notifications.`);
      setReason(''); setRescheduleId(''); setSelectedSlot(null); setRefreshKey((x) => x + 1); setNotificationsRefresh((x) => x + 1); setWaitlistRefresh((x) => x + 1);
      setSlots((current) => current.filter((item) => item.startAt !== slot.startAt));
      if (!rescheduleId) navigate(`${BASE}/appointments`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function cancelAppointment(id) {
    if (!window.confirm('Cancel this appointment? You can only cancel at least two hours before it starts.')) return;
    setBusy(true); setError(''); setNotice('');
    try { await apiRequest(`/appointments/${encodeURIComponent(id)}/cancel`, { method:'PATCH' }); setNotice('Appointment cancelled.'); setRefreshKey((x) => x + 1); setNotificationsRefresh((x) => x + 1); setWaitlistRefresh((x) => x + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function updateWaitlist(entry, action) {
    setBusy(true); setError(''); setNotice('');
    try { const r = await apiRequest(`/waitlist/${encodeURIComponent(entry.id)}/${action}`, { method:'PATCH' }); setNotice(r.message || (action === 'claim' ? 'Appointment claimed.' : 'You left the waitlist.')); setWaitlistRefresh((x) => x + 1); setRefreshKey((x) => x + 1); setNotificationsRefresh((x) => x + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function markRead(id) {
    try { await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method:'PATCH' }); setNotificationsRefresh((x) => x + 1); }
    catch (e) { setError(e.message); }
  }
  async function markAllRead() {
    try { await apiRequest('/notifications/read-all', { method:'PATCH' }); setNotificationsRefresh((x) => x + 1); }
    catch (e) { setError(e.message); }
  }
  async function joinWaitlist() {
    setBusy(true); setError('');
    try { const r = await apiRequest('/waitlist', { method:'POST', body:JSON.stringify({ doctorId, date }) }); setNotice(r.message || 'You joined the waitlist. We’ll notify you if a time opens.'); setWaitlistRefresh((x) => x + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function downloadCalendar(id) {
    try { const token = sessionStorage.getItem('care-slot-token'); const response = await fetch(`${apiUrl}/appointments/${encodeURIComponent(id)}/calendar.ics`, { headers:{ Authorization:`Bearer ${token}` } }); if (!response.ok) { const r = await response.json(); throw new Error(r.message || 'Could not download calendar event.'); } const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `careslot-appointment-${id}.ics`; link.click(); URL.revokeObjectURL(url); }
    catch (e) { setError(e.message); }
  }
  function addToGoogleCalendar(appointment) {
    const stamp = (value) => new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const params = new URLSearchParams({ action:'TEMPLATE', text:`Medical appointment with ${appointment.doctor.user.name}`, dates:`${stamp(appointment.startAt)}/${stamp(appointment.endAt)}`, details:`${appointment.doctor.specialization} · ${appointment.doctor.department.name}` });
    window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank', 'noopener,noreferrer');
  }
  function beginReschedule(appointment) { setError(''); setNotice(''); navigate(`${BASE}/find-care`, { state:{ reschedule:appointment } }); }

  const upcomingVisible = appointments.appointments.filter((a) => ['PENDING','CONFIRMED'].includes(a.status));
  const meta = PAGE_META[page] || PAGE_META.dashboard;
  const welcomeName = user.name.trim().split(/\s+/)[0];

  function renderFindCare() {
    return <div className="patient-find-layout">
      <section className="patient-panel patient-search-panel">
        <div className="patient-panel-heading"><div><h2>Find a doctor</h2><p>Choose a clinician, date, and available appointment time.</p></div></div>
        {rescheduleId && <div className="patient-inline-notice"><CalendarDays size={17}/><span>{notice || 'Rescheduling appointment'}<small>Your current booking remains until a new time is confirmed.</small></span><button type="button" aria-label="Stop rescheduling" onClick={() => { setRescheduleId(''); setNotice('Rescheduling stopped; your existing booking is unchanged.'); }}><X size={16}/></button></div>}
        <label className="patient-form-label" htmlFor="patient-doctor-search">Doctor name</label><div className="patient-search-input"><Search size={17}/><input id="patient-doctor-search" type="search" placeholder="Search doctor or specialty" value={doctorSearch} onChange={(e) => setDoctorSearch(e.target.value)} maxLength={100}/></div>
        <div className="patient-search-controls"><label className="patient-form-label">Department<select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="patient-form-label">Appointment date<input type="date" min={dateKey()} max={(() => { const d=new Date(); d.setDate(d.getDate()+90); return dateKey(d); })()} value={date} onChange={(e) => setDate(e.target.value)}/></label></div>
        {loadingDoctors ? <div className="patient-empty"><span className="patient-spinner"/>Finding available doctors…</div> : doctors.length ? <div className="patient-doctor-results">{doctors.map((doctor) => <button key={doctor.id} type="button" className={`patient-doctor-result${doctorId===doctor.id?' selected':''}`} onClick={() => setDoctorId(doctor.id)} aria-pressed={doctorId===doctor.id}><span className="patient-doctor-avatar"><Stethoscope size={18}/></span><span><strong>Dr. {doctor.user.name}</strong><small>{doctor.specialization} · {doctor.department.name}</small>{doctor.bio && <small className="patient-doctor-bio">{doctor.bio}</small>}</span>{doctorId===doctor.id && <Check size={17}/>}</button>)}</div> : <div className="patient-empty"><UserRound size={23}/><strong>No doctors found</strong><span>Try another name or department.</span></div>}
      </section>
      <section className="patient-panel patient-slots-panel"><div className="patient-panel-heading"><div><h2>Available appointments</h2><p>{date ? formatDate(`${date}T12:00:00+01:00`,{weekday:'long',month:'long',day:'numeric'}) : 'Select a date'} · Nigeria time</p></div><span className="patient-panel-mark"><CalendarDays size={18}/></span></div>
        <label className="patient-form-label">Reason for visit <span>Optional</span><textarea rows="3" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Share a brief note for the doctor"/></label>
        {loadingSlots ? <div className="patient-empty"><span className="patient-spinner"/>Checking open times…</div> : slots.length ? <><div className="patient-slot-grid">{slots.map((slot) => <button key={slot.startAt} className={selectedSlot?.startAt===slot.startAt?'selected':''} type="button" disabled={busy} aria-pressed={selectedSlot?.startAt===slot.startAt} onClick={() => setSelectedSlot(slot)}><Clock3 size={15}/>{slot.time}<span>{selectedSlot?.startAt===slot.startAt?'Selected · confirm below':'Select time'}</span></button>)}</div>{selectedSlot&&<div className="patient-booking-confirm"><div><strong>{rescheduleId?'Confirm new appointment time':'Confirm this appointment'}</strong><span>Dr. {doctors.find((d)=>d.id===doctorId)?.user.name} · {formatDate(`${date}T12:00:00+01:00`,{weekday:'short',month:'short',day:'numeric'})} at {selectedSlot.time} Nigeria time</span></div><button className="patient-primary-button" type="button" disabled={busy} onClick={()=>bookSlot(selectedSlot)}>{busy?'Saving appointment…':rescheduleId?'Confirm reschedule':'Confirm booking'}</button></div>}</> : doctorId && <><div className="patient-empty"><Clock3 size={23}/><strong>No open times on this date</strong><span>Choose another day or request a place on the doctor’s waitlist.</span></div><button className="patient-outline-button patient-full-button" type="button" disabled={busy || Boolean(rescheduleId) || waitlist.some((w) => w.doctorId===doctorId && w.date===date && ['WAITING','NOTIFIED'].includes(w.status))} onClick={joinWaitlist}>{waitlist.some((w) => w.doctorId===doctorId && w.date===date && ['WAITING','NOTIFIED'].includes(w.status)) ? 'Already on this date’s waitlist' : 'Join waitlist for this date'}</button></>}
        <p className="patient-privacy-note">Your appointment details are visible only to you and the selected care team.</p>
      </section>
    </div>;
  }

  function renderAppointments() {
    const pageCount = Math.max(1, Math.ceil((appointments.pagination.total || 0) / PAGE_SIZE));
    return <section className="patient-panel"><div className="patient-panel-heading"><div><h2>Your appointments</h2><p>Reschedule or cancel at least two hours before the visit.</p></div><button className="patient-primary-button" type="button" onClick={() => navigate(`${BASE}/find-care`)}><CalendarPlus size={16}/>Book appointment</button></div>
      <div className="patient-tabs" role="group" aria-label="Appointment period">{[['upcoming',`Upcoming · ${upcomingCount}`],['past',`Past · ${pastCount}`],['all','All appointments']].map(([value,label]) => <button key={value} type="button" className={appointmentPeriod===value?'active':''} aria-pressed={appointmentPeriod===value} onClick={() => { setAppointmentPeriod(value); setAppointmentPage(1); }}>{label}</button>)}</div>
      {appointmentsLoading ? <div className="patient-empty"><span className="patient-spinner"/>Loading appointments…</div> : appointments.appointments.length ? <div className="patient-appointment-list">{appointments.appointments.map((a) => <AppointmentCard key={a.id} appointment={a} onCancel={cancelAppointment} onReschedule={beginReschedule} onCalendar={addToGoogleCalendar} onDownload={downloadCalendar} busy={busy}/>)}</div> : <div className="patient-empty"><CalendarDays size={24}/><strong>{appointmentPeriod==='upcoming'?'No upcoming appointments':'No appointments here yet'}</strong><span>{appointmentPeriod==='upcoming'?'Book a visit when you’re ready to plan your care.':'Completed and cancelled appointments will appear here.'}</span>{appointmentPeriod==='upcoming' && <button className="patient-primary-button" onClick={() => navigate(`${BASE}/find-care`)} type="button">Find a doctor</button>}</div>}
      {!appointmentsLoading && pageCount > 1 && <div className="patient-pagination"><span>Page {appointmentPage} of {pageCount}</span><div><button type="button" aria-label="Previous page" disabled={appointmentPage<=1} onClick={() => setAppointmentPage((p)=>p-1)}><ChevronLeft size={17}/></button><button type="button" aria-label="Next page" disabled={appointmentPage>=pageCount} onClick={() => setAppointmentPage((p)=>p+1)}><ChevronRight size={17}/></button></div></div>}
    </section>;
  }

  function renderNotifications() {
    const pageCount = Math.max(1, Math.ceil((notifications.pagination.total || 0) / PAGE_SIZE));
    return <section className="patient-panel"><div className="patient-panel-heading"><div><h2>Notifications</h2><p>{notifications.unread} unread update{notifications.unread===1?'':'s'} · confirmations, changes, and reminders</p></div><button className="patient-outline-button" type="button" disabled={!notifications.unread} onClick={markAllRead}>Mark all read</button></div>
      <div className="patient-tabs" role="group" aria-label="Notification filter">{[['all','All'],['unread','Unread'],['read','Read']].map(([f,label])=><button key={f} type="button" className={notificationFilter===f?'active':''} aria-pressed={notificationFilter===f} onClick={()=>{setNotificationFilter(f);setNotificationPage(1);}}>{label}</button>)}</div>
      {notifications.notifications.length ? <div className="patient-notification-list">{notifications.notifications.map((n)=><article key={n.id} className={`patient-notification${n.read?'':' unread'}`}><span className="patient-notification-icon"><Bell size={17}/></span><div><strong>{n.title}</strong><p>{n.message}</p><time>{formatDate(n.createdAt,{weekday:'short',month:'short',day:'numeric',year:'numeric'})} · {formatTime(n.createdAt)}</time></div>{!n.read&&<button type="button" onClick={()=>markRead(n.id)}>Mark read</button>}</article>)}</div> : <div className="patient-empty"><Bell size={23}/><strong>You’re all caught up</strong><span>No {notificationFilter==='all'?'':`${notificationFilter} `}notifications to display.</span></div>}
      {pageCount>1&&<div className="patient-pagination"><span>Page {notificationPage} of {pageCount}</span><div><button aria-label="Previous page" disabled={notificationPage<=1} onClick={()=>setNotificationPage(p=>p-1)}><ChevronLeft size={17}/></button><button aria-label="Next page" disabled={notificationPage>=pageCount} onClick={()=>setNotificationPage(p=>p+1)}><ChevronRight size={17}/></button></div></div>}
    </section>;
  }

  function renderWaitlist() {
    return <section className="patient-panel"><div className="patient-panel-heading"><div><h2>Your waitlist requests</h2><p>Request a date when a doctor has no open times. Offers expire, so claim one promptly.</p></div><button className="patient-primary-button" type="button" onClick={()=>navigate(`${BASE}/find-care`)}><Search size={16}/>Find a doctor</button></div>
      {waitlist.length ? <div className="patient-waitlist-list">{waitlist.map((entry)=><article className="patient-waitlist-card" key={entry.id}><span className="patient-doctor-avatar"><Clock3 size={18}/></span><div className="patient-waitlist-info"><strong>Dr. {entry.doctorName}</strong><span>{entry.specialization} · {entry.department}</span><small>{formatDate(`${entry.date}T12:00:00+01:00`,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</small>{entry.status==='NOTIFIED'&&<p>Appointment offered for {formatDate(entry.offeredStartAt,{month:'short',day:'numeric'})} at {formatTime(entry.offeredStartAt)}. Claim by {formatTime(entry.offerExpiresAt)}.</p>}</div><span className={`patient-waitlist-status wait-${entry.status.toLowerCase()}`}>{titleCase(entry.status)}</span><div className="patient-waitlist-actions">{entry.status==='NOTIFIED'&&<button className="patient-primary-button" type="button" disabled={busy} onClick={()=>updateWaitlist(entry,'claim')}>Claim time</button>}{['WAITING','NOTIFIED'].includes(entry.status)&&<button className="patient-cancel-action" type="button" disabled={busy} onClick={()=>updateWaitlist(entry,'withdraw')}>Withdraw</button>}</div></article>)}</div> : <div className="patient-empty"><Clock3 size={23}/><strong>No active waitlist requests</strong><span>Join a doctor’s waitlist from Find care when your preferred date is full.</span><button type="button" className="patient-primary-button" onClick={()=>navigate(`${BASE}/find-care`)}>Browse doctors</button></div>}
    </section>;
  }

  function renderDoctors() {
    return <div className="patient-doctors-page"><section className="patient-panel"><div className="patient-panel-heading"><div><h2>Doctors in your care history</h2><p>Clinicians from your appointments. Book another visit whenever you need.</p></div></div>{loadingMyDoctors ? <div className="patient-empty"><span className="patient-spinner"/>Loading doctors…</div> : myDoctors.length ? <div className="patient-my-doctors-grid">{myDoctors.map((doctor)=><article className="patient-my-doctor-card" key={doctor.id}><span className="patient-my-doctor-avatar"><Stethoscope size={20}/></span><div><strong>Dr. {doctor.user.name}</strong><span>{doctor.specialization}</span><small><MapPin size={13}/>{doctor.department.name}</small><small>{doctor.appointmentCount} appointment{doctor.appointmentCount===1?'':'s'} · Most recent {formatDate(doctor.lastAppointmentAt,{month:'short',day:'numeric',year:'numeric'})}</small></div><button type="button" className="patient-outline-button" onClick={()=>{setDoctorId(doctor.id);setDoctorSearch('');setDepartmentId('');navigate(`${BASE}/find-care`);}}>Book again</button></article>)}</div> : <div className="patient-empty"><UsersRound size={24}/><strong>Your care team will appear here</strong><span>Doctors you book appointments with will be listed here.</span><button className="patient-primary-button" type="button" onClick={()=>navigate(`${BASE}/find-care`)}>Find a doctor</button></div>}</section></div>;
  }

  function renderDashboard() {
    const next = appointments.appointments.find((a)=>['PENDING','CONFIRMED'].includes(a.status));
    return <div className="patient-dashboard-grid">
      <section className="patient-panel patient-welcome-panel"><div className="patient-welcome-top"><div><p className="patient-eyebrow">YOUR CARE, IN ONE PLACE</p><h2>Hello, {welcomeName} <span aria-hidden="true">✦</span></h2><p>Keep your appointments organized and find the right care when you need it.</p></div><span className="patient-welcome-icon"><CalendarDays size={26}/></span></div><div className="patient-dashboard-stats"><article><span><CalendarDays size={17}/></span><div><small>Upcoming visits</small><strong>{upcomingCount}</strong></div></article><article><span><Check size={17}/></span><div><small>Past visits</small><strong>{pastCount}</strong></div></article><article><span><Bell size={17}/></span><div><small>Unread updates</small><strong>{notifications.unread}</strong></div></article></div><button className="patient-primary-button" type="button" onClick={()=>navigate(`${BASE}/find-care`)}><Search size={16}/>Find a doctor</button></section>
      <section className="patient-panel patient-next-panel"><div className="patient-panel-heading"><div><h2>Next appointment</h2><p>Your next confirmed or pending visit</p></div><CalendarDays size={19}/></div>{appointmentsLoading ? <div className="patient-empty"><span className="patient-spinner"/>Loading your schedule…</div> : next ? <><div className="patient-next-date"><strong>{formatDate(next.startAt,{weekday:'long',month:'long',day:'numeric'})}</strong><span>{formatTime(next.startAt)} – {formatTime(next.endAt)} · Nigeria time</span></div><div className="patient-next-doctor"><span className="patient-doctor-avatar"><Stethoscope size={18}/></span><div><strong>Dr. {next.doctor.user.name}</strong><small>{next.doctor.specialization} · {next.doctor.department.name}</small></div></div><Status value={next.status}/><div className="patient-appointment-actions"><button type="button" onClick={()=>addToGoogleCalendar(next)}><CalendarPlus size={14}/>Add to calendar</button>{new Date(next.startAt).getTime()-Date.now()>=2*60*60*1000&&<><button type="button" disabled={busy} onClick={()=>beginReschedule(next)}>Reschedule</button><button type="button" className="patient-cancel-action" disabled={busy} onClick={()=>cancelAppointment(next.id)}>Cancel</button></>}<button type="button" onClick={()=>navigate(`${BASE}/appointments`)}>View details <ChevronRight size={14}/></button></div></> : <div className="patient-empty"><CalendarDays size={23}/><strong>No upcoming appointment</strong><span>When you book your next visit, it will appear here.</span><button className="patient-outline-button" type="button" onClick={()=>navigate(`${BASE}/find-care`)}>Explore doctors</button></div>}</section>
      <section className="patient-panel patient-dashboard-appointments"><div className="patient-panel-heading"><div><h2>Upcoming appointments</h2><p>Your schedule at a glance</p></div><button className="patient-link-button" type="button" onClick={()=>navigate(`${BASE}/appointments`)}>All appointments <ChevronRight size={15}/></button></div>{appointmentsLoading ? <div className="patient-empty"><span className="patient-spinner"/>Loading appointments…</div> : upcomingVisible.length ? upcomingVisible.slice(0,4).map((a)=><AppointmentCard key={a.id} appointment={a} onCalendar={addToGoogleCalendar} onCancel={cancelAppointment} onReschedule={beginReschedule} busy={busy} compact/>) : <div className="patient-empty patient-empty-short"><strong>No upcoming visits booked</strong><button className="patient-link-button" type="button" onClick={()=>navigate(`${BASE}/find-care`)}>Find available care <ChevronRight size={15}/></button></div>}</section>
      <aside className="patient-dashboard-shortcuts"><button type="button" onClick={()=>navigate(`${BASE}/appointments`)}><CalendarDays size={18}/><span><strong>Manage appointments</strong><small>View, change, or cancel a visit</small></span><ChevronRight size={16}/></button><button type="button" onClick={()=>navigate(`${BASE}/waitlist`)}><Clock3 size={18}/><span><strong>Check your waitlist</strong><small>Review open-slot requests</small></span><ChevronRight size={16}/></button></aside>
    </div>;
  }

  let content;
  if (page==='dashboard') content=renderDashboard();
  else if (page==='appointments') content=renderAppointments();
  else if (page==='find-care') content=renderFindCare();
  else if (page==='doctors') content=renderDoctors();
  else if (page==='waitlist') content=renderWaitlist();
  else if (page==='notifications') content=renderNotifications();
  else content=<PatientAccountSettings user={user} onUserUpdated={onUserUpdated} apiRequest={apiRequest}/>;

  return <div className="patient-portal">
    <aside className="patient-sidebar"><Link to="/" className="patient-brand"><span><CalendarPlus size={21}/></span>CareSlot</Link><p className="patient-nav-caption">PATIENT PORTAL</p><nav className="patient-nav" aria-label="Patient portal">{NAV_ITEMS.map(({id,label,icon:Icon})=><NavLink key={id} to={`${BASE}/${id}`} className={({isActive})=>`patient-nav-link${isActive?' active':''}`}><Icon size={18}/>{label}{id==='notifications'&&notifications.unread>0&&<span className="patient-nav-count">{notifications.unread>99?'99+':notifications.unread}</span>}</NavLink>)}</nav><NavLink to={`${BASE}/settings`} className={({isActive})=>`patient-sidebar-profile${isActive?' active':''}`}><span className="patient-sidebar-avatar">{initials(user.name)}</span><span><strong>{user.name}</strong><small>Patient account</small></span><Settings size={15}/></NavLink><button className="patient-signout" type="button" onClick={onSignOut}><LogOut size={16}/>Sign out</button></aside>
    <main className="patient-portal-main"><header className="patient-topbar"><div className="patient-page-title"><p className="patient-eyebrow">PATIENT PORTAL</p><h1>{meta[0]}</h1><p>{meta[1]}</p></div><div className="patient-topbar-actions"><label className="patient-global-search"><Search size={17}/><span className="patient-visually-hidden">Search doctors</span><input value={doctorSearch} onChange={(e)=>setDoctorSearch(e.target.value)} onFocus={()=>{if(page!=='find-care') navigate(`${BASE}/find-care`);}} placeholder="Search doctor or specialty"/></label><button className="patient-bell-button" type="button" aria-label={`${notifications.unread} unread notifications`} onClick={()=>navigate(`${BASE}/notifications`)}><Bell size={19}/>{notifications.unread>0&&<i/>}</button><button className="patient-user-chip" type="button" onClick={()=>navigate(`${BASE}/settings`)}><span>{initials(user.name)}</span><strong>{welcomeName}</strong></button></div></header>
      {error&&<p className="patient-alert" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={15}/></button></p>}{notice&&page!=='find-care'&&<p className="patient-success" role="status">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={15}/></button></p>}{content}
      <footer className="patient-portal-footer"><span>CareSlot · Thoughtful scheduling for better-connected care</span><span>All appointment times shown in Nigeria time (WAT)</span></footer>
    </main>
  </div>;
}
