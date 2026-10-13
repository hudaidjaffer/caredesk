export const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseLocal(s) {
  const [d, t = '00:00'] = String(s).split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h || 0, mi || 0);
}

export const fmtDate = (s) => (s ? parseLocal(String(s).slice(0, 10)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtTime = (s) => (s ? parseLocal(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
export const fmtDateTime = (s) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');
export const fmtIso = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtIsoTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtIso(iso);
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const safeColor = (c, fallback = '#0e7c86') => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback);
export const fullName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim();

export function age(dob) {
  if (!dob) return '';
  const b = parseLocal(dob);
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t < new Date(t.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a >= 0 ? `${a} yrs` : '';
}

export function currencySymbol(cur) {
  const s = cur || '$';
  return /[a-z]$/i.test(s) ? `${s} ` : s;      // "Rs 1,200.00" but "$1,200.00"
}

export function moneyFormatter(currency) {
  const sym = currencySymbol(currency);
  return (c) => {
    const n = Number(c || 0);
    const abs = (Math.abs(n) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? '−' : ''}${sym}${abs}`;
  };
}

export const toCents = (v) => Math.round((parseFloat(String(v ?? '').replace(/,/g, '')) || 0) * 100);
export const fromCents = (c) => (Number(c || 0) / 100).toFixed(2);
export const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const wordCount = (t) => (String(t || '').match(/\S+/g) || []).length;
export const usd = (n) => `$${Number(n || 0).toFixed(Number(n || 0) < 1 ? 3 : 2)}`;

export function rangeFor(key) {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  switch (key) {
    case 'last': return { from: localDate(new Date(y, m - 1, 1)), to: localDate(new Date(y, m, 0)) };
    case 'quarter': return { from: localDate(new Date(y, m - 2, 1)), to: localDate(new Date(y, m + 1, 0)) };
    case 'year': return { from: localDate(new Date(y, 0, 1)), to: localDate(new Date(y, 11, 31)) };
    case 'all': return { from: '2000-01-01', to: '2099-12-31' };
    default: return { from: localDate(new Date(y, m, 1)), to: localDate(new Date(y, m + 1, 0)) };
  }
}
export const RANGE_LABELS = { month: 'This month', last: 'Last month', quarter: 'Last 3 months', year: 'This year', all: 'All time' };

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
