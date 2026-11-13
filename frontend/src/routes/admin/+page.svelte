<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { page } from '$app/state';
  import AuthForm from '#lib/components/AuthForm.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
</script>
<svelte:head><title>{pageTitle(page.data.user ? '站点管理' : '管理员登录', page.data.site)}</title></svelte:head>
{#if page.data.user}
  <PageHeader title={page.data.user.is_admin ? '站点管理' : '我的工作区'} description="管理本人记录、目标和分析报告。" />
  <section class="aux-panel mt-6">
    <p>{page.data.user.is_admin ? '已以站主身份登录。' : '已登录个人账号。'}{page.data.user.showcase_enabled ? '个人展示已开启，全部运动记录和完整轨迹均会公开展示；私人备注和源文件不公开。' : '个人展示尚未开启，本人仍可在工作区管理数据。'}</p>
    <nav aria-label="管理入口" class="mt-6 flex flex-wrap gap-4">
      <a class="button-secondary" href="/workspace/activities">导入与管理记录</a>
      <a class="button-secondary" href="/workspace/dashboard">目标与数据汇总</a>
      <a class="button-secondary" href="/workspace/ai">管理 AI 分析</a>
      <a class="button-secondary" href="/workspace/settings">账户设置</a>
      {#if page.data.user.is_admin}<a class="button-secondary" href="/admin/users">用户管理</a>{/if}
    </nav>
  </section>
{:else}<AuthForm />{/if}
