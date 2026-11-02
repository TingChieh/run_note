<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  let { current }: { current: 'list' | 'wall' } = $props();
  const view = useViewContext();
</script>
<nav aria-label="跑步记录视图" class="settings-tabs">
  <a href={view.href('/activities')} aria-current={current === 'list' ? 'page' : undefined}>列表</a>
  <a href={view.href('/activities/wall')} aria-current={current === 'wall' ? 'page' : undefined}>足迹墙</a>
</nav>
