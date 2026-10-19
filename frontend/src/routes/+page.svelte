<script lang="ts">
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
</script>
<svelte:head><title>{pageTitle('数据汇总', page.data.site)}</title></svelte:head>
