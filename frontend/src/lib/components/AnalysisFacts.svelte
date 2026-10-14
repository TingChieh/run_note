<script lang="ts">
  import type { Snapshot } from '#lib/api/ai.ts';
  import { formatPace } from '#lib/api/activities.ts';
  import { dashboardDistance } from '#lib/api/dashboard-format.ts';
  let { facts }: { facts: Snapshot } = $props();
</script>
<section aria-label="后端统计依据" class="aux-panel">
  <h2 class="text-xl font-semibold">运动统计依据</h2>
  <p class="mt-2 text-sm text-muted-foreground">{facts.date_from} 至 {facts.date_to}（结束日期不包含在内）。按活动本地日期归属，完整自然周从周一开始。</p>
  {#if facts.evidence_limited}<p role="note" class="mt-3 rounded bg-amber-50 p-3 text-amber-900">分析依据有限：活动较少或覆盖周数不足，无法判断长期运动表现。</p>{/if}
  <dl class="my-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div><dt class="text-sm text-muted-foreground">总跑量</dt><dd class="text-2xl font-semibold">{dashboardDistance(facts.summary.distance_m)}</dd></div>
    <div><dt class="text-sm text-muted-foreground">运动次数</dt><dd class="text-2xl font-semibold">{facts.summary.activity_count} 次</dd></div>
    <div><dt class="text-sm text-muted-foreground">平均每周频率</dt><dd class="text-2xl font-semibold">{Number(facts.average_runs_per_week).toFixed(1)} 次/周</dd></div>
    <div><dt class="text-sm text-muted-foreground">平均配速</dt><dd class="text-2xl font-semibold">{formatPace(facts.summary.avg_pace_seconds_per_km)}</dd></div>
  </dl>
  <details><summary class="text-sm font-medium">每周明细与统计口径</summary>
  <div class="mt-4 overflow-x-auto">
    <table class="w-full min-w-[520px] text-left text-sm">
      <caption class="sr-only">每周跑量、频率、平均配速及跑量变化率</caption>
      <thead><tr class="border-b"><th class="py-2">周开始</th><th>跑量</th><th>次数 / 天数</th><th>平均配速</th><th>跑量变化</th></tr></thead>
      <tbody>{#each facts.weeks as w}<tr class="border-b border-border"><td class="py-3">{w.bucket_start}</td><td>{dashboardDistance(w.distance_m)}</td><td>{w.activity_count} / {w.activity_days}</td><td>{formatPace(w.avg_pace_seconds_per_km)}</td><td>{w.distance_change_pct === null ? '无法比较' : `${Number(w.distance_change_pct) > 0 ? '+' : ''}${Number(w.distance_change_pct).toFixed(2)}%`}</td></tr>{/each}</tbody>
    </table>
  </div>
  <p class="mt-3 text-sm text-muted-foreground">配速采用可靠耗时与对应距离的加权结果；{facts.summary.pace_eligible_count} 条记录可计算配速，{facts.summary.missing_duration_count} 条缺耗时，{facts.summary.quality_warning_count} 条有质量警告。前周跑量为零时不计算变化率。</p>
  <ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{#each facts.limitations as note}<li>{note}</li>{/each}</ul>
  </details>
</section>
