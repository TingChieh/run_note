<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { ActivityError, readActivities, type ActivityList } from '#lib/api/activities.ts';
  import FeedbackState from './FeedbackState.svelte';
  import WallCard from './WallCard.svelte';
  let { preview = false }: { preview?: boolean } = $props();
  let records = $state<ActivityList | null>(null), loading = $state(true), error = $state('');
  let active=false, token=0;
  async function load(offset=0) {
    const request=++token;loading=true;error='';records=null;
    if(!preview){const url=new URL(window.location.href);if(offset)url.searchParams.set('offset',String(offset));else url.searchParams.delete('offset');replaceState(url,page.state);}
    try {
      const result=await readActivities(fetch,offset);
      if(!active || request!==token)return;
      if(!preview && offset>0 && offset>=result.total){await load(result.total>0?Math.floor((result.total-1)/20)*20:0);return;}
      records=result;
    }
    catch(cause){if(active && request===token){if(cause instanceof ActivityError && cause.status===401){records=null;window.location.replace('/login?reason=expired&next=%2Factivities%2Fwall');return;}error=cause instanceof Error?cause.message:'无法读取足迹墙';}}
    finally{if(active && request===token)loading=false;}
  }
  onMount(()=>{active=true;const raw=page.url.searchParams.get('offset')??'';const offset=!preview && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))?Math.floor(Number(raw)/20)*20:0;void load(offset);return()=>{active=false;++token;};});
</script>
<section class:wall-preview={preview} aria-label={preview?'近期足迹墙':'我的足迹墙'} aria-busy={loading}>
  {#if preview}<div class="wall-heading"><div><p class="wall-eyebrow">每次出发，留下一张足迹</p><h2>足迹墙</h2></div><a href="/activities/wall" data-sveltekit-reload class="button-secondary">查看全部足迹</a></div>{/if}
  {#if loading}<FeedbackState kind="loading" title="正在读取足迹墙…" />{:else if error}<FeedbackState kind="error" title={error}><button class="button-secondary" onclick={()=>void load()}>重试足迹墙</button></FeedbackState>{:else if records}
    {#if records.items.length}<ul class="wall-grid">{#each (preview?records.items.slice(0,6):records.items) as activity (activity.id)}<li><WallCard {activity} /></li>{/each}</ul>
    {:else}<FeedbackState title="足迹墙还没有记录"><p>每一条新的跑步记录都会自动成为一张足迹卡片。</p><a href="/activities" data-sveltekit-reload class="button-secondary">查看跑步记录</a></FeedbackState>{/if}
    {#if !preview && records.total>20}<div class="wall-pagination"><button class="button-secondary" disabled={records.offset===0} onclick={()=>void load(Math.max(0,records!.offset-20))}>上一页</button><span>第 {Math.floor(records.offset/20)+1} / {Math.ceil(records.total/20)} 页 · {records.total} 次跑步</span><button class="button-secondary" disabled={records.offset+records.items.length>=records.total} onclick={()=>void load(records!.offset+20)}>下一页</button></div>{/if}
  {/if}
</section>
<style>
  section{min-width:0;}.wall-preview{padding:1.5rem;border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);}.wall-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem;}.wall-heading h2{font-size:1.25rem;font-weight:700;}.wall-eyebrow{font-size:.75rem;color:var(--muted-foreground);margin-bottom:.25rem;}.wall-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;}.wall-grid li{min-width:0;}.wall-pagination{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.75rem;margin-top:1.5rem;font-size:.8rem;color:var(--muted-foreground);}
  @media(max-width:767px){.wall-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.wall-preview{padding:1rem;}}
  @media(max-width:479px){.wall-grid{grid-template-columns:1fr;}}
</style>
