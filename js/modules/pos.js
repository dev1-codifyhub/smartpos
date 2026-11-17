// POS / Cashier module.
import { listProducts, listCategories, listCustomers, saveCustomer } from '../database/products.db.js';
import { createSale, calcTotals, newTransactionId } from '../database/transactions.db.js';
import { state, emit, isLow, isOut } from '../state.js';
import { rupiah, num, PAYMENT_LABELS } from '../utils/format.js';
import { esc, icon, refreshIcons, debounce, prefs, placeholderImage, beep, toInt } from '../utils/helpers.js';
import { openSheet, toast, confirmDialog, bindMoneyInput, moneyValue, emptyState } from '../ui/ui.js';
import { openScanner, attachKeyboardScanner } from './barcode.js';
import { showReceiptPreview } from '../services/receipt.service.js';
import { validateValues } from '../utils/validation.js';

let products = [], cats = [], catById = {}, customers = [];
let search = '', catFilter = 'all', lastAdded = null, detachScanner = null, root = null;
const cart = { items: [], discount: { type: 'percent', value: 0 }, customer: null, notes: '', draftId: null };

const taxPercent = () => (state.settings.taxEnabled ? Number(state.settings.taxPercent) || 0 : 0);
const totals = () => calcTotals(cart.items, cart.discount, taxPercent());
const defaultDiscount = () => ({ type: 'percent', value: Number(state.settings.defaultDiscount) || 0 });

function persist() { prefs.set('cart', { items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty })), discount: cart.discount, customer: cart.customer, notes: cart.notes, draftId: cart.draftId }); }
function restore() {
  const s = prefs.get('cart'); cart.items = []; cart.discount = defaultDiscount(); cart.customer = null; cart.notes = ''; cart.draftId = null;
  if (!s) return;
  for (const it of s.items || []) {
    const p = products.find((x) => x.id === it.productId);
    if (p && p.stock > 0) cart.items.push(lineFor(p, Math.min(it.qty, p.stock)));
  }
  cart.discount = s.discount || cart.discount; cart.customer = s.customer || null; cart.notes = s.notes || ''; cart.draftId = s.draftId || null;
}
const lineFor = (p, qty) => ({ productId: p.id, name: p.name, sku: p.sku, price: p.sellingPrice, cost: p.purchasePrice, qty, unit: p.unit, image: p.image });

export function destroy() { detachScanner && detachScanner(); detachScanner = null; root = null; }

