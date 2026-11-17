// Formatting helpers (Indonesian Rupiah, dates, numbers).

const cfg = { mode: 'symbol', locale: 'id-ID' };

export function setFormatConfig(c) { Object.assign(cfg, c || {}); }

const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export function num(n) { return nf0.format(Math.round(Number(n) || 0)); }
export function dec(n) { return nf1.format(Number(n) || 0); }

export function rupiah(n) {
  const v = Math.round(Number(n) || 0);
  const abs = nf0.format(Math.abs(v));
  const sign = v < 0 ? '-' : '';
  return cfg.mode === 'plain' ? `${sign}${abs}` : `${sign}Rp ${abs}`;
}
// Compact rupiah for chart axes: 1,2 jt / 250 rb
export function rupiahShort(n) {
  const v = Number(n) || 0, a = Math.abs(v);
  if (a >= 1e9) return `${dec(v / 1e9)} M`;
  if (a >= 1e6) return `${dec(v / 1e6)} jt`;
  if (a >= 1e3) return `${dec(v / 1e3)} rb`;
  return num(v);
}
export const pct = (n) => `${dec(n)}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const p2 = (n) => String(n).padStart(2, '0');
export const monthName = (i) => MONTHS[i];

export function fdate(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '-';
  return `${p2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function ftime(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '-';
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export const fdatetime = (v) => `${fdate(v)}, ${ftime(v)}`;
export function fdateKey(k) { const [y, m, d] = k.split('-').map(Number); return `${p2(d)} ${MONTHS[m - 1]} ${y}`; }
export function fshortKey(k) { const [, m, d] = k.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; }

export const PAYMENT_LABELS = { cash: 'Tunai', transfer: 'Transfer Bank', qris: 'QRIS', other: 'Lainnya' };
export const payLabel = (m) => PAYMENT_LABELS[m] || m || '-';
export const STATUS_LABELS = { completed: 'Selesai', partial: 'Belum Lunas', void: 'Dibatalkan' };
export const statusLabel = (s) => STATUS_LABELS[s] || s;
export const MOVEMENT_LABELS = { initial: 'Stok Awal', in: 'Stok Masuk', out: 'Stok Keluar', adjust: 'Penyesuaian', opname: 'Stok Opname', sale: 'Penjualan', void: 'Pembatalan Transaksi' };
