import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CS';
}

async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
  let image;
  if (typeof createImageBitmap === 'function') {
    try { image = await createImageBitmap(file); } catch { /* Use the image element fallback. */ }
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
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not prepare this image.')), 'image/jpeg', 0.8));
  if (blob.size > 2 * 1024 * 1024) throw new Error('This photo is still too large after resizing. Choose a smaller image.');
  return blob;
}

export function useAccountProfilePhoto(apiUrl) {
  const [imageUrl, setImageUrl] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    const token = sessionStorage.getItem('care-slot-token');
    fetch(`${apiUrl}/auth/me/profile-image`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => response.ok ? response.blob() : null)
      .then((blob) => {
        if (!active) return;
        if (blob) objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => { if (active) setImageUrl(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiUrl, revision]);
  return [imageUrl, () => setRevision((value) => value + 1)];
}

export default function AccountProfilePhoto({ apiUrl, apiRequest, user, imageUrl, onImageChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const blob = await preparePhoto(file);
      const token = sessionStorage.getItem('care-slot-token');
      const response = await fetch(`${apiUrl}/auth/me/profile-image`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type }, body: blob });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not upload profile photo.');
      onImageChanged?.(); setMessage('Your profile photo has been updated.');
    } catch (uploadError) { setError(uploadError.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(''); setMessage('');
    try { await apiRequest('/auth/me/profile-image', { method: 'DELETE' }); onImageChanged?.(); setMessage('Your profile photo has been removed.'); }
    catch (removeError) { setError(removeError.message); }
    finally { setBusy(false); }
  }
  return <section className="account-photo-card" aria-label="Profile photo">
    <div className="account-photo-avatar">{imageUrl ? <img src={imageUrl} alt={`${user.name} profile`} /> : <span>{initials(user.name)}</span>}</div>
    <div className="account-photo-copy"><h3>Profile photo</h3><p>Add a clear photo so your account is easy to recognize. Your image is stored privately.</p>
      <div className="account-photo-actions"><button type="button" className="account-photo-upload" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={16}/>{busy ? 'Working…' : imageUrl ? 'Change photo' : 'Upload photo'}</button>{imageUrl && <button type="button" className="account-photo-remove" disabled={busy} onClick={remove}><Trash2 size={15}/>Remove</button>}<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} hidden/></div>
      <small><Camera size={13}/> JPEG, PNG, or WebP · up to 8 MB</small>
      {error && <p className="account-photo-error" role="alert">{error}</p>}{message && <p className="account-photo-success" role="status">{message}</p>}
    </div>
  </section>;
}
