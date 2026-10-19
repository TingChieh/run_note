<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import {onMount} from 'svelte';
  import {ActivityError,formatDate,formatDistance,formatDuration,formatStartTime} from '#lib/api/activities.ts';
  import {matchTrackFiles,readPreparedFile,previewMifitness,saveMifitness,mifitnessWarningLabel,type PreparedRecord,type MifitnessPreview} from '#lib/api/mifitness.ts';
  import DeviceMetrics from './DeviceMetrics.svelte';
  let {disabled=false,onimported,onauthrequired,onbusy}: {disabled?:boolean;onimported?:()=>void;onauthrequired?:(cause:ActivityError)=>void;onbusy?:(busy:boolean)=>void}=$props();
  type Entry = {item:PreparedRecord;preview?:MifitnessPreview;status:'pending'|'ready'|'success'|'duplicate'|'failed'|'similar';message:string;existingId?:string;retrySave?:boolean;confirmed?:boolean;enrich?:boolean};
  let entries=$state<Entry[]>([]),timezone=$state(''),message=$state(''),busy=$state(false),mounted=$state(false);
  let summaryInput:HTMLInputElement,tracksInput:HTMLInputElement,disposed=false,requestToken=0;
  let summaryName=$state(''),trackNames=$state<string[]>([]),dragging=$state<''|'summary'|'tracks'>('');
  function picked(){summaryName=summaryInput?.files?.[0]?.name??'';trackNames=Array.from(tracksInput?.files??[],file=>file.name);reset();}
  function drop(event:DragEvent,input:HTMLInputElement,kind:'summary'|'tracks'){event.preventDefault();dragging='';const files=event.dataTransfer?.files;if(busy||disabled||!mounted||!files?.length)return;input.files=kind==='summary'?(()=>{const t=new DataTransfer();t.items.add(files[0]);return t.files;})():files;picked();}
  const tracksLabel=$derived(trackNames.length>1?`${trackNames.length} 个 GPX 文件`:trackNames[0]??'');
  const ready=$derived(entries.some(entry=>entry.status==='ready'));
  const failed=$derived(entries.some(entry=>entry.status==='failed'));
  function setBusy(value:boolean){busy=value;onbusy?.(value);}
  function reset(){requestToken++;entries=[];message='';}
  function current(token:number){return !disposed&&token===requestToken;}
  function handleError(cause:unknown,entry?:Entry){
    if(cause instanceof ActivityError&&cause.status===401){
      reset();if(summaryInput)summaryInput.value='';if(tracksInput)tracksInput.value='';summaryName='';trackNames=[];timezone='';
      if(onauthrequired)onauthrequired(cause);else window.location.replace('/admin?reason=expired&next=%2Factivities');return;
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
  <div class="head"><h2 id="mifitness-title">Mi Fitness 跑步导入</h2><span class="intro">汇总 JSON 加匹配的 GPX，预览确认后再导入</span></div>
  <div class="file-fields">
    <label class="file-pick" data-filled={summaryName?'true':'false'} data-dragging={dragging==='summary'} ondragover={event=>{event.preventDefault();if(!busy&&!disabled&&mounted)dragging='summary';}} ondragleave={()=>{dragging='';}} ondrop={event=>drop(event,summaryInput,'summary')}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/></svg>
      <input bind:this={summaryInput} class="sr-only" type="file" accept=".json,application/json" disabled={busy||disabled||!mounted} onchange={picked}/>
      <span class="file-pick-text"><span class="file-pick-title">{summaryName||'跑步汇总 JSON'}</span><span class="file-pick-hint">running_summaries.json · 最大 2 MiB、1000 条</span></span>
    </label>
    <label class="file-pick" data-filled={trackNames.length?'true':'false'} data-dragging={dragging==='tracks'} ondragover={event=>{event.preventDefault();if(!busy&&!disabled&&mounted)dragging='tracks';}} ondragleave={()=>{dragging='';}} ondrop={event=>drop(event,tracksInput,'tracks')}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19c3-1 3-5 6-5s3 4 6 3M6 7a2 2 0 1 0 0 .01M18 5a2 2 0 1 0 0 .01M8 7l8-2"/></svg>
      <input bind:this={tracksInput} class="sr-only" type="file" accept=".gpx,application/gpx+xml" multiple disabled={busy||disabled||!mounted} onchange={picked}/>
      <span class="file-pick-text"><span class="file-pick-title">{tracksLabel||'匹配的 GPX 文件'}</span><span class="file-pick-hint">可多选 · 每个最大 10 MiB · 按 running_来源时间.gpx 匹配</span></span>
    </label>
    <label class="file-pick tz" data-filled={timezone?'true':'false'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <span class="file-pick-text"><span class="file-pick-hint">Mi Fitness 时区（可选）</span><input bind:value={timezone} oninput={reset} placeholder="例如 Asia/Shanghai，留空用账户时区" disabled={busy||disabled||!mounted}/></span>
    </label>
  </div>
  <div class="actions"><button class="button-secondary" disabled={busy||disabled||!mounted||!summaryName} onclick={()=>void previewAll()}>预览所选记录</button>{#if ready}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveBatch()}>导入预览成功的记录</button>{/if}{#if failed}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveBatch(true)}>仅重试失败记录</button>{/if}</div>
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
          {#if entry.existingId}<a href={view.href(`/activities/${entry.existingId}`)} class="text-primary underline">{entry.status==='success'?'查看已导入活动':'查看已有活动'}</a>{/if}
          {#if entry.status==='duplicate'&&entry.existingId}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveSingle(entry,true)}>仅补充已有记录缺失指标</button>{/if}
          {#if entry.status==='similar'}<button class="button-secondary" disabled={busy||disabled} onclick={()=>void saveSingle(entry)}>仍要导入此条记录</button>{/if}
        </div>
      </li>
    {/each}</ol>
  {/if}
</section>
<style>
  .mifitness-import{margin-top:var(--space-4);padding:var(--space-4) var(--space-6);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);min-width:0;}
  .head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--space-1) var(--space-4);margin-bottom:var(--space-3);}
  h2{font-size:1.0625rem;font-weight:600;}h3{font-weight:600;overflow-wrap:anywhere;}
  .intro{font-size:.8125rem;color:var(--muted-foreground);line-height:1.6;}
  .file-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));align-items:stretch;gap:var(--space-3);}
  .tz{border-style:solid;cursor:text;}
  .tz input{width:100%;min-width:0;padding:0;border:0;background:transparent;font-size:var(--text-small);font-weight:600;}
  .tz input:focus-visible{outline:none;}
  .actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);margin-top:var(--space-3);}
  button{white-space:normal;}
  ol{display:grid;gap:var(--space-4);margin-top:var(--space-4);}ol>li{border-top:1px solid var(--border);padding-top:var(--space-4);min-width:0;}
  dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,7rem),1fr));gap:var(--space-3);margin-top:var(--space-3);}dt{font-size:.75rem;color:var(--muted-foreground);}dd{font-weight:600;}
  .state{font-size:.875rem;color:var(--muted-foreground);margin-top:var(--space-2);}
  .warnings{margin-top:var(--space-3);padding:var(--space-3);color:var(--warning);background:var(--warning-soft);border-radius:var(--radius-control);font-size:.875rem;}
  .error{color:var(--error);overflow-wrap:anywhere;}
  @media(max-width:639px){.mifitness-import{padding:var(--space-3) var(--space-4);}}
</style>
