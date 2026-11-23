<script lang="ts">
  import { onMount } from 'svelte';
  import { glassOptics, readGlassSettings, watchGlassSettings } from '#lib/styles/liquid-glass-settings.ts';
  import { preparePopoverMotion, positionPopoverMotion } from '#lib/styles/popover-motion.ts';
  import { bindVisualViewport, popoverSupported, visualViewportBox } from '#lib/styles/browser-support.ts';
  import { attachMenuGlass } from '#lib/styles/menu-glass.ts';
  import type { createIndicator } from '#lib/styles/liquid-glass-indicator.ts';

  let {
    title,
    disabled = false,
    onrename,
    ondelete,
  }: {
    title: string;
    disabled?: boolean;
    onrename: () => void;
    ondelete: () => void;
  } = $props();

  const id = $props.id();
  const displayTitle = $derived(title || '未命名会话');
  const triggerLabel = $derived(`会话操作：${displayTitle}`);

  let anchor = $state<HTMLDivElement | undefined>();
  let trigger = $state<HTMLButtonElement | undefined>();
  let panel = $state<HTMLDivElement | undefined>();
  let mounted = $state(false);
  let expanded = $state(false);
  let top = $state(0);
  let left = $state(0);

  function menuItems(): HTMLButtonElement[] {
    return [...(panel?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  }

  function position() {
    if (!anchor || !panel?.matches(':popover-open')) return;
    // Measure the stable wrapper, never an animated trigger button.
    const box = anchor.getBoundingClientRect();
    const view = visualViewportBox();
    const height = panel.offsetHeight || 112;
    const desired = box.bottom + 6 + height <= view.top + view.height - 12 ? box.bottom + 6 : box.top - 6 - height;
    top = Math.max(view.top + 12, Math.min(desired, view.top + view.height - height - 12));
    const width = panel.offsetWidth || 176;
    const flushLeft = box.left + box.width / 2 < view.left + view.width / 2;
    const edge = flushLeft ? box.left - view.left : box.right - view.left - width;
    left = view.left + Math.max(12, Math.min(edge, view.width - width - 12));
    positionPopoverMotion(panel, box, { left, top });
  }

  function openMenu(focusTarget: 'none' | 'first' | 'last' = 'none') {
    if (disabled || !panel || !popoverSupported() || typeof panel.showPopover !== 'function') return;
    if (!panel.matches(':popover-open')) {
      preparePopoverMotion(panel);
      panel.showPopover();
    }
    if (panel.matches(':popover-open')) {
      position();
      const items = menuItems();
      if (focusTarget === 'first') items[0]?.focus();
      else if (focusTarget === 'last') items.at(-1)?.focus();
    }
  }

  function closeMenu(restoreFocus = false) {
    if (panel?.matches(':popover-open')) panel.hidePopover();
    if (restoreFocus) trigger?.focus();
  }

  function handleTriggerClick(event: MouseEvent) {
    event.preventDefault();
    if (disabled || !panel || !popoverSupported() || typeof panel.togglePopover !== 'function') return;
    if (panel.matches(':popover-open')) {
      panel.hidePopover();
      return;
    }
    // Keyboard activation (Enter / Space) fires click with detail === 0: move focus into the menu.
    openMenu(event.detail === 0 ? 'first' : 'none');
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu('last');
    } else if (event.key === 'Escape' && panel?.matches(':popover-open')) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    const items = menuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu(false);
    }
  }

  function chooseRename() {
    closeMenu(false);
    onrename();
  }

  function chooseDelete() {
    closeMenu(true);
    ondelete();
  }

  function glass(node: HTMLDivElement) {
    let surface: ReturnType<typeof attachMenuGlass> | undefined;
    let lens: ReturnType<typeof createIndicator> | undefined;
    let items: HTMLElement[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settings = readGlassSettings();
    const release = () => {
      lens?.destroy();
      lens = undefined;
      delete node.dataset.lensIdle;
      surface?.destroy();
      surface = undefined;
    };
    const stop = watchGlassSettings((value) => {
      settings = value;
      surface?.update({ ...glassOptics(value, 0.7), chroma: 0 });
      lens?.update(value);
    });
    const toggled = (event: Event) => {
      clearTimeout(timer);
      expanded = (event as ToggleEvent).newState === 'open';
      if (!expanded) {
        timer = setTimeout(release, 240);
        return;
      }
      position();
      surface ??= attachMenuGlass(node, settings);
      items = [...node.querySelectorAll<HTMLElement>('.rn-menu-option:not(:disabled)')];
      if (items.length && !lens) {
        void import('#lib/styles/liquid-glass-indicator.ts')
          .then(({ createIndicator: create }) => {
            if (lens || !node.matches(':popover-open')) return;
            lens = create(node, items, settings);
            const focusedIndex = items.indexOf(document.activeElement as HTMLElement);
            if (focusedIndex >= 0) {
              delete node.dataset.lensIdle;
              lens.refresh();
              lens.move(focusedIndex, true);
            } else {
              node.dataset.lensIdle = '';
              lens.refresh();
            }
          })
          .catch(() => {});
      }
    };
    const reach = (event: Event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.rn-menu-option');
      const index = target ? items.indexOf(target) : -1;
      if (index < 0 || !lens) return;
      const wasIdle = 'lensIdle' in node.dataset;
      delete node.dataset.lensIdle;
      lens.move(index, wasIdle);
    };
    const leave = () => {
      if (lens && !node.contains(document.activeElement)) node.dataset.lensIdle = '';
    };
    node.addEventListener('pointermove', reach);
    node.addEventListener('focusin', reach);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('toggle', toggled);
    return {
      destroy() {
        clearTimeout(timer);
        stop();
        node.removeEventListener('toggle', toggled);
        node.removeEventListener('pointermove', reach);
        node.removeEventListener('focusin', reach);
        node.removeEventListener('pointerleave', leave);
        release();
      },
    };
  }

  $effect(() => {
    if (disabled && panel?.matches(':popover-open')) panel.hidePopover();
  });

  // Intercept Escape in capture phase while open so a nested modal dialog (mobile history drawer) stays open and focus returns to the trigger.
  $effect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !panel?.matches(':popover-open')) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  });

  onMount(() => {
    mounted = true;
    const stopViewport = bindVisualViewport(position);
    const onScroll = (event: Event) => {
      if (panel?.matches(':popover-open') && !panel.contains(event.target as Node)) position();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      stopViewport();
      window.removeEventListener('scroll', onScroll, true);
    };
  });
