// Thermal receipt: HTML builder (58mm / 80mm), preview, browser print, and ESC/POS via Web Serial.
import { state, saveSettings } from '../state.js';
import { esc, icon } from '../utils/helpers.js';
import { rupiah, fdatetime, payLabel, num } from '../utils/format.js';
import { openSheet, toast, segmented, bindSegmented } from '../ui/ui.js';
import { printHTML } from '../utils/print.js';

export function buildReceiptHTML(txn, width = state.settings.receiptWidth) {
  const s = state.settings;
  const w80 = String(width) === '80';
  const lines = (s.receiptFooter || '').split('\n').filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('');
  const items = txn.items.map((i) => {
    const sub = i.price * i.qty;
    return `<div class="rc-item"><div class="rc-item-name">${esc(i.name)}</div>
      <div class="rc-row"><span>${num(i.qty)} x ${num(i.price)}</span><span>${num(sub)}</span></div>
      ${i.discount ? `<div class="rc-row"><span>&nbsp;&nbsp;Diskon</span><span>-${num(i.discount)}</span></div>` : ''}</div>`;
  }).join('');
  const row = (a, b, cls = '') => `<div class="rc-row ${cls}"><span>${a}</span><span>${b}</span></div>`;
  return `<div class="receipt ${w80 ? 'w80' : ''}">
    ${txn.status === 'void' ? '<div class="rc-void">BATAL</div>' : ''}
    <div class="rc-center">
      ${s.storeLogo ? `<img class="rc-logo" src="${s.storeLogo}" alt="">` : ''}
      <div class="rc-store">${esc(s.storeName)}</div>
      <div>${esc(s.address)}</div>
      ${s.phone ? `<div>Telp: ${esc(s.phone)}</div>` : ''}
    </div>
    <hr class="rc-sep">
    ${row('No', esc(txn.id))}
    ${row('Tanggal', esc(fdatetime(txn.createdAt)))}
    ${row('Kasir', esc(txn.cashier))}
    ${txn.customerName && txn.customerName !== 'Umum' ? row('Pelanggan', esc(txn.customerName)) : ''}
    <hr class="rc-sep">
    ${items}
    <hr class="rc-sep">
    ${row('Subtotal', rupiah(txn.gross))}
    ${txn.discount ? row('Diskon', '-' + rupiah(txn.discount)) : ''}
    ${txn.tax ? row(`${esc(s.taxName || 'Pajak')} ${txn.taxPercent}%`, rupiah(txn.tax)) : ''}
    ${row('TOTAL', rupiah(txn.total), 'rc-total')}
    <hr class="rc-sep">
    ${row('Pembayaran', esc(payLabel(txn.paymentMethod)))}
    ${row('Dibayar', rupiah(txn.paid))}
    ${txn.remaining > 0 ? row('Sisa Tagihan', rupiah(txn.remaining), 'rc-total') : row('Kembali', rupiah(txn.change))}
    ${txn.notes ? `<hr class="rc-sep"><div>Catatan: ${esc(txn.notes)}</div>` : ''}
    <hr class="rc-sep">
    <div class="rc-foot">${lines || '<div>Terima kasih</div>'}</div>
  </div>`;
}

export function printReceipt(txn, width) {
  width = width || state.settings.receiptWidth;
  printHTML(buildReceiptHTML(txn, width), { mode: 'receipt', width });
}

/* ---------- ESC/POS (Web Serial) for connected thermal printers ---------- */
function pad(a, b, cols) { const space = Math.max(1, cols - a.length - b.length); return a + ' '.repeat(space) + b; }
function wrap(text, cols) { const out = []; let t = String(text); while (t.length > cols) { out.push(t.slice(0, cols)); t = t.slice(cols); } out.push(t); return out; }

