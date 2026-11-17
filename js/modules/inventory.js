// Inventory: stock levels, stock in/out/adjust, stock opname, movement history.
import { listProducts, listCategories, listMovements, changeStock, stockOpname } from '../database/products.db.js';
import { state, emit, isLow, isOut, stockLimit } from '../state.js';
import { num, fdatetime, MOVEMENT_LABELS } from '../utils/format.js';
import { esc, icon, refreshIcons, debounce, dateKey, placeholderImage } from '../utils/helpers.js';
import { openSheet, toast, segmented, bindSegmented, emptyState } from '../ui/ui.js';
import { downloadCSV } from '../services/export.service.js';

let products = [], cats = [], movements = [], catById = {}, rootEl = null;
const st = { tab: 'levels', filter: 'all', q: '', mType: '', mQ: '', from: '', to: '' };

export function destroy() { rootEl = null; }

async function load() {
  [products, cats, movements] = await Promise.all([listProducts(), listCategories(), listMovements()]);
  catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  products.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

const MOVE_COLOR = { initial: 'gray', in: 'green', out: 'red', adjust: 'amber', opname: 'amber', sale: 'gray', void: 'green' };

function drawLevels() {
  const low = products.filter(isLow).length, out = products.filter(isOut).length;
  const q = st.q.trim().toLowerCase();
  const list = products.filter((p) => (st.filter === 'all' || (st.filter === 'low' && isLow(p)) || (st.filter === 'out' && isOut(p))) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)));
  const val = products.reduce((a, p) => a + p.stock * p.purchasePrice, 0);
  rootEl.querySelector('#invBody').innerHTML = `
    ${out ? `<div class="alert red mb">${icon('octagon-alert')}<span><b>${out} produk habis.</b> Segera lakukan restock.</span></div>` : ''}
    ${low ? `<div class="alert mb">${icon('triangle-alert')}<span><b>${low} produk stok menipis</b> (di bawah batas minimum).</span></div>` : ''}
    <div class="toolbar">
      <div class="search"><i data-lucide="search"></i><input class="input" id="lq" placeholder="Cari produk / SKU…" value="${esc(st.q)}"></div>
      ${segmented([['all', `Semua (${products.length})`], ['low', `Menipis (${low})`], ['out', `Habis (${out})`]], st.filter, 'data-f')}
    </div>
    <div class="card"><div class="muted small mb">Nilai persediaan (harga beli): <b>${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)}</b></div>
    <div class="table-wrap"><table class="table responsive"><thead><tr><th>Produk</th><th>Kategori</th><th class="num">Stok</th><th class="num">Minimum</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.length ? list.map((p) => `<tr data-id="${p.id}">
      <td class="first"><div class="cell-product"><img src="${p.image || placeholderImage(p.name, catById[p.categoryId]?.color)}" alt="" loading="lazy"><div><div class="bold">${esc(p.name)}</div><div class="small muted">${esc(p.sku)}</div></div></div></td>
      <td data-label="Kategori">${esc(catById[p.categoryId]?.name || '-')}</td>
      <td data-label="Stok" class="num bold">${num(p.stock)} ${esc(p.unit)}</td><td data-label="Minimum" class="num">${num(stockLimit(p))}</td>
      <td data-label="Status"><span class="badge ${isOut(p) ? 'red' : isLow(p) ? 'amber' : 'green'}">${isOut(p) ? 'Habis' : isLow(p) ? 'Menipis' : 'Aman'}</span></td>
      <td class="actions"><div class="row-actions"><button class="btn btn-sm" data-act="in">${icon('plus')} Masuk</button><button class="btn btn-sm" data-act="out">${icon('minus')} Keluar</button></div></td></tr>`).join('') : `<tr><td colspan="6">${emptyState('Tidak ada produk', 'Ubah filter pencarian', 'boxes')}</td></tr>`}
    </tbody></table></div></div>`;
  refreshIcons();
  const body = rootEl.querySelector('#invBody');
  body.querySelector('#lq').addEventListener('input', debounce((e) => { st.q = e.target.value; const pos = e.target.selectionStart; drawLevels(); const i = rootEl.querySelector('#lq'); i.focus(); i.setSelectionRange(pos, pos); }, 200));
  bindSegmented(body, '[data-f]', (v) => { st.filter = v; drawLevels(); }, 'data-f');
  body.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => openMovement(b.dataset.act, b.closest('tr').dataset.id)));
}

