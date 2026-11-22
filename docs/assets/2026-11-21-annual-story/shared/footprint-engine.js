/**
 * Shared HiDPI Canvas 2D Annual Footprint & Route Stage Engine
 *
 * Supports:
 * - mode: 'annual'   -> Chronological full-year trajectory unfolding (0..1 progress) with city beacons & milestone sparks
 * - mode: 'single'   -> Zoomed spotlight on a specific beat track (first / longest / best) with progressive draw
 * - mode: 'cities'   -> Multi-city topology & new-city pulse rings with interactive selected city highlight
 * - mode: 'frequent' -> Memory-layering translucent stack of N repeated runs on the most frequent route
 * - Automatic graceful fallback for trackless years (365-day orbital/calendar rhythm pulse animation)
 * - Strictly offline, zero external tiles, respects prefers-reduced-motion.
 */

(function (global) {
  'use strict';

  function getPalette(variant) {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (variant === 'cinema') {
      return dark
        ? {
            bgTop: '#191817',
            bgBottom: '#252321',
            grid: 'rgba(255,255,255,0.045)',
            contour: 'rgba(119,212,172,0.08)',
            coast: 'rgba(119,212,172,0.16)',
            river: 'rgba(75,182,223,0.14)',
            routeDim: 'rgba(119,212,172,0.28)',
            routeBright: '#77d4ac',
            routeHead: '#f5d36c',
            gold: '#f5d36c',
            coral: '#f06373',
            blue: '#4bb6df',
            ink: '#f2f0ee',
            muted: '#a9b6ae',
            pillBg: 'rgba(25,24,23,0.82)',
            pillBorder: 'rgba(255,255,255,0.14)',
          }
        : {
            bgTop: '#124e3d',
            bgBottom: '#0b3529',
            grid: 'rgba(255,255,255,0.06)',
            contour: 'rgba(245,197,25,0.10)',
            coast: 'rgba(183,215,203,0.22)',
            river: 'rgba(75,182,223,0.20)',
            routeDim: 'rgba(156,228,195,0.34)',
            routeBright: '#9ce4c3',
            routeHead: '#f5c519',
            gold: '#f5c519',
            coral: '#ff8a96',
            blue: '#7cc7f2',
            ink: '#f6f7f4',
            muted: '#b7d7cb',
            pillBg: 'rgba(11,53,41,0.86)',
            pillBorder: 'rgba(255,255,255,0.18)',
          };
    }

    if (variant === 'almanac') {
      return dark
        ? {
            bgTop: '#2b2926',
            bgBottom: '#23211f',
            grid: 'rgba(242,240,238,0.055)',
            contour: 'rgba(177,172,166,0.11)',
            coast: 'rgba(119,212,172,0.20)',
            river: 'rgba(75,182,223,0.18)',
            routeDim: 'rgba(119,212,172,0.30)',
            routeBright: '#77d4ac',
            routeHead: '#f5d36c',
            gold: '#f5d36c',
            coral: '#ff9aa8',
            blue: '#7cc7f2',
            ink: '#f2f0ee',
            muted: '#b1aca6',
            pillBg: 'rgba(41,39,37,0.88)',
            pillBorder: 'rgba(255,255,255,0.14)',
          }
        : {
            bgTop: '#fcfcf7',
            bgBottom: '#f2f4ec',
            grid: 'rgba(32,45,35,0.065)',
            contour: 'rgba(23,116,92,0.10)',
            coast: 'rgba(23,116,92,0.20)',
            river: 'rgba(75,182,223,0.24)',
            routeDim: 'rgba(23,116,92,0.24)',
            routeBright: '#17745c',
            routeHead: '#d99b00',
            gold: '#d49a00',
            coral: '#d9485b',
            blue: '#228bb5',
            ink: '#202d23',
            muted: '#5c695e',
            pillBg: 'rgba(255,255,255,0.92)',
            pillBorder: 'rgba(32,45,35,0.12)',
          };
    }

    // Default: 'chronicle' (Editorial Memoir Stage)
    return dark
      ? {
          bgTop: '#262422',
          bgBottom: '#1e1d1b',
          grid: 'rgba(255,255,255,0.04)',
          contour: 'rgba(119,212,172,0.08)',
          coast: 'rgba(119,212,172,0.18)',
          river: 'rgba(75,182,223,0.15)',
          routeDim: 'rgba(119,212,172,0.28)',
          routeBright: '#77d4ac',
          routeHead: '#f5d36c',
          gold: '#f5d36c',
          coral: '#f06373',
          blue: '#4bb6df',
          ink: '#f2f0ee',
          muted: '#b1aca6',
          pillBg: 'rgba(38,36,34,0.88)',
          pillBorder: 'rgba(255,255,255,0.12)',
        }
      : {
          bgTop: '#f3f6ef',
          bgBottom: '#e9efe4',
          grid: 'rgba(23,116,92,0.055)',
          contour: 'rgba(23,116,92,0.09)',
          coast: 'rgba(23,116,92,0.20)',
          river: 'rgba(75,182,223,0.22)',
          routeDim: 'rgba(23,116,92,0.25)',
          routeBright: '#17745c',
          routeHead: '#c68a00',
          gold: '#c68a00',
          coral: '#d9485b',
          blue: '#2689b2',
          ink: '#202d23',
          muted: '#5c695e',
          pillBg: 'rgba(255,255,255,0.92)',
          pillBorder: 'rgba(23,116,92,0.14)',
        };
  }

  function computeBounds(pointLists) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pts of pointLists) {
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX)) return { minX: 0.1, maxX: 0.9, minY: 0.1, maxY: 0.9 };
    const padX = Math.max(0.03, (maxX - minX) * 0.18);
    const padY = Math.max(0.03, (maxY - minY) * 0.18);
    return {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY,
    };
  }

  function createProjector(w, h, bounds, padding = 36) {
    const innerW = Math.max(40, w - padding * 2);
    const innerH = Math.max(40, h - padding * 2);
    const spanX = Math.max(0.01, bounds.maxX - bounds.minX);
    const spanY = Math.max(0.01, bounds.maxY - bounds.minY);
    const scale = Math.min(innerW / spanX, innerH / spanY);
    const offsetX = padding + (innerW - spanX * scale) / 2;
    const offsetY = padding + (innerH - spanY * scale) / 2;
    return ([x, y]) => [offsetX + (x - bounds.minX) * scale, offsetY + (y - bounds.minY) * scale];
  }

  function strokePolyline(ctx, pts, proj, fraction = 1) {
    if (!pts || pts.length < 2 || fraction <= 0) return null;
    const maxSeg = (pts.length - 1) * Math.min(1, fraction);
    const fullCount = Math.floor(maxSeg);
    const rem = maxSeg - fullCount;

    ctx.beginPath();
    const p0 = proj(pts[0]);
    ctx.moveTo(p0[0], p0[1]);
    let last = p0;
    for (let i = 1; i <= fullCount && i < pts.length; i++) {
      const p = proj(pts[i]);
      ctx.lineTo(p[0], p[1]);
      last = p;
    }
    if (rem > 0 && fullCount + 1 < pts.length) {
      const a = proj(pts[fullCount]);
      const b = proj(pts[fullCount + 1]);
      last = [a[0] + (b[0] - a[0]) * rem, a[1] + (b[1] - a[1]) * rem];
      ctx.lineTo(last[0], last[1]);
    }
    ctx.stroke();
    return last;
  }

  function drawBackdrop(ctx, w, h, p, variant, showTopo, proj) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, p.bgTop);
    grad.addColorStop(1, p.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle cartographic grid
    const step = variant === 'almanac' ? 28 : 40;
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < w; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = step; y < h; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();

    if (!showTopo || !proj) return;
    const topo = global.STORY_DATA.SYNTHETIC_TOPO;

    // Topographic contour rings
    ctx.save();
    ctx.strokeStyle = p.contour;
    ctx.lineWidth = 1.25;
    for (const ring of topo.contours) {
      strokePolyline(ctx, ring, proj, 1);
    }

    // Synthetic river
    ctx.strokeStyle = p.river;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    strokePolyline(ctx, topo.river, proj, 1);

    // Synthetic coastline
    ctx.strokeStyle = p.coast;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    strokePolyline(ctx, topo.coastline, proj, 1);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBadge(ctx, x, y, text, p, accentColor) {
    ctx.save();
    ctx.font = `600 11px ${getComputedStyle(document.documentElement).getPropertyValue('--font-body') || 'sans-serif'}`;
    const tw = ctx.measureText(text).width;
    const bw = tw + 16;
    const bh = 22;
    const bx = Math.max(10, Math.min(ctx.canvas.clientWidth - bw - 10, x - bw / 2));
    const by = Math.max(10, y - bh - 10);

    ctx.fillStyle = p.pillBg;
    ctx.strokeStyle = accentColor || p.pillBorder;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 11);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = p.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  function drawCalendarFallback(ctx, w, h, scenario, progress, p) {
    const cx = w / 2;
    const cy = h / 2 + 6;
    const r = Math.min(w, h) * 0.31;

    ctx.save();
    // Outer 12-month ring
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const months = scenario.monthlySummary;
    const maxKm = Math.max(1, ...months.map((m) => m.km));
    const activeMonthLimit = progress * 12;

    months.forEach((m, idx) => {
      const angle = -Math.PI / 2 + (idx / 12) * Math.PI * 2;
      const reached = idx < activeMonthLimit;
      const frac = Math.max(0, Math.min(1, activeMonthLimit - idx));
      const barLen = (m.km / maxKm) * (r * 0.42) * frac;

      const x1 = cx + Math.cos(angle) * (r - 6);
      const y1 = cy + Math.sin(angle) * (r - 6);
      const x2 = cx + Math.cos(angle) * (r + barLen + 6);
      const y2 = cy + Math.sin(angle) * (r + barLen + 6);

      ctx.strokeStyle = reached && m.km > 0 ? p.routeBright : p.contour;
      ctx.lineWidth = m.km > 0 ? 7 : 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Month label
      const lx = cx + Math.cos(angle) * (r - 24);
      const ly = cy + Math.sin(angle) * (r - 24);
      ctx.fillStyle = reached ? p.ink : p.muted;
      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${m.month}月`, lx, ly);
    });

    // Center readout
    const shownRuns = Math.round(scenario.summary.activityCount * progress);
    const shownKm = (scenario.summary.totalDistanceM / 1000) * progress;
    ctx.fillStyle = p.ink;
    ctx.font = '700 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${shownKm.toFixed(1)} km`, cx, cy - 8);
    ctx.fillStyle = p.muted;
    ctx.font = '500 12px sans-serif';
    ctx.fillText(`室内节律回放 · ${shownRuns}/${scenario.summary.activityCount} 次`, cx, cy + 18);
    ctx.restore();
  }

  class FootprintStage {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.variant = options.variant || 'chronicle';
      this.scenario = options.scenario;
      this.mode = options.mode || 'annual';
      this.focusKey = options.focusKey || null; // 'first' | 'longest' | 'best' | cityCode
      this.selectedCityCode = options.selectedCityCode || null;
      this.progress = options.initialProgress !== undefined ? options.initialProgress : 1;
      this.playing = false;
      this.speed = 1;
      this.rafId = 0;
      this.lastTick = 0;
      this.onFrame = options.onFrame || null;

      this._resizeObserver = null;
      if (typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(() => this.render());
        this._resizeObserver.observe(canvas);
      }
      this.render();
    }

    setScenario(scenario) {
      this.scenario = scenario;
      this.render();
    }

    setMode(mode, extra = {}) {
      this.mode = mode;
      if ('focusKey' in extra) this.focusKey = extra.focusKey;
      if ('selectedCityCode' in extra) this.selectedCityCode = extra.selectedCityCode;
      if ('progress' in extra) this.progress = extra.progress;
      this.render();
    }

    setProgress(value) {
      this.progress = Math.max(0, Math.min(1, value));
      this.render();
      if (this.onFrame) this.onFrame(this.getSnapshot());
    }

    setSpeed(speed) {
      this.speed = speed;
    }

    play() {
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        this.playing = false;
        this.setProgress(1);
        return;
      }
      if (this.progress >= 0.999) this.progress = 0;
      this.playing = true;
      this.lastTick = performance.now();
      const loop = (now) => {
        if (!this.playing) return;
        const dt = Math.min(0.08, (now - this.lastTick) / 1000);
        this.lastTick = now;
        const durationSec = 10 / this.speed;
        this.progress = Math.min(1, this.progress + dt / durationSec);
        this.render();
        if (this.onFrame) this.onFrame(this.getSnapshot());
        if (this.progress >= 1) {
          this.playing = false;
          if (this.onFrame) this.onFrame(this.getSnapshot());
          return;
        }
        this.rafId = requestAnimationFrame(loop);
      };
      cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(loop);
    }

    pause() {
      this.playing = false;
      cancelAnimationFrame(this.rafId);
      if (this.onFrame) this.onFrame(this.getSnapshot());
    }

    toggle() {
      if (this.playing) this.pause();
      else this.play();
    }

    getSnapshot() {
      const tracks = this.scenario ? this.scenario.tracks : [];
      const total = tracks.length;
      if (!total) {
        return { progress: this.progress, playing: this.playing, index: 0, total: 0, run: null, citiesLit: 0 };
      }
      const exactIdx = Math.min(total - 1, Math.floor(this.progress * total));
      const run = tracks[exactIdx];
      const lit = new Set();
      for (let i = 0; i <= exactIdx; i++) {
        if (tracks[i].cityCode) lit.add(tracks[i].cityCode);
      }
      return {
        progress: this.progress,
        playing: this.playing,
        index: exactIdx + 1,
        total,
        run,
        citiesLit: lit.size,
      };
    }

    render() {
      const canvas = this.canvas;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(240, Math.round(rect.width || canvas.clientWidth || 640));
      const h = Math.max(200, Math.round(rect.height || canvas.clientHeight || 400));
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      const ctx = this.ctx;
      ctx.save();
      ctx.scale(dpr, dpr);

      const p = getPalette(this.variant);
      const scenario = this.scenario;

      if (!scenario || !scenario.hasTracks) {
        drawBackdrop(ctx, w, h, p, this.variant, false, null);
        if (scenario) drawCalendarFallback(ctx, w, h, scenario, this.progress, p);
        ctx.restore();
        return;
      }

      if (this.mode === 'single') {
        this._renderSingle(ctx, w, h, p, scenario);
      } else if (this.mode === 'cities') {
        this._renderCities(ctx, w, h, p, scenario);
      } else if (this.mode === 'frequent') {
        this._renderFrequent(ctx, w, h, p, scenario);
      } else {
        this._renderAnnual(ctx, w, h, p, scenario);
      }

      ctx.restore();
    }

    _renderAnnual(ctx, w, h, p, scenario) {
      const worldBounds = { minX: 0.06, maxX: 0.94, minY: 0.08, maxY: 0.88 };
      const proj = createProjector(w, h, worldBounds, 26);
      drawBackdrop(ctx, w, h, p, this.variant, true, proj);

      const tracks = scenario.tracks;
      const total = tracks.length;
      const cursor = this.progress * total;
      const fullIdx = Math.floor(cursor);
      const partial = cursor - fullIdx;

      const citiesLit = new Set();
      let prevHub = null;

      // First pass: travel arcs between cities as they appear chronologically
      ctx.save();
      ctx.strokeStyle = p.gold;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 5]);
      const seenEdges = new Set();
      const cityMap = Object.fromEntries(scenario.exploredCities.items.map((c) => [c.code, c]));

      for (let i = 0; i <= Math.min(fullIdx, total - 1); i++) {
        const c = cityMap[tracks[i].cityCode];
        if (!c) continue;
        citiesLit.add(c.code);
        if (prevHub && prevHub.code !== c.code) {
          const edgeKey = `${prevHub.code}->${c.code}`;
          if (!seenEdges.has(edgeKey)) {
            seenEdges.add(edgeKey);
            const a = proj(prevHub.hub);
            const b = proj(c.hub);
            const mx = (a[0] + b[0]) / 2;
            const my = (a[1] + b[1]) / 2 - 28;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.quadraticCurveTo(mx, my, b[0], b[1]);
            ctx.stroke();
          }
        }
        prevHub = c;
      }
      ctx.restore();

      // Second pass: completed tracks + active animated track
      let activeHead = null;
      let activeTrack = null;
      for (let i = 0; i < total; i++) {
        if (i > fullIdx) break;
        const t = tracks[i];
        if (!t.points || t.points.length < 2) continue;
        const isCurrent = i === fullIdx && this.progress < 1;
        const isMilestone = Boolean(t.milestone);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isCurrent) {
          ctx.strokeStyle = p.routeHead;
          ctx.lineWidth = 3.2;
          ctx.shadowColor = p.routeHead;
          ctx.shadowBlur = 10;
          activeHead = strokePolyline(ctx, t.points, proj, Math.max(0.15, partial));
          activeTrack = t;
        } else if (isMilestone) {
          ctx.strokeStyle = t.milestone === 'longest' ? p.gold : t.milestone === 'best' ? p.coral : p.routeBright;
          ctx.lineWidth = 2.4;
          ctx.globalAlpha = 0.9;
          strokePolyline(ctx, t.points, proj, 1);
        } else {
          ctx.strokeStyle = p.routeDim;
          ctx.lineWidth = 1.35;
          strokePolyline(ctx, t.points, proj, 1);
        }
        ctx.restore();
      }

      // Third pass: lit city beacons & labels
      for (const city of scenario.exploredCities.items) {
        const pt = proj(city.hub);
        const lit = citiesLit.has(city.code);
        ctx.save();
        if (lit) {
          // Soft glow
          const glow = ctx.createRadialGradient(pt[0], pt[1], 2, pt[0], pt[1], city.isNew ? 22 : 16);
          glow.addColorStop(0, city.isNew ? 'rgba(245,197,25,0.42)' : 'rgba(119,212,172,0.34)');
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], city.isNew ? 22 : 16, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = city.isNew ? p.gold : p.routeBright;
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], 4.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = p.ink;
          ctx.font = '600 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(city.name + (city.isNew ? ' ★' : ''), pt[0], pt[1] + 17);
        } else {
          ctx.fillStyle = p.contour;
          ctx.beginPath();
          ctx.arc(pt[0], pt[1], 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Active glowing runner head + floating milestone pill
      if (activeHead && activeTrack) {
        ctx.save();
        ctx.fillStyle = p.routeHead;
        ctx.shadowColor = p.routeHead;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(activeHead[0], activeHead[1], 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        const label = activeTrack.milestoneLabel
          ? `${activeTrack.date.slice(5)} · ${activeTrack.milestoneLabel}`
          : `${activeTrack.date.slice(5)} · ${activeTrack.cityName} · ${(activeTrack.distanceM / 1000).toFixed(1)} km`;
        drawBadge(ctx, activeHead[0], activeHead[1], label, p, p.routeHead);
      } else if (this.progress >= 0.999) {
        // Finished state: subtle anchor label for longest route
        const longestCity = cityMap[scenario.exploredCities.items[1]?.code || scenario.exploredCities.items[0]?.code];
        if (longestCity) {
          const pt = proj(longestCity.hub);
          drawBadge(ctx, pt[0], pt[1] - 6, `${scenario.year} 全年足迹 · ${scenario.summary.activityCount} 次`, p, p.routeBright);
        }
      }
    }

    _renderSingle(ctx, w, h, p, scenario) {
      const beat =
        this.focusKey === 'longest'
          ? scenario.longestRoute
          : this.focusKey === 'best'
            ? scenario.bestPerformance
            : scenario.firstRun;

      if (!beat || !beat.points || beat.points.length < 2) {
        drawBackdrop(ctx, w, h, p, this.variant, false, null);
        drawCalendarFallback(ctx, w, h, scenario, 1, p);
        return;
      }

      const bounds = computeBounds([beat.points]);
      const proj = createProjector(w, h, bounds, 42);
      drawBackdrop(ctx, w, h, p, this.variant, false, null);

      const accent =
        this.focusKey === 'longest' ? p.gold : this.focusKey === 'best' ? p.coral : p.routeBright;

      // Soft halo under-stroke
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokePolyline(ctx, beat.points, proj, 1);
      ctx.restore();

      // Main crisp track
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const head = strokePolyline(ctx, beat.points, proj, Math.max(0.2, this.progress));
      ctx.restore();

      // Start point
      const startPt = proj(beat.points[0]);
      ctx.save();
      ctx.fillStyle = p.routeBright;
      ctx.beginPath();
      ctx.arc(startPt[0], startPt[1], 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.bgTop;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Kilometre markers along the track
      const stepIdx = Math.max(4, Math.floor(beat.points.length / 5));
      for (let i = stepIdx; i < beat.points.length - 3; i += stepIdx) {
        const kp = proj(beat.points[i]);
        ctx.fillStyle = p.ink;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(kp[0], kp[1], 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (head) {
        ctx.save();
        ctx.fillStyle = p.gold;
        ctx.beginPath();
        ctx.arc(head[0], head[1], 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      drawBadge(
        ctx,
        w / 2,
        h - 14,
        `${beat.title} · ${(beat.distanceM / 1000).toFixed(2)} km · ${global.STORY_DATA.formatPace(beat.paceSeconds)}/km`,
        p,
        accent,
      );
    }

    _renderCities(ctx, w, h, p, scenario) {
      const worldBounds = { minX: 0.06, maxX: 0.94, minY: 0.08, maxY: 0.88 };
      const proj = createProjector(w, h, worldBounds, 30);
      drawBackdrop(ctx, w, h, p, this.variant, true, proj);

      const items = scenario.exploredCities.items;
      // Draw faint background tracks
      ctx.save();
      ctx.lineWidth = 1.2;
      for (const t of scenario.tracks) {
        if (!t.points || t.points.length < 2) continue;
        const selected = !this.selectedCityCode || this.selectedCityCode === t.cityCode;
        ctx.strokeStyle = selected ? p.routeDim : 'rgba(128,128,128,0.12)';
        strokePolyline(ctx, t.points, proj, 1);
      }
      ctx.restore();

      // Travel arcs between sequential cities
      if (items.length > 1) {
        ctx.save();
        ctx.strokeStyle = p.blue;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 5]);
        const home = proj(items[0].hub);
        for (let i = 1; i < items.length; i++) {
          const target = proj(items[i].hub);
          const mx = (home[0] + target[0]) / 2;
          const my = (home[1] + target[1]) / 2 - 30;
          ctx.beginPath();
          ctx.moveTo(home[0], home[1]);
          ctx.quadraticCurveTo(mx, my, target[0], target[1]);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Proportional city rings
      const maxKm = Math.max(1, ...items.map((c) => c.distanceM));
      for (const c of items) {
        const pt = proj(c.hub);
        const radius = 10 + Math.sqrt(c.distanceM / maxKm) * 20;
        const isSelected = this.selectedCityCode === c.code;
        ctx.save();
        ctx.fillStyle = c.isNew ? p.gold : p.routeBright;
        ctx.globalAlpha = isSelected ? 0.34 : 0.18;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], isSelected ? radius + 6 : radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = isSelected ? p.ink : c.isNew ? p.gold : p.routeBright;
        ctx.lineWidth = isSelected ? 2.5 : 1.6;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = c.isNew ? p.gold : p.routeBright;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = p.ink;
        ctx.font = `${isSelected ? '700' : '600'} 12px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`${c.name} · ${(c.distanceM / 1000).toFixed(0)}km`, pt[0], pt[1] + radius + 15);
        ctx.restore();
      }
    }

    _renderFrequent(ctx, w, h, p, scenario) {
      const fr = scenario.frequentRoute;
      if (!fr || !fr.available) {
        drawBackdrop(ctx, w, h, p, this.variant, false, null);
        drawCalendarFallback(ctx, w, h, scenario, 1, p);
        return;
      }

      const bounds = computeBounds([fr.basePoints]);
      const proj = createProjector(w, h, bounds, 46);
      drawBackdrop(ctx, w, h, p, this.variant, false, null);

      const variants = fr.overlayVariants;
      const shownCount = Math.max(1, Math.round(variants.length * this.progress));

      // Memory-layering strokes: every repeat adds translucent glow
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < shownCount; i++) {
        ctx.strokeStyle = i === shownCount - 1 ? p.gold : p.routeBright;
        ctx.globalAlpha = i === shownCount - 1 ? 0.92 : 0.18;
        ctx.lineWidth = i === shownCount - 1 ? 3 : 2.2;
        strokePolyline(ctx, variants[i], proj, 1);
      }
      ctx.restore();

      // Core median trajectory
      ctx.save();
      ctx.strokeStyle = p.ink;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      strokePolyline(ctx, fr.basePoints, proj, 1);
      ctx.restore();

      drawBadge(
        ctx,
        w / 2,
        h - 14,
        `${fr.name} · 叠影 ${shownCount}/${fr.runCount} 次 · 提速 ${fr.paceImprovementSec}"/km`,
        p,
        p.gold,
      );
    }

    destroy() {
      this.pause();
      if (this._resizeObserver) this._resizeObserver.disconnect();
    }
  }

  global.FOOTPRINT_ENGINE = {
    FootprintStage,
    getPalette,
  };
})(window);
