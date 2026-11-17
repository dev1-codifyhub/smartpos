// Sales transactions: atomic create (stock validation + deduction + movement + save), void, settlement.
import { getAll, getById, withTx, tGet, tPut, tAdd, tAll, getRange } from './db.js';
import { applyStock } from './products.db.js';
import { uid, dateKey } from '../utils/helpers.js';

const p2 = (n) => String(n).padStart(2, '0');

// Human-friendly unique ID: TRX-20261117-A1B2C3 (draft id reserved before payment => idempotent)
export function newTransactionId(date = new Date()) {
  const rand = uid().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `TRX-${date.getFullYear()}${p2(date.getMonth() + 1)}${p2(date.getDate())}-${rand}`;
}

// Pure calculation used by cart preview AND saved transaction.
// items: [{price, qty}], discount: {type:'percent'|'nominal', value}, taxPercent
export function calcTotals(items, discount = { type: 'percent', value: 0 }, taxPercent = 0) {
  const gross = items.reduce((a, i) => a + i.price * i.qty, 0);
  let disc = 0;
  const v = Math.max(0, Number(discount?.value) || 0);
  if (discount?.type === 'percent') disc = Math.round(gross * Math.min(v, 100) / 100);
  else disc = Math.min(Math.round(v), gross);
  const net = gross - disc;
  const tax = taxPercent > 0 ? Math.round(net * taxPercent / 100) : 0;
  return { gross, discount: disc, net, tax, total: net + tax };
}

// Spread the cart discount over lines (rounded; remainder goes to last line)
function allocateDiscount(lines, totalDiscount) {
  const gross = lines.reduce((a, l) => a + l.price * l.qty, 0);
  let left = totalDiscount;
  return lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : Math.round(totalDiscount * (l.price * l.qty) / (gross || 1));
    left -= share;
    return share;
  });
}

/**
 * draft: { id, items:[{productId, qty, price}], discount:{type,value}, taxPercent, customer:{id,name}|null,
 *          paymentMethod, paid, notes, cashier, reference }
 * Returns { txn, duplicate }
 */
export async function createSale(draft) {
  if (!draft.items || !draft.items.length) throw new Error('Keranjang masih kosong');
  const id = draft.id || newTransactionId();
  return withTx(['products', 'transactions', 'stock_movements'], 'readwrite', async (t) => {
    // Idempotency: same draft id never creates two transactions.
    const existing = await tGet(t, 'transactions', id);
    if (existing) return { txn: existing, duplicate: true };

    // Merge lines by product & validate stock against the DB (source of truth)
    const merged = new Map();
    for (const it of draft.items) {
      const q = Math.floor(Number(it.qty));
      if (!(q > 0)) throw new Error('Jumlah barang tidak valid');
      const m = merged.get(it.productId) || { productId: it.productId, qty: 0, price: it.price };
      m.qty += q; merged.set(it.productId, m);
    }
    const lines = [];
    for (const m of merged.values()) {
      const p = await tGet(t, 'products', m.productId);
      if (!p) throw new Error('Salah satu produk sudah dihapus');
      if (p.stock < m.qty) throw new Error(`Stok "${p.name}" tidak cukup (tersedia ${p.stock} ${p.unit}, diminta ${m.qty})`);
      lines.push({ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: m.qty, price: Number(m.price), cost: p.purchasePrice /* snapshot at time of sale */, discount: 0 });
    }
    const totals = calcTotals(lines, draft.discount, draft.taxPercent || 0);
    const alloc = allocateDiscount(lines, totals.discount);
    lines.forEach((l, i) => { l.discount = alloc[i]; });

    const paid = Math.max(0, Math.round(Number(draft.paid) || 0));
    const method = draft.paymentMethod || 'cash';
    if (paid < totals.total && !draft.allowPartial) throw new Error('Jumlah pembayaran kurang dari total');
    if (paid < totals.total && paid <= 0 && totals.total > 0) throw new Error('Masukkan jumlah pembayaran');
    const now = new Date();
    const remaining = Math.max(0, totals.total - paid);
    const txn = {
      id, createdAt: now.toISOString(), dateKey: dateKey(now),
      cashier: draft.cashier || 'Kasir',
      customerId: draft.customer?.id || null, customerName: draft.customer?.name || 'Umum',
      items: lines,
      gross: totals.gross, discount: totals.discount, net: totals.net, tax: totals.tax, taxPercent: draft.taxPercent || 0, total: totals.total,
      cogs: lines.reduce((a, l) => a + l.cost * l.qty, 0),
      paymentMethod: method, reference: draft.reference || '',
      paid, change: Math.max(0, paid - totals.total), remaining,
      payments: [{ at: now.toISOString(), method, amount: Math.min(paid, totals.total) || 0, received: paid }],
      status: remaining > 0 ? 'partial' : 'completed',
      notes: draft.notes || '',
      audit: [{ at: now.toISOString(), action: 'create', by: draft.cashier || 'Kasir', note: 'Transaksi dibuat' }],
    };
    // Reduce stock + write movement for each line (inside same atomic tx)
    for (const l of lines) {
      await applyStock(t, l.productId, { type: 'sale', delta: -l.qty, notes: `Penjualan ${id}`, ref: id, by: txn.cashier });
    }
    await tAdd(t, 'transactions', txn);
    return { txn, duplicate: false };
  });
}

