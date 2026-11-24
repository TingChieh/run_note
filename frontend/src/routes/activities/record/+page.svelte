<script lang="ts">
  import { page } from '$app/state';
  import RecordingWorkspace from '#lib/components/RecordingWorkspace.svelte';
  import { pageTitle } from '#lib/site.ts';
</script>

<svelte:head><title>{pageTitle('实时记录', page.data.site)}</title></svelte:head>
<RecordingWorkspace />
