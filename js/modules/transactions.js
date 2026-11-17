// Transaction history: filters, details, reprint, void (with stock restoration + audit), settlement, export.
import { listTransactions, getTransaction, voidTransaction, receivePayment } from '../database/transactions.db.js';
import { rupiah, fdatetime, payLabel, statusLabel, num, PAYMENT_LABELS } from '../utils/format.js';
import { esc, icon, refreshIcons, debounce, presetRange, dateKey } from '../utils/helpers.js';
import { openSheet, toast, promptDialog, emptyState, bindMoneyInput, moneyValue } from '../ui/ui.js';
import { showReceiptPreview } from '../services/receipt.service.js';
import { downloadCSV } from '../services/export.service.js';
import { state, emit } from '../state.js';

let all = [];
const f = { q: '', from: '', to: '', method: '', status: '' };
let rootEl = null;

export function destroy() { rootEl = null; }

const badgeFor = (s) => (s === 'completed' ? 'green' : s === 'void' ? 'red' : 'amber');

function filtered() {
  const q = f.q.trim().toLowerCase();
  return all.filter((t) =>
    (!q || t.id.toLowerCase().includes(q) || (t.customerName || '').toLowerCase().includes(q)) &&
    (!f.from || t.dateKey >= f.from) && (!f.to || t.dateKey <= f.to) &&
    (!f.method || t.paymentMethod === f.method) && (!f.status || t.status === f.status));
}

function drawList() {
  if (!rootEl) return;
  const list = filtered();
  const body = rootEl.querySelector('#txBody');
  const totalActive = list.filter((t) => t.status !== 'void').reduce((a, t) => a + t.total, 0);
  rootEl.querySelector('#txSummary').textContent = `${num(list.length)} transaksi · Total ${rupiah(totalActive)} (tidak termasuk batal)`;
  if (!list.length) { body.innerHTML = `<tr><td colspan="8">${emptyState('Tidak ada transaksi', 'Ubah filter atau lakukan penjualan baru', 'receipt-text')}</td></tr>`; return; }
  body.innerHTML = list.slice(0, 300).map((t) => `
    <tr class="clickable" data-id="${esc(t.id)}">
      <td class="first" data-label="ID"><b>${esc(t.id)}</b></td>
      <td data-label="Waktu" class="nowrap">${esc(fdatetime(t.createdAt))}</td>
      <td data-label="Kasir">${esc(t.cashier)}</td>
      <td data-label="Pelanggan">${esc(t.customerName)}</td>
      <td data-label="Total" class="num bold" ${t.status === 'void' ? 'style="text-decoration:line-through;color:var(--text-2)"' : ''}>${rupiah(t.total)}</td>
      <td data-label="Pembayaran">${esc(payLabel(t.paymentMethod))}</td>
      <td data-label="Status"><span class="badge ${badgeFor(t.status)}">${statusLabel(t.status)}</span></td>
      <td class="actions"><div class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-act="print" title="Cetak ulang struk" aria-label="Cetak ulang struk">${icon('printer')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="view" title="Detail" aria-label="Detail">${icon('eye')}</button></div></td>
    </tr>`).join('') + (list.length > 300 ? `<tr><td colspan="8" class="center muted">Menampilkan 300 transaksi terbaru. Persempit filter untuk melihat lainnya.</td></tr>` : '');
  refreshIcons();
}

async function reload() { all = await listTransactions(); drawList(); }

