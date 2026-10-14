<script lang="ts">
  import { onMount } from 'svelte';
  import { getHealth, type HealthStatus } from '#lib/api/health.ts';

  let loading = $state(true);
  let health = $state<HealthStatus | null>(null);
  let error = $state('');

  async function refreshHealth() {
    loading = true;
    health = null;
    error = '';
    try {
      health = await getHealth();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '无法连接后端';
    } finally {
      loading = false;
    }
  }

  onMount(() => { void refreshHealth(); });
</script>

<svelte:head>
  <title>Run Note · 项目概览</title>
  <meta name="description" content="跑步数据管理与可视化分析系统的本地开发骨架" />
</svelte:head>

<p class="mb-3 text-sm font-medium text-primary">RUNNOTE · 每一步都有意义</p>
<h1 class="text-3xl font-semibold leading-tight sm:text-4xl">跑步数据管理与可视化分析</h1>
<p class="mt-4 max-w-2xl leading-7 text-muted-foreground">
  导入跑步记录，探索走过的路线，用年度活动日历与趋势统计回顾你的进步。你的记录默认仅自己可见。
</p>

<section aria-labelledby="health-title" class="mt-9 rounded-xl border border-border bg-white p-6">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <h2 id="health-title" class="text-lg font-semibold">开发环境状态</h2>
    <button onclick={refreshHealth} disabled={loading}
      class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
      {loading ? '检查中…' : '重新检查'}
    </button>
  </div>
  <p role="status" aria-live="polite" data-testid="health-status" class="mt-5 leading-7">
    {#if loading}
      正在检查后端与数据库…
    {:else if health}
      后端、PostgreSQL、PostGIS 和数据库迁移均已就绪。
    {:else}
      检查未通过：{error}
    {/if}
  </p>
  {#if error}
    <p class="mt-3 text-sm text-muted-foreground">请确认数据库已启动、Alembic 迁移已执行，以及后端正在运行。</p>
  {/if}
</section>

<div class="mt-6 grid gap-4 sm:grid-cols-3">
  {#each [
    { title: '跑步记录', text: '导入 GPX，集中查看每次跑步的距离、耗时与路线。', href: '/activities' },
    { title: '运动统计', text: '通过年度活动日历和趋势图，回顾你的运动节奏。', href: '/dashboard' },
    { title: '个人设置', text: '查看当前登录账号与会话状态。', href: '/settings' }
  ] as item}
    <a href={item.href} class="rounded-xl border border-border bg-white p-5 hover:border-primary">
      <h2 class="font-semibold">{item.title}</h2>
      <p class="mt-3 text-sm leading-6 text-muted-foreground">{item.text}</p>
    </a>
  {/each}
</div>
