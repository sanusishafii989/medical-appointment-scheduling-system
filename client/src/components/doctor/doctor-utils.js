export const TIME_ZONE = 'Africa/Lagos';

export function localDateInputValue(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDate(value, amount) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function formatDate(value, options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-NG', { ...options, timeZone: TIME_ZONE }).format(new Date(value));
}

export function formatDateOnly(value, options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-NG', { ...options, timeZone: TIME_ZONE }).format(new Date(`${value}T12:00:00+01:00`));
}

export function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-NG', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function statusLabel(status = '') {
  return status.toLowerCase().replaceAll('_', ' ');
}

export function getInitials(name = '') {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'DR';
}
