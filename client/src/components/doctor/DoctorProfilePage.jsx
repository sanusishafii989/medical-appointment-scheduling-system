import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Save, Trash2 } from 'lucide-react';
import { getInitials } from './doctor-utils.js';

async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
  let image;
  if (typeof createImageBitmap === 'function') {
    try { image = await createImageBitmap(file); } catch { /* Use the image element fallback below. */ }
  }
  if (!image) {
    const source = URL.createObjectURL(file);
    try {
      image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('This image could not be opened. Choose another photo.'));
        element.src = source;
      });
    } finally { URL.revokeObjectURL(source); }
  }
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  if (!width || !height) throw new Error('This image could not be opened. Choose another photo.');
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Photo editing is unavailable in this browser.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  // JPEG encoding is broadly supported, including browsers that cannot encode WebP.
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not prepare this image.')), 'image/jpeg', 0.8));
  if (blob.size > 2 * 1024 * 1024) throw new Error('This photo is still too large after resizing. Choose a smaller image.');
  return blob;
}

export default function DoctorProfilePage({ apiRequest, apiUrl, user, profile, profileImageUrl, onProfileUpdated, onProfileImageUpdated }) {
  const [form, setForm] = useState({ name: user.name || '', phone: user.phone || '', specialization: '', bio: '' });
  const [hasPhoto, setHasPhoto] = useState(Boolean(profile?.hasProfileImage));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const photoInput = useRef(null);
  useEffect(() => { let active = true; apiRequest('/doctors/me/profile').then(({ profile: p }) => { if (active) { setForm({ name: p.user.name || '', phone: p.user.phone || '', specialization: p.specialization || '', bio: p.bio || '' }); setHasPhoto(p.hasProfileImage); } }).catch((e) => { if (active) setError(e.message); }); return () => { active = false; }; }, [apiRequest]);
  function change(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }
  async function save(event) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const result = await apiRequest('/doctors/me/profile', { method: 'PUT', body: JSON.stringify(form) }); setForm({ name: result.user.name, phone: result.user.phone || '', specialization: result.profile.specialization, bio: result.profile.bio || '' }); setHasPhoto(result.profile.hasProfileImage); onProfileUpdated?.(result.profile); setMessage('Your professional profile has been updated.'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function upload(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setBusy(true); setError(''); setMessage(''); try { const blob = await preparePhoto(file); const token = sessionStorage.getItem('care-slot-token'); const response = await fetch(`${apiUrl}/doctors/me/profile-image`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type }, body: blob }); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Could not upload profile photo.'); setHasPhoto(result.hasProfileImage); onProfileImageUpdated?.(); setMessage('Profile photo updated.'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function removePhoto() { setBusy(true); setError(''); setMessage(''); try { await apiRequest('/doctors/me/profile-image', { method: 'DELETE' }); setHasPhoto(false); onProfileImageUpdated?.(); setMessage('Profile photo removed.'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="doctor-page-content doctor-profile-content">
    {error && <p className="doctor-page-alert" role="alert">{error}</p>}{message && <p className="doctor-page-success" role="status">{message}</p>}
    <section className="doctor-page-panel doctor-profile-photo-panel"><div className="doctor-profile-photo">{profileImageUrl ? <img src={profileImageUrl} alt="Your profile" /> : <span>{getInitials(form.name)}</span>}</div><div className="doctor-profile-photo-copy"><h2>Profile photo</h2><p>Use a clear headshot. Images are resized and stored privately with your doctor profile.</p><div className="doctor-profile-photo-actions"><button type="button" className="doctor-secondary-button" disabled={busy} onClick={() => photoInput.current?.click()}><ImagePlus size={16} />{hasPhoto ? 'Change photo' : 'Upload photo'}</button>{hasPhoto && <button type="button" className="doctor-danger-button" disabled={busy} onClick={removePhoto}><Trash2 size={15} />Remove</button>}<input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} hidden /></div></div><span className="doctor-photo-note"><Camera size={15} /> JPEG, PNG, or WebP · up to 8 MB</span></section>
    <section className="doctor-page-panel"><div className="doctor-page-panel-heading"><div><h2>Professional information</h2><p>Keep the details patients see accurate and current.</p></div></div><form className="doctor-profile-form" onSubmit={save}><div className="doctor-profile-form-grid"><label>Full name<input name="name" autoComplete="name" value={form.name} onChange={change} required minLength={2} maxLength={100} /></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={change} maxLength={30} placeholder="Add a contact number" /></label><label>Email address<input value={user.email || ''} readOnly disabled /><small>Managed by your account sign-in.</small></label><label>Department<input value={profile?.department?.name || 'Not assigned'} readOnly disabled /><small>Contact an administrator to change department.</small></label><label className="doctor-profile-full-field">Specialization<input name="specialization" value={form.specialization} onChange={change} required minLength={2} maxLength={120} /></label><label className="doctor-profile-full-field">Professional bio<textarea name="bio" rows="5" maxLength={500} value={form.bio} onChange={change} placeholder="Share your clinical focus and experience with patients." /><small>{form.bio.length}/500 characters</small></label></div><div className="doctor-profile-form-footer"><span>Changes update your doctor profile.</span><button className="doctor-save-button" disabled={busy} type="submit"><Save size={16} />{busy ? 'Saving…' : 'Save profile'}</button></div></form></section>
  </div>;
}
