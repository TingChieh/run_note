<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import ImageUpload from '#lib/components/ImageUpload.svelte';
  import SaveBar from '#lib/components/SaveBar.svelte';
  import { applySiteDefaultTheme } from '#lib/components/system-theme.ts';
  import { SiteError, readSite, removeSiteImage, updateSite, uploadSiteImage } from '#lib/api/site.ts';
  import { brandInitial, pageTitle, type Site, type SiteTheme } from '#lib/site.ts';

  let site = $state<Site | null>(null), loading = $state(true), loadError = $state('');
  let title = $state(''), subtitle = $state(''), tagline = $state(''), description = $state(''), theme = $state<SiteTheme>('system');
  let slow = $state(false), saving = $state(false), notice = $state(''), error = $state('');
  let imageBusy = $state<'favicon' | 'logo' | null>(null), imageError = $state<Record<string, string>>({});
  let disposed = false, token = 0, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const dirty = $derived(!!site && (title !== site.title || subtitle !== site.subtitle || tagline !== site.footer_tagline || description !== site.description || theme !== site.default_theme));
  $effect(() => { if (dirty) notice = ''; });
  function discard() { if (site) { fill(site); error = ''; } }
  const themes: { value: SiteTheme; label: string }[] = [{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }];

  function fill(value: Site) { site = value; title = value.title; subtitle = value.subtitle; tagline = value.footer_tagline; description = value.description; theme = value.default_theme; }
  function expired(cause: unknown) { if (cause instanceof SiteError && cause.status === 401) { window.location.replace('/admin?reason=expired'); return true; } return false; }
  async function load() {
    const request = ++token; loading = true; loadError = '';
    try { const value = await readSite(); if (disposed || request !== token) return; fill(value); }
    catch (cause) { if (disposed || request !== token || expired(cause)) return; loadError = cause instanceof Error ? cause.message : '站点设置读取失败'; }
    finally { if (!disposed && request === token) loading = false; }
  }
  onMount(() => { const wait = setTimeout(() => { slow = true; }, 250); void load(); return () => { disposed = true; token++; clearTimeout(noticeTimer); clearTimeout(wait); }; });
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (saving) return; saving = true; notice = ''; error = ''; clearTimeout(noticeTimer);
    try { const value = await updateSite({ title, subtitle, footer_tagline: tagline, description, default_theme: theme }); if (disposed) return; fill(value); applySiteDefaultTheme(value.default_theme); notice = '站点设置已保存。'; await invalidateAll(); }
    catch (cause) { if (disposed || expired(cause)) return; error = cause instanceof Error ? cause.message : '保存失败，请重试'; }
    finally { if (!disposed) { saving = false; if (notice) noticeTimer = setTimeout(() => { notice = ''; }, 6000); } }
  }
  async function change(kind: 'favicon' | 'logo', action: () => Promise<Site>) {
    if (imageBusy) return; imageBusy = kind; imageError = { ...imageError, [kind]: '' };
    try { const value = await action(); if (disposed) return; site = value; await invalidateAll(); }
    catch (cause) { if (disposed || expired(cause)) return; imageError = { ...imageError, [kind]: cause instanceof Error ? cause.message : '图片更新失败，请重试' }; }
    finally { if (!disposed) imageBusy = null; }
  }
</script>
<svelte:head><title>{pageTitle('站点设置', page.data.site)}</title></svelte:head>
{#if loading}{#if slow}<div class="mt-6"><FeedbackState kind="loading" title="正在读取站点设置…" /></div>{/if}
{:else if loadError}<div class="mt-6"><FeedbackState kind="error" title={loadError}><button type="button" class="button-secondary mt-3" onclick={() => void load()}>重新读取</button></FeedbackState></div>
{:else if site}
<div class="site-layout">
  <form id="site-form" onsubmit={save} class="settings-stack" aria-busy={saving}>
    <section class="aux-panel settings-block" aria-labelledby="site-text-title">
      <h2 id="site-text-title">站点文字</h2>
      <p class="block-hint">显示在侧栏、页脚、浏览器标签和分享图中。</p>
      <div class="block-pair">
        <label class="block-field">站点标题<input class="text-field" required maxlength="40" bind:value={title} disabled={saving} /></label>
        <label class="block-field">侧栏副标题<input class="text-field" maxlength="40" bind:value={subtitle} disabled={saving} /></label>
      </div>
      <label class="block-field">页脚标语<input class="text-field" maxlength="80" bind:value={tagline} disabled={saving} /></label>
      <label class="block-field">站点描述<textarea class="text-field" maxlength="200" rows="3" bind:value={description} disabled={saving}></textarea></label>
    </section>
    <fieldset class="aux-panel settings-block" aria-busy={saving}>
      <legend>默认外观</legend>
      <p class="block-hint">访客未在本机手动切换时使用；手动切换始终优先。</p>
      <div class="theme-tiles">
        {#each themes as option}<label class="theme-tile" class:selected={theme === option.value}>
          <input type="radio" name="default-theme" value={option.value} bind:group={theme} disabled={saving} />
          <span class="theme-swatch swatch-{option.value}" aria-hidden="true"><i></i><i></i></span>
          <span class="theme-name">{option.label}</span>
        </label>{/each}
      </div>
    </fieldset>
  </form>
  <aside class="settings-stack" aria-label="预览与图标">
    <section class="aux-panel settings-block" aria-labelledby="site-preview-title">
      <h2 id="site-preview-title">预览</h2>
      <div class="site-preview">
        <div class="preview-side">
          <span class="preview-mark">{#if site.logo_url}<img src={site.logo_url} alt="" />{:else}{brandInitial(title)}{/if}</span>
          <span class="min-w-0"><span class="preview-title">{title || '站点标题'}</span>{#if subtitle}<span class="preview-sub">{subtitle}</span>{/if}</span>
        </div>
        <p class="preview-foot"><strong>{title || '站点标题'}</strong> {tagline}</p>
      </div>
    </section>
    <section class="aux-panel settings-block" aria-labelledby="images-title">
      <h2 id="images-title">图标</h2>
      <p class="block-hint">支持 PNG、JPEG、WebP，不超过 5 MiB；自动居中裁成正方形并移除元数据。</p>
      <ImageUpload label="站内标志" src={site.logo_url} fallback={brandInitial(site.title)} busy={imageBusy === 'logo'} error={imageError.logo} hint="显示在侧栏、顶栏和分享图。" onselect={file => void change('logo', () => uploadSiteImage('logo', file))} onremove={() => void change('logo', () => removeSiteImage('logo'))} />
      <ImageUpload label="浏览器图标" src={site.favicon_url} fallback={brandInitial(site.title)} busy={imageBusy === 'favicon'} error={imageError.favicon} hint="显示在浏览器标签页。" onselect={file => void change('favicon', () => uploadSiteImage('favicon', file))} onremove={() => void change('favicon', () => removeSiteImage('favicon'))} />
    </section>
  </aside>
  <div class="site-save"><SaveBar form="site-form" {dirty} busy={saving} message={notice} {error} label="保存站点设置" busyLabel="正在保存站点设置…" ondiscard={discard} /></div>
</div>
{/if}
