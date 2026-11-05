import { useEffect, useState } from 'react';
import AccountProfilePhoto from './AccountProfilePhoto.jsx';

export default function PatientAccountSettings({ user, onUserUpdated, apiRequest, apiUrl, profileImageUrl, onProfilePhotoChanged }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone || '');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadSettings, setReloadSettings] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me')
      .then(({ user: account }) => {
        if (!active) return;
        setName(account.name);
        setEmail(account.email);
        setPhone(account.phone || '');
        setEmailEnabled(account.notificationPreference?.emailEnabled ?? true);
        setInAppEnabled(account.notificationPreference?.inAppEnabled ?? true);
      })
      .catch((error) => {
        if (active) {
          setLoadError(true);
          setMessage(error.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [user.id, reloadSettings]);

  async function saveSettings(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          phone,
          notificationPreference: { emailEnabled, inAppEnabled },
        }),
      });
      setName(result.user.name);
      setEmail(result.user.email);
      setPhone(result.user.phone || '');
      setEmailEnabled(result.user.notificationPreference.emailEnabled);
      setInAppEnabled(result.user.notificationPreference.inAppEnabled);
      onUserUpdated(result.user);
      setMessage('Your profile and notification preferences have been saved.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="management-panel patient-settings-panel" aria-labelledby="patient-settings-title">
      <div className="notification-heading">
        <div><h3 id="patient-settings-title">Profile and preferences</h3><p className="analytics-caption">Manage your contact details and appointment reminder channels.</p></div>
      </div>
      <AccountProfilePhoto apiUrl={apiUrl} apiRequest={apiRequest} user={user} imageUrl={profileImageUrl} onImageChanged={onProfilePhotoChanged} />
      {loading ? <p className="empty-state">Loading your account settings…</p> : loadError ? (
        <div><p className="form-message" role="alert">{message}</p><button className="text-button" type="button" onClick={() => { setMessage(''); setLoading(true); setLoadError(false); setReloadSettings((value) => value + 1); }}>Retry loading settings</button></div>
      ) : (
        <form className="management-form patient-settings-form" onSubmit={saveSettings}>
          <div className="profile-settings-grid">
            <label htmlFor="patient-name">Full name<input id="patient-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} /></label>
            <label htmlFor="patient-email">Email address<input id="patient-email" type="email" value={email} readOnly aria-describedby="patient-email-help" /><small id="patient-email-help">Contact support if you need to change your email address.</small></label>
            <label htmlFor="patient-phone">Phone number <span>Optional</span><input id="patient-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} /></label>
          </div>
          <fieldset className="preference-options">
            <legend>Appointment reminders</legend>
            <label className="settings-toggle"><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} /><span><strong>Email confirmations and reminders</strong><small>Receive appointment confirmations, waitlist offers, and scheduled email reminders.</small></span></label>
            <label className="settings-toggle"><input type="checkbox" checked={inAppEnabled} onChange={(event) => setInAppEnabled(event.target.checked)} /><span><strong>In-app reminders</strong><small>Receive scheduled appointment reminders in the app.</small></span></label>
          </fieldset>
          {message && <p className="form-message" role="status">{message}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        </form>
      )}
    </section>
  );
}
