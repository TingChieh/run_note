<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import DatePicker from '#lib/components/DatePicker.svelte';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import { page } from '$app/state';
  import { contextAPI, viewContext } from '#lib/api/view-context.ts';
  import { ActivityError } from '#lib/api/activities.ts';
  import { loadPoster, loadPosterSummary, type PosterData } from '#lib/share/route-poster-data.ts';
  import { posterSample } from '#lib/share/route-poster-sample.ts';
  import { posterHasRoutes, posterPalette, posterPeriod, posterStyles, loadPosterLogo, renderPoster, type PosterStyle } from '#lib/share/route-poster-render.ts';

  // Only a signed-in viewer looking at their own records may create a share image:
  // their workspace, the root showcase as site owner, or their own named showcase.
  const subject = $derived(viewContext(page.url.pathname, page.data.user?.is_admin === true));
  const allowed = $derived(!!page.data.user && (subject.kind === 'workspace' ||
    (subject.kind === 'root' && page.data.user.is_admin) || (subject.kind === 'public' && subject.username === page.data.user.username)));
  // Always read through the authenticated own-data API, never the anonymous showcase API,
  // so the backend enforces the session and owner scope as well.
  const own = viewContext('/workspace');
  const ownFetch: typeof fetch = (input, init) => fetch(typeof input === 'string' ? contextAPI(own, input) : input, init);
  // Rendered conditionally, so element refs must be reactive.
  let dialog = $state<HTMLDialogElement>(null!), trigger = $state<HTMLButtonElement>(null!);
  let mounted = $state(false), visible = $state(false);
  let scope = $state('all'), month = $state(''), image = $state(''), error = $state(''), progress = $state('');
  let shown = $state<PosterData | null>(null), sampleShown = $state(true), canShare = $state(false), sharing = $state(false);
  let style = $state<PosterStyle>('classic');
  let theme = $state<'auto' | 'light' | 'dark'>('auto');
  let themeProbe = $state<HTMLElement>(null!);
  const themes = [{ id: 'auto', name: '跟随网站' }, { id: 'light', name: '日间' }, { id: 'dark', name: '夜间' }] as const;
  const routed = $derived(posterHasRoutes(style));
  const styleGroups = [
    { label: '带足迹路线', presets: posterStyles.filter(preset => preset.routes) },
    { label: '不含轨迹 · 只展示数字', presets: posterStyles.filter(preset => !preset.routes) },
  ];
  // Own data is read at most once per range and kept for this page: totals (one request)
  // for route-free styles, the route sample only when a route style needs it.
  let cache = $state<{ key: string; summary: PosterData | null; routes: PosterData | null }>({ key: '', summary: null, routes: null });
  let loading = $state<'summary' | 'routes' | null>(null);
  const rangeKey = () => scope === 'month' ? month : 'all';
  const available = () => routed ? cache.routes : cache.summary ?? cache.routes;
  const hasOwnData = $derived(!!(routed ? cache.routes : cache.summary ?? cache.routes));
  let controller: AbortController | null = null;
  let blob: Blob | null = null, disposed = false, loadToken = 0, renderToken = 0, appearance = 0;
  // Site logo bitmap (browser only), loaded once per logo URL and closed on replacement/unmount.
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
  const filename = () => `runnote-${shown?.month ?? 'all'}.png`;
  function release() {
    if (image) URL.revokeObjectURL(image);
    image = ''; blob = null; shown = null; sampleShown = true; canShare = false;
  }
  function abortLoad() { controller?.abort(); controller = null; ++loadToken; loading = null; progress = ''; }
  function stop() { abortLoad(); ++renderToken; error = ''; release(); }
  function resetRange() { stop(); cache = { key: rangeKey(), summary: null, routes: null }; }
  // Leaving one's own view (e.g. logout or navigating to another subject) drops cached data and images.
  $effect(() => { if (!allowed) untrack(() => { resetRange(); visible = false; }); });
  function open() {
    if (cache.key !== rangeKey()) resetRange(); else stop();
    visible = true; dialog.showModal(); void render(); ensureData();
  }
  function close() { stop(); visible = false; dialog.close(); }
  function rangeChanged() { if (!visible) return; resetRange(); void render(); ensureData(); }
  function selectionChanged() { error = ''; void render(); ensureData(); }
  function ensureData() {
    if (!visible || available()) return;
    const need = routed ? 'routes' : 'summary';
    // A route sample also carries the totals, so it satisfies route-free styles too.
    if (loading === need || loading === 'routes') return;
    void load(need);
  }
  async function load(kind: 'summary' | 'routes') {
    abortLoad();
    const request = ++loadToken, key = rangeKey(), range = scope === 'month' ? month : undefined;
    const cancelled = () => disposed || !visible || request !== loadToken;
    controller = new AbortController();
    const signal = controller.signal;
    const fetcher: typeof fetch = (input, init) => ownFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    loading = kind; error = ''; progress = kind === 'routes' ? '正在读取跑步记录…' : '正在读取你的统计…';
    try {
      if (kind === 'summary') {
        const data = await loadPosterSummary({ month: range, fetcher, cancelled });
        if (cancelled()) return;
        cache = { ...cache, key, summary: data };
      } else {
        const data = await loadPoster({ month: range, fetcher, cancelled,
          onprogress: (completed, total, phase) => { if (!cancelled()) progress = `${phase === 'records' ? '正在挑选轨迹' : '正在描绘足迹'} ${completed}/${total}…`; } });
        if (cancelled()) return;
        cache = { key, summary: data, routes: data };
      }
      loading = null; progress = ''; controller = null;
      void render();
    } catch (cause) {
      if (cancelled()) return;
      loading = null; progress = ''; controller = null;
      if (cause instanceof ActivityError && cause.status === 401) {
        cache = { key: '', summary: null, routes: null }; close();
        window.location.replace(`/admin?reason=expired&next=${encodeURIComponent(window.location.pathname)}`); return;
      }
      error = cause instanceof Error ? cause.message : '读取跑步记录失败，请重试';
    }
  }
  /** Local redraw only (tens of milliseconds): never fetches. Shows the labelled sample until own data exists. */
  async function render() {
    if (!visible) return;
    const request = ++renderToken, own = available(), data = own ?? posterSample;
    let output: Blob, version: number;
    try {
      do {
        version = appearance;
        await ensureLogo();
        if (disposed || !visible || request !== renderToken) return;
        output = await renderPoster(data, posterPalette(theme === 'auto' ? dialog : themeProbe), style, { title: page.data.site?.title || 'RunNote', logo });
        if (disposed || !visible || request !== renderToken) return;
      } while (version !== appearance);
    } catch { if (request === renderToken) error = '图片绘制失败，请重试'; return; }
    release();
    blob = output; shown = data; sampleShown = !own; image = URL.createObjectURL(output);
    if (sampleShown) return;
    // System sharing is optional; capability errors must not discard a valid PNG.
    try {
      canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File([output], filename(), { type: 'image/png' })] });
    } catch { canShare = false; }
  }
  function download() {
    if (!image || !blob || sampleShown) return;
    const link = document.createElement('a'); link.href = image; link.download = filename();
    document.body.append(link); link.click(); link.remove();
  }
  async function share() {
    if (!blob || !canShare || sharing || sampleShown) return;
    const request = renderToken, file = new File([blob], filename(), { type: 'image/png' });
    sharing = true; error = '';
    try { await navigator.share({ files: [file] }); }
    catch (cause) {
      if (!disposed && request === renderToken && !(cause instanceof DOMException && cause.name === 'AbortError')) error = '系统分享未完成，可以保存 PNG 后分享';
    } finally { if (!disposed) sharing = false; }
  }
  onMount(() => {
    mounted = true;
    month = new Intl.DateTimeFormat('sv-SE', { timeZone: page.data.showcase?.timezone ?? page.data.user?.timezone ?? 'UTC', year: 'numeric', month: '2-digit' }).format(new Date());
    const unwatch = watchSystemTheme(() => { ++appearance; void render(); });
    return () => { disposed = true; unwatch(); stop(); ++logoToken; logo?.close(); logo = null; };
  });
