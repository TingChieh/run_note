<script lang="ts">
  import PageHeader from '../../../src/lib/components/PageHeader.svelte';
  import FeedbackState from '../../../src/lib/components/FeedbackState.svelte';
  import PageSkeleton from '../../../src/lib/components/PageSkeleton.svelte';
  import MetricSummary from '../../../src/lib/components/MetricSummary.svelte';
  import DatePicker from '../../../src/lib/components/DatePicker.svelte';
  import ImageUpload from '../../../src/lib/components/ImageUpload.svelte';
  import BasemapPicker from '../../../src/lib/components/BasemapPicker.svelte';
  import type { BasemapPreference } from '../../../src/lib/api/map-style.ts';
  import ThemeToggle from '../../../src/lib/components/ThemeToggle.svelte';
  import SaveBar from '../../../src/lib/components/SaveBar.svelte';
  import { liquidGlass } from '../../../src/lib/styles/liquid-glass.ts';

  let basemap = $state<BasemapPreference>('auto');
  let name = $state('轻松跑示例');
  let date = $state('2026-10-16');
  let recovered = $state(false);
  let saved = $state(false);
  let publicProfile = $state(false), saved0 = $state(false), segment = $state('all'), draftTitle = $state('RunNote');
  const barDirty = $derived(publicProfile !== saved0 || draftTitle !== 'RunNote');
  const metrics = [
    { label: '距离', value: '12.34 km', icon: 'distance' as const },
    { label: '计时用时', value: '01:08:30', icon: 'duration' as const },
    { label: '平均配速', value: '—', icon: 'pace' as const }
  ];
</script>

