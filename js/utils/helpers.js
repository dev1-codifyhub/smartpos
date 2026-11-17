// Generic helpers shared by all modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a.forEach((_, i) => (a[i] = Math.random() * 256)) }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const toInt = (v) => { const n = Math.round(Number(String(v).replace(/[^\d.-]/g, ''))); return Number.isFinite(n) ? n : 0; };
export const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);

export function icon(name, extra = '') {
  return `<i data-lucide="${name}" ${extra}></i>`;
}
export function refreshIcons(root) {
  try { if (window.lucide) window.lucide.createIcons(root ? { attrs: {}, nameAttr: 'data-lucide' } : undefined); } catch (e) { /* offline first load: icons optional */ }
}

// ---- Safe preference storage (LocalStorage) ----
export const prefs = {
  get(key, def = null) {
    try { const v = localStorage.getItem('spos:' + key); return v === null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('spos:' + key, JSON.stringify(val)); } catch { /* ignore */ }
  },
  remove(key) { try { localStorage.removeItem('spos:' + key); } catch { /* ignore */ } },
};

// ---- Dates (all local time) ----
const p2 = (n) => String(n).padStart(2, '0');
export function dateKey(d = new Date()) {
  d = d instanceof Date ? d : new Date(d);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
export const todayKey = () => dateKey(new Date());
export function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d = new Date()) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
export function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function presetRange(preset) {
  const now = new Date();
  if (preset === 'today') return { from: dateKey(now), to: dateKey(now) };
  if (preset === 'week') return { from: dateKey(startOfWeek(now)), to: dateKey(addDays(startOfWeek(now), 6)) };
  if (preset === 'month') return { from: dateKey(startOfMonth(now)), to: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  return { from: dateKey(addDays(now, -6)), to: dateKey(now) };
}
export function daysBetween(from, to) { return Math.round((parseKey(to) - parseKey(from)) / 86400000) + 1; }

// ---- Files ----
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
export const readDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });

export async function resizeImage(file, max = 360, quality = 0.82) {
  const src = await readDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Gambar tidak valid')); i.src = src; });
  const ratio = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * ratio); c.height = Math.round(img.height * ratio);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Placeholder product image (SVG data URI), no network needed.
export function placeholderImage(label = '', color = '#DC2626') {
  const initials = (label || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".95"/><stop offset="1" stop-color="${color}" stop-opacity=".55"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><text x="160" y="140" font-family="Arial,sans-serif" font-size="84" font-weight="700" fill="#fff" text-anchor="middle">${esc(initials)}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
export function emojiImage(emoji, color = '#DC2626') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity=".07"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><text x="160" y="160" font-size="110" text-anchor="middle">${emoji}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// ---- Sound effects (WebAudio, no files) ----
let audioCtx;
export function beep(kind = 'tap') {
  if (!prefs.get('sound', true)) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { tap: [[660, 0.05]], add: [[880, 0.06]], success: [[660, 0.09], [880, 0.09], [1175, 0.14]], error: [[220, 0.18]], scan: [[1400, 0.08]] }[kind] || [[660, 0.05]];
    let t = audioCtx.currentTime;
    for (const [f, d] of notes) {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + d + 0.02); t += d;
    }
  } catch { /* ignore */ }
}

// Lighten/darken helper for category colors
export const COLORS = ['#DC2626', '#16A36A', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#0EA5E9', '#14B8A6', '#F97316', '#64748B'];
