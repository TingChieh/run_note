#!/usr/bin/env python3
# ruff: noqa: E501  (the embedded TypeScript probes are deliberately one-liners)
"""CI-only probes for Playwright UI failures that cannot be reproduced on the developer machine.

Creates temporary copies of the failing specs with a read-only measurement inserted before the
failing action, plus a config that runs just those copies. The measurements are printed as
GitHub ``::notice::`` annotations. Nothing here edits a committed spec or changes a result.
Run from the frontend directory.
"""

import pathlib

UI = pathlib.Path("tests/ui")

NESTED = """
  { const probe = await page.evaluate(async () => {
    const dialog = document.querySelector('[role=dialog]') as HTMLElement;
    const sel = dialog.querySelector('select[aria-label="月份"]') as HTMLElement;
    const toggle = sel.parentElement!.querySelector('.rn-select-toggle') as HTMLElement | null;
    const rect = (el: Element | null) => el ? (r => [r.x, r.y, r.width, r.height].map(v => +v.toFixed(3)).join(',')) (el.getBoundingClientRect()) : 'none';
    const frames: string[] = [];
    for (let i = 0; i < 12; i++) { await new Promise(r => requestAnimationFrame(r)); frames.push(rect(dialog) + ' | ' + rect(sel) + ' | ' + rect(toggle)); }
    const at = (el: Element) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); };
    return { frames, hit: (at(sel) as HTMLElement | null)?.outerHTML.slice(0, 120),
      animations: document.getAnimations().map(a => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty}:${a.playState}:${(a.effect as KeyframeEffect | null)?.target?.className}`).slice(0, 12),
      scrollbar: [innerWidth, document.documentElement.clientWidth], dpr: devicePixelRatio, font: getComputedStyle(sel).fontFamily };
  });
  console.log('::notice title=nested-menu probe::' + JSON.stringify(probe).replace(/%/g, '%25')); }
"""

GLASS = """
  { const probe = await page.evaluate(async () => {
    const el = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '登录')!;
    const chain: string[] = [];
    for (let n: Element | null = el; n && chain.length < 6; n = n.parentElement) { const s = getComputedStyle(n); chain.push(`${n.tagName}.${(n as HTMLElement).className}:${s.transform}:${s.willChange}`); }
    const frames: string[] = [];
    for (let i = 0; i < 12; i++) { await new Promise(r => requestAnimationFrame(r)); const r = el.getBoundingClientRect(); frames.push([r.x, r.y, r.width, r.height].join(',')); }
    return { chain, frames, animations: document.getAnimations().map(a => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty}:${a.playState}`).slice(0, 12) };
  });
  console.log('::notice title=glass-button probe::' + JSON.stringify(probe).replace(/%/g, '%25')); }
"""

CITY = """
  console.log('::notice title=city-map probe::' + JSON.stringify(await page.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return { css: [canvas.clientWidth, canvas.clientHeight], px: [canvas.width, canvas.height], dpr: devicePixelRatio,
      renderer: gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'n/a' };
  })).replace(/%/g, '%25'));
"""


def inject(source: str, anchor: str, probe: str, nth_after: str | None = None) -> str:
    start = source.index(nth_after) if nth_after else 0
    at = source.index(anchor, start)
    return source[:at] + probe + source[at:]


def trace_steps(source: str, test_name: str) -> str:
    """Print a notice before every statement of one test so a hang shows where it stopped."""
    start = source.index(test_name)
    end = source.index("\ntest(", start + 1)
    out, n = [], 0
    for line in source[start:end].split("\n"):
        if line.startswith("    await ") or line.startswith("  await "):
            n += 1
            tag = line.strip()[:70].replace("'", "").replace("`", "").replace("\\", "").replace("%", "")
            indent = line[: len(line) - len(line.lstrip())]
            out.append(f"{indent}console.log('::notice title=step {n}::{tag}');")
        out.append(line)
    return source[:start] + "\n".join(out) + source[end:]


def main():
    footprints = (UI / "footprints.spec.ts").read_text()
    nested = inject(
        footprints,
        "    await select.click({ position: { x: 12, y: 20 } });",
        NESTED,
        "nested month and year menus",
    )
    nested = trace_steps(nested, "nested month and year menus")
    (UI / "zz-diag-nested.spec.ts").write_text(nested)
    city = inject(footprints, "  const before=await mapScreenshot('before');", CITY)
    (UI / "zz-diag-city.spec.ts").write_text(city)
    glass = (UI / "liquid-glass.spec.ts").read_text()
    glass = inject(
        glass,
        "  const rest = await shadow.evaluate",
        GLASS,
        "official button surface squishes",
    )
    (UI / "zz-diag-glass.spec.ts").write_text(glass)
    pathlib.Path("playwright.ci-diagnostics.config.ts").write_text(
        "import base from './playwright.ui.config';\n"
        "export default { ...base, testMatch: ['zz-diag-*.spec.ts'], workers: 1, retries: 0,"
        " timeout: 20000, expect: { timeout: 5000 }, use: { ...base.use, actionTimeout: 5000 } };\n"
    )


if __name__ == "__main__":
    main()
