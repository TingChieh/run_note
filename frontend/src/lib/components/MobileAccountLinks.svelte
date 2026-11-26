<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  import { canSeeAssistant, canSeeWellbeing } from '#lib/navigation.ts';
  import type { User } from '#lib/api/auth.ts';
  let { user, busy, mounted, onlogout }: { user: User; busy: boolean; mounted: boolean; onlogout: () => void } = $props();
  const view = useViewContext();
  const links = $derived([
    ...(canSeeWellbeing(user, view.manage) ? [{ href: view.href('/wellbeing'), label: '身心健康' }] : []),
    ...(canSeeAssistant(user, view.manage) ? [{ href: view.href('/ai'), label: 'AI 助手' }] : []),
  ]);
</script>
<!-- Phones only: the 我的 tab lands here, so the destinations and sign-out that lived in the old menu stay one tap away. -->
<section class="aux-panel mobile-account" aria-labelledby="mobile-account-title" data-testid="mobile-account-links">
  <h2 id="mobile-account-title" class="mobile-account-title">更多</h2>
  {#if links.length}<ul class="mobile-account-list">
    {#each links as link (link.href)}<li><a href={link.href}>{link.label}<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></a></li>{/each}
  </ul>{/if}
  <button type="button" class="button-secondary mobile-account-logout" disabled={busy || !mounted} onclick={onlogout}>{busy ? '退出中…' : '退出登录'}</button>
</section>
