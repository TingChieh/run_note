import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginRunner } from '../fixtures/activities.ts';

// Synthetic API (tests/fixtures/ui-wellbeing.mjs): in-memory, cleared whenever the owner signs in. Account timezone Asia/Shanghai.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
async function open(page: Page, path = '/wellbeing') {
  await loginRunner(page);
  await page.goto(path);
  await expect(page.getByTestId('wellbeing-editor')).toBeVisible();
  await expect(page.getByTestId('wellbeing-status')).toBeVisible();
  await settled(page);
}
/** Waits for the page's entrance animations to end, so positions are measured at rest. */
const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
const scale = (page: Page, name: string) => page.getByRole('group', { name: new RegExp(`^${name}`) });
const slider = (page: Page, name: string) => scale(page, name).getByRole('slider');
/** Sleep duration: the hours slider, then the minutes slider. */
const sleep = async (page: Page, hours: number, minutes: number) => {
  await page.getByRole('slider', { name: '睡眠小时' }).fill(String(hours));
  await page.getByRole('slider', { name: '睡眠分钟' }).fill(String(minutes));
};
/** Adds one dose through the day form: a pill count at a time today. */
async function addDose(page: Page, { pills = '1', time = '08:00', name = '示例药物' } = {}) {
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  // A medicine already in the list is picked; a new one is typed under "其他药物" (or straight away when the list is empty).
  const picker = form.getByTestId('wellbeing-dose-meds');
  if (await picker.count() && await picker.getByRole('button', { name, exact: true }).count()) await picker.getByRole('button', { name, exact: true }).click();
  else {
    if (await picker.count()) await picker.getByRole('button', { name: '其他药物' }).click();
    await form.getByLabel('药物名称').fill(name);
  }
  await form.getByLabel(/^吃了几/).fill(pills);
  await form.getByLabel('实际服药时间').fill(`${today()}T${time}`);
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(form).toHaveCount(0);
}
const addDays = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
/** A point on a dial at `fraction` of the way round its 270° ring (0 = lower left, 0.5 = top, 1 = lower right), on the ring of the given radius (% of the width). */
async function ringPoint(locator: Locator, fraction: number, radius = 38) {
  const box = (await locator.boundingBox())!;
  const angle = (135 + 270 * fraction) * Math.PI / 180;
  return { x: box.x + box.width / 2 + Math.cos(angle) * box.width * radius / 100, y: box.y + box.height / 2 + Math.sin(angle) * box.width * radius / 100 };
}
const pick = (page: Page, name: string, value: number) => slider(page, name).fill(String(value));

test('anonymous visitors are sent to the sign-in page, never shown the diary', async ({ page }) => {
  const response = await page.goto('/wellbeing');
  await expect(page).toHaveURL(/\/admin\?next=%2Fwellbeing/);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId('wellbeing-page')).toHaveCount(0);
});

test('the diary is in the private navigation and the page is not indexable', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '身心健康' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  await expect(page.getByRole('heading', { name: '身心健康', level: 1 })).toBeVisible();
  await expect(page.getByText('不提供诊断或用药建议')).toBeVisible();
});

test('a partial day saves unanswered items as empty and shows completion', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('wellbeing-status')).toHaveText('今天还没有记录');
  await pick(page, '开心程度', 0);          // a real zero
  await pick(page, '焦虑', 6);
  await sleep(page, 7, 30);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
  await expect(page.getByTestId('wellbeing-status')).toContainText('已记录 3/8 项状态');
  await expect(scale(page, '精力').locator('.dial')).toHaveClass(/unset/);
  await expect(scale(page, '开心程度').getByTestId('scale-value')).toHaveText('0');
  await page.reload();
  await expect(scale(page, '开心程度').getByTestId('scale-value')).toHaveText('0');
  await expect(scale(page, '焦虑').getByTestId('scale-value')).toHaveText('6');
  await expect(scale(page, '精力').locator('.dial')).toHaveClass(/unset/);
  await expect(page.getByTestId('wellbeing-sleep').getByTestId('scale-value')).toHaveText('7 小时 30 分');
});

test('saving twice on one day updates the same record and the rating can be cleared', async ({ page }) => {
  await open(page);
  await pick(page, '焦虑', 3);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('1/8');
  await pick(page, '焦虑', 5);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(scale(page, '焦虑').getByTestId('scale-value')).toHaveText('5');
  await page.getByRole('button', { name: '清除焦虑' }).click();
  await pick(page, '精力', 2);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('1/8');
  await page.getByTestId('wellbeing-tab-history').click();
  await page.getByRole('button', { name: '列表' }).click();
  await expect(page.getByTestId('wellbeing-entry')).toHaveCount(1);
});

test('an empty save is refused and unsaved changes can be discarded', async ({ page }) => {
  await open(page);
  await pick(page, '精力', 4);
  await expect(page.getByText('有未保存的更改')).toBeVisible();
  await page.getByRole('button', { name: '放弃' }).click();
  await expect(scale(page, '精力').locator('.dial')).toHaveClass(/unset/);
  await expect(page.getByText('有未保存的更改')).toHaveCount(0);
});

test('switching tabs with unsaved answers asks first and keeps the draft when declined', async ({ page }) => {
  await open(page);
  await pick(page, '焦虑', 7);
  const dialogs: string[] = [];
  page.once('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.getByTestId('wellbeing-tab-trends').click();
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain('未保存');
  await expect(scale(page, '焦虑').getByTestId('scale-value')).toHaveText('7');
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.getByTestId('wellbeing-tab-trends').click();
  await expect(page.getByTestId('wellbeing-trends')).toBeVisible();
});

test('a stale editor is told about the newer save instead of overwriting it', async ({ page }) => {
  await open(page);
  await pick(page, '焦虑', 2);
  // Another tab saves the same day first (same session, same synthetic store).
  await page.evaluate(async (day) => {
    const { csrf_token } = (await (await fetch('/api/v1/auth/csrf')).json()).data;
    await fetch(`/api/v1/me/wellbeing/days/${day}/entry`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf_token }, body: JSON.stringify({ mood: 9, based_on: null }) });
  }, today());
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-conflict')).toContainText('已在其他页面或设备更新');
  await page.getByRole('button', { name: '重新读取' }).click();
  await expect(scale(page, '开心程度').getByTestId('scale-value')).toHaveText('9');
});

test('several doses of one medicine on the same day can be added, edited and deleted', async ({ page }) => {
  await open(page);
  await addDose(page, { pills: '1', time: '08:00' });
  await addDose(page, { pills: '1.5', time: '09:30' });
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(2);
  await expect(page.getByTestId('wellbeing-dose').first()).toContainText('1 颗');
  await expect(page.getByTestId('wellbeing-dose').first()).toContainText('08:00');
  await expect(page.getByTestId('wellbeing-dose').nth(1)).toContainText('1.5 颗');
  await page.getByRole('button', { name: '编辑 示例药物 服药记录' }).first().click();
  await page.getByTestId('wellbeing-dose-form').getByLabel('备注（可选）').fill('饭后');
  await page.getByTestId('wellbeing-dose-form').getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByTestId('wellbeing-dose').first()).toContainText('饭后');
  const remove = page.getByRole('button', { name: /删除 示例药物 服药记录/ }).first();
  await remove.click();
  await expect(page.getByRole('button', { name: /确认删除 示例药物 服药记录/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /确认删除 示例药物 服药记录/ }).first().click();
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(1);
});

test('the dose editor pops up and retracts, and "其他药物" turns into a field that grows out to the right', async ({ page }) => {
  await open(page);
  await addDose(page); // puts one medicine in the list
  await page.getByTestId('wellbeing-add-dose').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Popping up and retracting are transitions, not jumps.
  const motion = await dialog.evaluate(el => { const c = getComputedStyle(el); return { property: c.transitionProperty, duration: c.transitionDuration }; });
  expect(motion.property).toContain('transform');
  expect(motion.duration).not.toMatch(/^0s(, 0s)*$/);
  await expect.poll(() => dialog.evaluate(el => getComputedStyle(el).transform)).toBe('none'); // popped up
  const picker = page.getByTestId('wellbeing-dose-meds');
  const chip = picker.getByRole('button', { name: '其他药物' });
  const slot = picker.locator('.other');
  const chipBox = (await slot.boundingBox())!;
  await chip.click();
  // The chip gives way to a focused text field standing where it was, widening to the right.
  const field = picker.getByLabel('药物名称');
  await expect(field).toBeFocused();
  await expect(chip).toHaveAttribute('inert', '');
  await expect.poll(async () => (await slot.boundingBox())!.width).toBeGreaterThan(chipBox.width + 40);
  expect(Math.abs((await field.boundingBox())!.x - chipBox.x)).toBeLessThanOrEqual(2);
  // Leaving it empty shrinks it back into the chip.
  await field.blur();
  await expect(field).toHaveAttribute('inert', '');
  await expect.poll(async () => (await slot.boundingBox())!.width).toBeLessThan(chipBox.width + 4);
  await expect(chip).not.toHaveAttribute('inert', '');
  // Escape retracts the dialog: it stays a moment, then is gone.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('wellbeing-dose-form')).toHaveCount(0);
});

