<script lang="ts">
  import WellbeingDial from './WellbeingDial.svelte';
  import WellbeingTile from './WellbeingTile.svelte';
  import { WAKEUPS_MAX } from '#lib/api/wellbeing.ts';
  // How many times the person woke up during the night, on the same round slider as the 0–10 measures. Until it is turned the answer is "未填写" (saved as empty, never 0);
  // 0 is a real answer ("整晚没有醒").
  let { value = $bindable(null), disabled = false }: { value?: number | null; disabled?: boolean } = $props();
</script>
<WellbeingTile metric="wakeups" title="夜间醒来" subtitle="睡着之后中途醒来的次数，越少越好" onclear={value === null ? null : () => { value = null; }} clearLabel="清除夜间醒来次数" {disabled} testid="wellbeing-wakeups">
  <WellbeingDial label="夜间醒来次数" {value} min={0} max={WAKEUPS_MAX} {disabled} middle={2} unit={value === null ? '' : '次'} onvalue={(next) => { value = next; }} />
  <p class="ends"><span>整晚没醒</span><span>醒来很多次</span></p>
  <span class="sr-only" data-testid="scale-value">{value ?? ''}</span>
</WellbeingTile>
<style>
  .ends { display: flex; justify-content: space-between; gap: var(--space-2); color: var(--muted-foreground); font-size: var(--text-small); line-height: var(--line-height-heading); }
</style>
