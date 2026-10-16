<script lang="ts">
  import { onMount } from 'svelte';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import { page } from '$app/state';
  import { useViewContext } from '#lib/view-context.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { loadPoster, type PosterData } from '#lib/share/route-poster-data.ts';
  import { posterPalette, posterPeriod, renderPoster } from '#lib/share/route-poster-render.ts';

  const view = useViewContext();
  let dialog: HTMLDialogElement, trigger: HTMLButtonElement;
  let mounted = $state(false), visible = $state(false), busy = $state(false);
  let scope = $state('all'), month = $state(''), image = $state(''), error = $state(''), progress = $state('');
  let result = $state<PosterData | null>(null), canShare = $state(false), sharing = $state(false);
  let controller: AbortController | null = null;
  let blob: Blob | null = null, disposed = false, token = 0, appearance = 0;
  const filename = () => `runnote-${result?.month ?? 'all'}.png`;
  function release() {
    if (image) URL.revokeObjectURL(image);
    image = ''; blob = null; result = null; canShare = false;
  }
  function invalidate() { controller?.abort(); controller = null; ++token; busy = false; progress = ''; error = ''; release(); }
  function open() { invalidate(); visible = true; dialog.showModal(); }
  function close() { invalidate(); visible = false; dialog.close(); }
  async function generate() {
    invalidate();
    const request = ++token;
    const cancelled = () => disposed || !visible || request !== token;
    controller = new AbortController();
    const signal = controller.signal;
    const fetcher: typeof fetch = (input, init) => view.fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    busy = true; progress = '正在读取跑步记录…';
    try {
      const data = await loadPoster({ month: scope === 'month' ? month : undefined,
        fetcher, cancelled,
        onprogress: (completed, total, phase) => { if (!cancelled()) progress = `${phase === 'records' ? '正在挑选轨迹' : '正在描绘足迹'} ${completed}/${total}…`; } });
      if (cancelled()) return;
      progress = '正在生成高清图片…';
      await createImage(data, cancelled);
    } catch (cause) {
      if (cancelled()) return;
      release();
      if (cause instanceof ActivityError && cause.status === 401) {
        close(); window.location.replace(`/admin?reason=expired&next=${encodeURIComponent(window.location.pathname)}`); return;
      }
      error = cause instanceof Error ? cause.message : '图片生成失败，请重试';
    } finally { if (!cancelled()) { busy = false; progress = ''; } }
  }
  async function createImage(data: PosterData, cancelled: () => boolean) {
    let output: Blob, version: number;
    do {
      version = appearance;
      output = await renderPoster(data, posterPalette(dialog));
      if (cancelled()) return;
    } while (version !== appearance);
    release();
    blob = output; result = data; image = URL.createObjectURL(output);
    // System sharing is optional; capability errors must not discard a valid PNG.
    try {
      canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File([output], filename(), { type: 'image/png' })] });
    } catch { canShare = false; }
  }
  async function repaint() {
    if (!visible || busy || !result) return;
    const data = result, request = ++token;
    const cancelled = () => disposed || !visible || request !== token;
    busy = true; progress = '正在更新图片外观…';
    try { await createImage(data, cancelled); }
    catch { if (!cancelled()) { release(); error = '图片外观更新失败，请重新生成'; } }
    finally { if (!cancelled()) { busy = false; progress = ''; } }
  }
  function download() {
    if (!image || !blob || busy) return;
    const link = document.createElement('a'); link.href = image; link.download = filename();
    document.body.append(link); link.click(); link.remove();
  }
  async function share() {
    if (!blob || !canShare || sharing || busy) return;
    const request = token, file = new File([blob], filename(), { type: 'image/png' });
    sharing = true; error = '';
    try { await navigator.share({ files: [file] }); }
    catch (cause) {
      if (!disposed && request === token && !(cause instanceof DOMException && cause.name === 'AbortError')) error = '系统分享未完成，可以保存 PNG 后分享';
    } finally { if (!disposed) sharing = false; }
  }
  onMount(() => {
    mounted = true;
    month = new Intl.DateTimeFormat('sv-SE', { timeZone: page.data.showcase?.timezone ?? page.data.user?.timezone ?? 'UTC', year: 'numeric', month: '2-digit' }).format(new Date());
    const unwatch = watchSystemTheme(() => { ++appearance; void repaint(); });
    return () => { disposed = true; unwatch(); invalidate(); };
  });
</script>

