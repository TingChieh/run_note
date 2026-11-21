<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import { readAnnualStory, type AnnualStory } from '#lib/api/annual-story.ts';
  import { currentYear } from '#lib/api/statistics.ts';
  import FeedbackState from '#lib/components/FeedbackState.svelte';
  import PageSkeleton from '#lib/components/PageSkeleton.svelte';
  import StoryShareDialog from '#lib/components/StoryShareDialog.svelte';
  import StoryStageCanvas from '#lib/components/StoryStageCanvas.svelte';
  import {
    formatGain,
    formatStoryDuration,
    formatStoryPaceCompact,
    milestoneLabel,
    storyCoverage,
    storyDurationHours,
    storyHref,
    storyKm,
    storyLeadSentence,
    storyLocalClock,
    storyRangeText,
    storyShortDate,
    storyTitle,
    storyYearSelection,
    type StoryChapterId,
  } from '#lib/story.ts';

  let mounted = $state(false);
  let disposed = false;
  let requestToken = 0;
  let controller: AbortController | undefined;

  let story = $state<AnnualStory | null>(null);
  let serverToday = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');

  let activeChapter = $state<StoryChapterId>('first');
  let selectedCityCode = $state<string | null>(null);

  // Annual footprint animation state
  let filmProgress = $state(1);
  let filmPlaying = $state(false);
  let filmSpeed = $state(1);
  let rafId = 0;
  let lastTick = 0;

  let shareComponent = $state<StoryShareDialog | null>(null);
  let headerShareBtn = $state<HTMLButtonElement | null>(null);
  let chapterSectionEl = $state<HTMLElement | null>(null);

  const timezone = $derived(page.data.user?.timezone ?? 'UTC');
  const localYear = $derived(currentYear(timezone));
  const selectedYear = $derived(storyYearSelection(page.url.searchParams, localYear));
  const maxYear = $derived(serverToday ? Number(serverToday.slice(0, 4)) : localYear);
  const years = $derived(
    Array.from({ length: Math.max(maxYear, selectedYear) - 1899 }, (_, i) => Math.max(maxYear, selectedYear) - i),
  );
  const isCurrentYear = $derived(selectedYear === maxYear);
  const shownYear = $derived(story?.year ?? selectedYear);

  const leadSentence = $derived(story ? storyLeadSentence(story) : '');
  const coverage = $derived(story ? storyCoverage(story) : '');

  const stageMeta = $derived.by(() => {
    if (!story) return { kicker: '', title: '', pill: '', caption: '' };
    if (activeChapter === 'first') {
      const f = story.first_run;
      return {
        kicker: 'STAGE · CHAPTER 01',
        title: f?.title ?? '年度第一跑',
        pill: f?.has_track ? '首跑轨迹' : '里程标尺',
        caption: f ? `${f.activity_date} · ${storyKm(f.distance_m)} km · 全年第一串脚印` : '',
      };
    }
    if (activeChapter === 'longest') {
      const l = story.longest_route;
      return {
        kicker: 'STAGE · CHAPTER 02',
        title: l?.title ?? '年度最长路线',
        pill: l?.has_track ? '最长路线' : '里程标尺',
        caption: l
          ? `${l.activity_date} · ${storyKm(l.distance_m)} km${l.duration_seconds !== null ? ` · ${formatStoryDuration(l.duration_seconds)}` : ''}`
          : '',
      };
    }
    if (activeChapter === 'best') {
      const b = story.best_performance;
      return {
        kicker: 'STAGE · CHAPTER 03',
        title: b ? `${b.category} · ${b.title}` : '年度最佳表现',
        pill: b?.is_all_time_pb ? 'PB 纪录' : '年度最佳',
        caption: b
          ? b.avg_pace_seconds_per_km !== null
            ? `${formatStoryPaceCompact(b.avg_pace_seconds_per_km)}/km · ${b.activity_date}`
            : `${storyKm(b.distance_m)} km · ${b.activity_date}`
          : '',
      };
    }
    if (activeChapter === 'cities') {
      const ec = story.explored_cities;
      const city = selectedCityCode ? ec.items.find((c) => c.code === selectedCityCode) : null;
      return {
        kicker: 'STAGE · CHAPTER 04',
        title: city
          ? `${city.name}${city.region_name ? ` · ${city.region_name}` : ''}`
          : ec.total_cities > 0
            ? `${ec.total_cities} 座探索城市${ec.status === 'pending' ? '（计算中）' : ''}`
            : ec.status === 'pending'
              ? '城市足迹计算中'
              : story.footprint_timeline.has_tracks
                ? '暂无匹配城市记录'
                : '无户外定位记录',
        pill: ec.status === 'pending' && ec.total_cities === 0 ? '待计算' : '城市拓扑',
        caption: city
          ? `${city.activity_count} 次 · ${storyKm(city.distance_m, 1)} km · 首跑 ${storyShortDate(city.first_date)}`
          : ec.total_cities > 0
            ? ec.status === 'pending'
              ? `点击左侧任意城市聚焦已就绪足迹，另有 ${ec.pending_activity_count} 条轨迹仍在后台计算。`
              : '点击左侧任意城市聚焦该城足迹，金色标记为今年新点亮。'
            : ec.status === 'pending'
              ? `仍有 ${ec.pending_activity_count} 条轨迹正在解析城市归属，完成后将自动点亮对应城市。`
              : story.footprint_timeline.has_tracks
                ? '本年轨迹暂未匹配到图谱城市。'
                : '全年无 GPS 定位时自动以节律圆盘呈现。',
      };
    }
    const fr = story.frequent_route;
    return {
      kicker: 'STAGE · CHAPTER 05',
      title:
        fr.status === 'ready'
          ? (fr.name ?? '最常跑路线')
          : fr.status === 'building'
            ? '常跑路线归并中'
            : '每一次都是新出发',
      pill: fr.status === 'ready' ? '记忆叠影' : fr.status === 'building' ? '计算中' : '新路探索',
      caption:
        fr.status === 'ready'
          ? `叠加 ${fr.run_count} 次同路轨迹，亮线处为脚步重合最密的路线。`
          : fr.status === 'building'
            ? '后台正在比对并归并本年度重复轨迹，完成后将自动展示最常跑路线。'
            : '本年度没有重复跑过 2 次以上的户外路线。',
    };
  });

  const filmSnapshot = $derived.by(() => {
    if (!story || !story.footprint_timeline.items.length) {
      return { date: '—', km: '0.00 km', runs: '0 / 0 次', cities: '—', headline: '暂无足迹记录' };
    }
    const items = story.footprint_timeline.items;
    const total = items.length;
    const idx = Math.min(total - 1, Math.floor(filmProgress * total));
    const current = items[idx];
    const lit = new Set<string>();
    for (let i = 0; i <= idx; i++) {
      const code = items[i].city_code;
      if (code) lit.add(code);
    }
    const tag = milestoneLabel(current.milestone);
    const cityLabel = !story.footprint_timeline.has_tracks
      ? '无定位'
      : story.explored_cities.status === 'pending'
        ? lit.size > 0
          ? `${lit.size} 座（计算中）`
          : '计算中'
        : `${lit.size} 座`;
    return {
      date: current.activity_date,
      km: `${storyKm(current.cumulative_distance_m)} km`,
      runs: `${idx + 1} / ${total} 次`,
      cities: cityLabel,
      headline: tag
        ? `${current.activity_date} · ${tag} · ${current.title}`
        : `${current.activity_date} · ${current.city_name ?? '跑步记录'} · ${current.title}`,
    };
  });

  function stopFilm() {
    filmPlaying = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function startFilm() {
    if (!mounted || !story || !story.footprint_timeline.items.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stopFilm();
      filmProgress = 1;
      return;
    }
    if (filmProgress >= 0.999) filmProgress = 0;
    filmPlaying = true;
    lastTick = performance.now();
    const tickFrame = (now: number) => {
      if (disposed || !filmPlaying) return;
      const dt = Math.min(0.08, (now - lastTick) / 1000);
      lastTick = now;
      const durationSec = 10 / filmSpeed;
      filmProgress = Math.min(1, filmProgress + dt / durationSec);
      if (filmProgress >= 1) {
        stopFilm();
        return;
      }
      rafId = requestAnimationFrame(tickFrame);
    };
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tickFrame);
  }

  function toggleFilm() {
    if (filmPlaying) stopFilm();
    else startFilm();
  }

  function restartFilm() {
    stopFilm();
    filmProgress = 0;
    startFilm();
  }

  function selectYear(year: number) {
    const clamped = Math.min(2100, Math.max(1900, year));
    const href = storyHref(clamped);
    if (href !== page.url.pathname + page.url.search) void goto(href, { reset: false });
  }

  let manualFocusUntil = 0;

  function focusChapter(id: StoryChapterId) {
    manualFocusUntil = performance.now() + 600;
    activeChapter = id;
  }

  function toggleCity(code: string) {
    selectedCityCode = selectedCityCode === code ? null : code;
    focusChapter('cities');
  }

  async function load(year: number) {
    const mine = ++requestToken;
    controller?.abort();
    const { signal } = (controller = new AbortController());
    const fetcher: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    const active = () => !disposed && mine === requestToken;

    loading = true;
    error = '';
    stopFilm();
    try {
      const result = await readAnnualStory(year, fetcher);
      if (!active()) return;
      if (result.year !== year) {
        throw new ActivityError('年度故事服务返回了无效年份，请重试', 502, 'INVALID_RESPONSE');
      }
      story = result;
      serverToday = result.today;
      selectedCityCode = null;
      activeChapter = 'first';
      filmProgress = 1;
    } catch (cause) {
      if (!active()) return;
      if (cause instanceof ActivityError && cause.status === 401) {
        story = null;
        disposed = true;
        window.location.replace(
          '/admin?reason=expired&next=' + encodeURIComponent(page.url.pathname + page.url.search),
        );
        return;
      }
      story = null;
      error = cause instanceof Error ? cause.message : '年度故事读取失败，请稍后重试';
    } finally {
      if (active()) loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    return () => {
      disposed = true;
      stopFilm();
      controller?.abort();
    };
  });

  $effect(() => {
    if (mounted) {
      const year = selectedYear;
      untrack(() => void load(year));
    }
  });

  $effect(() => {
    if (!mounted || !chapterSectionEl || !story || typeof IntersectionObserver === 'undefined') return;
    const cards = Array.from(chapterSectionEl.querySelectorAll<HTMLElement>('[data-chapter]'));
    const observer = new IntersectionObserver(
      (entries) => {
        if (performance.now() < manualFocusUntil) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.chapter as StoryChapterId | undefined;
            if (id) activeChapter = id;
          }
        }
      },
      { rootMargin: '-30% 0px -52% 0px', threshold: 0.1 },
    );
    for (const card of cards) observer.observe(card);
    return () => observer.disconnect();
  });
