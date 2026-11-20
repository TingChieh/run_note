import type { ReplaySpeed, ReplayState } from './engine.ts';

// A frame after a stall (background tab, debugger) must not leap minutes ahead.
const MAX_FRAME_MS = 250;

interface Scheduler {
  request: (callback: (timestamp: number) => void) => number;
  cancel: (handle: number) => void;
  now: () => number;
}
const browser: Scheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
};

/**
 * One requestAnimationFrame loop advancing a playback clock by real elapsed time × rate × speed,
 * where `rate` is track seconds per screen second at 1x.
 * It knows nothing about maps or points: `onchange` receives every new state, per frame while playing.
 */
export function createPlayback(
  duration: number,
  rate: number,
  onchange: (state: ReplayState) => void,
  scheduler: Scheduler = browser,
) {
  let state: ReplayState = { status: 'idle', time: 0, speed: 1 };
  let handle = 0,
    last = 0,
    destroyed = false;
  const emit = (next: Partial<ReplayState>) => {
    state = { ...state, ...next };
    onchange(state);
  };
  function stop() {
    if (handle) scheduler.cancel(handle);
    handle = 0;
  }
  function frame(timestamp: number) {
    handle = 0;
    if (destroyed || state.status !== 'playing') return;
    const step = Math.min(Math.max(timestamp - last, 0), MAX_FRAME_MS);
    last = timestamp;
    const time = Math.min(duration, state.time + (step / 1000) * rate * state.speed);
    if (time >= duration) return emit({ time: duration, status: 'ended' });
    emit({ time });
    handle = scheduler.request(frame);
  }
  return {
    get state() {
      return state;
    },
    play() {
      if (destroyed || state.status === 'playing') return;
      last = scheduler.now();
      emit({ status: 'playing', time: state.status === 'ended' || state.time >= duration ? 0 : state.time });
      stop();
      handle = scheduler.request(frame);
    },
    pause() {
      if (state.status !== 'playing') return;
      stop();
      emit({ status: 'paused' });
    },
    restart() {
      emit({ time: 0, status: 'paused' });
      this.play();
    },
    seek(time: number) {
      const clamped = Math.max(0, Math.min(duration, Number.isFinite(time) ? time : 0));
      const status =
        clamped >= duration ? 'ended' : state.status === 'ended' || state.status === 'idle' ? 'paused' : state.status;
      if (status === 'ended') stop();
      // Restart timing from now so a drag while playing does not add the drag's own duration.
      last = scheduler.now();
      emit({ time: clamped, status });
    },
    setSpeed(speed: ReplaySpeed) {
      emit({ speed });
    },
    destroy() {
      destroyed = true;
      stop();
    },
  };
}
export type Playback = ReturnType<typeof createPlayback>;
