<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { glassOptics, readGlassSettings, watchGlassSettings } from '#lib/styles/liquid-glass-settings.ts';
  import { preparePopoverMotion, positionPopoverMotion } from '#lib/styles/popover-motion.ts';
  import { bindVisualViewport, popoverSupported, visualViewportBox } from '#lib/styles/browser-support.ts';
  import { attachMenuGlass } from '#lib/styles/menu-glass.ts';
  let { label, panelLabel, inline = false, trigger, children }: { label: string; panelLabel: string; inline?: boolean; trigger: Snippet; children: Snippet } = $props();
  const id = $props.id();
  let panel: HTMLDivElement, anchor: HTMLDivElement;
  let expanded = $state(false), top = $state(0), right = $state(0), mounted = $state(false);
  let releaseGlass: (() => void) | undefined;
  export function close() { if (panel?.matches(':popover-open')) panel.hidePopover(); }
  function position() {
    if (inline || !panel?.matches(':popover-open')) return;
    // Measure the stable wrapper, never the spring-animated trigger button.
    const box = anchor.getBoundingClientRect();
    const view = visualViewportBox();
    const height = panel.offsetHeight || 280;
    const desired = box.bottom + 8 + height <= view.top + view.height - 12 ? box.bottom + 8 : box.top - 8 - height;
    top = Math.max(view.top + 12, Math.min(desired, view.top + view.height - height - 12));
    const width = panel.offsetWidth;
    const left = view.left + Math.max(12, Math.min(box.right - view.left - width, view.width - width - 12));
    right = window.innerWidth - (left + width);
    positionPopoverMotion(panel, box, { left, top });
  }
  function glass(node: HTMLDivElement) {
    let surface: ReturnType<typeof attachMenuGlass> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settings = readGlassSettings();
    const release = () => { surface?.destroy(); surface = undefined; };
    releaseGlass = () => { clearTimeout(timer); release(); };
    const stop = watchGlassSettings(value => { settings = value; surface?.update({ ...glassOptics(value, .7), chroma: 0 }); });
    const toggled = (event: Event) => {
      clearTimeout(timer);
      expanded = (event as ToggleEvent).newState === 'open';
      if (!expanded) { timer = setTimeout(release, 240); return; }
      position();
      surface ??= attachMenuGlass(node, settings);
    };
    node.addEventListener('toggle', toggled);
    return { destroy() { clearTimeout(timer); stop(); node.removeEventListener('toggle', toggled); release(); } };
  }
  // Going inline drops the popover attribute. Browsers close the popover then and fire toggle, but do not rely on it: reset here too.
  $effect(() => { if (inline) { expanded = false; releaseGlass?.(); } });
  function toggle(event: MouseEvent) {
    event.preventDefault();
    if (!popoverSupported() || typeof panel.togglePopover !== 'function') return;
    if (!panel.matches(':popover-open')) preparePopoverMotion(panel);
    panel.togglePopover();
    if (panel.matches(':popover-open')) position();
  }
  onMount(() => { mounted = true; return bindVisualViewport(position); });
</script>
<svelte:window onresize={position} onscroll={position} />
<div class="anchored" class:inline data-glass-stable>
  <!-- popovertarget is only set once mounted: before hydration the browser would open the panel by itself, unpositioned at top:0 / right:0, and hydration would close it again. -->
  <div bind:this={anchor} class="anchored-anchor">
    <button type="button" popovertarget={mounted ? id : undefined} aria-label={label} aria-expanded={expanded} aria-controls={id} class="button-secondary anchored-trigger" title={label} onclick={toggle}>{@render trigger()}</button>
  </div>
  <div bind:this={panel} use:glass {id} popover={inline ? undefined : 'auto'} class="anchored-panel" class:rn-glass-menu={!inline}
    role={inline ? undefined : 'group'} aria-label={inline ? undefined : panelLabel} style:top={inline ? undefined : `${top}px`} style:right={inline ? undefined : `${right}px`}>
    {@render children()}
  </div>
</div>
<style>
  .anchored-anchor { display: inline-flex; }
  .anchored.inline .anchored-anchor { display: none; }
  .anchored-trigger { width: 2.75rem; height: 2.75rem; padding: 0; border-radius: var(--radius-pill); }
  .anchored-panel { width: 20rem; max-width: calc(100vw - var(--space-8)); max-height: calc(100dvh - var(--space-6)); }
  .anchored.inline .anchored-panel { width: auto; max-width: none; max-height: none; }
</style>