// Void a transaction: restore stock (with movements), mark status, keep audit trail.
export async function voidTransaction(id, reason, by = 'Kasir') {
  if (!reason || !reason.trim()) throw new Error('Alasan pembatalan wajib diisi');
  return withTx(['products', 'transactions', 'stock_movements'], 'readwrite', async (t) => {
    const txn = await tGet(t, 'transactions', id);
    if (!txn) throw new Error('Transaksi tidak ditemukan');
    if (txn.status === 'void') throw new Error('Transaksi sudah dibatalkan');
    const skipped = [];
    for (const l of txn.items) {
      const p = await tGet(t, 'products', l.productId);
      if (!p) { skipped.push(l.name); continue; }
      await applyStock(t, l.productId, { type: 'void', delta: l.qty, notes: `Pembatalan ${id}: ${reason.trim()}`, ref: id, by });
    }
    const now = new Date().toISOString();
    txn.prevStatus = txn.status;
    txn.status = 'void'; txn.voidedAt = now; txn.voidReason = reason.trim(); txn.voidedBy = by;
    txn.audit.push({ at: now, action: 'void', by, note: reason.trim() + (skipped.length ? ` (produk sudah dihapus: ${skipped.join(', ')})` : '') });
    await tPut(t, 'transactions', txn);
    return txn;
  });
}

// Settle remaining balance of a partial transaction
export async function receivePayment(id, amount, method = 'cash', by = 'Kasir') {
  amount = Math.round(Number(amount));
  if (!(amount > 0)) throw new Error('Jumlah pembayaran tidak valid');
  return withTx('transactions', 'readwrite', async (t) => {
    const txn = await tGet(t, 'transactions', id);
    if (!txn) throw new Error('Transaksi tidak ditemukan');
    if (txn.status !== 'partial') throw new Error('Transaksi tidak memiliki sisa pembayaran');
    const applied = Math.min(amount, txn.remaining);
    const now = new Date().toISOString();
    txn.paid += applied; txn.remaining -= applied; txn.change = Math.max(0, amount - applied);
    txn.payments.push({ at: now, method, amount: applied, received: amount });
    if (txn.remaining <= 0) txn.status = 'completed';
    txn.audit.push({ at: now, action: 'payment', by, note: `Pelunasan ${applied} via ${method}` });
    await tPut(t, 'transactions', txn);
    return txn;
  });
}

export const listTransactions = async () => (await getAll('transactions')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getTransaction = (id) => getById('transactions', id);
export const transactionsInRange = async (from, to) => (await getRange('transactions', 'dateKey', from, to)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export { tAll };
