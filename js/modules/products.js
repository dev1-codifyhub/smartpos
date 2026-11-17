// Product management: CRUD, search/filter/sort, CSV import/export, barcode generation & label printing.
import { listProducts, listCategories, saveProduct, deleteProduct, saveCategory, PRODUCT_RULES } from '../database/products.db.js';
import { state, emit, isLow, isOut } from '../state.js';
import { rupiah, num, fdate } from '../utils/format.js';
import { esc, icon, refreshIcons, debounce, resizeImage, placeholderImage, readText, dateKey, COLORS } from '../utils/helpers.js';
import { openSheet, toast, confirmDialog, emptyState, bindMoneyInput, moneyValue } from '../ui/ui.js';
import { validateValues, showErrors } from '../utils/validation.js';
import { generateBarcodeValue, renderBarcode, openScanner } from './barcode.js';
import { downloadCSV, parseCSV } from '../services/export.service.js';
import { printHTML } from '../utils/print.js';
import { capturePhoto } from '../ui/camera.js';

let products = [], cats = [], catById = {}, rootEl = null;
const f = { q: '', cat: '', sort: 'name-asc', stock: '' };

export function destroy() { rootEl = null; }

async function load() {
  [products, cats] = await Promise.all([listProducts(), listCategories()]);
  catById = Object.fromEntries(cats.map((c) => [c.id, c]));
}

