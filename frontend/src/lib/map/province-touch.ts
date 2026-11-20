export const MIN_PINCH_SPAN_PX = 4;
export const TAP_MOVE_THRESHOLD_PX = 6;

export interface PointerPoint {
  x: number;
  y: number;
}

export interface PinchMetrics {
  midX: number;
  midY: number;
  span: number;
}

export interface MercatorCameraState {
  panX: number;
  panY: number;
  dist: number;
}

export interface GlobeCameraState {
  yaw: number;
  pitch: number;
  dist: number;
}

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type TouchDownResult = { kind: 'drag-start' } | { kind: 'pinch-start' } | { kind: 'ignore' };

export type TouchMoveResult =
  | { kind: 'hover' }
  | { kind: 'drag-move'; dx: number; dy: number }
  | {
      kind: 'pinch-move';
      prevMidX: number;
      prevMidY: number;
      currMidX: number;
      currMidY: number;
      dMidX: number;
      dMidY: number;
      scaleFactor: number;
    }
  | { kind: 'ignore' };

export type TouchUpResult =
  | { kind: 'ignore' }
  | { kind: 'pinch-reanchor' }
  | { kind: 'pinch-to-drag' }
  | { kind: 'end'; wasTap: boolean; canFling: boolean }
  | { kind: 'cancel' };

/** Compute midpoint and Euclidean separation between two active touch points. */
export function measurePinch(a: PointerPoint, b: PointerPoint): PinchMetrics {
  return {
    midX: (a.x + b.x) * 0.5,
    midY: (a.y + b.y) * 0.5,
    span: Math.hypot(b.x - a.x, b.y - a.y),
  };
}

/**
 * Tracks active pointers across 1-finger drag/tap and 2-finger pinch gestures,
 * handling mid-gesture pointer additions, removals, and cancellations without jumps.
 */
export class TouchGestureTracker {
  private pointers = new Map<number, PointerPoint>();
  private pinchIds: [number, number] | null = null;
  private prevPinch: PinchMetrics | null = null;
  private spanReady = false;
  private dragging = false;
  private hadPinch = false;
  private lastX = 0;
  private lastY = 0;
  private movedPx = 0;

  get activeCount(): number {
    return this.pointers.size;
  }

  get mode(): 'idle' | 'drag' | 'pinch' {
    if (this.pinchIds) return 'pinch';
    if (this.dragging) return 'drag';
    return 'idle';
  }

  down(id: number, x: number, y: number): TouchDownResult {
    this.pointers.set(id, { x, y });
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.pinchIds = null;
      this.prevPinch = null;
      this.spanReady = false;
      this.hadPinch = false;
      this.lastX = x;
      this.lastY = y;
      this.movedPx = 0;
      return { kind: 'drag-start' };
    }
    if (this.pointers.size === 2 && !this.pinchIds) {
      const [idA, idB] = this.pointers.keys();
      this.dragging = false;
      this.hadPinch = true;
      this.movedPx = 0;
      this.pinchIds = [idA, idB];
      this.initPinch(idA, idB);
      return { kind: 'pinch-start' };
    }
    if (this.pinchIds && (id === this.pinchIds[0] || id === this.pinchIds[1])) {
      this.initPinch(this.pinchIds[0], this.pinchIds[1]);
    }
    return { kind: 'ignore' };
  }

  move(id: number, x: number, y: number): TouchMoveResult {
    if (!this.pointers.has(id)) return { kind: 'hover' };
    this.pointers.set(id, { x, y });
    if (this.pinchIds && this.prevPinch) {
      if (id !== this.pinchIds[0] && id !== this.pinchIds[1]) {
        return { kind: 'ignore' };
      }
      const a = this.pointers.get(this.pinchIds[0])!;
      const b = this.pointers.get(this.pinchIds[1])!;
      const curr = measurePinch(a, b);
      const prevMidX = this.prevPinch.midX;
      const prevMidY = this.prevPinch.midY;
      const dMidX = curr.midX - prevMidX;
      const dMidY = curr.midY - prevMidY;
      let scaleFactor = 1;
      if (!this.spanReady) {
        if (curr.span < MIN_PINCH_SPAN_PX) {
          this.prevPinch = { midX: curr.midX, midY: curr.midY, span: curr.span };
        } else {
          // Establish baseline once fingers separate cleanly past MIN_PINCH_SPAN_PX without a startup spike.
          this.prevPinch = curr;
          this.spanReady = true;
        }
      } else {
        // Clamp below MIN_PINCH_SPAN_PX while keeping prevPinch.span in sync so recovery never jumps backward.
        const effectiveSpan = Math.max(MIN_PINCH_SPAN_PX, curr.span);
        scaleFactor = this.prevPinch.span / effectiveSpan;
        this.prevPinch = { midX: curr.midX, midY: curr.midY, span: effectiveSpan };
      }
      return {
        kind: 'pinch-move',
        prevMidX,
        prevMidY,
        currMidX: curr.midX,
        currMidY: curr.midY,
        dMidX,
        dMidY,
        scaleFactor,
      };
    }
    if (!this.dragging) return { kind: 'ignore' };
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    this.movedPx += Math.hypot(dx, dy);
    return { kind: 'drag-move', dx, dy };
  }

  up(id: number): TouchUpResult {
    return this.release(id, false);
  }

  cancel(id: number): TouchUpResult {
    return this.release(id, true);
  }

  reset(): void {
    this.pointers.clear();
    this.pinchIds = null;
    this.prevPinch = null;
    this.spanReady = false;
    this.dragging = false;
    this.hadPinch = false;
    this.movedPx = 0;
  }

  private initPinch(idA: number, idB: number): void {
    const a = this.pointers.get(idA)!;
    const b = this.pointers.get(idB)!;
    const m = measurePinch(a, b);
    this.prevPinch = m;
    this.spanReady = m.span >= MIN_PINCH_SPAN_PX;
  }

  private release(id: number, isCancel: boolean): TouchUpResult {
    if (!this.pointers.has(id)) return { kind: 'ignore' };
    this.pointers.delete(id);
    if (this.pointers.size >= 2) {
      if (this.pinchIds && (id === this.pinchIds[0] || id === this.pinchIds[1])) {
        const [idA, idB] = this.pointers.keys();
        this.pinchIds = [idA, idB];
        this.initPinch(idA, idB);
        return { kind: 'pinch-reanchor' };
      }
      return { kind: 'ignore' };
    }
    if (this.pointers.size === 1) {
      const [rem] = this.pointers.values();
      this.pinchIds = null;
      this.prevPinch = null;
      this.spanReady = false;
      this.dragging = true;
      this.lastX = rem.x;
      this.lastY = rem.y;
      this.movedPx = 0;
      return { kind: 'pinch-to-drag' };
    }
    const wasTap = !isCancel && !this.hadPinch && this.movedPx < TAP_MOVE_THRESHOLD_PX;
    const canFling = !isCancel && this.dragging && this.movedPx >= TAP_MOVE_THRESHOLD_PX;
    this.dragging = false;
    this.pinchIds = null;
    this.prevPinch = null;
    this.spanReady = false;
    this.hadPinch = false;
    this.movedPx = 0;
    return isCancel ? { kind: 'cancel' } : { kind: 'end', wasTap, canFling };
  }
}

