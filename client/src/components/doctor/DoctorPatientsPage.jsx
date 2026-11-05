import { useEffect, useState } from 'react';
import { Search, UserRound, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { formatDate, formatTime, statusLabel } from './doctor-utils.js';

export default function DoctorPatientsPage({ apiRequest }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ patients: [], pagination: { total: 0, totalPages: 1 } });
  const [selectedId, setSelectedId] = useState('');
  const [patientDetail, setPatientDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setSearch(searchInput.trim()); }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiRequest(`/doctors/me/patients?page=${page}&search=${encodeURIComponent(search)}`)
      .then((nextResult) => {
        if (!active) return;
        setResult(nextResult);
        setSelectedId((current) => nextResult.patients.some((patient) => patient.id === current) ? current : (nextResult.patients[0]?.id || ''));
      })
      .catch((requestError) => { if (active) { setError(requestError.message); setResult({ patients: [], pagination: { total: 0, totalPages: 1 } }); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiRequest, page, search]);

  useEffect(() => {
    if (!selectedId) { setPatientDetail(null); return undefined; }
    let active = true;
    setDetailLoading(true);
    apiRequest(`/doctors/me/patients/${encodeURIComponent(selectedId)}`)
      .then((detail) => { if (active) { setPatientDetail(detail); setError(''); } })
      .catch((requestError) => { if (active) { setPatientDetail(null); setError(requestError.message); } })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [apiRequest, selectedId]);

  return <div className="doctor-page-content">
    {error && <p className="doctor-page-alert" role="alert">{error}</p>}
    <div className="doctor-patients-layout">
      <section className="doctor-page-panel doctor-patient-list-panel">
        <div className="doctor-page-panel-heading"><div><h2>My patients</h2><p>{result.pagination.total} patient{result.pagination.total === 1 ? '' : 's'} in your appointment history</p></div></div>
        <label className="doctor-search-field"><Search size={17} /><span className="doctor-visually-hidden">Search patients by name</span><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search patients" /></label>
        {loading ? <div className="doctor-loading-state"><span className="doctor-spinner" />Loading patients…</div> : result.patients.length ? <>
          <div className="doctor-patient-list">
            {result.patients.map((patient) => <button type="button" className={`doctor-patient-list-item${selectedId === patient.id ? ' active' : ''}`} key={patient.id} onClick={() => setSelectedId(patient.id)} aria-pressed={selectedId === patient.id}>
              <span className="doctor-patient-list-avatar">{patient.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
              <span className="doctor-patient-list-copy"><strong>{patient.name}</strong><small>{patient.completedVisits} completed visit{patient.completedVisits === 1 ? '' : 's'}</small></span>
              <ChevronRight size={16} />
            </button>)}
          </div>
          <div className="doctor-pagination"><span>Page {page} of {Math.max(1, result.pagination.totalPages)}</span><div><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><button type="button" aria-label="Next page" disabled={page >= result.pagination.totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></div>
        </> : <div className="doctor-empty-state"><UserRound size={23} /><strong>No patients found</strong><span>{search ? 'Try a different name.' : 'Patients with appointments will appear here.'}</span></div>}
      </section>

      <section className="doctor-page-panel doctor-patient-detail-panel" aria-live="polite">
        {detailLoading ? <div className="doctor-loading-state"><span className="doctor-spinner" />Loading patient history…</div> : patientDetail ? <>
          <div className="doctor-patient-detail-header"><span className="doctor-patient-detail-avatar">{patientDetail.patient.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><p className="doctor-field-label">PATIENT</p><h2>{patientDetail.patient.name}</h2></div></div>
          <div className="doctor-patient-detail-stats"><div><small>Completed visits</small><strong>{result.patients.find((item) => item.id === selectedId)?.completedVisits ?? 0}</strong></div><div><small>Last visit</small><strong>{formatDate(result.patients.find((item) => item.id === selectedId)?.lastVisitAt, { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div></div>
          <div className="doctor-history-heading"><h3>Appointment history</h3><span>{patientDetail.appointments.length} records</span></div>
          {patientDetail.appointments.length ? <div className="doctor-history-list">{patientDetail.appointments.map((appointment) => <article className="doctor-history-item" key={appointment.id}>
            <span className="doctor-history-date"><CalendarDays size={15} />{formatDate(appointment.startAt, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span className="doctor-history-time">{formatTime(appointment.startAt)} · {formatTime(appointment.endAt)}</span>
            <span className={`doctor-status status-${appointment.status.toLowerCase()}`}>{statusLabel(appointment.status)}</span>
            <p>{appointment.reason || 'No appointment reason recorded.'}</p>
          </article>)}</div> : <p className="doctor-empty-state">No appointment history is available.</p>}
        </> : <div className="doctor-empty-state"><UserRound size={24} /><strong>Select a patient</strong><span>Choose a patient to view appointment history.</span></div>}
      </section>
    </div>
  </div>;
}