function view() {
  const q = f.q.trim().toLowerCase();
  let list = products.filter((p) => (!f.cat || p.categoryId === f.cat) &&
    (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').includes(q)) &&
    (!f.stock || (f.stock === 'out' && isOut(p)) || (f.stock === 'low' && isLow(p)) || (f.stock === 'ok' && !isOut(p) && !isLow(p))));
  const [key, dir] = f.sort.split('-');
  const cmp = { name: (a, b) => a.name.localeCompare(b.name, 'id'), price: (a, b) => a.sellingPrice - b.sellingPrice, stock: (a, b) => a.stock - b.stock, created: (a, b) => a.createdAt.localeCompare(b.createdAt), margin: (a, b) => (a.sellingPrice - a.purchasePrice) - (b.sellingPrice - b.purchasePrice) }[key];
  list.sort((a, b) => cmp(a, b) * (dir === 'desc' ? -1 : 1));
  return list;
}

function draw() {
  if (!rootEl) return;
  const list = view();
  rootEl.querySelector('#count').textContent = `${num(list.length)} dari ${num(products.length)} produk`;
  const body = rootEl.querySelector('#pBody');
  if (!list.length) { body.innerHTML = `<tr><td colspan="7">${emptyState(products.length ? 'Produk tidak ditemukan' : 'Belum ada produk', products.length ? 'Ubah kata kunci atau filter' : 'Klik "Tambah Produk" untuk memulai', 'package')}</td></tr>`; return; }
  body.innerHTML = list.map((p) => {
    const c = catById[p.categoryId];
    return `<tr data-id="${p.id}">
      <td class="first"><div class="cell-product"><img src="${p.image || placeholderImage(p.name, c?.color)}" alt="" loading="lazy"><div style="min-width:0"><div class="bold">${esc(p.name)}</div><div class="small muted">${esc(p.sku)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</div></div></div></td>
      <td data-label="Kategori"><span class="badge" style="background:${c?.color || '#888'}22;color:${c?.color || '#888'}">${esc(c?.name || '-')}</span></td>
      <td data-label="Harga Beli" class="num">${rupiah(p.purchasePrice)}</td>
      <td data-label="Harga Jual" class="num bold">${rupiah(p.sellingPrice)}</td>
      <td data-label="Stok" class="num"><span class="badge ${isOut(p) ? 'red' : isLow(p) ? 'amber' : 'green'}">${num(p.stock)} ${esc(p.unit)}</span></td>
      <td data-label="Min." class="num">${num(p.minStock)}</td>
      <td class="actions"><div class="row-actions">
        <button class="btn btn-ghost btn-icon btn-sm" data-act="barcode" title="Barcode" aria-label="Barcode">${icon('barcode')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" title="Edit" aria-label="Edit">${icon('pencil')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-act="delete" title="Hapus" aria-label="Hapus" style="color:var(--danger)">${icon('trash-2')}</button></div></td></tr>`;
  }).join('');
  refreshIcons();
}

export async function render(root) {
  rootEl = root;
  await load();
  root.innerHTML = `
    <div class="toolbar">
      <div class="search"><i data-lucide="search"></i><input class="input" id="q" placeholder="Cari nama, SKU, barcode…" value="${esc(f.q)}"></div>
      <select class="select" id="fcat" style="width:170px"><option value="">Semua Kategori</option>${cats.map((c) => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="select" id="fstock" style="width:150px"><option value="">Semua Stok</option><option value="ok">Stok Aman</option><option value="low">Menipis</option><option value="out">Habis</option></select>
      <select class="select" id="fsort" style="width:190px">${[['name-asc', 'Nama A–Z'], ['name-desc', 'Nama Z–A'], ['price-asc', 'Harga jual termurah'], ['price-desc', 'Harga jual termahal'], ['stock-asc', 'Stok tersedikit'], ['stock-desc', 'Stok terbanyak'], ['margin-desc', 'Margin terbesar'], ['created-desc', 'Terbaru']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="toolbar">
      <button class="btn btn-primary" id="add">${icon('plus')} Tambah Produk</button>
      <button class="btn" id="imp">${icon('upload')} Impor CSV</button>
      <button class="btn" id="exp">${icon('download')} Ekspor CSV</button>
      <button class="btn" id="labels">${icon('tag')} Cetak Label Barcode</button>
      <input type="file" id="impFile" accept=".csv,text/csv" class="hidden">
      <span class="muted small grow right" id="count"></span>
    </div>
    <div class="card"><div class="table-wrap"><table class="table responsive">
      <thead><tr><th>Produk</th><th>Kategori</th><th class="num">Harga Beli</th><th class="num">Harga Jual</th><th class="num">Stok</th><th class="num">Min.</th><th></th></tr></thead>
      <tbody id="pBody"></tbody></table></div></div>`;
  root.querySelector('#fstock').value = f.stock;
  refreshIcons(); draw();
  root.querySelector('#q').addEventListener('input', debounce((e) => { f.q = e.target.value; draw(); }, 150));
  root.querySelector('#fcat').onchange = (e) => { f.cat = e.target.value; draw(); };
  root.querySelector('#fstock').onchange = (e) => { f.stock = e.target.value; draw(); };
  root.querySelector('#fsort').onchange = (e) => { f.sort = e.target.value; draw(); };
  root.querySelector('#add').onclick = () => openForm();
  root.querySelector('#exp').onclick = exportCSV;
  root.querySelector('#imp').onclick = () => root.querySelector('#impFile').click();
  root.querySelector('#impFile').onchange = (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) importCSV(file); };
  root.querySelector('#labels').onclick = () => openLabelPicker();
  root.querySelector('#pBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); const tr = e.target.closest('tr[data-id]'); if (!btn || !tr) return;
    const p = products.find((x) => x.id === tr.dataset.id);
    if (btn.dataset.act === 'edit') openForm(p);
    else if (btn.dataset.act === 'barcode') openBarcodeSheet(p);
    else if (btn.dataset.act === 'delete') {
      if (!(await confirmDialog({ title: 'Hapus produk?', message: `<b>${esc(p.name)}</b> akan dihapus permanen. Riwayat transaksi lama tetap tersimpan.`, confirmText: 'Hapus', danger: true }))) return;
      try { await deleteProduct(p.id); toast('Produk dihapus', 'success'); emit('data-changed'); await load(); draw(); } catch (er) { toast(er.message, 'error'); }
    }
  });
}

