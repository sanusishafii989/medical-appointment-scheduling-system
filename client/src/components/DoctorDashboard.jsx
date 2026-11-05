import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Settings2,
  UserRound,
  UsersRound,
} from 'lucide-react';
import DoctorDashboardPage from './doctor/DoctorDashboardPage.jsx';
import DoctorAppointmentsPage from './doctor/DoctorAppointmentsPage.jsx';
import DoctorPatientsPage from './doctor/DoctorPatientsPage.jsx';
import DoctorAvailabilityPage from './doctor/DoctorAvailabilityPage.jsx';
import DoctorNotificationsPage from './doctor/DoctorNotificationsPage.jsx';
import DoctorProfilePage from './doctor/DoctorProfilePage.jsx';
import { getInitials } from './doctor/doctor-utils.js';

const BASE = '/access/doctor';
const PAGE_META = {
  dashboard: { title: 'Dashboard', subtitle: 'Your practice at a glance.' },
  appointments: { title: 'Appointments', subtitle: 'Review your schedule and record visit outcomes.' },
  patients: { title: 'Patients', subtitle: 'People you have appointments with.' },
  availability: { title: 'Availability', subtitle: 'Manage the weekly times patients can book.' },
  notifications: { title: 'Notifications', subtitle: 'Patient confirmations and appointment updates.' },
  profile: { title: 'Profile', subtitle: 'Keep your professional details up to date.' },
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'patients', label: 'Patients', icon: UsersRound },
  { id: 'availability', label: 'Availability', icon: Settings2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
];

function Avatar({ name, src, className = '' }) {
  return src
    ? <img className={`doctor-avatar ${className}`} src={src} alt={`${name} profile`} />
    : <span className={`doctor-avatar doctor-avatar-fallback ${className}`} aria-label={`${name} initials`}>{getInitials(name)}</span>;
}

export default function DoctorDashboard({ user, onSignOut, onUserUpdated, apiRequest, apiUrl }) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = location.pathname.replace(/\/+$/, '').split('/').pop();
  const [profile, setProfile] = useState(null);
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [photoRevision, setPhotoRevision] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (location.pathname === '/access' || location.pathname === '/access/doctor') {
      navigate(`${BASE}/dashboard`, { replace: true });
    } else if (!PAGE_META[page]) {
      navigate(`${BASE}/dashboard`, { replace: true });
    }
  }, [location.pathname, navigate, page]);

  useEffect(() => {
    let active = true;
    apiRequest('/doctors/me/profile')
      .then((result) => { if (active) setProfile(result.profile); })
      .catch(() => { if (active) setProfile(null); });
    apiRequest('/notifications?page=1')
      .then((result) => { if (active) setUnreadCount(result.unread || 0); })
      .catch(() => { if (active) setUnreadCount(0); });
    return () => { active = false; };
  }, [apiRequest]);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setProfileImageUrl('');
    const token = sessionStorage.getItem('care-slot-token');
    if (!token) return () => { active = false; };
    fetch(`${apiUrl}/doctors/me/profile-image`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => response.ok ? response.blob() : null)
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setProfileImageUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiUrl, photoRevision]);

  const meta = PAGE_META[page] || PAGE_META.dashboard;
  const pageProps = {
    apiRequest,
    apiUrl,
    user,
    profile,
    profileImageUrl,
    onProfileUpdated: (nextProfile) => {
      setProfile(nextProfile);
      if (nextProfile?.user) onUserUpdated?.(nextProfile.user);
      setPhotoRevision((value) => value + 1);
    },
    onProfileImageUpdated: () => setPhotoRevision((value) => value + 1),
  };

  let Page = DoctorDashboardPage;
  if (page === 'appointments') Page = DoctorAppointmentsPage;
  else if (page === 'patients') Page = DoctorPatientsPage;
  else if (page === 'availability') Page = DoctorAvailabilityPage;
  else if (page === 'notifications') Page = DoctorNotificationsPage;
  else if (page === 'profile') Page = DoctorProfilePage;
  else if (page !== 'dashboard') return <Navigate to={`${BASE}/dashboard`} replace />;

  return (
    <div className="doctor-dashboard doctor-dashboard-portal">
      <aside className="doctor-sidebar">
        <Link className="doctor-brand" to={`${BASE}/dashboard`}><span aria-hidden="true">✚</span>CareSlot</Link>
        <p className="doctor-nav-label">WORKSPACE</p>
        <nav className="doctor-nav" aria-label="Doctor portal">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <NavLink key={id} to={`${BASE}/${id}`} className={({ isActive }) => `doctor-nav-link${isActive ? ' active' : ''}`}>
              <Icon size={18} aria-hidden="true" />{label}
              {id === 'notifications' && unreadCount > 0 && <span className="doctor-nav-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="doctor-sidebar-profile">
          <NavLink to={`${BASE}/profile`} className={({ isActive }) => `doctor-sidebar-account${isActive ? ' active' : ''}`}>
            <Avatar name={user.name} src={profileImageUrl} />
            <span className="doctor-sidebar-person"><strong>{user.name}</strong><small>{profile?.specialization || 'Doctor account'}</small></span>
            <UserRound size={15} aria-hidden="true" />
          </NavLink>
          <button type="button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={16} /></button>
        </div>
      </aside>

      <main className="doctor-dashboard-content">
        <header className="doctor-page-header">
          <div><p className="eyebrow">DOCTOR PORTAL</p><h1>{meta.title}</h1><p>{meta.subtitle}</p></div>
        </header>
        <Page {...pageProps} onUnreadCountChange={setUnreadCount} />
      </main>
    </div>
  );
}
