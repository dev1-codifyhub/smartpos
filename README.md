# Smart POS — Progressive Web App Kasir

Aplikasi Point of Sale offline-first untuk toko retail, minimarket, dan kafe.
HTML5 + CSS3 + Vanilla JavaScript (ES modules), IndexedDB, Service Worker, tanpa backend dan tanpa framework.

## Menjalankan secara lokal

Aplikasi memakai ES modules dan Service Worker, jadi harus dibuka lewat HTTP (bukan klik dua kali `index.html`).

```bash
cd smart-pos
node server.js          # http://localhost:5173
```

Alternatif: `npx serve .`, `python -m http.server 5173`, atau ekstensi Live Server di VS Code.
`localhost` dianggap secure context, sehingga kamera, Service Worker, dan instalasi PWA berfungsi.

Saat pertama dibuka, data demo (24 produk, 5 kategori, 5 pelanggan, ±70 transaksi 30 hari terakhir, riwayat stok) dibuat otomatis.

## Deploy ke static hosting (HTTPS wajib)

Seluruh folder `smart-pos/` adalah situs statis. Tidak ada proses build. Unggah seluruh isi folder apa adanya:

| Hosting | Cara |
|---|---|
| Netlify | Drag & drop folder `smart-pos` di app.netlify.com/drop, atau `netlify deploy --dir smart-pos --prod` |
| Vercel | `npx vercel smart-pos --prod` |
| Cloudflare Pages | Buat project, "Direct upload", pilih folder `smart-pos` |
| GitHub Pages | Push isi folder ke repo, aktifkan Pages (branch `main`, root). Semua path bersifat relatif sehingga aman di sub-path |
| Hostinger / cPanel | Unggah isi folder ke `public_html` lewat File Manager/FTP |

Setelah deploy:
1. Buka URL HTTPS di Chrome/Edge/Safari.
2. Muat sekali saat online, lalu aplikasi dapat dipakai offline.
3. Pasang: Android Chrome → menu ⋮ → *Instal aplikasi*; iOS Safari → *Bagikan → Tambah ke Layar Utama*; desktop → ikon *Pasang* di address bar.
4. Saat merilis versi baru, naikkan `VERSION` di `service-worker.js` agar cache lama diganti.

## Struktur

```
smart-pos/
├── index.html · manifest.json · service-worker.js · offline.html · server.js
├── assets/icons (192, 512, maskable, apple-touch, svg) · assets/vendor (Chart.js, Lucide, JsBarcode, html5-qrcode, jsPDF — lokal, jalan offline)
├── css/ variables · main · layout · components · responsive · print
├── js/
│   ├── app.js · router.js · state.js
│   ├── database/  db.js (service IndexedDB bersama) · products.db.js · transactions.db.js · seed.js
│   ├── modules/   dashboard · pos · products · categories · inventory · transactions · reports · barcode · settings
│   ├── services/  receipt.service · export.service · backup.service · analytics
│   ├── ui/        ui.js (sheet/modal, toast, confirm) · charts.js
│   └── utils/     format · validation · helpers · print
└── tools/make-icons.js   (generator ikon PNG tanpa dependensi)
```

## Catatan desain data

- **IndexedDB** (`smart-pos-db`, v1): `products, categories, transactions, customers, stock_movements, settings, users`. Migrasi per versi ada di `db.js` (`MIGRATIONS`).
- **Penjualan atomik**: validasi stok → kurangi stok → catat `stock_movements` → simpan transaksi, semua dalam satu transaksi IndexedDB (gagal = rollback total).
- **Anti-duplikat**: ID transaksi dibuat saat dialog pembayaran dibuka; `createSale` idempoten terhadap ID yang sama, ditambah pengunci tombol di UI.
- **Laba** = Penjualan Bersih − HPP, memakai harga beli yang disimpan pada setiap item transaksi saat penjualan (bukan harga beli produk saat ini).
- **Void transaksi** mengembalikan stok lewat pergerakan stok bertipe `void` dan menambah jejak audit; transaksi tidak dihapus.
- Service Worker hanya men-cache aset statis; data bisnis tidak pernah masuk Cache Storage.

## Pencetakan struk & barcode

- Struk 58 mm / 80 mm lewat `window.print()` + `@page size` dinamis; semua UI aplikasi disembunyikan oleh `css/print.css`. Di dialog cetak pilih printer thermal dan matikan header/footer browser.
- Printer USB/Serial (ESC/POS) lewat Web Serial (Chrome/Edge) tersedia di pratinjau struk.
- Scanner barcode: kamera (html5-qrcode, kamera belakang, senter bila didukung), input manual, dan scanner USB/Bluetooth bergaya keyboard (otomatis terdeteksi di layar Kasir).
