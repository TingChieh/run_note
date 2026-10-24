<script lang="ts">
  import type { Snapshot } from '#lib/api/ai.ts';
  import { formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  const hr = (value: string | number | null) => value === null ? '暂无数据' : `${Number(value).toFixed(1)} bpm`;
  let { facts }: { facts: Snapshot } = $props();
</script>
<section aria-label="后端统计依据" class="aux-panel">
  <h2 class="text-xl font-semibold">运动统计依据</h2>
  <p class="mt-2 text-sm text-muted-foreground">{facts.date_from} 至 {facts.date_to}（结束日期不包含在内）。按活动本地日期归属，完整自然周从周一开始。</p>
  {#if facts.evidence_limited}<p role="note" class="mt-3 rounded bg-warning-soft p-3 text-warning">分析依据有限：活动较少或覆盖周数不足，无法判断长期运动表现。</p>{/if}
  <dl class="facts-metrics my-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div><dt class="text-sm text-muted-foreground">总跑量</dt><dd class="text-2xl font-bold">{dashboardDistance(facts.summary.distance_m)}</dd></div>
    <div><dt class="text-sm text-muted-foreground">运动次数</dt><dd class="text-2xl font-bold">{facts.summary.activity_count} 次</dd></div>
    <div><dt class="text-sm text-muted-foreground">平均每周频率</dt><dd class="text-2xl font-bold">{Number(facts.average_runs_per_week).toFixed(1)} 次/周</dd></div>
    <div><dt class="text-sm text-muted-foreground">平均配速</dt><dd class="text-2xl font-bold">{formatPace(facts.summary.avg_pace_seconds_per_km)}</dd></div>
  </dl>
  {#if facts.schema_version === 'running-summary-v2' && facts.device_metrics}
    {@const d = facts.device_metrics}
    <dl aria-label="设备指标" class="facts-metrics my-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div><dt class="text-sm text-muted-foreground">平均心率（用时加权估计）</dt><dd class="text-2xl font-bold">{hr(d.avg_heart_rate_bpm)}</dd><p class="mt-2 text-sm text-muted-foreground">心率覆盖 {d.heart_rate_record_count} / {facts.summary.activity_count} 条；参与加权 {d.heart_rate_weighted_count} 条</p></div>
      <div><dt class="text-sm text-muted-foreground">热量（已知记录小计）</dt><dd class="text-2xl font-bold">{d.calories_kcal === null ? '暂无数据' : `${d.calories_kcal} kcal`}</dd><p class="mt-2 text-sm text-muted-foreground">覆盖 {d.calories_record_count} / {facts.summary.activity_count} 条</p></div>
      <div><dt class="text-sm text-muted-foreground">步数（已知记录小计）</dt><dd class="text-2xl font-bold">{d.steps === null ? '暂无数据' : `${d.steps} 步`}</dd><p class="mt-2 text-sm text-muted-foreground">覆盖 {d.steps_record_count} / {facts.summary.activity_count} 条</p></div>
    </dl>
    <p class="text-sm text-muted-foreground">心率按有效用时加权平均，非逐点重算；缺心率或正用时的记录不参与。热量与步数仅为已知记录小计，不代表完整总量；设备热量并非精确能量消耗，步数不能用于推断跑步步频。</p>
  {:else}
    <p role="note" class="my-4 text-sm text-muted-foreground">此旧版快照未含设备指标；历史报告保持原样，可手动生成新版报告。</p>
  {/if}
  <details><summary class="text-sm font-medium">每周明细与统计口径</summary>
  <div class="mt-4 overflow-x-auto">
    <table class="w-full min-w-[520px] text-left text-sm">
      <caption class="sr-only">每周跑量、频率、平均配速及跑量变化率</caption>
      <thead><tr class="border-b"><th class="py-2">周开始</th><th>跑量</th><th>次数 / 天数</th><th>平均配速</th><th>跑量变化</th></tr></thead>
      <tbody>{#each facts.weeks as w}<tr class="border-b border-border"><td class="py-3">{w.bucket_start}</td><td>{dashboardDistance(w.distance_m)}</td><td>{w.activity_count} / {w.activity_days}</td><td>{formatPace(w.avg_pace_seconds_per_km)}</td><td>{w.distance_change_pct === null ? '无法比较' : `${Number(w.distance_change_pct) > 0 ? '+' : ''}${Number(w.distance_change_pct).toFixed(2)}%`}</td></tr>{/each}</tbody>
    </table>
  </div>
  {#if facts.schema_version === 'running-summary-v2'}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs keyboard access.) -->
    <div class="mt-4 overflow-x-auto" tabindex="0" role="region" aria-label="每周设备指标，可横向滚动">
      <table class="w-full min-w-[650px] text-left text-sm">
        <caption class="py-2 text-left font-medium">每周设备指标（覆盖数 / 当周活动数）</caption>
        <thead><tr class="border-b"><th class="py-2">周开始</th><th>心率（用时加权估计）</th><th>热量（已知记录小计）</th><th>步数（已知记录小计）</th></tr></thead>
        <tbody>{#each facts.weeks as w}{#if w.device_metrics}{@const d = w.device_metrics}<tr class="border-b border-border"><td class="py-3">{w.bucket_start}</td><td>{hr(d.avg_heart_rate_bpm)}<br />心率 {d.heart_rate_record_count} / {w.activity_count} 条；加权 {d.heart_rate_weighted_count} 条</td><td>{d.calories_kcal === null ? '暂无数据' : `${d.calories_kcal} kcal`}<br />覆盖 {d.calories_record_count} / {w.activity_count} 条</td><td>{d.steps === null ? '暂无数据' : `${d.steps} 步`}<br />覆盖 {d.steps_record_count} / {w.activity_count} 条</td></tr>{/if}{/each}</tbody>
      </table>
    </div>
  {/if}
  <p class="mt-3 text-sm text-muted-foreground">配速采用可靠耗时与对应距离的加权结果；{facts.summary.pace_eligible_count} 条记录可计算配速，{facts.summary.missing_duration_count} 条缺耗时，{facts.summary.quality_warning_count} 条有质量警告。前周跑量为零时不计算变化率。</p>
  <ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{#each facts.limitations as note}<li>{note}</li>{/each}</ul>
  </details>
</section>

<style>
  .facts-metrics > div { min-width:0; padding:1rem; border-radius:1rem; background:var(--background); }
  .facts-metrics dt { display:flex; align-items:center; gap:.5rem; }
  .facts-metrics dt::before { content:''; display:block; flex-shrink:0; width:.75rem; height:.75rem; border-radius:50%; background:var(--sport-green); }
  .facts-metrics > div:nth-child(2) dt::before { background:var(--sport-blue); }
  .facts-metrics > div:nth-child(3) dt::before { background:var(--sport-yellow); }
  .facts-metrics > div:nth-child(4) dt::before { background:var(--sport-coral); }
  .facts-metrics dd { margin-top:.75rem; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
</style>
