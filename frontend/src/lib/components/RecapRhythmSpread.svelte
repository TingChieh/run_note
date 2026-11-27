<script lang="ts">
  import { formatPace } from '#lib/api/activities.ts';
  import { defaultRecapBucketIndex, type Recap } from '#lib/recap.ts';

  let {
    recap,
    selectedIndex = $bindable(-1),
  }: {
    recap: Recap;
    selectedIndex?: number;
  } = $props();

  let pacePlotWidth = $state(0);

  const activeIndex = $derived(
    selectedIndex >= 0 && selectedIndex < recap.buckets.length ? selectedIndex : defaultRecapBucketIndex(recap),
  );

  const maxDays = $derived(Math.max(1, ...recap.buckets.map((bucket) => bucket.activityDays ?? 0)));

  // Render pace SVG at 1:1 CSS pixels using measured plot width; keep all axis/slot/peak labels in HTML at 12px.
  const paceW = $derived(Math.max(160, Math.round(pacePlotWidth || 420)));
  const paceH = 168;
  const padX = $derived(paceW < 300 ? 8 : 14);
  const padT = 26;
  const padB = 10;
  const innerW = $derived(Math.max(40, paceW - padX * 2));
  const innerH = paceH - padT - padB;

  const visiblePaceXIndices = $derived.by(() => {
    const n = recap.buckets.length;
    if (n <= 6 || paceW >= 500) return new Set(Array.from({ length: n }, (_, i) => i));
    if (paceW >= 290) return new Set([0, 2, 4, 6, 8, n - 1].filter((i) => i >= 0 && i < n));
    return new Set([0, 4, 8, n - 1].filter((i) => i >= 0 && i < n));
  });

  const paceChart = $derived.by(() => {
    const paced = recap.buckets
      .map((bucket, index) => ({ bucket, index }))
      .filter(({ bucket }) => !bucket.future && bucket.avgPaceSeconds !== null && bucket.avgPaceSeconds > 0);
    if (paced.length < 2) {
      return {
        paced,
        pathD: '',
        points: [],
        minP: 0,
        maxP: 0,
        yAvg: null as number | null,
        showAvgAxisLabel: false,
        fastestBadge: null as { xPct: number; y: number; text: string } | null,
      };
    }

    const values = paced.map(({ bucket }) => bucket.avgPaceSeconds!);
    if (recap.avgPaceSeconds !== null && recap.avgPaceSeconds > 0) values.push(recap.avgPaceSeconds);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = rawMax - rawMin < 8 ? 14 : Math.max(8, (rawMax - rawMin) * 0.16);
    const minP = Math.max(1, rawMin - pad);
    const maxP = rawMax + pad;
    const span = Math.max(10, maxP - minP);

    const n = recap.buckets.length;
    const stepX = n > 1 ? innerW / (n - 1) : innerW;

    // Inverted Y: faster (smaller sec/km) sits higher.
    const points = recap.buckets.map((bucket, index) => {
      const x = n === 1 ? padX + innerW / 2 : padX + index * stepX;
      const xPct = (x / paceW) * 100;
      const p =
        !bucket.future && bucket.avgPaceSeconds !== null && bucket.avgPaceSeconds > 0 ? bucket.avgPaceSeconds : null;
      const y = p === null ? null : padT + ((p - minP) / span) * innerH;
      return { x, xPct, y, bucket, index };
    });

    const valid = points.filter((pt): pt is typeof pt & { y: number } => pt.y !== null);
    let pathD = `M ${valid[0].x.toFixed(1)} ${valid[0].y.toFixed(1)}`;
    for (let i = 0; i < valid.length - 1; i++) {
      const cx = ((valid[i].x + valid[i + 1].x) / 2).toFixed(1);
      pathD += ` C ${cx} ${valid[i].y.toFixed(1)}, ${cx} ${valid[i + 1].y.toFixed(1)}, ${valid[i + 1].x.toFixed(1)} ${valid[i + 1].y.toFixed(1)}`;
    }

    const yAvg =
      recap.avgPaceSeconds !== null && recap.avgPaceSeconds > 0
        ? padT + ((recap.avgPaceSeconds - minP) / span) * innerH
        : null;
    const showAvgAxisLabel = yAvg !== null && yAvg - padT >= 22 && padT + innerH - yAvg >= 22;

    const fastestPt = points.find((pt) => pt.bucket.fastest && pt.y !== null && pt.bucket.avgPaceSeconds !== null);
    const fastestBadge =
      fastestPt && fastestPt.y !== null && fastestPt.bucket.avgPaceSeconds !== null
        ? {
            xPct: fastestPt.xPct,
            y: Math.max(0, fastestPt.y - 22),
            text: formatPace(fastestPt.bucket.avgPaceSeconds).replace(/ \/km$/, ''),
          }
        : null;

    return { paced, pathD, points, minP, maxP, yAvg, showAvgAxisLabel, fastestBadge };
  });

  const paceMeta = $derived(
    recap.derived.fastestPace !== null
      ? `${recap.derived.fastestTied ? '并列最快' : '最快'} ${recap.derived.fastestLabelCompact} · ${recap.derived.fastestPaceText}`
      : '暂无配速数据',
  );

  const avgPaceShort = $derived(
    recap.avgPaceSeconds !== null ? formatPace(recap.avgPaceSeconds).replace(/ \/km$/, '') : '—',
  );
