<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;

  import PageHeader from '#lib/components/PageHeader.svelte';
  import FootprintWall from '#lib/components/FootprintWall.svelte';
  import RoutePosterDialog from '#lib/components/RoutePosterDialog.svelte';
</script>
<svelte:head><title>足迹墙 · Run Note</title></svelte:head>
<PageHeader title="足迹墙" description="每次跑步，一张足迹。让所有走过的路线，组成你的运动记忆。">{#snippet actions()}<RoutePosterDialog /><a href={view.href("/activities")}  class="button-secondary">返回跑步记录</a>{/snippet}</PageHeader>
<div class="wall-content"><FootprintWall /></div>
<style>.wall-content{margin-top:1.5rem;}</style>
