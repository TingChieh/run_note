<script lang="ts">
  import {onMount} from 'svelte';
  import {ActivityError,formatDate,formatDistance,formatDuration,formatStartTime} from '#lib/api/activities.ts';
  import {matchTrackFiles,readPreparedFile,previewMifitness,saveMifitness,mifitnessWarningLabel,type PreparedRecord,type MifitnessPreview} from '#lib/api/mifitness.ts';
  import DeviceMetrics from './DeviceMetrics.svelte';
  let {disabled=false,onimported,onauthrequired,onbusy}: {disabled?:boolean;onimported?:()=>void;onauthrequired?:(cause:ActivityError)=>void;onbusy?:(busy:boolean)=>void}=$props();
  type Entry = {item:PreparedRecord;preview?:MifitnessPreview;status:'pending'|'ready'|'success'|'duplicate'|'failed'|'similar';message:string;existingId?:string;retrySave?:boolean;confirmed?:boolean;enrich?:boolean};
  let entries=$state<Entry[]>([]),timezone=$state(''),message=$state(''),busy=$state(false),mounted=$state(false);
  let summaryInput:HTMLInputElement,tracksInput:HTMLInputElement,disposed=false,requestToken=0;
  const ready=$derived(entries.some(entry=>entry.status==='ready'));
  const failed=$derived(entries.some(entry=>entry.status==='failed'));
  function setBusy(value:boolean){busy=value;onbusy?.(value);}
  function reset(){requestToken++;entries=[];message='';}
  function current(token:number){return !disposed&&token===requestToken;}
  function handleError(cause:unknown,entry?:Entry){
    if(cause instanceof ActivityError&&cause.status===401){
      reset();if(summaryInput)summaryInput.value='';if(tracksInput)tracksInput.value='';timezone='';
      if(onauthrequired)onauthrequired(cause);else window.location.replace('/login?reason=expired&next=%2Factivities');return;
    }
    const text=cause instanceof Error?cause.message:'导入失败，请重试';
    if(!entry){message=text;return;}
    entry.message=text;
    if(cause instanceof ActivityError&&cause.existingActivityId){entry.existingId=cause.existingActivityId;entry.status=cause.code==='MIFITNESS_SIMILAR'?'similar':'duplicate';}
    else entry.status='failed';
  }
  async function previewAll(){
    if(busy||disabled||!mounted)return;reset();const token=requestToken;setBusy(true);
    try{
      const file=summaryInput.files?.[0];if(!file)throw new Error('请选择跑步汇总 JSON 文件');
      const records=await readPreparedFile(file);if(!current(token))return;
      const items=matchTrackFiles(records,Array.from(tracksInput.files??[]));
      entries=items.map(item=>({item,status:'pending',message:''}));
      for(const entry of entries){
        if(!current(token))return;
        try{const value=await previewMifitness(entry.item,timezone);if(!current(token))return;entry.preview=value;entry.status=value.suspected_activity_ids.length?'similar':'ready';entry.message='';}
        catch(cause){if(!current(token))return;handleError(cause,entry);if(!current(token))return;}
      }
    }catch(cause){if(current(token))handleError(cause);}
    finally{if(!disposed)setBusy(false);}
  }
  async function saveEntry(entry:Entry,token:number,enrich=false){
    try{
      const value=await saveMifitness(entry.item,timezone,{confirmSimilar:entry.confirmed,enrichActivityId:enrich?entry.existingId:undefined});
      if(!current(token))return;entry.status='success';entry.existingId=value.activity.id;entry.message=value.warnings.map(mifitnessWarningLabel).join('；');
    }catch(cause){if(current(token)){entry.retrySave=true;handleError(cause,entry);}}
  }
  async function saveBatch(retry=false){
    if(busy||disabled||!mounted)return;const token=requestToken;setBusy(true);
    const selected=entries.filter(entry=>retry?entry.status==='failed':entry.status==='ready');
    try{for(const entry of selected){if(!current(token))return;
      if(retry&&!entry.retrySave){try{const value=await previewMifitness(entry.item,timezone);if(!current(token))return;entry.preview=value;entry.status=value.suspected_activity_ids.length?'similar':'ready';entry.message='';}catch(cause){if(current(token))handleError(cause,entry);}continue;}
      await saveEntry(entry,token,entry.enrich);
    }if(current(token)&&selected.some(entry=>entry.status==='success'))onimported?.();}
    finally{if(!disposed)setBusy(false);}
  }
  async function saveSingle(entry:Entry,enrich=false){
    if(busy||disabled||!mounted)return;
    if(!enrich)entry.confirmed=true;
    entry.enrich=enrich;
    const token=requestToken;setBusy(true);
    try{await saveEntry(entry,token,enrich);if(current(token)&&entry.status==='success')onimported?.();}
    finally{if(!disposed)setBusy(false);}
  }
  onMount(()=>{mounted=true;return()=>{disposed=true;requestToken++;onbusy?.(false);};});
