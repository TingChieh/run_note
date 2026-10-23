<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import { page } from '$app/state';
  import { contextAPI, viewContext } from '#lib/api/view-context.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { loadActivityPoster, type ActivityPosterData } from '#lib/share/activity-poster-data.ts';
  import { activityPosterHasRoute, activityPosterStyles, renderActivityPoster, type ActivityPosterStyle } from '#lib/share/activity-poster-render.ts';
  import { loadPosterLogo, posterPalette } from '#lib/share/route-poster-render.ts';

  let { activityId }: { activityId: string } = $props();

  // Only a signed-in viewer looking at their own record may create a share image:
  // their workspace, the root showcase as site owner, or their own named showcase.
  const subject = $derived(viewContext(page.url.pathname, page.data.user?.is_admin === true));
  const allowed = $derived(!!page.data.user && (subject.kind === 'workspace' ||
    (subject.kind === 'root' && page.data.user.is_admin) || (subject.kind === 'public' && subject.username === page.data.user.username)));
  // Always read through the authenticated own-data API so the backend enforces session and owner scope.
  const own = viewContext('/workspace');
  const ownFetch: typeof fetch = (input, init) => fetch(typeof input === 'string' ? contextAPI(own, input) : input, init);
  let dialog = $state<HTMLDialogElement>(null!), trigger = $state<HTMLButtonElement>(null!), themeProbe = $state<HTMLElement>(null!);
  let mounted = $state(false), visible = $state(false), loading = $state(false), sharing = $state(false), canShare = $state(false);
  let image = $state(''), error = $state(''), style = $state<ActivityPosterStyle>('trace'), theme = $state<'auto' | 'light' | 'dark'>('auto');
  let data = $state.raw<ActivityPosterData | null>(null), dataFor = '';
  const themes = [{ id: 'auto', name: '跟随网站' }, { id: 'light', name: '日间' }, { id: 'dark', name: '夜间' }] as const;
  const routed = $derived(activityPosterHasRoute(style));
  let controller: AbortController | null = null;
  let blob: Blob | null = null, disposed = false, loadToken = 0, renderToken = 0, appearance = 0;
  let logo: ImageBitmap | null = null, logoFor: string | null | undefined, logoLoad: Promise<void> = Promise.resolve(), logoToken = 0;
  function ensureLogo() {
    const url = page.data.site?.logo_url ?? null;
    if (url === logoFor) return logoLoad;
    logoFor = url;
    const token = ++logoToken;
    return logoLoad = loadPosterLogo(url).then(bitmap => {
      if (disposed || token !== logoToken) { bitmap?.close(); return; }
      logo?.close(); logo = bitmap;
    });
  }
  const filename = () => `runnote-${activityId.slice(0, 8)}.png`;
  function release() { if (image) URL.revokeObjectURL(image); image = ''; blob = null; canShare = false; }
  function stop() { controller?.abort(); controller = null; ++loadToken; ++renderToken; loading = false; error = ''; release(); data = null; dataFor = ''; }
  // Leaving one's own view (logout, another subject) or switching record drops cached data and images.
  $effect(() => { if (!allowed || (dataFor && dataFor !== activityId)) { stop(); visible = false; if (dialog?.open) dialog.close(); } });
  function open() { stop(); visible = true; dialog.showModal(); void load(); }
  function close() { stop(); visible = false; dialog.close(); }
  async function load() {
    const request = ++loadToken, id = activityId;
    const cancelled = () => disposed || !visible || request !== loadToken;
    controller = new AbortController();
    const signal = controller.signal;
    loading = true; error = '';
    try {
      const result = await loadActivityPoster({ id, withRoute: true, cancelled,
        fetcher: (input, init) => ownFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }) });
      if (cancelled()) return;
      data = result; dataFor = id; loading = false; controller = null;
      void render();
    } catch (cause) {
      if (cancelled()) return;
      loading = false; controller = null;
      if (cause instanceof ActivityError && cause.status === 401) {
        close(); window.location.replace(`/admin?reason=expired&next=${encodeURIComponent(window.location.pathname)}`); return;
      }
      error = cause instanceof Error ? cause.message : '读取跑步记录失败，请重试';
    }
  }
  /** Local redraw only: never fetches. */
  async function render() {
    if (!visible || !data) return;
    const request = ++renderToken, source = data;
    let output: Blob, version: number;
    try {
      do {
        version = appearance;
        await ensureLogo(); await tick();
        if (disposed || !visible || request !== renderToken) return;
        output = await renderActivityPoster(source, posterPalette(theme === 'auto' ? dialog : themeProbe), style, { title: page.data.site?.title || 'RunNote', logo });
        if (disposed || !visible || request !== renderToken) return;
      } while (version !== appearance);
    } catch { if (request === renderToken) error = '图片绘制失败，请重试'; return; }
    release();
    blob = output; image = URL.createObjectURL(output);
    try {
      canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File([output], filename(), { type: 'image/png' })] });
    } catch { canShare = false; }
  }
  function download() {
    if (!image || !blob) return;
    const link = document.createElement('a'); link.href = image; link.download = filename();
    document.body.append(link); link.click(); link.remove();
  }
  async function share() {
    if (!blob || !canShare || sharing) return;
    const request = renderToken, file = new File([blob], filename(), { type: 'image/png' });
    sharing = true; error = '';
    try { await navigator.share({ files: [file] }); }
    catch (cause) {
      if (!disposed && request === renderToken && !(cause instanceof DOMException && cause.name === 'AbortError')) error = '系统分享未完成，可以保存 PNG 后分享';
    } finally { if (!disposed) sharing = false; }
  }
  onMount(() => {
    mounted = true;
    const unwatch = watchSystemTheme(() => { ++appearance; void render(); });
    return () => { disposed = true; unwatch(); stop(); ++logoToken; logo?.close(); logo = null; };
  });
