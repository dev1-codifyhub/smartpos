// Dashboard: all numbers are computed from IndexedDB records.
import { listProducts, listCategories } from '../database/products.db.js';
import { listTransactions } from '../database/transactions.db.js';
import { summarize, series, trend, topProducts } from '../services/analytics.js';
import { rupiah, num, fdateKey, ftime, payLabel, statusLabel } from '../utils/format.js';
import { presetRange, esc, icon, refreshIcons, todayKey, dateKey, prefs } from '../utils/helpers.js';
import { segmented, bindSegmented, emptyState } from '../ui/ui.js';
import { ChartSet, lineAreaConfig, barConfig } from '../ui/charts.js';
import { isLow, isOut, stockLimit } from '../state.js';
import { showTransactionDetail } from './transactions.js';
import { go } from '../router.js';

let charts, st = { preset: 'today', from: todayKey(), to: todayKey(), trendMode: 'daily' };

export function destroy() { charts && charts.destroyAll(); charts = null; }

export async function render(root) {
  charts = new ChartSet();
  const [products, cats, txns] = await Promise.all([listProducts(), listCategories(), listTransactions()]);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));

  root.innerHTML = `
    <div class="page-head">
      <div class="flex" style="flex-wrap:wrap">
        ${segmented([['today', 'Hari Ini'], ['week', 'Minggu Ini'], ['month', 'Bulan Ini'], ['custom', 'Kustom']], st.preset, 'data-p')}
        <div class="flex ${st.preset === 'custom' ? '' : 'hidden'}" id="customRange">
          <input type="date" class="input" id="dFrom" value="${st.from}" style="width:150px" aria-label="Dari tanggal">
          <span class="muted">—</span>
          <input type="date" class="input" id="dTo" value="${st.to}" style="width:150px" aria-label="Sampai tanggal">
        </div>
      </div>
      <span class="muted small" id="rangeLabel"></span>
    </div>
    <div class="dash-top"><div class="hero-card" id="hero"></div><div class="stat-grid" id="cards"></div></div>
    <div class="grid grid-main mt">
      <div class="card"><div class="card-head"><div><h3>Grafik Penjualan</h3><small id="trendSub"></small></div>${segmented([['daily', 'Harian'], ['weekly', 'Mingguan'], ['monthly', 'Bulanan']], st.trendMode, 'data-t')}</div><div class="chart-box"><canvas id="cTrend"></canvas></div></div>
      <div class="card"><div class="card-head"><div><h3>Produk Terlaris</h3><small>Berdasarkan jumlah terjual</small></div></div><div id="topWrap"><div class="chart-box sm"><canvas id="cTop"></canvas></div></div></div>
    </div>
    <div class="card mt"><div class="card-head"><div><h3>Pendapatan vs Keuntungan</h3><small>Penjualan bersih dan laba kotor pada periode terpilih</small></div></div><div class="chart-box"><canvas id="cRevProfit"></canvas></div></div>
    <div class="grid grid-2 mt">
      <div class="card"><div class="card-head"><h3>Operasi Terbaru</h3><a href="#/transactions" class="link-muted">Lihat semua</a></div><div class="list" id="recent"></div></div>
      <div class="card"><div class="card-head"><h3>Peringatan Stok</h3><a href="#/inventory" class="small bold">Kelola stok</a></div><div class="list" id="lowList"></div></div>
    </div>`;

  const stat = (ic, color, label, value, sub = '') => `<div class="card stat"><div class="ico ${color}">${icon(ic)}</div><div><div class="label">${label}</div><div class="value">${value}</div></div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  function inRange(list) { return list.filter((t) => t.dateKey >= st.from && t.dateKey <= st.to); }

  function draw() {
    const cur = inRange(txns);
    const s = summarize(cur);
    const low = products.filter((p) => isLow(p) || isOut(p));
    const label = { today: 'Hari Ini', week: 'Minggu Ini', month: 'Bulan Ini', custom: 'Periode' }[st.preset];
    root.querySelector('#rangeLabel').textContent = st.from === st.to ? fdateKey(st.from) : `${fdateKey(st.from)} – ${fdateKey(st.to)}`;
    const masked = prefs.get('maskHero', false);
    const mk = (v) => (masked ? '••••••' : v);
    root.querySelector('#hero').innerHTML = `
      <div class="hero-top"><b class="hero-brand">Smart POS</b><button class="hero-pill" id="maskBtn" aria-label="Tampilkan atau sembunyikan angka">${icon(masked ? 'eye-off' : 'eye')} ${masked ? 'Tampilkan' : 'Sembunyikan'}</button></div>
      <div><div class="hero-label">Total Penjualan ${label}</div><div class="hero-amount">${mk(rupiah(s.net))}</div></div>
      <div class="hero-foot"><div><span>Transaksi</span><b>${num(s.count)}</b></div><div><span>Keuntungan</span><b>${mk(rupiah(s.profit))}</b></div><div><span>Margin</span><b>${mk(s.margin.toFixed(1) + '%')}</b></div></div>`;
    root.querySelector('#maskBtn').onclick = () => { prefs.set('maskHero', !prefs.get('maskHero', false)); draw(); };
    root.querySelector('#cards').innerHTML =
      stat('receipt', 'green', 'Total Transaksi', num(s.count), s.count ? `Rata-rata ${rupiah(s.avg)}` : 'Belum ada transaksi') +
      stat('trending-up', 'green', 'Total Keuntungan', rupiah(s.profit), `Margin ${s.margin.toFixed(1)}%`) +
      stat('package', 'amber', 'Total Produk', num(products.length), `${cats.length} kategori`) +
      stat('alert-triangle', 'red', 'Stok Menipis', num(low.length), `${products.filter(isOut).length} produk habis`);

    // revenue vs profit (period)
    const sr = series(txns, st.from, st.to);
    charts.make('rp', root.querySelector('#cRevProfit'), lineAreaConfig(sr.map((b) => b.label), [
      { label: 'Penjualan Bersih', data: sr.map((b) => b.net), color: '#DC2626' },
      { label: 'Laba Kotor', data: sr.map((b) => b.profit), color: '#16A36A' },
    ]));

    // top products
    const top = topProducts(cur, 5, 'qty');
    const wrap = root.querySelector('#topWrap');
    if (!top.length) { charts.destroy('top'); wrap.innerHTML = emptyState('Belum ada penjualan', 'Data muncul setelah ada transaksi pada periode ini', 'bar-chart-3'); }
    else {
      if (!wrap.querySelector('canvas')) wrap.innerHTML = '<div class="chart-box sm"><canvas id="cTop"></canvas></div>';
      charts.make('top', wrap.querySelector('canvas'), barConfig(top.map((t) => t.name.length > 18 ? t.name.slice(0, 17) + '…' : t.name), [{ label: 'Terjual', data: top.map((t) => t.qty) }], { money: false, horizontal: true }));
    }
    refreshIcons();
  }

  function drawTrend() {
    const tr = trend(txns, st.trendMode);
    root.querySelector('#trendSub').textContent = { daily: '14 hari terakhir', weekly: '12 minggu terakhir', monthly: '12 bulan terakhir' }[st.trendMode];
    const useBar = st.trendMode !== 'daily';
    const cfg = useBar ? barConfig(tr.map((b) => b.label), [{ label: 'Penjualan Bersih', data: tr.map((b) => b.net) }]) : lineAreaConfig(tr.map((b) => b.label), [{ label: 'Penjualan Bersih', data: tr.map((b) => b.net) }]);
    charts.make('trend', root.querySelector('#cTrend'), cfg);
  }

  // recent + low stock lists (not filtered by period)
  const recent = txns.slice(0, 7);
  const yKey = dateKey(new Date(Date.now() - 86400000));
  const groups = new Map();
  for (const t of recent) { const k = t.dateKey; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const gLabel = (k) => (k === todayKey() ? 'Hari ini' : k === yKey ? 'Kemarin' : fdateKey(k));
  const payIcon = { cash: 'banknote', transfer: 'landmark', qris: 'qr-code', other: 'wallet' };
  root.querySelector('#recent').innerHTML = recent.length ? [...groups].map(([k, list]) => `<div class="op-group"><div class="op-label">${esc(gLabel(k))}</div>${list.map((t) => `
    <div class="op-item" data-id="${esc(t.id)}">
      <div class="op-ico">${icon(t.status === 'void' ? 'ban' : payIcon[t.paymentMethod] || 'receipt', 'style="width:20px;height:20px"')}</div>
      <div class="op-body"><div style="min-width:0"><div class="op-title">${esc(t.customerName === 'Umum' ? payLabel(t.paymentMethod) : t.customerName)}</div><div class="op-sub">${esc(t.id.slice(-10))}${t.status !== 'completed' ? ' · ' + esc(statusLabel(t.status)) : ''}</div></div>
      <div class="op-amt"><b ${t.status === 'void' ? 'style="text-decoration:line-through;color:var(--text-2)"' : t.status === 'partial' ? 'class="text-warning"' : ''}>${rupiah(t.total)}</b><span>${esc(ftime(t.createdAt))}</span></div></div>
    </div>`).join('')}</div>`).join('') : emptyState('Belum ada transaksi', 'Mulai berjualan dari menu Kasir', 'receipt');
  root.querySelector('#recent').addEventListener('click', (e) => { const r = e.target.closest('[data-id]'); if (r) showTransactionDetail(r.dataset.id); });

  const lows = products.filter((p) => isLow(p) || isOut(p)).sort((a, b) => a.stock - b.stock).slice(0, 7);
  root.querySelector('#lowList').innerHTML = lows.length ? lows.map((p) => `
    <div class="list-item">
      <img class="thumb" src="${p.image || ''}" alt="" loading="lazy">
      <div class="grow"><div class="bold">${esc(p.name)}</div><div class="small muted">${esc(catById[p.categoryId]?.name || '-')} · min ${stockLimit(p)}</div></div>
      <span class="badge ${isOut(p) ? 'red' : 'amber'}">${isOut(p) ? 'Habis' : `Sisa ${p.stock} ${esc(p.unit)}`}</span>
    </div>`).join('') : emptyState('Stok aman', 'Tidak ada produk dengan stok menipis', 'check-circle-2');

  bindSegmented(root, '[data-p]', (v) => {
    st.preset = v;
    const cr = root.querySelector('#customRange'); cr.classList.toggle('hidden', v !== 'custom');
    if (v !== 'custom') { const r = presetRange(v); st.from = r.from; st.to = r.to; }
    draw();
  }, 'data-p');
  bindSegmented(root, '[data-t]', (v) => { st.trendMode = v; drawTrend(); }, 'data-t');
  const onDate = () => {
    const f = root.querySelector('#dFrom').value, t = root.querySelector('#dTo').value;
    if (!f || !t || f > t) return;
    st.from = f; st.to = t; draw();
  };
  root.querySelector('#dFrom').onchange = onDate; root.querySelector('#dTo').onchange = onDate;

  if (st.preset !== 'custom') { const r = presetRange(st.preset); st.from = r.from; st.to = r.to; }
  draw(); drawTrend();
}
