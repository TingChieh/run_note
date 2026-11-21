const params = new URLSearchParams(location.search);
const view = params.get('view') === 'detail' ? 'detail' : 'catalog';
const cities = {
  bay: { name: '青岬市', region: '岚海州', distance: '182.4', first: '2024-05-12', baseline: 287, scale: 1 },
  river: { name: '云津市', region: '岚海州', distance: '104.2', first: '2025-03-09', baseline: 0, scale: 0.63 },
  hill: { name: '松屿市', region: '林渡州', distance: '42.0', first: '2026-06-14', baseline: 0, scale: 0.35 },
};
const cityKey = Object.hasOwn(cities, params.get('city')) ? params.get('city') : 'bay';
const city = cities[cityKey];
const get = (id) => document.getElementById(id);
const root = document.documentElement;
root.dataset.theme = params.get('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
get(view).hidden = false;
get(view + 'Link').setAttribute('aria-current', 'page');
get('cityName').textContent = city.name;
get('regionName').textContent = city.region;
get('distance').firstChild.textContent = city.distance + ' ';
get('first').textContent = city.first;
get('year').value = params.get('year') === '2025' ? '2025' : '2026';
let layer = 'all';

function setLinks() {
  document.querySelectorAll('a[href^="?"]').forEach((link) => {
    const target = new URLSearchParams(link.getAttribute('href').slice(1));
    target.set('theme', root.dataset.theme);
    if (link.id === 'detailLink') target.set('city', cityKey);
    link.setAttribute('href', '?' + target);
  });
}

const templateMonths = {
  2025: [5, 2, 4, 8, 3, 12, 16, 6, 4, 3, 6, 2],
  2026: [4, 8, 13, 10, 17, 5, 30, 14, 6, 14, 7, null],
};

function monthsFor(year) {
  return templateMonths[year].map((value, index) => {
    if (value === null) return null;
    const month = year + '-' + String(index + 1).padStart(2, '0');
    return month < city.first.slice(0, 7) ? 0 : Math.round(value * city.scale);
  });
}

function renderTrend() {
  const year = get('year').value;
  const months = monthsFor(year);
  let cumulative = city.baseline + (year === '2026' ? monthsFor('2025').reduce((sum, item) => sum + item, 0) : 0);
  const peak = Math.max(...months, 1);
  get('chartCaption').textContent = year + ' 年每月新增格网';
  get('chart').setAttribute('aria-label', year + ' 年每月新增格网，完整数字见逐月数据表');
  get('chart').replaceChildren();
  get('series').replaceChildren();
  months.forEach((value, index) => {
    const bar = document.createElement('div');
    bar.className = value === null ? 'future' : value === peak ? 'peak' : '';
    const stripe = document.createElement('i');
    stripe.style.height = value === null ? '0' : (value / peak) * 100 + '%';
    const label = document.createElement('span');
    label.textContent = index + 1;
    bar.append(stripe, label);
    get('chart').append(bar);
    cumulative += value ?? 0;
    const row = get('series').insertRow();
    [index + 1 + ' 月', value ?? '—', value === null ? '—' : cumulative].forEach((part) => {
      row.insertCell().textContent = part;
    });
  });
  get('ever').textContent = cumulative;
  get('ever').parentElement.querySelector('span').textContent = year === '2026' ? '截至当前累计' : '截至所选年末累计';
  get('newCells').firstChild.textContent = months.reduce((sum, item) => sum + (item ?? 0), 0) + ' ';
}

// The plan is drawn in local illustration units and contains no geographic coordinates.
function drawMap() {
  const canvas = get('map');
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = devicePixelRatio;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  const dark = root.dataset.theme === 'dark';
  const narrow = width < 440;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = dark ? '#383735' : '#e9eee4';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width * 0.52, height * 0.52);
  const scale = Math.max(width / 725, height / 340) * (narrow ? 0.92 : 1);
  ctx.scale(scale, scale);
  const path = (points, color, width, close = false) => {
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  };
  const palette = dark
    ? { water: '#34494d', park: '#36443a', road: '#50504b', major: '#62605a', text: '#d0d8ce' }
    : { water: '#c4dde3', park: '#d0dfc7', road: '#fbfcf8', major: '#fffdf5', text: '#55665a' };
  const shoreline = [[-460, 133], [-320, 118], [-235, 102], [-171, 63], [-110, 66], [-47, 116], [27, 132], [96, 111], [161, 64], [245, 43], [460, 73]];
  const water = [...shoreline, [460, 250], [-460, 250]];
  path([[-460, -240], [-172, -240], [-186, -116], [-253, -45], [-460, -5]], palette.park, 0, true);
  path([[84, -185], [156, -211], [249, -181], [229, -102], [169, -95], [113, -131]], palette.park, 0, true);
  path([[20, 62], [67, 32], [118, 45], [111, 78], [66, 99], [29, 89]], palette.park, 0, true);
  for (let y = -240; y < 185; y += 22) {
    path([[-450, y - 41], [-225, y - 25], [-58, y], [98, y - 15], [230, y - 44], [450, y - 25]], palette.road, 1.6);
  }
  for (let x = -462; x < 476; x += 23) {
    path([[x - 55, -240], [x - 27, -111], [x, 4], [x + 13, 120], [x + 24, 226]], palette.road, 1.6);
  }
  path([[-450, -50], [-247, -55], [-126, -24], [0, -23], [115, -43], [252, -70], [450, -55]], palette.major, 5);
  path([[-56, -240], [-44, -121], [-17, 15], [-1, 125]], palette.major, 5);
  path(water, palette.water, 0, true);
  path(shoreline, dark ? '#5b7979' : '#a6c5c9', 1.5);

  const currentYear = get('year').value === '2026';
  const visited = new Map();
  const walks = [
    [[-15,-2],[-12,-2],[-11,-4],[-7,-4],[-4,-3],[1,-3],[4,-4],[8,-4],[10,-5],[15,-5]],
    [[-9,-9],[-8,-6],[-7,-3],[-7,2],[-5,3],[-2,4],[1,5],[4,4],[7,3],[9,1],[13,0]],
    [[-1,-8],[0,-5],[0,-1],[1,2],[1,5],[0,7],[-3,9],[-4,12]],
    [[-11,3],[-9,1],[-6,0],[-4,1],[-2,1],[-1,0],[3,0],[5,-2],[7,-4],[8,-7],[7,-10]],
    [[4,4],[5,7],[5,9],[8,10],[9,12],[11,13]],
  ];
  walks.forEach((walk, route) => {
    if (!currentYear && route > 2) return;
    walk.slice(1).forEach(([ex, ey], index) => {
      const [sx, sy] = walk[index];
      const steps = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
      for (let step = 0; step <= steps; step++) {
        const x = Math.round(sx + ((ex - sx) * step) / steps);
        const y = Math.round(sy + ((ey - sy) * step) / steps);
        const key = x + ',' + y;
        const previous = visited.get(key);
        const fresh = currentYear ? route === 4 || (route === 3 && y < -4) : route === 2;
        const total = (previous?.total ?? 0) + (route < 2 ? 2 : 1);
        visited.set(key, { x, y, total, fresh: (previous?.fresh ?? true) && fresh });
      }
    });
  });
  const styles = getComputedStyle(root);
  const heat = ['--heat-low', '--heat-mid', '--heat-high'].map((name) => styles.getPropertyValue(name));
  ctx.save();
  ctx.beginPath();
  ctx.rect(-width / scale, -height / scale, 2 * width / scale, 2 * height / scale);
  ctx.clip();
  for (const { x, y, total, fresh } of visited.values()) {
    if (layer === 'new' && !fresh) continue;
    if (x * 13 > 110 && cityKey === 'hill') continue;
    ctx.fillStyle = heat[Math.min(2, Math.floor(total / 2))];
    ctx.globalAlpha = 0.87;
    ctx.fillRect(x * 13, y * 13, 12, 12);
    if (fresh) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = styles.getPropertyValue('--new-edge');
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x * 13 + 0.8, y * 13 + 0.8, 10.4, 10.4);
    }
  }
  ctx.restore();
  ctx.fillStyle = palette.text;
  ctx.font = '13px system-ui';
  ctx.fillText('桐径公园', -168, -98);
  ctx.fillText('西桥', -85, 48);
  ctx.fillText('岚水', 31, 144);
  if (!narrow) ctx.fillText('东埠', 235, -84);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.font = '12px system-ui';
  ctx.fillText('合成地图', 12, height - 11);
  ctx.fillText('北 ↑', width - 35, 20);
  canvas.setAttribute('aria-label', city.name + '合成地图，' + (layer === 'new' ? '显示所选年新增格网' : '显示所选年活动经过的格网，带轮廓的格网在所选年首次跑过'));
}

get('theme').addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  setLinks();
  drawMap();
});
get('year').addEventListener('change', () => {
  renderTrend();
  drawMap();
});
get('layers').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  layer = button.dataset.layer;
  for (const item of get('layers').querySelectorAll('button')) {
    item.setAttribute('aria-pressed', String(item === button));
  }
  get('intensity').hidden = layer === 'new';
  drawMap();
});
setLinks();
if (view === 'detail') {
  renderTrend();
  new ResizeObserver(drawMap).observe(get('map'));
}
