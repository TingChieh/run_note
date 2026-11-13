<script lang="ts">
  import { useViewContext } from '#lib/view-context.ts';
  const view = useViewContext();
  const fetch = view.fetch;
  const readRoute = view.bind(scoped_readRoute, 1);

  import { onMount } from 'svelte';
  import { ActivityError, readRoute as scoped_readRoute, type Activity, type Route } from '#lib/api/activities.ts';
  import { routeDrawing } from '#lib/api/route-drawing.ts';
  let {
    activity,
    initialRoute = null,
    managedRoute = false,
    routeLoading = false,
    routeError = '',
    compact = false,
    color,
    onauthrequired,
  }: {
    activity: Activity;
    initialRoute?: Route | null;
    managedRoute?: boolean;
    routeLoading?: boolean;
    routeError?: string;
    compact?: boolean;
    color?: string;
    onauthrequired?: (cause: ActivityError) => void;
  } = $props();
  // Raw: drawing reads every coordinate, which must not go through a reactive proxy. Only ever replaced.
  let route = $state.raw<Route | null>(null),
    loading = $state(true),
    error = $state('');
  let element: HTMLDivElement,
    active = false,
    mounted = $state(false),
    loadedFor = '',
    fetchingFor = '',
    failedFor = '',
    loadToken = 0,
    observer: IntersectionObserver | undefined;
  let drawing = $derived(route ? routeDrawing(route, 360, 220, { tolerance: 0.8, digits: 1 }) : null);
  function stopObserver() {
    observer?.disconnect();
    observer = undefined;
  }
  function startObserver(id: string) {
    if (!active || observer || !element) return;
    loading = true;
    error = '';
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          stopObserver();
          void load(id);
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(element);
  }
  $effect(() => {
    const id = activity.id;
    const hasRoute = activity.has_route;
    if (loadedFor && loadedFor !== id) {
      route = null;
      loadedFor = '';
      failedFor = '';
      error = '';
      loading = hasRoute;
      loadToken++;
      stopObserver();
    }
    if (managedRoute) {
      stopObserver();
      if (initialRoute) {
        route = initialRoute;
        loadedFor = id;
        loading = false;
        error = '';
      } else if (loadedFor !== id) {
        // Keep an already-loaded thumbnail visible while the detail page fetches its full route.
        route = null;
        loading = routeLoading;
        error = routeError;
      }
      return;
    }
    if (initialRoute) {
      stopObserver();
      route = initialRoute;
      loadedFor = id;
      loading = false;
      error = '';
      return;
    }
    if (!hasRoute) {
      stopObserver();
      route = null;
      loadedFor = '';
      loading = false;
      error = '';
      return;
    }
    if (mounted && loadedFor !== id && fetchingFor !== id && failedFor !== id && !observer) {
      startObserver(id);
    }
  });
  async function load(id = activity.id) {
    const token = ++loadToken;
    fetchingFor = id;
    loading = true;
    error = '';
    try {
      const data = await readRoute(id);
      if (active && token === loadToken && activity.id === id) {
        route = data;
        loadedFor = id;
      }
    } catch (cause) {
      if (active && token === loadToken && activity.id === id) {
        if (cause instanceof ActivityError && cause.status === 401) {
          route = null;
          loadedFor = '';
          if (onauthrequired) onauthrequired(cause);
          else window.location.replace('/admin?reason=expired');
          return;
        }
        failedFor = id;
        error = '路线暂不可用';
      }
    } finally {
      if (token === loadToken) {
        fetchingFor = '';
        if (active && !managedRoute) loading = false;
      }
    }
  }
  onMount(() => {
    active = true;
    mounted = true;
    return () => {
      active = false;
      loadToken++;
      stopObserver();
    };
  });
</script>

<div class="route-thumbnail" class:compact bind:this={element} style:--route-color={color}>
  <span class="route-watermark" aria-hidden="true"></span>
  {#if drawing}<svg viewBox="0 0 360 220" role="img" aria-label={`${activity.title || '未命名活动'}的路线轮廓`}
      >{#each drawing.paths as path}<path d={path} />{/each}{#each drawing.points as [x, y]}<circle
          cx={x}
          cy={y}
          r="3"
        />{/each}</svg
    >
  {:else}<div class="thumbnail-empty">
      <span aria-hidden="true">{activity.has_route ? '↗' : '◷'}</span>
      <p>{loading ? '正在描绘足迹…' : error || '没有路线'}</p>
    </div>{/if}
</div>

<style>
  .route-thumbnail {
    position: relative;
    aspect-ratio: 360/220;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--route-thumbnail);
    border-radius: 1rem;
    color: var(--primary);
  }
  .route-watermark {
    position: absolute;
    right: 0.7rem;
    bottom: 0.6rem;
    width: 4.8rem;
    height: 0.7rem;
    background: var(--primary);
    opacity: 0.45;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 78 10'%3E%3Ctext x='0' y='8' font-size='8' font-family='sans-serif' font-weight='700' letter-spacing='1.2'%3ERUNNOTE%3C/text%3E%3C/svg%3E")
      center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 78 10'%3E%3Ctext x='0' y='8' font-size='8' font-family='sans-serif' font-weight='700' letter-spacing='1.2'%3ERUNNOTE%3C/text%3E%3C/svg%3E")
      center / contain no-repeat;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0.65rem;
  }
  svg path {
    fill: none;
    stroke: var(--route-color, var(--primary));
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  svg circle {
    fill: var(--route-color, var(--primary));
  }
  .thumbnail-empty {
    text-align: center;
    color: var(--foreground);
  }
  .thumbnail-empty > span {
    font-size: var(--text-title);
    color: var(--primary);
  }
  .thumbnail-empty p {
    font-size: var(--text-caption);
    color: var(--foreground);
  }
  .compact {
    width: 104px;
    aspect-ratio: 4/3;
    border-radius: 0.625rem;
  }
  .compact .route-watermark {
    display: none;
  }
  .compact svg {
    padding: 0.25rem;
  }
  .compact .thumbnail-empty {
    padding: 0.25rem;
  }
  .compact .thumbnail-empty > span {
    font-size: var(--text-section);
  }
  .compact .thumbnail-empty p {
    font-size: var(--text-caption);
    line-height: var(--line-height-heading);
  }
  @media (max-width: 639px) {
    .compact {
      width: 80px;
    }
  }
</style>