<div class="sport-theme" use:liquidGlass>
  <a class="skip-link" href="#showcase-main">跳到展示内容</a>
  <main id="showcase-main" class="page-content showcase" aria-label="组件展示">
    <div class="showcase-top"><p>RunNote · Design System</p><ThemeToggle /></div>
    <div data-testid="visual-reference" class="reference">
      <PageHeader title="RunNote 组件展示" description="延续绿色运动导航、黄色页头与圆角表面。这里使用合成数据，展示公共组件及原生控件的现有组合。">
        {#snippet actions()}<a href="#controls" class="button-secondary">查看控件</a>{/snippet}
      </PageHeader>
      <MetricSummary items={metrics} />
      <div class="reference-states">
        <FeedbackState kind="empty" title="还没有训练记录">导入后将在这里显示。</FeedbackState>
        <FeedbackState kind="success" title="示例已准备就绪">缺失值使用 —，有效零值保留 0。</FeedbackState>
      </div>
    </div>

    <section id="controls" class="aux-panel" aria-labelledby="controls-title">
      <h2 id="controls-title">原生控件与交互状态</h2>
      <p class="description">沿用现有样式与玻璃增强；表单仅在本页保存展示状态。</p>
      <div class="control-row">
        <button type="button" class="bg-primary text-primary-foreground px-4 py-2" onclick={() => { saved = true; }}>主要操作</button>
        <button type="button" class="button-secondary">次要操作</button>
        <button type="button" class="button-secondary text-destructive">危险操作示例</button>
        <button type="button" class="button-secondary" aria-label="刷新示例"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M19 12a7 7 0 0 0-12-5M5 12a7 7 0 0 0 12 5" /></svg></button>
        <button type="button" class="button-secondary" disabled>不可用操作</button>
        <button type="button" class="button-secondary" disabled aria-busy="true">正在保存…</button>
      </div>
      <form onsubmit={event => { event.preventDefault(); saved = true; }}>
        <div class="field-grid">
          <div class="field"><label for="training-name">训练名称</label><input id="training-name" class="border px-3 py-2" bind:value={name} required aria-describedby="name-help" /><span id="name-help" class="description">失败和外观切换时保留草稿。</span></div>
          <div class="field"><label for="training-type">训练类型</label><select id="training-type" class="border px-3 py-2"><option>轻松跑</option><option>恢复跑</option><option>间歇跑</option></select></div>
          <label>训练备注<textarea class="border px-3 py-2" rows="3" placeholder="仅用于本页演示"></textarea></label>
          <label>禁用输入<input class="border px-3 py-2" value="不可编辑" disabled /></label>
          <DatePicker label="训练日期" bind:value={date} min="2026-10-10" max="2026-10-20" required />
          <DatePicker label="禁用日期" value="2026-10-16" disabled />
        </div>
        <div class="control-row">
          <label class="choice"><input type="checkbox" /> 包含恢复训练</label>
          <fieldset><legend>展示范围</legend><label class="choice"><input type="radio" name="scope" value="week" checked /> 本周</label><label class="choice"><input type="radio" name="scope" value="month" /> 本月</label></fieldset>
          <button type="submit" class="button-secondary">保存展示草稿</button>
        </div>
      </form>
      {#if saved}<FeedbackState kind="success" title="展示草稿已保存">仅保留在当前页面，没有发送请求。</FeedbackState>{/if}
    </section>

    <section class="aux-panel" aria-labelledby="basemap-title">
      <h2 id="basemap-title">底图选择</h2><p class="description">菜单从图层按钮展开，选择、Esc 或点击外部时收回；日期与下拉选项复用相同动效。此处仅展示控件，不加载地图资源。</p>
      <div style="position:relative;height:5rem"><BasemapPicker preference={basemap} style={basemap === 'auto' ? 'positron' : basemap} status="ready" onselect={value => { basemap = value; }} /></div>
    </section>
    <section id="switches" class="aux-panel" aria-labelledby="switches-title">
      <h2 id="switches-title">开关、分段与紧凑文本框</h2>
      <p class="description">开关是立即生效的布尔值（`.rn-switch`，折射滑块头由 enhanceSwitch 增强）；分段控件用 `.compact-switch` 与 aria-pressed，玻璃块跟随指针；文本框用 `.text-field`。保存条只在有草稿时出现。</p>
      <div class="control-row">
        <button type="button" role="switch" class="rn-switch" aria-checked={publicProfile} aria-label="公开个人主页" onclick={() => publicProfile = !publicProfile}><span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span></button>
        <button type="button" role="switch" class="rn-switch" aria-checked="true" aria-label="受保护项（不可调节）" disabled><span class="rn-switch-track" aria-hidden="true"><span class="rn-switch-static"></span></span></button>
        <div class="mode-switch compact-switch" role="group" aria-label="示例筛选">
          {#each [['all', '全部'], ['on', '已启用'], ['off', '已禁用']] as [value, label]}<button type="button" aria-pressed={segment === value} onclick={() => segment = value}>{label}</button>{/each}
        </div>
      </div>
      <form id="draft-form" onsubmit={event => { event.preventDefault(); saved0 = publicProfile; draftTitle = 'RunNote'; }}>
        <label for="draft-title">站点标题<input id="draft-title" class="text-field" bind:value={draftTitle} /></label>
      </form>
      <SaveBar form="draft-form" dirty={barDirty} busy={false} label="保存示例" ondiscard={() => { publicProfile = saved0; draftTitle = 'RunNote'; }} />
    </section>

    <section class="aux-panel" aria-labelledby="states-title">
      <h2 id="states-title">反馈与加载</h2>
      <div class="example-stack">
        <FeedbackState kind="loading" title="正在加载示例…" />
        <FeedbackState kind="success" title="示例保存成功" />
        <FeedbackState kind={recovered ? 'success' : 'error'} title={recovered ? '示例已恢复' : '示例加载失败'}>
          {#if !recovered}<button type="button" class="button-secondary" onclick={() => { recovered = true; }}>重新加载示例</button>{/if}
        </FeedbackState>
        <FeedbackState kind="empty" title="暂无可展示的数据" />
        <PageSkeleton title="正在加载展示布局…" />
      </div>
    </section>

    <section aria-labelledby="metrics-title" class="example-stack">
      <h2 id="metrics-title">指标变体</h2>
      <h3>default：中性表面</h3><MetricSummary items={metrics} appearance="default" />
      <h3>compact：卡片内摘要</h3><div class="aux-panel"><MetricSummary items={metrics} compact /></div>
      <h3>stacked：窄列、零值与长数字</h3><MetricSummary stacked items={[{ label: '次数', value: '0', icon: 'count' }, { label: '累计距离', value: '123,456.78 km', icon: 'distance' }, { label: '缺失心率', value: '—', icon: 'heart' }]} />
    </section>

    <section class="example-stack" aria-labelledby="patterns-title">
      <h2 id="patterns-title">布局组合</h2>
      <PageHeader title="较长标题的布局组合：训练概览与日期筛选示例" />
      <div class="pattern-grid">
        <section class="aux-panel" aria-labelledby="summary-title"><h3 id="summary-title">摘要与局部空状态</h3><MetricSummary items={metrics} compact /><FeedbackState kind="empty" title="当前范围无训练记录" /></section>
        <section class="aux-panel" aria-labelledby="settings-title"><h3 id="settings-title">设置分组</h3><p>字段、帮助文字、操作与结果保持在同一上下文。</p><label class="choice"><input type="checkbox" disabled /> 只读范围示例</label></section>
        <section class="aux-panel" aria-labelledby="upload-title"><h3 id="upload-title">图片上传</h3><div class="aux-stack"><ImageUpload label="头像" shape="circle" src={null} fallback="晨" hint="支持 PNG、JPEG、WebP，不超过 5 MiB。" onselect={() => {}} onremove={() => {}} /><ImageUpload label="站内标志" src={null} fallback="R" error="图片格式不受支持，请选择 PNG、JPEG 或 WebP。" onselect={() => {}} onremove={() => {}} /></div></section>
      </div>
      <div data-testid="surface-mapping" class="bg-surface border border-border rounded-xl p-6">语义表面：bg-surface 与 bg-card 使用同一来源。</div>
    </section>
    <footer class="description">内部独立展示 · 无业务路由、API、数据库或供应商调用。材质参数请使用现有 LiquidGlassTuner。</footer>
  </main>
</div>

<style>
  .showcase { display: grid; gap: var(--space-8); }
  .showcase-top, .control-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
  .showcase-top { justify-content: space-between; }
  .reference, .example-stack { display: grid; gap: var(--space-4); }
  .reference-states, .pattern-grid, .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
  h2 { font-size: var(--text-section); font-weight: var(--weight-semibold); }
  h3 { font-weight: var(--weight-semibold); }
  .description { color: var(--muted-foreground); font-size: var(--text-small); }
  .aux-panel > :not(:first-child), form { margin-top: var(--space-4); }
  .field, label:not(.choice) { display: grid; gap: var(--space-2); min-width: 0; }
  .field-grid > *, input, textarea, select { min-width: 0; max-width: 100%; }
  .control-row { margin-top: var(--space-4); }
  .choice { display: inline-flex; align-items: center; gap: var(--space-2); }
  fieldset { display: flex; flex-wrap: wrap; gap: var(--space-4); }
  @media (max-width: 639px) { .reference-states, .pattern-grid, .field-grid { grid-template-columns: 1fr; } }
</style>