</script>

<svelte:window onresize={position} />

<div class="conv-menu-host" data-glass-stable>
  <div bind:this={anchor} class="conv-menu-anchor">
    <button
      bind:this={trigger}
      type="button"
      popovertarget={mounted && !disabled ? id : undefined}
      aria-label={triggerLabel}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-controls={id}
      {disabled}
      class="conv-menu-trigger"
      title={triggerLabel}
      onclick={handleTriggerClick}
      onkeydown={handleTriggerKeydown}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.75" />
        <circle cx="12" cy="12" r="1.75" />
        <circle cx="19" cy="12" r="1.75" />
      </svg>
    </button>
  </div>

  <div
    bind:this={panel}
    use:glass
    {id}
    popover="auto"
    class="rn-glass-menu anchored-panel conv-action-menu"
    role="menu"
    tabindex="-1"
    aria-label={triggerLabel}
    style:top={`${top}px`}
    style:left={`${left}px`}
    onkeydown={handleMenuKeydown}
  >
    <div class="conv-action-list" role="none">
      <button type="button" role="menuitem" class="rn-menu-option conv-menu-item" {disabled} onclick={chooseRename}>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
        <span>重命名</span>
      </button>
      <button
        type="button"
        role="menuitem"
        class="rn-menu-option conv-menu-item"
        data-tone="danger"
        {disabled}
        onclick={chooseDelete}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
        <span>删除</span>
      </button>
    </div>
  </div>
</div>

<style>
  .conv-menu-host,
  .conv-menu-anchor {
    display: inline-flex;
    flex-shrink: 0;
  }
  .conv-menu-trigger {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    transition:
      color var(--transition-control),
      background-color var(--transition-control);
  }
  :global(.sport-theme) .conv-menu-trigger.conv-menu-trigger.conv-menu-trigger.conv-menu-trigger {
    background-color: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    border-color: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  .conv-menu-trigger > :global(.rn-glass-surface) {
    display: none !important;
  }
  @media (hover: hover) {
    :global(.sport-theme)
      .conv-menu-trigger.conv-menu-trigger.conv-menu-trigger.conv-menu-trigger:not(:disabled):hover {
      background-color: color-mix(in srgb, var(--foreground) 8%, transparent) !important;
      color: var(--foreground);
    }
  }
  :global(.sport-theme) .conv-menu-trigger.conv-menu-trigger.conv-menu-trigger.conv-menu-trigger[aria-expanded='true'] {
    background-color: color-mix(in srgb, var(--foreground) 10%, transparent) !important;
    color: var(--foreground);
  }
  .conv-menu-trigger:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
    color: var(--foreground);
  }
  .conv-menu-trigger:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .conv-action-menu {
    width: max-content;
    min-width: 9.5rem;
    max-width: min(14rem, calc(100vw - var(--space-6)));
    max-height: calc(100dvh - var(--space-6));
  }
  .conv-action-list {
    display: grid;
    gap: 0.125rem;
  }
  .conv-menu-item {
    gap: var(--space-2);
    white-space: nowrap;
  }
</style>
