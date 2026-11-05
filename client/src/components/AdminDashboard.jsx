import { useEffect, useState } from 'react';
import { Activity, BarChart3, CalendarDays, ChevronRight, ClipboardList, LayoutDashboard, LogOut, Search, Stethoscope, UsersRound } from 'lucide-react';

function localDateInputValue() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateDaysAgo(days) {
  const date = new Date(`${localDateInputValue()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const ADMIN_PAGES = {
  dashboard: ['Dashboard', 'Operational overview and recent appointment activity.'],
  appointments: ['Appointments', 'Search and review appointments across the service.'],
  doctors: ['Doctors', 'Create doctor accounts and review active assignments.'],
  patients: ['Patients', 'Search patient accounts and manage access.'],
  accounts: ['Accounts', 'Review all accounts and manage sign-in access.'],
  departments: ['Departments', 'Maintain department names and doctor assignments.'],
  analytics: ['Analytics', 'Review service performance and appointment patterns.'],
  reminders: ['Reminder delivery', 'Inspect scheduled reminder delivery and failures.'],
};
const ADMIN_NAV = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['appointments', 'Appointments', CalendarDays],
  ['doctors', 'Doctors', Stethoscope],
  ['patients', 'Patients', UsersRound],
  ['accounts', 'Accounts', ClipboardList],
  ['departments', 'Departments', Activity],
  ['analytics', 'Analytics', BarChart3],
  ['reminders', 'Reminders', CalendarDays],
];

export default function AdminDashboard({ user, onSignOut, apiRequest, apiUrl }) {
  const route = window.location.pathname.replace(/\/+$/, '').split('/').pop();
  const activePage = ADMIN_PAGES[route] ? route : 'dashboard';
  const [appointments, setAppointments] = useState([]);
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
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
  const [activeDoctorCount, setActiveDoctorCount] = useState(null);
  const [patientCount, setPatientCount] = useState(null);

  useEffect(() => {
    if (!['dashboard', 'appointments'].includes(activePage)) return undefined;
    let active = true;
    setBusy(true);
    const params = new URLSearchParams({ page: String(page) });
    if (date) params.set('date', date);
    if (status) params.set('status', status);
    if (patientSearch.trim()) params.set('patient', patientSearch.trim());
    if (doctorSearch.trim()) params.set('doctor', doctorSearch.trim());
    if (globalSearch.trim()) params.set('search', globalSearch.trim());
    apiRequest(`/appointments?${params.toString()}`).then((result) => {
      if (active) { setAppointments(result.appointments); setPagination(result.pagination); setMessage(''); }
    }).catch((error) => { if (active) setMessage(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [date, status, patientSearch, doctorSearch, globalSearch, page, apiRequest, activePage]);

  useEffect(() => {
    if (!['dashboard', 'analytics'].includes(activePage)) return undefined;
    let active = true;
    if (!analyticsFrom || !analyticsTo) {
      setAnalytics(null); setPatterns(null); setAnalyticsMessage('Choose a start and end date.'); setAnalyticsBusy(false); return;
    }
    setAnalyticsBusy(true);
    setAnalyticsMessage('');
    const params = new URLSearchParams({ from: analyticsFrom, to: analyticsTo });
    const requests = [apiRequest(`/analytics/summary?${params.toString()}`)];
    if (activePage === 'analytics') requests.push(apiRequest(`/analytics/patterns?${params.toString()}`));
    Promise.all(requests).then(([result, patternResult]) => {
      if (!active) return;
      setAnalytics(result); setPatterns(patternResult?.patterns || null); setAnalyticsMessage('');
    }).catch((error) => { if (active) { setAnalytics(null); setPatterns(null); setAnalyticsMessage(error.message); } })
      .finally(() => { if (active) setAnalyticsBusy(false); });
    return () => { active = false; };
  }, [analyticsFrom, analyticsTo, apiRequest, activePage]);

  useEffect(() => {
    if (activePage !== 'reminders') return undefined;
    let active = true;
    if (!analyticsFrom || !analyticsTo) {
      setReminders([]); setReminderMessage('Choose a date range to view reminders.'); setRemindersBusy(false); return undefined;
    }
    setRemindersBusy(true);
    const params = new URLSearchParams({ from: analyticsFrom, to: analyticsTo, page: String(reminderPage) });
    if (reminderStatus) params.set('status', reminderStatus);
    if (reminderType) params.set('type', reminderType);
    apiRequest(`/reminders?${params.toString()}`).then((result) => {
      if (active) { setReminders(result.reminders); setReminderPagination(result.pagination); setReminderMessage(''); }
    }).catch((error) => { if (active) { setReminders([]); setReminderMessage(error.message); } })
      .finally(() => { if (active) setRemindersBusy(false); });
    return () => { active = false; };
  }, [analyticsFrom, analyticsTo, reminderStatus, reminderType, reminderPage, apiRequest, activePage]);

  useEffect(() => {
    if (activePage !== 'dashboard') return undefined;
    let active = true;
    const params = new URLSearchParams({ active: 'true', page: '1' });
    Promise.all([apiRequest(`/admin/users?role=DOCTOR&${params}`), apiRequest(`/admin/users?role=PATIENT&${params}`)])
      .then(([doctors, patients]) => { if (active) { setActiveDoctorCount(doctors.pagination.total); setPatientCount(patients.pagination.total); } })
      .catch(() => { if (active) { setActiveDoctorCount(null); setPatientCount(null); } });
    return () => { active = false; };
  }, [apiRequest, activePage]);

  function updateFilter(setter, value) { setter(value); setPage(1); }
  function submitGlobalSearch(event) {
    event.preventDefault();
    if (activePage !== 'appointments') {
      const params = new URLSearchParams(); if (globalSearch.trim()) params.set('search', globalSearch.trim());
      window.location.href = `${routeLink('appointments')}${params.size ? `?${params}` : ''}`;
    } else setPage(1);
  }
  const percentage = (value) => value == null ? 'N/A' : `${value.toFixed(1)}%`;

  async function downloadAnalyticsCsv() {
    try {
      const token = sessionStorage.getItem('care-slot-token');
      const params = new URLSearchParams({ from: analyticsFrom, to: analyticsTo });
      const response = await fetch(`${apiUrl}/analytics/export.csv?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const result = await response.json(); throw new Error(result.message || 'Could not download analytics CSV.'); }
      const file = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = file; link.download = `careslot-analytics-${analyticsFrom}-to-${analyticsTo}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(file), 1000);
    } catch (error) { setAnalyticsMessage(error.message); }
  }

  const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hourLabel = (hour) => new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric' }).format(new Date(Date.UTC(2020, 0, 1, hour)));
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const reminderPageCount = Math.max(1, Math.ceil(reminderPagination.total / reminderPagination.pageSize));
  const dateLabel = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${localDateInputValue()}T12:00:00+01:00`));
  const timeLabel = (value) => new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const routeLink = (target) => `/access/admin/${target}`;

  function renderAppointmentRows(rows, compact = false) {
    if (busy) return <p className="empty-state">Loading appointments…</p>;
    if (!rows.length) return <p className="empty-state">No appointments match these filters.</p>;
    return <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>Patient</th><th>Assigned doctor</th><th>Date &amp; time</th><th>Status</th></tr></thead><tbody>{rows.map((appointment) => <tr key={appointment.id}><td><strong>{appointment.patient.name}</strong></td><td><strong>{appointment.doctor.user.name}</strong><small>{appointment.doctor.specialization} · {appointment.doctor.department.name}</small></td><td>{timeLabel(appointment.startAt)}</td><td><span className={`admin-status status-${appointment.status.toLowerCase()}`}>{appointment.status.toLowerCase().replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div>;
  }

  return <div className="admin-portal">
    <aside className="admin-sidebar"><a href="/" className="admin-brand"><span aria-hidden="true">✚</span>CareSlot</a><p>ADMINISTRATION</p><nav aria-label="Administration">{ADMIN_NAV.map(([id, label, Icon]) => <a key={id} href={routeLink(id)} className={activePage === id ? 'active' : ''}><Icon size={18}/>{label}</a>)}</nav><div className="admin-sidebar-user"><span>{user.name.trim().split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase()}</span><div><strong>{user.name}</strong><small>Administrator</small></div><button type="button" aria-label="Sign out" onClick={onSignOut}><LogOut size={16}/></button></div></aside>
    <main className="admin-portal-main"><header className="admin-topbar"><div className="admin-page-heading"><p className="admin-eyebrow">CARESLOT ADMINISTRATION</p><h1>{ADMIN_PAGES[activePage][0]}</h1><p>{ADMIN_PAGES[activePage][1]}</p></div><div className="admin-topbar-tools"><span className="admin-date-chip"><CalendarDays size={16}/>{dateLabel}</span><form className="admin-top-search" onSubmit={submitGlobalSearch}><Search size={17}/><input aria-label="Search appointments by patient or doctor" placeholder="Search patients or doctors" value={globalSearch} onChange={(event)=>setGlobalSearch(event.target.value)}/><button type="submit">Search</button></form><button className="admin-user-button" type="button" onClick={onSignOut} title="Sign out"><span>{user.name.trim().split(/\s+/).map((part)=>part[0]).slice(0,2).join('').toUpperCase()}</span><strong>Sign out</strong></button></div></header>
      <div className="admin-page-content">
        {(activePage === 'dashboard' || activePage === 'appointments') && message && <p className="admin-page-alert" role="alert">{message}</p>}
        {activePage === 'dashboard' && <>
          <section className="admin-metric-grid"><article><span><CalendarDays size={18}/></span><div><small>Appointments, selected period</small><strong>{analyticsBusy ? '—' : analytics?.summary.total ?? 0}</strong><em>{analyticsFrom} to {analyticsTo}</em></div></article><article><span><Stethoscope size={18}/></span><div><small>Active doctors</small><strong>{activeDoctorCount ?? '—'}</strong><em>With active sign-in access</em></div></article><article><span><UsersRound size={18}/></span><div><small>Patient accounts</small><strong>{patientCount ?? '—'}</strong><em>Registered patients</em></div></article></section>
          <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Recent appointments</h2><p>Latest appointment activity · times in Nigeria time</p></div><a className="admin-primary-link" href={routeLink('appointments')}>All appointments <ChevronRight size={15}/></a></div>{renderAppointmentRows(appointments.slice(0, 7), true)}</section>
          <section className="admin-shortcut-grid"><a href={routeLink('doctors')}><Stethoscope size={18}/><span><strong>Create a doctor account</strong><small>Add a clinician and assign their department</small></span><ChevronRight size={16}/></a><a href={routeLink('analytics')}><BarChart3 size={18}/><span><strong>Review service performance</strong><small>Explore appointment patterns and outcomes</small></span><ChevronRight size={16}/></a><a href={routeLink('reminders')}><CalendarDays size={18}/><span><strong>Reminder delivery</strong><small>Inspect sent, pending, and failed reminders</small></span><ChevronRight size={16}/></a></section>
        </>}
        {activePage === 'appointments' && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Appointment management</h2><p>{pagination.total} records · Search by patient or doctor and narrow by date or status.</p></div><span className="admin-record-count">{pagination.total} total</span></div><div className="admin-filter-grid"><label>Patient<input type="search" value={patientSearch} onChange={(event)=>updateFilter(setPatientSearch,event.target.value)} placeholder="Patient name"/></label><label>Doctor<input type="search" value={doctorSearch} onChange={(event)=>updateFilter(setDoctorSearch,event.target.value)} placeholder="Doctor name"/></label><label>Date<input type="date" value={date} onChange={(event)=>updateFilter(setDate,event.target.value)}/></label><label>Status<select value={status} onChange={(event)=>updateFilter(setStatus,event.target.value)}><option value="">All statuses</option><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="CANCELLED">Cancelled</option><option value="COMPLETED">Completed</option><option value="NO_SHOW">No-show</option></select></label></div>{renderAppointmentRows(appointments)}<div className="admin-pagination"><span>Page {page} of {pageCount}</span><div><button type="button" disabled={busy||page<=1} onClick={()=>setPage((n)=>n-1)}>Previous</button><button type="button" disabled={busy||page>=pageCount} onClick={()=>setPage((n)=>n+1)}>Next</button></div></div></section>}
        {['doctors','patients','accounts','departments'].includes(activePage) && <AdminManagement key={activePage} userId={user.id} apiRequest={apiRequest} view={activePage}/>}
        {activePage === 'analytics' && <>
          <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Appointment analytics</h2><p>Cancellation rate uses all appointments; no-show rate uses completed and no-show visits.</p></div><button type="button" className="admin-outline-button" disabled={analyticsBusy||!patterns} onClick={downloadAnalyticsCsv}>Download CSV</button></div><div className="admin-filter-grid analytics-date-filters"><label>From<input type="date" value={analyticsFrom} max={analyticsTo} onChange={(event)=>{setAnalyticsFrom(event.target.value);setReminderPage(1);}}/></label><label>To<input type="date" value={analyticsTo} min={analyticsFrom} max={localDateInputValue()} onChange={(event)=>{setAnalyticsTo(event.target.value);setReminderPage(1);}}/></label></div>{analyticsBusy&&<p className="empty-state">Loading analytics…</p>}{analyticsMessage&&<p className="admin-page-alert" role="alert">{analyticsMessage}</p>}{analytics&&!analyticsBusy&&<><div className="admin-metric-grid analytics-metric-grid"><article><span>Appointments</span><strong>{analytics.summary.total}</strong></article><article><span>Cancelled</span><strong>{analytics.summary.cancelled}</strong><em>{percentage(analytics.summary.cancellationRate)} of all appointments</em></article><article><span>Completed</span><strong>{analytics.summary.completed}</strong></article><article><span>No-show</span><strong>{analytics.summary.noShow}</strong><em>{percentage(analytics.summary.noShowRate)} of {analytics.summary.outcomeCount} outcomes</em></article><article><span>Waitlist fill rate</span><strong>{percentage(analytics.waitlist.fillRate)}</strong><em>{analytics.waitlist.claimed} claimed · {analytics.waitlist.active} active</em></article></div><div className="admin-confirmation-breakdown"><h3>No-show rate by patient confirmation</h3><div>{analytics.confirmationBreakdown.map((item)=><article key={item.confirmationStatus}><strong>{item.confirmationStatus==='CONFIRMED_BY_PATIENT'?'Confirmed by patient':'Not confirmed'}</strong><span>{percentage(item.noShowRate)}</span><small>{item.noShow} no-shows · {item.completed} completed</small></article>)}</div></div></>}</section>
          <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Appointment patterns</h2><p>By Nigeria-local weekday, start hour, doctor, and department.</p></div></div>{patterns&&!analyticsBusy&&<div className="pattern-tables"><div className="pattern-table-wrap"><h4>By weekday</h4><table><thead><tr><th>Weekday</th><th>Appointments</th></tr></thead><tbody>{patterns.weekdays.map((item)=><tr key={item.weekday}><td>{weekdayNames[item.weekday-1]}</td><td>{item.count}</td></tr>)}</tbody></table></div><div className="pattern-table-wrap"><h4>By start hour</h4><table><thead><tr><th>Hour</th><th>Appointments</th></tr></thead><tbody>{patterns.hours.filter((item)=>item.count>0).length?patterns.hours.filter((item)=>item.count>0).map((item)=><tr key={item.hour}><td>{hourLabel(item.hour)}</td><td>{item.count}</td></tr>):<tr><td colSpan="2">No appointments in this range.</td></tr>}</tbody></table></div><div className="pattern-table-wrap"><h4>By doctor</h4><table><thead><tr><th>Doctor</th><th>Department</th><th>Appointments</th></tr></thead><tbody>{patterns.doctors.length?patterns.doctors.map((item)=><tr key={item.doctorId}><td>{item.doctorName}</td><td>{item.departmentName}</td><td>{item.count}</td></tr>):<tr><td colSpan="3">No appointments in this range.</td></tr>}</tbody></table></div><div className="pattern-table-wrap"><h4>By department</h4><table><thead><tr><th>Department</th><th>Appointments</th></tr></thead><tbody>{patterns.departments.length?patterns.departments.map((item)=><tr key={item.departmentId}><td>{item.departmentName}</td><td>{item.count}</td></tr>):<tr><td colSpan="2">No appointments in this range.</td></tr>}</tbody></table></div></div>}</section>
        </>}
        {activePage === 'reminders' && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Reminder delivery</h2><p>Scheduled, sent, and failed email or in-app reminders.</p></div><span className="admin-record-count">{reminderPagination.total} total</span></div><div className="admin-filter-grid"><label>From<input type="date" value={analyticsFrom} max={analyticsTo} onChange={(event)=>{setAnalyticsFrom(event.target.value);setReminderPage(1);}}/></label><label>To<input type="date" value={analyticsTo} min={analyticsFrom} max={localDateInputValue()} onChange={(event)=>{setAnalyticsTo(event.target.value);setReminderPage(1);}}/></label><label>Delivery status<select value={reminderStatus} onChange={(event)=>{setReminderStatus(event.target.value);setReminderPage(1);}}><option value="">All statuses</option><option value="PENDING">Pending</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select></label><label>Channel<select value={reminderType} onChange={(event)=>{setReminderType(event.target.value);setReminderPage(1);}}><option value="">All channels</option><option value="EMAIL">Email</option><option value="IN_APP">In-app</option></select></label></div>{reminderMessage&&<p className="admin-page-alert" role="alert">{reminderMessage}</p>}{remindersBusy?<p className="empty-state">Loading reminder records…</p>:reminders.length?<div className="reminder-list">{reminders.map((reminder)=><article className="reminder-item" key={reminder.id}><div className="reminder-main"><strong>{reminder.appointment.patientName} · {reminder.appointment.doctorName}</strong><span>Appointment: {timeLabel(reminder.appointment.startAt)}</span><span>{reminder.type==='EMAIL'?'Email':'In-app'} reminder · due {timeLabel(reminder.scheduledFor)}</span></div><div className="reminder-delivery"><span className={`status status-${reminder.status.toLowerCase()}`}>{reminder.status.toLowerCase()}</span><span>{reminder.attempts} attempt{reminder.attempts===1?'':'s'}{reminder.sentAt?` · sent ${timeLabel(reminder.sentAt)}`:''}</span>{reminder.errorMessage&&<span className="reminder-error">{reminder.errorMessage}</span>}</div></article>)}</div>:<p className="empty-state">No reminders match this date range and filter.</p>}<div className="admin-pagination"><span>Page {reminderPage} of {reminderPageCount}</span><div><button type="button" disabled={remindersBusy||reminderPage<=1} onClick={()=>setReminderPage((n)=>n-1)}>Previous</button><button type="button" disabled={remindersBusy||reminderPage>=reminderPageCount} onClick={()=>setReminderPage((n)=>n+1)}>Next</button></div></div></section>}
      </div><footer className="admin-footer"><span>CareSlot administration</span><span>Appointment times shown in Africa/Lagos</span></footer>
    </main>
  </div>;
}

function AdminManagement({ userId, apiRequest, view }) {
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState(view === 'patients' ? 'PATIENT' : view === 'doctors' ? 'DOCTOR' : '');
  const [userActive, setUserActive] = useState('true');
  const [userPage, setUserPage] = useState(1);
  const [userRefresh, setUserRefresh] = useState(0);
  const [usersLoading, setUsersLoading] = useState(true);
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

  useEffect(() => { loadDepartments().catch((error) => setMessage(error.message)); }, [apiRequest]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setUsersLoading(true);
      const params = new URLSearchParams({ page: String(userPage) });
      if (userSearch.trim()) params.set('search', userSearch.trim());
      if (userRole) params.set('role', userRole);
      if (userActive) params.set('active', userActive);
      apiRequest(`/admin/users?${params.toString()}`).then((result) => {
        if (active) { setUsers(result.users); setUserPagination(result.pagination); setMessage(''); }
      }).catch((error) => { if (active) setMessage(error.message); }).finally(() => { if (active) setUsersLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [userSearch, userRole, userActive, userPage, userRefresh, apiRequest]);

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

  async function changeUserStatus(account) {
    const isActive = !account.isActive;
    if (!isActive && !window.confirm(`Deactivate ${account.name}'s account? They will no longer be able to sign in.`)) return;
    setBusy(true); setMessage('');
    try {
      await apiRequest(`/admin/users/${encodeURIComponent(account.id)}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      setMessage(`${account.name}'s account is now ${isActive ? 'active' : 'inactive'}.`);
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

  const heading = view === 'doctors' ? 'Doctor directory and setup' : view === 'patients' ? 'Patient accounts' : view === 'departments' ? 'Department management' : 'Account management';
  return <section className="management-panel admin-management-page">
    <div className="notification-heading"><div><h2>{heading}</h2><p className="analytics-caption">{view === 'doctors' ? 'Create clinician accounts, review assignments, and manage doctor access.' : view === 'patients' ? 'Search patient accounts and manage access.' : view === 'departments' ? 'Maintain departments and assign doctors to the right service.' : 'Search accounts by name, email, and role, then manage sign-in access.'}</p></div></div>
    {message && <p className="form-message" role="status">{message}</p>}
    {(view === 'doctors' || view === 'departments') && <div className={`management-grid${view === 'departments' ? ' admin-department-grid' : ''}`}>
      {view === 'doctors' && <form className="management-form" onSubmit={createDoctor}>
        <h4>Create a doctor account</h4>
        <p className="form-helper">Enter the doctor’s work email and a temporary password, then share the sign-in details with them privately. Their account will appear in doctor search after creation.</p>
        <label htmlFor="doctor-name">Full name</label><input id="doctor-name" value={doctorForm.name} onChange={(event) => setDoctorForm((value) => ({ ...value, name: event.target.value }))} required minLength={2} maxLength={100} />
        <label htmlFor="doctor-email">Email</label><input id="doctor-email" type="email" value={doctorForm.email} onChange={(event) => setDoctorForm((value) => ({ ...value, email: event.target.value }))} required maxLength={254} />
        <label htmlFor="doctor-phone">Phone <span>Optional</span></label><input id="doctor-phone" value={doctorForm.phone} onChange={(event) => setDoctorForm((value) => ({ ...value, phone: event.target.value }))} maxLength={30} />
        <label htmlFor="doctor-password">Initial password</label><input id="doctor-password" type="password" autoComplete="new-password" value={doctorForm.password} onChange={(event) => setDoctorForm((value) => ({ ...value, password: event.target.value }))} required minLength={8} maxLength={72} />
        <label htmlFor="doctor-department">Department</label><select id="doctor-department" value={doctorForm.departmentId} onChange={(event) => setDoctorForm((value) => ({ ...value, departmentId: event.target.value }))} required><option value="">Select department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
        <label htmlFor="doctor-specialization">Specialization</label><input id="doctor-specialization" value={doctorForm.specialization} onChange={(event) => setDoctorForm((value) => ({ ...value, specialization: event.target.value }))} required minLength={2} maxLength={120} />
        <label htmlFor="doctor-bio">Profile summary <span>Optional</span></label><textarea id="doctor-bio" rows="2" value={doctorForm.bio} onChange={(event) => setDoctorForm((value) => ({ ...value, bio: event.target.value }))} maxLength={500} />
        <button type="submit" disabled={busy || !departments.length}>{busy ? 'Saving…' : 'Create doctor'}</button>
      </form>}
      <div className="management-form">
        <h4>{view === 'doctors' ? 'Assignment overview' : 'Departments and doctor assignments'}</h4>
        {view === 'departments' && <form className="inline-management-form" onSubmit={addDepartment}><label htmlFor="new-department">Add department</label><div><input id="new-department" value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} required minLength={2} maxLength={100} /><button type="submit" disabled={busy}>Add</button></div></form>}
        <form className="inline-management-form" onSubmit={assignDoctor}><label htmlFor="assign-doctor">Reassign doctor</label><select id="assign-doctor" value={assignment.doctorId} onChange={(event) => setAssignment((value) => ({ ...value, doctorId: event.target.value }))} required><option value="">Select doctor</option>{allDoctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.user.name} · {doctor.departmentName}</option>)}</select><label htmlFor="assign-department">New department</label><select id="assign-department" value={assignment.departmentId} onChange={(event) => setAssignment((value) => ({ ...value, departmentId: event.target.value }))} required><option value="">Select department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select><label htmlFor="assign-specialization">Specialization <span>Optional</span></label><input id="assign-specialization" value={assignment.specialization} onChange={(event) => setAssignment((value) => ({ ...value, specialization: event.target.value }))} maxLength={120} /><button type="submit" disabled={busy || !allDoctors.length}>Save assignment</button></form>
        <div className="department-list">{departments.map((department) => <div className="department-row" key={department.id}>{view === 'departments' ? <div className="department-rename"><input aria-label={`Department name for ${department.name}`} value={departmentNames[department.id] ?? department.name} onChange={(event) => setDepartmentNames((value) => ({ ...value, [department.id]: event.target.value }))} /><button type="button" className="text-button" disabled={busy || departmentNames[department.id] === department.name} onClick={() => renameDepartment(department.id)}>Save name</button></div> : <strong>{department.name}</strong>}<span>{department._count.doctors} doctor{department._count.doctors === 1 ? '' : 's'}</span>{department.doctors.map((doctor) => <small key={doctor.id}>{doctor.user.name} · {doctor.specialization}{doctor.user.isActive ? '' : ' · inactive'}</small>)}</div>)}</div>
      </div>
    </div>}
    {['accounts','patients','doctors'].includes(view) && <div className="management-users">
      <div className="notification-heading"><h3>{view === 'patients' ? 'Patient accounts' : view === 'doctors' ? 'Doctor accounts' : 'All accounts'} <span className="total-count">{userPagination.total} total</span></h3></div>
      <div className="admin-filters"><label htmlFor="account-search">Search<input id="account-search" type="search" value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserPage(1); }} placeholder="Name or email" /></label>{view === 'accounts' && <label htmlFor="account-role">Role<select id="account-role" value={userRole} onChange={(event) => { setUserRole(event.target.value); setUserPage(1); }}><option value="">All roles</option><option value="PATIENT">Patient</option><option value="DOCTOR">Doctor</option><option value="ADMIN">Admin</option></select></label>}<label htmlFor="account-active">Account<select id="account-active" value={userActive} onChange={(event) => { setUserActive(event.target.value); setUserPage(1); }}><option value="true">Active</option><option value="false">Inactive</option><option value="">All accounts</option></select></label></div>
      {usersLoading ? <p className="empty-state">Loading accounts…</p> : users.length ? <div className="management-user-list">{users.map((account) => <article className="management-user" key={account.id}><div><strong>{account.name}</strong><span>{account.email} · {account.role.toLowerCase()}</span>{account.doctorProfile && <span>{account.doctorProfile.specialization} · {account.doctorProfile.department.name}</span>}</div><button type="button" className={account.isActive ? 'cancel-button' : 'reschedule-button'} disabled={busy || (account.id === userId && account.isActive)} onClick={() => changeUserStatus(account)}>{account.isActive ? 'Deactivate' : 'Reactivate'}</button></article>)}</div> : <p className="empty-state">No accounts match these filters.</p>}
      <div className="pagination-controls"><button type="button" className="text-button" disabled={userPage <= 1} onClick={() => setUserPage((value) => value - 1)}>Previous</button><span>Page {userPage} of {Math.max(1, Math.ceil(userPagination.total / userPagination.pageSize))}</span><button type="button" className="text-button" disabled={userPage >= Math.ceil(userPagination.total / userPagination.pageSize)} onClick={() => setUserPage((value) => value + 1)}>Next</button></div>
    </div>}
  </section>;
}
