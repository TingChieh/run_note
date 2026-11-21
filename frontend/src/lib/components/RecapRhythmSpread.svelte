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

  const activeIndex = $derived(
    selectedIndex >= 0 && selectedIndex < recap.buckets.length ? selectedIndex : defaultRecapBucketIndex(recap),
  );

  const maxDays = $derived(Math.max(1, ...recap.buckets.map((bucket) => bucket.activityDays ?? 0)));
  const ringR = 18;
  const ringCirc = 2 * Math.PI * ringR;

  const paceW = 500;
  const paceH = 212;
  const padL = 62;
  const padR = 24;
  const padT = 28;
  const padB = 34;
  const plotW = paceW - padL - padR;
  const plotH = paceH - padT - padB;

  const paceChart = $derived.by(() => {
    const paced = recap.buckets
      .map((bucket, index) => ({ bucket, index }))
      .filter(({ bucket }) => !bucket.future && bucket.avgPaceSeconds !== null && bucket.avgPaceSeconds > 0);
    if (paced.length < 2) {
      return { paced, pathD: '', points: [], minP: 0, maxP: 0, yAvg: null as number | null };
    }

    const values = paced.map(({ bucket }) => bucket.avgPaceSeconds!);
    if (recap.avgPaceSeconds !== null && recap.avgPaceSeconds > 0) values.push(recap.avgPaceSeconds);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = rawMax - rawMin < 8 ? 14 : Math.max(8, (rawMax - rawMin) * 0.14);
    const minP = Math.max(1, rawMin - pad);
    const maxP = rawMax + pad;
    const span = Math.max(10, maxP - minP);

    const n = recap.buckets.length;
    const stepX = n > 1 ? plotW / (n - 1) : plotW;

    // Inverted Y: faster (smaller sec/km) sits higher.
    const points = recap.buckets.map((bucket, index) => {
      const x = n === 1 ? padL + plotW / 2 : padL + index * stepX;
      const p =
        !bucket.future && bucket.avgPaceSeconds !== null && bucket.avgPaceSeconds > 0 ? bucket.avgPaceSeconds : null;
      const y = p === null ? null : padT + ((p - minP) / span) * plotH;
      return { x, y, bucket, index };
    });

    const valid = points.filter((pt): pt is typeof pt & { y: number } => pt.y !== null);
    let pathD = `M ${valid[0].x.toFixed(1)} ${valid[0].y.toFixed(1)}`;
    for (let i = 0; i < valid.length - 1; i++) {
      const cx = ((valid[i].x + valid[i + 1].x) / 2).toFixed(1);
      pathD += ` C ${cx} ${valid[i].y.toFixed(1)}, ${cx} ${valid[i + 1].y.toFixed(1)}, ${valid[i + 1].x.toFixed(1)} ${valid[i + 1].y.toFixed(1)}`;
    }

    const yAvg =
      recap.avgPaceSeconds !== null && recap.avgPaceSeconds > 0
        ? padT + ((recap.avgPaceSeconds - minP) / span) * plotH
        : null;

    return { paced, pathD, points, minP, maxP, yAvg };
  });

  const paceChip = $derived(
    recap.derived.fastestPace !== null
      ? `${recap.derived.fastestTied ? '并列最快' : '最快'} ${recap.derived.fastestLabel} · ${recap.derived.fastestPaceText}`
      : '暂无配速数据',
  );

  const avgPaceShort = $derived(
    recap.avgPaceSeconds !== null ? formatPace(recap.avgPaceSeconds).replace(/ \/km$/, '') : '—',
  );
</script>