test('the medication widget lists doses from the top down, each as a capsule', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 }); // a narrow widget
  await open(page);
  await addDose(page, { pills: '1', time: '08:00' });
  await addDose(page, { pills: '2', time: '09:30' });
  const tile = page.locator('[data-metric="dose"]');
  const header = (await tile.locator('header').boundingBox())!;
  const rows = tile.getByTestId('wellbeing-dose');
  const first = (await rows.first().boundingBox())!, second = (await rows.nth(1).boundingBox())!;
  expect(first.y - (header.y + header.height)).toBeLessThan(40); // right under the title, not centred in the card
  expect(second.y).toBeGreaterThan(first.y + first.height - 1); // stacked, one under the other
  expect(Math.abs(second.x - first.x)).toBeLessThanOrEqual(1);
  // Slim, even in a narrow widget: the medicine and details are cut with an ellipsis, never wrapped into a tall blob.
  expect(first.height).toBeLessThan(64);
  // Capsule: fully rounded ends.
  const radius = await rows.first().evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  expect(radius).toBeGreaterThanOrEqual(first.height / 2 - 1);
});

test('many doses scroll inside the medication widget; it never grows taller than the widgets beside it', async ({ page }) => {
  await open(page);
  const tile = page.locator('[data-metric="dose"]'), note = page.locator('[data-metric="note"]');
  const before = (await tile.boundingBox())!.height;
  for (const time of ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00']) await addDose(page, { time });
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(6);
  const after = (await tile.boundingBox())!.height, list = page.getByTestId('wellbeing-dose-list');
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  expect(Math.abs(after - (await note.boundingBox())!.height)).toBeLessThanOrEqual(1);
  const scrolls = await list.evaluate(el => ({ over: el.scrollHeight > el.clientHeight + 4, overflow: getComputedStyle(el).overflowY }));
  expect(scrolls).toEqual({ over: true, overflow: 'auto' });
  await tile.scrollIntoViewIfNeeded();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByTestId('wellbeing-dose').last()).toBeInViewport();
});

test('an existing dose can be edited with a side effect added, and the edit is accepted', async ({ page }) => {
  await open(page);
  await addDose(page, { pills: '1', time: '08:00' });
  await page.getByRole('button', { name: '编辑 示例药物 服药记录' }).click();
  const form = page.getByTestId('wellbeing-dose-form');
  await form.getByTestId('wellbeing-dose-meds').getByRole('button', { name: '示例药物', exact: true }).click();
  await form.getByLabel(/^吃了几/).fill('2');
  await form.getByRole('button', { name: '食欲变化' }).click();
  await form.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByTestId('wellbeing-event-error')).toHaveCount(0);
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('wellbeing-dose')).toContainText('2 颗');
  await expect(page.getByTestId('wellbeing-symptom')).toHaveText('食欲变化');
});

test('dose validation explains what is missing and keeps what was typed', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(page.getByTestId('wellbeing-event-error')).toContainText('请填写吃了几颗');
  await expect(form.getByLabel('药物名称')).toHaveValue('示例药物');
  await form.getByLabel(/^吃了几/).fill('0');
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(page.getByTestId('wellbeing-event-error')).toContainText('大于 0');
  await form.getByLabel(/^吃了几/).fill('1.234');
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(page.getByTestId('wellbeing-event-error')).toContainText('最多 2 位小数');
});

test('side effects are written in the dose editor and listed in the same medication widget', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByLabel(/^吃了几/).fill('1');
  await form.getByRole('button', { name: '头晕' }).click();
  // Side effects are only named: there is no score to give.
  await expect(form.getByLabel(/程度/)).toHaveCount(0);
  await form.getByLabel('其他副作用（可选）').fill('耳鸣');
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(form).toHaveCount(0);
  const rows = page.getByTestId('wellbeing-symptom');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveText('头晕');
  await expect(rows.nth(1)).toHaveText('耳鸣');
  // The side effects live inside the one medication widget; there is no separate section.
  await expect(page.getByTestId('wellbeing-doses').getByTestId('wellbeing-symptoms')).toBeVisible();
  await expect(page.getByTestId('wellbeing-add-symptom')).toHaveCount(0);
  await expect(page.locator('[data-metric="dose"]')).toHaveCount(1);
  // Deleting takes two taps.
  await page.getByRole('button', { name: '删除 头晕 记录' }).click();
  await page.getByRole('button', { name: '确认删除 头晕 记录' }).click();
  await expect(rows).toHaveCount(1);
});

test('history: calendar marks, back-filling a past day, and deleting only the state record', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-history').click();
  await expect(page.getByTestId('wellbeing-history')).toBeVisible();
  await expect(page.getByText('选择一个日期查看或补录')).toBeVisible();
  const past = new Date(Date.now() - 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const day = page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`);
  if (await day.count() === 0) await page.getByRole('button', { name: '上个月' }).click();
  await page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`).click();
  await expect(page.getByTestId('wellbeing-editor')).toHaveAttribute('data-day', past);
  await expect(page.getByTestId('wellbeing-status')).toHaveText('这一天还没有记录');
  await pick(page, '开心程度', 5);
  await page.getByRole('button', { name: '保存这一天' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('1/8');
  await expect(page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`)).toHaveAttribute('aria-label', /有状态记录/);
  const remove = page.getByTestId('wellbeing-delete-entry');
  await remove.click();
  await expect(remove).toHaveText('确认删除当天状态记录');
  await remove.click();
  await expect(page.getByTestId('wellbeing-status')).toHaveText('这一天还没有记录');
  await expect(page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`)).toHaveAttribute('aria-label', /没有记录/);
});

