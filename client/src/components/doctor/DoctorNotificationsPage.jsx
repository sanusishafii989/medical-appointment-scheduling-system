import { useEffect, useState } from 'react';
import { Bell, CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate } from './doctor-utils.js';

export default function DoctorNotificationsPage({ apiRequest, onUnreadCountChange }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ notifications: [], unread: 0, pagination: { total: 0, pageSize: 20 } });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try {
      const next = await apiRequest(`/notifications?page=${page}&read=${filter}`);
      setData(next); onUnreadCountChange?.(next.unread);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [apiRequest, filter, page]);
  async function markRead(id) {
    setBusy(true);
    try { await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function markAllRead() {
    setBusy(true);
    try { await apiRequest('/notifications/read-all', { method: 'PATCH' }); setPage(1); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const pageCount = Math.max(1, Math.ceil((data.pagination?.total || 0) / (data.pagination?.pageSize || 20)));
  return <div className="doctor-page-content">
    {error && <p className="doctor-page-alert" role="alert">{error}</p>}
    <section className="doctor-page-panel">
      <div className="doctor-page-panel-heading doctor-notification-heading"><div><h2>Updates</h2><p>{data.unread} unread notification{data.unread === 1 ? '' : 's'}</p></div><button className="doctor-secondary-button" type="button" disabled={busy || !data.unread} onClick={markAllRead}><CheckCheck size={16} />Mark all read</button></div>
      <div className="doctor-filter-tabs" role="group" aria-label="Filter notifications">{[['all','All'],['unread','Unread'],['read','Read']].map(([key,label]) => <button key={key} type="button" className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => { setPage(1); setFilter(key); }}>{label}</button>)}</div>
      {loading ? <div className="doctor-loading-state"><span className="doctor-spinner" />Loading notifications…</div> : data.notifications.length ? <div className="doctor-notification-list">{data.notifications.map((item) => <article className={`doctor-notification-card${item.read ? '' : ' unread'}`} key={item.id}><span className="doctor-notification-icon"><Bell size={18} /></span><div className="doctor-notification-copy"><div className="doctor-notification-title"><h3>{item.title}</h3>{!item.read && <span>New</span>}</div><p>{item.message}</p><time dateTime={item.createdAt}>{formatDate(item.createdAt, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' }).format(new Date(item.createdAt))}</time></div>{!item.read && <button className="doctor-text-action" type="button" disabled={busy} onClick={() => markRead(item.id)}>Mark read</button>}</article>)}</div> : <div className="doctor-empty-state"><Bell size={24} /><strong>You’re all caught up</strong><span>No {filter === 'all' ? '' : `${filter} `}notifications to show.</span></div>}
      {!loading && pageCount > 1 && <div className="doctor-pagination"><span>Page {page} of {pageCount}</span><div><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}><ChevronLeft size={16} /></button><button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((x) => x + 1)}><ChevronRight size={16} /></button></div></div>}
    </section>
  </div>;
}