export async function render(root) {
  rootEl = root;
  all = await listTransactions();
  root.innerHTML = `
    <div class="toolbar">
      <div class="search"><i data-lucide="search"></i><input class="input" id="q" placeholder="Cari ID transaksi / pelanggan…" value="${esc(f.q)}"></div>
      <input type="date" class="input" id="from" value="${f.from}" style="width:150px" aria-label="Dari tanggal">
      <input type="date" class="input" id="to" value="${f.to}" style="width:150px" aria-label="Sampai tanggal">
      <select class="select" id="method" style="width:170px"><option value="">Semua Pembayaran</option>${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}" ${f.method === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select class="select" id="status" style="width:150px"><option value="">Semua Status</option><option value="completed" ${f.status === 'completed' ? 'selected' : ''}>Selesai</option><option value="partial" ${f.status === 'partial' ? 'selected' : ''}>Belum Lunas</option><option value="void" ${f.status === 'void' ? 'selected' : ''}>Dibatalkan</option></select>
      <button class="btn btn-ghost btn-sm" id="reset">Reset</button>
      <button class="btn" id="export">${icon('file-down')} Ekspor CSV</button>
    </div>
    <div class="card">
      <div class="card-head"><span class="muted" id="txSummary"></span></div>
      <div class="table-wrap"><table class="table responsive">
        <thead><tr><th>ID Transaksi</th><th>Waktu</th><th>Kasir</th><th>Pelanggan</th><th class="num">Total</th><th>Pembayaran</th><th>Status</th><th></th></tr></thead>
        <tbody id="txBody"></tbody></table></div>
    </div>`;
  refreshIcons();
  drawList();
  const set = (k) => (e) => { f[k] = e.target.value; drawList(); };
  root.querySelector('#q').addEventListener('input', debounce(set('q'), 150));
  root.querySelector('#from').onchange = set('from'); root.querySelector('#to').onchange = set('to');
  root.querySelector('#method').onchange = set('method'); root.querySelector('#status').onchange = set('status');
  root.querySelector('#reset').onclick = () => { Object.assign(f, { q: '', from: '', to: '', method: '', status: '' }); render(root); };
  root.querySelector('#export').onclick = exportCSV;
  root.querySelector('#txBody').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') { const t = await getTransaction(tr.dataset.id); showReceiptPreview(t); return; }
    showTransactionDetail(tr.dataset.id);
  });
}

function exportCSV() {
  const list = filtered();
  if (!list.length) return toast('Tidak ada data untuk diekspor', 'warning');
  downloadCSV(`transaksi-${dateKey()}.csv`, [
    { label: 'ID Transaksi', key: 'id' }, { label: 'Tanggal', raw: (t) => t.createdAt.slice(0, 10) }, { label: 'Jam', raw: (t) => fdatetime(t.createdAt).split(', ')[1] },
    { label: 'Kasir', key: 'cashier' }, { label: 'Pelanggan', key: 'customerName' },
    { label: 'Subtotal', key: 'gross' }, { label: 'Diskon', key: 'discount' }, { label: 'Penjualan Bersih', key: 'net' }, { label: 'Pajak', key: 'tax' }, { label: 'Total', key: 'total' },
    { label: 'HPP', raw: (t) => t.items.reduce((a, i) => a + i.cost * i.qty, 0) },
    { label: 'Dibayar', key: 'paid' }, { label: 'Sisa', key: 'remaining' },
    { label: 'Metode', raw: (t) => payLabel(t.paymentMethod) }, { label: 'Status', raw: (t) => statusLabel(t.status) },
    { label: 'Item', raw: (t) => t.items.map((i) => `${i.name} x${i.qty}`).join('; ') }, { label: 'Catatan', key: 'notes' },
  ], list);
  toast(`${list.length} transaksi diekspor`, 'success');
}

