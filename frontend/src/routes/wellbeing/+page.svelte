<script lang="ts">
  import { onMount } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import WellbeingDayEditor from '#lib/components/WellbeingDayEditor.svelte';
  import WellbeingMedications from '#lib/components/WellbeingMedications.svelte';
  import WellbeingHistory from '#lib/components/WellbeingHistory.svelte';
  import WellbeingReport from '#lib/components/WellbeingReport.svelte';
  import WellbeingTrends from '#lib/components/WellbeingTrends.svelte';
  import { todayIn } from '#lib/api/wellbeing.ts';
  // Private health diary. Nothing from this page is written to localStorage/sessionStorage; drafts live only in memory.
  type Tab = 'today' | 'medications' | 'history' | 'trends' | 'report';
  const TABS: { id: Tab; label: string }[] = [{ id: 'today', label: '今日' }, { id: 'medications', label: '药物' }, { id: 'history', label: '历史' }, { id: 'trends', label: '趋势' }, { id: 'report', label: '总结' }];
  const timezone = $derived(page.data.user?.timezone ?? 'Asia/Shanghai');
  let today = $state(todayIn(page.data.user?.timezone ?? 'Asia/Shanghai'));
  const initial = page.url.searchParams.get('tab');
  let tab = $state<Tab>(TABS.some(item => item.id === initial) ? initial as Tab : 'today');
  let unsaved = $state(false);
  // Switching sections slides the page the way the tabs are laid out: a section further right comes in from the right, one further left from the left.
  let direction = $state(1);
  const motionMs = (ms: number) => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;

  /** True when it is fine to leave the current work; otherwise asks first so a draft is never dropped silently. */
  function canLeave(): boolean { return !unsaved || window.confirm('有未保存的内容，离开后会丢失。确定离开吗？'); }
  function choose(next: Tab) {
    if (next === tab || !canLeave()) return;
    direction = TABS.findIndex(item => item.id === next) > TABS.findIndex(item => item.id === tab) ? 1 : -1;
    unsaved = false; tab = next;
    void goto(next === 'today' ? page.url.pathname : `?tab=${next}`, { state: {}, shallow: true, replace: true }).catch(() => { /* The address is a convenience only. */ });
  }
  beforeNavigate(({ cancel, willUnload }) => { if (unsaved && (willUnload || !window.confirm('有未保存的内容，离开后会丢失。确定离开吗？'))) cancel(); });
  onMount(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !unsaved) today = todayIn(timezone); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  });
</script>

<svelte:head><title>{pageTitle('身心健康', page.data.site)}</title></svelte:head>
<PageHeader title="身心健康" description="记录每天的情绪、睡眠、服药和身体反应，方便自己观察变化。这里只做记录，不提供诊断或用药建议。">
  {#snippet footer()}
    <div class="settings-tabs wellbeing-tabs" role="group" aria-label="身心健康分区">
      {#each TABS as item (item.id)}<button type="button" aria-pressed={tab === item.id} onclick={() => choose(item.id)} data-testid={`wellbeing-tab-${item.id}`}>{item.label}</button>{/each}
    </div>
  {/snippet}
</PageHeader>
<div class="wellbeing-page" data-testid="wellbeing-page">
  <!-- The old section slides out while the new one slides in over it (same grid cell), so the page never blinks empty. -->
  <div class="stage">
    {#key tab}
      <div class="pane" in:fly={{ x: direction * 64, duration: motionMs(340), easing: cubicOut }} out:fly={{ x: -direction * 64, duration: motionMs(200), easing: cubicIn }}>
        {#if tab === 'today'}<WellbeingDayEditor day={today} onunsaved={(value) => { unsaved = value; }} />{/if}
        {#if tab === 'medications'}<WellbeingMedications {today} {timezone} />{/if}
        {#if tab === 'history'}<WellbeingHistory {today} {timezone} onunsaved={(value) => { unsaved = value; }} onrequestswitch={canLeave} />{/if}
        {#if tab === 'trends'}<WellbeingTrends />{/if}
        {#if tab === 'report'}<WellbeingReport {today} {timezone} />{/if}
      </div>
    {/key}
  </div>
  <details class="privacy">
    <summary>这些记录如何保存</summary>
    <p>记录只属于你的账号，只有登录后的你能看到。它们不会出现在公开主页、足迹墙、分享链接或跑步海报里，也不会发给 AI 或任何第三方。草稿只保留在当前页面内存中，不写入浏览器本地存储。</p>
  </details>
</div>

<style>
  .wellbeing-page { display: grid; gap: var(--space-6); min-width: 0; margin-top: var(--space-6); }
  /* Four short labels share the width on phones instead of hiding the last one behind a sideways scroll. */
  .stage { display: grid; min-width: 0; overflow-x: clip; }
  .pane { grid-area: 1 / 1; min-width: 0; }
  .wellbeing-tabs { overflow-x: visible; }
  .wellbeing-tabs > :global(button) { flex: 1 1 0; min-width: 0; padding-inline: var(--space-2); white-space: nowrap; }
  .privacy { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .privacy summary { cursor: pointer; color: var(--primary); font-weight: var(--weight-medium); }
  .privacy p { margin-top: var(--space-2); max-width: 48rem; }
</style>
