import { backOut, cubicIn } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

// Animate layout width as well as the field so the adjacent unit travels with it.
export function goalInputPop(node: HTMLElement): (options?: { direction: 'in' | 'out' }) => TransitionConfig {
  const style = getComputedStyle(node);
  const width = parseFloat(style.width);
  const left = parseFloat(style.paddingLeft), right = parseFloat(style.paddingRight);
  return ({ direction } = { direction: 'in' }) => ({
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : direction === 'in' ? 420 : 220,
    easing: direction === 'in' ? backOut : cubicIn,
    css: t => `width:${width * t}px;padding-left:${left * t}px;padding-right:${right * t}px;opacity:${t};transform:scale(${.08 + .92 * Math.min(t, 1)});transform-origin:left center;`
  });
}
