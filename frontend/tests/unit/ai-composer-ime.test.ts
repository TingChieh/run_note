import { describe, expect, it } from 'vitest';
import { COMPOSITION_END_GUARD_MS, createComposerImeGuard } from '../../src/lib/ai/composer-ime.ts';

describe('createComposerImeGuard', () => {
  it('suppresses Safari/WebKit Enter arriving immediately after compositionend when isComposing is false', () => {
    let clock = 1000;
    const guard = createComposerImeGuard(() => clock);

    guard.onCompositionStart();
    // WebKit fires compositionend first, then keydown(Enter) with isComposing=false and keyCode=13.
    guard.onCompositionEnd();
    clock += 5;
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(false);

    // A deliberate second Enter after confirming composition should submit.
    clock += 20;
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true);
  });

  it('suppresses Enter during active composition (isComposing=true) and rejects keyCode 229', () => {
    let clock = 2000;
    const guard = createComposerImeGuard(() => clock);

    guard.onCompositionStart();
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 })).toBe(false);
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(false);
    guard.onCompositionEnd();

    // Even long after compositionend or without compositionstart, keyCode 229 (IME Process) never submits.
    clock += COMPOSITION_END_GUARD_MS + 500;
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 })).toBe(false);
  });

  it('allows normal Enter, ignores Shift+Enter, and clears post-composition latch after delay or normal typing', () => {
    let clock = 3000;
    const guard = createComposerImeGuard(() => clock);

    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true);
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 })).toBe(false);

    // After guard window expires, Enter submits normally.
    guard.onCompositionStart();
    guard.onCompositionEnd();
    clock += COMPOSITION_END_GUARD_MS + 1;
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true);

    // Normal non-IME typing after compositionend clears the latch so immediate Enter submits.
    guard.onCompositionStart();
    guard.onCompositionEnd();
    clock += 10;
    expect(guard.shouldSubmitOnKeydown({ key: 'a', shiftKey: false, isComposing: false, keyCode: 65 })).toBe(false);
    clock += 10;
    expect(guard.shouldSubmitOnKeydown({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true);
  });
});
