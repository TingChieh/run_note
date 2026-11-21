<script lang="ts">
  import { formatPace } from '#lib/api/activities.ts';
  import { defaultRecapBucketIndex, km, recapPeak, type Recap } from '#lib/recap.ts';

  let {
    recap,
    selectedIndex = $bindable(-1),
  }: {
    recap: Recap;
    selectedIndex?: number;
  } = $props();

  const uid = $props.id();
  let stageEl = $state<HTMLDivElement>(null!);
  let plotWidth = $state(0);

  const activeIndex = $derived(
    selectedIndex >= 0 && selectedIndex < recap.buckets.length ? selectedIndex : defaultRecapBucketIndex(recap),
  );
  const activeBucket = $derived(recap.buckets[activeIndex] ?? null);
  const peak = $derived(recapPeak(recap));

  function formatAxisKm(metres: number): string {
    const value = metres / 1000;
    if (value <= 0) return '0';
    if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
    if (value >= 100 || Math.abs(value - Math.round(value)) < 0.05) {
      return Math.round(value).toLocaleString('zh-CN');
    }
    return value.toFixed(1);
  }

  // Track rendered plot width so the SVG renders at 1:1 CSS pixels without shrinking strokes or dots;
  // all axis ticks, slot labels, and peak callouts are rendered in HTML at true CSS typography sizes.
  const svgW = $derived(Math.max(160, Math.round(plotWidth || 820)));
  const svgH = $derived(svgW < 420 ? 176 : 212);
  const padX = $derived(svgW < 420 ? 8 : 18);
  const padT = 28;
  const padB = 10;
  const innerW = $derived(Math.max(40, svgW - padX * 2));
  const innerH = $derived(Math.max(60, svgH - padT - padB));

  const visibleXIndices = $derived.by(() => {
    const n = recap.buckets.length;
    if (n <= 6 || svgW >= 500) return new Set(Array.from({ length: n }, (_, i) => i));
    if (svgW >= 310) return new Set([0, 2, 4, 6, 8, n - 1].filter((i) => i >= 0 && i < n));
    return new Set([0, 4, 8, n - 1].filter((i) => i >= 0 && i < n));
  });

  const geometry = $derived.by(() => {
    const n = recap.buckets.length;
    const stepX = n > 1 ? innerW / (n - 1) : innerW;
    const maxDist = Math.max(recap.max, 1);
    const maxCum = Math.max(recap.totalDistanceM, 1);

    const points = recap.buckets.map((bucket, index) => {
      const x = n === 1 ? padX + innerW / 2 : padX + index * stepX;
      const xPct = (x / svgW) * 100;
      const y =
        bucket.distance === null
          ? null
          : recap.max > 0
            ? padT + innerH - (bucket.distance / maxDist) * innerH
            : padT + innerH;
      const cy =
        bucket.cumulative === null || recap.totalDistanceM <= 0
          ? null
          : padT + innerH - (bucket.cumulative / maxCum) * innerH;
      return { x, xPct, y, cy, bucket, index };
    });

    const valid = points.filter((p): p is typeof p & { y: number } => p.y !== null);
    let curveD = '';
    let areaD = '';
    let cumD = '';

    if (valid.length >= 2 && recap.max > 0) {
      curveD = `M ${valid[0].x.toFixed(1)} ${valid[0].y.toFixed(1)}`;
      for (let i = 0; i < valid.length - 1; i++) {
        const cx = ((valid[i].x + valid[i + 1].x) / 2).toFixed(1);
        curveD += ` C ${cx} ${valid[i].y.toFixed(1)}, ${cx} ${valid[i + 1].y.toFixed(1)}, ${valid[i + 1].x.toFixed(1)} ${valid[i + 1].y.toFixed(1)}`;
      }
      areaD = `${curveD} L ${valid[valid.length - 1].x.toFixed(1)} ${padT + innerH} L ${valid[0].x.toFixed(1)} ${padT + innerH} Z`;
    }

    const cumValid = points.filter((p): p is typeof p & { cy: number } => p.cy !== null);
    if (cumValid.length >= 2 && recap.totalDistanceM > 0) {
      cumD = cumValid.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.cy.toFixed(1)}`).join(' ');
    }

    const guides = [1, 0.5, 0].map((ratio) => {
      const y = padT + innerH - ratio * innerH;
      return {
        y,
        label: recap.max > 0 ? formatAxisKm(recap.max * ratio) : '0',
        cumLabel: recap.totalDistanceM > 0 ? formatAxisKm(recap.totalDistanceM * ratio) : '0',
      };
    });

    const colW = n > 1 ? Math.min(64, Math.max(14, stepX * 0.86)) : 80;
    const badgePoint =
      points.find((p) => p.index === activeIndex && p.y !== null && p.bucket.distance !== null && recap.max > 0) ??
      points.find((p) => p.bucket.peak && p.y !== null && p.bucket.distance !== null && recap.max > 0) ??
      null;

    return { points, validCount: valid.length, curveD, areaD, cumD, guides, colW, badgePoint };
  });

  const hasCumulativeAxis = $derived(Boolean(geometry.cumD));

  const chartAriaLabel = $derived(
    hasCumulativeAxis
      ? `${recap.title}单期里程（左轴，最高 ${km(recap.max)} km）与累计里程（右轴，总计 ${recap.distance} km）双轴图，${peak || '暂无峰值'}`
      : `${recap.title}单期里程分布图，${peak || '暂无峰值'}`,
  );

  function choose(index: number) {
    selectedIndex = index;
  }

  function handleKeydown(event: KeyboardEvent, index: number) {
    const last = recap.buckets.length - 1;
    let next = index;
    if (event.key === 'ArrowRight') next = Math.min(last, index + 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(index);
      return;
    } else {
      return;
    }
    event.preventDefault();
    choose(next);
    const target = stageEl?.querySelector<SVGGElement>(`[data-bucket-index="${next}"]`);
    target?.focus();
  }
</script>

<div class="terrain-head">
  <div>
    <p class="chapter-num">02 · RHYTHM TERRAIN</p>
    <h2 id="recap-distribution">里程地形与累计轨迹</h2>
  </div>
  {#if activeBucket}
    <div class="inspector-pill" aria-live="polite" data-testid="recap-terrain-inspector">
      {#if activeBucket.future}
        <strong>{activeBucket.rangeShort}</strong>
        <span class="sep" aria-hidden="true">|</span>
        <span>尚未到达</span>
      {:else}
        <strong>
          {activeBucket.rangeShort}{#if activeBucket.peak}{` · ${recap.derived.peakTied ? '并列峰值' : '峰值'}`}{/if}
        </strong>
        <span class="sep" aria-hidden="true">|</span>
        <span>单期 <strong>{km(activeBucket.distance ?? 0)} km</strong></span>
        {#if activeBucket.cumulative !== null && recap.totalDistanceM > 0}
          <span class="sep" aria-hidden="true">|</span>
          <span>累计 {km(activeBucket.cumulative)} km</span>
        {/if}
        <span class="sep" aria-hidden="true">|</span>
        <span>{activeBucket.activityCount ?? 0} 次 · {activeBucket.activityDays ?? 0} 天</span>
        <span class="sep" aria-hidden="true">|</span>
        <span>均配 {formatPace(activeBucket.avgPaceSeconds)}</span>
      {/if}
    </div>
  {/if}
</div>

<p class="chart-note">
  {recap.period === 'year' ? '按月统计' : '按周统计 · 周一开始'}{#if peak}
    · {peak}{/if}
</p>

<div class="terrain-stage" bind:this={stageEl} data-testid="recap-terrain-chart">
  <div class="axis-units" aria-hidden="true">
    <span class="axis-unit axis-unit-left">单期 km</span>
    {#if hasCumulativeAxis}
      <span class="axis-unit axis-unit-right">累计 km</span>
    {/if}
  </div>

  <div class="chart-frame" class:has-cum-axis={hasCumulativeAxis}>
    <div class="y-axis y-axis-left" aria-hidden="true" style:height={`${svgH}px`} data-testid="recap-terrain-axis-left">
      {#each geometry.guides as guide (guide.y)}
        <span class="axis-label axis-label-left" style:top={`${guide.y}px`}>{guide.label}</span>
      {/each}
    </div>

    <div class="plot-column" bind:clientWidth={plotWidth}>
      <div class="plot-canvas" style:height={`${svgH}px`}>
        <svg
          class="terrain-svg"
          viewBox={`0 0 ${svgW} ${svgH}`}
          width={svgW}
          height={svgH}
          role="img"
          aria-label={chartAriaLabel}
        >
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.3" />
              <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.02" />
            </linearGradient>
          </defs>

          {#each geometry.guides as guide (guide.y)}
            <line x1={padX} y1={guide.y} x2={svgW - padX} y2={guide.y} class="guide-line" />
          {/each}

          {#if geometry.cumD}
            <path class="cum-path" d={geometry.cumD} fill="none" data-testid="recap-terrain-cum-path" />
          {/if}
          {#if geometry.areaD}
            <path d={geometry.areaD} fill={`url(#${uid}-area)`} />
          {/if}
          {#if geometry.curveD}
            {#key `${recap.period}-${recap.year}-${recap.month ?? ''}-${recap.totalDistanceM}`}
              <path class="terrain-path" d={geometry.curveD} fill="none" />
            {/key}
          {/if}

          {#each geometry.points as pt (pt.bucket.start)}
            {@const isSelected = pt.index === activeIndex}
            <g
              class="hit-col"
              class:is-selected={isSelected}
              class:is-peak={pt.bucket.peak}
              tabindex="0"
              role="button"
              data-bucket-index={pt.index}
              aria-pressed={isSelected}
              aria-label={`${pt.bucket.rangeShort}，${
                pt.bucket.distance === null
                  ? '尚未到达'
                  : `单期里程 ${km(pt.bucket.distance)} 公里${
                      pt.bucket.cumulative !== null && recap.totalDistanceM > 0
                        ? `，累计里程 ${km(pt.bucket.cumulative)} 公里`
                        : ''
                    }，跑步 ${pt.bucket.activityCount ?? 0} 次，平均配速 ${formatPace(pt.bucket.avgPaceSeconds)}`
              }${pt.bucket.peak ? '，峰值时段' : ''}`}
              onclick={() => choose(pt.index)}
              onmouseenter={() => choose(pt.index)}
              onkeydown={(event) => handleKeydown(event, pt.index)}
            >
              <rect
                class="col-focus"
                x={Math.max(0, pt.x - geometry.colW / 2)}
                y={padT - 8}
                width={geometry.colW}
                height={innerH + 14}
                rx="8"
              />
              {#if pt.y !== null}
                <line
                  x1={pt.x}
                  y1={pt.y}
                  x2={pt.x}
                  y2={padT + innerH}
                  class="stem"
                  class:stem-peak={pt.bucket.peak}
                  class:stem-selected={isSelected && !pt.bucket.peak}
                />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={pt.bucket.peak ? 6.5 : isSelected ? 5.5 : geometry.validCount === 1 ? 5.5 : 4}
                  class="point"
                  class:point-peak={pt.bucket.peak}
                />
              {:else}
                <circle cx={pt.x} cy={padT + innerH} r="3" class="point-future" />
              {/if}
            </g>
          {/each}
        </svg>

        {#if geometry.badgePoint && geometry.badgePoint.y !== null && geometry.badgePoint.bucket.distance !== null}
          <span
            class="point-badge"
            class:badge-peak={geometry.badgePoint.bucket.peak}
            class:badge-start={geometry.badgePoint.xPct < 14}
            class:badge-end={geometry.badgePoint.xPct > 86}
            style:left={`${geometry.badgePoint.xPct.toFixed(2)}%`}
            style:top={`${Math.max(0, geometry.badgePoint.y - 24)}px`}
            aria-hidden="true"
          >
            {km(geometry.badgePoint.bucket.distance, 1)}
          </span>
        {/if}
      </div>

      <div class="x-axis" aria-hidden="true">
        {#each geometry.points as pt (pt.bucket.start)}
          {#if visibleXIndices.has(pt.index)}
            <button
              type="button"
              tabindex="-1"
              data-date={pt.bucket.start}
              data-slot-index={pt.index}
              class="slot-label"
              class:slot-active={pt.index === activeIndex || pt.bucket.peak}
              class:slot-first={pt.index === 0}
              class:slot-last={pt.index === recap.buckets.length - 1 && recap.buckets.length > 1}
              style:left={`${pt.xPct.toFixed(2)}%`}
              onclick={() => choose(pt.index)}
              onmouseenter={() => choose(pt.index)}
            >
              {pt.bucket.shortLabel}
            </button>
          {/if}
        {/each}
      </div>
    </div>

    {#if hasCumulativeAxis}
      <div
        class="y-axis y-axis-right"
        aria-hidden="true"
        style:height={`${svgH}px`}
        data-testid="recap-terrain-axis-right"
      >
        {#each geometry.guides as guide (guide.y)}
          <span class="axis-label axis-label-right" style:top={`${guide.y}px`}>{guide.cumLabel}</span>
        {/each}
      </div>
    {/if}
  </div>
</div>

<div class="terrain-legend">
  <span><i class="swatch swatch-area" aria-hidden="true"></i>{hasCumulativeAxis ? '单期里程（左轴）' : '单期里程'}</span
  >
  {#if recap.max > 0}
    <span><i class="swatch swatch-peak" aria-hidden="true"></i>峰值高点</span>
  {/if}
  {#if hasCumulativeAxis}
    <span><i class="swatch swatch-cum" aria-hidden="true"></i>累计里程（右轴）</span>
  {/if}
  <span class="legend-hint">点击或方向键切换时段查看明细</span>
</div>

<details class="data-details">
  <summary>查看完整数据表</summary>
  <div class="table-wrap" role="region" aria-label="周期分桶明细数据表">
    <table>
      <caption class="sr-only">{recap.title}里程分布</caption>
      <thead>
        <tr>
          <th scope="col">周期</th>
          <th scope="col">日期范围</th>
          <th scope="col" class="num">里程（km）</th>
          <th scope="col" class="num">次数</th>
          <th scope="col" class="num">天数</th>
          <th scope="col" class="num">平均配速</th>
        </tr>
      </thead>
      <tbody>
        {#each recap.buckets as bucket (bucket.start)}
          <tr class:is-peak={bucket.peak}>
            <th scope="row">
              {bucket.label}{#if bucket.peak}<span aria-hidden="true"> ★</span><span class="sr-only">，峰值</span>{/if}
            </th>
            <td>
              <time datetime={bucket.start}>{bucket.start}</time> 至
              <time datetime={bucket.last}>{bucket.last}</time>
            </td>
            <td class="num">{bucket.distance === null ? '未到' : km(bucket.distance)}</td>
            <td class="num">{bucket.future ? '—' : (bucket.activityCount ?? 0)}</td>
            <td class="num">{bucket.future ? '—' : (bucket.activityDays ?? 0)}</td>
            <td class="num">
              {#if bucket.future}
                —<span class="sr-only">（尚未到达）</span>
              {:else}
                {formatPace(bucket.avgPaceSeconds)}{#if bucket.avgPaceSeconds === null}<span class="sr-only"
                    >（数据缺失）</span
                  >{/if}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</details>

<style>
  .terrain-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  .chapter-num {
    margin: 0 0 var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-caps);
    color: var(--primary);
  }
  h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .inspector-pill {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill);
    background: var(--muted);
    border: 1px solid var(--border);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
    max-width: 100%;
  }
  .inspector-pill strong {
    color: var(--primary);
    font-weight: var(--weight-bold);
  }
  .sep {
    color: var(--border);
  }
  .chart-note {
    margin: 0 0 var(--space-3);
    color: var(--muted-foreground);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  .terrain-stage {
    width: 100%;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .axis-units {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }
  .axis-unit {
    font-size: var(--text-caption);
    line-height: var(--line-height-solid);
    white-space: nowrap;
  }
  .axis-unit-left {
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }
  .axis-unit-right {
    color: var(--muted-foreground);
    font-weight: var(--weight-medium);
  }
  .chart-frame {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2);
    align-items: start;
  }
  .chart-frame.has-cum-axis {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .y-axis {
    position: relative;
    min-width: 2.25rem;
  }
  .y-axis-right {
    min-width: 2.4rem;
  }
  .axis-label {
    position: absolute;
    transform: translateY(-50%);
    font-size: var(--text-caption);
    line-height: var(--line-height-solid);
    white-space: nowrap;
  }
  .axis-label-left {
    right: 0;
    color: var(--primary);
    font-weight: var(--weight-medium);
  }
  .axis-label-right {
    left: 0;
    color: var(--muted-foreground);
    font-weight: var(--weight-regular);
  }
  .plot-column {
    min-width: 0;
  }
  .plot-canvas {
    position: relative;
    width: 100%;
  }
  .terrain-svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .guide-line {
    stroke: var(--border);
    stroke-width: 1;
  }
  .cum-path {
    stroke: var(--muted-foreground);
    stroke-width: 1.75;
    stroke-dasharray: 6 6;
    opacity: 0.72;
  }
  .terrain-path {
    stroke: var(--primary);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 2400;
    stroke-dashoffset: 2400;
    animation: terrain-draw 820ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  }
  .hit-col {
    cursor: pointer;
    outline: none;
  }
  .col-focus {
    fill: transparent;
    transition:
      fill var(--transition-control),
      opacity var(--transition-control);
  }
  .hit-col.is-selected .col-focus {
    fill: var(--primary-soft);
    opacity: 0.7;
  }
  .hit-col:focus-visible .col-focus {
    stroke: var(--ring);
    stroke-width: 2;
    fill: var(--primary-soft);
    opacity: 0.85;
  }
  .stem {
    stroke: var(--border);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .stem-peak {
    stroke: var(--recap-gold);
    stroke-width: 2.5;
    stroke-dasharray: none;
  }
  .stem-selected {
    stroke: var(--primary);
    stroke-width: 2;
    stroke-dasharray: none;
  }
  .point {
    fill: var(--primary);
    stroke: var(--surface);
    stroke-width: 2.5;
  }
  .point-peak {
    fill: var(--recap-gold);
  }
  .point-future {
    fill: var(--border);
  }
  .point-badge {
    position: absolute;
    transform: translateX(-50%);
    pointer-events: none;
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    color: var(--primary);
    white-space: nowrap;
  }
  .badge-peak {
    color: var(--foreground);
  }
  .badge-start {
    transform: translateX(0);
  }
  .badge-end {
    transform: translateX(-100%);
  }
  .x-axis {
    position: relative;
    height: 1.5rem;
    margin-top: var(--space-1);
  }
  .slot-label {
    position: absolute;
    top: 0;
    padding: 0;
    border: 0;
    background: transparent;
    transform: translateX(-50%);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    line-height: var(--line-height-heading);
    color: var(--muted-foreground);
    white-space: nowrap;
    cursor: pointer;
  }
  .slot-label:hover {
    color: var(--foreground);
  }
  .slot-first {
    transform: translateX(0);
  }
  .slot-last {
    transform: translateX(-100%);
  }
  .slot-active {
    font-weight: var(--weight-bold);
    color: var(--foreground);
  }
  .terrain-legend {
    margin-top: var(--space-3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .swatch {
    display: inline-block;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 3px;
    vertical-align: -1px;
    margin-inline-end: var(--space-1);
  }
  .swatch-area {
    background: color-mix(in srgb, var(--primary) 42%, var(--surface));
    border: 1px solid var(--primary);
  }
  .swatch-peak {
    background: var(--recap-gold);
  }
  .swatch-cum {
    height: 2px;
    vertical-align: 3px;
    border-top: 2px dashed var(--muted-foreground);
  }
  .legend-hint {
    margin-inline-start: auto;
  }
  .data-details {
    margin-top: var(--space-4);
    border-top: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
    padding-block: var(--space-3);
    min-height: 2.75rem;
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
  }
  .table-wrap {
    overflow-x: auto;
    padding-bottom: var(--space-2);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: start;
    padding: var(--space-2) var(--space-2);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  thead th {
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .num {
    text-align: end;
  }
  tr.is-peak th,
  tr.is-peak td {
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }
  time {
    display: inline-block;
  }
  @keyframes terrain-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .terrain-path {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
  @media (max-width: 639px) {
    .legend-hint {
      margin-inline-start: 0;
      width: 100%;
    }
    .inspector-pill {
      border-radius: var(--radius-control);
    }
  }
  @media (max-width: 479px) {
    .chart-frame {
      gap: var(--space-1);
    }
    .y-axis,
    .y-axis-right {
      min-width: 1.9rem;
    }
  }
  @media (forced-colors: active) {
    .terrain-path,
    .point {
      stroke: Highlight;
      fill: Highlight;
    }
    .cum-path {
      stroke: CanvasText;
    }
    .point-peak,
    .stem-peak {
      stroke: LinkText;
      fill: LinkText;
    }
    .swatch-area,
    .swatch-peak {
      forced-color-adjust: none;
      background: Highlight;
    }
  }
</style>
