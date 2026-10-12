<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  const navigation = [
    { href: '/', label: '项目概览' },
    { href: '/activities', label: '跑步记录' },
    { href: '/dashboard', label: '运动统计' },
    { href: '/settings', label: '设置' }
  ];
</script>

<a href="#main" class="sr-only focus:not-sr-only">跳转到主要内容</a>
<header class="border-b border-border bg-white">
  <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-5 px-6 py-5">
    <a href="/" class="text-xl font-semibold tracking-tight">Run Note</a>
    <nav aria-label="主要导航" class="flex flex-wrap gap-5 text-sm text-muted-foreground">
      {#each navigation as item}
        <a href={item.href} class="transition-colors hover:text-primary">{item.label}</a>
      {/each}
    </nav>
  </div>
</header>
<main id="main" class="mx-auto min-h-[75vh] max-w-5xl px-6 py-10">
  {@render children()}
</main>
<footer class="mx-auto max-w-5xl border-t border-border px-6 py-5 text-sm text-muted-foreground">
  软件工程毕业设计 · 第一阶段：本地开发骨架
</footer>