function drawHistory() {
  const q = st.mQ.trim().toLowerCase();
  const list = movements.filter((m) => (!st.mType || m.type === st.mType) && (!q || m.productName.toLowerCase().includes(q) || (m.sku || '').toLowerCase().includes(q) || (m.ref || '').toLowerCase().includes(q)) && (!st.from || dateKey(m.date) >= st.from) && (!st.to || dateKey(m.date) <= st.to));
  rootEl.querySelector('#invBody').innerHTML = `
    <div class="toolbar">
      <div class="search"><i data-lucide="search"></i><input class="input" id="mq" placeholder="Cari produk / SKU / ref transaksi…" value="${esc(st.mQ)}"></div>
      <select class="select" id="mt" style="width:190px"><option value="">Semua Jenis</option>${Object.entries(MOVEMENT_LABELS).map(([k, v]) => `<option value="${k}" ${st.mType === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input type="date" class="input" id="mf" value="${st.from}" style="width:150px" aria-label="Dari"><input type="date" class="input" id="mto" value="${st.to}" style="width:150px" aria-label="Sampai">
      <button class="btn" id="mexp">${icon('download')} CSV</button>
    </div>
    <div class="card"><div class="muted small mb">${num(list.length)} pergerakan stok</div><div class="table-wrap"><table class="table responsive"><thead><tr><th>Waktu</th><th>Produk</th><th>Jenis</th><th class="num">Jumlah</th><th class="num">Stok Sebelum</th><th class="num">Stok Sesudah</th><th>Catatan</th></tr></thead><tbody>
    ${list.length ? list.slice(0, 400).map((m) => `<tr>
      <td class="first nowrap">${esc(fdatetime(m.date))}</td><td data-label="Produk"><b>${esc(m.productName)}</b><div class="small muted">${esc(m.sku || '')}</div></td>
      <td data-label="Jenis"><span class="badge ${MOVE_COLOR[m.type] || ''}">${esc(MOVEMENT_LABELS[m.type] || m.type)}</span></td>
      <td data-label="Jumlah" class="num bold ${m.qty > 0 ? 'text-success' : 'text-danger'}">${m.qty > 0 ? '+' : ''}${num(m.qty)}</td>
      <td data-label="Sebelum" class="num">${num(m.prevStock)}</td><td data-label="Sesudah" class="num">${num(m.newStock)}</td>
      <td data-label="Catatan"><span class="small">${esc(m.notes || '-')}</span></td></tr>`).join('') : `<tr><td colspan="7">${emptyState('Belum ada riwayat', 'Pergerakan stok akan tercatat otomatis', 'history')}</td></tr>`}
    </tbody></table></div></div>`;
  refreshIcons();
  const body = rootEl.querySelector('#invBody');
  body.querySelector('#mq').addEventListener('input', debounce((e) => { st.mQ = e.target.value; const pos = e.target.selectionStart; drawHistory(); const i = rootEl.querySelector('#mq'); i.focus(); i.setSelectionRange(pos, pos); }, 200));
  body.querySelector('#mt').onchange = (e) => { st.mType = e.target.value; drawHistory(); };
  body.querySelector('#mf').onchange = (e) => { st.from = e.target.value; drawHistory(); };
  body.querySelector('#mto').onchange = (e) => { st.to = e.target.value; drawHistory(); };
  body.querySelector('#mexp').onclick = () => {
    if (!list.length) return toast('Tidak ada data', 'warning');
    downloadCSV(`riwayat-stok-${dateKey()}.csv`, [{ label: 'Waktu', raw: (m) => m.date }, { label: 'Produk', key: 'productName' }, { label: 'SKU', key: 'sku' }, { label: 'Jenis', raw: (m) => MOVEMENT_LABELS[m.type] }, { label: 'Jumlah', key: 'qty' }, { label: 'Stok Sebelum', key: 'prevStock' }, { label: 'Stok Sesudah', key: 'newStock' }, { label: 'Referensi', key: 'ref' }, { label: 'Oleh', key: 'by' }, { label: 'Catatan', key: 'notes' }], list);
  };
}

function draw() { st.tab === 'levels' ? drawLevels() : drawHistory(); }

export async function render(root) {
  rootEl = root;
  await load();
  root.innerHTML = `
    <div class="page-head">
      ${segmented([['levels', 'Stok Barang'], ['history', 'Riwayat Pergerakan']], st.tab, 'data-tab')}
      <div class="flex" style="flex-wrap:wrap">
        <button class="btn btn-success" id="bIn">${icon('package-plus')} Stok Masuk</button>
        <button class="btn" id="bOut">${icon('package-minus')} Stok Keluar</button>
        <button class="btn" id="bAdj">${icon('sliders-horizontal')} Penyesuaian</button>
        <button class="btn btn-primary" id="bOpn">${icon('clipboard-check')} Stok Opname</button>
      </div>
    </div>
    <div id="invBody"></div>`;
  refreshIcons();
  bindSegmented(root, '[data-tab]', (v) => { st.tab = v; draw(); }, 'data-tab');
  root.querySelector('#bIn').onclick = () => openMovement('in');
  root.querySelector('#bOut').onclick = () => openMovement('out');
  root.querySelector('#bAdj').onclick = () => openMovement('adjust');
  root.querySelector('#bOpn').onclick = openOpname;
  draw();
}

async function afterChange() { emit('data-changed'); await load(); if (rootEl) draw(); }

const TITLES = { in: 'Stok Masuk', out: 'Stok Keluar', adjust: 'Penyesuaian Stok' };
function openMovement(type, productId = '') {
  const s = openSheet({
    title: TITLES[type],
    body: `<form id="mf" novalidate>
      <div class="field"><label>Produk <span class="req">*</span></label><select class="select" name="productId"><option value="">Pilih produk</option>${products.map((p) => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${esc(p.name)} (${esc(p.sku)}) — stok ${p.stock}</option>`).join('')}</select><div class="err"></div></div>
      <div class="field"><label>${type === 'adjust' ? 'Selisih jumlah (+ menambah, − mengurangi)' : 'Jumlah'} <span class="req">*</span></label><input class="input" name="qty" type="number" inputmode="numeric" step="1" ${type === 'adjust' ? '' : 'min="1"'} placeholder="${type === 'adjust' ? 'Contoh: -3 atau 5' : 'Contoh: 10'}"><div class="err"></div><div class="hint" id="preview"></div></div>
      <div class="field"><label>Catatan ${type === 'adjust' ? '<span class="req">*</span>' : ''}</label><textarea class="textarea" name="notes" maxlength="200" placeholder="${{ in: 'Contoh: pembelian dari supplier', out: 'Contoh: rusak / kedaluwarsa', adjust: 'Alasan penyesuaian' }[type]}"></textarea><div class="err"></div></div></form>`,
    footer: '<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="sv">Simpan</button>',
  });
  const form = s.el.querySelector('#mf');
  const preview = () => {
    const p = products.find((x) => x.id === form.productId.value); const q = Number(form.qty.value);
    const el = s.el.querySelector('#preview');
    if (!p || !Number.isFinite(q) || form.qty.value === '') return (el.textContent = p ? `Stok saat ini: ${p.stock} ${p.unit}` : '');
    const next = p.stock + (type === 'out' ? -q : q);
    el.textContent = `Stok ${p.stock} → ${next} ${p.unit}`; el.style.color = next < 0 ? 'var(--danger)' : '';
  };
  form.productId.onchange = preview; form.qty.oninput = preview; preview();
  s.el.querySelector('#sv').onclick = async (ev) => {
    const btn = ev.currentTarget; if (btn.classList.contains('loading')) return;
    const v = Object.fromEntries(new FormData(form)); const errs = {};
    if (!v.productId) errs.productId = 'Pilih produk';
    const q = Number(v.qty);
    if (v.qty === '' || !Number.isInteger(q)) errs.qty = 'Jumlah harus bilangan bulat';
    else if (type !== 'adjust' && q <= 0) errs.qty = 'Jumlah harus lebih dari 0';
    else if (type === 'adjust' && q === 0) errs.qty = 'Selisih tidak boleh 0';
    if (type === 'adjust' && !v.notes.trim()) errs.notes = 'Alasan penyesuaian wajib diisi';
    form.querySelectorAll('.field').forEach((f) => { f.classList.remove('invalid'); });
    for (const [k, m] of Object.entries(errs)) { const f = form[k].closest('.field'); f.classList.add('invalid'); f.querySelector('.err').textContent = m; }
    if (Object.keys(errs).length) return;
    btn.classList.add('loading');
    try { await changeStock({ productId: v.productId, type, qty: q, notes: v.notes.trim(), by: state.user.name }); toast(`${TITLES[type]} tersimpan`, 'success'); s.close(); await afterChange(); }
    catch (e) { toast(e.message, 'error', 4500); } finally { btn.classList.remove('loading'); }
  };
}

function openOpname() {
  const s = openSheet({
    title: 'Stok Opname', size: 'lg',
    body: `<p class="muted small mb">Masukkan jumlah stok fisik hasil penghitungan. Kosongkan baris yang tidak dihitung. Selisih akan dicatat sebagai pergerakan stok.</p>
      <div class="search mb"><i data-lucide="search"></i><input class="input" id="oq" placeholder="Cari produk…"></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Produk</th><th class="num">Stok Sistem</th><th class="num" style="width:130px">Stok Fisik</th><th class="num">Selisih</th></tr></thead><tbody>
      ${products.map((p) => `<tr data-n="${esc(p.name.toLowerCase())} ${esc(p.sku.toLowerCase())}"><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.sku)}</div></td><td class="num">${num(p.stock)} ${esc(p.unit)}</td><td class="num"><input class="input" type="number" min="0" step="1" inputmode="numeric" data-p="${p.id}" data-sys="${p.stock}" style="min-height:38px;text-align:right" aria-label="Stok fisik ${esc(p.name)}"></td><td class="num bold" data-diff>-</td></tr>`).join('')}</tbody></table></div>`,
    footer: `<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="sv">${icon('check')} Terapkan Opname</button>`,
  });
  refreshIcons();
  s.el.querySelector('#oq').oninput = (e) => { const q = e.target.value.toLowerCase(); s.el.querySelectorAll('tbody tr').forEach((r) => (r.style.display = r.dataset.n.includes(q) ? '' : 'none')); };
  s.el.querySelector('tbody').addEventListener('input', (e) => {
    const i = e.target.closest('[data-p]'); if (!i) return;
    const cell = i.closest('tr').querySelector('[data-diff]');
    if (i.value === '') { cell.textContent = '-'; cell.className = 'num bold'; return; }
    const d = Number(i.value) - Number(i.dataset.sys); cell.textContent = (d > 0 ? '+' : '') + d; cell.className = `num bold ${d > 0 ? 'text-success' : d < 0 ? 'text-danger' : ''}`;
  });
  s.el.querySelector('#sv').onclick = async (ev) => {
    const btn = ev.currentTarget; if (btn.classList.contains('loading')) return;
    const items = [...s.el.querySelectorAll('[data-p]')].filter((i) => i.value !== '').map((i) => ({ productId: i.dataset.p, counted: Number(i.value) }));
    if (items.some((i) => !Number.isInteger(i.counted) || i.counted < 0)) return toast('Stok fisik harus bilangan bulat ≥ 0', 'error');
    if (!items.length) return toast('Belum ada stok fisik yang diisi', 'warning');
    btn.classList.add('loading');
    try { const n = await stockOpname(items, { by: state.user.name }); toast(n ? `Opname diterapkan: ${n} produk disesuaikan` : 'Tidak ada selisih stok', 'success'); s.close(); await afterChange(); }
    catch (e) { toast(e.message, 'error'); } finally { btn.classList.remove('loading'); }
  };
}
