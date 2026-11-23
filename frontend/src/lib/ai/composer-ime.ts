export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * Safari/WebKit can dispatch `compositionend` right before the Enter `keydown`
 * that confirmed the IME candidate, leaving `event.isComposing === false`.
 * Suppressing an Enter arriving immediately after `compositionend` (in addition
 * to `isComposing` and `keyCode === 229`) covers both Chromium/Firefox and WebKit orderings.
 */
export const COMPOSITION_END_GUARD_MS = 100;

export function createComposerImeGuard(now: () => number = () => Date.now()) {
  let composing = false;
  let lastCompositionEndAt: number | null = null;

  return {
    onCompositionStart() {
      composing = true;
      lastCompositionEndAt = null;
    },
    onCompositionEnd() {
      composing = false;
      lastCompositionEndAt = now();
    },
    shouldSubmitOnKeydown(event: ComposerKeyEvent): boolean {
      if (event.isComposing === true || event.keyCode === 229 || composing) {
        return false;
      }
      if (event.key !== 'Enter') {
        lastCompositionEndAt = null;
        return false;
      }
      if (event.shiftKey) {
        lastCompositionEndAt = null;
        return false;
      }
      if (lastCompositionEndAt !== null) {
        const elapsed = now() - lastCompositionEndAt;
        lastCompositionEndAt = null;
        if (elapsed >= 0 && elapsed <= COMPOSITION_END_GUARD_MS) {
          return false;
        }
      }
      return true;
    },
    reset() {
      composing = false;
      lastCompositionEndAt = null;
    },
  };
}
