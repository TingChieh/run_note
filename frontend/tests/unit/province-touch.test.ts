import { describe, expect, it } from 'vitest';
import {
  applyGlobePinchPan,
  applyGlobePinchZoom,
  applyMercatorPinch,
  TouchGestureTracker,
} from '../../src/lib/map/province-touch';

describe('TouchGestureTracker', () => {
  it('tracks single-finger drag, tap, and fling eligibility', () => {
    const tracker = new TouchGestureTracker();
    expect(tracker.mode).toBe('idle');

    // Short tap (< 6px)
    expect(tracker.down(1, 100, 100)).toEqual({ kind: 'drag-start' });
    expect(tracker.mode).toBe('drag');
    expect(tracker.move(1, 102, 101)).toEqual({ kind: 'drag-move', dx: 2, dy: 1 });
    expect(tracker.up(1)).toEqual({ kind: 'end', wasTap: true, canFling: false });
    expect(tracker.mode).toBe('idle');

    // Drag (>= 6px)
    expect(tracker.down(2, 100, 100)).toEqual({ kind: 'drag-start' });
    expect(tracker.move(2, 120, 105)).toEqual({ kind: 'drag-move', dx: 20, dy: 5 });
    expect(tracker.up(2)).toEqual({ kind: 'end', wasTap: false, canFling: true });
    expect(tracker.mode).toBe('idle');
  });

  it('tracks 2-finger pinch zoom-in, zoom-out, and midpoint pan without accidental tap', () => {
    const tracker = new TouchGestureTracker();
    expect(tracker.down(1, 100, 200)).toEqual({ kind: 'drag-start' });
    expect(tracker.down(2, 200, 200)).toEqual({ kind: 'pinch-start' });
    expect(tracker.mode).toBe('pinch');

    // Spread fingers from span 100 to 200 while moving midpoint right by 10px
    const step1 = tracker.move(1, 60, 200);
    const step2 = tracker.move(2, 260, 200);
    expect(step1.kind).toBe('pinch-move');
    expect(step2.kind).toBe('pinch-move');
    if (step1.kind === 'pinch-move' && step2.kind === 'pinch-move') {
      const netFactor = step1.scaleFactor * step2.scaleFactor;
      const netMidDx = step1.dMidX + step2.dMidX;
      expect(netFactor).toBeCloseTo(0.5, 6);
      expect(netMidDx).toBeCloseTo(10, 6);
    }

    // Pinch back together (span 200 -> 100) in the same continuous gesture
    const back1 = tracker.move(1, 110, 200);
    const back2 = tracker.move(2, 210, 200);
    if (back1.kind === 'pinch-move' && back2.kind === 'pinch-move') {
      expect(back1.scaleFactor * back2.scaleFactor).toBeCloseTo(2.0, 6);
    }

    // Lift one finger then immediately lift the second: must NOT trigger tap or fling
    expect(tracker.up(2)).toEqual({ kind: 'pinch-to-drag' });
    expect(tracker.mode).toBe('drag');
    expect(tracker.up(1)).toEqual({ kind: 'end', wasTap: false, canFling: false });
    expect(tracker.mode).toBe('idle');
  });

  it('resumes single-finger drag smoothly after lifting one pinch finger', () => {
    const tracker = new TouchGestureTracker();
    tracker.down(1, 100, 100);
    tracker.down(2, 200, 100);
    tracker.move(1, 80, 100);
    tracker.move(2, 220, 100);

    // Finger 2 lifts while finger 1 stays at (80, 100)
    expect(tracker.up(2)).toEqual({ kind: 'pinch-to-drag' });
    // Moving finger 1 by +15px must report exact dx=+15 with zero jump to finger 2's old coordinate
    expect(tracker.move(1, 95, 110)).toEqual({ kind: 'drag-move', dx: 15, dy: 10 });
    expect(tracker.up(1)).toEqual({ kind: 'end', wasTap: false, canFling: true });
  });

  it('handles 3rd finger additions/removals and pointercancel cleanly', () => {
    const tracker = new TouchGestureTracker();
    tracker.down(1, 100, 100);
    tracker.down(2, 200, 100);
    expect(tracker.down(3, 150, 180)).toEqual({ kind: 'ignore' });
    expect(tracker.move(3, 160, 190)).toEqual({ kind: 'ignore' });

    // Lifting finger 1 re-anchors pinch to fingers 2 and 3 without jumping
    expect(tracker.up(1)).toEqual({ kind: 'pinch-reanchor' });
    expect(tracker.mode).toBe('pinch');
    const m = tracker.move(2, 240, 100);
    expect(m.kind).toBe('pinch-move');

    // Cancel remaining pointers
    expect(tracker.cancel(2)).toEqual({ kind: 'pinch-to-drag' });
    expect(tracker.cancel(3)).toEqual({ kind: 'cancel' });
    expect(tracker.mode).toBe('idle');
    expect(tracker.activeCount).toBe(0);
  });

  it('guards against tiny or zero initial span without division spikes', () => {
    const tracker = new TouchGestureTracker();
    tracker.down(1, 150, 150);
    tracker.down(2, 151, 150); // span = 1 < MIN_PINCH_SPAN_PX
    const m0 = tracker.move(2, 152, 150); // still < MIN_PINCH_SPAN_PX
    expect(m0.kind === 'pinch-move' && m0.scaleFactor).toBe(1);
    const m1 = tracker.move(2, 170, 150); // establishes valid baseline at span 20
    expect(m1.kind === 'pinch-move' && m1.scaleFactor).toBe(1);
    const m2 = tracker.move(2, 190, 150); // span 20 -> 40 => factor 0.5
    expect(m2.kind === 'pinch-move' && m2.scaleFactor).toBeCloseTo(0.5, 6);
  });

  it('recovers smoothly without backward jump after collapsing below MIN_PINCH_SPAN_PX mid-pinch', () => {
    const tracker = new TouchGestureTracker();
    tracker.down(1, 100, 150);
    tracker.down(2, 180, 150); // span = 80 (spanReady = true)

    // Collapse rapidly below MIN_PINCH_SPAN_PX (span 80 -> 2), then even to 0, then spread back 2 -> 5 -> 80
    const collapse = tracker.move(2, 102, 150);
    expect(collapse.kind === 'pinch-move' && collapse.scaleFactor).toBeCloseTo(80 / 4, 6);

    const zero = tracker.move(2, 100, 150);
    expect(zero.kind === 'pinch-move' && zero.scaleFactor).toBe(1);

    const recover = tracker.move(2, 105, 150);
    // Spreading fingers apart (2 -> 5) must zoom IN (scaleFactor < 1), never jump 16x OUT
    expect(recover.kind === 'pinch-move' && recover.scaleFactor).toBeCloseTo(4 / 5, 6);

    const expand = tracker.move(2, 180, 150);
    expect(expand.kind === 'pinch-move' && expand.scaleFactor).toBeCloseTo(5 / 80, 6);

    // Telescoping product across collapse and full recovery equals 1.0
    if (
      collapse.kind === 'pinch-move' &&
      zero.kind === 'pinch-move' &&
      recover.kind === 'pinch-move' &&
      expand.kind === 'pinch-move'
    ) {
      expect(collapse.scaleFactor * zero.scaleFactor * recover.scaleFactor * expand.scaleFactor).toBeCloseTo(1.0, 6);
    }
  });
});