</script>

<div class="spread-wrap">
  <section class="spread" aria-label="出勤节律与配速演进" data-testid="recap-rhythm-spread">
    <article class="section-hairline chapter-col" aria-labelledby="recap-attendance-title">
      <div class="chapter-head">
        <div>
          <p class="chapter-num">03A · CONSISTENCY</p>
          <h2 id="recap-attendance-title">出勤节律矩阵</h2>
        </div>
        <span class="chapter-meta">
          {recap.activityDays.toLocaleString('zh-CN')} 天 · {recap.activityCount.toLocaleString('zh-CN')} 次
        </span>
      </div>

      <div
        class="ledger-grid"
        class:ledger-grid-month={recap.period === 'month'}
        role="group"
        aria-label="各时段出勤天数与次数"
        data-testid="recap-attendance-grid"
      >
        {#each recap.buckets as bucket, index (bucket.start)}
          {@const ratio = !bucket.future && bucket.activityDays ? Math.min(1, bucket.activityDays / maxDays) : 0}
          {@const isSelected = index === activeIndex}
          <button
            type="button"
            data-date={bucket.start}
            class="ledger-cell"
            class:is-selected={isSelected}
            class:is-peak={bucket.peak}
            class:is-future={bucket.future}
            aria-pressed={isSelected}
            aria-label={`${bucket.rangeShort}，${
              bucket.future ? '尚未到达' : `活跃 ${bucket.activityDays ?? 0} 天，跑步 ${bucket.activityCount ?? 0} 次`
            }`}
            onclick={() => {
              selectedIndex = index;
            }}
          >
            <span class="cell-label">{bucket.shortLabel}</span>
            <span class="cell-days">
              <strong>{bucket.future ? '—' : (bucket.activityDays ?? 0)}</strong>
              {#if !bucket.future}<span class="cell-unit">天</span>{/if}
            </span>
            <span class="cell-bar" aria-hidden="true">
              <i class="cell-bar-fill" style:width={`${Math.round(ratio * 100)}%`}></i>
            </span>
            <span class="cell-sub">{bucket.future ? '未到' : `${bucket.activityCount ?? 0} 次`}</span>
          </button>
        {/each}
      </div>
    </article>

    <article class="section-hairline chapter-col" aria-labelledby="recap-pace-title">
      <div class="chapter-head">
        <div>
          <p class="chapter-num">03B · PACE PROFILE</p>
          <h2 id="recap-pace-title">均配速走势</h2>
        </div>
        <span class="chapter-meta chapter-meta-accent">{paceMeta}</span>
      </div>

      <div class="pace-stage" data-testid="recap-pace-chart">
        {#if paceChart.paced.length >= 2}
          <div class="pace-frame">
            <div class="pace-y-axis" aria-hidden="true" style:height={`${paceH}px`}>
              <span class="axis-label" style:top={`${padT}px`}>
                {formatPace(paceChart.minP).replace(/ \/km$/, '')}
              </span>
              {#if paceChart.showAvgAxisLabel && paceChart.yAvg !== null}
                <span class="axis-label avg-label" style:top={`${paceChart.yAvg}px`}>均 {avgPaceShort}</span>
              {/if}
              <span class="axis-label" style:top={`${padT + innerH}px`}>
                {formatPace(paceChart.maxP).replace(/ \/km$/, '')}
              </span>
            </div>

            <div class="pace-plot-col" bind:clientWidth={pacePlotWidth}>
              <div class="pace-canvas" style:height={`${paceH}px`}>
                <svg
                  class="pace-svg"
                  viewBox={`0 0 ${paceW} ${paceH}`}
                  width={paceW}
                  height={paceH}
                  role="img"
                  aria-label={`各时段加权平均配速走势图，${paceMeta}`}
                >
                  <line x1={padX} y1={padT} x2={paceW - padX} y2={padT} class="guide-line" />
                  {#if paceChart.yAvg !== null}
                    <line x1={padX} y1={paceChart.yAvg} x2={paceW - padX} y2={paceChart.yAvg} class="avg-line" />
                  {/if}
                  <line x1={padX} y1={padT + innerH} x2={paceW - padX} y2={padT + innerH} class="guide-line" />

                  {#key `${recap.period}-${recap.year}-${recap.month ?? ''}-${recap.derived.fastestPace}`}
                    <path class="pace-path" d={paceChart.pathD} fill="none" />
                  {/key}

                  {#each paceChart.points as pt (pt.bucket.start)}
                    {#if pt.y !== null}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={pt.bucket.fastest ? 5.5 : 3.5}
                        class="pace-dot"
                        class:pace-dot-fast={pt.bucket.fastest}
                      />
                    {/if}
                  {/each}
                </svg>

                {#if paceChart.fastestBadge}
                  <span
                    class="pace-fast-badge"
                    class:badge-start={paceChart.fastestBadge.xPct < 14}
                    class:badge-end={paceChart.fastestBadge.xPct > 86}
                    style:left={`${paceChart.fastestBadge.xPct.toFixed(2)}%`}
                    style:top={`${paceChart.fastestBadge.y}px`}
                    aria-hidden="true"
                  >
                    {paceChart.fastestBadge.text}
                  </span>
                {/if}
              </div>

              <div class="pace-x-axis" aria-hidden="true">
                {#each paceChart.points as pt (pt.bucket.start)}
                  {#if visiblePaceXIndices.has(pt.index)}
                    <span
                      class="slot-label"
                      class:slot-fast={pt.bucket.fastest}
                      class:slot-first={pt.index === 0}
                      class:slot-last={pt.index === recap.buckets.length - 1 && recap.buckets.length > 1}
                      style:left={`${pt.xPct.toFixed(2)}%`}
                    >
                      {pt.bucket.shortLabel}
                    </span>
                  {/if}
                {/each}
              </div>
            </div>
          </div>
          <p class="footnote">
            纵轴越靠上代表该时段加权平均配速越快（周期均配 {avgPaceShort} /km），均取自服务端聚合。
          </p>
        {:else if paceChart.paced.length === 1}
          {@const single = paceChart.paced[0].bucket}
          <div class="pace-single">
            <p class="pace-single-period">{single.rangeShort}</p>
            <p class="pace-single-val">{formatPace(single.avgPaceSeconds)}</p>
            <p class="footnote">当前仅 1 个时段具备有效配速，更多记录后会呈现配速演进曲线。</p>
          </div>
        {:else}
          <p class="footnote">该周期暂无足够的有效配速记录。</p>
        {/if}
      </div>
    </article>
  </section>
</div>

<style>
  .spread-wrap {
    container-type: inline-size;
    margin-top: var(--space-8);
    min-width: 0;
  }
  .spread {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-8);
  }
  @container (min-width: 48rem) {
    .spread {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-8);
    }
  }
  .chapter-col {
    min-width: 0;
  }
  .chapter-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-4);
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
  .chapter-meta {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .chapter-meta-accent {
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }

  /* Flat editorial attendance ledger (brand.md §1.3: no circular rings) */
  .ledger-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .ledger-grid-month {
    grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));
  }
  .ledger-cell {
    display: grid;
    gap: var(--space-1);
    justify-items: start;
    min-width: 0;
    min-height: 2.75rem;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
    color: var(--foreground);
    font-variant-numeric: tabular-nums;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--transition-control),
      background-color var(--transition-control);
  }
  .ledger-cell:hover {
    border-color: var(--control-border);
  }
  .ledger-cell.is-selected {
    border-color: var(--rule);
    background: var(--primary-soft);
  }
  .ledger-cell.is-future {
    opacity: 0.45;
  }
  .ledger-cell:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .cell-label {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-solid);
    color: var(--muted-foreground);
  }
  .ledger-cell.is-selected .cell-label,
  .ledger-cell.is-peak .cell-label {
    color: var(--foreground);
  }
  .cell-days {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
  }
  .cell-days strong {
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
  }
  .cell-unit {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .cell-bar {
    display: block;
    width: 100%;
    height: 3px;
    background: var(--border);
  }
  .cell-bar-fill {
    display: block;
    height: 100%;
    background: var(--primary);
  }
  .ledger-cell.is-peak .cell-bar-fill {
    background: var(--receipt-mark);
  }
  .cell-sub {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: var(--line-height-solid);
    color: var(--muted-foreground);
  }

  .pace-stage {
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .pace-frame {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2);
    align-items: start;
  }
  .pace-y-axis {
    position: relative;
    min-width: 3.1rem;
  }
  .axis-label {
    position: absolute;
    right: 0;
    transform: translateY(-50%);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: var(--line-height-solid);
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .avg-label {
    font-weight: var(--weight-semibold);
    color: var(--primary);
  }
  .pace-plot-col {
    min-width: 0;
  }
  .pace-canvas {
    position: relative;
    width: 100%;
  }
  .pace-svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .guide-line {
    stroke: var(--border);
    stroke-width: 1;
  }
  .avg-line {
    stroke: var(--primary);
    stroke-opacity: 0.52;
    stroke-dasharray: 4 4;
  }
  .pace-path {
    stroke: var(--primary);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 1400;
    stroke-dashoffset: 1400;
    animation: pace-draw 720ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  }
  .pace-dot {
    fill: var(--primary);
    stroke: var(--background);
    stroke-width: 2;
  }
  .pace-dot-fast {
    fill: var(--receipt-mark);
    stroke: var(--foreground);
    stroke-width: 1.5;
  }
  :global(:root[data-theme='dark']) .pace-dot-fast {
    stroke: var(--background);
  }
  .pace-fast-badge {
    position: absolute;
    transform: translateX(-50%);
    pointer-events: none;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-solid);
    color: var(--foreground);
    white-space: nowrap;
  }
  .badge-start {
    transform: translateX(0);
  }
  .badge-end {
    transform: translateX(-100%);
  }
  .pace-x-axis {
    position: relative;
    height: 1.5rem;
    margin-top: var(--space-1);
  }
  .slot-label {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    line-height: var(--line-height-heading);
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .slot-first {
    transform: translateX(0);
  }
  .slot-last {
    transform: translateX(-100%);
  }
  .slot-fast {
    font-weight: var(--weight-bold);
    color: var(--foreground);
  }
  .pace-single {
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sheet);
    background: var(--paper);
    font-variant-numeric: tabular-nums;
  }
  .pace-single-period {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .pace-single-val {
    margin-top: var(--space-1);
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    color: var(--primary);
  }
  .footnote {
    margin-top: var(--space-3);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  @keyframes pace-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pace-path {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
  @media (max-width: 639px) {
    .ledger-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (forced-colors: active) {
    .cell-bar-fill,
    .pace-path,
    .pace-dot {
      forced-color-adjust: none;
      stroke: Highlight;
      fill: Highlight;
      background: Highlight;
    }
    .ledger-cell.is-peak .cell-bar-fill,
    .pace-dot-fast {
      stroke: LinkText;
      fill: LinkText;
      background: LinkText;
    }
  }
</style>
