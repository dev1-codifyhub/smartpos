// Sales & profit reports computed from real transaction records. Profit uses the cost snapshot saved in each sale item.
import { listTransactions } from '../database/transactions.db.js';
import { summarize, groupByDay, series, productPerformance, paymentBreakdown, valid } from '../services/analytics.js';
import { rupiah, num, pct, fdateKey, payLabel } from '../utils/format.js';
import { presetRange, icon, refreshIcons, dateKey } from '../utils/helpers.js';
import { segmented, bindSegmented, toast, emptyState } from '../ui/ui.js';
import { ChartSet, barConfig, lineAreaConfig, doughnutConfig } from '../ui/charts.js';
import { downloadCSV, exportPDF, printReport } from '../services/export.service.js';
import { state } from '../state.js';

let charts, all = [], rootEl = null;
const st = { preset: 'month', from: presetRange('month').from, to: presetRange('month').to, view: 'sales' };

export function destroy() { charts && charts.destroyAll(); charts = null; rootEl = null; }

const TITLES = { sales: 'Laporan Penjualan', products: 'Performa Produk', profit: 'Laporan Laba', payments: 'Rincian Metode Pembayaran' };

function buildModel(txns) {
  const s = summarize(txns);
  const dayRows = groupByDay(txns, st.from, st.to).filter((d) => d.count > 0 || false).map((d) => ({ ...d, label: fdateKey(d.key), avg: d.count ? d.net / d.count : 0, margin: d.net ? (d.profit / d.net) * 100 : 0 }));
  let columns, rows, footer;
  if (st.view === 'sales') {
    columns = [{ key: 'label', label: 'Tanggal' }, { key: 'count', label: 'Transaksi', align: 'num', fmt: num }, { key: 'gross', label: 'Penjualan Kotor', align: 'num', fmt: rupiah }, { key: 'discount', label: 'Diskon', align: 'num', fmt: rupiah }, { key: 'net', label: 'Penjualan Bersih', align: 'num', fmt: rupiah }, { key: 'avg', label: 'Rata-rata', align: 'num', fmt: rupiah }];
    rows = dayRows;
    footer = { label: 'TOTAL', count: num(s.count), gross: rupiah(s.gross), discount: rupiah(s.discount), net: rupiah(s.net), avg: rupiah(s.avg) };
  } else if (st.view === 'profit') {
    columns = [{ key: 'label', label: 'Tanggal' }, { key: 'net', label: 'Penjualan Bersih', align: 'num', fmt: rupiah }, { key: 'cogs', label: 'HPP', align: 'num', fmt: rupiah }, { key: 'profit', label: 'Laba Kotor', align: 'num', fmt: rupiah }, { key: 'margin', label: 'Margin', align: 'num', fmt: (v) => pct(v) }];
    rows = dayRows;
    footer = { label: 'TOTAL', net: rupiah(s.net), cogs: rupiah(s.cogs), profit: rupiah(s.profit), margin: pct(s.margin) };
  } else if (st.view === 'products') {
    columns = [{ key: 'name', label: 'Produk' }, { key: 'sku', label: 'SKU' }, { key: 'qty', label: 'Terjual', align: 'num', fmt: num }, { key: 'gross', label: 'Penjualan Kotor', align: 'num', fmt: rupiah }, { key: 'discount', label: 'Diskon', align: 'num', fmt: rupiah }, { key: 'net', label: 'Penjualan Bersih', align: 'num', fmt: rupiah }, { key: 'cogs', label: 'HPP', align: 'num', fmt: rupiah }, { key: 'profit', label: 'Laba Kotor', align: 'num', fmt: rupiah }, { key: 'margin', label: 'Margin', align: 'num', fmt: (v) => pct(v) }];
    rows = productPerformance(txns).sort((a, b) => b.net - a.net);
    footer = { name: 'TOTAL', qty: num(s.items), gross: rupiah(s.gross), discount: rupiah(s.discount), net: rupiah(s.net), cogs: rupiah(s.cogs), profit: rupiah(s.profit), margin: pct(s.margin) };
  } else {
    columns = [{ key: 'label', label: 'Metode Pembayaran' }, { key: 'count', label: 'Jumlah Pembayaran', align: 'num', fmt: num }, { key: 'amount', label: 'Nominal Diterima', align: 'num', fmt: rupiah }, { key: 'share', label: 'Porsi', align: 'num', fmt: (v) => pct(v) }];
    rows = paymentBreakdown(txns).map((r) => ({ ...r, label: payLabel(r.method) }));
    footer = { label: 'TOTAL', count: num(rows.reduce((a, r) => a + r.count, 0)), amount: rupiah(rows.reduce((a, r) => a + r.amount, 0)), share: '100%' };
  }
  const summary = [['Penjualan Kotor', rupiah(s.gross)], ['Diskon', rupiah(s.discount)], ['Penjualan Bersih', rupiah(s.net)], ['HPP', rupiah(s.cogs)], ['Laba Kotor', rupiah(s.profit)], ['Jumlah Transaksi', num(s.count)], ['Rata-rata Transaksi', rupiah(s.avg)], ['Margin Laba', pct(s.margin)], ['Pajak Terkumpul', rupiah(s.tax)]];
  const subtitle = `${TITLES[st.view]} · ${st.from === st.to ? fdateKey(st.from) : fdateKey(st.from) + ' – ' + fdateKey(st.to)}`;
  return { s, columns, rows, footer, summary, subtitle, title: TITLES[st.view] };
}

