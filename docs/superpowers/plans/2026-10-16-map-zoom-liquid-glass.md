# 地图缩放控件 Liquid Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Style MapLibre zoom controls as a vertical pill group that matches the current Liquid Glass material.

**Architecture:** Keep MapLibre `NavigationControl` and its existing zoom behavior. Scope global CSS to the zoom control group and use the project's existing glass tokens, accessibility focus styles, and transparency fallbacks. Use 32px zoom buttons, visible tint highlights and one Liquid Glass refraction surface attached to the whole group. Disable the group's duplicate backdrop blur while Liquid Glass is active. Reduce only its press deformation while retaining the shared spring timing.

**Tech Stack:** SvelteKit 3, MapLibre GL, CSS, Playwright UI tests.

## Global Constraints

- Preserve the existing `NavigationControl`, labels, keyboard interactions, map behavior, and attribution control.
- Keep theme aware controls subscribed through existing `watchSystemTheme` behavior.
- Do not modify API, database, or map business logic.
- Do not commit or publish changes.

---

### Task 1: Style and verify the map zoom control

**Files:**
- Modify: `frontend/tests/ui/liquid-glass.spec.ts`
- Modify: `frontend/src/lib/styles/liquid-glass.css`
- Modify: `frontend/src/lib/styles/liquid-glass.ts`

**Interfaces:**
- Consumes: MapLibre `.maplibregl-ctrl-zoom-in`, `.maplibregl-ctrl-zoom-out`, and the existing `.sport-theme` glass tokens.
- Produces: A vertical, rounded zoom control group on route and footprint maps, with 32px native buttons and one Liquid Glass refraction surface that matches the existing spring timing at a subtler press scale.

- [x] **Step 1: Add a failing UI assertion**

In the existing Liquid Glass map control test, assert that `.maplibregl-ctrl-zoom-in` and `.maplibregl-ctrl-zoom-out` share a parent group; the group has a pill radius and one refractive Liquid Glass surface with a visible gradient highlight; each button is 32px square; the controls lay out vertically; and a press expands the group surface by no more than 4px before it springs back.

- [x] **Step 2: Run the UI test and confirm the expected failure**

Run from `frontend/`:

```bash
node node_modules/@playwright/test/cli.js test --config playwright.ui.config.ts tests/ui/liquid-glass.spec.ts
```

Expected: the new geometry assertion fails against the current MapLibre control styling.

- [x] **Step 3: Add the minimum CSS**

In `liquid-glass.css`, scope styles to `.maplibregl-ctrl-group` containing `.maplibregl-ctrl-zoom-in`. Give the group a vertical pill outline, make both zoom buttons 32px squares, keep their separator subtle, and apply shared hover, focus, reduced-transparency, and forced-color behavior. Put the gradient highlight on the actual tint layer and prevent the enhanced group from adding a second backdrop blur. In `liquid-glass.ts`, enhance the group as one refractive surface, exclude its two child buttons from individual glass enhancement, and preserve shared spring stiffness and damping with reduced press deformation. Leave attribution styling untouched.

- [x] **Step 4: Run focused checks**

Run the UI test command above and then from `frontend/` run:

```bash
pnpm check
```

Expected: the zoom group geometry and existing focus behavior pass; Svelte and TypeScript checks report zero errors and warnings.
