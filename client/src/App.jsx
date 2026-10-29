import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api');

async function apiRequest(path, options = {}) {
  const token = sessionStorage.getItem('care-slot-token');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Request failed. Please try again.');
  return result;
}

function localDateInputValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function localDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function PatientDashboard({ user, onSignOut }) {
  const [doctors, setDoctors] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [date, setDate] = useState(localDateInputValue());
  const [slots, setSlots] = useState([]);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reschedulingId, setReschedulingId] = useState('');

  async function loadAppointments() {
    const result = await apiRequest('/appointments');
    setAppointments(result.appointments);
  }

  async function loadNotifications() {
    const result = await apiRequest('/notifications');
    setNotifications(result.notifications);
  }

  async function loadWaitlist() {
    const result = await apiRequest('/waitlist');
    setWaitlist(result.waitlist);
  }

  useEffect(() => {
    Promise.all([apiRequest('/doctors'), apiRequest('/doctors/departments'), loadAppointments(), loadNotifications(), loadWaitlist()])
      .then(([doctorResult, departmentResult]) => {
        setDoctors(doctorResult.doctors);
        setDepartments(departmentResult.departments);
        setDoctorId(doctorResult.doctors[0]?.id || '');
      })
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!doctorId || !date) { setSlots([]); return; }
    apiRequest(`/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`)
      .then((result) => { setSlots(result.slots); setMessage(''); })
      .catch((error) => { setSlots([]); setMessage(error.message); });
  }, [doctorId, date]);

  const filteredDoctors = doctors.filter((doctor) => !departmentId || doctor.department.id === departmentId);
  useEffect(() => {
    if (!filteredDoctors.length) {
      if (doctorId) setDoctorId('');
    } else if (!filteredDoctors.some((doctor) => doctor.id === doctorId)) {
      setDoctorId(filteredDoctors[0].id);
    }
  }, [departmentId, doctors, doctorId]);

  async function bookSlot(slot) {
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest(reschedulingId ? `/appointments/${encodeURIComponent(reschedulingId)}/reschedule` : '/appointments', {
        method: reschedulingId ? 'PATCH' : 'POST',
        body: JSON.stringify(reschedulingId ? { startAt: slot.startAt } : { doctorId, startAt: slot.startAt, reason }),
      });
      setReason('');
      setReschedulingId('');
      const completedAction = reschedulingId ? 'Appointment rescheduled' : 'Appointment booked';
      setMessage(result.emailSent ? `${completedAction}. A confirmation email was sent.` : `${completedAction}. Email is not configured or is disabled for your account.`);
      await Promise.all([loadAppointments(), loadNotifications(), loadWaitlist(), apiRequest(`/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`).then((slotResult) => setSlots(slotResult.slots))]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function beginReschedule(appointment) {
    setReschedulingId(appointment.id);
    setDepartmentId('');
    setDoctorId(appointment.doctor.id);
    setDate(new Date(new Date(appointment.startAt).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10));
    setMessage('Choose a new time below.');
    document.getElementById('booking-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stopReschedule() {
    setReschedulingId('');
    setMessage('Rescheduling cancelled.');
  }

  async function cancelAppointment(appointmentId) {
    if (!window.confirm('Cancel this appointment?')) return;
    setBusy(true);
    setMessage('');
    try {
      await apiRequest(`/appointments/${encodeURIComponent(appointmentId)}/cancel`, { method: 'PATCH' });
      setMessage('Appointment cancelled.');
      await Promise.all([loadAppointments(), loadNotifications(), loadWaitlist()]);
      window.setTimeout(() => loadWaitlist().catch(() => {}), 1000);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function markNotificationRead(notificationId) {
    try {
      await apiRequest(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' });
      setNotifications((current) => current.map((notification) => notification.id === notificationId ? { ...notification, read: true } : notification));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function markAllNotificationsRead() {
    try {
      await apiRequest('/notifications/read-all', { method: 'PATCH' });
      setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function joinWaitlist() {
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest('/waitlist', { method: 'POST', body: JSON.stringify({ doctorId, date }) });
      setMessage(result.message || 'You joined the waitlist. We will notify you when a time opens.');
      await loadWaitlist();
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(false); }
  }

  async function updateWaitlist(entry, action) {
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest(`/waitlist/${encodeURIComponent(entry.id)}/${action}`, { method: 'PATCH' });
      setMessage(result.message);
      await Promise.all([loadWaitlist(), loadAppointments(), loadNotifications()]);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function downloadCalendar(appointmentId) {
    try {
      const token = sessionStorage.getItem('care-slot-token');
      const response = await fetch(`${API_URL}/appointments/${encodeURIComponent(appointmentId)}/calendar.ics`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const result = await response.json(); throw new Error(result.message || 'Could not download calendar event.'); }
      const file = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = file; link.download = 'careslot-appointment.ics'; link.click();
      URL.revokeObjectURL(file);
    } catch (error) { setMessage(error.message); }
  }

  function addToGoogleCalendar(appointment) {
    const toUtcStamp = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `Medical appointment with ${appointment.doctor.user.name}`,
      dates: `${toUtcStamp(appointment.startAt)}/${toUtcStamp(appointment.endAt)}`,
      details: `${appointment.doctor.specialization} · ${appointment.doctor.department.name}`,
    });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <section className="dashboard-card">
      <div className="dashboard-heading"><div><p className="eyebrow">PATIENT PORTAL</p><h2>Hello, {user.name}</h2><p className="auth-subtitle">Find a doctor and choose a time that works for you.</p></div><button className="text-button" type="button" onClick={onSignOut}>Sign out</button></div>
      <div className="schedule-grid">
        <div className="booking-panel" id="booking-panel">
          <h3>{reschedulingId ? 'Choose a new appointment time' : 'Book an appointment'}</h3>
          {reschedulingId && <button className="text-button stop-reschedule" type="button" onClick={stopReschedule}>Keep current appointment</button>}
          <label htmlFor="department">Department</label>
          <select id="department" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">All departments</option>{departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select>
          <label htmlFor="doctor">Doctor</label>
          <select id="doctor" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}><option value="">Select a doctor</option>{filteredDoctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.user.name} · {doctor.specialization}</option>)}</select>
          {doctorId && <p className="doctor-meta">{doctors.find((doctor) => doctor.id === doctorId)?.department.name} · {doctors.find((doctor) => doctor.id === doctorId)?.bio || 'Appointments available'}</p>}
          <label htmlFor="appointment-date">Date</label>
          <input id="appointment-date" type="date" min={localDateInputValue()} max={(() => { const d = new Date(); d.setDate(d.getDate() + 90); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()} value={date} onChange={(event) => setDate(event.target.value)} />
          <label htmlFor="reason">Reason <span>Optional</span></label>
          <textarea id="reason" rows="2" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What would you like the doctor to know?" />
          <div className="slots-heading"><h4>Available times</h4><span>Nigeria time</span></div>
          {slots.length ? <div className="slot-list">{slots.map((slot) => <button type="button" className="slot-button" key={slot.startAt} disabled={busy} onClick={() => bookSlot(slot)}>{slot.time}</button>)}</div> : <><p className="empty-state">No open times for this date. Try another date or join the waitlist.</p>{doctorId && !reschedulingId && <button className="secondary-button" type="button" disabled={busy || waitlist.some((entry) => entry.doctorId === doctorId && entry.date === date && ['WAITING', 'NOTIFIED'].includes(entry.status))} onClick={joinWaitlist}>Join this date’s waitlist</button>}</>}
          {message && <p className="form-message" role="status">{message}</p>}
        </div>
        <div className="appointments-panel">
          <h3>Your appointments</h3>
          {appointments.length ? <div className="appointment-list">{appointments.map((appointment) => <article className="appointment-item" key={appointment.id}>
            <div><strong>{appointment.doctor.user.name}</strong><span>{appointment.doctor.specialization} · {appointment.doctor.department.name}</span><span>{new Date(appointment.startAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span className={`status status-${appointment.status.toLowerCase()}`}>{appointment.status.toLowerCase()}</span></div>
            <div className="appointment-actions"><button className="reschedule-button" type="button" onClick={() => addToGoogleCalendar(appointment)}>Google Calendar</button><button className="reschedule-button" type="button" onClick={() => downloadCalendar(appointment.id)}>Download .ics</button>{['PENDING', 'CONFIRMED'].includes(appointment.status) && new Date(appointment.startAt).getTime() - Date.now() >= 2 * 60 * 60 * 1000 && <><button className="reschedule-button" type="button" disabled={busy} onClick={() => beginReschedule(appointment)}>Reschedule</button><button className="cancel-button" type="button" disabled={busy} onClick={() => cancelAppointment(appointment.id)}>Cancel</button></>}</div>
          </article>)}</div> : <p className="empty-state">Your booked visits will appear here.</p>}
        </div>
      </div>
      <div className="notification-panel">
        <div className="notification-heading"><h3>Your waitlists</h3></div>
        {waitlist.length ? <div className="notification-list">{waitlist.map((entry) => <article className="notification-item" key={entry.id}><div><strong>{entry.doctorName} · {entry.specialization}</strong><p>{entry.department} · {new Date(`${entry.date}T12:00:00`).toLocaleDateString()} · {entry.status.toLowerCase()}</p>{entry.status === 'NOTIFIED' && <p>Time offered: {new Date(entry.offeredStartAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Claim by {new Date(entry.offerExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>}</div><div className="appointment-actions">{entry.status === 'NOTIFIED' && <button className="reschedule-button" type="button" disabled={busy} onClick={() => updateWaitlist(entry, 'claim')}>Claim time</button>}{['WAITING', 'NOTIFIED'].includes(entry.status) && <button className="cancel-button" type="button" disabled={busy} onClick={() => updateWaitlist(entry, 'withdraw')}>Leave waitlist</button>}</div></article>)}</div> : <p className="empty-state">When you join a waitlist, it will appear here.</p>}
      </div>
      <div className="notification-panel">
        <div className="notification-heading"><h3>Notifications</h3>{notifications.some((notification) => !notification.read) && <button type="button" className="text-button" onClick={markAllNotificationsRead}>Mark all read</button>}</div>
        {notifications.length ? <div className="notification-list">{notifications.map((notification) => <article className={`notification-item ${notification.read ? '' : 'unread'}`} key={notification.id}><div><strong>{notification.title}</strong><p>{notification.message}</p><time>{new Date(notification.createdAt).toLocaleString()}</time></div>{!notification.read && <button type="button" className="text-button" onClick={() => markNotificationRead(notification.id)}>Mark read</button>}</article>)}</div> : <p className="empty-state">Appointment confirmations and reminders will appear here.</p>}
      </div>
    </section>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function DoctorDashboard({ user, onSignOut }) {
  const [scheduleDate, setScheduleDate] = useState(localDateInputValue());
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
  const [appointments, setAppointments] = useState([]);
  const [scheduleMessage, setScheduleMessage] = useState('Loading your schedule…');
  const [outcomeBusyId, setOutcomeBusyId] = useState('');
  const [enabledDays, setEnabledDays] = useState([1, 2, 3, 4, 5]);
  const [times, setTimes] = useState(Object.fromEntries(WEEKDAYS.map((_, dayOfWeek) => [dayOfWeek, { startTime: '09:00', endTime: '16:00', slotMinutes: 30 }])));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest(`/appointments?date=${encodeURIComponent(scheduleDate)}`)
      .then(({ appointments: items }) => { setAppointments(items); setScheduleMessage(''); })
      .catch((error) => { setAppointments([]); setScheduleMessage(error.message); });
  }, [scheduleDate, scheduleRefresh]);

  useEffect(() => {
    apiRequest('/doctors/me/availability').then(({ availability }) => {
      setEnabledDays(availability.map((item) => item.dayOfWeek));
      setTimes((current) => Object.fromEntries(WEEKDAYS.map((_, day) => {
        const saved = availability.find((item) => item.dayOfWeek === day);
        return [day, saved ? { startTime: saved.startTime, endTime: saved.endTime, slotMinutes: saved.slotMinutes } : current[day]];
      })));
    }).catch((error) => setMessage(error.message));
  }, []);

  async function saveAvailability(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const availability = enabledDays.map((dayOfWeek) => ({ dayOfWeek, ...times[dayOfWeek] }));
      await apiRequest('/doctors/me/availability', { method: 'PUT', body: JSON.stringify({ availability }) });
      setMessage('Your weekly availability has been saved.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function recordOutcome(appointment, status) {
    setOutcomeBusyId(appointment.id);
    setScheduleMessage('');
    try {
      const result = await apiRequest(`/appointments/${encodeURIComponent(appointment.id)}/outcome`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setAppointments((items) => items.map((item) => item.id === appointment.id ? result.appointment : item));
      setScheduleMessage(`Visit recorded as ${status === 'NO_SHOW' ? 'no-show' : 'completed'}.`);
    } catch (error) { setScheduleMessage(error.message); }
    finally { setOutcomeBusyId(''); }
  }

  return <section className="dashboard-card">
    <div className="dashboard-heading"><div><p className="eyebrow">DOCTOR PORTAL</p><h2>Welcome, {user.name}</h2><p className="auth-subtitle">Set the weekly times patients can book.</p></div><button className="text-button" type="button" onClick={onSignOut}>Sign out</button></div>
    <div className="appointments-panel staff-schedule-panel">
      <div className="notification-heading"><div><h3>Daily schedule</h3><p className="analytics-caption">Appointments appear on their booked date. Select that date to view them.</p></div><div className="appointment-actions"><label className="schedule-date-label" htmlFor="doctor-schedule-date">Date<input id="doctor-schedule-date" type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label><button className="text-button" type="button" onClick={() => { setScheduleMessage('Refreshing schedule…'); setScheduleRefresh((value) => value + 1); }}>Refresh</button></div></div>
      {scheduleMessage && <p className="form-message" role="status">{scheduleMessage}</p>}
      {appointments.length ? <div className="appointment-list">{appointments.map((appointment) => <article className="appointment-item" key={appointment.id}>
        <div><strong>{appointment.patient.name}</strong><span>{new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' }).format(new Date(appointment.startAt))}–{new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' }).format(new Date(appointment.endAt))} Nigeria time</span>{appointment.reason && <span>Reason: {appointment.reason}</span>}<span className={`status status-${appointment.status.toLowerCase()}`}>{appointment.status.toLowerCase()}</span></div>
        {['PENDING', 'CONFIRMED'].includes(appointment.status) && new Date(appointment.endAt) <= new Date() && <div className="appointment-actions"><button type="button" className="reschedule-button" disabled={outcomeBusyId === appointment.id} onClick={() => recordOutcome(appointment, 'COMPLETED')}>Completed</button><button type="button" className="cancel-button" disabled={outcomeBusyId === appointment.id} onClick={() => recordOutcome(appointment, 'NO_SHOW')}>No-show</button></div>}
      </article>)}</div> : !scheduleMessage && <p className="empty-state">No appointments are scheduled for this date.</p>}
    </div>
    <form className="availability-form" onSubmit={saveAvailability}>
      {WEEKDAYS.map((day, dayOfWeek) => <div className="availability-row" key={day}>
        <label className="day-toggle"><input type="checkbox" checked={enabledDays.includes(dayOfWeek)} onChange={(event) => setEnabledDays((current) => event.target.checked ? [...current, dayOfWeek].sort() : current.filter((item) => item !== dayOfWeek))} />{day}</label>
        <input aria-label={`${day} start time`} type="time" value={times[dayOfWeek].startTime} onChange={(event) => setTimes((current) => ({ ...current, [dayOfWeek]: { ...current[dayOfWeek], startTime: event.target.value } }))} disabled={!enabledDays.includes(dayOfWeek)} />
        <span>to</span>
        <input aria-label={`${day} end time`} type="time" value={times[dayOfWeek].endTime} onChange={(event) => setTimes((current) => ({ ...current, [dayOfWeek]: { ...current[dayOfWeek], endTime: event.target.value } }))} disabled={!enabledDays.includes(dayOfWeek)} />
        <select aria-label={`${day} slot length`} value={times[dayOfWeek].slotMinutes} onChange={(event) => setTimes((current) => ({ ...current, [dayOfWeek]: { ...current[dayOfWeek], slotMinutes: Number(event.target.value) } }))} disabled={!enabledDays.includes(dayOfWeek)}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select>
      </div>)}
      {message && <p className="form-message" role="status">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save availability'}</button>
    </form>
    <DoctorNotifications />
  </section>;
}

function DoctorNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    apiRequest('/notifications').then((result) => setNotifications(result.notifications)).catch((error) => setMessage(error.message));
  }, []);
  async function markRead(id) {
    try {
      await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
      setNotifications((items) => items.map((item) => item.id === id ? { ...item, read: true } : item));
    } catch (error) {
      setMessage(error.message);
    }
  }
  return <div className="notification-panel"><div className="notification-heading"><h3>Notifications</h3></div>{message && <p className="form-message">{message}</p>}{notifications.length ? <div className="notification-list">{notifications.map((notification) => <article className={`notification-item ${notification.read ? '' : 'unread'}`} key={notification.id}><div><strong>{notification.title}</strong><p>{notification.message}</p><time>{new Date(notification.createdAt).toLocaleString()}</time></div>{!notification.read && <button type="button" className="text-button" onClick={() => markRead(notification.id)}>Mark read</button>}</article>)}</div> : <p className="empty-state">Patient confirmations and cancellations will appear here.</p>}</div>;
}

function AdminManagement({ userId }) {
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState('');
  const [userActive, setUserActive] = useState('true');
  const [userPage, setUserPage] = useState(1);
  const [userRefresh, setUserRefresh] = useState(0);
  const [userPagination, setUserPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [departments, setDepartments] = useState([]);
  const [departmentNames, setDepartmentNames] = useState({});
  const [departmentName, setDepartmentName] = useState('');
  const [assignment, setAssignment] = useState({ doctorId: '', departmentId: '', specialization: '' });
  const [doctorForm, setDoctorForm] = useState({ name: '', email: '', phone: '', password: '', departmentId: '', specialization: '', bio: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const allDoctors = departments.flatMap((department) => department.doctors.map((doctor) => ({ ...doctor, departmentId: department.id, departmentName: department.name })));

  async function loadDepartments() {
    const result = await apiRequest('/admin/departments');
    setDepartments(result.departments);
    setDepartmentNames(Object.fromEntries(result.departments.map((department) => [department.id, department.name])));
  }

  useEffect(() => { loadDepartments().catch((error) => setMessage(error.message)); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(userPage) });
      if (userSearch.trim()) params.set('search', userSearch.trim());
      if (userRole) params.set('role', userRole);
      if (userActive) params.set('active', userActive);
      apiRequest(`/admin/users?${params.toString()}`).then((result) => {
        setUsers(result.users); setUserPagination(result.pagination); setMessage('');
      }).catch((error) => setMessage(error.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [userSearch, userRole, userActive, userPage, userRefresh]);

  async function createDoctor(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await apiRequest('/admin/doctors', { method: 'POST', body: JSON.stringify(doctorForm) });
      setMessage(`Doctor account created for ${result.user.name}. Share the initial password privately.`);
      setDoctorForm({ name: '', email: '', phone: '', password: '', departmentId: '', specialization: '', bio: '' });
      setUserPage(1); setUserRefresh((value) => value + 1); await loadDepartments();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function changeUserStatus(user) {
    const isActive = !user.isActive;
    if (!isActive && !window.confirm(`Deactivate ${user.name}'s account? They will no longer be able to sign in.`)) return;
    setBusy(true); setMessage('');
    try {
      await apiRequest(`/admin/users/${encodeURIComponent(user.id)}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      setMessage(`${user.name}'s account is now ${isActive ? 'active' : 'inactive'}.`);
      const params = new URLSearchParams({ page: String(userPage) });
      if (userSearch.trim()) params.set('search', userSearch.trim());
      if (userRole) params.set('role', userRole);
      if (userActive) params.set('active', userActive);
      const result = await apiRequest(`/admin/users?${params.toString()}`);
      setUsers(result.users); setUserPagination(result.pagination);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function addDepartment(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await apiRequest('/admin/departments', { method: 'POST', body: JSON.stringify({ name: departmentName }) });
      setDepartmentName(''); setMessage('Department created.'); await loadDepartments();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function renameDepartment(departmentId) {
    setBusy(true); setMessage('');
    try {
      await apiRequest(`/admin/departments/${encodeURIComponent(departmentId)}`, { method: 'PATCH', body: JSON.stringify({ name: departmentNames[departmentId] }) });
      setMessage('Department name updated.'); await loadDepartments();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function assignDoctor(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await apiRequest(`/admin/doctors/${encodeURIComponent(assignment.doctorId)}/assignment`, { method: 'PATCH', body: JSON.stringify({ departmentId: assignment.departmentId, ...(assignment.specialization.trim() ? { specialization: assignment.specialization.trim() } : {}) }) });
      setMessage('Doctor assignment updated.'); setAssignment({ doctorId: '', departmentId: '', specialization: '' }); await loadDepartments();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <section className="management-panel">
    <div className="notification-heading"><div><h3>Account and department management</h3><p className="analytics-caption">Create doctor accounts, manage access, and maintain department assignments.</p></div></div>
    {message && <p className="form-message" role="status">{message}</p>}
    <div className="management-grid">
      <form className="management-form" onSubmit={createDoctor}>
        <h4>Create a doctor account</h4>
        <label htmlFor="doctor-name">Full name</label><input id="doctor-name" value={doctorForm.name} onChange={(event) => setDoctorForm((value) => ({ ...value, name: event.target.value }))} required minLength={2} maxLength={100} />
        <label htmlFor="doctor-email">Email</label><input id="doctor-email" type="email" value={doctorForm.email} onChange={(event) => setDoctorForm((value) => ({ ...value, email: event.target.value }))} required maxLength={254} />
        <label htmlFor="doctor-phone">Phone <span>Optional</span></label><input id="doctor-phone" value={doctorForm.phone} onChange={(event) => setDoctorForm((value) => ({ ...value, phone: event.target.value }))} maxLength={30} />
        <label htmlFor="doctor-password">Initial password</label><input id="doctor-password" type="password" autoComplete="new-password" value={doctorForm.password} onChange={(event) => setDoctorForm((value) => ({ ...value, password: event.target.value }))} required minLength={8} maxLength={72} />
        <label htmlFor="doctor-department">Department</label><select id="doctor-department" value={doctorForm.departmentId} onChange={(event) => setDoctorForm((value) => ({ ...value, departmentId: event.target.value }))} required><option value="">Select department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
        <label htmlFor="doctor-specialization">Specialization</label><input id="doctor-specialization" value={doctorForm.specialization} onChange={(event) => setDoctorForm((value) => ({ ...value, specialization: event.target.value }))} required minLength={2} maxLength={120} />
        <label htmlFor="doctor-bio">Profile summary <span>Optional</span></label><textarea id="doctor-bio" rows="2" value={doctorForm.bio} onChange={(event) => setDoctorForm((value) => ({ ...value, bio: event.target.value }))} maxLength={500} />
        <button type="submit" disabled={busy || !departments.length}>{busy ? 'Saving…' : 'Create doctor'}</button>
      </form>
      <div className="management-form">
        <h4>Departments and doctor assignments</h4>
        <form className="inline-management-form" onSubmit={addDepartment}><label htmlFor="new-department">Add department</label><div><input id="new-department" value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} required minLength={2} maxLength={100} /><button type="submit" disabled={busy}>Add</button></div></form>
        <form className="inline-management-form" onSubmit={assignDoctor}><label htmlFor="assign-doctor">Reassign doctor</label><select id="assign-doctor" value={assignment.doctorId} onChange={(event) => setAssignment((value) => ({ ...value, doctorId: event.target.value }))} required><option value="">Select doctor</option>{allDoctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.user.name} · {doctor.departmentName}</option>)}</select><label htmlFor="assign-department">New department</label><select id="assign-department" value={assignment.departmentId} onChange={(event) => setAssignment((value) => ({ ...value, departmentId: event.target.value }))} required><option value="">Select department</option>{departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select><label htmlFor="assign-specialization">Specialization <span>Optional</span></label><input id="assign-specialization" value={assignment.specialization} onChange={(event) => setAssignment((value) => ({ ...value, specialization: event.target.value }))} maxLength={120} /><button type="submit" disabled={busy || !allDoctors.length}>Save assignment</button></form>
        <div className="department-list">{departments.map((department) => <div className="department-row" key={department.id}><div className="department-rename"><input aria-label={`Department name for ${department.name}`} value={departmentNames[department.id] ?? department.name} onChange={(event) => setDepartmentNames((value) => ({ ...value, [department.id]: event.target.value }))} /><button type="button" className="text-button" disabled={busy || departmentNames[department.id] === department.name} onClick={() => renameDepartment(department.id)}>Save name</button></div><span>{department._count.doctors} doctor{department._count.doctors === 1 ? '' : 's'}</span>{department.doctors.map((doctor) => <small key={doctor.id}>{doctor.user.name} · {doctor.specialization}{doctor.user.isActive ? '' : ' · inactive'}</small>)}</div>)}</div>
      </div>
    </div>
      <div className="management-users">
      <div className="notification-heading"><h4>Accounts <span className="total-count">{userPagination.total} total</span></h4></div>
      <div className="admin-filters"><label htmlFor="account-search">Search<input id="account-search" type="search" value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserPage(1); }} placeholder="Name or email" /></label><label htmlFor="account-role">Role<select id="account-role" value={userRole} onChange={(event) => { setUserRole(event.target.value); setUserPage(1); }}><option value="">All roles</option><option value="PATIENT">Patient</option><option value="DOCTOR">Doctor</option><option value="ADMIN">Admin</option></select></label><label htmlFor="account-active">Account<select id="account-active" value={userActive} onChange={(event) => { setUserActive(event.target.value); setUserPage(1); }}><option value="true">Active</option><option value="false">Inactive</option><option value="">All accounts</option></select></label></div>
      {users.length ? <div className="management-user-list">{users.map((account) => <article className="management-user" key={account.id}><div><strong>{account.name}</strong><span>{account.email} · {account.role.toLowerCase()}</span>{account.doctorProfile && <span>{account.doctorProfile.specialization} · {account.doctorProfile.department.name}</span>}</div><button type="button" className={account.isActive ? 'cancel-button' : 'reschedule-button'} disabled={busy || (account.id === userId && account.isActive)} onClick={() => changeUserStatus(account)}>{account.isActive ? 'Deactivate' : 'Reactivate'}</button></article>)}</div> : <p className="empty-state">No accounts match these filters.</p>}
      <div className="pagination-controls"><button type="button" className="text-button" disabled={userPage <= 1} onClick={() => setUserPage((value) => value - 1)}>Previous</button><span>Page {userPage} of {Math.max(1, Math.ceil(userPagination.total / userPagination.pageSize))}</span><button type="button" className="text-button" disabled={userPage >= Math.ceil(userPagination.total / userPagination.pageSize)} onClick={() => setUserPage((value) => value + 1)}>Next</button></div>
    </div>
  </section>;
}

function AdminDashboard({ user, onSignOut }) {
  const [appointments, setAppointments] = useState([]);
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const [analyticsFrom, setAnalyticsFrom] = useState(localDateDaysAgo(29));
  const [analyticsTo, setAnalyticsTo] = useState(localDateInputValue());
  const [analytics, setAnalytics] = useState(null);
  const [patterns, setPatterns] = useState(null);
  const [analyticsMessage, setAnalyticsMessage] = useState('');
  const [analyticsBusy, setAnalyticsBusy] = useState(true);
  const [reminders, setReminders] = useState([]);
  const [reminderStatus, setReminderStatus] = useState('');
  const [reminderType, setReminderType] = useState('');
  const [reminderPage, setReminderPage] = useState(1);
  const [reminderPagination, setReminderPagination] = useState({ page: 1, pageSize: 25, total: 0 });
  const [reminderMessage, setReminderMessage] = useState('');
  const [remindersBusy, setRemindersBusy] = useState(true);
  useEffect(() => {
    setBusy(true);
    const params = new URLSearchParams({ page: String(page) });
    if (date) params.set('date', date);
    if (status) params.set('status', status);
    apiRequest(`/appointments?${params.toString()}`).then((result) => {
      setAppointments(result.appointments); setPagination(result.pagination); setMessage('');
    }).catch((error) => setMessage(error.message)).finally(() => setBusy(false));
  }, [date, status, page]);
  useEffect(() => {
    if (!analyticsFrom || !analyticsTo) {
      setAnalytics(null); setPatterns(null); setAnalyticsMessage('Choose a start and end date.'); setAnalyticsBusy(false); return;
    }
    setAnalyticsBusy(true);
    setAnalyticsMessage('');
    const params = new URLSearchParams({ from: analyticsFrom, to: analyticsTo });
    Promise.all([apiRequest(`/analytics/summary?${params.toString()}`), apiRequest(`/analytics/patterns?${params.toString()}`)]).then(([result, patternResult]) => {
      setAnalytics(result); setPatterns(patternResult.patterns); setAnalyticsMessage('');
    }).catch((error) => { setAnalytics(null); setPatterns(null); setAnalyticsMessage(error.message); })
      .finally(() => setAnalyticsBusy(false));
  }, [analyticsFrom, analyticsTo]);
  useEffect(() => {
    if (!analyticsFrom || !analyticsTo) {
      setReminders([]); setReminderMessage('Choose an analytics date range to view reminders.'); setRemindersBusy(false); return;
    }
    setRemindersBusy(true);
    const params = new URLSearchParams({ from: analyticsFrom, to: analyticsTo, page: String(reminderPage) });
    if (reminderStatus) params.set('status', reminderStatus);
    if (reminderType) params.set('type', reminderType);
    apiRequest(`/reminders?${params.toString()}`).then((result) => {
      setReminders(result.reminders); setReminderPagination(result.pagination); setReminderMessage('');
    }).catch((error) => { setReminders([]); setReminderMessage(error.message); })
      .finally(() => setRemindersBusy(false));
  }, [analyticsFrom, analyticsTo, reminderStatus, reminderType, reminderPage]);
  function updateFilter(setter, value) { setter(value); setPage(1); }
  const percentage = (value) => value == null ? 'N/A' : `${value.toFixed(1)}%`;
  async function downloadAnalyticsCsv() {
    try {
      const token = sessionStorage.getItem('care-slot-token');
      const params = new URLSearchParams({ from: analyticsFrom, to: analyticsTo });
      const response = await fetch(`${API_URL}/analytics/export.csv?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const result = await response.json(); throw new Error(result.message || 'Could not download analytics CSV.'); }
      const file = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = file; link.download = `careslot-analytics-${analyticsFrom}-to-${analyticsTo}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(file), 1000);
    } catch (error) { setAnalyticsMessage(error.message); }
  }
  const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hourLabel = (hour) => new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric' }).format(new Date(Date.UTC(2020, 0, 1, hour)));
  return <section className="dashboard-card"><div className="dashboard-heading"><div><p className="eyebrow">ADMIN PORTAL</p><h2>Welcome, {user.name}</h2><p className="auth-subtitle">Review and filter appointment activity.</p></div><button className="text-button" type="button" onClick={onSignOut}>Sign out</button></div>
    <AdminManagement userId={user.id} />
    <section className="analytics-panel">
      <div className="notification-heading"><div><h3>Appointment analytics</h3><p className="analytics-caption">Cancellation rate uses all appointments. No-show rate uses completed and no-show visits. Waitlist fill rate uses resolved offers sent in the selected period.</p></div></div>
      <div className="admin-filters analytics-date-filters"><label htmlFor="analytics-from">From<input id="analytics-from" type="date" value={analyticsFrom} max={analyticsTo} onChange={(event) => { setAnalyticsFrom(event.target.value); setReminderPage(1); }} /></label><label htmlFor="analytics-to">To<input id="analytics-to" type="date" value={analyticsTo} min={analyticsFrom} max={localDateInputValue()} onChange={(event) => { setAnalyticsTo(event.target.value); setReminderPage(1); }} /></label></div>
      {analyticsBusy && <p className="empty-state">Loading analytics…</p>}{analyticsMessage && <p className="form-message" role="status">{analyticsMessage}</p>}
      {analytics && !analyticsBusy && <><p className="analytics-period">{analytics.period.from} to {analytics.period.to} · Nigeria time</p><div className="analytics-cards">
        <article className="analytics-card"><span>Appointments</span><strong>{analytics.summary.total}</strong></article>
        <article className="analytics-card"><span>Cancelled</span><strong>{analytics.summary.cancelled}</strong><small>{percentage(analytics.summary.cancellationRate)} of all appointments</small></article>
        <article className="analytics-card"><span>Completed</span><strong>{analytics.summary.completed}</strong></article>
        <article className="analytics-card"><span>No-show</span><strong>{analytics.summary.noShow}</strong><small>{percentage(analytics.summary.noShowRate)} of {analytics.summary.outcomeCount} completed/no-show visits</small></article>
        <article className="analytics-card"><span>Waitlist slot fill</span><strong>{percentage(analytics.waitlist.fillRate)}</strong><small>{analytics.waitlist.claimed} claimed / {analytics.waitlist.resolved} resolved · {analytics.waitlist.active} active</small></article>
      </div><div className="confirmation-breakdown"><h4>No-show rate by patient confirmation</h4><div className="confirmation-cards">{analytics.confirmationBreakdown.map((item) => <article className="confirmation-card" key={item.confirmationStatus}><strong>{item.confirmationStatus === 'CONFIRMED_BY_PATIENT' ? 'Confirmed by patient' : 'Not confirmed'}</strong><span>{percentage(item.noShowRate)}</span><small>{item.noShow} no-shows · {item.completed} completed · {item.outcomeCount} outcomes</small></article>)}</div></div></>}
    </section>
    <section className="patterns-panel">
      <div className="notification-heading"><div><h3>Appointment patterns</h3><p className="analytics-caption">Appointments by Nigeria-local weekday, start hour, doctor, and department.</p></div><button type="button" className="reschedule-button export-button" disabled={analyticsBusy || !patterns} onClick={downloadAnalyticsCsv}>Download CSV</button></div>
      {analyticsBusy && <p className="empty-state">Loading patterns…</p>}
      {patterns && !analyticsBusy && <div className="pattern-tables">
        <div className="pattern-table-wrap"><h4>By weekday</h4><table><thead><tr><th>Weekday</th><th>Appointments</th></tr></thead><tbody>{patterns.weekdays.map((item) => <tr key={item.weekday}><td>{weekdayNames[item.weekday - 1]}</td><td>{item.count}</td></tr>)}</tbody></table></div>
        <div className="pattern-table-wrap"><h4>By start hour</h4><table><thead><tr><th>Hour</th><th>Appointments</th></tr></thead><tbody>{patterns.hours.filter((item) => item.count > 0).length ? patterns.hours.filter((item) => item.count > 0).map((item) => <tr key={item.hour}><td>{hourLabel(item.hour)}</td><td>{item.count}</td></tr>) : <tr><td colSpan="2">No appointments in this range.</td></tr>}</tbody></table></div>
        <div className="pattern-table-wrap"><h4>By doctor</h4><table><thead><tr><th>Doctor</th><th>Department</th><th>Appointments</th></tr></thead><tbody>{patterns.doctors.length ? patterns.doctors.map((item) => <tr key={item.doctorId}><td>{item.doctorName}</td><td>{item.departmentName}</td><td>{item.count}</td></tr>) : <tr><td colSpan="3">No appointments in this range.</td></tr>}</tbody></table></div>
        <div className="pattern-table-wrap"><h4>By department</h4><table><thead><tr><th>Department</th><th>Appointments</th></tr></thead><tbody>{patterns.departments.length ? patterns.departments.map((item) => <tr key={item.departmentId}><td>{item.departmentName}</td><td>{item.count}</td></tr>) : <tr><td colSpan="2">No appointments in this range.</td></tr>}</tbody></table></div>
      </div>}
    </section>
    <section className="reminders-panel">
      <div className="notification-heading"><div><h3>Reminder delivery</h3><p className="analytics-caption">Scheduled reminders for the selected analytics date range.</p></div><span className="total-count">{reminderPagination.total} total</span></div>
      <div className="admin-filters"><label htmlFor="reminder-status">Delivery status<select id="reminder-status" value={reminderStatus} onChange={(event) => { setReminderStatus(event.target.value); setReminderPage(1); }}><option value="">All statuses</option><option value="PENDING">Pending</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select></label><label htmlFor="reminder-type">Channel<select id="reminder-type" value={reminderType} onChange={(event) => { setReminderType(event.target.value); setReminderPage(1); }}><option value="">All channels</option><option value="EMAIL">Email</option><option value="IN_APP">In-app</option></select></label></div>
      {reminderMessage && <p className="form-message" role="status">{reminderMessage}</p>}
      {remindersBusy ? <p className="empty-state">Loading reminder records…</p> : reminders.length ? <div className="reminder-list">{reminders.map((reminder) => <article className="reminder-item" key={reminder.id}>
        <div className="reminder-main"><strong>{reminder.appointment.patientName} · {reminder.appointment.doctorName}</strong><span>Appointment: {new Date(reminder.appointment.startAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span>Reminder {reminder.type === 'EMAIL' ? 'email' : 'in-app'} · due {new Date(reminder.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
        <div className="reminder-delivery"><span className={`status status-${reminder.status.toLowerCase()}`}>{reminder.status.toLowerCase()}</span><span>{reminder.attempts} attempt{reminder.attempts === 1 ? '' : 's'}{reminder.sentAt ? ` · sent ${new Date(reminder.sentAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span>{reminder.errorMessage && <span className="reminder-error">{reminder.errorMessage}</span>}</div>
      </article>)}</div> : <p className="empty-state">No reminders match this date range and filter.</p>}
      <div className="pagination-controls"><button type="button" className="text-button" disabled={remindersBusy || reminderPage <= 1} onClick={() => setReminderPage((current) => current - 1)}>Previous</button><span>Page {reminderPage} of {Math.max(1, Math.ceil(reminderPagination.total / reminderPagination.pageSize))}</span><button type="button" className="text-button" disabled={remindersBusy || reminderPage >= Math.ceil(reminderPagination.total / reminderPagination.pageSize)} onClick={() => setReminderPage((current) => current + 1)}>Next</button></div>
    </section>
    <section className="admin-appointments-panel"><div className="notification-heading"><h3>Appointments <span className="total-count">{pagination.total} total</span></h3></div>
      <div className="admin-filters"><label htmlFor="admin-date">Date<input id="admin-date" type="date" value={date} onChange={(event) => updateFilter(setDate, event.target.value)} /></label><label htmlFor="admin-status">Status<select id="admin-status" value={status} onChange={(event) => updateFilter(setStatus, event.target.value)}><option value="">All statuses</option><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="CANCELLED">Cancelled</option><option value="COMPLETED">Completed</option><option value="NO_SHOW">No-show</option></select></label></div>
      {message && <p className="form-message" role="status">{message}</p>}{busy ? <p className="empty-state">Loading appointments…</p> : appointments.length ? <div className="appointment-list">{appointments.map((appointment) => <article className="appointment-item" key={appointment.id}><div><strong>{appointment.patient.name} with {appointment.doctor.user.name}</strong><span>{new Date(appointment.startAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><span>{appointment.doctor.specialization} · {appointment.doctor.department.name}</span><span className={`status status-${appointment.status.toLowerCase()}`}>{appointment.status.toLowerCase()}</span></div></article>)}</div> : <p className="empty-state">No appointments match these filters.</p>}
      <div className="pagination-controls"><button type="button" className="text-button" disabled={busy || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</span><button type="button" className="text-button" disabled={busy || page >= Math.ceil(pagination.total / pagination.pageSize)} onClick={() => setPage((current) => current + 1)}>Next</button></div>
    </section>
  </section>;
}

function AppointmentActionPage() {
  const [token, setToken] = useState('');
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState('Loading appointment details…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const actionToken = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (!actionToken) { setMessage('This appointment link is incomplete. Open the full link from your email.'); return; }
    setToken(actionToken);
    apiRequest('/appointment-actions/preview', { method: 'POST', body: JSON.stringify({ token: actionToken }) })
      .then((result) => { setSummary(result); setMessage(''); })
      .catch((error) => setMessage(error.message));
  }, []);

  async function submitAction(action) {
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest('/appointment-actions', { method: 'POST', body: JSON.stringify({ token, action }) });
      setSummary(result);
      setMessage(result.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const appointment = summary?.appointment;
  return <main className="page-shell">
    <nav className="nav"><Link className="brand" to="/">CareSlot</Link><span>Appointment action</span></nav>
    <div className="action-page-content">
      <section className="auth-card action-card">
        <p className="eyebrow">APPOINTMENT DETAILS</p>
        <h2>{appointment ? `${appointment.doctor.user.name}` : 'Secure appointment link'}</h2>
        {appointment && <><p className="auth-subtitle">{appointment.doctor.specialization} · {appointment.doctor.department.name}</p><p className="action-date">{new Intl.DateTimeFormat('en-NG', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(appointment.startAt))} Nigeria time</p><p className="account-role">{appointment.status.toLowerCase()}</p></>}
        {message && <p className="form-message" role="status">{message}</p>}
        {appointment && <div className="action-buttons">{summary.canConfirm && <button type="button" disabled={busy} onClick={() => submitAction('confirm')}>Confirm appointment</button>}{summary.canCancel && <button type="button" className="cancel-button" disabled={busy} onClick={() => submitAction('cancel')}>Cancel appointment</button>}</div>}
      </section>
    </div>
    <footer>For your privacy, this page shows only a brief appointment summary.</footer>
  </main>;
}

function WaitlistClaimPage() {
  const [token, setToken] = useState('');
  const [offer, setOffer] = useState(null);
  const [message, setMessage] = useState('Loading waitlist offer…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const claimToken = new URLSearchParams(window.location.hash.slice(1)).get('claim');
    if (!claimToken) { setMessage('This waitlist link is incomplete. Open the full link from your email.'); return; }
    setToken(claimToken);
    window.history.replaceState(null, '', window.location.pathname);
    apiRequest('/waitlist-actions/preview', { method: 'POST', body: JSON.stringify({ token: claimToken }) })
      .then((result) => { setOffer({ ...result.offer, doctorName: result.offer.doctor }); setMessage(''); })
      .catch((error) => setMessage(error.message));
  }, []);
  async function claim() {
    setBusy(true); setMessage('');
    try {
      const result = await apiRequest('/waitlist-actions/claim', { method: 'POST', body: JSON.stringify({ token }) });
      setMessage(result.message || 'Appointment claimed. You can sign in to manage it.');
      setOffer(null);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <main className="page-shell"><nav className="nav"><Link className="brand" to="/">CareSlot</Link><span>Waitlist offer</span></nav><div className="action-page-content"><section className="auth-card action-card"><p className="eyebrow">AVAILABLE APPOINTMENT</p><h2>{offer ? offer.doctorName : 'Secure waitlist link'}</h2>{offer && <><p className="auth-subtitle">{offer.specialization} · {offer.department}</p><p className="action-date">{new Intl.DateTimeFormat('en-NG', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(offer.startAt))} Nigeria time</p><p className="account-role">Offer expires {new Date(offer.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p><div className="action-buttons"><button type="button" disabled={busy} onClick={claim}>{busy ? 'Claiming…' : 'Claim this appointment'}</button></div></>}{message && <p className="form-message" role="status">{message}</p>}</section></div><footer>Claim links are private and expire after a short time.</footer></main>;
}

function AuthPanel() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('care-slot-token');
    if (!token) return;
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (result?.user) setUser(result.user);
        else sessionStorage.removeItem('care-slot-token');
      })
      .catch(() => setMessage('Could not reconnect to the API. Check that the server is running.'));
  }, []);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not sign in. Please try again.');
      sessionStorage.setItem('care-slot-token', result.token);
      setUser(result.user);
      setMessage(mode === 'login' ? 'You are signed in.' : 'Your patient account is ready.');
    } catch (error) {
      setMessage(error.message || 'Could not reach the API. Check that the server is running.');
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem('care-slot-token');
    setUser(null);
    setForm({ name: '', email: '', phone: '', password: '' });
    setMessage('You have signed out.');
  }

  if (user) {
    return (
      user.role === 'PATIENT' ? <PatientDashboard user={user} onSignOut={signOut} />
        : user.role === 'DOCTOR' ? <DoctorDashboard user={user} onSignOut={signOut} />
          : <AdminDashboard user={user} onSignOut={signOut} />
    );
  }

  return (
    <section className="auth-card">
      <div className="auth-tabs" role="tablist" aria-label="Account access">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setMessage(''); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setMessage(''); }}>Create account</button>
      </div>
      <h2>{mode === 'login' ? 'Welcome back' : 'Create your patient account'}</h2>
      <p className="auth-subtitle">{mode === 'login' ? 'Sign in to manage your care.' : 'A few details are all you need to get started.'}</p>
      <form onSubmit={submit}>
        {mode === 'register' && <>
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" autoComplete="name" value={form.name} onChange={updateField} required minLength={2} maxLength={100} />
          <label htmlFor="phone">Phone number <span>Optional</span></label>
          <input id="phone" name="phone" autoComplete="tel" value={form.phone} onChange={updateField} maxLength={30} />
        </>}
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" value={form.email} onChange={updateField} required maxLength={254} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={updateField} required minLength={mode === 'login' ? 1 : 8} maxLength={72} />
        {message && <p className="form-message" role="status">{message}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </section>
  );
}

function HomePage() {
  return (
    <main className="page-shell">
      <nav className="nav"><Link className="brand" to="/">CareSlot</Link><span>Appointments made simpler</span></nav>
      <div className="home-content">
        <section className="hero">
          <p className="eyebrow">MEDICAL APPOINTMENTS, MADE EASIER</p>
          <h1>More time for care.<br /><span>Less time waiting.</span></h1>
          <p className="intro">Find a doctor, book a time that works for you, and get helpful reminders before your visit.</p>
          <div className="trust-note"><span aria-hidden="true">✓</span> Private patient accounts. Simple appointment management.</div>
        </section>
        <AuthPanel />
      </div>
      <footer>Medical Appointment Scheduling System · Patient access</footer>
    </main>
  );
}

export default function App() {
  return <Routes><Route path="/appointment-action" element={<AppointmentActionPage />} /><Route path="/waitlist-claim" element={<WaitlistClaimPage />} /><Route path="*" element={<HomePage />} /></Routes>;
}
