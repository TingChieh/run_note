<script lang="ts">import { page } from '$app/state';</script>
<svelte:head><title>设置 · Run Note</title></svelte:head>
<h1 class="text-3xl font-semibold">设置</h1>
{#if page.data.user}
  <dl class="mt-6 grid gap-3 rounded-xl border border-border bg-white p-6">
    <div><dt class="text-sm text-muted-foreground">当前用户</dt><dd>{page.data.user.display_name}</dd></div>
    <div><dt class="text-sm text-muted-foreground">邮箱</dt><dd>{page.data.user.email}</dd></div>
    <div><dt class="text-sm text-muted-foreground">用户名</dt><dd>{page.data.user.username}</dd></div>
    <div><dt class="text-sm text-muted-foreground">时区</dt><dd>{page.data.user.timezone}</dd></div>
  </dl>
{/if}
<p class="mt-4 text-sm text-muted-foreground">个人资料编辑将在后续范围中接入。</p>
