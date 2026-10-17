import { createSpring } from '../vendor/liquidglass/liquid-glass.js';

export function coverflowGeometry(viewportWidth: number, cardWidth: number) {
  // Side cards fan out like a hand: reserve room for their roll and keep every
  // side card's center (past the raised, hover-scaled main card) clickable.
  const available = viewportWidth - cardWidth * 1.35 - 16;
  const radius = Math.max(0, Math.min(3, Math.floor(available / (cardWidth * 1.12))));
  const compact = viewportWidth < 480, perspective = compact ? 1300 : 900;
  // A single-card mobile window still needs horizontal travel so adjacent
  // buffers can slide into view.
  const step = radius ? Math.min(cardWidth * .72, available / (radius * 2)) : cardWidth + 16;
  return { radius, compact, perspective, step: Math.max(0, step), cardWidth };
}
type Geometry = ReturnType<typeof coverflowGeometry>;

/** The center card is drawn up out of the hand; neighbours sink, shrink and roll outwards. */
export function coverflowPosition(offset: number, geometry: Geometry) {
  const distance = Math.abs(offset), depth = Math.min(distance, geometry.radius + 1);
  const side = Math.sign(offset) * depth;
  return {
    x: offset * geometry.step,
    y: geometry.cardWidth * (.06 * depth + .02 * depth * depth),
    z: 0, scale: 1 - .04 * depth, rotation: 0, roll: side * 3.5,
    opacity: Math.max(0, Math.min(1, geometry.radius + 1 - distance))
  };
}

type Options = { center: number; geometry: Geometry; windowVersion: number; reducedMotion: boolean; onsettled: () => void };

/** One continuous index drives the entire deck, including entering/leaving buffers. */
export function coverflow(node: HTMLElement, initial: Options) {
  let options = initial, disposed = false, moving = false;
  let slots: HTMLElement[] = [];
  function render(value: number, velocity = 0) {
    if (disposed) return;
    node.style.perspective = `${options.geometry.perspective}px`;
    for (const slot of slots) {
      const offset = Number(slot.dataset.index) - value;
      const position = coverflowPosition(offset, options.geometry);
      slot.style.transform = `translate3d(${position.x}px, ${position.y}px, ${position.z}px) rotateY(${position.rotation}deg) rotate(${position.roll}deg) scale(${position.scale})`;
      slot.style.opacity = String(position.opacity);
      slot.style.zIndex = String(100 - Math.round(Math.abs(offset) * 10));
    }
    if (moving && value === options.center && velocity === 0) {
      moving = false; node.dataset.moving = 'false'; options.onsettled();
    }
  }
  const spring = createSpring(initial.center, render, { stiffness: 300, damping: 28 });
  function refresh() {
    slots = [...node.querySelectorAll<HTMLElement>('.stack-slot')];
    render(spring.value);
  }
  node.dataset.moving = 'false';
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(node, { childList: true });
  return {
    update(next: Options) {
      const first = options.center < 0;
      options = next; refresh();
      if (first || next.reducedMotion) {
        // Immediate positioning still completes a window transition and prunes old slots.
        moving = true;
        spring.set(next.center, { immediate: true });
      }
      else if (next.center !== spring.target) {
        moving = true; node.dataset.moving = 'true'; spring.set(next.center);
      }
      else if (!moving) next.onsettled();
    },
    destroy() {
      disposed = true; spring.stop(); observer.disconnect(); slots = [];
    }
  };
}

type Navigation = { onbrowse: (direction: number, focusCard: boolean) => void };

/** Horizontal gestures browse continuously; vertical scrolling remains native. */
export function coverflowNavigation(node: HTMLElement, initial: Navigation) {
  let options = initial;
  let gesture: { id: number; x: number; y: number; horizontal: boolean } | undefined;
  let suppressUntil = 0;
  let wheelTime = -Infinity, wheelDirection = 0, wheelDistance = 0;
  function keydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    options.onbrowse(event.key === 'ArrowLeft' ? -1 : 1, event.target instanceof Element && !!event.target.closest('.wall-card'));
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element) || !event.target.closest('.stack-viewport')) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
  }
  function move(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = Math.abs(event.clientX - gesture.x), dy = Math.abs(event.clientY - gesture.y);
    if (!gesture.horizontal && dy > 12 && dy > dx * 1.2) { release(); return; }
    if (!gesture.horizontal && dx > 12 && dx > dy * 1.2) {
      gesture.horizontal = true; node.setPointerCapture(gesture.id); node.dataset.dragging = 'true';
    }
  }
  function release() {
    const previous = gesture; gesture = undefined;
    if (previous && node.hasPointerCapture(previous.id)) node.releasePointerCapture(previous.id);
    delete node.dataset.dragging;
  }
  function up(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    const horizontal = gesture.horizontal;
    if (horizontal) suppressUntil = performance.now() + 400;
    release();
    if (horizontal && Math.abs(dx) >= 32 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      const steps = Math.min(4, Math.max(1, Math.floor(Math.abs(dx) / 80)));
      options.onbrowse((dx < 0 ? 1 : -1) * steps, false);
    }
  }
  function cancel(event: PointerEvent) { if (event.pointerId === gesture?.id) release(); }
  // Touch starts with implicit capture on the card. Its bubbled loss during
  // transfer to this navigation node is not a cancellation of the gesture.
  function lostCapture(event: PointerEvent) { if (event.target === node) cancel(event); }
  function wheel(event: WheelEvent) {
    if (event.ctrlKey || !(event.target instanceof Element) || !event.target.closest('.stack-viewport')) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.2) return;
    event.preventDefault();
    const now = performance.now(), direction = Math.sign(event.deltaX);
    if (now - wheelTime > 180 || direction !== wheelDirection) {
      wheelDistance = 0;
    }
    wheelTime = now; wheelDirection = direction;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1;
    wheelDistance += Math.abs(event.deltaX) * unit;
    if (wheelDistance >= 48) {
      const steps = Math.min(4, Math.floor(wheelDistance / 48));
      wheelDistance %= 48; options.onbrowse(direction * steps, false);
    }
  }
  function click(event: MouseEvent) {
    if (event.detail > 0 && performance.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  node.addEventListener('keydown', keydown);
  node.addEventListener('pointerdown', down);
  node.addEventListener('lostpointercapture', lostCapture);
  node.addEventListener('wheel', wheel, { passive: false });
  node.addEventListener('click', click, true);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up, { passive: true });
  window.addEventListener('pointercancel', cancel, { passive: true });
  window.addEventListener('blur', release);
  return {
    update(next: Navigation) { options = next; },
    destroy() {
      release(); node.removeEventListener('keydown', keydown); node.removeEventListener('pointerdown', down);
      node.removeEventListener('lostpointercapture', lostCapture); node.removeEventListener('wheel', wheel);
      node.removeEventListener('click', click, true); window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', release);
    }
  };
}