/* ---------- Form ---------- */
function openForm(p = null) {
  let image = p?.image || '';
  const isEdit = !!p;
  const sheet = openSheet({
    title: isEdit ? 'Edit Produk' : 'Tambah Produk', size: 'lg',
    body: `<form id="pf" novalidate autocomplete="off">
      <div class="dropzone mb" style="cursor:default"><img id="imgPrev" src="${image || placeholderImage(p?.name || 'Produk')}" alt=""><div class="grow"><div class="bold">Foto produk</div><div class="small muted mb">Ambil langsung dengan kamera atau unggah dari galeri (otomatis dikompres)</div><div class="flex" style="flex-wrap:wrap;gap:8px"><button type="button" class="btn btn-sm btn-primary" id="camBtn">${icon('camera')} Ambil Foto</button><button type="button" class="btn btn-sm" id="upBtn">${icon('image-up')} Unggah</button><button type="button" class="btn btn-sm btn-ghost ${image ? '' : 'hidden'}" id="rmImg">Hapus</button></div></div><input type="file" id="imgFile" accept="image/*" class="hidden"></div>
      <div class="form-row"><div class="field"><label>Nama Produk <span class="req">*</span></label><input class="input" name="name" value="${esc(p?.name || '')}" maxlength="120"><div class="err"></div></div>
        <div class="field"><label>Kategori <span class="req">*</span></label><div class="input-group"><select class="select" name="categoryId"><option value="">Pilih kategori</option>${cats.map((c) => `<option value="${c.id}" ${p?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><button type="button" class="btn btn-icon" id="newCat" aria-label="Kategori baru" title="Kategori baru">${icon('plus')}</button></div><div class="err"></div></div></div>
      <div class="form-row"><div class="field"><label>SKU <span class="req">*</span></label><input class="input" name="sku" value="${esc(p?.sku || '')}" maxlength="40"><div class="err"></div></div>
        <div class="field"><label>Barcode</label><div class="input-group"><input class="input" name="barcode" inputmode="numeric" value="${esc(p?.barcode || '')}" maxlength="40"><button type="button" class="btn btn-icon" id="genBc" title="Generate barcode" aria-label="Generate barcode">${icon('wand-sparkles')}</button><button type="button" class="btn btn-icon" id="scanBc" title="Scan barcode" aria-label="Scan barcode">${icon('scan-barcode')}</button></div><div class="err"></div></div></div>
      <div class="form-row"><div class="field"><label>Harga Beli (Rp) <span class="req">*</span></label><input class="input money-input" name="purchasePrice" inputmode="numeric" value="${p ? new Intl.NumberFormat('id-ID').format(p.purchasePrice) : ''}"><div class="err"></div></div>
        <div class="field"><label>Harga Jual (Rp) <span class="req">*</span></label><input class="input money-input" name="sellingPrice" inputmode="numeric" value="${p ? new Intl.NumberFormat('id-ID').format(p.sellingPrice) : ''}"><div class="err"></div><div class="hint" id="marginHint"></div></div></div>
      <div class="form-row" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="field"><label>Stok ${isEdit ? '' : 'Awal'}</label><input class="input" name="stock" type="number" inputmode="numeric" min="0" step="1" value="${p ? p.stock : 0}" ${isEdit ? 'disabled' : ''}><div class="err"></div>${isEdit ? '<div class="hint">Ubah lewat menu Stok Barang</div>' : ''}</div>
        <div class="field"><label>Stok Min.</label><input class="input" name="minStock" type="number" inputmode="numeric" min="0" step="1" value="${p ? p.minStock : state.settings.lowStockThreshold}"><div class="err"></div></div>
        <div class="field"><label>Satuan <span class="req">*</span></label><input class="input" name="unit" list="units" value="${esc(p?.unit || 'pcs')}" maxlength="15"><datalist id="units"><option>pcs</option><option>kg</option><option>gram</option><option>liter</option><option>pak</option><option>box</option><option>botol</option><option>bks</option></datalist><div class="err"></div></div></div>
      <div class="field"><label>Deskripsi</label><textarea class="textarea" name="description" maxlength="300">${esc(p?.description || '')}</textarea></div>
      ${isEdit ? `<div class="small muted">Dibuat: ${esc(fdate(p.createdAt))}</div>` : ''}
    </form>`,
    footer: `<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="save">${icon('save')} Simpan</button>`,
  });
  const form = sheet.el.querySelector('#pf');
  ['purchasePrice', 'sellingPrice'].forEach((n) => bindMoneyInput(form[n], hint));
  function hint() {
    const b = moneyValue(form.purchasePrice), s = moneyValue(form.sellingPrice);
    form.closest('.sheet').querySelector('#marginHint').textContent = s ? `Laba/unit ${rupiah(s - b)} (margin ${(s ? ((s - b) / s) * 100 : 0).toFixed(1)}%)` : '';
  }
  hint();
  const file = sheet.el.querySelector('#imgFile');
  const setImage = (v) => { image = v; sheet.el.querySelector('#imgPrev').src = v || placeholderImage(form.name.value || 'Produk'); sheet.el.querySelector('#rmImg').classList.toggle('hidden', !v); };
  sheet.el.querySelector('#upBtn').onclick = () => file.click();
  sheet.el.querySelector('#camBtn').onclick = async () => { const v = await capturePhoto(); if (v) { setImage(v); toast('Foto diambil', 'success'); } };
  sheet.el.querySelector('#rmImg').onclick = () => setImage('');
  file.onchange = async () => {
    if (!file.files[0]) return;
    try { setImage(await resizeImage(file.files[0])); } catch (e) { toast(e.message, 'error'); }
  };
  sheet.el.querySelector('#genBc').onclick = () => { form.barcode.value = generateBarcodeValue(new Set(products.map((x) => x.barcode))); };
  sheet.el.querySelector('#scanBc').onclick = () => openScanner({ title: 'Scan barcode produk', continuous: false, onScan: async (code) => { form.barcode.value = code; return { ok: true, message: code }; } });
  sheet.el.querySelector('#newCat').onclick = () => quickCategory(async (c) => { cats = await listCategories(); catById = Object.fromEntries(cats.map((x) => [x.id, x])); form.categoryId.innerHTML = '<option value="">Pilih kategori</option>' + cats.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); form.categoryId.value = c.id; });
  sheet.el.querySelector('#save').onclick = async (ev) => {
    const btn = ev.currentTarget; if (btn.classList.contains('loading')) return;
    // money fields are formatted with dots -> normalise before validation
    const clone = { ...Object.fromEntries(new FormData(form)) };
    if (isEdit) clone.stock = p.stock;
    clone.purchasePrice = moneyValue(form.purchasePrice) || (form.purchasePrice.value.trim() === '' ? '' : 0);
    clone.sellingPrice = moneyValue(form.sellingPrice) || (form.sellingPrice.value.trim() === '' ? '' : 0);
    const errors = validateValues(clone, PRODUCT_RULES);
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    btn.classList.add('loading');
    try {
      await saveProduct({ ...clone, id: p?.id, image, stock: isEdit ? p.stock : Number(clone.stock || 0) }, { userName: state.user.name });
      toast(isEdit ? 'Produk diperbarui' : 'Produk ditambahkan', 'success');
      emit('data-changed'); sheet.close(); await load(); draw();
    } catch (e) {
      if (e.errors) showErrors(form, e.errors); else toast(e.message, 'error');
    } finally { btn.classList.remove('loading'); }
  };
}

function quickCategory(done) {
  const s = openSheet({
    title: 'Kategori Baru', size: 'sm',
    body: `<form id="cf"><div class="field"><label>Nama kategori</label><input class="input" name="name" maxlength="40"><div class="err"></div></div><div class="field"><label>Warna</label><div class="color-row">${COLORS.map((c, i) => `<label style="background:${c};color:${c}"><input type="radio" name="color" value="${c}" ${i === 0 ? 'checked' : ''}></label>`).join('')}</div></div></form>`,
    footer: '<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="cs">Simpan</button>',
  });
  s.el.querySelector('#cs').onclick = async () => {
    const f2 = s.el.querySelector('#cf'); const v = Object.fromEntries(new FormData(f2));
    if (!v.name.trim()) { f2.querySelector('.field').classList.add('invalid'); f2.querySelector('.err').textContent = 'Nama kategori wajib diisi'; return; }
    try { const c = await saveCategory(v); s.close(); toast('Kategori ditambahkan', 'success'); await done(c); } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------- Barcode & labels ---------- */
function labelHTML(p, copies = 1) {
  const svgId = `bc-${p.id}`;
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  renderBarcode(tmp, p.barcode || p.sku, { height: 44, fontSize: 12, margin: 2, width: 1.6 });
  const svg = tmp.outerHTML;
  return Array.from({ length: copies }, () => `<div class="label-item"><div class="ln">${esc(p.name)}</div>${svg}<div class="lp">${rupiah(p.sellingPrice)}</div></div>`).join('');
}
export function printLabels(items) {
  const html = `<div class="labels-grid">${items.map(({ p, copies }) => labelHTML(p, copies)).join('')}</div>`;
  printHTML(html, { mode: 'labels' });
}
function openBarcodeSheet(p) {
  const s = openSheet({
    title: 'Barcode Produk', size: 'sm',
    body: `<div class="center"><div class="bold">${esc(p.name)}</div><div class="muted small mb">${esc(p.sku)}</div>
      ${p.barcode ? '<svg id="bcSvg" style="max-width:100%"></svg>' : `<div class="alert mb">${icon('info')}Produk belum memiliki barcode. Label akan memakai SKU (CODE128).</div><svg id="bcSvg" style="max-width:100%"></svg>`}
      <div class="field mt" style="text-align:left"><label>Jumlah label</label><input class="input" type="number" id="copies" min="1" max="200" value="1"></div></div>`,
    footer: `<button class="btn" data-close>Tutup</button><button class="btn btn-primary" id="pl">${icon('printer')} Cetak Label</button>`,
  });
  renderBarcode(s.el.querySelector('#bcSvg'), p.barcode || p.sku);
  s.el.querySelector('#pl').onclick = () => printLabels([{ p, copies: Math.max(1, Math.min(200, Number(s.el.querySelector('#copies').value) || 1)) }]);
}
function openLabelPicker() {
  const list = view();
  if (!list.length) return toast('Tidak ada produk untuk dicetak', 'warning');
  const s = openSheet({
    title: 'Cetak Label Barcode', size: 'lg',
    body: `<div class="flex-between mb"><span class="muted small">Pilih produk dan jumlah label (hasil filter saat ini)</span><label class="flex small bold"><input type="checkbox" id="all" checked> Pilih semua</label></div>
      <div class="list">${list.map((p) => `<div class="list-item"><input type="checkbox" data-pick="${p.id}" checked aria-label="Pilih ${esc(p.name)}"><div class="grow"><div class="bold">${esc(p.name)}</div><div class="small muted">${esc(p.barcode || p.sku)}</div></div><input class="input" type="number" min="1" max="200" value="1" data-copies="${p.id}" style="width:80px;min-height:38px" aria-label="Jumlah"></div>`).join('')}</div>`,
    footer: `<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="go">${icon('printer')} Cetak</button>`,
  });
  s.el.querySelector('#all').onchange = (e) => s.el.querySelectorAll('[data-pick]').forEach((c) => (c.checked = e.target.checked));
  s.el.querySelector('#go').onclick = () => {
    const items = list.filter((p) => s.el.querySelector(`[data-pick="${p.id}"]`).checked).map((p) => ({ p, copies: Math.max(1, Math.min(200, Number(s.el.querySelector(`[data-copies="${p.id}"]`).value) || 1)) }));
    if (!items.length) return toast('Pilih minimal satu produk', 'warning');
    printLabels(items);
  };
}

/* ---------- CSV ---------- */
const CSV_COLS = [
  { label: 'Nama', key: 'name' }, { label: 'SKU', key: 'sku' }, { label: 'Barcode', key: 'barcode' },
  { label: 'Kategori', raw: (p) => catById[p.categoryId]?.name || '' },
  { label: 'Harga Beli', key: 'purchasePrice' }, { label: 'Harga Jual', key: 'sellingPrice' },
  { label: 'Stok', key: 'stock' }, { label: 'Stok Minimum', key: 'minStock' }, { label: 'Satuan', key: 'unit' }, { label: 'Deskripsi', key: 'description' },
  { label: 'Tanggal Dibuat', raw: (p) => p.createdAt.slice(0, 10) },
];
function exportCSV() {
  if (!products.length) return toast('Belum ada produk', 'warning');
  downloadCSV(`produk-${dateKey()}.csv`, CSV_COLS, view());
  toast('Produk diekspor ke CSV', 'success');
}
const HEADER_MAP = { nama: 'name', name: 'name', 'nama produk': 'name', sku: 'sku', barcode: 'barcode', kategori: 'category', category: 'category', 'harga beli': 'purchasePrice', purchaseprice: 'purchasePrice', 'harga jual': 'sellingPrice', sellingprice: 'sellingPrice', stok: 'stock', stock: 'stock', 'stok minimum': 'minStock', 'stok min': 'minStock', minstock: 'minStock', satuan: 'unit', unit: 'unit', deskripsi: 'description', description: 'description' };

async function importCSV(file) {
  try {
    const rows = parseCSV(await readText(file));
    if (rows.length < 2) throw new Error('File CSV kosong atau tidak memiliki data');
    const head = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || null);
    if (!head.includes('name') || !head.includes('sku')) throw new Error('Kolom wajib "Nama" dan "SKU" tidak ditemukan pada header CSV');
    let created = 0, updated = 0; const errs = [];
    const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
    let catList = [...cats];
    for (let i = 1; i < rows.length; i++) {
      const o = {}; head.forEach((h, j) => { if (h) o[h] = (rows[i][j] ?? '').trim(); });
      try {
        let cat = catList.find((c) => c.name.toLowerCase() === (o.category || '').toLowerCase());
        if (!cat) { cat = await saveCategory({ name: o.category || 'Umum', color: COLORS[catList.length % COLORS.length] }); catList.push(cat); }
        const num0 = (v) => Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
        const ex = bySku.get((o.sku || '').toLowerCase());
        const rec = await saveProduct({ id: ex?.id, name: o.name, sku: o.sku, barcode: o.barcode || ex?.barcode || '', categoryId: cat.id, purchasePrice: num0(o.purchasePrice), sellingPrice: num0(o.sellingPrice), stock: num0(o.stock), minStock: num0(o.minStock), unit: o.unit || ex?.unit || 'pcs', image: ex?.image || '', description: o.description || '' }, { userName: state.user.name });
        bySku.set(rec.sku.toLowerCase(), rec); ex ? updated++ : created++;
      } catch (e) { errs.push(`Baris ${i + 1}: ${e.message}`); }
    }
    emit('data-changed'); await load(); draw();
    openSheet({ title: 'Hasil Impor CSV', size: 'sm', body: `<div class="kv"><span>Produk baru</span><b class="text-success">${created}</b></div><div class="kv"><span>Diperbarui (SKU sama)</span><b>${updated}</b></div><div class="kv"><span>Gagal</span><b class="${errs.length ? 'text-danger' : ''}">${errs.length}</b></div>${errs.length ? `<div class="alert red mt" style="display:block;max-height:200px;overflow:auto;font-weight:500">${errs.slice(0, 30).map(esc).join('<br>')}</div>` : ''}<p class="small muted mt">Catatan: stok pada baris yang memperbarui produk lama tidak diubah (gunakan menu Stok Barang).</p>`, footer: '<button class="btn btn-primary" data-close>Selesai</button>' });
  } catch (e) { toast(e.message, 'error', 5000); }
}
