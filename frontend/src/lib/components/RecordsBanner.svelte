<script lang="ts">
  import { onMount } from 'svelte';
  import { formatDuration } from '#lib/api/activities.ts';
  import { CATEGORY_NAMES, CATEGORY_RANGES, gainWords, kmNumber, progressSpan, recordMonth, recordSentence, type CategoryBest, type Totals } from '#lib/api/records.ts';
  // Presentational only: every number comes from the server; `year` only decides whether dates repeat the year.
  let { bests, totals, variant = 'compact', href, year }: { bests: CategoryBest[]; totals: Totals; variant?: 'compact' | 'hero'; href?: string; year?: number } = $props();

  // Entrance: paces count down from the first run to the best, the total counts up and the progress
  // tracks draw when the banner first comes into view. Final values are the default state: they render
  // for SSR, reduced motion, print, browsers without IntersectionObserver and any time the animation is
  // not running, and screen readers always read the final values from the sr-only text.
  const uid = $props.id();
  let progress = $state(1), playing = $state(false);
  let root: HTMLElement;
  const between = (from: number, to: number) => from + (to - from) * progress;
  const pace = (item: CategoryBest) => {
    const best = Number(item.best?.avg_pace_seconds_per_km), first = Number(item.first?.avg_pace_seconds_per_km);
    return formatDuration(item.pace_gain_seconds_per_km !== null && Number.isFinite(first) ? Math.round(between(first, best)) : best);
  };
  const totalKm = $derived(progress === 1 ? kmNumber(totals.distance_m) : kmNumber(Math.round(between(0, Number(totals.distance_m) / 1000)) * 1000));
  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    let frame = 0, start = 0, fallback = 0;
    const finish = () => { cancelAnimationFrame(frame); clearTimeout(fallback); progress = 1; };
    const run = () => {
      playing = true; progress = 0;
      const step = (now: number) => {
        start ||= now;
        const k = Math.min(1, (now - start) / 1100);
        progress = 1 - (1 - k) ** 3;
        if (k < 1) frame = requestAnimationFrame(step); else clearTimeout(fallback);
      };
      frame = requestAnimationFrame(step);
      // rAF pauses in background tabs; never leave the numbers mid-count.
      fallback = window.setTimeout(finish, 1600);
    };
    // Already on screen at mount: start before the first paint, so the final values never flash first.
    const box = root.getBoundingClientRect();
    if (box.bottom > 0 && box.top < window.innerHeight) { run(); }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); if (!playing) run(); } }, { threshold: 0 });
    if (!playing) observer.observe(root);
    window.addEventListener('beforeprint', finish);
    return () => { observer.disconnect(); finish(); window.removeEventListener('beforeprint', finish); };
  });
</script>

