<script lang="ts">
  import ActivityCard from './ActivityCard.svelte';
  import type { Activity, Metric } from '#lib/api/activities.ts';
  let { items, offset, total, editMode = false, selectedIds = [], disabled = false, currentId = null, onselect, onedit, ondelete, onopen }: {
    items: Activity[]; offset: number; total: number; editMode?: boolean; selectedIds?: string[]; disabled?: boolean; currentId?: string | null;
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
  const summary = (group: { items: Activity[]; partial: boolean }) => `${group.partial ? '本页 ' : ''}${group.items.length} 次 · ${(group.items.reduce((sum, item) => sum + metres(item.distance_m), 0) / 1000).toFixed(1)} km`;
</script>
<div class="timeline">
  {#each groups as group (group.key)}
    <section class="month" aria-label={`${group.key.slice(0, 4)} 年 ${Number(group.key.slice(5))} 月`}>
      <header><span class="month-pill">{group.key.slice(0, 4)} 年 {Number(group.key.slice(5))} 月</span><span class="month-total" data-testid="month-total">{summary(group)}</span></header>
      <ul class="activity-list">
        {#each group.items as activity (activity.id)}
          <li><div class="gutter" aria-hidden="true"><b>{day(activity.activity_date).day}</b><span>{day(activity.activity_date).weekday}</span></div>
            <ActivityCard {activity} selectable={editMode} selected={selectedIds.includes(activity.id)} {disabled} current={currentId === activity.id}
              onselect={checked => onselect?.(activity.id, checked)} onedit={editMode ? () => onedit?.(activity) : undefined} ondelete={editMode ? () => ondelete?.(activity) : undefined}
              onopen={event => onopen?.(activity, event)} />
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
<style>
  .timeline { display: grid; gap: var(--space-4); min-width: 0; }
  .month { min-width: 0; }
  header { display: flex; flex-wrap: wrap; align-items: center; min-height: 1.75rem; gap: var(--space-1) var(--space-3); margin-bottom: var(--space-3); }
  .month-pill { padding: 0 .75rem; line-height: 1.75rem; border-radius: var(--radius-pill); background: var(--foreground); color: var(--background); font-size: var(--text-small); font-weight: var(--weight-semibold); }
  .month-total { color: var(--muted-foreground); font-size: var(--text-small); font-variant-numeric: tabular-nums; }
  .activity-list { position: relative; display: grid; gap: var(--space-2); }
  .activity-list::before { content: ''; position: absolute; top: .5rem; bottom: .5rem; left: 1.2rem; border-left: 2px solid var(--border); }
  li { display: grid; grid-template-columns: 2.4rem minmax(0, 1fr); align-items: center; gap: var(--space-2); min-width: 0; }
  .gutter { position: relative; z-index: 1; display: grid; justify-items: center; padding: .125rem 0; background: var(--background); line-height: 1.1; }
  .gutter b { font-size: var(--text-section); font-variant-numeric: tabular-nums; }
  .gutter span { color: var(--muted-foreground); font-size: var(--text-caption); }
</style>
