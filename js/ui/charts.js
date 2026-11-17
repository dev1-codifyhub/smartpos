// Chart.js helpers: theme-aware defaults and instance management.
import { rupiah, rupiahShort } from '../utils/format.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const palette = () => ({ primary: css('--primary'), success: css('--success'), warning: css('--warning'), danger: css('--danger'), text2: css('--text-2'), grid: css('--border'), surface: css('--surface') });
export const SERIES = ['#DC2626', '#4ADE80', '#FBBF24', '#A78BFA', '#38BDF8', '#F472B6', '#2DD4BF', '#FB923C'];

export class ChartSet {
  constructor() { this.charts = new Map(); this.onTheme = () => this.rethemeAll(); document.addEventListener('themechange', this.onTheme); }
  make(id, canvas, config) {
    if (!window.Chart) { canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Grafik belum tersedia (library belum termuat).' })); return null; }
    this.destroy(id);
    const p = palette();
    window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    window.Chart.defaults.color = p.text2;
    config.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 600 } }, config.options || {});
    const ch = new window.Chart(canvas, config);
    this.charts.set(id, ch);
    return ch;
  }
  destroy(id) { const c = this.charts.get(id); if (c) { c.destroy(); this.charts.delete(id); } }
  destroyAll() { this.charts.forEach((c) => c.destroy()); this.charts.clear(); document.removeEventListener('themechange', this.onTheme); }
  rethemeAll() {
    const p = palette();
    this.charts.forEach((c) => {
      window.Chart.defaults.color = p.text2;
      const o = c.options;
      if (o.scales) Object.values(o.scales).forEach((s) => { s.ticks = Object.assign(s.ticks || {}, { color: p.text2 }); if (s.grid) s.grid.color = p.grid; });
      if (o.plugins?.legend?.labels) o.plugins.legend.labels.color = p.text2;
      c.update('none');
    });
  }
}

export function lineAreaConfig(labels, datasets, { money = true } = {}) {
  const p = palette();
  return {
    type: 'line',
    data: { labels, datasets: datasets.map((d, i) => ({ tension: 0.38, fill: true, pointRadius: 2.5, pointHoverRadius: 5, borderWidth: 2.5, borderColor: d.color || SERIES[i], backgroundColor: ((ctx) => { const { chart } = ctx; const { ctx: c, chartArea } = chart; if (!chartArea) return 'transparent'; const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0, (d.color || SERIES[i]) + '40'); g.addColorStop(1, (d.color || SERIES[i]) + '00'); return g; }), ...d })) },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { usePointStyle: true, boxWidth: 8, color: p.text2 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money ? rupiah(c.parsed.y) : c.parsed.y}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: p.text2, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, grid: { color: p.grid }, border: { display: false }, ticks: { color: p.text2, callback: (v) => (money ? rupiahShort(v) : v) } } },
    },
  };
}

export function barConfig(labels, datasets, { money = true, horizontal = false } = {}) {
  const p = palette();
  return {
    type: 'bar',
    data: { labels, datasets: datasets.map((d, i) => ({ borderRadius: 8, borderSkipped: false, backgroundColor: d.color || SERIES[i], maxBarThickness: 36, ...d })) },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { display: datasets.length > 1, labels: { usePointStyle: true, boxWidth: 8, color: p.text2 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money ? rupiah(c.parsed[horizontal ? 'x' : 'y']) : c.parsed[horizontal ? 'x' : 'y']}` } } },
      scales: {
        x: { grid: { display: horizontal, color: p.grid }, border: { display: false }, beginAtZero: true, ticks: { color: p.text2, maxRotation: 0, autoSkip: true, callback: horizontal ? (v) => (money ? rupiahShort(v) : v) : undefined } },
        y: { grid: { display: !horizontal, color: p.grid }, border: { display: false }, beginAtZero: true, ticks: { color: p.text2, callback: horizontal ? undefined : (v) => (money ? rupiahShort(v) : v) } },
      },
    },
  };
}

export function doughnutConfig(labels, data) {
  const p = palette();
  return { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: SERIES, borderColor: p.surface, borderWidth: 3, hoverOffset: 6 }] }, options: { cutout: '68%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: p.text2 } }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${rupiah(c.parsed)}` } } } } };
}
