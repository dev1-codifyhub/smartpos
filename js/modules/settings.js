// Settings: store profile, receipt/tax, app preferences, PWA install, data management.
import { state, saveSettings, saveUser, applyTheme, emit } from '../state.js';
import { esc, icon, refreshIcons, prefs, resizeImage, beep } from '../utils/helpers.js';
import { toast, confirmDialog, promptDialog } from '../ui/ui.js';
import { validateForm } from '../utils/validation.js';
import { exportBackup, importBackupFile, clearAllData, restoreDemo } from '../services/backup.service.js';
import { canInstall, promptInstall, setTheme } from '../app.js';
import { showReceiptPreview } from '../services/receipt.service.js';
import { count } from '../database/db.js';
import { go } from '../router.js';

export function destroy() {}

export async function render(root) {
  const s = state.settings;
  const lang = prefs.get('lang', 'id');
  const theme = document.documentElement.dataset.theme || 'light';
  const counts = { products: await count('products'), transactions: await count('transactions'), customers: await count('customers'), stock_movements: await count('stock_movements') };
  let logo = s.storeLogo || '';

  root.innerHTML = `
  <div class="grid grid-2" style="align-items:start">
    <div class="grid">
      <form class="card" id="storeForm" novalidate>
        <div class="card-head"><h3>${icon('store')} Profil Toko</h3></div>
        <div class="dropzone mb" id="logoDrop"><img id="logoPrev" src="${logo || 'assets/icons/icon-192.png'}" alt="Logo"><div><div class="bold">Logo toko</div><div class="small muted">Tampil di struk (otomatis hitam-putih saat dicetak)</div></div><input type="file" id="logoFile" accept="image/*" class="hidden"></div>
        <div class="flex mb" style="margin-top:-6px"><button type="button" class="btn btn-sm btn-ghost ${logo ? '' : 'hidden'}" id="logoRm">Hapus logo</button></div>
        <div class="field"><label>Nama Toko <span class="req">*</span></label><input class="input" name="storeName" value="${esc(s.storeName)}" maxlength="60"><div class="err"></div></div>
        <div class="field"><label>Alamat</label><textarea class="textarea" name="address" maxlength="160" style="min-height:64px">${esc(s.address)}</textarea></div>
        <div class="field"><label>Nomor Telepon</label><input class="input" name="phone" value="${esc(s.phone)}" maxlength="25" inputmode="tel"><div class="err"></div></div>
        <div class="field"><label>Pesan Footer Struk</label><textarea class="textarea" name="receiptFooter" maxlength="200" style="min-height:64px">${esc(s.receiptFooter)}</textarea><div class="hint">Gunakan baris baru untuk beberapa baris pesan.</div></div>
        <button class="btn btn-primary" type="submit">${icon('save')} Simpan Profil Toko</button>
      </form>

      <form class="card" id="posForm" novalidate>
        <div class="card-head"><h3>${icon('receipt')} Struk, Pajak & Kasir</h3></div>
        <div class="form-row"><div class="field"><label>Lebar Struk Default</label><select class="select" name="receiptWidth"><option value="58" ${s.receiptWidth === '58' ? 'selected' : ''}>58 mm</option><option value="80" ${s.receiptWidth === '80' ? 'selected' : ''}>80 mm</option></select></div>
          <div class="field"><label>Mata Uang Default</label><select class="select" name="currency" disabled><option>IDR — Rupiah Indonesia</option></select></div></div>
        <div class="setting-row"><div><b>Aktifkan pajak</b><small>Ditambahkan pada total belanja</small></div><label class="switch"><input type="checkbox" name="taxEnabled" ${s.taxEnabled ? 'checked' : ''}><span></span></label></div>
        <div class="form-row" style="margin-top:12px"><div class="field"><label>Nama Pajak</label><input class="input" name="taxName" value="${esc(s.taxName)}" maxlength="15"><div class="err"></div></div>
          <div class="field"><label>Tarif Pajak (%)</label><input class="input" name="taxPercent" type="number" step="0.1" min="0" max="100" value="${s.taxPercent}"><div class="err"></div></div></div>
        <div class="form-row"><div class="field"><label>Diskon Default (%)</label><input class="input" name="defaultDiscount" type="number" step="0.5" min="0" max="100" value="${s.defaultDiscount}"><div class="err"></div><div class="hint">Otomatis terisi pada keranjang baru</div></div>
          <div class="field"><label>Batas Stok Menipis</label><input class="input" name="lowStockThreshold" type="number" step="1" min="0" value="${s.lowStockThreshold}"><div class="err"></div><div class="hint">Dipakai jika produk tidak punya stok minimum</div></div></div>
        <div class="setting-row"><div><b>Izinkan pembayaran sebagian</b><small>Sisa tagihan dicatat sebagai belum lunas (butuh pelanggan)</small></div><label class="switch"><input type="checkbox" name="allowPartial" ${s.allowPartial ? 'checked' : ''}><span></span></label></div>
        <div class="flex mt" style="flex-wrap:wrap"><button class="btn btn-primary" type="submit">${icon('save')} Simpan</button><button class="btn" type="button" id="testReceipt">${icon('printer')} Pratinjau & Tes Cetak Struk</button></div>
      </form>

      <form class="card" id="userForm" novalidate>
        <div class="card-head"><h3>${icon('user-round')} Profil Kasir</h3></div>
        <div class="form-row"><div class="field"><label>Nama Kasir <span class="req">*</span></label><input class="input" name="name" value="${esc(state.user.name)}" maxlength="40"><div class="err"></div></div>
        <div class="field"><label>Peran</label><input class="input" name="role" value="${esc(state.user.role || '')}" maxlength="30"></div></div>
        <button class="btn btn-primary" type="submit">${icon('save')} Simpan</button>
      </form>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-head"><h3>${icon('sliders-horizontal')} Aplikasi</h3></div>
        <div class="setting-row"><div><b>Mode Gelap</b><small>Tampilan gelap untuk kondisi minim cahaya</small></div><label class="switch"><input type="checkbox" id="optTheme" ${theme === 'dark' ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div><b>Efek Suara</b><small>Bunyi saat menambah item, scan, dan pembayaran</small></div><label class="switch"><input type="checkbox" id="optSound" ${prefs.get('sound', true) ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div><b>Bahasa</b><small>Menu navigasi</small></div><select class="select" id="optLang" style="width:150px"><option value="id" ${lang === 'id' ? 'selected' : ''}>Indonesia</option><option value="en" ${lang === 'en' ? 'selected' : ''}>English</option></select></div>
        <div class="setting-row"><div><b>Format Mata Uang</b><small>Contoh tampilan harga</small></div><select class="select" id="optFmt" style="width:150px"><option value="symbol" ${s.currencyFormat === 'symbol' ? 'selected' : ''}>Rp 10.000</option><option value="plain" ${s.currencyFormat === 'plain' ? 'selected' : ''}>10.000</option></select></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${icon('smartphone')} Pasang Aplikasi (PWA)</h3></div>
        <p class="muted mb">Pasang Smart POS di layar utama agar terbuka seperti aplikasi native dan tetap bisa dipakai offline.</p>
        <button class="btn btn-primary mb" id="installNow" ${canInstall() ? '' : 'disabled'}>${icon('download')} ${canInstall() ? 'Pasang Sekarang' : 'Pemasangan otomatis belum tersedia'}</button>
        <div class="list small">
          <div class="list-item"><b style="width:92px">iPhone / iPad</b><span>Safari → tombol <b>Bagikan</b> → <b>Tambah ke Layar Utama</b>.</span></div>
          <div class="list-item"><b style="width:92px">Android</b><span>Chrome → menu ⋮ → <b>Instal aplikasi</b> / <b>Tambahkan ke layar utama</b>.</span></div>
          <div class="list-item"><b style="width:92px">Desktop</b><span>Chrome/Edge → ikon <b>Pasang</b> di address bar atau tombol di header.</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${icon('database')} Manajemen Data</h3></div>
        <div class="small muted mb">Tersimpan di perangkat ini (IndexedDB): ${counts.products} produk · ${counts.transactions} transaksi · ${counts.customers} pelanggan · ${counts.stock_movements} pergerakan stok</div>
        <div class="grid" style="gap:10px">
          <button class="btn btn-block" id="bkExport" style="justify-content:flex-start">${icon('download')} Ekspor Backup Lengkap (JSON)</button>
          <button class="btn btn-block" id="bkImport" style="justify-content:flex-start">${icon('upload')} Impor / Pulihkan Backup</button>
          <input type="file" id="bkFile" accept=".json,application/json" class="hidden">
          <button class="btn btn-block" id="demoBtn" style="justify-content:flex-start">${icon('flask-conical')} Muat Ulang Data Demo</button>
          <button class="btn btn-danger btn-block" id="clearBtn" style="justify-content:flex-start">${icon('trash-2')} Hapus Semua Data Aplikasi</button>
        </div>
        <div class="alert blue mt">${icon('info')}<span>Data hanya ada di browser ini. Lakukan backup rutin agar aman jika perangkat/browser diganti.</span></div>
      </div>
    </div>
  </div>`;
  refreshIcons();

  const sectionSave = async (form, rules, build, msg) => {
    const { ok, values } = validateForm(form, rules);
    if (!ok) return false;
    try { await saveSettings(build(values)); toast(msg, 'success'); return true; } catch (e) { toast(e.message, 'error'); return false; }
  };

  // store form
  const logoFile = root.querySelector('#logoFile');
  root.querySelector('#logoDrop').onclick = () => logoFile.click();
  logoFile.onchange = async () => { if (!logoFile.files[0]) return; try { logo = await resizeImage(logoFile.files[0], 240, 0.9); root.querySelector('#logoPrev').src = logo; root.querySelector('#logoRm').classList.remove('hidden'); } catch (e) { toast(e.message, 'error'); } };
  root.querySelector('#logoRm').onclick = () => { logo = ''; root.querySelector('#logoPrev').src = 'assets/icons/icon-192.png'; root.querySelector('#logoRm').classList.add('hidden'); };
  root.querySelector('#storeForm').onsubmit = (e) => { e.preventDefault(); sectionSave(e.target, { storeName: { label: 'Nama toko', required: true, maxLen: 60 }, phone: { label: 'Telepon', maxLen: 25, pattern: /^[0-9+\-\s()]*$/, message: 'Telepon hanya boleh berisi angka, spasi, +, -, ( )' } }, (v) => ({ storeName: v.storeName.trim(), address: v.address.trim(), phone: v.phone.trim(), receiptFooter: v.receiptFooter.trim(), storeLogo: logo }), 'Profil toko disimpan'); };

  // pos form
  root.querySelector('#posForm').onsubmit = (e) => {
    e.preventDefault();
    sectionSave(e.target, { taxName: { label: 'Nama pajak', maxLen: 15 }, taxPercent: { label: 'Tarif pajak', type: 'number', min: 0, max: 100, required: true }, defaultDiscount: { label: 'Diskon default', type: 'number', min: 0, max: 100, required: true }, lowStockThreshold: { label: 'Batas stok menipis', type: 'int', min: 0, required: true } },
      (v) => ({ receiptWidth: v.receiptWidth, taxEnabled: !!v.taxEnabled, taxName: v.taxName.trim() || 'PPN', taxPercent: Number(v.taxPercent), defaultDiscount: Number(v.defaultDiscount), lowStockThreshold: Number(v.lowStockThreshold), allowPartial: !!v.allowPartial }), 'Pengaturan disimpan').then((ok) => ok && emit('data-changed'));
  };
  root.querySelector('#testReceipt').onclick = () => {
    const now = new Date().toISOString();
    showReceiptPreview({ id: 'TRX-CONTOH-0001', createdAt: now, cashier: state.user.name, customerName: 'Umum', status: 'completed', items: [{ name: 'Beras Premium 5kg', qty: 1, price: 72000, discount: 0 }, { name: 'Kopi Arabika 200g', qty: 2, price: 55000, discount: 0 }], gross: 182000, discount: 0, tax: 0, taxPercent: 0, total: 182000, paymentMethod: 'cash', paid: 200000, change: 18000, remaining: 0, notes: '' });
  };

  // user form
  root.querySelector('#userForm').onsubmit = async (e) => { e.preventDefault(); const { ok, values } = validateForm(e.target, { name: { label: 'Nama kasir', required: true, maxLen: 40 } }); if (!ok) return; await saveUser({ name: values.name.trim(), role: (values.role || '').trim() }); toast('Profil kasir disimpan', 'success'); };

  // app prefs
  root.querySelector('#optTheme').onchange = (e) => setTheme(e.target.checked ? 'dark' : 'light');
  root.querySelector('#optSound').onchange = (e) => { prefs.set('sound', e.target.checked); if (e.target.checked) beep('success'); };
  root.querySelector('#optLang').onchange = (e) => { prefs.set('lang', e.target.value); emit('settings-changed', {}); toast(e.target.value === 'id' ? 'Bahasa: Indonesia' : 'Language: English', 'success'); go('settings'); };
  root.querySelector('#optFmt').onchange = async (e) => { await saveSettings({ currencyFormat: e.target.value }); toast('Format mata uang diubah', 'success'); };
  root.querySelector('#installNow').onclick = async () => { const ok = await promptInstall(); if (!ok) toast('Pemasangan dibatalkan', 'info'); };

  // data
  root.querySelector('#bkExport').onclick = async () => { try { const c = await exportBackup(); toast(`Backup diunduh (${c.products} produk, ${c.transactions} transaksi)`, 'success'); } catch (e) { toast(e.message, 'error'); } };
  const bkFile = root.querySelector('#bkFile');
  root.querySelector('#bkImport').onclick = () => bkFile.click();
  bkFile.onchange = async () => {
    const file = bkFile.files[0]; bkFile.value = ''; if (!file) return;
    if (!(await confirmDialog({ title: 'Pulihkan backup?', message: 'Seluruh data saat ini akan <b>diganti</b> dengan isi file backup. Disarankan melakukan backup data saat ini terlebih dahulu.', confirmText: 'Ya, pulihkan', danger: true }))) return;
    try { const c = await importBackupFile(file); emit('data-changed'); toast(`Backup dipulihkan: ${c.products} produk, ${c.transactions} transaksi`, 'success', 4500); applyTheme(); go('dashboard'); } catch (e) { toast(e.message, 'error', 5000); }
  };
  root.querySelector('#demoBtn').onclick = async () => {
    if (!(await confirmDialog({ title: 'Muat ulang data demo?', message: 'Seluruh data saat ini akan diganti dengan data demo.', confirmText: 'Muat data demo', danger: true }))) return;
    try { await restoreDemo(); emit('data-changed'); toast('Data demo dimuat', 'success'); go('dashboard'); } catch (e) { toast(e.message, 'error'); }
  };
  root.querySelector('#clearBtn').onclick = async () => {
    if (!(await confirmDialog({ title: 'Hapus semua data?', message: 'Semua produk, transaksi, pelanggan, dan riwayat stok akan dihapus <b>permanen</b>. Tindakan ini tidak dapat dibatalkan.', confirmText: 'Lanjutkan', danger: true }))) return;
    const t = await promptDialog({ title: 'Konfirmasi akhir', label: 'Ketik HAPUS untuk mengonfirmasi', placeholder: 'HAPUS', confirmText: 'Hapus Semua', danger: true, multiline: false });
    if (t !== 'HAPUS') { if (t !== null) toast('Konfirmasi tidak sesuai. Data tidak dihapus.', 'warning'); return; }
    try { await clearAllData(); prefs.remove('cart'); emit('data-changed'); toast('Semua data dihapus', 'success'); go('dashboard'); } catch (e) { toast(e.message, 'error'); }
  };
}
