import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarDays, CheckCircle2, Clock3, ChevronRight, UserRound } from 'lucide-react';
import { formatDateOnly, formatTime, localDateInputValue, statusLabel } from './doctor-utils.js';

function Metric({ icon: Icon, label, value, detail, tone = 'teal' }) {
  return <article className="doctor-metric-card">
    <span className={`doctor-metric-icon tone-${tone}`}><Icon size={19} aria-hidden="true" /></span>
    <span className="doctor-metric-label">{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>;
}

function AppointmentPreview({ appointment }) {
  return <article className="doctor-preview-appointment">
    <div className="doctor-preview-time"><strong>{formatTime(appointment.startAt)}</strong><span>{formatTime(appointment.endAt)}</span></div>
    <span className="doctor-preview-divider" aria-hidden="true" />
    <div className="doctor-preview-person"><strong>{appointment.patient.name}</strong><span>{appointment.reason || 'No reason provided'}</span></div>
    <span className={`doctor-status status-${appointment.status.toLowerCase()}`}>{statusLabel(appointment.status)}</span>
  </article>;
}

export default function DoctorDashboardPage({ apiRequest }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest('/doctors/me/summary')
      .then((result) => { if (active) { setSummary(result); setError(''); } })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest]);

  const today = summary?.date || localDateInputValue();
  const nextAppointment = summary?.upcomingAppointments?.[0];

  return <div className="doctor-page-content">
    {error && <p className="doctor-page-alert" role="alert">{error}</p>}
    <section className="doctor-metrics-grid" aria-label="Practice summary">
      <Metric icon={CalendarDays} label="Today’s appointments" value={loading ? '—' : summary?.today.total ?? 0} detail={formatDateOnly(today, { weekday: 'short', month: 'short', day: 'numeric' })} />
      <Metric icon={Clock3} label="Upcoming visits" value={loading ? '—' : summary?.upcomingCount ?? 0} detail="Pending or confirmed" tone="blue" />
      <Metric icon={CheckCircle2} label="Completed today" value={loading ? '—' : summary?.today.completed ?? 0} detail="Visit outcomes recorded" tone="green" />
      <Metric icon={Bell} label="Unread updates" value={loading ? '—' : summary?.unreadNotifications ?? 0} detail="Patient confirmations and changes" tone="amber" />
    </section>

    <div className="doctor-dashboard-panels">
      <section className="doctor-page-panel">
        <div className="doctor-page-panel-heading">
          <div><h2>Today’s schedule</h2><p>{formatDateOnly(today)}</p></div>
          <Link className="doctor-text-link" to={`/access/doctor/appointments?date=${today}`}>View schedule <ChevronRight size={15} /></Link>
        </div>
        {loading ? <p className="doctor-empty-state">Loading appointments…</p> : summary?.todayAppointments?.length ? (
          <div className="doctor-preview-list">{summary.todayAppointments.slice(0, 6).map((appointment) => <AppointmentPreview key={appointment.id} appointment={appointment} />)}</div>
        ) : <div className="doctor-empty-state"><CalendarDays size={22} /><strong>No appointments today</strong><span>Your day is clear. Check another date in your appointments.</span></div>}
      </section>

      <aside className="doctor-page-panel doctor-next-panel">
        <div className="doctor-page-panel-heading"><div><h2>Next appointment</h2><p>Your next scheduled visit</p></div><span className="doctor-panel-icon"><Clock3 size={18} /></span></div>
        {loading ? <p className="doctor-empty-state">Loading your next visit…</p> : nextAppointment ? <>
          <p className="doctor-next-date">{formatDateOnly(nextAppointment.startAt, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <div className="doctor-next-patient"><span className="doctor-next-avatar"><UserRound size={20} /></span><div><strong>{nextAppointment.patient.name}</strong><small>{formatTime(nextAppointment.startAt)} · Nigeria time</small></div></div>
          <p className="doctor-next-reason">{nextAppointment.reason || 'No appointment reason provided.'}</p>
          <span className={`doctor-status status-${nextAppointment.status.toLowerCase()}`}>{statusLabel(nextAppointment.status)}</span>
        </> : <div className="doctor-empty-state"><Clock3 size={22} /><strong>No upcoming visits</strong><span>New appointments will appear here.</span></div>}
      </aside>
    </div>

    <section className="doctor-dashboard-shortcuts">
      <Link to="/access/doctor/availability"><CalendarDays size={18} /><span><strong>Manage availability</strong><small>Update your weekly booking hours</small></span><ChevronRight size={16} /></Link>
      <Link to="/access/doctor/patients"><UserRound size={18} /><span><strong>Patient list</strong><small>Review people you have seen</small></span><ChevronRight size={16} /></Link>
      <Link to="/access/doctor/notifications"><Bell size={18} /><span><strong>Notifications</strong><small>See appointment updates</small></span><ChevronRight size={16} /></Link>
    </section>
  </div>;
}