function draw() {
  if (!rootEl) return;
  const txns = all.filter((t) => t.dateKey >= st.from && t.dateKey <= st.to);
  const m = buildModel(txns);
  const card = (l, v, c = '') => `<div class="card stat"><div class="label">${l}</div><div class="value ${c}">${v}</div></div>`;
  rootEl.querySelector('#metrics').innerHTML = card('Penjualan Kotor', rupiah(m.s.gross)) + card('Diskon', rupiah(m.s.discount), 'text-warning') + card('Penjualan Bersih', rupiah(m.s.net)) + card('HPP (Harga Pokok)', rupiah(m.s.cogs)) + card('Laba Kotor', rupiah(m.s.profit), 'text-success') + card('Jumlah Transaksi', num(m.s.count)) + card('Rata-rata Transaksi', rupiah(m.s.avg));
  rootEl.querySelector('#rTitle').textContent = m.subtitle;

  // chart
  const cb = rootEl.querySelector('#chartBox');
  charts.destroy('main');
  if (!txns.filter((t) => t.status !== 'void').length) { cb.innerHTML = emptyState('Tidak ada data pada periode ini', 'Ubah rentang tanggal laporan', 'bar-chart-3'); }
  else {
    cb.innerHTML = '<div class="chart-box"><canvas></canvas></div>';
    const cv = cb.querySelector('canvas');
    if (st.view === 'sales') { const sr = series(txns, st.from, st.to); charts.make('main', cv, barConfig(sr.map((b) => b.label), [{ label: 'Penjualan Bersih', data: sr.map((b) => b.net) }])); }
    else if (st.view === 'profit') { const sr = series(txns, st.from, st.to); charts.make('main', cv, lineAreaConfig(sr.map((b) => b.label), [{ label: 'Penjualan Bersih', data: sr.map((b) => b.net), color: '#DC2626' }, { label: 'Laba Kotor', data: sr.map((b) => b.profit), color: '#16A36A' }])); }
    else if (st.view === 'products') { const top = m.rows.slice(0, 10); charts.make('main', cv, barConfig(top.map((r) => (r.name.length > 22 ? r.name.slice(0, 21) + '…' : r.name)), [{ label: 'Penjualan Bersih', data: top.map((r) => r.net) }, { label: 'Laba Kotor', data: top.map((r) => r.profit), color: '#16A36A' }], { horizontal: true })); cb.firstChild.style.height = Math.max(280, top.length * 44 + 60) + 'px'; }
    else { charts.make('main', cv, doughnutConfig(m.rows.map((r) => r.label), m.rows.map((r) => r.amount))); }
  }

  // table
  const tb = rootEl.querySelector('#rTable');
  if (!m.rows.length) tb.innerHTML = `<tbody><tr><td>${emptyState('Belum ada data', '', 'file-x')}</td></tr></tbody>`;
  else tb.innerHTML = `<thead><tr>${m.columns.map((c) => `<th class="${c.align || ''}">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${m.rows.map((r) => `<tr>${m.columns.map((c, i) => `<td class="${c.align || ''} ${i === 0 ? 'first' : ''}" data-label="${c.label}">${esc2(c.fmt ? c.fmt(r[c.key], r) : r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr>${m.columns.map((c, i) => `<td class="${c.align || ''} ${i === 0 ? 'first' : ''}" data-label="${i === 0 ? '' : c.label}">${esc2(m.footer[c.key] ?? '')}</td>`).join('')}</tr></tfoot>`;
  rootEl._model = m;
  refreshIcons();
}
const esc2 = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function render(root) {
  rootEl = root; charts = new ChartSet();
  all = await listTransactions();
  root.innerHTML = `
    <div class="page-head">
      <div class="flex" style="flex-wrap:wrap">
        ${segmented([['today', 'Harian'], ['week', 'Mingguan'], ['month', 'Bulanan'], ['custom', 'Kustom']], st.preset, 'data-p')}
        <div class="flex ${st.preset === 'custom' ? '' : 'hidden'}" id="customRange"><input type="date" class="input" id="dFrom" value="${st.from}" style="width:150px" aria-label="Dari"><span class="muted">—</span><input type="date" class="input" id="dTo" value="${st.to}" style="width:150px" aria-label="Sampai"></div>
      </div>
      <div class="flex" style="flex-wrap:wrap"><button class="btn" id="eCsv">${icon('file-spreadsheet')} CSV</button><button class="btn" id="ePdf">${icon('file-text')} PDF</button><button class="btn" id="ePrint">${icon('printer')} Cetak</button></div>
    </div>
    <div class="grid grid-metrics" id="metrics"></div>
    <div class="card mt">
      <div class="card-head"><div><h3 id="rTitle"></h3></div>${segmented([['sales', 'Penjualan'], ['products', 'Produk'], ['profit', 'Laba'], ['payments', 'Pembayaran']], st.view, 'data-v')}</div>
      <div id="chartBox"></div>
    </div>
    <div class="card mt"><div class="table-wrap"><table class="table responsive" id="rTable"></table></div></div>`;
  if (st.preset !== 'custom') { const r = presetRange(st.preset); st.from = r.from; st.to = r.to; }
  draw();
  bindSegmented(root, '[data-p]', (v) => {
    st.preset = v; root.querySelector('#customRange').classList.toggle('hidden', v !== 'custom');
    if (v !== 'custom') { const r = presetRange(v); st.from = r.from; st.to = r.to; }
    draw();
  }, 'data-p');
  bindSegmented(root, '[data-v]', (v) => { st.view = v; draw(); }, 'data-v');
  const onDate = () => { const f = root.querySelector('#dFrom').value, t = root.querySelector('#dTo').value; if (!f || !t) return; if (f > t) return toast('Tanggal awal tidak boleh melebihi tanggal akhir', 'warning'); st.from = f; st.to = t; draw(); };
  root.querySelector('#dFrom').onchange = onDate; root.querySelector('#dTo').onchange = onDate;
  const need = () => { const m = root._model; if (!m || !m.rows.length) { toast('Tidak ada data untuk diekspor', 'warning'); return null; } return m; };
  root.querySelector('#eCsv').onclick = () => { const m = need(); if (!m) return; downloadCSV(`laporan-${st.view}-${st.from}_${st.to}.csv`, m.columns, m.rows); toast('CSV diunduh', 'success'); };
  root.querySelector('#ePdf').onclick = () => { const m = need(); if (!m) return; try { exportPDF({ title: m.title, subtitle: m.subtitle, summary: m.summary, columns: m.columns, rows: m.rows, footer: m.footer, filename: `laporan-${st.view}-${st.from}_${st.to}.pdf` }); toast('PDF diunduh', 'success'); } catch (e) { toast(e.message, 'error'); } };
  root.querySelector('#ePrint').onclick = () => { const m = need(); if (!m) return; printReport({ title: m.title, subtitle: m.subtitle, summary: m.summary, columns: m.columns, rows: m.rows, footer: m.footer }); };
}