</script>
<section class="mifitness-import" aria-labelledby="mifitness-title" aria-busy={busy}>
  <h2 id="mifitness-title">Mi Fitness 跑步导入</h2>
  <p class="intro">选择本机整理的跑步汇总与 GPX，预览后再导入。新记录仅自己可见。</p>
  <div class="file-fields">
    <label>跑步汇总 JSON<input bind:this={summaryInput} type="file" accept=".json,application/json" disabled={busy||disabled||!mounted} onchange={reset}/><span>running_summaries.json，最大 2 MiB、1000 条</span></label>
    <label>匹配的 GPX 文件<input bind:this={tracksInput} type="file" accept=".gpx,application/gpx+xml" multiple disabled={busy||disabled||!mounted} onchange={reset}/><span>每个最大 10 MiB；按 running_来源时间.gpx 精确匹配</span></label>
    <label>Mi Fitness 时区（可选）<input bind:value={timezone} oninput={reset} placeholder="例如：Asia/Shanghai" disabled={busy||disabled||!mounted}/><span>留空使用账户时区。设备绝对时间保持原义，不猜测导出的时区编号。</span></label>
  </div>
  <div class="actions"><button class="button-secondary" disabled={busy||disabled||!mounted} onclick={()=>void previewAll()}>预览所选记录</button>{#if ready}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveBatch()}>导入预览成功的记录</button>{/if}{#if failed}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveBatch(true)}>仅重试失败记录</button>{/if}</div>
  {#if busy}<p role="status" class="intro">正在逐条处理，请勿重复提交或关闭页面…</p>{/if}
  {#if message}<p role="alert" class="error">{message}</p>{/if}
  {#if entries.length}
    <p class="intro" aria-live="polite">共 {entries.length} 条 · 成功 {entries.filter(entry=>entry.status==='success').length} · 重复 {entries.filter(entry=>entry.status==='duplicate').length} · 失败 {entries.filter(entry=>entry.status==='failed').length} · 仅汇总 {entries.filter(entry=>!entry.item.file).length}</p>
    <ol>{#each entries as entry (entry.item.record.source_time)}
      <li><h3>{entry.preview?formatDate(entry.preview.activity_date):`来源时间 ${entry.item.record.source_time}`}</h3>
        <p class="state" aria-live="polite">{({pending:'待预览',ready:'预览成功',success:entry.item.file?'成功':'成功 · 仅汇总',duplicate:'重复',failed:'失败',similar:'疑似重复，请逐条确认'})[entry.status]}</p>
        {#if entry.preview}
          <dl class="overview"><div><dt>距离</dt><dd>{formatDistance(entry.preview.distance_m)}</dd></div><div><dt>设备用时</dt><dd>{formatDuration(entry.preview.timer_seconds??null)}</dd></div><div><dt>经过时间</dt><dd>{formatDuration(entry.preview.elapsed_seconds)}</dd></div><div><dt>轨迹</dt><dd>{entry.preview.has_route?`有轨迹 · ${entry.preview.point_count} 点`:'仅汇总（无轨迹）'}</dd></div></dl>
          <p class="intro">开始 {formatStartTime(entry.preview.started_at,entry.preview.timezone)} · 结束 {formatStartTime(entry.preview.ended_at,entry.preview.timezone)} · {entry.preview.timezone}</p>
          <DeviceMetrics metrics={entry.preview}/>
          {#if entry.preview.warnings.length}<ul class="warnings">{#each entry.preview.warnings as warning}<li>{mifitnessWarningLabel(warning)}</li>{/each}</ul>{/if}
        {/if}
        {#if entry.message}<p class:error={entry.status==='failed'}>{entry.message}</p>{/if}
        <div class="actions">
          {#if entry.existingId}<a href={`/activities/${entry.existingId}`} class="text-primary underline">{entry.status==='success'?'查看已导入活动':'查看已有活动'}</a>{/if}
          {#if entry.status==='duplicate'&&entry.existingId}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveSingle(entry,true)}>仅补充已有记录缺失指标</button>{/if}
          {#if entry.status==='similar'}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveSingle(entry)}>仍要导入此条记录</button>{/if}
        </div>
      </li>
    {/each}</ol>
  {/if}
</section>
<style>
  .mifitness-import{margin-top:var(--space-8);padding:var(--space-6);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);min-width:0;}h2{font-size:1.25rem;font-weight:600;}h3{font-weight:600;overflow-wrap:anywhere;}.intro,label span{font-size:.875rem;color:var(--muted-foreground);line-height:1.6;margin-top:var(--space-2);}.file-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:var(--space-4);margin-top:var(--space-4);}label{display:grid;min-width:0;align-content:start;font-size:.875rem;}input{width:100%;min-width:0;margin-top:var(--space-2);padding:var(--space-2);border:1px solid var(--border);border-radius:var(--radius-control);background:var(--background);}input[type=file]{font-size:.75rem;}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);margin-top:var(--space-4);}button{white-space:normal;}ol{display:grid;gap:var(--space-4);margin-top:var(--space-4);}ol>li{border-top:1px solid var(--border);padding-top:var(--space-4);min-width:0;}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,7rem),1fr));gap:var(--space-3);margin-top:var(--space-3);}dt{font-size:.75rem;color:var(--muted-foreground);}dd{font-weight:600;}.state{font-size:.875rem;color:var(--muted-foreground);margin-top:var(--space-2);}.warnings{margin-top:var(--space-3);padding:var(--space-3);color:var(--warning);background:var(--warning-soft);border-radius:var(--radius-control);font-size:.875rem;}.error{color:var(--error);overflow-wrap:anywhere;}@media(max-width:639px){.mifitness-import{padding:var(--space-4);}}
</style>