test('the history calendar gives state, medication and side effects three different colours, the widgets\' own', async ({ page }) => {
  await open(page);
  const token = (name: string) => page.evaluate((variable) => { const probe = document.createElement('i'); probe.style.color = `var(${variable})`; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, name);
  await page.getByTestId('wellbeing-tab-history').click();
  await expect(page.getByTestId('wellbeing-history')).toBeVisible();
  const legend = await page.locator('.legend span', { hasText: '副作用' }).locator('i').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(legend).toBe(await token('--well-effect'));
  const state = await page.locator('.legend span', { hasText: '状态' }).locator('i').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(state).toBe(await token('--well-mood'));
  const dose = await page.locator('.legend span', { hasText: '服药' }).locator('i').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(dose).toBe(await token('--well-dose')); // the green of the medication widget, not another colour
  expect(new Set([state, dose, legend]).size).toBe(3); // told apart at a glance
  await page.getByTestId('wellbeing-tab-trends').click();
  await expect(page.getByTestId('wellbeing-side-effects')).toBeVisible();
  const badge = await page.getByTestId('wellbeing-side-effects').evaluate(el => getComputedStyle(el).getPropertyValue('--tone').trim());
  expect(badge).toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--well-effect').trim()));
});

test('history: no separate date picker, and the calendar stays in view while the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByTestId('wellbeing-tab-history').click();
  await expect(page.getByTestId('wellbeing-history')).toBeVisible();
  await expect(page.getByText('补录或查看某一天')).toHaveCount(0); // the calendar already does this
  await expect(page.getByTestId('wellbeing-history').locator('input[type="date"], .date-trigger')).toHaveCount(0);
  const past = new Date(Date.now() - 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  if (await page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`).count() === 0) await page.getByRole('button', { name: '上个月' }).click();
  await page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`).click();
  await expect(page.getByTestId('wellbeing-editor')).toHaveAttribute('data-day', past);
  const card = page.getByTestId('wellbeing-history').locator('section.card');
  const editor = page.getByTestId('wellbeing-editor');
  // Beside the widgets, starting level with the first row of them (below the day's heading).
  await expect(page.getByTestId('wellbeing-status')).toBeVisible();
  await expect.poll(async () => Math.abs((await card.boundingBox())!.y - (await page.locator('[data-metric="mood"]').boundingBox())!.y)).toBeLessThanOrEqual(2);
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(async () => Math.round((await card.boundingBox())!.y)).toBeLessThanOrEqual(24);
  expect((await card.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await expect(page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`)).toBeInViewport();
});

test('history: choosing a day animates — the day glides in and the chosen number grows into place', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByTestId('wellbeing-tab-history').click();
  const days = page.locator('[data-testid="wellbeing-day"]:not([disabled])');
  await days.first().click();
  await expect(page.getByTestId('wellbeing-status')).toBeVisible();
  // Watch for the glide-in of the next day's content.
  await page.evaluate(() => {
    (window as any).__glided = false;
    void (async () => { const end = Date.now() + 3000; while (Date.now() < end) { if (document.querySelector('.day-body')?.getAnimations().length) { (window as any).__glided = true; break; } await new Promise(r => requestAnimationFrame(r)); } })();
  });
  await days.nth(2).click();
  await expect.poll(() => page.evaluate(() => (window as any).__glided)).toBe(true);
  // The chosen number is a filled disc with a transition on it, not a jump.
  const chosen = page.locator('.day.selected .num');
  const motion = await chosen.evaluate(el => { const c = getComputedStyle(el); return { property: c.transitionProperty, duration: c.transitionDuration }; });
  expect(motion.property).toContain('transform');
  expect(motion.duration).not.toMatch(/^0s(, 0s)*$/);
});

/** Starts watching the next sliding pane inside `scope`, runs `act`, and returns the side it came in from (+1 right, -1 left) as its first frame saw it. */
async function slideSide(page: Page, scope: string, act: () => Promise<void>, axis: 'x' | 'y' = 'x') {
  await page.evaluate(([selector, vertical]) => {
    (window as any).__side = null;
    void (async () => {
      const end = Date.now() + 3000;
      while (Date.now() < end) {
        const panes = [...document.querySelectorAll<HTMLElement>(selector)];
        if (panes.length === 2) {
          const xs = panes.map(pane => { const m = new DOMMatrix(getComputedStyle(pane).transform); return vertical ? m.m42 : m.m41; });
          const far = xs.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0);
          if (Math.abs(far) > 1) { (window as any).__side = Math.sign(far); break; }
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    })();
  }, [scope, axis === 'y'] as const);
  await act();
  await expect.poll(() => page.evaluate(() => (window as any).__side)).not.toBeNull();
  return page.evaluate(() => (window as any).__side as number);
}

test('switching sections slides the page left or right following the order of the tabs', async ({ page }) => {
  await open(page);
  const pane = '.wellbeing-page > .stage > .pane';
  // Today -> History: further right, so the new section comes in from the right.
  expect(await slideSide(page, pane, () => page.getByTestId('wellbeing-tab-history').click())).toBe(1);
  await settled(page);
  // History -> Medications: further left, so it comes in from the left.
  expect(await slideSide(page, pane, () => page.getByTestId('wellbeing-tab-medications').click())).toBe(-1);
  await settled(page);
  // While one slides out and the other in, the page never shows an empty gap: both are present, then only the new one.
  await expect(page.locator(pane)).toHaveCount(1);
  await expect(page.getByTestId('wellbeing-medications')).toBeVisible();
});

test('history: choosing a later day comes in from the right, an earlier day from the left', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByTestId('wellbeing-tab-history').click();
  await settled(page);
  const days = page.locator('[data-testid="wellbeing-day"]:not([disabled])');
  await days.nth(3).click();
  await expect(page.getByTestId('wellbeing-status')).toBeVisible();
  await settled(page);
  const pane = '[data-testid="wellbeing-history"] .stage > .pane';
  expect(await slideSide(page, pane, () => days.nth(8).click())).toBe(1);
  await settled(page);
  expect(await slideSide(page, pane, () => days.nth(1).click())).toBe(-1);
});

test('history: future days cannot be chosen', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-history').click();
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const cell = page.locator(`[data-testid="wellbeing-day"][data-date="${tomorrow}"]`);
  if (await cell.count()) await expect(cell).toBeDisabled();
  await expect(page.getByRole('button', { name: '下个月' })).toBeDisabled();
});

test('trends: side effects are a week as a circle of slices (or a calendar for longer ranges); choosing a day shows that day\'s side effects, not counts', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByLabel(/^吃了几/).fill('1');
  await form.getByRole('button', { name: '头晕' }).click();
  await form.getByRole('button', { name: '恶心' }).click();
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(form).toHaveCount(0);
  await page.getByTestId('wellbeing-tab-trends').click();
  const card = page.getByTestId('wellbeing-side-effects');
  const days = card.getByTestId('wellbeing-effect-day');
  await expect(card).toHaveAttribute('data-metric', 'effects'); // a widget in the same frame as the others
  // It is one cell of the grid, the same size as the chart beside it.
  const cell = (await card.boundingBox())!, sleepChart = (await page.getByTestId('wellbeing-chart-sleep').boundingBox())!;
  expect(Math.abs(cell.width - sleepChart.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(cell.height - sleepChart.height)).toBeLessThanOrEqual(1);
  // The calendar and the day's content are in this one widget: the calendar on the left, the day written on the right.
  const calBox = (await card.locator('.calendar, .wheel').boundingBox())!, panelBox = (await card.getByTestId('wellbeing-effect-list').boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(calBox.x + calBox.width - 1);
  // The dividing line has room: the text starts well clear of it.
  const textInset = await card.locator('.panel .when').evaluate(el => el.getBoundingClientRect().left - el.closest('.panel')!.getBoundingClientRect().left);
  expect(textInset).toBeGreaterThanOrEqual(16);
  expect(Math.abs(panelBox.y - calBox.y)).toBeLessThanOrEqual(8);
  await expect(card.getByTestId('wellbeing-effect-list')).toBeVisible();
  await expect(card.locator('.head')).toHaveCount(0); // a single week needs no weekday header
  await expect(card.locator('header .badge')).toBeVisible();
  await expect(days).toHaveCount(7);
  await settled(page);
  // Today (the last day) is chosen to begin with, and its side effects are named; no counts, no chart.
  await expect(days.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(days.last()).toHaveClass(/marked/);
  // A week is one big circle cut into seven slices, the chosen day named in the middle; a slice with side effects is tinted, an empty one stays grey.
  const wheel = card.locator('.wheel');
  await expect(wheel).toBeVisible();
  await expect(wheel.locator('svg.slices .slice')).toHaveCount(7);
  const box = (await wheel.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(150); // a big circle, easy to hit a slice on
  await expect(wheel.locator('.core')).toContainText('周');
  const fill = (index: number) => days.nth(index).locator('path').evaluate(el => getComputedStyle(el).fill);
  expect(await fill(0)).not.toBe(await fill(6)); // grey vs. the chosen slice
  // Choosing a day slides its record in: an earlier day from the left, a later one from the right (a slice is a ring segment, so its middle can be the hole: the click is sent to it directly).
  const pane = '[data-testid="wellbeing-side-effects"] .pane';
  expect(await slideSide(page, pane, () => days.nth(5).dispatchEvent('click'))).toBe(-1);
  await expect(days.nth(5)).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
  expect(await slideSide(page, pane, () => days.last().dispatchEvent('click'))).toBe(1);
  await settled(page);
  expect(await fill(6)).not.toBe(await fill(0));
  // The day in the middle rolls up and down like a counter: a later day comes up from below, an earlier one down from above.
  const face = '[data-testid="wellbeing-side-effects"] .face';
  expect(await slideSide(page, face, () => days.nth(2).dispatchEvent('click'), 'y')).toBe(-1);
  await settled(page);
  expect(await slideSide(page, face, () => days.nth(4).dispatchEvent('click'), 'y')).toBe(1);
  await settled(page);
  await days.last().dispatchEvent('click');
  await settled(page);
  const list = card.getByTestId('wellbeing-effect-list');
  await expect(list).toContainText('头晕');
  await expect(list).toContainText('恶心');
  await expect(list).not.toContainText('条');
  await expect(page.getByTestId('wellbeing-chart-symptoms')).toHaveCount(0);
  // Another day with nothing recorded says so.
  await days.first().dispatchEvent('click');
  await expect(days.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toContainText('没有记录副作用');
  await expect(days.first()).not.toHaveClass(/marked/);
  // The calendar follows the chosen range: 7, 14 or 30 days, the latest day always last.
  await page.getByRole('button', { name: '近 14 天' }).click();
  await expect(days).toHaveCount(14);
  await page.getByRole('button', { name: '近 30 天' }).click();
  await expect(days).toHaveCount(30);
  await days.last().dispatchEvent('click');
  await expect(list).toContainText('头晕');
  // Each day sits under its weekday: the last day's column matches its weekday (Monday first).
  const last = await days.last().getAttribute('data-date');
  const weekdayIndex = (new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7;
  const columns = await card.locator('.calendar').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(7);
  const lastBox = (await days.last().boundingBox())!, headBox = (await card.locator('.head').nth(weekdayIndex).boundingBox())!;
  expect(Math.abs((lastBox.x + lastBox.width / 2) - (headBox.x + headBox.width / 2))).toBeLessThanOrEqual(3);
});

test('trends: six charts say which way is better, missing days stay empty, and each has a data table', async ({ page }) => {
  await open(page);
  await pick(page, '开心程度', 6);
  await pick(page, '精力', 3);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('2/8');
  await page.getByTestId('wellbeing-tab-trends').click();
  // The default range is the last 7 days.
  await expect(page.getByRole('button', { name: '近 7 天' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('wellbeing-trend-summary')).toContainText('7 天中有 1 天填写了状态');
  await page.getByRole('button', { name: '近 30 天' }).click();
  await expect(page.getByTestId('wellbeing-trend-summary')).toContainText('30 天中有 1 天填写了状态');
  await expect(page.getByTestId('wellbeing-chart-mood')).toContainText('越高越开心');
  await expect(page.getByTestId('wellbeing-symptom-stats')).toHaveCount(0); // no separate side-effect count table
  await expect(page.getByTestId('wellbeing-chart-energy_focus')).toContainText('越高越好');
  await expect(page.getByTestId('wellbeing-chart-functioning')).toContainText('日常功能'); // daily functioning has its own chart
  await expect(page.getByTestId('wellbeing-chart-functioning')).toContainText('越高越好');
  await expect(page.getByTestId('wellbeing-chart-mood').locator('[data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('wellbeing-chart-anxiety-empty')).toBeVisible();
  await expect(page.getByTestId('wellbeing-chart-sleep-empty')).toBeVisible();
  const chart = page.getByTestId('wellbeing-chart-mood');
  await chart.getByText('查看开心程度数据表').click();
  await expect(chart.getByRole('row')).toHaveCount(31);
  await expect(chart.getByRole('cell', { name: '6' })).toHaveCount(1);
  await expect(chart.getByText('—').first()).toBeAttached();
  await page.getByRole('button', { name: '近 14 天' }).click();
  await expect(page.getByTestId('wellbeing-trend-summary')).toContainText('14 天中有 1 天');
});

test('report: summary of what was logged, coverage gaps, and CSV download', async ({ page }) => {
  await open(page);
  await pick(page, '开心程度', 4);
  await pick(page, '焦虑', 2);
  await sleep(page, 6, 30);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('3/8');
  await addDose(page);
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(1);
  await page.getByTestId('wellbeing-tab-report').click();
  const report = page.getByTestId('wellbeing-report');
  await expect(report).toContainText('不构成诊断');
  await expect(page.getByTestId('report-coverage')).toContainText('30 天中有 1 天填写了状态记录，29 天没有');
  await expect(page.getByTestId('report-medication')).toContainText('示例药物');
  await expect(page.getByTestId('report-ratings')).toContainText('开心程度');
  await expect(page.getByTestId('report-sleep')).toContainText('平均 6 小时 30 分');
  await expect(report).not.toContainText('建议调整');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '状态记录 CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^wellbeing-entries-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  // Print view hides the application chrome and the form controls.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await expect(page.getByTestId('wellbeing-export')).toBeHidden();
  await expect(report).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('the diary never writes to browser storage', async ({ page }) => {
  await open(page);
  await pick(page, '焦虑', 8);
  await page.getByRole('textbox', { name: '当日备注' }).fill('私密备注内容');
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('2/8');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('私密备注内容');
  expect(stored).not.toMatch(/wellbeing|焦虑/);
});

test('keyboard: the first arrow key starts a slider at the middle and then steps by one; Home and End reach the ends', async ({ page }) => {
  await open(page);
  const input = slider(page, '焦虑');
  const group = scale(page, '焦虑');
  await expect(group.locator('.dial')).toHaveClass(/unset/);
  await input.focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByTestId('scale-value')).toHaveText('5');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByTestId('scale-value')).toHaveText('6');
  await page.keyboard.press('ArrowLeft');
  await expect(group.getByTestId('scale-value')).toHaveText('5');
  await page.keyboard.press('End');
  await expect(group.getByTestId('scale-value')).toHaveText('10');
  await page.keyboard.press('Home');
  await expect(group.getByTestId('scale-value')).toHaveText('0');
  // The dial carries the visible focus ring.
  const dialOutline = await group.locator('.dial').evaluate(el => getComputedStyle(el).outlineStyle);
  expect(dialOutline).not.toBe('none');
  await page.getByRole('button', { name: '清除焦虑' }).click();
  await expect(group.locator('.dial')).toHaveClass(/unset/);
});

test('a tap or drag on the ring turns the dial; the middle and the opening do not', async ({ page }) => {
  await open(page);
  const dial = scale(page, '精力').locator('.dial');
  const value = scale(page, '精力').getByTestId('scale-value');
  // The top of the ring is the middle of the scale.
  let at = await ringPoint(dial, 0.5);
  await page.mouse.click(at.x, at.y);
  await expect(value).toHaveText('5');
  // Right-hand end of the ring: 225° of 270° is 8.3, so 8.
  at = await ringPoint(dial, 225 / 270);
  await page.mouse.click(at.x, at.y);
  await expect(value).toHaveText('8');
  // Dragging round from the lower left to the top ends where the pointer is released.
  const start = await ringPoint(dial, 0.02), top = await ringPoint(dial, 0.5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(value).toHaveText('0');
  await page.mouse.move((start.x + top.x) / 2, (start.y + top.y) / 2 - 10, { steps: 6 });
  await page.mouse.move(top.x, top.y, { steps: 6 });
  await page.mouse.up();
  await expect(value).toHaveText('5');
  // The number in the middle is not a handle.
  const box = (await dial.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(value).toHaveText('5');
  // The opening at the bottom snaps to the nearer end: a tap just right of straight down is the top of the scale.
  await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.88);
  await expect(value).toHaveText('10');
});

test('every measure is a widget of its own colour and icon, and the note is the same size as the others', async ({ page }) => {
  await open(page);
  const tiles = page.locator('section.widgets').first().locator('[data-metric]'); // the measures, then the medication widget, then the note
  expect(await tiles.evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.metric))).toEqual(['mood', 'anxiety', 'energy', 'focus', 'functioning', 'sleep', 'sleep_quality', 'dose', 'note']);
  const colours = await tiles.evaluateAll(nodes => nodes.map(n => getComputedStyle(n).getPropertyValue('--tone').trim()));
  expect(new Set(colours).size).toBe(9); // no two measures share a colour
  expect(await tiles.evaluateAll(nodes => nodes.every(n => !!n.querySelector('header svg')))).toBe(true);
  // Each is its own card: nothing wraps them in a larger box.
  expect(await page.locator('[data-metric="anxiety"]').evaluate(n => getComputedStyle(n.parentElement!).borderTopWidth)).toBe('0px');
  // Same width as every other widget, and as tall as its row neighbours.
  const mood = (await page.locator('[data-metric="mood"]').boundingBox())!, note = (await page.locator('[data-metric="note"]').boundingBox())!, quality = (await page.locator('[data-metric="sleep_quality"]').boundingBox())!;
  expect(Math.abs(mood.width - note.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(quality.width - note.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(quality.height - note.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(quality.y - note.y)).toBeLessThanOrEqual(1);
  // The medication widget is one of the grid's cells, the same width as the others, right before the note.
  const dose = (await page.locator('[data-metric="dose"]').boundingBox())!;
  expect(Math.abs(dose.width - note.width)).toBeLessThanOrEqual(1);
  expect(dose.x).toBeLessThan(note.x);
  expect(Math.abs(dose.y - note.y)).toBeLessThanOrEqual(1);
  // Every card's name sits at the same height from its top, even a short card stretched to its row's height.
  const tops = await page.locator('section.widgets [data-metric]').evaluateAll(nodes => nodes.map(n => Math.round(n.querySelector('header .badge')!.getBoundingClientRect().top - n.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // The small + sits on the title's row, centred with the icon, inside the card.
  const addBox = (await page.getByTestId('wellbeing-add-dose').boundingBox())!, badge = (await page.locator('[data-metric="dose"] .badge').boundingBox())!;
  expect(Math.abs((addBox.y + addBox.height / 2) - (badge.y + badge.height / 2))).toBeLessThanOrEqual(1);
  expect(addBox.x + addBox.width).toBeLessThanOrEqual(dose.x + dose.width);
  // No small print under the names.
  await expect(page.locator('[data-metric="anxiety"] header')).not.toContainText('越高越严重');
});

test('a medicine is set up once with box size, strength and pills per dose, and the day form offers it with one tap', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-medications').click();
  const meds = page.getByTestId('wellbeing-medications');
  await expect(meds.getByText('还没有药物')).toBeVisible();
  await meds.getByTestId('wellbeing-add-medication').click();
  const form = meds.getByTestId('wellbeing-medication-form');
  await form.getByLabel('药物名称').fill('米那普仑');
  await form.getByLabel(/^每盒几/).fill('28');
  await form.getByLabel(/^每次默认几/).fill('1');
  await form.getByLabel(/^每颗规格/).fill('12.5');
  await form.getByLabel('现有几盒（可选）').fill('2');
  await form.getByLabel(/^另外几/).fill('5');
  await form.getByRole('button', { name: '保存药物' }).click();
  const card = meds.locator('[data-medication="米那普仑"]');
  await expect(card).toContainText('每盒 28 颗 · 每颗 12.5 mg · 每次 1 颗');
  await expect(card.getByTestId('wellbeing-stock')).toContainText('2 盒 5 颗（共 61 颗）');
  // The same name again (any case) is refused with a clear message, and nothing is added.
  await meds.getByTestId('wellbeing-add-medication').click();
  await form.getByLabel('药物名称').fill('米那普仑');
  await form.getByRole('button', { name: '保存药物' }).click();
  await expect(page.getByTestId('wellbeing-med-error')).toContainText('同名');
  await form.getByRole('button', { name: '取消' }).click();
  // Boxes need a box size; a medicine without stock says so.
  await meds.getByTestId('wellbeing-add-medication').click();
  await form.getByLabel('药物名称').fill('奥沙西泮');
  await form.getByLabel('类型').selectOption('as_needed');
  await form.getByLabel('现有几盒（可选）').fill('1');
  await form.getByRole('button', { name: '保存药物' }).click();
  await expect(page.getByTestId('wellbeing-med-error')).toContainText('每盒几颗');
  await form.getByLabel('现有几盒（可选）').fill('');
  await form.getByRole('button', { name: '保存药物' }).click();
  await expect(meds.locator('[data-medication="奥沙西泮"]').getByTestId('wellbeing-stock')).toContainText('还没有记录库存');
  // Back on the day form: one tap on the medicine fills its name, pills and type; the strength is converted for display.
  await page.getByTestId('wellbeing-tab-today').click();
  await page.getByTestId('wellbeing-add-dose').click();
  const dose = page.getByTestId('wellbeing-dose-form');
  await dose.getByTestId('wellbeing-dose-meds').getByRole('button', { name: '米那普仑', exact: true }).click(); // picked from the list: name, pills and type come with it
  await expect(dose.getByTestId('wellbeing-dose-meds').getByRole('button', { name: '米那普仑' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dose.getByLabel('药物名称')).toHaveAttribute('inert', ''); // nothing to type
  await expect(dose.getByLabel(/^吃了几/)).toHaveValue('1');
  await expect(dose.getByLabel('类型')).toHaveValue('scheduled');
  await expect(page.getByTestId('wellbeing-dose-converted')).toContainText('约合 12.5 mg');
  await dose.getByLabel(/^吃了几/).fill('1.5');
  await expect(page.getByTestId('wellbeing-dose-converted')).toContainText('约合 18.75 mg');
  await dose.getByRole('button', { name: '保存服药' }).click();
  await expect(page.getByTestId('wellbeing-dose')).toContainText('米那普仑 · 1.5 颗（18.75 mg）');
  await page.getByTestId('wellbeing-add-dose').click();
  await dose.getByTestId('wellbeing-dose-meds').getByRole('button', { name: '奥沙西泮', exact: true }).click();
  await expect(dose.getByLabel('类型')).toHaveValue('as_needed');
  await expect(dose.getByLabel(/^吃了几/)).toHaveValue('1'); // the form's default "pills per dose"
  await expect(page.getByTestId('wellbeing-dose-converted')).not.toContainText('约合'); // no strength set, so no milligrams
  await dose.getByRole('button', { name: '取消' }).click();
  // The dose took pills from the stock.
  await page.getByTestId('wellbeing-tab-medications').click();
  await expect(meds.locator('[data-medication="米那普仑"]').getByTestId('wellbeing-stock')).toContainText('2 盒 3.5 颗（共 59.5 颗）');
});

test('one tap logs "taken", can be undone, and restock and count keep the stock right', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-medications').click();
  const meds = page.getByTestId('wellbeing-medications');
  await meds.getByTestId('wellbeing-add-medication').click();
  const form = meds.getByTestId('wellbeing-medication-form');
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByLabel(/^每盒几/).fill('28');
  await form.getByLabel(/^每次默认几/).fill('1');
  await form.getByLabel('现有几盒（可选）').fill('1');
  await form.getByRole('button', { name: '保存药物' }).click();
  const card = meds.locator('[data-medication="示例药物"]');
  const stock = card.getByTestId('wellbeing-stock');
  await expect(stock).toContainText('1 盒 0 颗（共 28 颗）');
  // Each medicine is a widget with a ring: what is left as a share of one box, the number in the middle.
  const ring = card.getByTestId('wellbeing-stock-ring');
  await expect(card.locator('[data-metric="dose"]')).toHaveCount(1);
  await expect(ring).toHaveAttribute('data-fraction', '1.000');
  await expect(ring).toContainText('28');
  await card.getByTestId('wellbeing-took').click();
  await expect(page.getByTestId('wellbeing-med-undo')).toContainText('已记录：示例药物 1 颗');
  await expect(stock).toContainText('0 盒 27 颗（共 27 颗）');
  await expect(ring).toHaveAttribute('data-fraction', '0.964');
  await expect(ring).toContainText('27');
  await expect(card).toContainText('按近 14 天平均每天 0.07 颗');
  await page.getByTestId('wellbeing-med-undo').getByRole('button', { name: '撤销' }).click();
  await expect(stock).toContainText('1 盒 0 颗（共 28 颗）');
  await expect(page.getByTestId('wellbeing-med-notice')).toContainText('库存已恢复');
  // The tap is a real dose on today's form, and deleting it there restores the stock too.
  await card.getByTestId('wellbeing-took').click();
  await page.getByTestId('wellbeing-tab-today').click();
  await expect(page.getByTestId('wellbeing-dose')).toContainText('示例药物 · 1 颗');
  await page.getByRole('button', { name: '删除 示例药物 服药记录' }).click();
  await page.getByRole('button', { name: '确认删除 示例药物 服药记录' }).click();
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(0);
  await page.getByTestId('wellbeing-tab-medications').click();
  await expect(stock).toContainText('1 盒 0 颗（共 28 颗）');
  // Restock by boxes; count to the real number on the shelf.
  await card.getByRole('button', { name: '给 示例药物 补货' }).click();
  const restock = meds.getByTestId('wellbeing-panel-restock');
  await restock.getByRole('button', { name: '确认补货' }).click();
  await expect(page.getByTestId('wellbeing-med-error')).toContainText('补了几盒或几颗');
  await restock.getByLabel('盒数').fill('2');
  await restock.getByLabel(/^另外几/).fill('3');
  await restock.getByRole('button', { name: '确认补货' }).click();
  await expect(stock).toContainText('3 盒 3 颗（共 87 颗）');
  await card.getByRole('button', { name: '盘点 示例药物' }).click();
  const count = meds.getByTestId('wellbeing-panel-count');
  await count.getByLabel('盒数').fill('1');
  await count.getByLabel(/^另外几/).fill('12');
  await count.getByRole('button', { name: '确认盘点' }).click();
  await expect(stock).toContainText('1 盒 12 颗（共 40 颗）');
  await expect(page.getByTestId('wellbeing-med-notice')).toContainText('已盘点');
  // Running out is shown plainly.
  await card.getByRole('button', { name: '盘点 示例药物' }).click();
  await count.getByLabel('盒数').fill('0');
  await count.getByLabel(/^另外几/).fill('0');
  await count.getByRole('button', { name: '确认盘点' }).click();
  await expect(stock).toContainText('已用完（0 颗）');
});

test('several days can be back-filled at once, and repeating it adds nothing', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-medications').click();
  const meds = page.getByTestId('wellbeing-medications');
  await meds.getByTestId('wellbeing-add-medication').click();
  const form = meds.getByTestId('wellbeing-medication-form');
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByLabel(/^每盒几/).fill('28');
  await form.getByLabel(/^每次默认几/).fill('1');
  await form.getByLabel('现有几盒（可选）').fill('1');
  await form.getByRole('button', { name: '保存药物' }).click();
  const card = meds.locator('[data-medication="示例药物"]');
  await card.getByRole('button', { name: '补录 示例药物 多天记录' }).click();
  const panel = meds.getByTestId('wellbeing-panel-batch');
  const yesterday = addDays(today(), -1);
  await panel.getByLabel('开始日期').fill(addDays(today(), -3));
  await panel.getByLabel('结束日期').fill(yesterday);
  await expect(panel.getByTestId('wellbeing-batch-preview')).toContainText('将生成最多 6 条（3 天 × 2 次）');
  await panel.getByRole('button', { name: '加时间点' }).click();
  await expect(panel.getByTestId('wellbeing-batch-preview')).toContainText('9 条（3 天 × 3 次）');
  await panel.getByRole('button', { name: '删除第 3 个时间点' }).click();
  await panel.getByRole('button', { name: '生成记录' }).click();
  await expect(page.getByTestId('wellbeing-med-notice')).toContainText('已补录 6 条');
  await expect(card.getByTestId('wellbeing-stock')).toContainText('0 盒 22 颗（共 22 颗）');
  // The same request again is a no-op.
  await card.getByRole('button', { name: '补录 示例药物 多天记录' }).click();
  await panel.getByLabel('开始日期').fill(addDays(today(), -3));
  await panel.getByLabel('结束日期').fill(yesterday);
  await panel.getByRole('button', { name: '生成记录' }).click();
  await expect(page.getByTestId('wellbeing-med-notice')).toContainText('已补录 0 条，6 条已存在已跳过');
  await expect(card.getByTestId('wellbeing-stock')).toContainText('共 22 颗');
  // The records are real: they are on the days they were back-filled to.
  await page.getByTestId('wellbeing-tab-history').click();
  await page.locator(`[data-testid="wellbeing-day"][data-date="${yesterday}"]`).click();
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(2);
  await expect(page.getByTestId('wellbeing-dose').first()).toContainText('示例药物 · 1 颗');
});

test('side effects belong to the medicine and are offered first in its dose editor', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-medications').click();
  const meds = page.getByTestId('wellbeing-medications');
  await meds.getByTestId('wellbeing-add-medication').click();
  const form = meds.getByTestId('wellbeing-medication-form');
  await form.getByLabel('药物名称').fill('米那普仑');
  // Type one and press Enter; add another with a built-in suggestion; repeats in any case are ignored.
  await form.getByLabel('添加副作用').fill('口干');
  await form.getByLabel('添加副作用').press('Enter');
  await form.getByRole('button', { name: '+ 出汗' }).click();
  await form.getByLabel('添加副作用').fill('口干 ');
  await form.getByLabel('添加副作用').press('Enter');
  await expect(form.getByTestId('wellbeing-effect-tag')).toHaveCount(2);
  await expect(form.getByRole('button', { name: '+ 出汗' })).toHaveCount(0); // already added
  await form.getByRole('button', { name: '去掉副作用 出汗' }).click();
  await form.getByLabel('添加副作用').fill('夜里口渴');  // still being typed when saving: it is kept
  await form.getByRole('button', { name: '保存药物' }).click();
  const card = meds.locator('[data-medication="米那普仑"]');
  await expect(card.getByTestId('wellbeing-med-effects')).toContainText('口干、夜里口渴');
  // Another medicine with no side effects of its own.
  await meds.getByTestId('wellbeing-add-medication').click();
  await form.getByLabel('药物名称').fill('甲药');
  await form.getByRole('button', { name: '保存药物' }).click();
  await expect(meds.locator('[data-medication="甲药"]').getByTestId('wellbeing-med-effects')).toHaveCount(0);
  // In the dose editor the medicine's own side effects come first once that medicine is chosen.
  await page.getByTestId('wellbeing-tab-today').click();
  await page.getByTestId('wellbeing-add-dose').click();
  const dose = page.getByTestId('wellbeing-dose-form');
  const chips = dose.getByTestId('wellbeing-effect-chips');
  await expect(chips.getByRole('button').first()).toHaveText('困倦、嗜睡'); // no medicine yet: the built-in order
  await dose.getByTestId('wellbeing-dose-meds').getByRole('button', { name: '米那普仑', exact: true }).click();
  await expect(chips.getByRole('button').first()).toHaveText('口干');
  await expect(chips.getByRole('button').nth(1)).toHaveText('夜里口渴');
  await chips.getByRole('button', { name: '口干' }).click();
  await dose.getByRole('button', { name: '保存服药' }).click();
  await expect(page.getByTestId('wellbeing-symptom')).toHaveText('口干');
  // Editing the medicine can change the list; the logged side effect stays.
  await page.getByTestId('wellbeing-tab-medications').click();
  await meds.getByRole('button', { name: '编辑药物 米那普仑' }).click();
  await form.getByRole('button', { name: '去掉副作用 口干' }).click();
  await form.getByRole('button', { name: '保存修改' }).click();
  await expect(card.getByTestId('wellbeing-med-effects')).toContainText('夜里口渴');
  await expect(card.getByTestId('wellbeing-med-effects')).not.toContainText('口干');
  await page.getByTestId('wellbeing-tab-today').click();
  await expect(page.getByTestId('wellbeing-symptom')).toContainText('口干');
});

test('medicines are widgets three to a row, the ring is what is left, and the pop-ups carry restock and the form', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-medications').click();
  const meds = page.getByTestId('wellbeing-medications');
  const specs = [['甲药', '10', '1', '0'], ['乙药', '10', '0', '2'], ['丙药', '', '', '']];
  for (const [name, box, boxes, loose] of specs) {
    await meds.getByTestId('wellbeing-add-medication').click();
    await expect(page.getByRole('dialog')).toBeVisible(); // the form is a pop-up, not a block in the page
    const form = meds.getByTestId('wellbeing-medication-form');
    await form.getByLabel('药物名称').fill(name);
    if (box) await form.getByLabel(/^每盒几/).fill(box);
    if (boxes) await form.getByLabel('现有几盒（可选）').fill(boxes);
    if (loose && loose !== '0') await form.getByLabel(/^另外几/).fill(loose);
    await form.getByRole('button', { name: '保存药物' }).click();
    await expect(form).toHaveCount(0);
  }
  const tiles = meds.locator('[data-medication] [data-metric="dose"]');
  await expect(tiles).toHaveCount(3);
  const boxes = await tiles.evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) }; }));
  expect(new Set(boxes.map(b => b.y)).size).toBe(1); // three on one row, as tall as each other
  expect(new Set(boxes.map(b => b.h)).size).toBe(1);
  const ring = (name: string) => meds.locator(`[data-medication="${name}"]`).getByTestId('wellbeing-stock-ring');
  await expect(ring('甲药')).toHaveAttribute('data-fraction', '1.000'); // a whole box
  await expect(ring('乙药')).toHaveAttribute('data-fraction', '0.200'); // 2 of 10
  await expect(ring('乙药')).toContainText('2');
  await expect(ring('丙药')).toHaveAttribute('data-fraction', ''); // no stock noted: an empty ring and a dash
  // Restock is a pop-up too, titled with the medicine.
  await meds.locator('[data-medication="乙药"]').getByRole('button', { name: '给 乙药 补货' }).click();
  await expect(page.getByRole('dialog')).toContainText('乙药 · 补货');
  await meds.getByTestId('wellbeing-panel-restock').getByLabel('盒数').fill('1');
  await meds.getByTestId('wellbeing-panel-restock').getByRole('button', { name: '确认补货' }).click();
  await expect(ring('乙药')).toHaveAttribute('data-fraction', '1.000');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('removing a medicine keeps the doses that were already logged', async ({ page }) => {
  await open(page);
  await addDose(page, { name: '甲药' });
  await page.getByTestId('wellbeing-tab-medications').click();
  const meds = page.getByTestId('wellbeing-medications');
  await expect(meds.locator('[data-medication="甲药"]')).toContainText('甲药');
  await meds.getByRole('button', { name: '移除药物 甲药' }).click();
  await expect(meds.getByText('再点一次“确认移除”')).toBeVisible();
  await meds.getByRole('button', { name: '确认移除药物 甲药' }).click();
  await expect(meds.getByTestId('wellbeing-medication')).toHaveCount(0);
  await page.getByTestId('wellbeing-tab-today').click();
  await expect(page.getByTestId('wellbeing-dose')).toContainText('甲药');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`phone width: no sideways scroll, 44px targets and readable in ${scheme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 361, height: 780 });
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.getByTestId('wellbeing-add-dose').click();
    await noOverflow(page);
    // The editor is a dialog that fits the phone screen.
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(361);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const dial = await scale(page, '焦虑').locator('.dial').boundingBox();
    expect(dial!.height).toBeGreaterThanOrEqual(88);
    // On a phone each widget has the full width, so the dial is large enough to turn with a thumb.
    const first = await page.locator('[data-metric="mood"]').boundingBox();
    expect(first!.width).toBeGreaterThanOrEqual(300);
    expect(dial!.width).toBeGreaterThanOrEqual(130);
    for (const tab of ['medications', 'history', 'trends', 'report'] as const) {
      await page.getByTestId(`wellbeing-tab-${tab}`).click();
      await noOverflow(page);
    }
    const color = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });
}

test('the workspace address shows the same page with workspace links', async ({ page }) => {
  await open(page, '/workspace/wellbeing');
  await expect(page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '身心健康' })).toHaveAttribute('href', '/workspace/wellbeing');
});

