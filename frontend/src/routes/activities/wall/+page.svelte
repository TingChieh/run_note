<script lang="ts">
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FootprintWall from '#lib/components/FootprintWall.svelte';
</script>
<svelte:head><title>足迹墙 · Run Note</title></svelte:head>
<PageHeader title="足迹墙" description="每次跑步，一张足迹。让所有走过的路线，组成你的运动记忆。">{#snippet actions()}<a href="/activities" data-sveltekit-reload class="button-secondary">返回跑步记录</a>{/snippet}</PageHeader>
<div class="wall-content"><FootprintWall /></div>
<style>.wall-content{margin-top:1.5rem;}</style>
