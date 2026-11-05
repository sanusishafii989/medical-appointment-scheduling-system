import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMPTY_TIME = { startTime: '09:00', endTime: '16:00', slotMinutes: 30 };

export default function DoctorAvailabilityPage({ apiRequest }) {
  const [enabledDays, setEnabledDays] = useState([1, 2, 3, 4, 5]);
  const [times, setTimes] = useState(Object.fromEntries(WEEKDAYS.map((_, day) => [day, { ...EMPTY_TIME }])));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest('/doctors/me/availability')
      .then(({ availability }) => {
        if (!active) return;
        setEnabledDays(availability.map((item) => item.dayOfWeek));
        setTimes((current) => Object.fromEntries(WEEKDAYS.map((_, day) => {
          const saved = availability.find((item) => item.dayOfWeek === day);
          return [day, saved ? { startTime: saved.startTime, endTime: saved.endTime, slotMinutes: saved.slotMinutes } : current[day]];
        })));
      })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest]);

  const weeklyHours = useMemo(() => enabledDays.reduce((total, day) => {
    const { startTime, endTime } = times[day];
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    return total + Math.max(0, (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60);
  }, 0), [enabledDays, times]);

  async function saveAvailability(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const availability = enabledDays.map((dayOfWeek) => ({ dayOfWeek, ...times[dayOfWeek] }));
      const result = await apiRequest('/doctors/me/availability', { method: 'PUT', body: JSON.stringify({ availability }) });
      setEnabledDays(result.availability.map((item) => item.dayOfWeek));
      setMessage('Your weekly availability has been saved. Patients can book the open hours shown here.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="doctor-page-content">
    <section className="doctor-availability-summary-row">
      <article><span className="doctor-metric-icon tone-teal"><CheckCircle2 size={19} /></span><div><small>Working days</small><strong>{enabledDays.length} of 7</strong></div></article>
      <article><span className="doctor-metric-icon tone-blue"><Clock3 size={19} /></span><div><small>Available hours</small><strong>{weeklyHours.toLocaleString('en-NG', { maximumFractionDigits: 1 })} hrs / week</strong></div></article>
    </section>

    <section className="doctor-page-panel doctor-availability-page-panel">
      <div className="doctor-page-panel-heading"><div><h2>Weekly schedule</h2><p>Set one bookable time window and appointment length for each day.</p></div></div>
      {error && <p className="doctor-page-alert" role="alert">{error}</p>}
      {message && <p className="doctor-page-success" role="status">{message}</p>}
      {loading ? <div className="doctor-loading-state"><span className="doctor-spinner" />Loading availability…</div> : <form className="doctor-availability-form" onSubmit={saveAvailability}>
        <div className="doctor-availability-head" aria-hidden="true"><span>Day</span><span>Start time</span><span></span><span>End time</span><span>Appointment length</span></div>
        {WEEKDAYS.map((day, dayOfWeek) => <div className={`doctor-availability-row${enabledDays.includes(dayOfWeek) ? '' : ' is-off'}`} key={day}>
          <label className="doctor-day-toggle"><input type="checkbox" aria-label={day} checked={enabledDays.includes(dayOfWeek)} onChange={(event) => setEnabledDays((current) => event.target.checked ? [...current, dayOfWeek].sort() : current.filter((item) => item !== dayOfWeek))} /><span>{day}</span></label>
          <label className="doctor-time-field"><span className="mobile-field-label">Start time</span><input aria-label={`${day} start time`} type="time" value={times[dayOfWeek].startTime} onChange={(event) => setTimes((current) => ({ ...current, [dayOfWeek]: { ...current[dayOfWeek], startTime: event.target.value } }))} disabled={!enabledDays.includes(dayOfWeek)} /></label>
          <span className="doctor-time-separator">to</span>
          <label className="doctor-time-field"><span className="mobile-field-label">End time</span><input aria-label={`${day} end time`} type="time" value={times[dayOfWeek].endTime} onChange={(event) => setTimes((current) => ({ ...current, [dayOfWeek]: { ...current[dayOfWeek], endTime: event.target.value } }))} disabled={!enabledDays.includes(dayOfWeek)} /></label>
          <label className="doctor-slot-field"><span className="mobile-field-label">Slot length</span><select aria-label={`${day} slot length`} value={times[dayOfWeek].slotMinutes} onChange={(event) => setTimes((current) => ({ ...current, [dayOfWeek]: { ...current[dayOfWeek], slotMinutes: Number(event.target.value) } }))} disabled={!enabledDays.includes(dayOfWeek)}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option><option value={120}>120 minutes</option></select></label>
        </div>)}
        <div className="doctor-availability-footer"><span>Changes apply to future bookable appointment slots.</span><button className="doctor-save-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save availability'}</button></div>
      </form>}
    </section>
  </div>;
}