function filteredProducts() {
  const q = search.trim().toLowerCase();
  return products.filter((p) => (catFilter === 'all' || p.categoryId === catFilter) &&
    (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').includes(q)));
}

/* ---------- Catalog ---------- */
function drawChips() {
  root.querySelector('#chips').innerHTML = `<button class="chip ${catFilter === 'all' ? 'active' : ''}" data-cat="all">Semua</button>` +
    cats.map((c) => `<button class="chip ${catFilter === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('');
}
function drawGrid() {
  const list = filteredProducts();
  const grid = root.querySelector('#grid');
  if (!products.length) { grid.innerHTML = `<div style="grid-column:1/-1">${emptyState('Belum ada produk', 'Tambahkan produk di menu Produk', 'package')}</div>`; return; }
  if (!list.length) { grid.innerHTML = `<div style="grid-column:1/-1">${emptyState('Produk tidak ditemukan', 'Coba kata kunci atau kategori lain', 'search-x')}</div>`; return; }
  grid.innerHTML = list.map((p) => {
    const cat = catById[p.categoryId];
    const inCart = cart.items.find((i) => i.productId === p.id);
    const out = isOut(p);
    return `<button class="product-card ${out ? 'out' : ''}" data-id="${p.id}" ${out ? 'aria-disabled="true"' : ''}>
      <img class="pimg" loading="lazy" alt="" src="${p.image || placeholderImage(p.name, cat?.color)}">
      <span class="pcat"><i class="cat-dot" style="background:${cat?.color || '#999'}"></i>${esc(cat?.name || '-')}</span>
      <div class="pbody"><div class="pname">${esc(p.name)}</div><div class="psku">${esc(p.sku)}</div>
        <div class="pmeta"><span class="pprice">${rupiah(p.sellingPrice)}</span>
        ${out ? '<span class="badge red">Habis</span>' : `<span class="badge ${isLow(p) ? 'amber' : 'gray'}">${inCart ? inCart.qty + '/' : ''}${num(p.stock)} ${esc(p.unit)}</span>`}</div></div></button>`;
  }).join('');
}

/* ---------- Cart ---------- */
function addToCart(p, qty = 1) {
  if (isOut(p)) { toast(`${p.name} stok habis`, 'error'); return false; }
  const line = cart.items.find((i) => i.productId === p.id);
  const have = line ? line.qty : 0;
  if (have + qty > p.stock) { toast(`Stok ${p.name} hanya ${p.stock} ${p.unit}`, 'warning'); if (have >= p.stock) return false; qty = p.stock - have; }
  if (line) { line.qty += qty; line.price = p.sellingPrice; } else cart.items.unshift(lineFor(p, qty));
  lastAdded = p.id; beep('add'); drawCart(); persist();
  return true;
}
function setQty(id, qty) {
  const line = cart.items.find((i) => i.productId === id); if (!line) return;
  const p = products.find((x) => x.id === id);
  qty = Math.floor(Number(qty));
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  if (p && qty > p.stock) { toast(`Stok ${p.name} hanya ${p.stock} ${p.unit}`, 'warning'); qty = p.stock; }
  line.qty = qty; drawCart(); persist();
}
function removeLine(id) { cart.items = cart.items.filter((i) => i.productId !== id); drawCart(); persist(); }
async function clearCart(ask = true) {
  if (!cart.items.length) return;
  if (ask && !(await confirmDialog({ title: 'Kosongkan keranjang?', message: 'Semua item di keranjang akan dihapus.', confirmText: 'Kosongkan', danger: true }))) return;
  resetCart(); drawCart(); drawGrid();
}
function resetCart() { cart.items = []; cart.discount = defaultDiscount(); cart.customer = null; cart.notes = ''; cart.draftId = null; persist(); }

function drawCart() {
  if (!root) return;
  const box = root.querySelector('#cartItems');
  if (!cart.items.length) box.innerHTML = emptyState('Keranjang kosong', 'Ketuk produk atau scan barcode untuk menambahkan', 'shopping-cart');
  else box.innerHTML = cart.items.map((i) => `
    <div class="cart-item ${lastAdded === i.productId ? 'pop' : ''}" data-id="${i.productId}">
      <img class="thumb" style="width:46px;height:46px" alt="" src="${i.image || placeholderImage(i.name)}">
      <div style="min-width:0"><div class="ci-name">${esc(i.name)}</div><div class="ci-price">${rupiah(i.price)} / ${esc(i.unit)}</div>
        <div class="flex" style="gap:6px"><div class="qty"><button data-dec aria-label="Kurangi">−</button><input type="number" inputmode="numeric" min="1" value="${i.qty}" data-qty aria-label="Jumlah"><button data-inc aria-label="Tambah">+</button></div>
        <button class="cart-remove" data-rm aria-label="Hapus item">${icon('trash-2', 'style="width:16px;height:16px"')}</button></div></div>
      <div class="ci-sub">${rupiah(i.price * i.qty)}</div>
    </div>`).join('');
  lastAdded = null;
  const dv = root.querySelector('#discVal');
  if (document.activeElement !== dv) dv.value = cart.discount.value || '';
  root.querySelectorAll('#discType button').forEach((x) => x.classList.toggle('active', x.dataset.dt === cart.discount.type));
  refreshIcons();
  drawTotals();
  root.querySelector('#custLabel').textContent = cart.customer ? cart.customer.name : 'Pelanggan Umum';
  root.querySelector('#noteBtn').classList.toggle('btn-primary', !!cart.notes);
}
function drawTotals() {
  const t = totals();
  const count = cart.items.reduce((a, i) => a + i.qty, 0);
  root.querySelector('#sumGross').textContent = rupiah(t.gross);
  root.querySelector('#sumDisc').textContent = t.discount ? '-' + rupiah(t.discount) : rupiah(0);
  const taxRow = root.querySelector('#taxRow'); taxRow.classList.toggle('hidden', !taxPercent());
  root.querySelector('#taxLabel').textContent = `${state.settings.taxName || 'Pajak'} ${taxPercent()}%`;
  root.querySelector('#sumTax').textContent = rupiah(t.tax);
  root.querySelector('#sumTotal').textContent = rupiah(t.total);
  root.querySelector('#cartCount').textContent = `${count} item`;
  root.querySelector('#payBtn').disabled = !cart.items.length;
  root.querySelector('#fabCnt').textContent = `${count} item`;
  root.querySelector('#fabTotal').textContent = rupiah(t.total);
  drawGridBadgesSoon();
}
const drawGridBadgesSoon = debounce(() => root && drawGrid(), 60);

/* ---------- Customer / notes ---------- */
function openCustomerPicker() {
  const s = openSheet({
    title: 'Pilih Pelanggan',
    body: `<div class="search mb"><i data-lucide="search"></i><input class="input" id="cs" placeholder="Cari nama / telepon"></div>
      <div class="list" id="cl"></div>
      <div class="divider"></div>
      <form id="newCust"><div class="label-t mb">Tambah pelanggan baru</div>
      <div class="form-row keep"><div class="field"><input class="input" name="name" placeholder="Nama *"><div class="err"></div></div><div class="field"><input class="input" name="phone" placeholder="No. telepon" inputmode="tel"><div class="err"></div></div></div>
      <button class="btn btn-primary btn-block" type="submit">${icon('user-plus')} Simpan & Pilih</button></form>`,
  });
  const draw = () => {
    const q = s.el.querySelector('#cs').value.trim().toLowerCase();
    const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
    s.el.querySelector('#cl').innerHTML = `<div class="list-item clickable" data-c=""><div class="avatar" style="width:36px;height:36px;background:var(--text-2)">${icon('users', 'style="width:16px;height:16px"')}</div><div class="grow bold">Pelanggan Umum (tanpa data)</div></div>` +
      list.map((c) => `<div class="list-item clickable" data-c="${c.id}"><div class="avatar" style="width:36px;height:36px;font-size:13px">${esc(c.name[0])}</div><div class="grow"><div class="bold">${esc(c.name)}</div><div class="small muted">${esc(c.phone || '-')}</div></div></div>`).join('');
    refreshIcons();
  };
  draw();
  s.el.querySelector('#cs').oninput = draw;
  s.el.querySelector('#cl').onclick = (e) => {
    const r = e.target.closest('[data-c]'); if (!r) return;
    const c = customers.find((x) => x.id === r.dataset.c);
    cart.customer = c ? { id: c.id, name: c.name } : null; persist(); drawCart(); s.close();
  };
  s.el.querySelector('#newCust').onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const errs = validateValues(v, { name: { label: 'Nama', required: true, maxLen: 60 } });
    if (errs.name) { e.target.querySelector('[name=name]').closest('.field').classList.add('invalid'); e.target.querySelector('.err').textContent = errs.name; return; }
    try { const c = await saveCustomer(v); customers = await listCustomers(); cart.customer = { id: c.id, name: c.name }; persist(); drawCart(); s.close(); toast('Pelanggan ditambahkan', 'success'); } catch (er) { toast(er.message, 'error'); }
  };
}
function openNotes() {
  const s = openSheet({ title: 'Catatan Transaksi', size: 'sm', body: `<div class="field"><textarea class="textarea" id="nt" maxlength="200" placeholder="Contoh: pesanan diantar, titip kembalian…">${esc(cart.notes)}</textarea><div class="hint">Maksimal 200 karakter</div></div>`, footer: '<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="ns">Simpan</button>' });
  s.el.querySelector('#ns').onclick = () => { cart.notes = s.el.querySelector('#nt').value.trim(); persist(); drawCart(); s.close(); };
}

/* ---------- Payment ---------- */
function openPayment() {
  if (!cart.items.length) return toast('Keranjang masih kosong', 'warning');
  // pre-validate stock against freshest in-memory data
  for (const i of cart.items) { const p = products.find((x) => x.id === i.productId); if (!p || p.stock < i.qty) return toast(`Stok ${i.name} tidak mencukupi`, 'error'); }
  if (!cart.draftId) { cart.draftId = newTransactionId(); persist(); }
  const t = totals();
  let method = 'cash', paid = t.total, busy = false, done = false, saved = null;
  const icons = { cash: 'banknote', transfer: 'landmark', qris: 'qr-code', other: 'wallet' };
  const sheet = openSheet({
    title: 'Pembayaran', dismissible: true,
    body: `<div class="pay-total"><div class="muted">Total tagihan</div><div class="amount">${rupiah(t.total)}</div>${t.discount || t.tax ? `<div class="small muted">Subtotal ${rupiah(t.gross)}${t.discount ? ` · Diskon ${rupiah(t.discount)}` : ''}${t.tax ? ` · Pajak ${rupiah(t.tax)}` : ''}</div>` : ''}</div>
      <div class="pay-methods">${Object.entries(PAYMENT_LABELS).map(([k, l]) => `<button class="pay-method ${k === method ? 'active' : ''}" data-m="${k}">${icon(icons[k])}${l}</button>`).join('')}</div>
      <div class="field hidden" id="refField"><label>Referensi pembayaran (opsional)</label><input class="input" id="ref" placeholder="No. referensi / bank / catatan"></div>
      <div class="field"><label>Jumlah dibayar</label><input class="input money-input" id="paid" inputmode="numeric" autocomplete="off"></div>
      <div class="quick-amounts" id="quick"></div>
      <div id="changeBox"></div>`,
    footer: '<button class="btn" data-close>Batal</button><button class="btn btn-success btn-lg" id="confirmPay" style="flex:2">Selesaikan Pembayaran</button>',
  });
  const el = sheet.el, paidInput = el.querySelector('#paid');
  const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);
  const setPaid = (n) => { paid = n; paidInput.value = n ? fmt(n) : ''; drawChange(); };
  bindMoneyInput(paidInput, (n) => { paid = n; drawChange(); });
  function quick() {
    const base = t.total; const set = new Set([base]);
    [5000, 10000, 50000, 100000].forEach((s) => set.add(Math.ceil(base / s) * s));
    el.querySelector('#quick').innerHTML = method === 'cash' ? [...set].filter((n) => n >= base).slice(0, 5).map((n, i) => `<button class="chip" data-q="${n}">${i === 0 ? 'Uang Pas' : rupiah(n)}</button>`).join('') : '';
  }
  function drawChange() {
    const box = el.querySelector('#changeBox');
    if (paid >= t.total) box.innerHTML = `<div class="change-box"><span>Kembalian</span><span>${rupiah(paid - t.total)}</span></div>`;
    else if (state.settings.allowPartial && paid > 0) box.innerHTML = `<div class="change-box warn"><span>Sisa pembayaran (belum lunas)</span><span>${rupiah(t.total - paid)}</span></div>`;
    else box.innerHTML = `<div class="change-box bad"><span>Pembayaran kurang</span><span>${rupiah(t.total - paid)}</span></div>`;
  }
  el.querySelector('.pay-methods').onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    method = b.dataset.m;
    el.querySelectorAll('.pay-method').forEach((x) => x.classList.toggle('active', x === b));
    el.querySelector('#refField').classList.toggle('hidden', method === 'cash');
    setPaid(t.total); quick();
  };
  el.querySelector('#quick').onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) setPaid(Number(b.dataset.q)); };
  quick(); setPaid(t.total);
  paidInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } });
  paidInput.select();

  async function confirm() {
    if (busy || done) return;               // blocks double-click / double-Enter
    const btn = el.querySelector('#confirmPay');
    if (paid < t.total) {
      if (!state.settings.allowPartial) return toast('Jumlah pembayaran kurang dari total', 'error');
      if (paid <= 0) return toast('Masukkan jumlah pembayaran', 'error');
      if (!cart.customer) return toast('Pembayaran sebagian membutuhkan data pelanggan. Pilih pelanggan terlebih dahulu.', 'warning', 4500);
    }
    busy = true; btn.classList.add('loading');
    try {
      const res = await createSale({
        id: cart.draftId,
        items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty, price: i.price })),
        discount: cart.discount, taxPercent: taxPercent(), customer: cart.customer,
        paymentMethod: method, reference: el.querySelector('#ref').value.trim(), paid, notes: cart.notes,
        cashier: state.user.name, allowPartial: state.settings.allowPartial,
      });
      done = true; saved = res.txn;
      beep('success');
      resetCart(); products = await listProducts(); emit('data-changed');
      if (root) { drawCart(); drawGrid(); root.querySelector('.pos').classList.remove('cart-open'); }
      showSuccess();
    } catch (err) {
      busy = false; btn.classList.remove('loading');
      toast(err.message || 'Gagal menyimpan transaksi', 'error', 5000);
      products = await listProducts(); if (root) drawGrid();
    }
  }
  el.querySelector('#confirmPay').onclick = confirm;

  function showSuccess() {
    sheet.el.querySelector('.sheet-head h2').textContent = 'Transaksi Berhasil';
    sheet.setBody(`<div class="success-modal"><div class="check">${icon('check')}</div>
      <div class="muted">${saved.status === 'partial' ? 'Pembayaran sebagian diterima' : 'Pembayaran berhasil'}</div><div class="amount">${rupiah(saved.total)}</div>
      <div class="muted small mt">${esc(saved.id)}</div>
      <div class="divider"></div>
      <div class="kv"><span>Metode</span><b>${esc(PAYMENT_LABELS[saved.paymentMethod])}</b></div>
      <div class="kv"><span>Dibayar</span><b>${rupiah(saved.paid)}</b></div>
      <div class="kv"><span>${saved.remaining > 0 ? 'Sisa tagihan' : 'Kembalian'}</span><b style="font-size:18px" class="${saved.remaining > 0 ? 'text-danger' : 'text-success'}">${rupiah(saved.remaining > 0 ? saved.remaining : saved.change)}</b></div></div>`);
    sheet.setFooter(`<button class="btn" data-close>Transaksi Baru</button><button class="btn btn-primary" id="rcBtn">${icon('printer')} Cetak Struk</button>`);
    sheet.el.querySelector('#rcBtn').onclick = () => showReceiptPreview(saved);
    refreshIcons();
  }
}

/* ---------- Barcode ---------- */
function matchCode(code) {
  code = String(code).trim();
  return products.find((p) => p.barcode === code) || products.find((p) => p.sku.toLowerCase() === code.toLowerCase());
}
function handleCode(code) {
  const p = matchCode(code);
  if (!p) { beep('error'); toast(`Barcode "${code}" tidak terdaftar`, 'error'); return { ok: false, message: `Barcode ${code} tidak terdaftar` }; }
  const ok = addToCart(p);
  if (ok) { const card = root?.querySelector(`.product-card[data-id="${p.id}"]`); card?.classList.add('flash'); setTimeout(() => card?.classList.remove('flash'), 600); }
  return { ok, message: ok ? `✓ ${p.name} ditambahkan` : `${p.name}: stok habis` };
}

/* ---------- Render ---------- */
export async function render(el) {
  root = el;
  [products, cats, customers] = await Promise.all([listProducts(), listCategories(), listCustomers()]);
  catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  products.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  restore();

  root.innerHTML = `
    <div class="pos">
      <section class="pos-catalog">
        <div class="pos-toolbar">
          <div class="pos-search-row">
            <div class="search"><i data-lucide="search"></i><input class="input" id="psearch" placeholder="Cari produk, SKU, atau scan barcode…" autocomplete="off" value="${esc(search)}"></div>
            <button class="btn btn-primary btn-icon" id="scanBtn" aria-label="Scan barcode" title="Scan barcode dengan kamera">${icon('scan-barcode')}</button>
          </div>
          <div class="chips" id="chips"></div>
        </div>
        <div class="product-grid" id="grid"></div>
      </section>
      <aside class="cart-panel" aria-label="Keranjang belanja">
        <div class="cart-head"><h2>Keranjang <span class="badge" id="cartCount">0 item</span></h2>
          <div class="flex" style="gap:4px"><button class="btn btn-ghost btn-sm" id="clearBtn">${icon('trash-2')} Kosongkan</button><button class="btn btn-ghost btn-icon btn-sm cart-close" id="closeCart" aria-label="Tutup keranjang">${icon('x')}</button></div></div>
        <div class="cart-meta"><button class="btn btn-sm" id="custBtn">${icon('user-round')}<span id="custLabel">Pelanggan Umum</span></button><button class="btn btn-sm" id="noteBtn" style="flex:0 0 auto">${icon('notebook-pen')} Catatan</button></div>
        <div class="cart-items" id="cartItems"></div>
        <div class="cart-summary">
          <div class="sum-row"><span class="muted">Subtotal</span><span id="sumGross"></span></div>
          <div class="sum-row"><span class="muted">Diskon</span><div class="discount-box">
            <div class="segmented" id="discType"><button data-dt="percent" class="${cart.discount.type === 'percent' ? 'active' : ''}">%</button><button data-dt="nominal" class="${cart.discount.type === 'nominal' ? 'active' : ''}">Rp</button></div>
            <input class="input" id="discVal" inputmode="decimal" value="${cart.discount.value || ''}" placeholder="0" aria-label="Nilai diskon"></div></div>
          <div class="sum-row"><span class="muted"></span><span class="text-danger small" id="sumDisc"></span></div>
          <div class="sum-row hidden" id="taxRow"><span class="muted" id="taxLabel">Pajak</span><span id="sumTax"></span></div>
          <div class="sum-row total"><span>Total</span><span id="sumTotal"></span></div>
          <button class="btn btn-primary btn-lg btn-block mt" id="payBtn" style="margin-top:12px">${icon('credit-card')} Bayar</button>
        </div>
      </aside>
      <div class="cart-scrim" id="cartScrim"></div>
    </div>
    <button class="cart-fab" id="fab" aria-label="Buka keranjang"><span class="flex" style="gap:10px">${icon('shopping-bag')}<span class="cnt" id="fabCnt">0 item</span></span><span>Lihat Keranjang</span><b id="fabTotal">Rp 0</b></button>`;

  const pos = root.querySelector('.pos');
  drawChips(); drawGrid(); drawCart();

  root.querySelector('#psearch').addEventListener('input', debounce((e) => { search = e.target.value; drawGrid(); }, 120));
  root.querySelector('#psearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim(); if (!v) return;
    const exact = matchCode(v);                    // handles USB scanners typing into the field
    if (exact) { addToCart(exact); e.target.value = ''; search = ''; drawGrid(); return; }
    const list = filteredProducts();
    if (list.length === 1) { addToCart(list[0]); e.target.value = ''; search = ''; drawGrid(); }
    else if (!list.length) toast(`"${v}" tidak ditemukan`, 'error');
  });
  root.querySelector('#chips').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; catFilter = b.dataset.cat; drawChips(); drawGrid(); };
  root.querySelector('#grid').onclick = (e) => {
    const c = e.target.closest('.product-card'); if (!c) return;
    const p = products.find((x) => x.id === c.dataset.id); if (p) addToCart(p);
  };
  root.querySelector('#cartItems').addEventListener('click', (e) => {
    const row = e.target.closest('.cart-item'); if (!row) return;
    const id = row.dataset.id; const line = cart.items.find((i) => i.productId === id);
    if (e.target.closest('[data-inc]')) setQty(id, line.qty + 1);
    else if (e.target.closest('[data-dec]')) { line.qty <= 1 ? removeLine(id) : setQty(id, line.qty - 1); }
    else if (e.target.closest('[data-rm]')) removeLine(id);
  });
  root.querySelector('#cartItems').addEventListener('change', (e) => { if (e.target.matches('[data-qty]')) setQty(e.target.closest('.cart-item').dataset.id, e.target.value); });
  root.querySelector('#clearBtn').onclick = () => clearCart(true);
  root.querySelector('#custBtn').onclick = openCustomerPicker;
  root.querySelector('#noteBtn').onclick = openNotes;
  root.querySelector('#payBtn').onclick = openPayment;
  root.querySelector('#scanBtn').onclick = () => openScanner({ title: 'Scan Barcode Produk', continuous: true, onScan: async (code) => handleCode(code) });
  root.querySelector('#fab').onclick = () => pos.classList.add('cart-open');
  root.querySelector('#closeCart').onclick = () => pos.classList.remove('cart-open');
  root.querySelector('#cartScrim').onclick = () => pos.classList.remove('cart-open');
  root.querySelector('#discType').onclick = (e) => { const b = e.target.closest('[data-dt]'); if (!b) return; cart.discount.type = b.dataset.dt; root.querySelectorAll('#discType button').forEach((x) => x.classList.toggle('active', x === b)); persist(); drawTotals(); };
  root.querySelector('#discVal').addEventListener('input', (e) => {
    let v = Number(String(e.target.value).replace(',', '.')); if (!Number.isFinite(v) || v < 0) v = 0;
    if (cart.discount.type === 'percent' && v > 100) { v = 100; e.target.value = 100; }
    cart.discount.value = v; persist(); drawTotals();
  });
  detachScanner = attachKeyboardScanner((code) => handleCode(code));
  refreshIcons();
}
