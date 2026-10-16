<script lang="ts">
  import { useViewContext } from "#lib/view-context.ts";
  const view = useViewContext();
  const fetch = view.fetch;
  const readActivities = view.bind(scoped_readActivities, 0);

  import { onMount, tick } from 'svelte';
  import { coverflow, coverflowGeometry, coverflowNavigation } from '#lib/styles/coverflow.ts';
  import { ActivityError, readActivities as scoped_readActivities, type Activity, type ActivityList, type Route } from '#lib/api/activities.ts';
  import WallCard from './WallCard.svelte';

  let { activity, route, routeLoading, routeError, onauthrequired, onswitch }: {
    activity: Activity; route: Route | null; routeLoading: boolean; routeError: string;
    onauthrequired: (cause: ActivityError) => void; onswitch: (id: string) => Promise<boolean>;
  } = $props();
  const pageSize = 20;
  const maxCachedPages = 3;
  const pages = new Map<number, ActivityList>();
  type Card = { activity: Activity; index: number };
  let cards = $state<Card[]>([]);
  let selectedIndex = $state(-1), browseIndex = $state(-1), total = $state(0), pending = $state(true), error = $state('');
  let geometry = $state(coverflowGeometry(0, 144));
  let capacity = $derived(geometry.radius * 2 + 1), reducedMotion = $state(false);
  let windowCards: Card[] = [];
  // Resize reads can replace a window without changing its center or DOM keys.
  let windowVersion = $state(0);
  let disposed = false, requestToken = 0, renderedCapacity = 0, retryIndex: number | null = null;
  let retrySelection = false;
  let browsing = false, queuedBrowse: { index: number; focus: boolean } | null = null;
  let viewport: HTMLDivElement, section: HTMLElement;
  let visible = $derived(cards.length ? cards : [{ activity, index: -1 }]);
  const historyMessage = '活动列表已变化，请重新读取足迹';
  const changedHistory = () => new Error(historyMessage);
  const valid = (token: number) => !disposed && token === requestToken;

  function authRequired(cause: ActivityError) {
    requestToken++; pages.clear(); cards = []; selectedIndex = -1; browseIndex = -1; total = 0;
    browsing = false; queuedBrowse = null;
    onauthrequired(cause);
  }
  async function readPage(index: number, token: number): Promise<ActivityList> {
    const cached = pages.get(index);
    if (cached) { pages.delete(index); pages.set(index, cached); return cached; }
    if (index * pageSize > 1000000) throw new Error('记录范围过大，请从足迹墙查看');
    const result = await readActivities(fetch, index * pageSize, undefined, undefined, undefined, pageSize);
    if (valid(token)) {
      pages.set(index, result);
      while (pages.size > maxCachedPages) pages.delete(pages.keys().next().value!);
    }
    return result;
  }
  // Match activity_date DESC, UUID DESC, including same-day runs.
  function newer(a: Activity, b: Activity) {
    return a.activity_date > b.activity_date || (a.activity_date === b.activity_date && a.id.toLowerCase() > b.id.toLowerCase());
  }
  async function readWindow(index: number, total: number, token: number) {
    const size = capacity;
    const radius = Math.floor(size / 2);
    const start = Math.max(0, index - radius - 1);
    const count = Math.min(total, index + radius + 2) - start;
    const needed = [...new Set(Array.from({ length: count }, (_, i) => Math.floor((start + i) / pageSize)))];
    const results = await Promise.all(needed.map(page => readPage(page, token)));
    if (!valid(token)) return null;
    if (results.some(page => page.total !== total)) throw changedHistory();
    // Assemble from this read, independently of LRU eviction while pages resolve.
    const windowPages = new Map(needed.map((page, i) => [page, results[i]]));
    const items = Array.from({ length: count }, (_, i) => {
      const position = start + i;
      const item = windowPages.get(Math.floor(position / pageSize))?.items[position % pageSize];
      if (!item) throw changedHistory();
      return { activity: item, index: position };
    });
    return { items, size };
  }
  function applyWindow(next: { items: Card[]; size: number }, index: number, count: number) {
    // Keep the travel corridor, including the previous target for reversals.
    // Pruning merely by current opacity can leave holes when responses arrive
    // faster than frames and the spring hasn't yet reached an intermediate card.
    const movingIndices = [...viewport.querySelectorAll<HTMLElement>('.stack-slot')]
      .filter(slot => Number(slot.style.opacity) > 0).map(slot => Number(slot.dataset.index));
    const retained = [...movingIndices, ...windowCards.map(card => card.index), ...next.items.map(card => card.index)];
    const start = Math.min(...retained), end = Math.max(...retained);
    windowCards = next.items;
    cards = [...new Map([...cards.filter(card => card.index >= start && card.index <= end), ...next.items]
      .map(card => [card.activity.id, card])).values()].sort((a, b) => a.index - b.index);
    browseIndex = index; total = count; renderedCapacity = next.size;
    windowVersion++;
  }
  function pruneCards() {
    if (!disposed) cards = windowCards;
  }
  function failed(cause: unknown, token: number) {
    if (!valid(token)) return;
    if (cause instanceof ActivityError && cause.status === 401) { authRequired(cause); return; }
    error = cause instanceof Error ? cause.message : '暂时无法读取足迹';
    if (error === historyMessage) retryIndex = null;
  }
  function finish(token: number) {
    if (!valid(token)) return;
    pending = false;
    if (!error && browseIndex >= 0 && renderedCapacity !== capacity) void resizeWindow();
  }
  async function initialize() {
    const token = ++requestToken;
    pending = true; error = ''; retryIndex = null; pages.clear();
    try {
      const first = await readPage(0, token);
      if (!valid(token)) return;
      let low = 0, high = Math.ceil(first.total / pageSize) - 1;
      while (low <= high && valid(token)) {
        const middle = low === 0 ? 0 : Math.floor((low + high) / 2);
        const result = await readPage(middle, token);
        if (!valid(token)) return;
        if (result.total !== first.total || !result.items.length) throw changedHistory();
        const index = result.items.findIndex(item => item.id === activity.id);
        if (index >= 0) {
          const position = middle * pageSize + index;
          const next = await readWindow(position, first.total, token);
          if (next && valid(token)) { selectedIndex = position; applyWindow(next, position, first.total); }
          return;
        }
        if (newer(activity, result.items[0])) high = middle - 1;
        else if (newer(result.items[result.items.length - 1], activity)) low = middle + 1;
        else throw changedHistory();
      }
      if (valid(token)) throw changedHistory();
    } catch (cause) { failed(cause, token); }
    finally { finish(token); }
  }
  async function resizeWindow() {
    if (pending || browseIndex < 0) return;
    const token = ++requestToken;
    pending = true; error = ''; retryIndex = null;
    try {
      const next = await readWindow(browseIndex, total, token);
      if (next && valid(token)) applyWindow(next, browseIndex, total);
    } catch (cause) { failed(cause, token); }
    finally { finish(token); }
  }
  function stepBrowse(direction: number, focus: boolean) {
    if (browseIndex < 0 || (pending && !browsing)) return;
    const maxTravel = Math.max(2, geometry.radius);
    const index = Math.max(0, browseIndex - maxTravel, Math.min(total - 1, browseIndex + maxTravel, (queuedBrowse?.index ?? browseIndex) + direction));
    if (browsing) queuedBrowse = { index, focus };
    else void browse(index, focus);
  }
  async function browse(index: number, focusCard = false) {
    if (pending || index === browseIndex || index < 0 || index >= total) return;
    const token = ++requestToken;
    pending = true; error = ''; retryIndex = index; retrySelection = false;
    browsing = true; queuedBrowse = { index, focus: focusCard };
    try {
      const next = await readWindow(index, total, token);
      if (!next || !valid(token)) return;
      applyWindow(next, index, total); retryIndex = null;
      if (focusCard) {
        await tick();
        if (valid(token)) section.querySelector<HTMLButtonElement>('.stack-slot.centered .wall-card')?.focus({ preventScroll: true });
      }
    } catch (cause) { failed(cause, token); }
    finally {
      if (valid(token)) {
        const queued = queuedBrowse; queuedBrowse = null; browsing = false;
        pending = false;
        if (!error && queued && queued.index !== browseIndex) void browse(queued.index, queued.focus);
        else finish(token);
      }
    }
  }
  async function select(index: number, focusCard = false) {
    if (pending || index < 0 || index >= total) return;
    if (index === selectedIndex) { await browse(index, focusCard); return; }
    const token = ++requestToken;
    const top = section.getBoundingClientRect().top;
    pending = true; error = ''; retryIndex = index; retrySelection = true;
    try {
      const next = await readWindow(index, total, token);
      if (!next || !valid(token)) return;
      const target = next.items.find(card => card.index === index)!;
      if (!await onswitch(target.activity.id) || !valid(token)) return;
      selectedIndex = index; applyWindow(next, index, total); retryIndex = null;
      await tick();
      if (valid(token)) {
        window.scrollBy({ top: section.getBoundingClientRect().top - top, behavior: 'instant' });
        if (focusCard) section.querySelector<HTMLButtonElement>('.wall-card[aria-pressed="true"]')?.focus({ preventScroll: true });
      }
    } catch (cause) { failed(cause, token); }
    finally { finish(token); }
  }
  onMount(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { reducedMotion = motion.matches; };
    const measure = () => {
      const style = getComputedStyle(viewport);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const width = parseFloat(style.getPropertyValue('--deck-card-width')) * rem;
      const next = coverflowGeometry(viewport.clientWidth, width);
      const changedCapacity = next.radius !== geometry.radius;
      geometry = next;
      if (changedCapacity && !pending && selectedIndex >= 0) void resizeWindow();
    };
    updateMotion(); measure();
    motion.addEventListener('change', updateMotion);
    const observer = new ResizeObserver(measure); observer.observe(viewport);
    void initialize();
    return () => { disposed = true; requestToken++; pages.clear(); observer.disconnect(); motion.removeEventListener('change', updateMotion); };
  });
