<script lang="ts">
  import type { Activity } from '#lib/api/activities.ts';
  let { metrics }: { metrics: Partial<Activity> } = $props();
  const items = $derived([
    {label:'最高心率',value:metrics.max_heart_rate_bpm,unit:'bpm'},
    {label:'最低心率',value:metrics.min_heart_rate_bpm,unit:'bpm'},
    {label:'平均步频',value:metrics.avg_cadence_spm,unit:'步/分钟'},
    {label:'最大步频',value:metrics.max_cadence_spm,unit:'步/分钟'},
    {label:'最大摄氧量',value:metrics.vo2_max_ml_kg_min,unit:'ml/kg/min',note:'设备估计'},
    {label:'训练负荷',value:metrics.training_load,unit:'',note:'小米评分'},
    {label:'有氧训练效果',value:metrics.aerobic_training_effect,unit:'',note:'小米评分（0–5）'},
    {label:'无氧训练效果',value:metrics.anaerobic_training_effect,unit:'',note:'小米评分（0–5）'}
  ].filter(item=>item.value!==undefined&&item.value!==null));
</script>
{#if items.length}
  <section class="device-metrics" aria-label="设备指标">
    <h3>设备指标</h3>
    <dl>{#each items as item}<div><dt>{item.label}</dt><dd>{item.value} <span>{item.unit}</span></dd>{#if item.note}<p>{item.note}</p>{/if}</div>{/each}</dl>
  </section>
{/if}
<style>
  .device-metrics{margin-top:var(--space-4);min-width:0;}h3{font-size:.875rem;font-weight:600;}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,8rem),1fr));gap:var(--space-3);margin-top:var(--space-3);}dt,p,dd span{color:var(--muted-foreground);font-size:.75rem;}dd{font-variant-numeric:tabular-nums;font-weight:600;overflow-wrap:anywhere;}p{margin-top:var(--space-1);}
</style>
