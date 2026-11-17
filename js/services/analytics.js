// Pure aggregation functions. Everything is computed from real transaction records.
// Gross Profit = Net Sales - COGS, where COGS uses the cost snapshot stored in each sold item.
import { dateKey, parseKey, addDays, daysBetween, startOfWeek } from '../utils/helpers.js';
import { monthName, fshortKey } from '../utils/format.js';

export const valid = (txns) => txns.filter((t) => t.status !== 'void');

export function summarize(txns) {
  const list = valid(txns);
  const s = { count: list.length, gross: 0, discount: 0, net: 0, tax: 0, total: 0, cogs: 0, profit: 0, items: 0, avg: 0 };
  for (const t of list) {
    s.gross += t.gross; s.discount += t.discount; s.net += t.net; s.tax += t.tax; s.total += t.total;
    for (const i of t.items) { s.cogs += i.cost * i.qty; s.items += i.qty; }
  }
  s.profit = s.net - s.cogs;
  s.avg = s.count ? s.net / s.count : 0;
  s.margin = s.net ? (s.profit / s.net) * 100 : 0;
  return s;
}

const blank = () => ({ count: 0, gross: 0, discount: 0, net: 0, cogs: 0, profit: 0 });
function add(b, t) {
  b.count += 1; b.gross += t.gross; b.discount += t.discount; b.net += t.net;
  const c = t.items.reduce((a, i) => a + i.cost * i.qty, 0);
  b.cogs += c; b.profit += t.net - c;
}

export function groupByDay(txns, from, to) {
  const map = new Map();
  for (let d = parseKey(from); dateKey(d) <= to; d = addDays(d, 1)) map.set(dateKey(d), { key: dateKey(d), ...blank() });
  for (const t of valid(txns)) { const b = map.get(t.dateKey); if (b) add(b, t); }
  return [...map.values()];
}

// Time series for charts. Single day => 24 hourly buckets, <=92 days => daily, otherwise monthly.
export function series(txns, from, to) {
  const list = valid(txns);
  const n = daysBetween(from, to);
  if (n === 1) {
    const hrs = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}:00`, ...blank() }));
    for (const t of list) add(hrs[new Date(t.createdAt).getHours()], t);
    return hrs;
  }
  if (n <= 92) return groupByDay(txns, from, to).map((b) => ({ ...b, label: fshortKey(b.key) }));
  const m = new Map();
  for (const t of list) {
    if (t.dateKey < from || t.dateKey > to) continue;
    const k = t.dateKey.slice(0, 7);
    if (!m.has(k)) m.set(k, { label: `${monthName(Number(k.slice(5)) - 1)} ${k.slice(2, 4)}`, ...blank() });
    add(m.get(k), t);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]);
}

// Fixed windows for the dashboard "sales trend" chart
export function trend(txns, mode, now = new Date()) {
  const list = valid(txns);
  const out = [];
  if (mode === 'daily') {
    const map = new Map();
    for (let i = 13; i >= 0; i--) { const d = addDays(now, -i); map.set(dateKey(d), { label: fshortKey(dateKey(d)), ...blank() }); }
    for (const t of list) { const b = map.get(t.dateKey); if (b) add(b, t); }
    return [...map.values()];
  }
  if (mode === 'weekly') {
    const start = startOfWeek(now);
    const map = new Map();
    for (let i = 11; i >= 0; i--) { const d = addDays(start, -7 * i); map.set(dateKey(d), { label: fshortKey(dateKey(d)), ...blank() }); }
    for (const t of list) { const k = dateKey(startOfWeek(parseKey(t.dateKey))); const b = map.get(k); if (b) add(b, t); }
    return [...map.values()];
  }
  const map = new Map();
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); map.set(dateKey(d).slice(0, 7), { label: `${monthName(d.getMonth())} ${String(d.getFullYear()).slice(2)}`, ...blank() }); }
  for (const t of list) { const b = map.get(t.dateKey.slice(0, 7)); if (b) add(b, t); }
  return [...map.values()].concat(out);
}

export function productPerformance(txns) {
  const m = new Map();
  for (const t of valid(txns)) {
    for (const i of t.items) {
      const r = m.get(i.productId) || { productId: i.productId, name: i.name, sku: i.sku, qty: 0, gross: 0, discount: 0, net: 0, cogs: 0, profit: 0 };
      const g = i.price * i.qty;
      r.qty += i.qty; r.gross += g; r.discount += i.discount || 0; r.net += g - (i.discount || 0);
      r.cogs += i.cost * i.qty; r.profit = r.net - r.cogs;
      m.set(i.productId, r);
    }
  }
  return [...m.values()].map((r) => ({ ...r, margin: r.net ? (r.profit / r.net) * 100 : 0 }));
}
export const topProducts = (txns, n = 5, by = 'qty') => productPerformance(txns).sort((a, b) => b[by] - a[by]).slice(0, n);

export function paymentBreakdown(txns) {
  const m = new Map();
  for (const t of valid(txns)) {
    // use recorded payments so partial/settled amounts are attributed to their real method
    for (const p of t.payments || [{ method: t.paymentMethod, amount: t.total }]) {
      const r = m.get(p.method) || { method: p.method, count: 0, amount: 0 };
      r.amount += p.amount; r.count += 1; m.set(p.method, r);
    }
  }
  const rows = [...m.values()].sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return rows.map((r) => ({ ...r, share: total ? (r.amount / total) * 100 : 0 }));
}
