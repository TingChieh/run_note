<script lang="ts">import { page } from '$app/state';import PublicActivityPage from '#lib/components/PublicActivityPage.svelte';</script>
{#key page.params.token}<PublicActivityPage apiPath={`/api/v1/shared/${encodeURIComponent(page.params.token ?? '')}`} />{/key}
