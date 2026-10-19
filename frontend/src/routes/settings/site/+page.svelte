<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import ImageUpload from '#lib/components/ImageUpload.svelte';
  import SettingsTabs from '#lib/components/SettingsTabs.svelte';
  import { applySiteDefaultTheme } from '#lib/components/system-theme.ts';
  import { SiteError, readSite, removeSiteImage, updateSite, uploadSiteImage } from '#lib/api/site.ts';
  import { brandInitial, pageTitle, type Site, type SiteTheme } from '#lib/site.ts';

  let site = $state<Site | null>(null), loading = $state(true), loadError = $state('');
  let title = $state(''), subtitle = $state(''), tagline = $state(''), description = $state(''), theme = $state<SiteTheme>('system');
  let saving = $state(false), notice = $state(''), error = $state('');
  let imageBusy = $state<'favicon' | 'logo' | null>(null), imageError = $state<Record<string, string>>({});
  let disposed = false, token = 0;
  const themes: { value: SiteTheme; label: string }[] = [{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }];

  function fill(value: Site) { site = value; title = value.title; subtitle = value.subtitle; tagline = value.footer_tagline; description = value.description; theme = value.default_theme; }
  function expired(cause: unknown) { if (cause instanceof SiteError && cause.status === 401) { window.location.replace('/admin?reason=expired'); return true; } return false; }
  async function load() {
    const request = ++token; loading = true; loadError = '';
    try { const value = await readSite(); if (disposed || request !== token) return; fill(value); }
    catch (cause) { if (disposed || request !== token || expired(cause)) return; loadError = cause instanceof Error ? cause.message : '站点设置读取失败'; }
    finally { if (!disposed && request === token) loading = false; }
  }
  onMount(() => { void load(); return () => { disposed = true; token++; }; });
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (saving) return; saving = true; notice = ''; error = '';
    try { const value = await updateSite({ title, subtitle, footer_tagline: tagline, description, default_theme: theme }); if (disposed) return; fill(value); applySiteDefaultTheme(value.default_theme); notice = '站点设置已保存。'; await invalidateAll(); }
    catch (cause) { if (disposed || expired(cause)) return; error = cause instanceof Error ? cause.message : '保存失败，请重试'; }
    finally { if (!disposed) saving = false; }
  }
  async function change(kind: 'favicon' | 'logo', action: () => Promise<Site>) {
    if (imageBusy) return; imageBusy = kind; imageError = { ...imageError, [kind]: '' };
    try { const value = await action(); if (disposed) return; site = value; await invalidateAll(); }
    catch (cause) { if (disposed || expired(cause)) return; imageError = { ...imageError, [kind]: cause instanceof Error ? cause.message : '图片更新失败，请重试' }; }
    finally { if (!disposed) imageBusy = null; }
  }
</script>
<svelte:head><title>{pageTitle('站点设置', page.data.site)}</title></svelte:head>
<PageHeader title="站点设置" description="管理站点名称、标语、默认外观和图标。" />
<SettingsTabs current="site" />
{#if loading}<div class="mt-6"><FeedbackState kind="loading" title="正在读取站点设置…" /></div>
{:else if loadError}<div class="mt-6"><FeedbackState kind="error" title={loadError}><button type="button" class="button-secondary mt-3" onclick={() => void load()}>重新读取</button></FeedbackState></div>
{:else if site}
  <form onsubmit={save} class="aux-panel mt-6 space-y-5" aria-busy={saving}>
    <h2 class="text-xl font-semibold">文字</h2>
    <label class="block">站点标题<input required maxlength="40" bind:value={title} disabled={saving} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">侧栏副标题<input maxlength="40" bind:value={subtitle} disabled={saving} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">页脚标语<input maxlength="80" bind:value={tagline} disabled={saving} class="mt-2 block w-full rounded border p-2" /></label>
    <label class="block">站点描述<textarea maxlength="200" rows="3" bind:value={description} disabled={saving} class="mt-2 block w-full rounded border p-2"></textarea></label>
    <fieldset class="space-y-2"><legend class="font-semibold">默认外观</legend><p class="text-sm text-muted-foreground">访客未在本机手动切换时使用；手动切换始终优先。</p>
      {#each themes as option}<label class="flex items-center gap-3"><input type="radio" name="default-theme" value={option.value} bind:group={theme} disabled={saving} />{option.label}</label>{/each}
    </fieldset>
    <button class="button-primary" disabled={saving}>{saving ? '保存中…' : '保存站点设置'}</button>
    {#if notice}<FeedbackState kind="success" title={notice} />{/if}{#if error}<FeedbackState kind="error" title={error} />{/if}
  </form>
  <section class="aux-panel mt-6 space-y-6" aria-labelledby="images-title">
    <h2 id="images-title" class="text-xl font-semibold">图标</h2>
    <p class="text-sm text-muted-foreground">支持 PNG、JPEG、WebP，不超过 5 MiB；自动居中裁成正方形并移除元数据。</p>
    <ImageUpload label="站内标志" src={site.logo_url} fallback={brandInitial(site.title)} busy={imageBusy === 'logo'} error={imageError.logo} hint="显示在侧栏、顶栏和分享图。" onselect={file => void change('logo', () => uploadSiteImage('logo', file))} onremove={() => void change('logo', () => removeSiteImage('logo'))} />
    <ImageUpload label="浏览器图标" src={site.favicon_url} fallback={brandInitial(site.title)} busy={imageBusy === 'favicon'} error={imageError.favicon} hint="显示在浏览器标签页。" onselect={file => void change('favicon', () => uploadSiteImage('favicon', file))} onremove={() => void change('favicon', () => removeSiteImage('favicon'))} />
  </section>
{/if}
