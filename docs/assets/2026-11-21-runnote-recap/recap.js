const year = {
  title: '2025 年跑步回顾', range: '2025.01.01 – 2025.12.31', distance: '956.2',
  count: '132', days: '106', duration: '98:40', pace: '6′11″', chartTitle: '每月里程',
  peak: '10 月里程最高 · 118.4 km', bucket: '月份', ticks: [120, 90, 60, 30, 0],
  labels: Array.from({ length: 12 }, (_, index) => `${index + 1}月`),
  values: [56.2, 42.6, 68.1, 79.4, 61.6, 93.3, 88.1, 104.5, 91.6, 118.4, 84.7, 67.7],
};
const month = {
  title: '2025 年 10 月跑步回顾', range: '2025.10.01 – 2025.10.31', distance: '118.4',
  count: '15', days: '12', duration: '12:30', pace: '6′20″', chartTitle: '每周里程',
  peak: '10 月 13–19 日里程最高 · 32.6 km', bucket: '起止日期（10 月）', ticks: [40, 30, 20, 10, 0],
  labels: ['1–5日', '6–12日', '13–19日', '20–26日', '27–31日'], values: [16.4, 27.1, 32.6, 24.8, 17.5],
};

const params = new URLSearchParams(location.search);
const period = params.get('period') === 'month' ? 'month' : 'year';
const theme = document.documentElement.dataset.theme;
const data = period === 'month' ? month : year;
const max = Math.max(...data.values);

for (const node of document.querySelectorAll('[data-field]')) node.textContent = data[node.dataset.field];
for (const chart of document.querySelectorAll('.chart')) {
  const bars = chart.querySelector('.bars');
  bars.style.setProperty('--bucket-count', data.values.length);
  for (const [index, value] of data.values.entries()) {
    const item = document.createElement('li');
    const fill = document.createElement('span');
    fill.className = value === max ? 'bar peak' : 'bar';
    fill.style.setProperty('--bar-size', `${value / data.ticks[0] * 100}%`);
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = data.labels[index];
    item.append(fill, label);
    bars.append(item);
  }
  const ticks = chart.querySelector('.ticks');
  if (ticks) {
    for (const value of data.ticks) {
      const tick = document.createElement('li');
      tick.textContent = value === data.ticks[0] ? `${value} km` : value;
      ticks.append(tick);
    }
  }
}

const table = document.querySelector('tbody');
if (table) {
  for (const [index, value] of data.values.entries()) {
    const row = table.insertRow();
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = data.labels[index];
    row.append(label);
    row.insertCell().textContent = value.toFixed(1);
  }

  const url = (nextPeriod, nextTheme) => `?period=${nextPeriod}&theme=${nextTheme}`;
  const themeLink = document.querySelector('#theme-link');
  const themeLabel = theme === 'dark' ? '切换浅色外观' : '切换深色外观';
  themeLink.href = url(period, theme === 'dark' ? 'light' : 'dark');
  themeLink.setAttribute('aria-label', themeLabel);
  themeLink.title = themeLabel;
  for (const mode of ['month', 'year']) {
    const link = document.querySelector(`#${mode}-link`);
    link.href = url(mode, theme);
    if (mode === period) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const button = document.querySelector('#share-button');
  const dialog = document.querySelector('#share-dialog');
  const preview = document.querySelector('#poster-preview');
  const download = document.querySelector('#download');
  const asset = `poster-${period}-${theme}.png`;
  download.href = asset;
  download.download = asset;
  preview.alt = `${data.title}，${data.range}，总里程 ${data.distance} 公里，跑步 ${data.count} 次，${data.days} 个跑步日，总用时 ${data.duration.replace(':', ' 小时 ')} 分钟，平均配速每公里 ${data.pace}，${data.peak}`;
  button.addEventListener('click', () => {
    if (!preview.getAttribute('src')) preview.src = asset;
    dialog.showModal();
  });
  dialog.addEventListener('close', () => button.focus());
}
