import { describe, expect, it } from 'vitest';
import { followViewportWidth, isElementShown, popoverSupported, visualViewportBox } from '../../src/lib/styles/browser-support.ts';

describe('visual viewport geometry', () => {
  it('falls back to the layout viewport when visualViewport is missing', () => {
    expect(visualViewportBox({ innerWidth: 390, innerHeight: 700, visualViewport: null })).toEqual({ left: 0, top: 0, width: 390, height: 700 });
  });

  it('uses the visual viewport offset when the keyboard or pinch zoom shifts it', () => {
    const visualViewport = { offsetLeft: 12, offsetTop: 80, width: 360, height: 420 } as VisualViewport;
    expect(visualViewportBox({ innerWidth: 390, innerHeight: 844, visualViewport })).toEqual({ left: 12, top: 80, width: 360, height: 420 });
  });
});

describe('viewport resize policy', () => {
  it('repositions on height-only resize and on visualViewport movement, and closes only when the width changes', () => {
    const listeners = new Map<string, Set<() => void>>();
    const visualListeners = new Map<string, Set<() => void>>();
    const listen = (store: Map<string, Set<() => void>>) => (type: string, listener: EventListener) => {
      const set = store.get(type) ?? new Set<() => void>();
      set.add(listener as () => void);
      store.set(type, set);
    };
    const forget = (store: Map<string, Set<() => void>>) => (type: string, listener: EventListener) => {
      store.get(type)?.delete(listener as () => void);
    };
    const visualViewport = {
      addEventListener: listen(visualListeners),
      removeEventListener: forget(visualListeners),
    } as unknown as VisualViewport;
    const view = {
      innerWidth: 390, innerHeight: 800, visualViewport,
      addEventListener: listen(listeners),
      removeEventListener: forget(listeners),
    };
    const moves: string[] = [];
    const stop = followViewportWidth(() => moves.push('move'), () => moves.push('close'), view as unknown as Window);
    listeners.get('resize')?.forEach(fn => fn());
    expect(moves).toEqual(['move']);
    visualListeners.get('scroll')?.forEach(fn => fn());
    visualListeners.get('resize')?.forEach(fn => fn());
    expect(moves).toEqual(['move', 'move', 'move']);
    view.innerWidth = 320;
    listeners.get('resize')?.forEach(fn => fn());
    expect(moves).toEqual(['move', 'move', 'move', 'close']);
    stop();
    expect(listeners.get('resize')?.size).toBe(0);
    expect(visualListeners.get('resize')?.size).toBe(0);
    expect(visualListeners.get('scroll')?.size).toBe(0);
  });
});

describe('older engine guards', () => {
  it('does not throw when popover and checkVisibility are absent', () => {
    expect(typeof popoverSupported()).toBe('boolean');
    const shown = { getClientRects: () => [{ } as DOMRect] } as unknown as HTMLElement;
    expect(isElementShown(shown)).toBe(true);
    const hidden = { getClientRects: () => [] as unknown as DOMRectList, checkVisibility: () => false } as unknown as HTMLElement;
    expect(isElementShown(hidden)).toBe(false);
  });
});