<button bind:this={trigger} type="button" class="button-secondary" disabled={!mounted} onclick={open}>生成分享图</button>
<dialog bind:this={dialog} aria-labelledby="poster-title" aria-describedby="poster-description"
  oncancel={(event) => { event.preventDefault(); close(); }}
  onclose={() => { invalidate(); visible = false; trigger?.focus(); }}>
  <div class="poster-heading"><h2 id="poster-title">生成分享图</h2><button type="button" class="button-secondary" onclick={close}>关闭</button></div>
  <p id="poster-description" class="poster-description">把跑过的路线，变成一张可以珍藏的图片。</p>
  <div class="poster-workspace">
    <div class="poster-options">
      <div class="poster-field"><label for="poster-scope">统计范围</label><select id="poster-scope" bind:value={scope} onchange={invalidate}><option value="all">全部记录</option><option value="month">指定月份</option></select></div>
      {#if scope === 'month'}<div class="poster-field"><label for="poster-month">选择月份</label><input id="poster-month" type="month" min="1900-01" max="2100-12" bind:value={month} oninput={invalidate} /></div>{/if}
      <p class="poster-help">1080 × 1920 高清 PNG<br />从全部有效轨迹中随机选取最多 120 条，只生成一张。</p>
      <button type="button" class="bg-primary text-primary-foreground px-4 py-2" disabled={busy || sharing} onclick={() => void generate()}>生成预览</button>
      {#if busy}<p role="status" aria-live="polite">{progress}</p><button type="button" class="button-secondary" onclick={invalidate}>取消生成</button>{/if}
      {#if error}<p role="alert">{error}</p>{/if}
      <p class="poster-privacy">图片包含路线形状，请确认后分享。图片在本机生成，不会自动发送。</p>
      <div class="poster-save">
        <button type="button" class="button-secondary" disabled={!image || busy || sharing} onclick={download}>保存 PNG</button>
        {#if canShare}<button type="button" class="button-secondary" disabled={busy || sharing} onclick={() => void share()}>{sharing ? '正在分享…' : '分享图片'}</button>{/if}
      </div>
    </div>
    <div class="poster-preview" aria-busy={busy}>
      {#if image && result}
        <img src={image} alt="跑步足迹分享图预览" width="1080" height="1920" />
        <p class="poster-summary">{posterPeriod(result.month)} · {result.kilometers} 公里 · {result.activityCount} 次跑步 · {result.activityDays} 个活动日</p>
        <p class="poster-help">距离约等于 {result.halfMarathons} 次半程马拉松，表示距离折算。</p>
        <p class="poster-help">随机展示 {result.cells.length} / {result.routeCount} 条轨迹</p>
        <button type="button" class="button-secondary poster-reshuffle" disabled={busy || sharing} onclick={() => void generate()}>换一组轨迹</button>
      {:else}<div class="poster-placeholder"><span aria-hidden="true">↗</span><p>{busy ? '每一次出发，正在汇成足迹' : '选择范围，生成你的跑步足迹'}</p></div>{/if}
    </div>
  </div>
</dialog>

<style>
  dialog{margin:auto;width:min(58rem,calc(100% - 2rem));max-height:calc(100svh - 2rem);overflow-y:auto;padding:var(--space-6);border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);color:var(--foreground);}
  dialog::backdrop{background:var(--surface-backdrop);}
  .poster-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);}.poster-heading h2{font-size:1.5rem;font-weight:650;}
  .poster-description{margin-top:var(--space-2);color:var(--muted-foreground);}
  .poster-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:var(--space-6);margin-top:var(--space-6);align-items:start;}
  .poster-options{display:grid;gap:var(--space-4);min-width:0;}.poster-field{display:grid;gap:var(--space-2);}.poster-field input,.poster-field select{width:100%;border:1px solid var(--border);padding:var(--space-2) var(--space-3);}
  .poster-help,.poster-privacy,.poster-summary{font-size:var(--text-small);color:var(--muted-foreground);overflow-wrap:anywhere;}.poster-privacy{padding-top:var(--space-2);border-top:1px solid var(--border);}
  .poster-save{display:flex;flex-wrap:wrap;gap:var(--space-3);}.poster-preview{min-width:0;}.poster-preview img{display:block;width:100%;height:auto;border-radius:var(--radius-control);}.poster-summary{margin:var(--space-3) 0 var(--space-1);}
  .poster-placeholder{min-height:24rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-4);padding:var(--space-6);border:1px dashed var(--border);border-radius:var(--radius-control);background:var(--muted);color:var(--muted-foreground);text-align:center;}.poster-placeholder>span{font-size:3rem;color:var(--primary);}
  .poster-reshuffle{margin-top:var(--space-4);width:100%;}
  @media(max-width:639px){dialog{padding:var(--space-4);}.poster-workspace{grid-template-columns:minmax(0,1fr);gap:var(--space-4);}.poster-placeholder{min-height:12rem;}.poster-save>button{flex:1;}}
</style>