/**
 * Apply one 2D Mercator pinch step, keeping the world coordinate under the
 * pinch midpoint anchored while translating by midpoint displacement.
 */
export function applyMercatorPinch(
  state: MercatorCameraState,
  step: { prevMidX: number; prevMidY: number; currMidX: number; currMidY: number; scaleFactor: number },
  rect: ViewportRect,
  tanHalfFov: number,
  clampDist: (dist: number) => number,
  clampPanY: (panY: number, dist: number) => number,
): MercatorCameraState {
  if (rect.width <= 0 || rect.height <= 0) return state;
  const aspect = rect.width / rect.height;
  const prevDist = state.dist;
  const nextDist = clampDist(prevDist * step.scaleFactor);
  const prevNdcX = (2 * (step.prevMidX - rect.left)) / rect.width - 1;
  const prevNdcY = 1 - (2 * (step.prevMidY - rect.top)) / rect.height;
  const currNdcX = (2 * (step.currMidX - rect.left)) / rect.width - 1;
  const currNdcY = 1 - (2 * (step.currMidY - rect.top)) / rect.height;
  const nextPanX = state.panX + (prevNdcX * prevDist - currNdcX * nextDist) * tanHalfFov * aspect;
  const rawPanY = state.panY + (prevNdcY * prevDist - currNdcY * nextDist) * tanHalfFov;
  const nextPanY = clampPanY(rawPanY, nextDist);
  return { panX: nextPanX, panY: nextPanY, dist: nextDist };
}

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
const lonToYaw = (lon: number) => (-(lon + 90) * Math.PI) / 180;
const yawToLon = (y: number) => wrapLon((-y * 180) / Math.PI - 90);

/** Apply midpoint rotation for one 3D globe pinch step before sampling zoom anchor. */
export function applyGlobePinchPan(
  state: GlobeCameraState,
  dMidX: number,
  dMidY: number,
  stageHeight: number,
  tanHalfFov: number,
  clampAlt: (alt: number) => number,
): GlobeCameraState {
  const prevAlt = clampAlt(state.dist - 1.0);
  const pxPerUnit = Math.max(220, stageHeight || 344) / 2 / tanHalfFov;
  const perPx = prevAlt / pxPerUnit;
  const yaw = state.yaw + (dMidX * perPx) / Math.max(0.3, Math.cos(state.pitch));
  const pitch = Math.max(-1.25, Math.min(1.25, state.pitch + dMidY * perPx));
  return { yaw, pitch, dist: state.dist };
}

/** Apply altitude scale and optional zoom-in anchor pull for one 3D globe pinch step. */
export function applyGlobePinchZoom(
  state: GlobeCameraState,
  scaleFactor: number,
  clampAlt: (alt: number) => number,
  targetLonLat: [number, number] | null = null,
): GlobeCameraState {
  const prevAlt = clampAlt(state.dist - 1.0);
  const nextAlt = clampAlt(prevAlt * scaleFactor);
  let yaw = state.yaw;
  let pitch = state.pitch;
  if (nextAlt < prevAlt && targetLonLat) {
    const pull = Math.min(0.5, 1 - nextAlt / prevAlt);
    const lon = yawToLon(yaw);
    const lat = (pitch * 180) / Math.PI;
    const lonStep = ((((targetLonLat[0] - lon + 540) % 360) + 360) % 360) - 180;
    const targetYaw = lonToYaw(lon + lonStep * pull);
    yaw += Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
    pitch = (Math.max(-72, Math.min(72, lat + (targetLonLat[1] - lat) * pull)) * Math.PI) / 180;
  }
  return { yaw, pitch, dist: 1.0 + nextAlt };
}
