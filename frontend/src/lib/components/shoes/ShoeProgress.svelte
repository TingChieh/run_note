<script lang="ts">
  import type { ShoeView } from '#lib/api/shoes.ts';
  let { shoe }: { shoe: ShoeView } = $props();
</script>

{#if shoe.replacement_distance_m && !shoe.retired_on}
  <div class="track" class:warning={shoe.reminder !== null} aria-hidden="true">
    <span style:width={Math.min(100, (Number(shoe.total_distance_m) / Number(shoe.replacement_distance_m)) * 100) + '%'}
    ></span>
  </div>
{/if}

<style>
  .track {
    height: 0.25rem;
    border-radius: 0;
    background: var(--border);
    overflow: hidden;
  }
  .track span {
    display: block;
    height: 100%;
    background: var(--primary);
  }
  .track.warning span {
    background: var(--warning);
  }
</style>