test('the small round buttons sit on the widget\'s title row, centred with its icon, and are big enough to hit', async ({ page }) => {
  await open(page);
  await pick(page, '焦虑', 6);
  for (const [tile, button] of [['anxiety', 'button.clear'], ['dose', '[data-testid="wellbeing-add-dose"]']] as const) {
    const badge = (await page.locator(`[data-metric="${tile}"] .badge`).boundingBox())!, small = (await page.locator(`[data-metric="${tile}"] ${button}`).boundingBox())!;
    expect(Math.abs((small.y + small.height / 2) - (badge.y + badge.height / 2))).toBeLessThanOrEqual(1);
    expect(small.width).toBeGreaterThanOrEqual(34);
    const hit = await page.locator(`[data-metric="${tile}"] ${button}`).evaluate(el => { const r = el.getBoundingClientRect(), a = getComputedStyle(el, '::after'); return { w: r.width + 2 * Math.abs(parseFloat(a.left)), h: r.height + 2 * Math.abs(parseFloat(a.top)) }; });
    expect(Math.min(hit.w, hit.h)).toBeGreaterThanOrEqual(44); // the touch area, with its padding
  }
});

test('the dial follows the value, shows an empty ring until it is turned, and returns there on clear', async ({ page }) => {
  await open(page);
  const group = scale(page, '焦虑');
  const dial = group.locator('.dial');
  const fraction = async () => Number(await dial.getAttribute('data-fraction'));
  await expect(dial).toHaveClass(/unset/);
  await expect(dial.locator(':scope > svg [data-part="progress"]')).toHaveCount(0);
  await slider(page, '焦虑').fill('10');
  await expect(dial).not.toHaveClass(/unset/);
  await expect.poll(fraction).toBeGreaterThan(0.99);
  await slider(page, '焦虑').fill('5');
  await expect.poll(fraction).toBeCloseTo(0.5, 1);
  await expect(dial.locator(':scope > svg [data-part="progress"]')).toHaveCount(1);
  await page.getByRole('button', { name: '清除焦虑' }).click();
  await expect(dial).toHaveClass(/unset/);
  await expect.poll(fraction).toBe(0);
  await expect(dial.locator(':scope > svg [data-part="progress"]')).toHaveCount(0);
});

