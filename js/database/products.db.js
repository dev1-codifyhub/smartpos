// Products, categories, customers, inventory (stock movements). Every stock change writes a movement record.
import { getAll, getById, put, remove, withTx, tGet, tPut, tAll, tAdd, tDel, reqP } from './db.js';
import { uid } from '../utils/helpers.js';
import { validateValues } from '../utils/validation.js';

/* ============ Categories ============ */
export const listCategories = async () => (await getAll('categories')).sort((a, b) => a.name.localeCompare(b.name, 'id'));

export async function saveCategory(c) {
  const errors = validateValues(c, { name: { label: 'Nama kategori', required: true, maxLen: 40 } });
  if (Object.keys(errors).length) throw Object.assign(new Error(Object.values(errors)[0]), { errors });
  const all = await getAll('categories');
  if (all.some((x) => x.id !== c.id && x.name.toLowerCase() === c.name.trim().toLowerCase())) throw new Error('Nama kategori sudah digunakan');
  const rec = { id: c.id || uid(), name: c.name.trim(), color: c.color || '#DC2626', createdAt: c.createdAt || new Date().toISOString() };
  await put('categories', rec);
  return rec;
}
export async function deleteCategory(id) {
  const used = (await getAll('products')).filter((p) => p.categoryId === id).length;
  if (used) throw new Error(`Kategori masih dipakai oleh ${used} produk. Pindahkan produk terlebih dahulu.`);
  await remove('categories', id);
}

/* ============ Customers ============ */
export const listCustomers = async () => (await getAll('customers')).sort((a, b) => a.name.localeCompare(b.name, 'id'));
export async function saveCustomer(c) {
  const errors = validateValues(c, { name: { label: 'Nama pelanggan', required: true, maxLen: 60 }, phone: { label: 'Telepon', maxLen: 20 } });
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const rec = { id: c.id || uid(), name: c.name.trim(), phone: (c.phone || '').trim(), createdAt: c.createdAt || new Date().toISOString() };
  await put('customers', rec);
  return rec;
}

/* ============ Products ============ */
export const listProducts = () => getAll('products');
export const getProduct = (id) => getById('products', id);

export const PRODUCT_RULES = {
  name: { label: 'Nama produk', required: true, maxLen: 120 },
  sku: { label: 'SKU', required: true, maxLen: 40 },
  barcode: { label: 'Barcode', maxLen: 40 },
  categoryId: { label: 'Kategori', required: true },
  purchasePrice: { label: 'Harga beli', required: true, type: 'int', min: 0 },
  sellingPrice: { label: 'Harga jual', required: true, type: 'int', min: 0 },
  stock: { label: 'Stok', type: 'int', min: 0 },
  minStock: { label: 'Stok minimum', type: 'int', min: 0 },
  unit: { label: 'Satuan', required: true, maxLen: 15 },
};

export async function findByCode(code) {
  code = String(code || '').trim();
  if (!code) return null;
  const all = await getAll('products');
  return all.find((p) => p.barcode === code) || all.find((p) => p.sku.toLowerCase() === code.toLowerCase()) || null;
}

