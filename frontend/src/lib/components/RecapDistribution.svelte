<script lang="ts">
  import { km, recapPeak, type Recap } from '#lib/recap.ts';

  let { recap }: { recap: Recap } = $props();
  const peak = $derived(recapPeak(recap));
  const ticks = $derived.by(() => {
    const roughStep = recap.max / 4000;
    if (roughStep < 0.01) return [0.04, 0.03, 0.02, 0.01, 0];
    const order = 10 ** Math.floor(Math.log10(roughStep));
    const step = ([1, 2, 2.5, 5, 10].find((value) => value * order >= roughStep) ?? 10) * order;
    return [4, 3, 2, 1, 0].map((value) => value * step);
  });
  const labels = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, notation: 'compact' });
</script>

<p class="chart-note">
  {recap.period === 'year' ? '按月统计' : '按周统计 · 周一开始'}{#if peak}
    · {peak}{/if}
</p>
<div class="chart" aria-hidden="true">
  <p class="unit">km</p>
  <div class="ticks">
    {#each ticks as tick (tick)}<span>{labels.format(tick)}</span>{/each}
  </div>
  <div class="plot" style:grid-template-columns={`repeat(${recap.buckets.length}, minmax(0, 1fr))`}>
    {#each recap.buckets as bucket (bucket.start)}
      <div
        class="slot"
        title={`${bucket.start} 至 ${bucket.last}：${bucket.distance === null ? '未到' : `${km(bucket.distance)} km`}`}
      >
        {#if bucket.distance !== null && bucket.distance > 0}
          <div class="bar" class:peak={bucket.peak} style:height={`${bucket.distance / (ticks[0] * 10)}%`}></div>
        {/if}
      </div>
    {/each}
    {#each recap.buckets as bucket (bucket.start)}
      <span class="label">{bucket.label}</span>
    {/each}
  </div>
</div>

<details>
  <summary>查看完整数据表</summary>
  <table>
    <caption class="sr-only">{recap.title}里程分布</caption>
    <thead><tr><th scope="col">周期</th><th scope="col">日期范围</th><th scope="col">里程（km）</th></tr></thead>
    <tbody>
      {#each recap.buckets as bucket (bucket.start)}
        <tr>
          <th scope="row"
            >{bucket.label}{#if bucket.peak}<span class="sr-only">，峰值</span>{/if}</th
          >
          <td
            ><time datetime={bucket.start}>{bucket.start}</time> 至
            <time datetime={bucket.last}>{bucket.last}</time></td
          >
          <td>{bucket.distance === null ? '未到' : km(bucket.distance)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</details>

<style>
  .chart-note,
  .chart,
  table {
    font-size: var(--text-small);
  }
  .chart-note,
  .chart {
    color: var(--muted-foreground);
  }
  .chart {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-1) var(--space-2);
    margin: var(--space-4) 0;
  }
  .unit {
    grid-column: 1 / -1;
  }
  .ticks {
    height: calc(11rem + 1em);
    margin-block-start: -0.5em;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    text-align: right;
    line-height: var(--line-height-solid);
  }
  .plot {
    display: grid;
    grid-template-rows: 11rem auto;
    row-gap: var(--space-2);
    background: repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 25%) top / 100% 11rem
      no-repeat;
  }
  .slot {
    display: flex;
    align-items: end;
    justify-content: center;
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  .bar {
    width: 62%;
    max-width: 3rem;
    min-height: 1px;
    background: color-mix(in srgb, var(--primary) 65%, var(--surface));
    border-radius: var(--radius-control) var(--radius-control) 0 0;
  }
  .bar.peak {
    background: var(--primary);
  }
  .label {
    text-align: center;
    white-space: nowrap;
    font-size: var(--text-caption);
  }
  details {
    border-top: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
    padding-block: var(--space-3);
    min-height: 2.75rem;
    font-size: var(--text-small);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: start;
    padding: var(--space-2) var(--space-1);
    border-bottom: 1px solid var(--border);
  }
  td:last-child,
  thead th:last-child {
    text-align: end;
    overflow-wrap: anywhere;
  }
  time {
    display: inline-block;
  }
  @media (max-width: 479px) {
    .plot:has(.slot:nth-child(12)) .label:nth-child(even):not(:last-child) {
      visibility: hidden;
    }
  }
  @media (forced-colors: active) {
    .bar {
      forced-color-adjust: none;
      background: GrayText;
    }
    .bar.peak {
      background: Highlight;
    }
  }
</style>
