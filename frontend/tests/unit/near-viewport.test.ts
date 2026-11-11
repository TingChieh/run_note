import { afterEach, expect, it, vi } from 'vitest';
import { whenNearViewport } from '../../src/lib/near-viewport.ts';

type Callback = (entries: { isIntersecting: boolean }[]) => void;
const observers: { callback: Callback; options: unknown; disconnected: boolean }[] = [];
class FakeObserver {
  record: (typeof observers)[number];
  constructor(callback: Callback, options: unknown) {
    this.record = { callback, options, disconnected: false };
    observers.push(this.record);
  }
  observe() {}
  disconnect() {
    this.record.disconnected = true;
  }
}
afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

it('starts once when the element comes near, with the given margin', () => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  const start = vi.fn();
  whenNearViewport({} as Element, start, '300px 0px');
  expect(observers[0].options).toEqual({ rootMargin: '300px 0px' });
  observers[0].callback([{ isIntersecting: false }]);
  expect(start).not.toHaveBeenCalled();
  observers[0].callback([{ isIntersecting: true }]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(observers[0].disconnected).toBe(true);
});

it('never starts after it was cancelled', () => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  const start = vi.fn();
  const cancel = whenNearViewport({} as Element, start);
  cancel();
  expect(observers[0].disconnected).toBe(true);
});

it('starts at once where IntersectionObserver is missing', () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const start = vi.fn();
  whenNearViewport({} as Element, start)();
  expect(start).toHaveBeenCalledTimes(1);
});