</script>

{#if allowed}
<!-- Hidden token probe, present only for a fixed appearance: resolves it without switching the site theme
     and keeps the page's single `.sport-theme` shell unique otherwise. -->
{#if visible && theme !== 'auto'}<div hidden data-poster-theme={theme}><div class="sport-theme" bind:this={themeProbe}></div></div>{/if}
<button bind:this={trigger} type="button" class="button-secondary" disabled={!mounted} onclick={open}>生成分享图</button>
<dialog bind:this={dialog} aria-labelledby="activity-poster-title" aria-describedby="activity-poster-description"
  oncancel={(event) => { event.preventDefault(); close(); }}
  onclose={() => { if (dialog.open) return; stop(); visible = false; trigger?.focus(); }}>
  <div class="poster-heading"><h2 id="activity-poster-title">生成分享图</h2><button type="button" class="button-secondary" onclick={close}>关闭</button></div>
  <p id="activity-poster-description" class="poster-help">把这次跑步，变成一张可以珍藏的图片。</p>
  <div class="poster-workspace">
    <div class="poster-options">
      <fieldset class="poster-group" disabled={sharing}>
        <legend>图片外观</legend>
        <div class="poster-appearance-options">
          {#each themes as option}
            <label class:selected={theme === option.id}><input type="radio" name="activity-poster-theme" value={option.id} bind:group={theme} onchange={() => void render()} />{option.name}</label>
          {/each}
        </div>
      </fieldset>
      <fieldset class="poster-group" disabled={sharing}>
        <legend>图片样式</legend>
        <div class="poster-style-grid">
          {#each activityPosterStyles as preset}
            <label class="poster-style" class:selected={style === preset.id}>
              <input type="radio" name="activity-poster-style" aria-label={preset.name} aria-describedby={`activity-poster-style-${preset.id}`} value={preset.id} bind:group={style} onchange={() => void render()} />
              <span class="poster-style-name">{preset.name}</span>
              <span id={`activity-poster-style-${preset.id}`} class="poster-help">{preset.description}</span>
            </label>
          {/each}
        </div>
      </fieldset>
      <p class="poster-help">1080 × 1920 高清 PNG</p>
      {#if loading}<p role="status" aria-live="polite">正在读取这次跑步…</p>{/if}
      {#if error}<p role="alert">{error}</p>{#if !data && !loading}<button type="button" class="button-secondary" onclick={() => void load()}>重新读取</button>{/if}{/if}
      <p class="poster-privacy">{routed ? '图片包含路线形状和起终点，请确认后分享。' : '图片只包含统计数字，不含路线形状。'}图片在本机生成，不会自动发送。</p>
      <div class="poster-save">
        <button type="button" class="button-secondary" disabled={!image || sharing} onclick={download}>保存 PNG</button>
        {#if canShare}<button type="button" class="button-secondary" disabled={sharing} onclick={() => void share()}>{sharing ? '正在分享…' : '分享图片'}</button>{/if}
      </div>
    </div>
    <div class="poster-preview" aria-busy={loading}>
      {#if image}<img src={image} alt="单次跑步分享图预览" width="1080" height="1920" />
      {:else}<div class="poster-placeholder"><p>{loading ? '正在读取…' : '正在绘制预览…'}</p></div>{/if}
    </div>
  </div>
</dialog>
{/if}

<style>
  dialog{margin:auto;width:min(58rem,calc(100% - 2rem));max-height:calc(100svh - 2rem);overflow-y:auto;padding:var(--space-6);border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);color:var(--foreground);}
  dialog{opacity:0;transform:translateY(1rem) scale(.97);transition:opacity 220ms ease,transform 320ms cubic-bezier(.22,.61,.36,1),overlay 320ms allow-discrete,display 320ms allow-discrete;}
  dialog[open]{opacity:1;transform:none;}
  dialog::backdrop{background:var(--surface-backdrop);opacity:0;transition:opacity 260ms ease,overlay 320ms allow-discrete,display 320ms allow-discrete;}
  dialog[open]::backdrop{opacity:1;}
  @starting-style{dialog[open]{opacity:0;transform:translateY(1rem) scale(.97);}dialog[open]::backdrop{opacity:0;}}
  @media(prefers-reduced-motion:reduce){dialog,dialog::backdrop{transition:none;}}
  .poster-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);}.poster-heading h2{font-size:1.5rem;font-weight:650;}
  .poster-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:var(--space-6);margin-top:var(--space-6);align-items:start;}
  .poster-options{display:grid;gap:var(--space-4);min-width:0;}
  .poster-help,.poster-privacy{font-size:var(--text-small);color:var(--muted-foreground);overflow-wrap:anywhere;}.poster-privacy{padding-top:var(--space-2);border-top:1px solid var(--border);}
  .poster-group{min-width:0;margin:0;padding:0;border:0;}.poster-group legend{margin-bottom:var(--space-2);}
  .poster-appearance-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-2);}
  .poster-appearance-options label{display:flex;align-items:center;justify-content:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-control);font-size:var(--text-small);cursor:pointer;}.poster-appearance-options label.selected{border-color:var(--primary);background:var(--primary-soft);}.poster-appearance-options label:has(input:focus-visible){outline:2px solid var(--ring);outline-offset:2px;}.poster-group:disabled label{opacity:.65;cursor:wait;}.poster-appearance-options input{margin:0;}
  .poster-style-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-2);}
  .poster-style{position:relative;display:grid;gap:var(--space-1);min-width:0;padding:var(--space-3);padding-right:var(--space-8);border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface);cursor:pointer;}.poster-style.selected{border-color:var(--primary);background:var(--primary-soft);}.poster-style:has(input:focus-visible){outline:2px solid var(--ring);outline-offset:2px;}
  .poster-style input{position:absolute;right:var(--space-2);top:var(--space-2);width:1rem;height:1rem;margin:0;}.poster-style-name{font-size:var(--text-small);font-weight:650;}
  .poster-save{display:flex;flex-wrap:wrap;gap:var(--space-3);}.poster-preview{min-width:0;}.poster-preview img{display:block;width:100%;height:auto;border-radius:var(--radius-control);}
  .poster-placeholder{min-height:24rem;display:flex;align-items:center;justify-content:center;padding:var(--space-6);border:1px dashed var(--border);border-radius:var(--radius-control);color:var(--muted-foreground);}
  @media(max-width:639px){dialog{padding:var(--space-4);}.poster-workspace{grid-template-columns:minmax(0,1fr);gap:var(--space-4);}.poster-placeholder{min-height:12rem;}.poster-save>button{flex:1;}}
</style>