export function buildEscPos(txn, width = state.settings.receiptWidth) {
  const s = state.settings; const cols = String(width) === '80' ? 48 : 32;
  const enc = new TextEncoder();
  const bytes = [];
  const raw = (...b) => bytes.push(...b);
  const text = (t) => bytes.push(...enc.encode(t.normalize('NFD').replace(/[̀-ͯ]/g, '')));
  const line = (t = '') => { text(t); raw(0x0a); };
  const rp = (n) => num(n);
  raw(0x1b, 0x40); // init
  raw(0x1b, 0x61, 1); raw(0x1b, 0x45, 1); line(s.storeName); raw(0x1b, 0x45, 0);
  wrap(s.address || '', cols).forEach(line); if (s.phone) line('Telp: ' + s.phone);
  raw(0x1b, 0x61, 0); line('-'.repeat(cols));
  line(pad('No', txn.id, cols).slice(0, cols)); line(pad('Tgl', fdatetime(txn.createdAt), cols)); line(pad('Kasir', txn.cashier, cols));
  line('-'.repeat(cols));
  for (const i of txn.items) {
    wrap(i.name, cols).forEach(line);
    line(pad(`${i.qty} x ${rp(i.price)}`, rp(i.price * i.qty), cols));
    if (i.discount) line(pad('  Diskon', '-' + rp(i.discount), cols));
  }
  line('-'.repeat(cols));
  line(pad('Subtotal', rp(txn.gross), cols));
  if (txn.discount) line(pad('Diskon', '-' + rp(txn.discount), cols));
  if (txn.tax) line(pad(`${s.taxName || 'Pajak'} ${txn.taxPercent}%`, rp(txn.tax), cols));
  raw(0x1b, 0x45, 1); line(pad('TOTAL', rp(txn.total), cols)); raw(0x1b, 0x45, 0);
  line(pad('Bayar (' + payLabel(txn.paymentMethod) + ')', rp(txn.paid), cols));
  line(txn.remaining > 0 ? pad('Sisa', rp(txn.remaining), cols) : pad('Kembali', rp(txn.change), cols));
  line('-'.repeat(cols));
  raw(0x1b, 0x61, 1); (s.receiptFooter || '').split('\n').forEach((l) => wrap(l, cols).forEach(line));
  raw(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // feed + partial cut
  return new Uint8Array(bytes);
}

export async function printViaSerial(txn, width) {
  if (!('serial' in navigator)) throw new Error('Web Serial tidak didukung browser ini (gunakan Chrome/Edge desktop atau Android).');
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  const writer = port.writable.getWriter();
  try { await writer.write(buildEscPos(txn, width)); } finally { writer.releaseLock(); await port.close(); }
}

/* ---------- Preview sheet ---------- */
export function showReceiptPreview(txn) {
  let width = state.settings.receiptWidth;
  const canSerial = 'serial' in navigator;
  const sheet = openSheet({
    title: 'Pratinjau Struk',
    size: '',
    body: `<div class="flex-between mb"><span class="muted small">Lebar kertas</span>${segmented([['58', '58 mm'], ['80', '80 mm']], width)}</div>
      <div class="receipt-preview-wrap" id="rcPrev">${buildReceiptHTML(txn, width)}</div>`,
    footer: `${canSerial ? `<button class="btn" data-serial>${icon('usb')} Printer USB/Serial</button>` : ''}<button class="btn btn-primary" data-print>${icon('printer')} Cetak</button>`,
  });
  const redraw = () => { sheet.el.querySelector('#rcPrev').innerHTML = buildReceiptHTML(txn, width); };
  bindSegmented(sheet.el, '.segmented', async (v) => { width = v; redraw(); await saveSettings({ receiptWidth: v }); });
  sheet.el.querySelector('[data-print]').onclick = () => printReceipt(txn, width);
  const sb = sheet.el.querySelector('[data-serial]');
  if (sb) sb.onclick = async () => {
    try { await printViaSerial(txn, width); toast('Struk dikirim ke printer', 'success'); } catch (e) { if (e.name !== 'NotFoundError') toast(e.message || 'Gagal mencetak ke printer', 'error'); }
  };
  return sheet;
}
