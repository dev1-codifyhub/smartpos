// Shared IndexedDB service. All modules go through this file.

export const DB_NAME = 'smart-pos-db';
export const DB_VERSION = 1;
export const STORES = ['products', 'categories', 'transactions', 'customers', 'stock_movements', 'settings', 'users'];

// Migration strategy: each entry upgrades the schema FROM (version - 1) TO version.
// Add new entries when DB_VERSION is bumped; never edit past migrations.
const MIGRATIONS = {
  1(db) {
    const products = db.createObjectStore('products', { keyPath: 'id' });
    products.createIndex('sku', 'sku', { unique: false });
    products.createIndex('barcode', 'barcode', { unique: false });
    products.createIndex('categoryId', 'categoryId', { unique: false });
    db.createObjectStore('categories', { keyPath: 'id' });
    const tx = db.createObjectStore('transactions', { keyPath: 'id' });
    tx.createIndex('dateKey', 'dateKey', { unique: false });
    tx.createIndex('createdAt', 'createdAt', { unique: false });
    tx.createIndex('status', 'status', { unique: false });
    db.createObjectStore('customers', { keyPath: 'id' });
    const mv = db.createObjectStore('stock_movements', { keyPath: 'id' });
    mv.createIndex('productId', 'productId', { unique: false });
    mv.createIndex('date', 'date', { unique: false });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('users', { keyPath: 'id' });
  },
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Browser tidak mendukung IndexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion + 1; v <= (e.newVersion || DB_VERSION); v++) {
        if (MIGRATIONS[v]) MIGRATIONS[v](db, req.transaction);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error || new Error('Gagal membuka database')); };
    req.onblocked = () => reject(new Error('Database diblokir oleh tab lain. Tutup tab lain lalu muat ulang.'));
  });
  return dbPromise;
}

export const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Run `fn(tx)` inside ONE IndexedDB transaction. If fn throws, the whole transaction is rolled back.
export async function withTx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result, failed = false;
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error || new Error('Transaksi database dibatalkan'));
    t.onerror = () => { /* handled by onabort */ };
    Promise.resolve()
      .then(() => fn(t))
      .then((r) => { result = r; })
      .catch((e) => { failed = true; try { t.abort(); } catch { /* already finished */ } reject(e); });
  });
}

// ---- Transaction-scoped helpers ----
export const tGet = (t, store, key) => reqP(t.objectStore(store).get(key));
export const tAll = (t, store, query) => reqP(t.objectStore(store).getAll(query));
export const tPut = (t, store, val) => reqP(t.objectStore(store).put(val));
export const tAdd = (t, store, val) => reqP(t.objectStore(store).add(val));
export const tDel = (t, store, key) => reqP(t.objectStore(store).delete(key));

// ---- Simple CRUD (each in its own transaction) ----
export const getAll = (store) => withTx(store, 'readonly', (t) => tAll(t, store));
export const getById = (store, key) => withTx(store, 'readonly', (t) => tGet(t, store, key));
export const put = (store, val) => withTx(store, 'readwrite', (t) => tPut(t, store, val));
export const remove = (store, key) => withTx(store, 'readwrite', (t) => tDel(t, store, key));
export const count = (store) => withTx(store, 'readonly', (t) => reqP(t.objectStore(store).count()));
export const clearStore = (store) => withTx(store, 'readwrite', (t) => reqP(t.objectStore(store).clear()));
export const bulkPut = (store, items) => withTx(store, 'readwrite', async (t) => { for (const i of items) await tPut(t, store, i); return items.length; });
export const getByIndex = (store, index, value) => withTx(store, 'readonly', (t) => reqP(t.objectStore(store).index(index).getAll(value)));
export const getRange = (store, index, lower, upper) =>
  withTx(store, 'readonly', (t) => reqP(t.objectStore(store).index(index).getAll(IDBKeyRange.bound(lower, upper))));

// Replace entire database content atomically (restore / seed)
export async function replaceAll(data) {
  return withTx(STORES, 'readwrite', async (t) => {
    for (const s of STORES) {
      await reqP(t.objectStore(s).clear());
      for (const item of data[s] || []) await tPut(t, s, item);
    }
  });
}
export async function exportAll() {
  return withTx(STORES, 'readonly', async (t) => {
    const out = {};
    for (const s of STORES) out[s] = await tAll(t, s);
    return out;
  });
}

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
