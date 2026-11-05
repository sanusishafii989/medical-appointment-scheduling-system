import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, RefreshCw } from 'lucide-react';
import { formatDateOnly, formatTime, localDateInputValue, shiftDate, statusLabel } from './doctor-utils.js';

const FILTERS = [
  ['ALL', 'All'], ['PENDING', 'Pending'], ['CONFIRMED', 'Confirmed'],
  ['COMPLETED', 'Completed'], ['NO_SHOW', 'No-show'], ['CANCELLED', 'Cancelled'],
];

export default function DoctorAppointmentsPage({ apiRequest }) {
  const location = useLocation();
  const requestedDate = new URLSearchParams(location.search).get('date');
  const [date, setDate] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '') ? requestedDate : localDateInputValue());
  const [status, setStatus] = useState('ALL');
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '')) setDate(requestedDate);
  }, [requestedDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const statusQuery = status === 'ALL' ? '' : `&status=${encodeURIComponent(status)}`;
    apiRequest(`/appointments?date=${encodeURIComponent(date)}${statusQuery}`)
      .then((result) => { if (active) setAppointments(result.appointments || []); })
      .catch((requestError) => { if (active) { setAppointments([]); setError(requestError.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest, date, status, refreshKey]);

  async function recordOutcome(appointment, nextStatus) {
    setBusyId(appointment.id);
    setMessage('');
    try {
      const result = await apiRequest(`/appointments/${encodeURIComponent(appointment.id)}/outcome`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setAppointments((items) => items.map((item) => item.id === appointment.id ? result.appointment : item));
      setMessage(nextStatus === 'COMPLETED' ? 'Visit marked completed.' : 'Visit marked as no-show.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId('');
    }
  }

  return <div className="doctor-page-content">
    <section className="doctor-page-panel doctor-appointments-toolbar">
      <div className="doctor-date-toolbar">
        <div><p className="doctor-field-label">Schedule date</p><h2>{formatDateOnly(date)}</h2></div>
        <div className="doctor-date-controls">
          <button type="button" aria-label="Previous day" onClick={() => setDate((current) => shiftDate(current, -1))}><ChevronLeft size={17} /></button>
          <input aria-label="Schedule date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <button type="button" aria-label="Next day" onClick={() => setDate((current) => shiftDate(current, 1))}><ChevronRight size={17} /></button>
        </div>
        <button className="doctor-secondary-button" type="button" onClick={() => setDate(localDateInputValue())}>Today</button>
        <button className="doctor-icon-button" type="button" aria-label="Refresh appointments" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={16} /></button>
      </div>
      <div className="doctor-status-filter" role="group" aria-label="Filter appointments by status">
        {FILTERS.map(([value, label]) => <button type="button" className={status === value ? 'active' : ''} key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
    </section>

    {error && <p className="doctor-page-alert" role="alert">{error}</p>}
    {message && <p className="doctor-page-success" role="status">{message}</p>}

    <section className="doctor-page-panel doctor-appointments-list-panel">
      <div className="doctor-page-panel-heading"><div><h2>Appointments</h2><p>{formatDateOnly(date)} · times shown in Nigeria time</p></div><span className="doctor-count-chip">{loading ? 'Loading…' : `${appointments.length} ${appointments.length === 1 ? 'appointment' : 'appointments'}`}</span></div>
      {loading ? <div className="doctor-loading-state"><span className="doctor-spinner" />Loading schedule…</div> : appointments.length ? (
        <div className="doctor-appointments-list">
          {appointments.map((appointment) => {
            const canRecord = ['PENDING', 'CONFIRMED'].includes(appointment.status) && new Date(appointment.endAt) <= new Date();
            return <article className="doctor-appointment-card" key={appointment.id}>
              <div className="doctor-appointment-card-time"><strong>{formatTime(appointment.startAt)}</strong><span><Clock3 size={13} />{formatTime(appointment.endAt)}</span></div>
              <div className="doctor-appointment-card-main"><strong>{appointment.patient.name}</strong><span>{appointment.reason || 'No appointment reason provided.'}</span><Link to="/access/doctor/patients">View patient</Link></div>
              <div className="doctor-appointment-card-meta"><span className={`doctor-status status-${appointment.status.toLowerCase()}`}>{statusLabel(appointment.status)}</span>{appointment.confirmationStatus === 'CONFIRMED_BY_PATIENT' && <span className="doctor-confirmation-chip">Patient confirmed</span>}</div>
              {canRecord && <div className="doctor-outcome-actions"><button type="button" disabled={busyId === appointment.id} onClick={() => recordOutcome(appointment, 'COMPLETED')}>Mark completed</button><button className="doctor-no-show-button" type="button" disabled={busyId === appointment.id} onClick={() => recordOutcome(appointment, 'NO_SHOW')}>Mark no-show</button></div>}
            </article>;
          })}
        </div>
      ) : <div className="doctor-empty-state"><CalendarDays size={24} /><strong>No appointments found</strong><span>Try another date or clear the status filter.</span></div>}
    </section>
  </div>;
}
