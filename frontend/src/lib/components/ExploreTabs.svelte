<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  import { EXPLORE_SECTIONS } from '#lib/navigation.ts';
  let { current }: { current: string } = $props();
  const view = useViewContext();
</script>
<!-- Phones only: the 探索 tab lands on 个人足迹, and this switcher reaches the other sections the desktop bar lists directly. -->
<nav aria-label="探索分区" class="settings-tabs explore-tabs" data-testid="explore-tabs">
  {#each EXPLORE_SECTIONS as section (section.path)}
    <a href={view.href(section.path)} aria-current={current === section.path ? 'page' : undefined}>{section.label}</a>
  {/each}
</nav>