test('the save bar is liquid glass while it floats over content and a plain card when it rests at the end', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await open(page);
  await pick(page, '焦虑', 6);
  const bar = page.locator('.save-bar');
  await expect(bar).toBeVisible();
  // Top of a long form: the bar covers the content below it.
  await expect(bar).toHaveAttribute('data-glass', 'floating');
  // The bar is as wide as one widget column and lines up with the last column above it, left and right.
  const barBox = (await bar.boundingBox())!, lastTile = (await page.locator('[data-metric="note"]').boundingBox())!;
  expect(Math.abs(barBox.x - lastTile.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(barBox.x + barBox.width - (lastTile.x + lastTile.width))).toBeLessThanOrEqual(1);
  expect(barBox.height).toBeLessThan(90); // still a slim bar
  const floatingFilter = await bar.evaluate(el => getComputedStyle(el).backdropFilter);
  expect(floatingFilter).not.toBe('none');
  const floatingShadow = await bar.evaluate(el => getComputedStyle(el).boxShadow);
  // End of the form: nothing is underneath, so the bar is an ordinary card again.
  await page.getByTestId('wellbeing-doses').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(bar).toHaveAttribute('data-glass', 'docked');
  expect(await bar.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none');
  await expect.poll(() => bar.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none'); // after its short transition
  expect(floatingShadow).not.toBe('none');
  // Scrolling back up floats it again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toHaveAttribute('data-glass', 'floating');
  await expect(page.getByRole('button', { name: '保存今日状态' })).toBeVisible();
});

test('tapping the number in the middle opens a box to type the value; Enter applies, Escape drops, out of range is clamped', async ({ page }) => {
  await open(page);
  const group = scale(page, '焦虑');
  const value = group.getByTestId('scale-value');
  const edit = group.getByRole('button', { name: '直接输入焦虑' });
  await edit.click();
  const box = group.getByRole('textbox', { name: /^输入焦虑/ });
  await expect(box).toBeFocused();
  await box.fill('7');
  await box.press('Enter');
  await expect(value).toHaveText('7');
  await expect(box).toHaveCount(0);
  // Escape drops what was typed.
  await edit.click();
  await group.getByRole('textbox', { name: /^输入焦虑/ }).fill('2');
  await page.keyboard.press('Escape');
  await expect(value).toHaveText('7');
  // Out of range is brought back into range; leaving the box applies it too.
  await edit.click();
  await group.getByRole('textbox', { name: /^输入焦虑/ }).fill('15');
  await group.getByRole('textbox', { name: /^输入焦虑/ }).blur();
  await expect(value).toHaveText('10');
  // An empty box changes nothing, and the box opens with the current value ready to replace.
  await edit.click();
  const again = group.getByRole('textbox', { name: /^输入焦虑/ });
  await expect(again).toHaveValue('10');
  await again.fill('');
  await again.press('Enter');
  await expect(value).toHaveText('10');
  // It works on an unanswered dial too, and the ring follows.
  await scale(page, '精力').getByRole('button', { name: '直接输入精力' }).click();
  await scale(page, '精力').getByRole('textbox', { name: /^输入精力/ }).fill('3');
  await page.keyboard.press('Enter');
  await expect(scale(page, '精力').locator('.dial')).toHaveAttribute('data-fraction', '0.300');
});

test('an untouched dial is solid, not faint: a full-strength ring, a knob waiting at the start, and a dash', async ({ page }) => {
  await open(page);
  const group = scale(page, '焦虑');
  const dial = group.locator('.dial');
  await expect(dial).toHaveClass(/unset/);
  // The ring track is an opaque colour (no alpha), and the dial itself is not dimmed.
  const track = await dial.locator(':scope > svg .track').evaluate(el => getComputedStyle(el).stroke);
  expect(track).not.toMatch(/rgba|\/ ?0?\.\d/);
  expect(Number(await dial.evaluate(el => getComputedStyle(el).opacity))).toBe(1);
  await expect(dial.locator('strong')).toHaveText('—');
  // The glass knob waits at the start of the ring (lower left), visible and ready to be taken.
  const thumb = dial.locator('.rn-slider-thumb');
  await expect(thumb).toBeVisible();
  const [d, t] = [(await dial.boundingBox())!, (await thumb.boundingBox())!];
  expect(t.x + t.width / 2).toBeLessThan(d.x + d.width / 2);
  expect(t.y + t.height / 2).toBeGreaterThan(d.y + d.height / 2);
});

test('the typing box is small and animated: it grows out of the number and shrinks back into it', async ({ page }) => {
  await open(page);
  const group = scale(page, '焦虑');
  const dial = group.locator('.dial');
  const dialBox = (await dial.boundingBox())!;
  await group.getByRole('button', { name: '直接输入焦虑' }).click();
  const input = group.getByRole('textbox', { name: /^输入焦虑/ });
  await expect(input).toBeFocused();
  const small = (await input.boundingBox())!;
  expect(small.width).toBeLessThan(dialBox.width * 0.45); // well inside the ring, never covering it
  expect(small.height).toBeLessThan(dialBox.height * 0.3);
  // Leaving it plays the exit animation: it is still in the page for a moment, then gone.
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(group.getByRole('button', { name: '直接输入焦虑' })).toBeVisible();
  expect(Number(await group.getByRole('button', { name: '直接输入焦虑' }).evaluate(el => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
});

test('widgets sit three to a row, so each one is wide enough for its dial', async ({ page }) => {
  await loginRunner(page);
  for (const width of [1000, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/wellbeing');
    await expect(page.locator('[data-metric="note"]')).toBeVisible();
    const boxes = await page.locator('section.widgets').first().locator('[data-metric]').evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { x: b.x, y: Math.round(b.y), w: b.width }; }));
    const rows = new Map<number, number>();
    for (const b of boxes) rows.set(b.y, (rows.get(b.y) ?? 0) + 1);
    expect([...rows.values()]).toEqual([3, 3, 3]); // 9 widgets (the medication one just before the note): 3 + 3 + 3, at every desktop width
    expect(Math.abs(boxes[0].w - boxes[1].w)).toBeLessThanOrEqual(1);
    // The widget is as wide as its row allows: a dial never has to shrink.
    expect(boxes[0].w).toBeGreaterThan(260);
  }
});

test('sleep is one double ring: hours outside, minutes inside, exact to the minute, with room for the time in the middle', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await open(page);
  const box = page.getByTestId('wellbeing-sleep');
  const dial = box.locator('.dial');
  await expect(dial).toHaveClass(/unset/);
  await expect(dial).toHaveCount(1);
  await expect(box.locator('input[type=range]')).toHaveCount(2);
  await page.getByRole('slider', { name: '睡眠小时' }).fill('7');
  await expect(box.getByTestId('scale-value')).toHaveText('7 小时');
  await page.getByRole('slider', { name: '睡眠分钟' }).fill('25');
  await expect(box.getByTestId('scale-value')).toHaveText('7 小时 25 分');
  // The time fits inside the inner ring: its text box is narrower than the ring's inner diameter.
  const d = (await dial.boundingBox())!, text = (await box.locator('.center strong').boundingBox())!;
  const single = (await page.locator('[data-metric="mood"] .dial').boundingBox())!;
  expect(Math.abs(d.width - single.width)).toBeLessThanOrEqual(2); // the same size as the other widgets' dials
  expect(Math.abs((await page.locator('[data-metric="sleep"]').boundingBox())!.height - (await page.locator('[data-metric="focus"]').boundingBox())!.height)).toBeLessThanOrEqual(1); // and the row is even
  expect(text.width).toBeLessThan(d.width * 0.44);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('1/8');
  await page.reload();
  await expect(page.getByTestId('wellbeing-sleep').getByTestId('scale-value')).toHaveText('7 小时 25 分');
  await expect(page.getByRole('slider', { name: '睡眠小时' })).toHaveValue('7');
  await expect(page.getByRole('slider', { name: '睡眠分钟' })).toHaveValue('25');
  await page.getByRole('slider', { name: '睡眠分钟' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(box.getByTestId('scale-value')).toHaveText('7 小时 26 分');
  await page.getByRole('button', { name: '清除睡眠时长' }).click();
  await expect(dial).toHaveClass(/unset/);
  await page.getByRole('slider', { name: '睡眠分钟' }).fill('45');
  await expect(box.getByTestId('scale-value')).toHaveText('45 分');
  await page.getByRole('button', { name: '清除睡眠时长' }).click();
  await page.getByRole('slider', { name: '睡眠小时' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(box.getByTestId('scale-value')).toHaveText('7 小时');
});

test('the sleep rings differ in size: a thick ring with a big knob for hours, a thin ring with a small knob for minutes', async ({ page }) => {
  await open(page);
  const dial = page.getByTestId('wellbeing-sleep');
  await expect(dial.locator('.rn-slider-thumb')).toHaveCount(2); // the glass knobs are in place
  const width = (selector: string) => dial.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).strokeWidth));
  expect(await width('.track.outer')).toBeGreaterThan((await width('.track.inner')) * 1.4);
  await sleep(page, 7, 25);
  expect(await width('.progress.outer')).toBeGreaterThan((await width('.progress.inner')) * 1.4);
  const knobs = await dial.locator('.rn-slider-thumb').evaluateAll(nodes => nodes.map(n => parseFloat((n as HTMLElement).style.width)));
  expect(knobs).toHaveLength(2);
  expect(knobs[0]).toBeGreaterThan(knobs[1] * 1.4); // hours first, then minutes
  // Even where both rings start (and at any time), the two knobs never overlap: the rings are far enough apart for them to sit side by side.
  for (const [h, m] of [[0, 0], [7, 25], [16, 59]] as const) {
    await sleep(page, h, m);
    const centres = await dial.locator('.rn-slider-thumb').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 }; }));
    expect(Math.hypot(centres[0].x - centres[1].x, centres[0].y - centres[1].y)).toBeGreaterThanOrEqual(centres[0].r + centres[1].r);
  }
});