<section class="spread" aria-label="出勤节律与配速演进" data-testid="recap-rhythm-spread">
  <article class="chapter-card" aria-labelledby="recap-attendance-title">
    <div class="chapter-head">
      <div>
        <p class="chapter-num">03A · CONSISTENCY</p>
        <h2 id="recap-attendance-title">出勤节律矩阵</h2>
      </div>
      <span class="chip">
        {recap.activityDays.toLocaleString('zh-CN')} 天 · {recap.activityCount.toLocaleString('zh-CN')} 次
      </span>
    </div>

    <div
      class="ring-grid"
      class:ring-grid-month={recap.period === 'month'}
      role="group"
      aria-label="各时段出勤天数与次数"
      data-testid="recap-attendance-grid"
    >
      {#each recap.buckets as bucket, index (bucket.start)}
        {@const ratio = !bucket.future && bucket.activityDays ? Math.min(1, bucket.activityDays / maxDays) : 0}
        {@const dashOffset = ringCirc * (1 - ratio)}
        {@const isSelected = index === activeIndex}
        <button
          type="button"
          data-date={bucket.start}
          class="ring-cell"
          class:is-selected={isSelected}
          class:is-future={bucket.future}
          aria-pressed={isSelected}
          aria-label={`${bucket.rangeShort}，${
            bucket.future ? '尚未到达' : `活跃 ${bucket.activityDays ?? 0} 天，跑步 ${bucket.activityCount ?? 0} 次`
          }`}
          onclick={() => {
            selectedIndex = index;
          }}
        >
          <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
            <circle cx="23" cy="23" r={ringR} fill="none" class="ring-track" stroke-width="4" />
            {#if !bucket.future && (bucket.activityDays ?? 0) > 0}
              <circle
                cx="23"
                cy="23"
                r={ringR}
                fill="none"
                class="ring-fill"
                class:ring-peak={bucket.peak}
                stroke-width="4"
                stroke-linecap="round"
                stroke-dasharray={ringCirc.toFixed(1)}
                stroke-dashoffset={dashOffset.toFixed(1)}
                transform="rotate(-90 23 23)"
              />
            {/if}
            <text x="23" y="27" text-anchor="middle" class="ring-num">
              {bucket.future ? '—' : (bucket.activityDays ?? 0)}
            </text>
          </svg>
          <span class="ring-label">{bucket.shortLabel}</span>
          <span class="ring-sub">{bucket.future ? '未到' : `${bucket.activityCount ?? 0} 次`}</span>
        </button>
      {/each}
    </div>
  </article>

  <article class="chapter-card" aria-labelledby="recap-pace-title">
    <div class="chapter-head">
      <div>
        <p class="chapter-num">03B · PACE PROFILE</p>
        <h2 id="recap-pace-title">均配速走势</h2>
      </div>
      <span class="chip chip-accent">{paceChip}</span>
    </div>

    <div class="pace-stage" data-testid="recap-pace-chart">
      {#if paceChart.paced.length >= 2}
        <svg
          class="pace-svg"
          viewBox={`0 0 ${paceW} ${paceH}`}
          role="img"
          aria-label={`各时段加权平均配速走势图，${paceChip}`}
        >
          <line x1={padL} y1={padT} x2={paceW - padR} y2={padT} class="guide-line" />
          {#if paceChart.yAvg !== null}
            <line x1={padL} y1={paceChart.yAvg} x2={paceW - padR} y2={paceChart.yAvg} class="avg-line" />
            <text x={padL - 8} y={paceChart.yAvg + 4} text-anchor="end" class="avg-label">均 {avgPaceShort}</text>
          {/if}
          <line x1={padL} y1={padT + plotH} x2={paceW - padR} y2={padT + plotH} class="guide-line" />

          <text x={padL - 8} y={padT + 4} text-anchor="end" class="axis-text">
            {formatPace(paceChart.minP).replace(/ \/km$/, '')}
          </text>
          <text x={padL - 8} y={padT + plotH + 4} text-anchor="end" class="axis-text">
            {formatPace(paceChart.maxP).replace(/ \/km$/, '')}
          </text>

          {#key `${recap.period}-${recap.year}-${recap.month ?? ''}-${recap.derived.fastestPace}`}
            <path class="pace-path" d={paceChart.pathD} fill="none" />
          {/key}

          {#each paceChart.points as pt (pt.bucket.start)}
            {@const hideCompact =
              recap.buckets.length >= 10 &&
              !pt.bucket.fastest &&
              pt.index !== 0 &&
              pt.index !== recap.buckets.length - 1 &&
              pt.index % 2 === 1}
            {#if pt.y !== null}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={pt.bucket.fastest ? 6 : 3.8}
                class="pace-dot"
                class:pace-dot-fast={pt.bucket.fastest}
              />
              {#if pt.bucket.fastest && pt.bucket.avgPaceSeconds !== null}
                <text x={pt.x} y={pt.y - 11} text-anchor="middle" class="pace-fast-label">
                  {formatPace(pt.bucket.avgPaceSeconds).replace(/ \/km$/, '')}
                </text>
              {/if}
            {/if}
            <text
              x={pt.x}
              y={paceH - 10}
              text-anchor="middle"
              class="axis-text"
              class:axis-fast={pt.bucket.fastest}
              class:axis-compact-hide={hideCompact}
            >
              {pt.bucket.shortLabel}
            </text>
          {/each}
        </svg>
        <p class="footnote">纵轴越靠上代表该时段加权平均配速越快，均取自服务端聚合。</p>
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

<style>
  .spread {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6);
    margin-top: var(--space-6);
  }
  .chapter-card {
    min-width: 0;
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
  }
  .chapter-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
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
  .chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--muted);
    color: var(--foreground);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  .chip-accent {
    background: var(--primary-soft);
    color: var(--primary);
  }
  .ring-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .ring-grid-month {
    grid-template-columns: repeat(auto-fit, minmax(5.2rem, 1fr));
  }
  .ring-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-1);
    border-radius: var(--radius-control);
    border: 1px solid transparent;
    background: var(--background);
    color: var(--foreground);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition:
      border-color var(--transition-control),
      background-color var(--transition-control);
  }
  .ring-cell:hover {
    border-color: var(--control-hover-border);
  }
  .ring-cell.is-selected {
    border-color: var(--primary);
    background: var(--primary-soft);
  }
  .ring-cell.is-future {
    opacity: 0.45;
  }
  .ring-track {
    stroke: var(--border);
  }
  .ring-fill {
    stroke: var(--primary);
  }
  .ring-peak {
    stroke: var(--recap-gold);
  }
  .ring-num {
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    fill: var(--foreground);
  }
  .ring-label {
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .ring-sub {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .pace-stage {
    min-width: 0;
  }
  .pace-svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    font-variant-numeric: tabular-nums;
  }
  .guide-line {
    stroke: var(--border);
    stroke-width: 1;
  }
  .avg-line {
    stroke: var(--primary);
    stroke-opacity: 0.48;
    stroke-dasharray: 4 4;
  }
  .avg-label {
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    fill: var(--primary);
  }
  .axis-text {
    font-size: var(--text-caption);
    fill: var(--muted-foreground);
  }
  .axis-fast {
    font-weight: var(--weight-bold);
    fill: var(--foreground);
  }
  .pace-path {
    stroke: var(--primary);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 1400;
    stroke-dashoffset: 1400;
    animation: pace-draw 780ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  }
  .pace-dot {
    fill: var(--primary);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .pace-dot-fast {
    fill: var(--recap-gold);
  }
  .pace-fast-label {
    font-size: var(--text-caption);
    font-weight: var(--weight-bold);
    fill: var(--foreground);
  }
  .pace-single {
    padding: var(--space-4);
    border-radius: var(--radius-control);
    background: var(--background);
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
  @media (max-width: 959px) {
    .spread {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 639px) {
    .chapter-card {
      padding: var(--space-4);
    }
    .ring-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 479px) {
    .axis-compact-hide {
      visibility: hidden;
    }
  }
  @media (forced-colors: active) {
    .ring-fill,
    .pace-path,
    .pace-dot {
      stroke: Highlight;
      fill: Highlight;
    }
    .ring-peak,
    .pace-dot-fast {
      stroke: LinkText;
      fill: LinkText;
    }
  }
</style>
