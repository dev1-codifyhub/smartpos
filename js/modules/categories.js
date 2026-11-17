// Category management.
import { listCategories, listProducts, saveCategory, deleteCategory } from '../database/products.db.js';
import { esc, icon, refreshIcons, COLORS } from '../utils/helpers.js';
import { openSheet, toast, confirmDialog, emptyState } from '../ui/ui.js';
import { emit } from '../state.js';

let rootEl = null;
export function destroy() { rootEl = null; }

async function draw() {
  const [cats, prods] = await Promise.all([listCategories(), listProducts()]);
  if (!rootEl) return;
  const count = (id) => prods.filter((p) => p.categoryId === id).length;
  const box = rootEl.querySelector('#catGrid');
  box.innerHTML = cats.length ? cats.map((c) => `
    <div class="card cat-card" data-id="${c.id}">
      <div class="swatch" style="background:${esc(c.color)}">${icon('tag', 'style="width:22px;height:22px"')}</div>
      <div class="grow"><div class="bold">${esc(c.name)}</div><div class="small muted">${count(c.id)} produk</div></div>
      <div class="row-actions"><button class="btn btn-ghost btn-icon btn-sm" data-act="edit" aria-label="Edit">${icon('pencil')}</button><button class="btn btn-ghost btn-icon btn-sm" data-act="del" aria-label="Hapus" style="color:var(--danger)">${icon('trash-2')}</button></div>
    </div>`).join('') : `<div class="card" style="grid-column:1/-1">${emptyState('Belum ada kategori', 'Tambahkan kategori untuk mengelompokkan produk', 'tags')}</div>`;
  refreshIcons();
  box._cats = cats;
}

export async function render(root) {
  rootEl = root;
  root.innerHTML = `<div class="page-head"><span class="muted">Kelompokkan produk agar mudah dicari di kasir.</span><button class="btn btn-primary" id="add">${icon('plus')} Tambah Kategori</button></div><div class="grid grid-3" id="catGrid"></div>`;
  refreshIcons();
  await draw();
  root.querySelector('#add').onclick = () => openForm();
  root.querySelector('#catGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const c = e.currentTarget._cats.find((x) => x.id === b.closest('[data-id]').dataset.id);
    if (b.dataset.act === 'edit') openForm(c);
    else if (await confirmDialog({ title: 'Hapus kategori?', message: `Kategori <b>${esc(c.name)}</b> akan dihapus.`, confirmText: 'Hapus', danger: true })) {
      try { await deleteCategory(c.id); toast('Kategori dihapus', 'success'); emit('data-changed'); draw(); } catch (er) { toast(er.message, 'error', 4500); }
    }
  });
}

function openForm(c = null) {
  const s = openSheet({
    title: c ? 'Edit Kategori' : 'Tambah Kategori', size: 'sm',
    body: `<form id="cf" novalidate><div class="field"><label>Nama kategori <span class="req">*</span></label><input class="input" name="name" maxlength="40" value="${esc(c?.name || '')}"><div class="err"></div></div>
      <div class="field"><label>Warna label</label><div class="color-row">${COLORS.map((col) => `<label style="background:${col};color:${col}"><input type="radio" name="color" value="${col}" ${(c?.color || COLORS[0]) === col ? 'checked' : ''}></label>`).join('')}</div></div></form>`,
    footer: '<button class="btn" data-close>Batal</button><button class="btn btn-primary" id="sv">Simpan</button>',
  });
  const form = s.el.querySelector('#cf');
  const submit = async () => {
    const v = Object.fromEntries(new FormData(form));
    if (!v.name.trim()) { form.querySelector('.field').classList.add('invalid'); form.querySelector('.err').textContent = 'Nama kategori wajib diisi'; return; }
    try { await saveCategory({ ...c, ...v }); toast('Kategori disimpan', 'success'); emit('data-changed'); s.close(); draw(); } catch (e) { toast(e.message, 'error'); }
  };
  s.el.querySelector('#sv').onclick = submit;
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
}