test('on the sleep ring, where you touch decides what turns: the outer ring is hours, the inner ring minutes', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await open(page);
  const box = page.getByTestId('wellbeing-sleep');
  const dial = box.locator('.dial');
  const value = box.getByTestId('scale-value');
  // Keep the dial in the middle of the view, clear of the floating save bar that appears after the first change.
  await dial.evaluate(el => el.scrollIntoView({ block: 'center' }));
  let at = await ringPoint(dial, 0.5, 41);
  await page.mouse.click(at.x, at.y);
  await expect(value).toHaveText('8 小时'); // 16 hours round, half way
  at = await ringPoint(dial, 0.5, 27);
  await page.mouse.click(at.x, at.y);
  await expect(dial).toHaveAttribute('data-hours', '8');
  await expect(dial).toHaveAttribute('data-minutes', '30');
  await expect(value).toHaveText('8 小时 30 分');
  // Dragging the inner ring keeps turning the inner ring even when the pointer drifts outwards.
  await dial.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const start = await ringPoint(dial, 0.1, 27);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const drift = await ringPoint(dial, 0.75, 38);
  await page.mouse.move(drift.x, drift.y, { steps: 8 });
  await page.mouse.up();
  await expect(dial).toHaveAttribute('data-hours', '8');
  expect(Number(await dial.getAttribute('data-minutes'))).toBeGreaterThan(40);
  // The middle of the ring is not a handle.
  const centre = (await dial.boundingBox())!;
  await page.mouse.click(centre.x + centre.width / 2, centre.y + centre.height / 2);
  await expect(dial).toHaveAttribute('data-hours', '8');
});

