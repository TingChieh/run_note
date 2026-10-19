<script lang="ts">
  import { page } from '$app/state';
  import { pageTitle } from '#lib/site.ts';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  const titles: Record<number, string> = { 403: '无权访问', 404: '页面不存在' };
  const status = $derived(page.status);
  const title = $derived(titles[status] ?? (status >= 500 ? '服务暂时不可用' : '请求无法完成'));
  // Only the fixed Chinese copy below reaches the page; raw error text from the server is never rendered.
  const detail = $derived(status === 403 ? '当前账号没有权限查看此页面。' : status === 404 ? '链接可能已失效，或该内容未对外展示。' : status >= 500 ? '请稍后刷新重试。' : '请检查链接后重试。');
</script>
<svelte:head><title>{pageTitle(title, page.data.site)}</title></svelte:head>
<PageHeader title={title} description={`错误代码 ${status}`} />
<div class="mt-6" data-testid="error-page">
  <FeedbackState kind="error" title={detail}>
    <div class="flex flex-wrap gap-2"><a href="/dashboard" data-sveltekit-reload class="button-secondary">返回数据汇总</a><button type="button" class="button-secondary" onclick={() => history.back()}>返回上一页</button></div>
  </FeedbackState>
</div>