</script>

<section class="activity-wall-card" aria-label="本次足迹卡片" bind:this={section}>
  <div class="preview-layout">
    <div class="preview-copy">
      <h2>本次足迹卡片</h2>
      <p>每次跑步，留下属于你的路线记忆。</p>
      <a href={view.href("/activities/wall")}  class="button-secondary">查看全部足迹</a>
    </div>
    <div class="preview-browser" aria-busy={pending} use:coverflowNavigation={{ onbrowse: stepBrowse }}>
      <button type="button" class="button-secondary deck-arrow" aria-label="较新一条" disabled={pending || browseIndex <= 0} onclick={() => void select(browseIndex - 1)}><span aria-hidden="true">←</span></button>
      <div class="stack-viewport" bind:this={viewport}>
        <div class="card-stack" use:coverflow={{ center: browseIndex, geometry, windowVersion, reducedMotion, onsettled: pruneCards }}>
          {#each visible as card (card.activity.id)}
            <div class="stack-slot" class:chosen={card.index === selectedIndex} class:centered={card.index === browseIndex}
              data-index={card.index} aria-hidden={Math.abs(card.index - browseIndex) > geometry.radius}
              inert={Math.abs(card.index - browseIndex) > geometry.radius}>
              <WallCard activity={card.activity.id === activity.id ? activity : card.activity}
                route={card.activity.id === activity.id ? route : null}
                managedRoute={card.activity.id === activity.id} routeLoading={card.activity.id === activity.id && routeLoading} routeError={card.activity.id === activity.id ? routeError : ''}
                compact interactive selected={card.index === selectedIndex} centered={card.index === browseIndex}
                onselect={() => void select(card.index)} onauthrequired={authRequired} />
            </div>
          {/each}
        </div>
      </div>
      <button type="button" class="button-secondary deck-arrow" aria-label="较旧一条" disabled={pending || browseIndex < 0 || browseIndex >= total - 1} onclick={() => void select(browseIndex + 1)}><span aria-hidden="true">→</span></button>
      <span class="sr-only" aria-live="polite">{pending ? '正在读取足迹卡片…' : `当前跑步记录：${activity.title || '未命名活动'}${browseIndex >= 0 ? `；正在浏览第 ${browseIndex + 1} / ${total} 张，点击卡片查看记录` : ''}`}</span>
    </div>
  </div>
  {#if error}<div class="preview-error"><p role="alert">{error}</p><button type="button" class="button-secondary" disabled={pending} onclick={() => void (retryIndex === null ? initialize() : retrySelection ? select(retryIndex) : browse(retryIndex))}>重新读取足迹</button></div>{/if}
</section>

<style>
  .activity-wall-card{container-type:inline-size;margin-top:var(--space-6);border:1px solid var(--border);border-radius:var(--radius-card);background:var(--surface);padding:var(--space-4);}
  .preview-layout{display:grid;grid-template-columns:minmax(12rem,1fr) minmax(0,3fr);align-items:center;gap:var(--space-6);}
  .preview-copy h2{font-size:1.125rem;font-weight:700;}
  .preview-copy p{color:var(--muted-foreground);font-size:.875rem;margin:var(--space-2) 0 var(--space-4);}
  .preview-browser{min-width:0;display:grid;grid-template-columns:2.75rem minmax(0,1fr) 2.75rem;align-items:center;gap:var(--space-2);}
  .deck-arrow{position:relative;z-index:4;width:2.75rem;height:2.75rem;padding:var(--space-2);}
  .stack-viewport{--deck-card-width:9rem;touch-action:pan-y;user-select:none;cursor:grab;min-width:0;overflow:clip;isolation:isolate;}
  .preview-browser:global([data-dragging="true"]) .stack-viewport{cursor:grabbing;}
  .card-stack{display:grid;grid-template-columns:var(--deck-card-width);justify-content:center;align-items:stretch;padding-block:var(--space-4);}
  .stack-slot{position:relative;grid-area:1/1;width:var(--deck-card-width);transform-style:preserve-3d;}
  .card-stack:global([data-moving="true"]) .stack-slot{will-change:transform,opacity;}
  .preview-error{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin-top:var(--space-3);font-size:.875rem;}
  @container (max-width:42rem){.preview-layout{grid-template-columns:minmax(0,1fr);gap:var(--space-3);}.preview-copy{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:var(--space-2);}.preview-copy p{display:none;}}
</style>
