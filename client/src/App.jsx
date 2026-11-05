import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarDays, Check, Clock3, Search, ShieldCheck, Stethoscope } from 'lucide-react';
import PatientPortal from './components/PatientPortal.jsx';
import DoctorDashboard from './components/DoctorDashboard.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';

const API_URL = import.meta.env.VITE_API_URL
  || `${window.location.origin}/api`;

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
  const navigate = useNavigate();
  const location = useLocation();
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

  useEffect(() => {
    if (!user) return;
    if (user.role === 'DOCTOR' && !location.pathname.startsWith('/access/doctor/')) {
      navigate('/access/doctor/dashboard', { replace: true });
    } else if (user.role === 'PATIENT' && !location.pathname.startsWith('/access/patient/')) {
      navigate('/access/patient/dashboard', { replace: true });
    } else if (user.role === 'ADMIN' && (location.pathname.startsWith('/access/doctor/') || location.pathname.startsWith('/access/patient/'))) {
      navigate('/access', { replace: true });
    }
  }, [user, location.pathname, navigate]);

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
    navigate('/access', { replace: true });
  }

  if (user) {
    return (
      user.role === 'PATIENT' ? <PatientPortal user={user} onSignOut={signOut} onUserUpdated={setUser} apiRequest={apiRequest} apiUrl={API_URL} />
        : user.role === 'DOCTOR' ? <DoctorDashboard user={user} onSignOut={signOut} onUserUpdated={setUser} apiRequest={apiRequest} apiUrl={API_URL} />
          : <AdminDashboard user={user} onSignOut={signOut} apiRequest={apiRequest} apiUrl={API_URL} />
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
  const navigate = useNavigate();
  const [careQuery, setCareQuery] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [visitDate, setVisitDate] = useState('');
  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/doctors/departments`).then((response) => response.ok ? response.json() : null)
      .then((result) => { if (active && result?.departments) setDepartments(result.departments); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  function searchCare(event) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (careQuery.trim()) params.set('search', careQuery.trim());
    if (departmentId) params.set('departmentId', departmentId);
    if (visitDate) params.set('date', visitDate);
    const query = params.toString();
    navigate(`/access/patient/find-care${query ? `?${query}` : ''}`);
  }
  return (
    <main className="page-shell">
      <header className="site-header">
        <nav className="site-nav" aria-label="Main navigation">
          <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true"><CalendarCheck size={23}/></span>CareSlot</Link>
          <div className="site-nav-links"><a href="#care">Find care</a><a href="#how-it-works">How it works</a><a href="#specialties">Specialties</a><Link to="/access">For doctors</Link></div>
          <details className="mobile-nav-menu"><summary>Menu</summary><div className="site-nav-links"><a href="#care">Find care</a><a href="#how-it-works">How it works</a><a href="#specialties">Specialties</a><Link to="/access">For doctors</Link></div></details>
          <Link className="site-nav-login" to="/access">Sign in</Link><Link className="site-nav-cta" to="/access">Get started <span aria-hidden="true">→</span></Link>
        </nav>
      </header>
        <section className="landing-hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow landing-project-name">Medical Appointment Scheduling System</p>
            <h1>Quality healthcare<br />booking across Nigeria.</h1>
            <p className="intro">Find and book appointments with trusted doctors, clinics, and specialists near you. Fast, secure, and hassle-free.</p>
            <div className="hero-actions"><Link className="hero-primary" to="/access">Book an appointment <span aria-hidden="true">→</span></Link><a className="hero-secondary" href="#how-it-works">How it works <span className="hero-play" aria-hidden="true">▶</span></a></div>
            <div className="trust-note"><span><ShieldCheck size={17}/></span> Secure patient accounts <i /><span><Clock3 size={17}/></span> Appointment reminders</div>
          </div>
          <div className="hero-visual" aria-label="CareSlot medical care team">
            <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
            <img className="hero-doctor-photo" src="/images/care-team-hero.webp" alt="A doctor in a white coat" fetchPriority="high" />
            <div className="visual-card doctor-card"><img src="/images/doctor-sammy.webp" alt="" /><span><strong>Find your doctor</strong><small>Browse care by specialty</small></span></div>
            <div className="visual-card schedule-card"><img src="/images/doctor-josiah.webp" alt="" /><span><strong>Choose your time</strong><small>Appointments that fit your day</small></span></div>
            <form className="hero-search-card" id="care" onSubmit={searchCare}>
              <label className="hero-search-field"><Search size={19}/><input aria-label="Doctor, department, or specialty" value={careQuery} onChange={(event) => setCareQuery(event.target.value)} placeholder="Doctor, department, or specialty" /></label>
              <div className="hero-search-row"><label className="hero-search-field"><Stethoscope size={18}/><select aria-label="Department" id="specialties" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">All departments</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label className="hero-search-field hero-date-field"><CalendarDays size={18}/><input aria-label="Preferred appointment date" type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} /></label></div>
              <button type="submit"><Search size={17}/> Search doctors</button>
            </form>
          </div>
        </section>
        <section className="care-section process-section" id="how-it-works">
          <div className="section-heading"><p className="eyebrow">SIMPLE, CLEAR, CONVENIENT</p><h2>How booking works</h2><p>Get connected with healthcare providers in three simple steps.</p></div>
          <div className="care-cards process-cards">
            <article className="care-card"><span className="care-icon"><Search size={23}/></span><h3>1. Find care</h3><p>Search doctors by name, department, or specialty.</p></article>
            <article className="care-card"><span className="care-icon"><CalendarDays size={23}/></span><h3>2. Choose a slot</h3><p>Select an available appointment time that works for you.</p></article>
            <article className="care-card"><span className="care-icon"><Check size={23}/></span><h3>3. Book &amp; visit</h3><p>Receive appointment updates and manage your visit in one place.</p></article>
          </div>
        </section>
      <footer className="site-footer project-footer"><Link className="brand" to="/"><span className="brand-mark" aria-hidden="true"><CalendarCheck size={19}/></span>CareSlot</Link><span>Thoughtful scheduling for better-connected care.</span><p>CareSlot is a seminar project by <strong>Rabiu Salman</strong> and <strong>Azhise Samson Patrick</strong> at <strong>Federal University Dutsin-Ma</strong>.</p><a href="#top">Back to top ↑</a></footer>
    </main>
  );
}

function AccessPage() {
  return <main className="page-shell access-page">
    <header className="site-header"><nav className="site-nav" aria-label="Account navigation"><Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">+</span>CareSlot</Link><Link className="site-nav-login" to="/">Back to home</Link></nav></header>
    <section className="access-screen"><div className="access-copy"><p className="eyebrow">YOUR CARE, IN ONE PLACE</p><h1>Welcome to<br /><span>CareSlot.</span></h1><p>Sign in to manage appointments, or create a patient account to get started.</p><div className="access-points"><span>✓ Find doctors by specialty</span><span>✓ Book available appointment times</span><span>✓ Keep upcoming visits organized</span></div></div><div className="access-card"><AuthPanel /></div></section>
    <footer className="site-footer"><Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">+</span>CareSlot</Link><span>Thoughtful scheduling for better-connected care.</span></footer>
  </main>;
}

export default function App() {
  return <Routes><Route path="/appointment-action" element={<AppointmentActionPage />} /><Route path="/waitlist-claim" element={<WaitlistClaimPage />} /><Route path="/access/*" element={<AccessPage />} /><Route path="*" element={<HomePage />} /></Routes>;
}