// Create or update. For NEW products initial stock is recorded as a movement.
// For existing products stock is never changed here (use changeStock).
export async function saveProduct(input, { userName = 'Sistem' } = {}) {
  const errors = validateValues(input, PRODUCT_RULES);
  if (Object.keys(errors).length) throw Object.assign(new Error(Object.values(errors)[0]), { errors });
  return withTx(['products', 'stock_movements'], 'readwrite', async (t) => {
    const all = await tAll(t, 'products');
    const sku = input.sku.trim();
    const barcode = (input.barcode || '').trim();
    if (all.some((p) => p.id !== input.id && p.sku.toLowerCase() === sku.toLowerCase())) throw Object.assign(new Error('SKU sudah digunakan produk lain'), { errors: { sku: 'SKU sudah digunakan produk lain' } });
    if (barcode && all.some((p) => p.id !== input.id && p.barcode === barcode)) throw Object.assign(new Error('Barcode sudah digunakan produk lain'), { errors: { barcode: 'Barcode sudah digunakan produk lain' } });
    const existing = input.id ? await tGet(t, 'products', input.id) : null;
    const rec = {
      id: existing ? existing.id : (input.id || uid()),
      name: input.name.trim(), sku, barcode,
      categoryId: input.categoryId,
      purchasePrice: Number(input.purchasePrice), sellingPrice: Number(input.sellingPrice),
      stock: existing ? existing.stock : Number(input.stock || 0),
      minStock: Number(input.minStock || 0),
      unit: input.unit.trim(), image: input.image || '', description: (input.description || '').trim(),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await tPut(t, 'products', rec);
    if (!existing && rec.stock > 0) {
      await tAdd(t, 'stock_movements', movement(rec, 'initial', rec.stock, 0, rec.stock, 'Stok awal produk baru', '', userName));
    }
    return rec;
  });
}

export async function deleteProduct(id) { await remove('products', id); }

/* ============ Stock movements ============ */
function movement(p, type, qty, prev, next, notes = '', ref = '', by = 'Sistem') {
  return { id: uid(), productId: p.id, productName: p.name, sku: p.sku, unit: p.unit, type, qty, prevStock: prev, newStock: next, date: new Date().toISOString(), notes, ref, by };
}

// Core stock mutation. MUST be called inside a readwrite tx covering products + stock_movements.
// delta can be negative. Throws if the new stock would be negative.
export async function applyStock(t, productId, { type, delta, notes = '', ref = '', by = 'Sistem' }) {
  const p = await tGet(t, 'products', productId);
  if (!p) throw new Error('Produk tidak ditemukan');
  const prev = p.stock;
  const next = prev + delta;
  if (next < 0) throw new Error(`Stok ${p.name} tidak mencukupi (tersedia ${prev})`);
  p.stock = next; p.updatedAt = new Date().toISOString();
  await tPut(t, 'products', p);
  const m = movement(p, type, delta, prev, next, notes, ref, by);
  await tAdd(t, 'stock_movements', m);
  return { product: p, movement: m };
}

// type: in | out | adjust (qty = signed delta) | opname (qty = counted actual stock)
export async function changeStock({ productId, type, qty, notes = '', by = 'Sistem' }) {
  qty = Number(qty);
  if (!Number.isFinite(qty) || !Number.isInteger(qty)) throw new Error('Jumlah harus bilangan bulat');
  return withTx(['products', 'stock_movements'], 'readwrite', async (t) => {
    let delta;
    if (type === 'in') { if (qty <= 0) throw new Error('Jumlah stok masuk harus lebih dari 0'); delta = qty; }
    else if (type === 'out') { if (qty <= 0) throw new Error('Jumlah stok keluar harus lebih dari 0'); delta = -qty; }
    else if (type === 'adjust') { if (qty === 0) throw new Error('Penyesuaian tidak boleh 0'); delta = qty; }
    else if (type === 'opname') {
      if (qty < 0) throw new Error('Stok fisik tidak boleh negatif');
      const p = await tGet(t, 'products', productId);
      if (!p) throw new Error('Produk tidak ditemukan');
      delta = qty - p.stock;
      if (delta === 0) return null;
    } else throw new Error('Tipe pergerakan tidak valid');
    return applyStock(t, productId, { type, delta, notes, by });
  });
}

// Stock opname for many products atomically. items: [{productId, counted}]
export async function stockOpname(items, { notes = 'Stok opname', by = 'Sistem' } = {}) {
  return withTx(['products', 'stock_movements'], 'readwrite', async (t) => {
    let changed = 0;
    for (const it of items) {
      const p = await tGet(t, 'products', it.productId);
      if (!p) continue;
      const delta = it.counted - p.stock;
      if (delta === 0) continue;
      await applyStock(t, it.productId, { type: 'opname', delta, notes: `${notes} (sistem ${p.stock} → fisik ${it.counted})`, by });
      changed++;
    }
    return changed;
  });
}

export const listMovements = async () => (await getAll('stock_movements')).sort((a, b) => b.date.localeCompare(a.date));
export { reqP, tDel };