describe('2D Mercator and 3D Globe pinch math', () => {
  const fovDeg = 12;
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360);
  const rect = { left: 0, top: 0, width: 400, height: 300 };
  const clampDist = (d: number) => Math.max(0.1, Math.min(8, d));
  const clampPanY = (py: number, _d: number) => Math.max(-2, Math.min(2, py));

  it('anchors off-center world point under pinch midpoint in 2D Mercator', () => {
    const state = { panX: 0.2, panY: -0.1, dist: 2.0 };
    const midX = 300;
    const midY = 75;
    const aspect = rect.width / rect.height;
    const ndcX = (2 * midX) / rect.width - 1;
    const ndcY = 1 - (2 * midY) / rect.height;
    const worldBeforeX = state.panX + ndcX * state.dist * tanHalfFov * aspect;
    const worldBeforeY = state.panY + ndcY * state.dist * tanHalfFov;

    const next = applyMercatorPinch(
      state,
      { prevMidX: midX, prevMidY: midY, currMidX: midX, currMidY: midY, scaleFactor: 0.5 },
      rect,
      tanHalfFov,
      clampDist,
      clampPanY,
    );
    expect(next.dist).toBeCloseTo(1.0, 6);
    const worldAfterX = next.panX + ndcX * next.dist * tanHalfFov * aspect;
    const worldAfterY = next.panY + ndcY * next.dist * tanHalfFov;
    expect(worldAfterX).toBeCloseTo(worldBeforeX, 6);
    expect(worldAfterY).toBeCloseTo(worldBeforeY, 6);
  });

  it('translates 2D Mercator view with midpoint movement and respects zoom clamps', () => {
    const state = { panX: 0, panY: 0, dist: 0.1 }; // already at min clamp
    const next = applyMercatorPinch(
      state,
      { prevMidX: 200, prevMidY: 150, currMidX: 240, currMidY: 150, scaleFactor: 0.5 },
      rect,
      tanHalfFov,
      clampDist,
      clampPanY,
    );
    expect(next.dist).toBe(0.1);
    expect(next.panX).toBeLessThan(0);
    expect(next.panY).toBe(0);
  });

  it('zooms 3D globe altitude proportionally, clamps bounds, and pans midpoint', () => {
    const clampAlt = (alt: number) => Math.max(0.15, Math.min(4.0, alt));
    const start = { yaw: 0, pitch: 0.2, dist: 3.0 }; // alt = 2.0

    const panned = applyGlobePinchPan(start, 20, -10, 300, tanHalfFov, clampAlt);
    expect(panned.yaw).toBeGreaterThan(start.yaw);
    expect(panned.pitch).toBeLessThan(start.pitch);

    const zoomedIn = applyGlobePinchZoom(panned, 0.5, clampAlt, [120, 30]);
    expect(zoomedIn.dist).toBeCloseTo(2.0, 6); // alt 2.0 -> 1.0

    const zoomedOut = applyGlobePinchZoom(zoomedIn, 2.0, clampAlt, null);
    expect(zoomedOut.dist).toBeCloseTo(3.0, 6); // alt 1.0 -> 2.0

    const atMax = applyGlobePinchZoom({ yaw: 0, pitch: 0, dist: 5.0 }, 2.0, clampAlt, null);
    expect(atMax.dist).toBe(5.0);
    const atMin = applyGlobePinchZoom({ yaw: 0, pitch: 0, dist: 1.15 }, 0.5, clampAlt, null);
    expect(atMin.dist).toBe(1.15);
  });
});
