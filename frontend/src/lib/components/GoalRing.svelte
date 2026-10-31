<script lang="ts">
  let { progress }: { progress: number | null } = $props();
  const radius = 15, circumference = 2 * Math.PI * radius;
  const filled = $derived(progress === null ? 0 : circumference * Math.min(100, Math.max(0, progress)) / 100);
</script>
<svg viewBox="0 0 36 36" width="28" height="28" aria-hidden="true">
  <circle cx="18" cy="18" r={radius} fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="3.5" stroke-dasharray={progress === null ? '3 4' : undefined} />
  {#if progress === null}
    <path d="M18 12v12M12 18h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  {:else if filled > 0}
    <!-- 0% draws no arc: a round cap on a zero-length dash would still paint a dot at the start. -->
    <circle class="goal-arc" cx="18" cy="18" r={radius} fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-dasharray={`${filled} ${circumference}`} transform="rotate(-90 18 18)" />
  {/if}
</svg>