</script>

<svelte:head><title>{storyTitle(shownYear)} · RunNote</title></svelte:head>

<div class="story-page" data-testid="annual-story-page">
  <a class="back-link text-muted-foreground" href="/workspace/records">‹ 返回个人记录</a>

  <header class="story-toolbar">
    <div class="toolbar-lead">
      <div class="title-row">
        <h1>{storyTitle(shownYear)}</h1>
        {#if story?.is_partial && story.cutoff_date}
          <span class="partial-pill" data-testid="story-partial-pill">
            进行中 · 截至 {storyShortDate(story.cutoff_date)}
          </span>
        {/if}
      </div>
      {#if story}
        <p class="range-text tabular">{storyRangeText(story)}</p>
      {/if}
    </div>

    <div class="year-controls">
      <div class="picker">
        <button
          type="button"
          class="button-secondary step-btn"
          aria-label="上一年"
          disabled={selectedYear <= 1900}
          onclick={() => selectYear(selectedYear - 1)}>‹</button
        >
        <select
          class="text-field year-select"
          aria-label="选择年份"
          value={selectedYear}
          onchange={(e) => selectYear(Number(e.currentTarget.value))}
        >
          {#each years as y (y)}<option value={y}>{y} 年</option>{/each}
        </select>
        <button
          type="button"
          class="button-secondary step-btn"
          aria-label="下一年"
          disabled={selectedYear >= maxYear}
          onclick={() => selectYear(selectedYear + 1)}>›</button
        >
      </div>
      {#if !isCurrentYear}
        <button type="button" class="button-secondary" onclick={() => selectYear(maxYear)}>回到今年</button>
      {/if}
      {#if story && story.summary.activity_count > 0}
        <button
          type="button"
          class="button-primary"
          bind:this={headerShareBtn}
          disabled={loading || !mounted}
          onclick={() => shareComponent?.open(headerShareBtn)}
        >
          生成海报
        </button>
      {/if}
    </div>
  </header>

  {#if loading && story}
    <p class="refresh-note" role="status">正在读取 {storyTitle(selectedYear)}…</p>
  {/if}

  {#if !story && loading}
    <PageSkeleton title={`正在读取 ${storyTitle(selectedYear)}…`} />
  {:else if error}
    <FeedbackState kind="error" title={error}>
      <button type="button" class="button-secondary" onclick={() => void load(selectedYear)}>重试</button>
    </FeedbackState>
  {:else if story}
    {#if story.summary.activity_count === 0}
      <FeedbackState
        kind="empty"
        title={story.date_from === story.date_to ? '这一年尚未开始' : `${story.year} 年还没有跑步记录`}
      />
    {:else}
      <!-- Prologue Card -->
      <section class="prologue-card" aria-label="年度故事序章" data-testid="story-prologue">
        <div class="prologue-top">
          <p class="mono-kicker">ANNUAL STORY · {story.year}</p>
          <p class="lead-sentence">{leadSentence}</p>
        </div>

        <dl class="prologue-metrics tabular" aria-label="年度核心概览">
          <div class="prologue-metric">
            <dt>年度总里程</dt>
            <dd class="accent">{storyKm(story.summary.distance_m)}<small>km</small></dd>
          </div>
          <div class="prologue-metric">
            <dt>跑步次数 / 天数</dt>
            <dd>{story.summary.activity_count}<small>次 · {story.summary.activity_days} 天</small></dd>
          </div>
          <div class="prologue-metric">
            <dt>总用时 / 均配速</dt>
            <dd>
              {formatStoryPaceCompact(story.summary.avg_pace_seconds_per_km)}
              {#if story.summary.avg_pace_seconds_per_km === null}
                <span class="sr-only">（数据缺失）</span>
              {:else}
                <small>/km</small>
              {/if}
              <small>· {storyDurationHours(story.summary.duration_sum_seconds)}</small>
            </dd>
          </div>
          <div class="prologue-metric">
            <dt>探索城市 / 连续周</dt>
            <dd>
              {story.explored_cities.total_cities > 0 ? story.explored_cities.total_cities : '—'}
              <small>
                {#if story.explored_cities.total_cities > 0}
                  座{story.explored_cities.status === 'pending' ? '（计算中）' : ''}
                {:else if story.explored_cities.status === 'pending'}
                  待计算
                {:else if story.footprint_timeline.has_tracks}
                  暂无匹配城市记录
                {:else}
                  无定位
                {/if}
                · 最长 {story.longest_streak_weeks} 周
              </small>
            </dd>
          </div>
        </dl>

        {#if coverage}
          <p class="coverage-banner" data-testid="story-coverage">{coverage}</p>
        {/if}

        <nav class="chapter-pills" aria-label="故事章节索引">
          <a href="#ch-first" class:is-active={activeChapter === 'first'} onclick={() => focusChapter('first')}>
            01 第一跑
          </a>
          <a href="#ch-longest" class:is-active={activeChapter === 'longest'} onclick={() => focusChapter('longest')}>
            02 最长路线
          </a>
          <a href="#ch-best" class:is-active={activeChapter === 'best'} onclick={() => focusChapter('best')}>
            03 最佳表现
          </a>
          <a href="#ch-cities" class:is-active={activeChapter === 'cities'} onclick={() => focusChapter('cities')}>
            04 探索城市
          </a>
          <a
            href="#ch-frequent"
            class:is-active={activeChapter === 'frequent'}
            onclick={() => focusChapter('frequent')}
          >
            05 最常跑路线
          </a>
          <a href="#ch-film">06 足迹动画</a>
        </nav>
      </section>

      <!-- Dual-column Chronicle Scroll & Sticky Synchronized Stage -->
      <section class="scrolly-layout" aria-label="年度叙事长卷" bind:this={chapterSectionEl}>
        <div class="narrative-column">
          <!-- Chapter 01: First Run -->
          {#if story.first_run}
            {@const first = story.first_run}
            {@const firstClock = storyLocalClock(first.started_at, first.timezone || timezone)}
            <article
              id="ch-first"
              class="chapter-card"
              class:is-focused={activeChapter === 'first'}
              data-chapter="first"
              data-testid="story-chapter-first"
            >
              <header class="chapter-head">
                <span class="chapter-num">CHAPTER 01</span>
                <button
                  type="button"
                  class="chapter-focus-btn"
                  aria-pressed={activeChapter === 'first'}
                  onclick={() => focusChapter('first')}
                >
                  启程时刻
                </button>
              </header>
              <h2>年度第一跑</h2>
              <div class="beat-hero-row">
                <p class="beat-big-num tabular">{storyKm(first.distance_m)}<small>km</small></p>
                <span class="beat-date-pill tabular">
                  {first.activity_date}{firstClock ? ` · ${firstClock}` : ''}
                </span>
              </div>
              <p class="beat-run-title">{first.title}</p>
              <dl class="beat-facts tabular">
                <div>
                  <dt>用时</dt>
                  <dd>{formatStoryDuration(first.duration_seconds)}</dd>
                </div>
                <div>
                  <dt>配速</dt>
                  <dd>
                    {formatStoryPaceCompact(first.avg_pace_seconds_per_km)}{first.avg_pace_seconds_per_km !== null
                      ? ' /km'
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt>地点</dt>
                  <dd>
                    {first.city_name ?? (first.has_track ? '未匹配城市' : '无定位记录')}
                  </dd>
                </div>
                {#if first.shoe_name}
                  <div>
                    <dt>跑鞋</dt>
                    <dd>{first.shoe_name}</dd>
                  </div>
                {/if}
              </dl>
            </article>
          {/if}

          <!-- Chapter 02: Longest Route -->
          {#if story.longest_route}
            {@const longest = story.longest_route}
            {@const avgDistM = Number(story.summary.distance_m) / Math.max(1, story.summary.activity_count)}
            {@const ratio = avgDistM > 0 ? (Number(longest.distance_m) / avgDistM).toFixed(1) : null}
            <article
              id="ch-longest"
              class="chapter-card"
              class:is-focused={activeChapter === 'longest'}
              data-chapter="longest"
              data-testid="story-chapter-longest"
            >
              <header class="chapter-head">
                <span class="chapter-num">CHAPTER 02</span>
                <button
                  type="button"
                  class="chapter-focus-btn"
                  aria-pressed={activeChapter === 'longest'}
                  onclick={() => focusChapter('longest')}
                >
                  最远边界
                </button>
              </header>
              <h2>年度最长路线</h2>
              <div class="beat-hero-row">
                <p class="beat-big-num tabular">{storyKm(longest.distance_m)}<small>km</small></p>
                <span class="beat-date-pill tabular">
                  {longest.activity_date}{longest.tied_count > 1 ? ` · 并列 ${longest.tied_count} 次` : ''}
                </span>
              </div>
              <p class="beat-run-title">{longest.title}</p>
              <p class="beat-narrative">
                {#if longest.same_as_first}
                  本次同时是今年开年第一跑。
                {:else if ratio && Number(ratio) > 1.1}
                  单次里程达到全年均距（{storyKm(avgDistM, 1)} km）的 {ratio} 倍。
                {/if}
                {#if !longest.has_track}
                  该记录无户外 GPS 轨迹，舞台以里程标尺呈现。
                {/if}
              </p>
              <dl class="beat-facts tabular">
                <div>
                  <dt>用时</dt>
                  <dd>{formatStoryDuration(longest.duration_seconds)}</dd>
                </div>
                <div>
                  <dt>均配速</dt>
                  <dd>
                    {formatStoryPaceCompact(longest.avg_pace_seconds_per_km)}{longest.avg_pace_seconds_per_km !== null
                      ? ' /km'
                      : ''}
                  </dd>
                </div>
                {#if longest.city_name}
                  <div>
                    <dt>城市</dt>
                    <dd>{longest.city_name}</dd>
                  </div>
                {/if}
                {#if longest.shoe_name}
                  <div>
                    <dt>跑鞋</dt>
                    <dd>{longest.shoe_name}</dd>
                  </div>
                {/if}
              </dl>
            </article>
          {/if}

          <!-- Chapter 03: Best Performance -->
          {#if story.best_performance}
            {@const best = story.best_performance}
            {@const gain = formatGain(best.pace_gain_seconds_per_km)}
            <article
              id="ch-best"
              class="chapter-card"
              class:is-focused={activeChapter === 'best'}
              data-chapter="best"
              data-testid="story-chapter-best"
            >
              <header class="chapter-head">
                <span class="chapter-num">CHAPTER 03</span>
                <button
                  type="button"
                  class="chapter-focus-btn"
                  aria-pressed={activeChapter === 'best'}
                  onclick={() => focusChapter('best')}
                >
                  巅峰速度
                </button>
              </header>
              <h2>年度最佳表现</h2>
              <div class="beat-hero-row">
                <p class="beat-big-num tabular">
                  {#if best.avg_pace_seconds_per_km !== null}
                    {formatStoryPaceCompact(best.avg_pace_seconds_per_km)}<small>/km · {best.category}</small>
                  {:else}
                    {storyKm(best.distance_m)}<small>km · {best.category}</small>
                  {/if}
                </p>
                {#if best.is_all_time_pb}
                  <span class="pb-badge">刷新历史 PB</span>
                {:else}
                  <span class="beat-date-pill tabular">{best.activity_date}</span>
                {/if}
              </div>
              <p class="beat-run-title">
                {best.title}{best.duration_seconds !== null ? ` · ${formatStoryDuration(best.duration_seconds)}` : ''}
              </p>
              <p class="beat-narrative">
                {#if best.basis === 'distance_fallback'}
                  全年记录缺少有效计时，以单次最长距离作为年度高光表现。
                {:else if gain}
                  较当年首次 {best.category} 提速 {gain}，完成于 {best.activity_date}。
                {:else}
                  完成于 {best.activity_date}{best.city_name ? ` · ${best.city_name}` : ''}。
                {/if}
              </p>
              {#if best.other_bests.length > 0}
                <div class="sub-bests tabular">
                  {#each best.other_bests as item (item.category)}
                    <span class="sub-best-chip">
                      {item.category} · {formatStoryPaceCompact(item.avg_pace_seconds_per_km)}/km（{formatStoryDuration(
                        item.duration_seconds,
                      )}）
                    </span>
                  {/each}
                </div>
              {/if}
            </article>
          {/if}

          <!-- Chapter 04: Explored Cities -->
          <article
            id="ch-cities"
            class="chapter-card"
            class:is-focused={activeChapter === 'cities'}
            data-chapter="cities"
            data-testid="story-chapter-cities"
          >
            <header class="chapter-head">
              <span class="chapter-num">CHAPTER 04</span>
              <button
                type="button"
                class="chapter-focus-btn"
                aria-pressed={activeChapter === 'cities'}
                onclick={() => focusChapter('cities')}
              >
                地理版图
              </button>
            </header>
            <h2>探索城市</h2>
            {#if story.explored_cities.status === 'pending' && story.explored_cities.total_cities > 0}
              <p class="coverage-banner" role="status">
                仍有 {story.explored_cities.pending_activity_count} 条轨迹的城市归属正在后台计算，当前展示已就绪的
                {story.explored_cities.total_cities} 座城市。
              </p>
            {/if}
            {#if story.explored_cities.total_cities === 0}
              {#if story.explored_cities.status === 'pending'}
                <div class="fallback-box" role="status">
                  <strong>城市足迹正在后台计算</strong>
                  <p>
                    还有 {story.explored_cities.pending_activity_count} 条带轨迹记录等待解析城市归属{#if story.explored_cities.unlocated_activity_count > 0}（另有
                      {story.explored_cities.unlocated_activity_count} 次无定位记录）{/if}，完成后将自动点亮对应城市。
                  </p>
                </div>
              {:else if story.footprint_timeline.has_tracks}
                <div class="fallback-box">
                  <strong>暂无匹配城市记录</strong>
                  <p>
                    本年度已有户外轨迹记录，但暂未匹配到图谱城市（共 {story.explored_cities.unlocated_activity_count} 次未归入城市）。
                  </p>
                </div>
              {:else}
                <div class="fallback-box">
                  <strong>无定位记录年度</strong>
                  <p>
                    全年 {story.explored_cities.unlocated_activity_count} 次记录均无户外 GPS 定位。导入带轨迹的跑步后，这里会自动点亮跑过的城市。
                  </p>
                </div>
              {/if}
            {:else}
              <p class="beat-narrative">
                {#if story.explored_cities.status === 'pending'}
                  当前已识别 <strong>{story.explored_cities.total_regions}</strong> 个区域、
                  <strong>{story.explored_cities.total_cities}</strong> 座城（部分轨迹仍在计算）。
                {:else if story.explored_cities.total_cities === 1}
                  这一年深耕 <strong>{story.explored_cities.items[0].name}</strong>，共完成
                  {story.explored_cities.items[0].activity_count} 次奔跑。
                {:else}
                  跨越 <strong>{story.explored_cities.total_regions}</strong> 个区域、
                  <strong>{story.explored_cities.total_cities}</strong>
                  座城{#if story.explored_cities.new_cities_count > 0}，其中
                    <strong>{story.explored_cities.new_cities_count}</strong> 座为 {story.year} 年首次点亮{/if}。
                {/if}
              </p>
              <div class="city-list">
                {#each story.explored_cities.items as city (city.code)}
                  <button
                    type="button"
                    class="city-row"
                    aria-pressed={selectedCityCode === city.code}
                    onclick={() => toggleCity(city.code)}
                  >
                    <span class="city-row-main">
                      <strong>{city.name}</strong>
                      {#if city.region_name}<span class="city-region">{city.region_name}</span>{/if}
                      {#if city.is_new}<span class="city-new-tag">新点亮</span>{/if}
                    </span>
                    <span class="city-row-stats tabular">
                      {city.activity_count} 次 · {storyKm(city.distance_m, 1)} km
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </article>

          <!-- Chapter 05: Most Frequent Route -->
          <article
            id="ch-frequent"
            class="chapter-card"
            class:is-focused={activeChapter === 'frequent'}
            data-chapter="frequent"
            data-testid="story-chapter-frequent"
          >
            <header class="chapter-head">
              <span class="chapter-num">CHAPTER 05</span>
              <button
                type="button"
                class="chapter-focus-btn"
                aria-pressed={activeChapter === 'frequent'}
                onclick={() => focusChapter('frequent')}
              >
                熟悉节律
              </button>
            </header>
            <h2>最常跑路线</h2>
            {#if story.frequent_route.status === 'building'}
              <div class="fallback-box">
                <strong>常跑路线仍在归并中</strong>
                <p>后台正在分析重复轨迹，稍后刷新即可查看这一年跑得最多的一条路。</p>
              </div>
            {:else if story.frequent_route.status === 'none'}
              <div class="fallback-box">
                <strong>每一次都是新出发</strong>
                <p>本年度没有重复跑过 2 次以上的户外轨迹，每一段路都各自独立。</p>
              </div>
            {:else}
              {@const fr = story.frequent_route}
              {@const maxHit = Math.max(1, ...fr.monthly_hits)}
              {@const imp = formatGain(fr.pace_improvement_seconds_per_km)}
              <div class="beat-hero-row">
                <p class="beat-big-num tabular">{fr.run_count}<small>次重逢 · 占全年 {fr.share_pct}%</small></p>
                {#if fr.median_distance_m !== null}
                  <span class="beat-date-pill tabular">中位 {storyKm(fr.median_distance_m)} km</span>
                {/if}
              </div>
              <p class="beat-run-title">
                {fr.name ?? '常跑路线'}{fr.city_name ? `（${fr.city_name}）` : ''}
              </p>
              <p class="beat-narrative">
                {#if fr.first_date && fr.last_date}
                  从 {storyShortDate(fr.first_date)} 到 {storyShortDate(fr.last_date)}
                {/if}
                {#if imp}
                  ，同路最快配速较年初提速 {imp}（{formatStoryPaceCompact(fr.first_pace_seconds_per_km)} →
                  {formatStoryPaceCompact(fr.best_pace_seconds_per_km)} /km）。
                {:else if fr.best_pace_seconds_per_km !== null}
                  ，最佳均配 {formatStoryPaceCompact(fr.best_pace_seconds_per_km)} /km。
                {/if}
              </p>
              <div class="freq-months" aria-label="最常跑路线各月打卡次数">
                {#each fr.monthly_hits as hits, idx (idx)}
                  <div class="freq-bar-col">
                    <div
                      class="freq-bar"
                      class:is-zero={hits === 0}
                      style:height={`${hits > 0 ? Math.max(8, Math.round((hits / maxHit) * 34)) : 4}px`}
                      title={`${idx + 1}月：${hits}次`}
                    ></div>
                    <span class="freq-bar-lbl tabular">{idx + 1}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </article>
        </div>

        <!-- Sticky Synchronized Cartographic Stage -->
        <aside class="stage-column" aria-label="同步路线与地理舞台">
          <div class="sticky-stage-card" data-testid="story-sticky-stage">
            <div class="stage-header">
              <div class="stage-head-copy">
                <span class="stage-kicker">{stageMeta.kicker}</span>
                <strong class="stage-title">{stageMeta.title}</strong>
              </div>
              <span class="stage-mode-pill">{stageMeta.pill}</span>
            </div>
            <div class="stage-canvas-wrap">
              <StoryStageCanvas
                {story}
                mode={activeChapter}
                {selectedCityCode}
                label={`当前章节轨迹示意：${stageMeta.title}`}
                testid="story-sticky-canvas"
              />
            </div>
            <div class="stage-footer">
              <span class="stage-caption">{stageMeta.caption}</span>
              <div class="settings-tabs stage-quick-dots" role="group" aria-label="切换同步舞台章节">
                {#each [['first', '01'], ['longest', '02'], ['best', '03'], ['cities', '04'], ['frequent', '05']] as const as [id, code] (id)}
                  <button type="button" aria-pressed={activeChapter === id} onclick={() => focusChapter(id)}>
                    {code}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </aside>
      </section>

      <!-- Chapter 06: Annual Footprint Animation Finale -->
      <section class="finale-card" id="ch-film" aria-labelledby="finale-title" data-testid="story-footprint-finale">
        <div class="finale-head">
          <div>
            <p class="mono-kicker">CHAPTER 06 · ANNUAL FOOTPRINT ANIMATION</p>
            <h2 id="finale-title">年度足迹动画</h2>
          </div>
          <div class="finale-live-stats tabular">
            <div class="live-chip">
              <span>当前日期</span>
              <strong data-testid="story-film-date">{filmSnapshot.date}</strong>
            </div>
            <div class="live-chip">
              <span>累计里程</span>
              <strong data-testid="story-film-km">{filmSnapshot.km}</strong>
            </div>
            <div class="live-chip">
              <span>累计出发</span>
              <strong data-testid="story-film-runs">{filmSnapshot.runs}</strong>
            </div>
            <div class="live-chip">
              <span>已点亮城市</span>
              <strong data-testid="story-film-cities">{filmSnapshot.cities}</strong>
            </div>
          </div>
        </div>

        <div class="finale-canvas-wrap">
          <StoryStageCanvas
            {story}
            mode="annual"
            progress={filmProgress}
            label={`${story.year} 年全年跑步足迹按时间生长动画`}
            testid="story-annual-canvas"
          />
          <div class="finale-overlay-tag" data-testid="story-film-headline">{filmSnapshot.headline}</div>
        </div>

        <div class="player-bar">
          <div class="player-actions">
            <button type="button" class="button-primary" data-testid="story-film-play" onclick={toggleFilm}>
              {filmPlaying ? '暂停播放' : filmProgress >= 0.999 ? '重新播放' : '播放足迹'}
            </button>
            <button type="button" class="button-secondary" onclick={restartFilm}>重头开始</button>
            <div class="settings-tabs speed-tabs" role="group" aria-label="播放倍速">
              {#each [1, 2, 4] as sp (sp)}
                <button type="button" aria-pressed={filmSpeed === sp} onclick={() => (filmSpeed = sp)}>
                  {sp}x
                </button>
              {/each}
            </div>
          </div>

          <div class="scrubber-wrap">
            <label for="story-film-scrubber" class="sr-only">年度足迹进度</label>
            <input
              id="story-film-scrubber"
              type="range"
              min="0"
              max="1000"
              value={Math.round(filmProgress * 1000)}
              oninput={(e) => {
                stopFilm();
                filmProgress = Number(e.currentTarget.value) / 1000;
              }}
            />
            <div class="month-ticks tabular" aria-hidden="true">
              <span>1月</span><span>3月</span><span>5月</span><span>7月</span><span>9月</span><span>11月</span><span
                >12月</span
              >
            </div>
          </div>
        </div>

        <details class="story-table-details">
          <summary>查看全年各月足迹数据表</summary>
          <div class="table-scroll" role="region" aria-label={`${story.year} 年各月跑步次数与里程数据表`}>
            <table class="tabular">
              <caption class="sr-only">{story.year} 年各月跑步次数与里程汇总</caption>
              <thead>
                <tr>
                  <th scope="col">月份</th>
                  <th scope="col">跑步次数</th>
                  <th scope="col">月里程 (km)</th>
                </tr>
              </thead>
              <tbody>
                {#each story.footprint_timeline.monthly_distance_m as dist, idx (idx)}
                  <tr>
                    <th scope="row">{idx + 1} 月</th>
                    <td>{story.footprint_timeline.monthly_activity_count[idx]} 次</td>
                    <td>{storyKm(dist)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <!-- Keepsake Poster Dock & Native Dialog -->
      <StoryShareDialog bind:this={shareComponent} {story} disabled={loading} />
    {/if}
  {/if}
</div>

<style>
  .story-page {
    max-width: 76rem;
    margin-inline: auto;
    min-width: 0;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    font-size: var(--text-small);
  }
  .story-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  .toolbar-lead {
    min-width: 0;
  }
  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  h1 {
    font-size: var(--text-title);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-title);
    letter-spacing: var(--tracking-title);
  }
  .partial-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--primary-soft);
    color: var(--primary);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .range-text,
  .refresh-note {
    margin-top: var(--space-1);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .year-controls,
  .picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .picker {
    flex-wrap: nowrap;
  }
  .step-btn {
    width: 2.75rem;
    padding: 0;
    font-size: var(--text-section);
    line-height: var(--line-height-solid);
  }
  .year-select {
    width: auto;
    min-height: 2.75rem;
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }

  /* Prologue Card */
  .prologue-card {
    background: var(--header-tint);
    color: var(--header-ink);
    border-radius: var(--radius-card);
    padding: clamp(1.25rem, 3vw, 2rem);
    border: 1px solid var(--border);
    display: grid;
    gap: var(--space-4);
  }
  .prologue-top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-6);
  }
  .mono-kicker {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    color: var(--header-ink-muted);
  }
  .finale-card .mono-kicker {
    color: var(--primary);
  }
  .lead-sentence {
    font-size: var(--text-body);
    font-weight: var(--weight-medium);
    line-height: var(--line-height-body);
    max-width: 34rem;
  }
  .prologue-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    background: var(--surface);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    padding: var(--space-4);
  }
  .prologue-metric {
    min-width: 0;
    padding-inline: var(--space-4);
  }
  .prologue-metric:first-child {
    padding-left: 0;
  }
  .prologue-metric:last-child {
    padding-right: 0;
  }
  .prologue-metric + .prologue-metric {
    border-left: 1px solid var(--border);
  }
  .prologue-metric dt {
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--muted-foreground);
  }
  .prologue-metric dd {
    margin-top: var(--space-1);
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    overflow-wrap: anywhere;
  }
  .prologue-metric dd.accent {
    color: var(--primary);
  }
  .prologue-metric dd small {
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--muted-foreground);
    margin-left: var(--space-1);
  }
  .coverage-banner {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--warning-soft);
    border: 1px solid var(--warning-border);
    color: var(--warning);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
  }
  .chapter-pills {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chapter-pills a {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--header-tab-track);
    color: var(--header-ink);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    border: 1px solid var(--border);
  }
  .chapter-pills a.is-active,
  .chapter-pills a:hover {
    background: var(--primary);
    color: var(--primary-foreground);
    border-color: var(--primary);
  }

  /* Scrollytelling Two-Column Layout */
  .scrolly-layout {
    margin-top: var(--space-6);
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(22rem, 1.05fr);
    gap: var(--space-6);
    align-items: start;
  }
  .narrative-column {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .chapter-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: var(--space-6);
    display: grid;
    gap: var(--space-3);
    scroll-margin-top: 5.5rem;
  }
  .chapter-card.is-focused {
    border-color: var(--primary);
  }
  .chapter-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .chapter-num {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--primary);
    letter-spacing: var(--tracking-caps);
  }
  .chapter-focus-btn {
    border: 1px solid var(--border);
    background: var(--muted);
    color: var(--muted-foreground);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .chapter-focus-btn[aria-pressed='true'] {
    background: var(--primary-soft);
    color: var(--primary);
    border-color: var(--primary);
  }
  .chapter-card h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .beat-hero-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
  }
  .beat-big-num {
    font-size: var(--text-title);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    color: var(--primary);
  }
  .beat-big-num small {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--muted-foreground);
    margin-left: var(--space-1);
  }
  .beat-date-pill {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    background: var(--muted);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
  }
  .beat-run-title {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .beat-narrative {
    font-size: var(--text-small);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
  }
  .beat-facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .beat-facts > div {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .beat-facts dt {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .beat-facts dd {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .pb-badge {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--error-soft);
    color: var(--error);
    border: 1px solid var(--error-border);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .sub-bests {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .sub-best-chip {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--muted);
    font-size: var(--text-caption);
  }
  .city-list {
    display: grid;
    gap: var(--space-2);
  }
  .city-row {
    width: 100%;
    text-align: left;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-control);
    border: 1px solid var(--border);
    background: var(--background);
  }
  .city-row[aria-pressed='true'] {
    border-color: var(--primary);
    background: var(--primary-soft);
  }
  .city-row-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .city-region {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .city-new-tag {
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--warning-soft);
    border: 1px solid var(--warning-border);
    color: var(--warning);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .city-row-stats {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .freq-months {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-1);
    align-items: end;
    padding-top: var(--space-2);
  }
  .freq-bar-col {
    display: grid;
    gap: var(--space-1);
    justify-items: center;
  }
  .freq-bar {
    width: 100%;
    border-radius: 4px;
    background: var(--primary);
  }
  .freq-bar.is-zero {
    background: var(--border);
  }
  .freq-bar-lbl {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .fallback-box {
    padding: var(--space-4);
    border-radius: var(--radius-control);
    border: 1px dashed var(--border);
    background: var(--background);
    display: grid;
    gap: var(--space-1);
  }
  .fallback-box strong {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
  }
  .fallback-box p {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }

  /* Sticky Stage */
  .stage-column {
    position: sticky;
    top: 5rem;
    min-width: 0;
  }
  .sticky-stage-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .stage-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .stage-head-copy {
    min-width: 0;
  }
  .stage-kicker {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    color: var(--primary);
    letter-spacing: var(--tracking-caps);
  }
  .stage-title {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
  }
  .stage-mode-pill {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }
  .stage-canvas-wrap {
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-control);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .stage-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .stage-caption {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    flex: 1 1 12rem;
  }
  .stage-quick-dots button {
    min-width: 2.15rem;
    min-height: 2rem;
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }

  /* Chapter 06: Annual Footprint Animation Finale */
  .finale-card {
    margin-top: var(--space-6);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: clamp(1.25rem, 3vw, 2rem);
    display: grid;
    gap: var(--space-4);
    scroll-margin-top: 5.5rem;
  }
  .finale-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .finale-head h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-heading);
    margin-top: var(--space-1);
  }
  .finale-live-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .live-chip {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--muted);
    display: grid;
    gap: var(--space-1);
    min-width: 6.2rem;
  }
  .live-chip span {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .live-chip strong {
    font-size: var(--text-small);
    font-weight: var(--weight-bold);
  }
  .finale-canvas-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-control);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .finale-overlay-tag {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    max-width: calc(100% - 1.5rem);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
  }
  .player-bar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
  }
  .player-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .speed-tabs {
    width: auto;
    margin: 0;
  }
  .scrubber-wrap {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .scrubber-wrap input[type='range'] {
    width: 100%;
    min-height: 2rem;
    accent-color: var(--primary);
    border: 0;
    background: transparent;
  }
  .month-ticks {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .story-table-details summary {
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--primary);
  }
  .table-scroll {
    margin-top: var(--space-3);
    overflow-x: auto;
  }
  .table-scroll table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-small);
  }
  .table-scroll th,
  .table-scroll td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .table-scroll thead th {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .table-scroll tbody th {
    font-weight: var(--weight-medium);
  }

  @media (max-width: 1023px) {
    .scrolly-layout {
      grid-template-columns: 1fr;
    }
    .stage-column {
      position: static;
      order: -1;
    }
    .prologue-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: var(--space-4);
    }
    .prologue-metric:nth-child(odd) {
      padding-left: 0;
      border-left: 0;
    }
    .prologue-metric:nth-child(n + 3) {
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
    }
  }
  @media (max-width: 639px) {
    .player-bar {
      grid-template-columns: 1fr;
    }
    .finale-canvas-wrap {
      aspect-ratio: 4 / 3;
    }
    .prologue-metrics {
      grid-template-columns: 1fr;
    }
    .prologue-metric {
      padding: var(--space-2) 0;
      border-left: 0;
    }
    .prologue-metric + .prologue-metric {
      border-top: 1px solid var(--border);
    }
    .chapter-card {
      padding: var(--space-4);
    }
  }
</style>
