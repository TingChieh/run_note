import { cubicIn, cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/** Buttons slide out from behind the last non-revealed sibling to their left; `delay` staggers a group. */
export function revealFromLeft(node: HTMLElement, { delay = 0 }: { delay?: number } = {}): (options?: { direction: 'in' | 'out' }) => TransitionConfig {
  const anchor = [...(node.parentElement?.children ?? [])].reverse()
    .find(child => child instanceof HTMLElement && !child.hasAttribute('data-reveal'));
  const distance = anchor ? Math.max(0, node.getBoundingClientRect().left - anchor.getBoundingClientRect().right + 12) : 24;
  return ({ direction } = { direction: 'in' }) => ({
    delay: direction === 'in' ? delay : 0,
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : direction === 'in' ? 380 : 200,
    easing: direction === 'in' ? cubicOut : cubicIn,
    css: t => `opacity:${Math.min(1, t * 1.6)};transform:translateX(${-(1 - t) * distance}px) scale(${.9 + .1 * t});transform-origin:left center;`
  });
}

/** Unfold a bar vertically (height, spacing and fade together) so content below glides instead of jumping. */
export function unfoldBar(node: HTMLElement): (options?: { direction: 'in' | 'out' }) => TransitionConfig {
  const style = getComputedStyle(node);
  const height = node.offsetHeight, top = parseFloat(style.paddingTop), bottom = parseFloat(style.paddingBottom);
  const margin = parseFloat(style.marginBottom), border = parseFloat(style.borderTopWidth);
  return ({ direction } = { direction: 'in' }) => ({
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : direction === 'in' ? 360 : 220,
    easing: direction === 'in' ? cubicOut : cubicIn,
    css: t => `overflow:hidden;height:${height * t}px;padding-top:${top * t}px;padding-bottom:${bottom * t}px;margin-bottom:${margin * t}px;border-width:${border * t}px;opacity:${t};transform:translateY(${-(1 - t) * 6}px);`
  });
}