test('the sleep ring takes a typed time in a small box: 7:25, 7.5 or 7h25m; something unreadable stays open and says so', async ({ page }) => {
  await open(page);
  const box = page.getByTestId('wellbeing-sleep');
  const value = box.getByTestId('scale-value');
  const dialBox = (await box.locator('.dial').boundingBox())!;
  await box.getByRole('button', { name: '直接输入睡眠时长' }).click();
  const input = box.getByRole('textbox', { name: /^输入睡眠时长/ });
  await expect(input).toBeFocused();
  const small = (await input.boundingBox())!;
  expect(small.width).toBeLessThan(dialBox.width * 0.4); // well inside the rings
  await input.fill('7:25');
  await input.press('Enter');
  await expect(value).toHaveText('7 小时 25 分');
  await expect(box.locator('.dial')).toHaveAttribute('data-minutes', '25');
  await box.getByRole('button', { name: '直接输入睡眠时长' }).click();
  await expect(input).toHaveValue('7:25');
  await input.fill('99:99');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(value).toHaveText('7 小时 25 分');
  await input.fill('7.5');
  await input.press('Enter');
  await expect(value).toHaveText('7 小时 30 分');
  await box.getByRole('button', { name: '直接输入睡眠时长' }).click();
  await input.fill('6h5m');
  await input.press('Enter');
  await expect(value).toHaveText('6 小时 5 分');
  await box.getByRole('button', { name: '直接输入睡眠时长' }).click();
  await input.fill('8:00');
  await page.keyboard.press('Escape');
  await expect(value).toHaveText('6 小时 5 分');
});