</script>

{#if allowed}
<!-- Hidden token probe: resolves the chosen fixed appearance without switching the site theme. -->
<div hidden data-poster-theme={theme === 'auto' ? undefined : theme}><div class="sport-theme" bind:this={themeProbe}></div></div>
<button bind:this={trigger} type="button" class="button-secondary" disabled={!mounted} onclick={open}>生成分享图</button>
<dialog bind:this={dialog} class="poster-dialog" aria-labelledby="poster-title" aria-describedby="poster-description"
  oncancel={(event) => { event.preventDefault(); close(); }}
  onclose={() => { // A close event queued before a quick reopen must not stop the new session.
    if (dialog.open) return; stop(); visible = false; trigger?.focus(); }}>
  <div class="poster-heading"><h2 id="poster-title">生成分享图</h2><button type="button" class="button-secondary" onclick={close}>关闭</button></div>
  <p id="poster-description" class="poster-description">把跑过的路线，变成一张可以珍藏的图片。</p>
  <div class="poster-workspace">
    <div class="poster-options">
      <div class="poster-field"><label for="poster-scope">统计范围</label><select id="poster-scope" bind:value={scope} onchange={rangeChanged}><option value="all">全部记录</option><option value="month">指定月份</option></select></div>
      {#if scope === 'month'}<div class="poster-field poster-month"><DatePicker label="统计月份" granularity="month" min="1900-01" max="2100-12" bind:value={month} disabled={sharing}
        timezone={page.data.showcase?.timezone ?? page.data.user?.timezone ?? 'UTC'} onselect={rangeChanged} /></div>{/if}
      <fieldset class="poster-appearance" disabled={sharing}>
        <legend>图片外观</legend>
        <div class="poster-appearance-options">
          {#each themes as option}
            <label class:selected={theme === option.id}><input type="radio" name="poster-theme" value={option.id} bind:group={theme} onchange={() => void render()} />{option.name}</label>
          {/each}
        </div>
      </fieldset>
      <fieldset class="poster-styles" disabled={sharing}>
        <legend>图片样式</legend>
        {#each styleGroups as group}
        <p class="poster-style-group">{group.label}</p>
        <div class="poster-style-grid">
          {#each group.presets as preset}
            <label class="poster-style" class:selected={style === preset.id}>
              <input type="radio" name="poster-style" aria-label={preset.name} aria-describedby={`poster-style-${preset.id}`} value={preset.id} bind:group={style} onchange={selectionChanged} />
              <svg viewBox="0 0 96 132" aria-hidden="true" focusable="false">
                <rect class="mini-background" width="96" height="132" rx="6" />
                {#if preset.id === 'classic'}
                  <rect class="mini-heading" x="8" y="8" width="80" height="26" rx="4" />
                  <rect class="mini-heading-ink" x="15" y="17" width="40" height="8" rx="1" />
                  <rect class="mini-surface" x="8" y="41" width="80" height="66" rx="4" />
                {:else if preset.id === 'sport'}
                  <rect class="mini-primary" x="8" y="8" width="80" height="36" rx="4" />
                  <rect class="mini-primary-ink" x="15" y="18" width="48" height="12" rx="1" />
                  <rect class="mini-heading" x="15" y="35" width="18" height="2" />
                  <rect class="mini-surface" x="8" y="48" width="80" height="59" rx="4" />
                {:else if preset.id === 'numeral'}
                  <rect class="mini-muted" x="8" y="14" width="30" height="3" rx="1" />
                  <rect class="mini-ink" x="8" y="24" width="72" height="26" rx="2" />
                  <rect class="mini-primary" x="8" y="56" width="16" height="3" />
                  {#each [0,1,2] as index}
                    <path class="mini-divider" d={`M8 ${68 + index * 18}H88`} />
                    <rect class="mini-muted" x="8" y={72 + index * 18} width="16" height="3" rx="1" />
                    <rect class="mini-ink" x="62" y={73 + index * 18} width="26" height="8" rx="1" />
                  {/each}
                {:else if preset.id === 'ticket'}
                  <rect class="mini-card" x="10" y="10" width="76" height="112" rx="5" />
                  <rect class="mini-ink" x="16" y="18" width="40" height="7" rx="1" />
                  <path class="mini-dash" d="M16 32H80M16 78H80" />
                  {#each [0,1,2,3] as index}
                    <rect class="mini-muted" x="16" y={39 + index * 9} width="14" height="3" rx="1" />
                    <rect class="mini-ink" x="58" y={38 + index * 9} width="22" height="4" rx="1" />
                  {/each}
                  <rect class="mini-ink" x="40" y="84" width="40" height="11" rx="1" />
                  {#each [0,1,2,3,4,5,6,7,8,9,10] as index}<rect class="mini-ink" x={16 + index * 6} y="102" width={index % 3 + 1} height="12" />{/each}
                {:else if preset.id === 'medal'}
                  <rect class="mini-ink" x="8" y="10" width="50" height="11" rx="1" />
                  <circle class="mini-ring" cx="48" cy="64" r="29" />
                  <circle class="mini-ring-inner" cx="48" cy="64" r="23" />
                  <rect class="mini-ink" x="37" y="58" width="22" height="12" rx="1" />
                {:else if preset.id === 'stripe'}
                  <rect class="mini-primary" x="8" y="8" width="80" height="48" rx="4" />
                  <path class="mini-heading" d="M52 56H58L80 8H74ZM64 56H66L88 8H86ZM74 56H80L88 39V26Z" />
                  <rect class="mini-primary-ink" x="14" y="16" width="30" height="6" rx="1" />
                  <rect class="mini-ink" x="8" y="70" width="62" height="20" rx="2" />
                  <rect class="mini-heading" x="8" y="95" width="18" height="3" />
                {:else}
                  <rect class="mini-muted" x="8" y="10" width="34" height="3" rx="1" />
                  <rect class="mini-ink" x="8" y="22" width="57" height="11" rx="1" />
                  <path class="mini-divider" d="M8 41H88" />
                {/if}
                {#if preset.routes}
                  {#each [0,1,2,3,4,5] as index}
                    <g transform={`translate(${15 + index % 3 * 26} ${56 + Math.floor(index / 3) * 25}) rotate(${preset.id === 'journal' ? (index % 3 - 1) * 2 : 0} 6 7)`}>
                      {#if preset.id === 'journal'}<rect class="mini-card" x="-4" y="-5" width="23" height="25" rx="2" />{/if}
                      <path class="mini-route" d="M0 8L6 0L13 4L11 14L3 12Z" />
                    </g>
                  {/each}
                {/if}
                {#if preset.id !== 'numeral' && preset.id !== 'ticket'}
                  <rect class="mini-divider-fill" x="8" y="115" width="80" height="2" />
                  <rect class="mini-muted" x="8" y="122" width="18" height="3" rx="1" />
                  <rect class="mini-muted" x="39" y="122" width="18" height="3" rx="1" />
                  <rect class="mini-muted" x="70" y="122" width="18" height="3" rx="1" />
                {/if}
              </svg>
              <span class="poster-style-name">{preset.name}</span>
              <span id={`poster-style-${preset.id}`} class="poster-style-description">{preset.description}</span>
            </label>
          {/each}
        </div>
        {/each}
      </fieldset>
      <p class="poster-help">1080 × 1920 高清 PNG<br />{routed ? '从全部有效轨迹中随机选取最多 120 条，只生成一张。' : '当前样式只绘制统计数字，图片中不含任何轨迹。'}</p>
      {#if loading}<p role="status" aria-live="polite">{progress}</p><button type="button" class="button-secondary" onclick={abortLoad}>取消读取</button>
      {:else if !hasOwnData}<button type="button" class="bg-primary text-primary-foreground px-4 py-2" disabled={sharing} onclick={() => void load(routed ? 'routes' : 'summary')}>读取我的数据</button>{/if}
      {#if error}<p role="alert">{error}</p>{/if}
      <p class="poster-privacy">{routed ? '图片包含路线形状，请确认后分享。' : '图片只包含统计数字，不含路线形状。'}图片在本机生成，不会自动发送。</p>
      <div class="poster-save">
        <button type="button" class="button-secondary" disabled={!image || sampleShown || sharing} onclick={download}>保存 PNG</button>
        {#if canShare && !sampleShown}<button type="button" class="button-secondary" disabled={sharing} onclick={() => void share()}>{sharing ? '正在分享…' : '分享图片'}</button>{/if}
      </div>
    </div>
    <div class="poster-preview" aria-busy={!!loading}>
      {#if image && shown && sampleShown}
        <p class="poster-sample-badge">示例效果，非你的数据</p>
        <img src={image} alt="分享图示例（非你的数据）" width="1080" height="1920" />
        <p class="poster-help">{loading ? '正在读取你的数据，完成后自动替换为你的图片。' : '读取你的数据后即可保存或分享。'}</p>
      {:else if image && shown}
        <img src={image} alt="跑步足迹分享图预览" width="1080" height="1920" />
        <p class="poster-summary">{posterPeriod(shown.month)} · {shown.kilometers} 公里 · {shown.activityCount} 次跑步 · {shown.activityDays} 个活动日</p>
        <p class="poster-help">距离约等于 {shown.halfMarathons} 次半程马拉松，表示距离折算。</p>
        {#if routed}
          <p class="poster-help">随机展示 {shown.cells.length} / {shown.routeCount} 条轨迹</p>
          <button type="button" class="button-secondary poster-reshuffle" disabled={!!loading || sharing} onclick={() => void load('routes')}>换一组轨迹</button>
        {:else}<p class="poster-help">当前样式不含轨迹，可随时切回带足迹的样式。</p>{/if}
      {:else}<div class="poster-placeholder"><span aria-hidden="true">↗</span><p>正在绘制预览…</p></div>{/if}
    </div>
  </div>
</dialog>
{/if}

<style>
  dialog{margin:auto;padding:var(--space-6);border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);color:var(--foreground);}
  dialog{opacity:0;transform:translateY(1rem) scale(.97);transition:opacity 220ms ease,transform 320ms cubic-bezier(.22,.61,.36,1),overlay 320ms allow-discrete,display 320ms allow-discrete;}
  dialog[open]{opacity:1;transform:none;}
  dialog::backdrop{background:var(--surface-backdrop);opacity:0;transition:opacity 260ms ease,overlay 320ms allow-discrete,display 320ms allow-discrete;}
  dialog[open]::backdrop{opacity:1;}
  @starting-style{dialog[open]{opacity:0;transform:translateY(1rem) scale(.97);}dialog[open]::backdrop{opacity:0;}}
  @media(prefers-reduced-motion:reduce){dialog,dialog::backdrop{transition:none;}}
  .poster-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);}.poster-heading h2{font-size: var(--text-section);font-weight: var(--weight-semibold);}
  .poster-description{margin-top:var(--space-2);color:var(--muted-foreground);}
  .poster-workspace{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);}
  .poster-options{display:grid;gap:var(--space-4);min-width:0;}.poster-field{display:grid;gap:var(--space-2);}.poster-month :global(.date-control){width:100%;}.poster-field select{width:100%;border:1px solid var(--border);padding:var(--space-2) var(--space-3);}
  .poster-help,.poster-privacy,.poster-summary{font-size:var(--text-small);color:var(--muted-foreground);overflow-wrap:anywhere;}.poster-privacy{padding-top:var(--space-2);border-top:1px solid var(--border);}
  .poster-save{display:flex;flex-wrap:wrap;gap:var(--space-3);}.poster-preview{min-width:0;}.poster-summary{margin:var(--space-3) 0 var(--space-1);}
  .poster-placeholder{min-height:24rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-4);padding:var(--space-6);border:1px dashed var(--border);border-radius:var(--radius-control);background:var(--muted);color:var(--muted-foreground);text-align:center;}.poster-placeholder>span{font-size: var(--text-display);color:var(--primary);}
  .poster-sample-badge{display:inline-block;margin-bottom:var(--space-2);padding:var(--space-1) var(--space-3);border-radius:var(--radius-control);background:var(--warning-soft);color:var(--warning);border:1px solid var(--warning-border);font-size:var(--text-small);font-weight: var(--weight-semibold);}
  .poster-reshuffle{margin-top:var(--space-4);width:100%;}
  .poster-appearance{min-width:0;margin:0;padding:0;border:0;}.poster-appearance legend{margin-bottom:var(--space-2);}.poster-appearance-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-2);}
  .poster-appearance label{display:flex;align-items:center;justify-content:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border:1px solid var(--border);border-radius:var(--radius-control);font-size:var(--text-small);cursor:pointer;}.poster-appearance label.selected{border-color:var(--primary);background:var(--primary-soft);}.poster-appearance label:has(input:focus-visible){outline:2px solid var(--ring);outline-offset:2px;}.poster-appearance:disabled label{opacity:.65;cursor:wait;}.poster-appearance input{margin:0;}
  .poster-styles{min-width:0;margin:0;padding:0;border:0;}.poster-styles legend{margin-bottom:var(--space-2);}.poster-style-group{margin:var(--space-3) 0 var(--space-2);font-size:var(--text-small);color:var(--muted-foreground);}.poster-style-group:first-of-type{margin-top:0;}.poster-style-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3);}
  .poster-style{position:relative;display:grid;gap:var(--space-1);min-width:0;padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface);cursor:pointer;}.poster-style.selected{border-color:var(--primary);background:var(--primary-soft);}.poster-style:has(input:focus-visible){outline:2px solid var(--ring);outline-offset:2px;}.poster-styles:disabled .poster-style{opacity:.65;cursor:wait;}
  .poster-style input{position:absolute;right:var(--space-2);top:var(--space-2);width:1rem;height:1rem;margin:0;}.poster-style svg{width:100%;}.poster-style-name{font-size:var(--text-small);font-weight: var(--weight-semibold);}.poster-style-description{font-size:var(--text-small);color:var(--muted-foreground);overflow-wrap:anywhere;}
  .mini-background{fill:var(--background);}.mini-surface{fill:var(--surface);}.mini-heading{fill:var(--sport-yellow);}.mini-heading-ink{fill:var(--sport-heading-ink);}.mini-primary{fill:var(--primary);}.mini-primary-ink{fill:var(--primary-foreground);}.mini-ink{fill:var(--foreground);}.mini-muted{fill:var(--muted-foreground);}.mini-divider{stroke:var(--border);}.mini-divider-fill{fill:var(--border);}.mini-card{fill:var(--surface);stroke:var(--border);}.mini-dash{fill:none;stroke:var(--border);stroke-dasharray:3 2;}.mini-ring{fill:none;stroke:var(--primary);stroke-width:4;}.mini-ring-inner{fill:none;stroke:var(--sport-yellow);stroke-width:1.5;}.mini-route{fill:none;stroke:var(--primary);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
  @media(max-width:719px),(max-height:500px){dialog{padding:var(--space-4);}.poster-appearance-options label{gap:var(--space-1);padding-inline:var(--space-2);white-space:nowrap;}.poster-workspace{grid-template-columns:minmax(0,1fr);}.poster-placeholder{min-height:12rem;}.poster-save>button{flex:1;}}
</style>