<section bind:this={root} class="records-banner" class:hero={variant === 'hero'} class:play={playing} aria-labelledby={`${uid}-title`} data-testid="records-banner">
  <div class="banner-head">
    <div><p class="eyebrow">全部历史 · 整次活动</p><h2 id={`${uid}-title`}>{variant === 'hero' ? '最佳成绩' : '个人记录'}</h2></div>
    {#if href}<a class="button-secondary banner-link" {href} aria-label="查看全部个人记录">查看全部<span aria-hidden="true">→</span></a>{/if}
  </div>
  <div class="banner-body">
    {#each bests as item (item.category)}
      {@const name = CATEGORY_NAMES[item.category]}
      {@const words = gainWords(item.pace_gain_seconds_per_km)}
      <article class="panel" data-kind={item.category} class:empty={!item.best} data-testid={`records-banner-${item.category}`} aria-label={`${name} 最佳成绩`}>
        <p class="label"><span class="bib">{name}</span>{item.best ? '最佳配速' : '等你来跑'}</p>
        {#if item.best}
          {@const best = formatDuration(item.best.avg_pace_seconds_per_km)}
          <p class="figure"><span class="sr-only">最佳配速 {best} /km</span><strong aria-hidden="true">{pace(item)}</strong><span aria-hidden="true">/km</span></p>
          <p class="line">{recordSentence(item.best, year)}</p>
          <p class="line">共跑过 {item.best.qualifying_count} 次 {name} 级</p>
          {#if item.first && words}
            {@const first = formatDuration(item.first.avg_pace_seconds_per_km)}
            <div class="track" role="img" aria-label={`首次配速 ${first}，最佳配速 ${best}，快了 ${words}每公里`} data-testid={`records-banner-gain-${item.category}`} style:--span={progressSpan(item.first.avg_pace_seconds_per_km, item.pace_gain_seconds_per_km)}>
              <span class="rail" aria-hidden="true"><span class="dot first"></span><span class="segment"></span><span class="dot best"></span></span>
              <span class="ends" aria-hidden="true"><span>首次 {first}</span><span>最佳 {best}</span></span>
            </div>
            <p class="gain">比第一次快了 {words} / km</p>
          {:else if item.best.qualifying_count === 1}
            <p class="line note">再跑一次 {name}，就能和这次比一比</p>
          {:else if item.pace_gain_seconds_per_km === null}
            <p class="line note">最快的一次仍是第一次</p>
          {:else}
            <p class="line note">和第一次几乎一样快</p>
          {/if}
        {:else}
          <p class="missing">还没有 {name} 记录</p>
          <p class="line"><span class="phrase">跑一次 {CATEGORY_RANGES[item.category]} 的整次跑步，</span><span class="phrase">就会出现在这里</span></p>
        {/if}
      </article>
    {/each}
    <article class="panel" data-kind="total" class:empty={totals.activity_count === 0} data-testid="records-banner-total" aria-label="跑步总览">
      <p class="label"><span class="bib">累计</span>{totals.activity_count > 0 ? '全部里程' : '从第一步开始'}</p>
      {#if totals.activity_count > 0}
        <p class="figure"><span class="sr-only">累计里程 {kmNumber(totals.distance_m)} km</span><strong aria-hidden="true">{totalKm}</strong><span aria-hidden="true">km</span></p>
        <!-- Wide: one fact per line. Full-width strip: one flowing line. Phone: two lines. -->
        <p class="facts">
          <span class="group"><span>共 {totals.activity_count.toLocaleString('zh-CN')} 次 · {totals.activity_days.toLocaleString('zh-CN')} 个活动日</span></span>
          <span class="group">{#if totals.first_activity_date}<span>从 {recordMonth(totals.first_activity_date)}开始</span>{/if}{#if totals.avg_pace_seconds_per_km !== null}<span>平均配速 {formatDuration(totals.avg_pace_seconds_per_km)} /km</span>{/if}</span>
        </p>
      {:else}
        <p class="missing">还没有跑步记录</p>
        <p class="line"><span class="phrase">第一次跑步之后，</span><span class="phrase">这里会开始累计你的里程</span></p>
      {/if}
    </article>
  </div>
</section>

<style>
  /* Same language as the dashboard cards: one flat surface card, a round sport-colour chip, muted labels, plain
     numerals. The three columns are separated by hairlines instead of nesting tinted blocks inside the card. */
  .records-banner { --gap: var(--space-6); position: relative; container-type: inline-size; min-width: 0; padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); }
  .banner-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6); }
  .eyebrow { margin-bottom: .25rem; color: var(--muted-foreground); font-size: var(--text-caption); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .banner-link { gap: var(--space-1); border-radius: var(--radius-pill); color: var(--primary); }

  .banner-body { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
  .panel { --tone: var(--sport-green); min-width: 0; padding-inline: var(--gap); }
  .panel:first-child { padding-left: 0; }
  .panel:last-child { padding-right: 0; }
  .panel + .panel { border-left: 1px solid var(--border); }
  .panel[data-kind="10km"] { --tone: var(--sport-blue); }
  .panel[data-kind="total"] { --tone: var(--sport-yellow-accent); }
  /* Three-column layout only: number on top, facts settle at the bottom so the column balances its taller neighbours. */
  @container (min-width: 54.0625rem) {
    .panel[data-kind="total"]:not(.empty) { display: flex; flex-direction: column; }
    .panel[data-kind="total"]:not(.empty) .facts { margin-top: auto; padding-top: var(--space-3); border-top: 1px solid var(--border); }
  }

  .label { display: flex; align-items: center; gap: var(--space-3); color: var(--muted-foreground); font-size: var(--text-small); }
  /* Same round chip as the annual metric cards. */
  .bib { display: inline-grid; place-items: center; flex-shrink: 0; min-width: 2.5rem; height: 2.5rem; border-radius: 50%; background: var(--tone); color: var(--sport-ink); font-size: var(--text-caption); font-weight: var(--weight-bold); }
  .empty .bib { background: transparent; box-shadow: inset 0 0 0 1.5px var(--tone); color: var(--foreground); }
  .figure { display: flex; align-items: baseline; gap: var(--space-2); margin-top: var(--space-4); font-variant-numeric: tabular-nums; }
  .figure strong { color: var(--foreground); font-size: var(--text-stat); font-weight: var(--weight-bold); line-height: var(--line-height-tight); letter-spacing: 0; }
  .figure > span:last-child { color: var(--muted-foreground); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .line, .facts { color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-body); }
  .figure + .line, .figure + .facts { margin-top: var(--space-2); }
  .facts span { display: block; }
  .line { text-wrap: pretty; }
  /* Chinese wraps between any two characters; keep each phrase whole so lines break at the comma. */
  .phrase { display: inline-block; }
  .note { margin-top: var(--space-2); }
  .missing { margin-top: var(--space-4); color: var(--foreground); font-size: var(--text-card); font-weight: var(--weight-semibold); }
  .missing + .line { margin-top: var(--space-1); }

  /* Progress track: hollow first run, filled best; the length only hints at the size of the gain. */
  .track { display: grid; gap: var(--space-1); width: min(100%, max(10rem, calc(var(--span) * 16rem))); margin-top: var(--space-4); }
  .rail { position: relative; display: flex; align-items: center; height: .875rem; }
  .rail::before { content: ''; position: absolute; inset: 50% 0 auto; height: 4px; margin-top: -2px; border-radius: var(--radius-pill); background: var(--border); }
  .segment { position: relative; flex: 1; height: 4px; margin-inline: -2px; border-radius: var(--radius-pill); background: var(--primary); transform-origin: left center; }
  .dot { position: relative; z-index: 1; flex-shrink: 0; width: .875rem; height: .875rem; border-radius: 50%; border: 2.5px solid var(--primary); }
  .dot.first { background: var(--surface); }
  .dot.best { background: var(--primary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 18%, transparent); }
  /* Only while playing; the resting state is always the finished track. */
  .play .segment { animation: draw-track 1100ms cubic-bezier(.22, .61, .36, 1) both; }
  .play .dot.best { animation: pop-best 320ms cubic-bezier(.22, .61, .36, 1) 900ms both; }
  @keyframes draw-track { from { transform: scaleX(0); } }
  @keyframes pop-best { from { opacity: 0; transform: scale(.4); } }
  @media print { .play .segment, .play .dot.best { animation: none; } }
  .ends { display: flex; justify-content: space-between; gap: var(--space-2); color: var(--muted-foreground); font-size: var(--text-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ends > span:last-child { color: var(--foreground); font-weight: var(--weight-bold); }
  .gain { margin-top: var(--space-2); color: var(--primary); font-size: var(--text-small); font-weight: var(--weight-bold); }

  .hero .figure strong { font-size: var(--text-display); }
  /* Sized by the banner's own width, so it also works in a narrow column. */
  @container (max-width: 54rem) {
    /* 5K and 10K side by side; the overview becomes a full-width strip below them. */
    .banner-body { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: var(--gap); }
    .panel[data-kind="total"] { grid-column: 1 / -1; display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; column-gap: var(--space-4); padding: var(--gap) 0 0; border-left: 0; border-top: 1px solid var(--border); }
    .panel[data-kind="total"] .figure { margin-top: 0; }
    .panel[data-kind="total"] .figure strong { font-size: var(--text-title); }
    .panel[data-kind="total"] .facts { margin-top: 0; }
    .panel[data-kind="total"] .facts span { display: inline; }
    .panel[data-kind="total"] .facts .group + .group::before, .panel[data-kind="total"] .facts .group > span + span::before { content: ' · '; }
  }
  @container (max-width: 36rem) {
    .banner-body { grid-template-columns: 1fr; }
    .panel, .panel:first-child, .panel:last-child, .panel[data-kind="total"] { padding-inline: 0; }
    .panel + .panel { padding-top: var(--gap); border-left: 0; border-top: 1px solid var(--border); }
    .figure strong { font-size: var(--text-title); }
    .panel[data-kind="total"] { display: block; }
    .panel[data-kind="total"] .figure { margin-top: var(--space-4); }
    .panel[data-kind="total"] .facts { margin-top: var(--space-2); }
    .panel[data-kind="total"] .facts .group { display: block; }
    .panel[data-kind="total"] .facts .group + .group::before { content: none; }
  }
</style>
