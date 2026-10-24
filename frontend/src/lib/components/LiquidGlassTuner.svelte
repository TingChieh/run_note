<script lang="ts">
  import { onMount } from 'svelte';
  import debugBackground from '#lib/assets/glass-debug-background.webp';
  import { DEFAULT_GLASS_SETTINGS, GLASS_RANGES, readGlassSettings, writeGlassSettings, type GlassSettings } from '#lib/styles/liquid-glass-settings.ts';

  let open = $state(false);
  let settings = $state<GlassSettings>({ ...DEFAULT_GLASS_SETTINGS });
  let trigger: HTMLButtonElement;
  const sliders: { key: keyof GlassSettings; label: string; unit: string; hint: string }[] = [
    { key: 'transparency', label: '透明度', unit: '%', hint: '越大越通透。' },
    { key: 'refraction', label: '折射强度', unit: ' px', hint: '边缘弯折距离；小控件降低比例保持可读。' },
    { key: 'bezel', label: '弯折带宽', unit: '', hint: '占半个短边的比例；1 为整块弯顶。' },
    { key: 'curvature', label: '边缘曲率', unit: '', hint: '2 为圆弧；越大中心越平、边缘越陡。' },
    { key: 'ior', label: '折射率', unit: '', hint: '控制弯折向内衰减的快慢。' },
    { key: 'chroma', label: '色散', unit: '', hint: '控制边缘彩边；背景副本与滑块可见。' },
    { key: 'blur', label: '模糊程度', unit: ' px', hint: '光学磨砂程度。' },
    { key: 'highlight', label: '边缘高光', unit: '', hint: '边缘高光强度（specular）。' },
    { key: 'specularWidth', label: '高光宽度', unit: '', hint: '边缘高光带的宽度。' },
    { key: 'lightAngle', label: '光照角度', unit: '°', hint: '-90° 表示从上方照射。' }
  ];
  onMount(() => { settings = readGlassSettings(); });
  function adjust(key: keyof GlassSettings, value: number) { settings = writeGlassSettings({ ...settings, [key]: value }); }
  function preset(value: GlassSettings, reset = false) { settings = writeGlassSettings(value, reset); }
  function close() { open = false; trigger?.focus(); }
  function escape(event: KeyboardEvent) {
    if (open && event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
      event.preventDefault(); close();
    }
  }
</script>

<svelte:window onkeydown={escape} />
<div class="glass-tuner">
  <button bind:this={trigger} type="button" class="button-secondary tuner-trigger" aria-expanded={open} aria-controls="glass-tuner-panel" onclick={() => open = !open}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></svg>
    <span>玻璃调节</span><span class="dev-label" aria-hidden="true">DEV</span>
  </button>
  {#if open}
    <section id="glass-tuner-panel" class="tuner-panel" aria-label="Liquid Glass 调节">
      <div class="tuner-heading"><div><p class="eyebrow">实时预览</p><h2>Liquid Glass</h2></div><button type="button" class="button-secondary" aria-label="收起玻璃调节" onclick={close}>收起</button></div>
      <p class="tuner-hint">拖动滑块，按钮、导航与菜单即时更新。</p>
      <div class="preview-stage" data-glass-backdrop style:background-image={`url("${debugBackground}")`} aria-label="照片背景上的玻璃效果预览"><button type="button" class="button-secondary">普通按钮</button><button type="button" class="button-primary">主要操作</button><button type="button" class="button-secondary" data-glass-tone="light">浅色按钮</button></div>
      <div class="preset-row"><button type="button" class="button-secondary" onclick={() => preset({ ...DEFAULT_GLASS_SETTINGS })}>通透增强</button><button type="button" class="button-secondary" onclick={() => preset({ ...DEFAULT_GLASS_SETTINGS, transparency: 60, refraction: 10, blur: 4, highlight: .4 })}>柔和磨砂</button></div>
      <div class="sliders">
        {#each sliders as slider (slider.key)}
          <label><span class="slider-label"><span>{slider.label}</span><output>{settings[slider.key]}{slider.unit}</output></span>
            <span class="rn-slider"><input type="range" aria-label={slider.label} aria-describedby={`glass-help-${slider.key}`} min={GLASS_RANGES[slider.key].min} max={GLASS_RANGES[slider.key].max} step={GLASS_RANGES[slider.key].step} value={settings[slider.key]} oninput={event => adjust(slider.key, event.currentTarget.valueAsNumber)} /></span>
            <span id={`glass-help-${slider.key}`} class="slider-help">{slider.hint}</span>
          </label>
        {/each}
      </div>
      <div class="tuner-footer"><p>仅保存在此浏览器的开发预览中。</p><button type="button" class="button-secondary" onclick={() => preset({ ...DEFAULT_GLASS_SETTINGS }, true)}>恢复默认</button></div>
    </section>
  {/if}
</div>

<style>
  .glass-tuner { position: fixed; z-index: var(--z-dev-tools); right: var(--space-4); bottom: var(--space-4); }
  .tuner-trigger { display: flex; align-items: center; gap: var(--space-2); min-height: 2.75rem; }
  .tuner-trigger svg { flex-shrink: 0; }
  .dev-label { font-size: var(--text-caption); font-weight: var(--weight-bold); letter-spacing: var(--tracking-caps); color: var(--muted-foreground); }
  .tuner-panel { position: absolute; right: 0; bottom: calc(100% + var(--space-3)); width: min(22rem, calc(100vw - var(--space-8))); max-height: calc(100dvh - 6rem); overflow: auto; overscroll-behavior: contain; padding: var(--space-4); background: var(--surface); color: var(--foreground); border: 1px solid var(--border); border-radius: var(--radius-card); box-shadow: 0 var(--space-4) var(--space-8) var(--glass-shadow); }
  .tuner-heading, .slider-label, .tuner-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  h2 { margin: 0; font-size: var(--text-section); font-weight: var(--weight-semibold); }
  .eyebrow { margin: 0; color: var(--muted-foreground); font-size: var(--text-caption); }
  .tuner-hint, .tuner-footer p { color: var(--muted-foreground); font-size: var(--text-caption); }
  .tuner-hint { margin: var(--space-2) 0 var(--space-3); }
  .preview-stage { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: var(--space-3); min-height: 11rem; border-radius: var(--radius-control); padding: var(--space-3); background-color: var(--muted); background-size: cover; background-position: center; }
  .preview-stage button { min-height: 2.75rem; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-control); color: var(--glass-light-foreground) !important; }
  .preset-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0 var(--space-4); }
  .preset-row button, .tuner-heading button, .tuner-footer button { font-size: var(--text-caption); padding: var(--space-2) var(--space-3); white-space: nowrap; }
  .sliders { display: grid; gap: var(--space-3); }
  .sliders label { display: grid; gap: var(--space-1); font-size: var(--text-small); }
  output { font-variant-numeric: tabular-nums; color: var(--muted-foreground); }
  .slider-help { font-size: var(--text-caption); color: var(--muted-foreground); font-weight: var(--weight-regular); }
  .sliders input { width: 100%; padding: 0; min-height: 2rem; accent-color: var(--primary); }
  .tuner-footer { border-top: 1px solid var(--border); padding-top: var(--space-3); margin-top: var(--space-3); }
  .tuner-footer p { margin: 0; }
</style>
