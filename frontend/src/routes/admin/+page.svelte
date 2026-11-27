<script lang="ts">
  import { pageTitle } from '#lib/site.ts';
  import { page } from '$app/state';
  import AuthForm from '#lib/components/AuthForm.svelte';
  import PageHeader from '#lib/components/PageHeader.svelte';
</script>
<svelte:head><title>{pageTitle(page.data.user ? '站点管理' : '管理员登录', page.data.site)}</title></svelte:head>
{#if page.data.user}
  <div class="editorial-page admin-hub-page">
    <PageHeader title={page.data.user.is_admin ? '站点管理' : '我的工作区'} />
    <section class="section-rule admin-hub-section" aria-labelledby="admin-title">
      <h2 id="admin-title">{page.data.user.is_admin ? '站点管理' : '我的工作区'}</h2>
      <p class="admin-hub-status">
        {page.data.user.is_admin ? '已以站主身份登录。' : '已登录个人账号。'}{page.data.user.showcase_enabled
          ? '个人展示已开启，全部运动记录和完整轨迹均会公开展示；私人备注和源文件不公开。'
          : '个人展示尚未开启，本人仍可在工作区管理数据。'}
      </p>
      <nav aria-label="管理入口" class="admin-hub-nav">
        <a class="button-secondary" href="/workspace/activities">导入与管理记录</a>
        <a class="button-secondary" href="/workspace/dashboard">目标与数据汇总</a>
        <a class="button-secondary" href="/workspace/settings">账户设置</a>
        {#if page.data.user.is_admin}<a class="button-secondary" href="/admin/users">用户管理</a>{/if}
      </nav>
    </section>
  </div>
{:else}<AuthForm />{/if}

<style>
  .admin-hub-page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
    min-width: 0;
  }
  .admin-hub-section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    min-width: 0;
  }
  .admin-hub-section h2 {
    margin: 0;
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .admin-hub-status {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .admin-hub-nav {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    min-width: 0;
  }
  @media (min-width: 640px) {
    .admin-hub-nav {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1024px) {
    .admin-hub-nav {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
