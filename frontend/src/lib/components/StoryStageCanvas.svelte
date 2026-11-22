<script lang="ts">
  import { onMount } from 'svelte';
  import type { AnnualStory } from '#lib/api/annual-story.ts';
  import { watchSystemTheme } from '#lib/components/system-theme.ts';
  import { renderStoryStage, type StageMode } from '#lib/story-stage.ts';

  let {
    story,
    mode,
    progress = 1,
    selectedCityCode = null,
    label,
    testid = 'story-stage-canvas',
  }: {
    story: AnnualStory;
    mode: StageMode;
    progress?: number;
    selectedCityCode?: string | null;
    label: string;
    testid?: string;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let dark = $state(false);
  let mounted = $state(false);

  onMount(() => {
    mounted = true;
    const unwatch = watchSystemTheme((isDark) => {
      dark = isDark;
    });
    let observer: ResizeObserver | null = null;
    if (canvas && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (canvas) {
          renderStoryStage(canvas, { story, mode, progress, selectedCityCode, dark });
        }
      });
      observer.observe(canvas);
    }
    return () => {
      unwatch();
      observer?.disconnect();
    };
  });

  $effect(() => {
    if (!mounted || !canvas) return;
    renderStoryStage(canvas, {
      story,
      mode,
      progress,
      selectedCityCode,
      dark,
    });
  });
</script>

<div class="story-canvas-host" role="img" aria-label={label}>
  <canvas bind:this={canvas} class="story-canvas" data-testid={testid}></canvas>
</div>

<style>
  .story-canvas-host,
  .story-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
