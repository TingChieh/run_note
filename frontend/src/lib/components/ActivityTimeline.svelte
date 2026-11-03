<script lang="ts">
  import '#lib/styles/activity-timeline.css';
  import ActivityCard from './ActivityCard.svelte';
  import type { Activity, Metric } from '#lib/api/activities.ts';
  let { items, offset, total, editMode = false, selectedIds = [], disabled = false, currentId = null, onselect, onedit, ondelete, onopen, extras, loadedSummary = false }: {
    items: Activity[]; offset: number; total: number; editMode?: boolean; selectedIds?: string[]; disabled?: boolean; currentId?: string | null;
    loadedSummary?: boolean;
    extras?: Record<string, { runner: { name: string; color: string; avatar: string | null; city?: string }; route: import('#lib/api/activities.ts').Route | null; href: string }>;
    onselect?: (id: string, checked: boolean) => void; onedit?: (activity: Activity) => void; ondelete?: (activity: Activity) => void; onopen?: (activity: Activity, event: MouseEvent) => void;
  } = $props();
  const weekdays = '日一二三四五六';
  const metres = (value: Metric) => { const parsed = value === null ? NaN : Number(value); return Number.isFinite(parsed) ? parsed : 0; };
  const day = (date: string) => ({ day: date.slice(8, 10), weekday: `周${weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]}` });
  // Activities arrive newest first, so a month is one run of consecutive items. The first group continues on the previous page when offset > 0 and the last one on the next page, so only the other groups carry a whole month's total.
  const groups = $derived.by(() => {
    const result: { key: string; items: Activity[]; partial: boolean }[] = [];
    for (const item of items) {
      const key = item.activity_date.slice(0, 7), last = result.at(-1);
      if (last?.key === key) last.items.push(item); else result.push({ key, items: [item], partial: false });
    }
    if (result.length) {
      if (offset > 0) result[0].partial = true;
      if (offset + items.length < total) result[result.length - 1].partial = true;
    }
    return result;
  });
  const summary = (group: { items: Activity[]; partial: boolean }) => `${loadedSummary ? '已加载 ' : group.partial ? '本页 ' : ''}${group.items.length} 次 · ${(group.items.reduce((sum, item) => sum + metres(item.distance_m), 0) / 1000).toFixed(1)} km`;
</script>
<div class="activity-timeline timeline">
  {#each groups as group (group.key)}
    <section class="timeline-month month" aria-label={`${group.key.slice(0, 4)} 年 ${Number(group.key.slice(5))} 月`}>
      <header class="timeline-header"><span class="timeline-month-pill month-pill">{group.key.slice(0, 4)} 年 {Number(group.key.slice(5))} 月</span><span class="timeline-month-total" data-testid="month-total">{summary(group)}</span></header>
      <ul class="timeline-list">
        {#each group.items as activity (activity.id)}
          <li><div class="timeline-gutter" aria-hidden="true"><b>{day(activity.activity_date).day}</b><span>{day(activity.activity_date).weekday}</span></div>
            <ActivityCard {activity} selectable={editMode} selected={selectedIds.includes(activity.id)} {disabled} current={currentId === activity.id}
              onselect={checked => onselect?.(activity.id, checked)} onedit={editMode ? () => onedit?.(activity) : undefined} ondelete={editMode ? () => ondelete?.(activity) : undefined}
              runner={extras?.[activity.id]?.runner} route={extras?.[activity.id]?.route} href={extras?.[activity.id]?.href} onopen={event => onopen?.(activity, event)} />
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
