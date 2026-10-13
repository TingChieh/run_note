<script lang="ts">import { page } from '$app/state';import PublicActivityPage from '#lib/components/PublicActivityPage.svelte';</script>
{#key page.params.id}<PublicActivityPage apiPath={`/api/v1/public/activities/${encodeURIComponent(page.params.id ?? '')}`} />{/key}
