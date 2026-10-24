<script lang="ts">
  import { setBasemapPreference, type BasemapPreference, type BasemapStyle, type BasemapStatus } from '#lib/api/map-style.ts';
  import { createGlass } from '#lib/vendor/liquidglass/liquid-glass.js';
  import { createIndicator } from '#lib/styles/liquid-glass-indicator.ts';
  import { readGlassSettings, watchGlassSettings, glassOptics } from '#lib/styles/liquid-glass-settings.ts';
  import { preparePopoverMotion, positionPopoverMotion } from '#lib/styles/popover-motion.ts';
  let { preference, style, status, onselect = setBasemapPreference }: { preference: BasemapPreference; style: BasemapStyle; status: BasemapStatus; onselect?: (value: BasemapPreference) => void } = $props();
  let indicator: ReturnType<typeof createIndicator> | undefined;
  const id = $props.id();
  let panel: HTMLDivElement, trigger: HTMLButtonElement, expanded = $state(false);
  let top = $state(0), right = $state(0);
  function position() {
    if (!trigger || !panel?.matches(':popover-open')) return;
    const box = trigger.parentElement!.getBoundingClientRect();
    const height = panel?.offsetHeight || 280;
    const desired = box.bottom + 8 + height <= window.innerHeight - 12 ? box.bottom + 8 : box.top - 8 - height;
    top = Math.max(12, Math.min(desired, window.innerHeight - height - 12));
    right = Math.max(12, Math.min(window.innerWidth - box.right, window.innerWidth - panel.offsetWidth - 12));
    positionPopoverMotion(panel, box, { left: window.innerWidth - right - panel.offsetWidth, top });
  }
  function menuGlass(node: HTMLDivElement) {
    let glass: ReturnType<typeof createGlass> | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let settings = readGlassSettings();
    const release = () => { indicator?.destroy(); indicator = undefined; glass?.destroy(); glass = undefined; };
    const stop = watchGlassSettings(value => { settings = value; glass?.update({ ...glassOptics(value, .7), chroma: 0 }); indicator?.update(value); });
    const toggle = (event: Event) => {
      clearTimeout(cleanupTimer);
      expanded = (event as ToggleEvent).newState === 'open';
      if (!expanded) { cleanupTimer = setTimeout(release, 240); return; }
      position();
      const buttons = [...node.querySelectorAll<HTMLButtonElement>('.rn-menu-option')];
      if (!glass) glass = createGlass(node, { mode: 'backdrop', fit: true, radius: 24, ...glassOptics(settings, .7), chroma: 0, fallback: `blur(${16 + settings.blur}px) saturate(1.6)` });
      indicator ??= createIndicator(node, buttons, settings);
      indicator.refresh();
      indicator.move(Math.max(0, buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true')), true);
    };
    node.addEventListener('toggle', toggle);
    return { destroy() { clearTimeout(cleanupTimer); stop(); node.removeEventListener('toggle', toggle); release(); } };
  }
  function togglePanel(event: MouseEvent) {
    event.preventDefault();
    if (!panel.matches(':popover-open')) preparePopoverMotion(panel);
    panel.togglePopover();
    // Measure the laid-out panel before its first paint, using the stable wrapper
    // rather than the spring-animated trigger's transient bounding rectangle.
    if (panel.matches(':popover-open')) position();
  }
  function choose(value: BasemapPreference) { onselect(value); panel.hidePopover(); trigger.focus(); }
</script>
<svelte:window onresize={position} onscroll={position} />
<div class="basemap-picker" data-glass-stable data-basemap-status={status} data-basemap-style={style}>
  <button bind:this={trigger} type="button" popovertarget={id} aria-label="切换底图" aria-expanded={expanded} aria-controls={id} class="button-secondary" title="切换底图" onclick={togglePanel}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></svg><span>图层</span>
  </button>
  <div bind:this={panel} use:menuGlass {id} popover="auto" class="rn-glass-menu basemap-options" role="group" aria-label="底图样式" style:top={`${top}px`} style:right={`${right}px`}>
    <p>地图底图</p>
    {#each [{ value: 'auto', label: '自动（跟随外观）' }, { value: 'positron', label: 'Positron' }, { value: 'dark', label: 'Dark' }, { value: 'liberty', label: 'Liberty' }] as option, index}
      <button type="button" class="rn-menu-option" onpointermove={() => indicator?.move(index)} onfocus={() => indicator?.move(index)} aria-pressed={preference === option.value} onclick={() => choose(option.value as BasemapPreference)}>{option.label}</button>
    {/each}
    <small>自动模式：浅色 Positron · 深色 Dark</small>
  </div>
</div>
<style>
  .basemap-picker { position:absolute; top:var(--space-3); right:calc(var(--space-3) + 44px); z-index:2; }
  .basemap-picker > button { display:flex; align-items:center; gap:var(--space-2); background:var(--surface); }
  .basemap-options { width:16rem; max-width:calc(100vw - var(--space-8)); max-height:calc(100dvh - var(--space-6)); }
  .basemap-options p { padding:var(--space-2) var(--space-3); font-size:var(--text-small); font-weight: var(--weight-semibold); color:var(--muted-foreground); }
  .basemap-options .rn-menu-option[aria-pressed='true'] { font-weight: var(--weight-semibold); }
  .basemap-options button:focus-visible { z-index:5; outline-offset:-3px; }
  small { display:block; padding:var(--space-2) var(--space-3); font-size:var(--text-small); color:var(--muted-foreground); }

</style>