export async function showTransactionDetail(id) {
  const t = await getTransaction(id);
  if (!t) return toast('Transaksi tidak ditemukan', 'error');
  const cogs = t.items.reduce((a, i) => a + i.cost * i.qty, 0);
  const sheet = openSheet({
    title: 'Detail Transaksi', size: 'lg',
    body: `
      <div class="flex-between mb"><div><div class="bold" style="font-size:16px">${esc(t.id)}</div><div class="muted small">${esc(fdatetime(t.createdAt))} · Kasir ${esc(t.cashier)} · ${esc(t.customerName)}</div></div><span class="badge ${badgeFor(t.status)}">${statusLabel(t.status)}</span></div>
      ${t.status === 'void' ? `<div class="alert red mb">${icon('ban')}<div>Dibatalkan ${esc(fdatetime(t.voidedAt))} oleh ${esc(t.voidedBy || '-')}<br><span class="small">Alasan: ${esc(t.voidReason)}</span></div></div>` : ''}
      <div class="table-wrap"><table class="table"><thead><tr><th>Produk</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Diskon</th><th class="num">Subtotal</th></tr></thead><tbody>
      ${t.items.map((i) => `<tr><td>${esc(i.name)}<div class="small muted">${esc(i.sku)}</div></td><td class="num">${num(i.qty)}</td><td class="num">${rupiah(i.price)}</td><td class="num">${i.discount ? '-' + rupiah(i.discount) : '-'}</td><td class="num">${rupiah(i.price * i.qty - (i.discount || 0))}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="grid grid-2 mt">
        <div>
          <div class="kv"><span>Subtotal</span><b>${rupiah(t.gross)}</b></div>
          <div class="kv"><span>Diskon</span><b>-${rupiah(t.discount)}</b></div>
          ${t.tax ? `<div class="kv"><span>${esc(state.settings.taxName)} ${t.taxPercent}%</span><b>${rupiah(t.tax)}</b></div>` : ''}
          <div class="kv" style="font-size:16px"><span>Total</span><b>${rupiah(t.total)}</b></div>
          <div class="kv"><span>Dibayar (${esc(payLabel(t.paymentMethod))})</span><b>${rupiah(t.paid)}</b></div>
          <div class="kv"><span>${t.remaining > 0 ? 'Sisa tagihan' : 'Kembalian'}</span><b class="${t.remaining > 0 ? 'text-danger' : ''}">${rupiah(t.remaining > 0 ? t.remaining : t.change)}</b></div>
          <div class="kv"><span>HPP / Laba kotor</span><b>${rupiah(cogs)} / ${rupiah(t.net - cogs)}</b></div>
          ${t.notes ? `<div class="kv"><span>Catatan</span><b>${esc(t.notes)}</b></div>` : ''}
        </div>
        <div><div class="label-t mb">Riwayat Audit</div><div class="list">${(t.audit || []).map((a) => `<div class="list-item"><div class="rank">${icon({ create: 'plus', void: 'ban', payment: 'banknote' }[a.action] || 'dot', 'style="width:14px;height:14px"')}</div><div class="grow"><div class="bold small">${esc({ create: 'Dibuat', void: 'Dibatalkan', payment: 'Pelunasan' }[a.action] || a.action)} · ${esc(a.by)}</div><div class="small muted">${esc(fdatetime(a.at))}${a.note ? ' — ' + esc(a.note) : ''}</div></div></div>`).join('')}</div></div>
      </div>`,
    footer: `${t.status === 'partial' ? `<button class="btn btn-success" data-pay>${icon('banknote')} Terima Pelunasan</button>` : ''}${t.status !== 'void' ? `<button class="btn btn-danger" data-void>${icon('ban')} Batalkan</button>` : ''}<button class="btn btn-primary" data-print>${icon('printer')} Cetak Struk</button>`,
  });
  sheet.el.querySelector('[data-print]').onclick = () => showReceiptPreview(t);
  const vb = sheet.el.querySelector('[data-void]');
  if (vb) vb.onclick = async () => {
    const reason = await promptDialog({ title: 'Batalkan Transaksi', label: `Alasan pembatalan ${t.id}. Stok akan dikembalikan otomatis.`, placeholder: 'Contoh: salah input, pelanggan batal', confirmText: 'Batalkan Transaksi', danger: true });
    if (!reason) return;
    try { await voidTransaction(t.id, reason, state.user.name); toast('Transaksi dibatalkan, stok dikembalikan', 'success'); emit('data-changed'); sheet.close(); if (rootEl) reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const pb = sheet.el.querySelector('[data-pay]');
  if (pb) pb.onclick = () => {
    const ps = openSheet({
      title: 'Terima Pelunasan', size: 'sm',
      body: `<div class="pay-total"><div class="muted">Sisa tagihan</div><div class="amount">${rupiah(t.remaining)}</div></div>
        <div class="field"><label>Metode</label><select class="select" id="pm">${Object.entries(PAYMENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label>Jumlah diterima</label><input class="input money-input" id="pa" inputmode="numeric" value="${new Intl.NumberFormat('id-ID').format(t.remaining)}"></div>`,
      footer: '<button class="btn" data-close>Batal</button><button class="btn btn-success" id="pgo">Simpan Pembayaran</button>',
    });
    bindMoneyInput(ps.el.querySelector('#pa'));
    ps.el.querySelector('#pgo').onclick = async () => {
      try { await receivePayment(t.id, moneyValue(ps.el.querySelector('#pa')), ps.el.querySelector('#pm').value, state.user.name); toast('Pembayaran dicatat', 'success'); ps.close(); sheet.close(); if (rootEl) reload(); showTransactionDetail(t.id); }
      catch (e) { toast(e.message, 'error'); }
    };
  };
}
