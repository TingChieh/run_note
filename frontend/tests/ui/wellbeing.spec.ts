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
  await form.getByLabel('实际服药时间', { exact: true }).fill(time);
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

/** Fills the synthetic account through its own API (as the page would): `days` back from today, with state answers, two medicines and a few side effects tied to doses. */
async function seed(page: Page, days: number) {
  await page.evaluate(async (count) => {
    const csrf = (await (await fetch('/api/v1/auth/csrf')).json()).data.csrf_token;
    const call = async (method: string, path: string, body: unknown) => (await (await fetch(`/api/v1/me/wellbeing${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })).json()).data;
    const shift = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    for (let i = count - 1; i >= 0; i--) {
      const date = shift(i), k = count - 1 - i;
      if (k % 5 !== 4) await call('PUT', `/days/${date}/entry`, { mood: 4 + (k % 5), anxiety: 7 - (k % 4), energy: 3 + (k % 6), sleep_hours: 6 + (k % 3) * 0.5, sleep_quality: 5, note: k % 4 === 0 ? (k === 28 ? '短备注' : `第 ${k} 天的备注，比较长的一段文字用来测试展开和收起的效果，需要写得足够长，长到在电脑宽屏上也会排满两行以上，所以这里反复多写一些内容：睡得不太好，早上起来有点头晕，下午好一些，晚上又有些焦虑，但整体比前几天平稳，继续观察。第二天起来精神还可以，中午午睡了一会儿，傍晚散步半小时，回来之后吃了药，晚饭后没有再出现不舒服，睡前读了一会儿书，十一点前就睡着了，总体来说是平静的一天。`) : null });
      const first = await call('POST', '/doses', { medication_name: '甲药', pills: k < count / 2 ? 1 : 2, taken_at: `${date}T00:05:00+08:00`, regimen: 'scheduled' });
      if (k % 3 === 0) await call('POST', '/doses', { medication_name: '乙药', pills: 1, taken_at: `${date}T00:06:00+08:00`, regimen: 'as_needed' });
      if (k % 4 === 1) await call('POST', '/symptoms', { entry_date: date, dose_id: first.id, symptom: k % 8 === 1 ? '头晕' : '恶心', onset_at: null, duration_minutes: null, affects_daily_life: null });
    }
  }, days);
}

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
  for (const time of ['00:00', '00:01', '00:02', '00:03', '00:04', '00:05']) await addDose(page, { time });
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
  // Taking one off in the dose's own dialog removes it from the day.
  await page.getByRole('button', { name: '编辑 示例药物 服药记录' }).click();
  await expect(form.getByRole('button', { name: '头晕' })).toHaveAttribute('aria-pressed', 'true');
  await form.getByRole('button', { name: '头晕' }).click();
  await form.getByRole('button', { name: '保存修改' }).click();
  await expect(form).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveText('耳鸣');
});

test('every side effect sits inside the capsule of the dose it was written for, not in a list below', async ({ page }) => {
  await open(page);
  const add = async (name: string, effect: string) => {
    await page.getByTestId('wellbeing-add-dose').click();
    const form = page.getByTestId('wellbeing-dose-form');
    const picker = form.getByTestId('wellbeing-dose-meds');
    if (await picker.count()) await picker.getByRole('button', { name: '其他药物' }).click();
    await form.getByLabel('药物名称').fill(name);
    await form.getByLabel(/^吃了几/).fill('1');
    await form.getByRole('button', { name: effect }).click();
    await form.getByRole('button', { name: '保存服药' }).click();
    await expect(form).toHaveCount(0);
  };
  await add('甲药', '恶心');
  await add('乙药', '头晕');
  const capsules = page.getByTestId('wellbeing-dose');
  await expect(capsules).toHaveCount(2);
  const first = capsules.filter({ hasText: '甲药' }), second = capsules.filter({ hasText: '乙药' });
  await expect(first.getByTestId('wellbeing-symptom')).toHaveText('恶心');
  await expect(second.getByTestId('wellbeing-symptom')).toHaveText('头晕');
  // Nothing is listed outside a capsule, and the screen reader hears the side effect with its dose.
  await expect(page.getByTestId('wellbeing-loose-symptoms')).toHaveCount(0);
  await expect(first.locator('.sr-only')).toContainText('副作用：恶心');
  const outside = await page.getByTestId('wellbeing-symptom').evaluateAll(els => els.filter(el => !el.closest('[data-testid="wellbeing-dose"]')).length);
  expect(outside).toBe(0);
  // Opening that dose again shows its side effects ticked, and deleting the dose takes them with it.
  await page.getByRole('button', { name: '编辑 甲药 服药记录' }).click();
  await expect(page.getByTestId('wellbeing-dose-form').getByRole('button', { name: '恶心' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('wellbeing-dose-form').getByRole('button', { name: '头晕' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('wellbeing-dose-form').getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '删除 甲药 服药记录' }).click();
  await page.getByRole('button', { name: '确认删除 甲药 服药记录' }).click();
  await expect(capsules).toHaveCount(1);
  await expect(page.getByTestId('wellbeing-symptom')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('wellbeing-symptom')).toHaveText('头晕');
});

test('many side effects stay on one line in the capsule: whole tags that fit, then "+N", never a tag cut in half', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByLabel(/^吃了几/).fill('1');
  for (const name of ['困倦、嗜睡', '恶心', '头痛', '心悸', '出汗', '失眠', '食欲变化', '坐立不安']) await form.getByRole('button', { name }).click();
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(form).toHaveCount(0);
  await settled(page);
  const line = page.getByTestId('wellbeing-symptoms');
  const look = await line.evaluate(el => {
    const box = el.getBoundingClientRect(), tags = [...el.querySelectorAll<HTMLElement>('.tag')].filter(t => !t.hidden), rects = tags.map(t => t.getBoundingClientRect());
    return { rows: new Set(rects.map(r => Math.round(r.top))).size, inside: rects.every(r => r.right <= box.right + 1), shown: tags.length, more: el.querySelector('.more:not([hidden])')?.textContent ?? '', last: tags.at(-1)?.classList.contains('more') ?? false };
  });
  expect(look.rows).toBe(1);
  expect(look.inside).toBe(true);
  expect(look.last).toBe(true);
  const hidden = 8 - (look.shown - 1);
  expect(hidden).toBeGreaterThan(0);
  expect(look.more).toBe(`+${hidden}`);
  await expect(line).toHaveAttribute('title', /困倦、嗜睡、恶心/);
  // The capsule with side effects is not a full pill: its corners leave room for the text.
  const capsule = page.getByTestId('wellbeing-dose');
  expect(await capsule.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeLessThan(40);
});

test('a day with a dose can be saved even when no state is answered, and a note alone is enough', async ({ page }) => {
  await open(page);
  // Nothing at all: an answer is asked for.
  await pick(page, '开心程度', 5);
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('1/8');
  await addDose(page);
  // Clearing the only answer, with a dose on the day, saves.
  await page.getByRole('button', { name: '清除开心程度' }).click();
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('0/8');
  await expect(page.getByText('请至少填写')).toHaveCount(0);
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(1);
  // A note alone is enough too.
  await page.getByRole('textbox', { name: '当日备注' }).fill('只写一句');
  await page.getByRole('button', { name: '保存今日状态' }).click();
  await expect(page.getByTestId('wellbeing-status')).toContainText('1/8');
});

test('the words of every chip sit in the middle of it, the open-ended "其他药物" too', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const csrf = (await (await fetch('/api/v1/auth/csrf')).json()).data.csrf_token;
    for (const name of ['甲药', '乙药']) await fetch('/api/v1/me/wellbeing/medications', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ name, count_unit: '颗', pills_per_box: 28, default_pills: 1, regimen: 'scheduled', side_effects: [] }) });
  });
  await page.reload();
  await expect(page.getByTestId('wellbeing-editor')).toBeVisible();
  await settled(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const chips = page.getByTestId('wellbeing-dose-form').locator('.chip-button');
  await expect(chips.first()).toBeVisible();
  await settled(page);
  const off = await chips.evaluateAll(els => els.map(el => { const box = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el); const text = range.getBoundingClientRect(); return { name: el.textContent?.trim(), off: Math.abs((text.left + text.width / 2) - (box.left + box.width / 2)) }; }));
  expect(off.length).toBeGreaterThan(3);
  expect(off.find(item => item.name === '其他药物')).toBeTruthy();
  for (const item of off) expect(item.off, `${item.name}`).toBeLessThanOrEqual(2);
  // Opened into a field, "其他药物" keeps the pill shape of the chips (fully rounded ends), not a rectangle with small corners.
  await page.getByTestId('wellbeing-dose-form').getByRole('button', { name: '其他药物' }).click();
  await settled(page);
  const input = page.getByTestId('wellbeing-dose-form').getByLabel('药物名称');
  const shape = await input.evaluate(el => { const box = el.getBoundingClientRect(), radius = parseFloat(getComputedStyle(el).borderTopLeftRadius); return { height: Math.round(box.height), pill: radius >= box.height / 2 - 1 }; });
  expect(shape.pill).toBe(true);
});

test('the dose dialog: a header with the day, the pill count with + and − in halves, a two-way switch for the kind, and an inline "other" for side effects', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const dialog = page.locator('dialog[open]'), form = page.getByTestId('wellbeing-dose-form');
  // The header names the thing and the day it is for, with the round medication badge.
  await expect(dialog.locator('.dlg-badge')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '添加服药记录' })).toBeVisible();
  await expect(dialog.locator('.dlg-day')).toContainText('记在');
  // The pill count has a − and a + that move it in halves, never below a half.
  await form.getByLabel('药物名称').fill('示例药物');
  const pills = form.getByLabel(/^吃了几/);
  await form.getByRole('button', { name: /^多半/ }).click();
  await expect(pills).toHaveValue('0.5');
  await form.getByRole('button', { name: /^多半/ }).click();
  await expect(pills).toHaveValue('1');
  await form.getByRole('button', { name: /^多半/ }).click();
  await expect(pills).toHaveValue('1.5');
  await form.getByRole('button', { name: /^少半/ }).click();
  await form.getByRole('button', { name: /^少半/ }).click();
  await form.getByRole('button', { name: /^少半/ }).click();
  await expect(pills).toHaveValue('0.5');
  await pills.fill('2');
  await form.getByRole('button', { name: /^多半/ }).click();
  await expect(pills).toHaveValue('2.5');
  // The kind is a two-way switch (radios), the one in use filled.
  const scheduled = form.getByRole('radio', { name: '常规用药' }), asNeeded = form.getByRole('radio', { name: '按需用药' });
  await expect(scheduled).toBeChecked();
  await asNeeded.check({ force: true });
  await expect(asNeeded).toBeChecked();
  await expect(scheduled).not.toBeChecked();
  const fills = await form.locator('.seg-option').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
  expect(fills[0]).not.toBe(fills[1]);
  // "Other" side effect sits in the row of chips as a dashed pill.
  const other = form.getByLabel('其他副作用（可选）');
  expect(await other.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('dashed');
  await other.fill('耳鸣');
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('wellbeing-dose')).toContainText('2.5 颗');
  await expect(page.getByTestId('wellbeing-dose')).toContainText('按需');
  await expect(page.getByTestId('wellbeing-symptom')).toHaveText('耳鸣');
});

test('a dose asks only for its time of day: the day is the one being edited, there is no date picker', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  const field = form.getByLabel('实际服药时间', { exact: true });
  await expect(field).toHaveAttribute('type', 'text'); // the same 24-hour digits in every browser, with no clock button of the browser's own
  await expect(field).toHaveAttribute('inputmode', 'numeric');
  await expect(field).toHaveValue(/^\d{2}:\d{2}$/);
  await expect(page.locator('dialog[open]').getByText(/只需选时间/)).toBeVisible();
  // A time later than now is refused for today, in words.
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByLabel(/^吃了几/).fill('1');
  await field.fill('23:59');
  const nowHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  if (nowHm < '23:59') {
    await form.getByRole('button', { name: '保存服药' }).click();
    await expect(page.getByTestId('wellbeing-event-error')).toContainText('不能晚于现在');
  }
  await field.fill('00:00');
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(form).toHaveCount(0);
  // Editing it shows the same time of day, and saving keeps it on the same day.
  await page.getByRole('button', { name: '编辑 示例药物 服药记录' }).click();
  await expect(form.getByLabel('实际服药时间', { exact: true })).toHaveValue('00:00');
  await form.getByLabel('实际服药时间', { exact: true }).fill('00:30');
  await form.getByRole('button', { name: '保存修改' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('wellbeing-dose')).toContainText('00:30');
  await expect(page.getByTestId('wellbeing-dose')).toHaveCount(1);
});

test('the time picker is a small popover with an hour column and a minute column, in the look of the calendar picker', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  const field = form.getByLabel('实际服药时间', { exact: true });
  await page.getByRole('button', { name: '选择实际服药时间' }).click();
  const popover = page.getByRole('dialog', { name: '选择实际服药时间' });
  await expect(popover).toBeVisible();
  await settled(page);
  // A plain solid popover, not glass: an opaque surface, no blur, and no glass layer on any of its buttons or on the clock button.
  const flat = await popover.evaluate(el => { const style = getComputedStyle(el); return { opaque: style.backgroundColor !== 'rgba(0, 0, 0, 0)' && !/rgba\(.*, 0(\.\d+)?\)$/.test(style.backgroundColor), blur: style.backdropFilter, glass: el.querySelectorAll('.rn-glass-surface').length }; });
  expect(flat).toEqual({ opaque: true, blur: 'none', glass: 0 });
  // Nothing in the picker or on its clock button carries the glass sheen: no gradient, no inset highlight, no backdrop blur.
  const sheen = await page.locator('.time-field').evaluate(root => [root, ...root.querySelectorAll('*')].filter(el => { const style = getComputedStyle(el); return style.backgroundImage !== 'none' || /inset/.test(style.boxShadow) || style.backdropFilter !== 'none'; }).map(el => `${el.tagName}.${(el as HTMLElement).className}`));
  expect(sheen).toEqual([]);
  await expect(page.getByRole('button', { name: '选择实际服药时间' }).locator('.rn-glass-surface')).toHaveCount(0);
  // Two columns of choices.
  await expect(popover.getByTestId('time-hours').getByRole('option')).toHaveCount(24);
  await expect(popover.getByTestId('time-minutes').getByRole('option')).toHaveCount(60);
  // The time being set is shown big, and the chosen hour and minute are filled in.
  const shown = await field.inputValue();
  await expect(popover.locator('.preview')).toContainText(shown.slice(0, 2));
  await expect(popover.locator('.preview')).toContainText(shown.slice(3));
  await expect(popover.locator('[aria-selected="true"]')).toHaveCount(2);
  // The chosen time is fixed in the middle of each column, under a band in the main colour; the column scrolls beneath it.
  for (const column of [popover.getByTestId('time-hours'), popover.getByTestId('time-minutes')]) {
    const band = column.locator('xpath=preceding-sibling::span[contains(@class, "band")]');
    expect(await band.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await expect.poll(() => column.evaluate(el => { const box = el.getBoundingClientRect(), chosen = el.querySelector('[aria-selected="true"]')!.getBoundingClientRect(); return Math.abs((chosen.top + chosen.height / 2) - (box.top + box.height / 2)); })).toBeLessThanOrEqual(2);
    // The band itself sits in the middle of the column and never moves.
    expect(await column.evaluate(el => { const band = el.previousElementSibling!.getBoundingClientRect(), box = el.getBoundingClientRect(); return Math.abs((band.top + band.height / 2) - (box.top + box.height / 2)); })).toBeLessThanOrEqual(2);
  }
  // Choosing an hour and a minute writes them into the field.
  await popover.getByTestId('time-hours').getByRole('option', { name: '00', exact: true }).click();
  await popover.getByTestId('time-minutes').getByRole('option', { name: '07', exact: true }).click();
  await expect(field).toHaveValue('00:07');
  await expect(popover.locator('.preview')).toContainText('00');
  await expect(popover.locator('.preview')).toContainText('07');
  // Times after now are greyed out and cannot be chosen today.
  const nowH = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  if (nowH < 23) {
    await expect(popover.locator('[data-hour="23"]')).toBeDisabled();
  }
  // The keyboard moves the selection a step at a time.
  await popover.getByTestId('time-minutes').locator('[aria-selected="true"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(field).toHaveValue('00:08');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(field).toHaveValue('00:06');
  // Scrolling is choosing: whatever a column comes to rest on becomes the value, with no button to press.
  const pitchOf = (column: import('@playwright/test').Locator) => column.evaluate(el => (el.children[1] as HTMLElement).offsetTop - (el.children[0] as HTMLElement).offsetTop);
  const minutes = popover.getByTestId('time-minutes'), hours = popover.getByTestId('time-hours');
  await minutes.evaluate((el, p) => { el.scrollTop = 30 * p; }, await pitchOf(minutes));
  await expect(field).toHaveValue('00:30');
  await expect(popover.locator('.preview')).toContainText('30');
  if (nowH >= 2) {
    await hours.evaluate((el, p) => { el.scrollTop = 1 * p; }, await pitchOf(hours));
    await expect(field).toHaveValue('01:30');
    // It comes to rest on a whole choice, the chosen one sitting in the middle of its column.
    await expect.poll(() => hours.evaluate(el => { const box = el.getBoundingClientRect(), mid = el.querySelector('[aria-selected="true"]')!.getBoundingClientRect(); return Math.abs((mid.top + mid.height / 2) - (box.top + box.height / 2)) <= 2; })).toBe(true);
  }
  // Scrolling past now does not choose the future: the column gives way to the latest time allowed.
  if (nowH < 23) {
    await hours.evaluate((el, p) => { el.scrollTop = 23 * p; }, await pitchOf(hours));
    await expect.poll(async () => (await field.inputValue()).slice(0, 2)).toBe(String(nowH).padStart(2, '0'));
    await expect(popover.locator('[data-hour="23"]')).toBeDisabled();
  }
  // Nothing is written under it: no hint line.
  await expect(popover).not.toContainText('Esc 关闭');
  await expect(popover.locator('.help')).toHaveCount(0);
  // "现在" sets the present time; Escape closes and the dialog stays.
  await popover.getByRole('button', { name: '现在' }).click();
  const filled = await field.inputValue();
  expect(filled).toMatch(/^\d{2}:\d{2}$/);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(form).toBeVisible();
  // Typing: digits get their colon, short forms are completed on leaving, nonsense goes back to the last good time.
  await field.fill('');
  await field.pressSequentially('0930');
  await expect(field).toHaveValue('09:30');
  await field.fill('7');
  await field.blur();
  await expect(field).toHaveValue('07:00');
  await field.fill('815');
  await field.blur();
  await expect(field).toHaveValue('08:15');
  await field.fill('2599');
  await field.blur();
  await expect(field).toHaveValue('08:15');
  // Typing in the field itself still works and the picker follows it.
  await field.fill('00:20');
  await page.getByRole('button', { name: '选择实际服药时间' }).click();
  await expect(popover.getByTestId('time-minutes').locator('[aria-selected="true"]')).toHaveText('20');
  await popover.getByRole('button', { name: '完成' }).click();
  await expect(popover).toBeHidden();
});

test('a chosen side-effect chip is a solid fill with a tick, clearly apart from the ones not chosen, and choosing it is animated', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const chips = page.getByTestId('wellbeing-dose-form').getByTestId('wellbeing-effect-chips');
  const chosen = chips.getByRole('button', { name: '头晕' }), other = chips.getByRole('button', { name: '恶心' });
  // The fill is a layer of its own that is closed to nothing until the chip is chosen, then runs in.
  const motion = (chip: import('@playwright/test').Locator) => chip.evaluate(el => { const layer = getComputedStyle(el, '::after'), tick = getComputedStyle(el, '::before'); return { fillScale: layer.scale, fillTime: layer.transitionDuration, tickTime: tick.transitionDuration, tickWidth: tick.width }; });
  const before = await motion(chosen);
  expect(before.fillScale).toMatch(/^0/);
  expect(before.tickWidth).toBe('0px');
  await chosen.click();
  await expect(chosen).toHaveAttribute('aria-pressed', 'true');
  // It springs (a class that restarts the keyframes) and its fill and tick are set to transition rather than jump.
  await expect(chosen).toHaveClass(/\bpop\b/);
  expect(parseFloat((await motion(chosen)).fillTime)).toBeGreaterThan(0.2);
  expect(parseFloat((await motion(chosen)).tickTime)).toBeGreaterThan(0.1);
  expect(await chosen.evaluate(el => getComputedStyle(el).animationName)).toContain('chip-pop');
  await settled(page);
  await expect.poll(async () => (await motion(chosen)).fillScale).toMatch(/^1/);
  const look = (chip: import('@playwright/test').Locator) => chip.evaluate(el => { const s = getComputedStyle(el), fill = getComputedStyle(el, '::after'), tick = getComputedStyle(el, '::before'); return { fill: fill.backgroundColor, ink: s.color, tickShown: tick.opacity === '1' && tick.width !== '0px' }; });
  // The chips are flat: no glass sheen (gradient or inset highlight) on the chosen or the other ones.
  for (const chip of [chosen, other]) expect(await chip.evaluate(el => { const style = getComputedStyle(el); return { image: style.backgroundImage, inset: /inset/.test(style.boxShadow) }; })).toEqual({ image: 'none', inset: false });
  const on = await look(chosen), off = await look(other);
  expect(on.fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(on.ink).not.toBe(off.ink);
  expect(on.tickShown).toBe(true);
  expect(off.tickShown).toBe(false);
  // ...but the tick is not part of the button's name (a screen reader hears "头晕, pressed").
  await expect(chips.getByRole('button', { name: '头晕', exact: true })).toHaveCount(1);
  // The fill and the white text are far enough apart to read (not white on white).
  const [r, g, b] = on.fill.match(/\d+/g)!.map(Number);
  expect(r + g + b).toBeLessThan(450);
  // Choosing it again takes it back.
  await chosen.click();
  await expect(chosen).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await motion(chosen)).fillScale).toMatch(/^0/);
  await expect.poll(async () => (await look(chosen)).tickShown).toBe(false);
});

test('the calendar picker has no hint line under it', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('group', { name: '总结范围' }).getByRole('button', { name: '自定义' }).click();
  await page.getByRole('button', { name: '选择开始日期' }).click();
  const calendar = page.getByRole('dialog', { name: '选择开始日期' });
  await expect(calendar).toBeVisible();
  await expect(calendar).not.toContainText('Esc 关闭');
  await expect(calendar.locator('.calendar-help')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
});

test('back-filling a dose on a past day asks for the time only and records it on that day', async ({ page }) => {
  await open(page);
  await page.getByTestId('wellbeing-tab-history').click();
  const past = new Date(Date.now() - 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  if (await page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`).count() === 0) await page.getByRole('button', { name: '上个月' }).click();
  await page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`).click();
  await expect(page.getByTestId('wellbeing-editor')).toHaveAttribute('data-day', past);
  await settled(page);
  await page.getByTestId('wellbeing-add-dose').click();
  const form = page.getByTestId('wellbeing-dose-form');
  // Another day starts at 08:00 (not "now") and names the day it is for.
  await expect(form.getByLabel('实际服药时间', { exact: true })).toHaveValue('08:00');
  await expect(page.locator('dialog[open]').getByText(/只需选时间/)).toContainText(String(+past.slice(8)));
  await form.getByLabel('药物名称').fill('示例药物');
  await form.getByLabel(/^吃了几/).fill('1');
  await form.getByLabel('实际服药时间', { exact: true }).fill('21:15');
  await form.getByRole('button', { name: '保存服药' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('wellbeing-dose')).toContainText('21:15');
  await expect(page.locator(`[data-testid="wellbeing-day"][data-date="${past}"]`)).toHaveAttribute('aria-label', /1 次服药/);
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
  // The days follow the chosen range: 7 or 14 days are a circle of slices, 30 a calendar, the latest day always last.
  await page.getByRole('button', { name: '近 14 天' }).click();
  await expect(days).toHaveCount(14);
  await expect(card.locator('.wheel svg.slices .slice')).toHaveCount(14);
  await expect(card.locator('.calendar')).toHaveCount(0);
  // Fourteen numbers fit round the circle without touching: each sits in its own slice.
  const numbers = await card.locator('.wheel .n').evaluateAll(els => els.map(el => el.getBoundingClientRect()));
  for (const [i, a] of numbers.entries()) for (const b of numbers.slice(i + 1)) expect(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1).toBe(true);
  await days.last().dispatchEvent('click');
  await expect(card.locator('.wheel .core')).toContainText('周');
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

test('report: the page is charts and cards with no tables; the print report is a separate paper layout; CSV download', async ({ page }) => {
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
  const dashboard = page.getByTestId('wellbeing-report-dashboard');
  await expect(dashboard).toBeVisible();
  // On screen there is no wall of text and no table: the paper report is not shown, and nothing on the page is a table apart from the chart's own data table.
  await expect(report).toBeHidden();
  await expect(page.getByTestId('report-toggle-text')).toHaveCount(0);
  await expect(dashboard.locator('table:visible')).toHaveCount(0);
  await expect(page.getByTestId('wellbeing-export')).toContainText('一份专门排好的报告');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '状态记录 CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^wellbeing-entries-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  // Printing: the application chrome, the charts and the form controls go; the paper report appears, as boxes rather than tables.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await expect(page.getByTestId('wellbeing-export')).toBeHidden();
  await expect(dashboard).toBeHidden();
  await expect(report).toBeVisible();
  await expect(report).toContainText('不构成诊断');
  await expect(page.getByTestId('report-coverage')).toContainText('7 天中有 1 天填写了状态记录，6 天没有');
  await expect(page.getByTestId('report-medication')).toContainText('示例药物');
  await expect(page.getByTestId('report-ratings')).toContainText('开心程度');
  await expect(page.getByTestId('report-sleep')).toContainText('平均 6 小时 30 分');
  await expect(report).not.toContainText('建议调整');
  await expect(report.locator('table')).toHaveCount(0);
  await page.emulateMedia({ media: 'screen' });
  await expect(report).toBeHidden();
});

test('summary: each medicine is a card: how many times, a strip of the days it was taken, and how the dose changed', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.evaluate(async () => {
    const csrf = (await (await fetch('/api/v1/auth/csrf')).json()).data.csrf_token;
    const date = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    // 丙药 changes amount on this day (2 instead of 1); 甲药 changed once earlier in the seed; 乙药 never.
    await fetch('/api/v1/me/wellbeing/doses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ medication_name: '丙药', pills: 1, taken_at: `${date}T07:00:00+08:00`, regimen: 'scheduled' }) });
    await fetch('/api/v1/me/wellbeing/doses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ medication_name: '丙药', pills: 2, taken_at: `${date}T19:00:00+08:00`, regimen: 'scheduled' }) });
  });
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 14 天' }).click();
  const cards = page.getByTestId('wellbeing-report-medicines').getByTestId('wellbeing-report-medicine');
  await expect(cards).toHaveCount(3);
  const a = page.locator('[data-medicine="甲药"]');
  await expect(a.locator('.big strong')).toHaveText('14');
  // A strip of the 14 days, lit where it was taken (every day for this one).
  await expect(a.locator('.strip .day')).toHaveCount(14);
  await expect(a.locator('.strip .day.lit')).toHaveCount(14);
  // The one that changed says from-what-to-what; the one that did not says so.
  const c = page.locator('[data-medicine="丙药"]');
  await expect(c.locator('.strip .day.changed')).toHaveCount(1);
  await expect(c.locator('.changes')).toContainText('→');
  await expect(page.locator('[data-medicine="乙药"] .changes')).toContainText('剂量没有变化');
  // One card holds them (heading and all); each medicine is a card inside it with a round badge, the name, a big figure and how it moved against the stretch before.
  await expect(page.getByTestId('wellbeing-report-medicines').locator('#meds-title')).toHaveText('服药');
  await expect(a.locator('.badge')).toBeVisible();
  await expect(a.locator('.delta')).toBeVisible();
  await expect(a.locator('.strip.dots')).toBeVisible();
  // A day it was taken and a day it was not look clearly apart: the first a big solid dot, the other a small pale one.
  const bQ = page.locator('[data-medicine="乙药"] .strip .day');
  const sizes = await bQ.evaluateAll(els => ({ on: Math.max(...els.filter(el => el.classList.contains('lit')).map(el => el.getBoundingClientRect().width)), off: Math.max(...els.filter(el => !el.classList.contains('lit')).map(el => el.getBoundingClientRect().width)) }));
  expect(sizes.on).toBeGreaterThanOrEqual(sizes.off * 2);
  const fills = await bQ.evaluateAll(els => ({ on: getComputedStyle(els.find(el => el.classList.contains('lit'))!).backgroundColor, off: getComputedStyle(els.find(el => !el.classList.contains('lit'))!).backgroundColor }));
  expect(fills.on).not.toBe(fills.off);
  await expect(page.getByTestId('wellbeing-report-medicines')).toContainText('这天没服药');
  // All the cards are the same width, three to a row on a wide screen, and have no table inside.
  const widths = await cards.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().width)));
  expect(new Set(widths).size).toBe(1);
  const tops = await cards.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
});

test('summary: 7 / 14 / 30 days or a custom range, charts first, the text folded away', async ({ page }) => {
  await open(page);
  await seed(page, 45);
  await page.getByTestId('wellbeing-tab-report').click();
  const tabs = page.getByRole('group', { name: '总结范围' });
  await expect(tabs.getByRole('button')).toHaveText(['近 7 天', '近 14 天', '近 30 天', '自定义']);
  await expect(tabs.getByRole('button', { name: '近 7 天' })).toHaveAttribute('aria-pressed', 'true');
  const dashboard = page.getByTestId('wellbeing-report-dashboard');
  await expect(page.getByTestId('wellbeing-report-summary')).toContainText('（7 天，');
  const cells = page.getByTestId('wellbeing-report-timeline').getByTestId('wellbeing-report-day');
  await expect(cells).toHaveCount(7);
  for (const [name, days] of [['近 14 天', 14], ['近 30 天', 30]] as const) {
    await tabs.getByRole('button', { name }).click();
    await expect(page.getByTestId('wellbeing-report-summary')).toContainText(`（${days} 天，`);
    await expect(cells).toHaveCount(days);
  }
  // A custom range asks for its two dates and is only fetched when applied.
  await tabs.getByRole('button', { name: '自定义' }).click();
  await expect(page.getByRole('button', { name: '查看', exact: true })).toBeVisible();
  await expect(cells).toHaveCount(30);
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByTestId('wellbeing-report-summary')).toContainText('（30 天，');
  await expect(dashboard).toBeVisible();
  // No more than one long text wall: the sheet stays folded.
  await expect(page.getByTestId('wellbeing-report')).toBeHidden();
});

test('summary: each measure is a widget with its figure, a small line and the move against the stretch before', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.getByTestId('wellbeing-tab-report').click();
  const measures = page.getByTestId('report-measures');
  // Six widgets: sleep hours and sleep quality are one widget, so the rows fill up exactly (3 + 3, 2 + 2 + 2 or one by one) at any width.
  await expect(measures.locator('[data-metric]')).toHaveCount(6);
  const sleepTile = page.getByTestId('report-measure-sleep');
  await expect(sleepTile).toContainText('小时');
  await expect(sleepTile.getByTestId('report-sleep-quality')).toContainText('睡眠质量');
  await expect(page.getByTestId('report-measure-sleep_hours')).toHaveCount(0);
  await expect(page.getByTestId('report-measure-sleep_quality')).toHaveCount(0);
  for (const width of [1440, 1100, 900, 700, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await settled(page);
    const rows = await measures.locator('[data-metric]').evaluateAll(els => { const tops = els.map(el => Math.round(el.getBoundingClientRect().top)); return [...new Set(tops)].map(top => tops.filter(t => t === top).length); });
    expect(new Set(rows).size, `rows at ${width}px: ${rows}`).toBe(1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const mood = page.getByTestId('report-measure-mood');
  await expect(mood.locator('.big strong')).toHaveText(/^\d(\.\d)?$/);
  await expect(mood.locator('svg.spark')).toBeVisible();
  await expect(mood.locator('.delta')).toBeVisible();
  // A measure nobody answered shows a dash and says so, not a 0.
  await expect(page.getByTestId('report-measure-focus').locator('.big strong')).toHaveText('—');
  await expect(page.getByTestId('report-measure-focus')).toContainText('没有注意力记录');
  await expect(page.getByTestId('report-stat-doses')).toContainText('甲药');
  await expect(page.getByTestId('report-stat-effects').locator('.big strong')).not.toHaveText('0');
  // Anxiety says which way is worse.
  await expect(page.getByTestId('report-measure-anxiety')).toContainText('越高越严重');
});

test('summary: a month-long range is a calendar of rings like the history page, and choosing a day shows its record beside it', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 30 天' }).click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  const days = chart.getByTestId('wellbeing-report-day');
  await expect(days).toHaveCount(30);
  // Each day is a round button with a ring of three parts: state, medication, side effect.
  const first = days.first();
  await expect(first.locator('circle.part')).toHaveCount(3);
  expect(await first.evaluate(el => getComputedStyle(el).borderRadius)).toBe('50%');
  const colours = await first.locator('circle.part').evaluateAll(parts => parts.map(part => (part as SVGElement).style.getPropertyValue('--part')));
  expect(colours).toEqual(['var(--well-mood)', 'var(--well-dose)', 'var(--well-effect)']);
  // The ring is lit where that kind of record exists: seeded doses every day, state on most days, side effects on some.
  await expect(chart.locator('[data-part="dose"].lit')).toHaveCount(14);
  const effectDays = await chart.locator('[data-part="symptom"].lit').count();
  expect(effectDays).toBeGreaterThan(0);
  expect(effectDays).toBeLessThan(14);
  // A day without a state record has that part of its ring dark.
  expect(await chart.locator('[data-part="entry"]:not(.lit)').count()).toBeGreaterThan(0);
  // The newest recorded day is chosen to begin with; its record is written beside the calendar.
  const detail = page.getByTestId('wellbeing-report-day-detail');
  await expect(days.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(detail).toContainText('甲药');
  // Choosing a day with a side effect names it, with the medicine it was written under.
  const withEffect = chart.locator('[data-testid="wellbeing-report-day"]:has([data-part="symptom"].lit)').first();
  await withEffect.click();
  await expect(withEffect).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
  await expect(detail).toContainText('副作用');
  await expect(detail.locator('.effects li')).toContainText(/恶心|头晕/);
  await expect(detail.locator('.effects li')).toContainText('甲药');
  // A day nobody answered says so rather than showing zeros.
  const empty = chart.locator('[data-testid="wellbeing-report-day"]:has([data-part="entry"]:not(.lit))').first();
  await empty.click();
  await settled(page);
  await expect(detail).toContainText('这天没有状态记录');
  // Every chart has its data table.
  await chart.getByText('查看这张图的逐日数据表').click();
  await expect(chart.locator('tbody tr')).toHaveCount(30);
});

test('summary: a week or a fortnight is one big circle of slices, the chosen day rolling in its middle', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.getByTestId('wellbeing-tab-report').click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  const detail = page.getByTestId('wellbeing-report-day-detail');
  for (const [name, count] of [['近 7 天', 7], ['近 14 天', 14]] as const) {
    await page.getByRole('button', { name }).click();
    const slices = chart.locator('.wheel .slice');
    await expect(slices).toHaveCount(count);
    await expect(chart.locator('.calendar')).toHaveCount(0);
    // Every slice carries the three marks (state, medication, side effect), lit where that record exists.
    await expect(slices.first().locator('circle.part')).toHaveCount(3);
    await expect(chart.locator('.wheel [data-part="dose"].lit')).toHaveCount(count);
    // The newest recorded day is chosen to begin with and named in the middle of the circle.
    await expect(slices.last()).toHaveAttribute('aria-pressed', 'true');
    await settled(page);
    const day = await slices.last().getAttribute('data-date');
    await expect(chart.locator('.core')).toContainText(String(+day!.slice(8)));
    // Choosing another slice rolls the middle to it and changes the record beside the circle; the keyboard works too.
    const other = slices.first();
    await other.focus();
    await page.keyboard.press('Enter');
    await expect(other).toHaveAttribute('aria-pressed', 'true');
    await expect(slices.last()).toHaveAttribute('aria-pressed', 'false');
    await settled(page);
    const date = await other.getAttribute('data-date');
    await expect(chart.locator('.core')).toContainText(String(+date!.slice(8)));
    await expect(detail).toContainText(`${+date!.slice(5, 7)} 月 ${+date!.slice(8)} 日`);
    // The slices are laid out round the middle, not in a row, and the numbers sit inside their slices.
    const spread = await chart.locator('.wheel .n').evaluateAll(els => { const rects = els.map(el => el.getBoundingClientRect()); return { xs: new Set(rects.map(r => Math.round(r.left / 8))).size, ys: new Set(rects.map(r => Math.round(r.top / 8))).size }; });
    expect(spread.xs).toBeGreaterThan(2);
    expect(spread.ys).toBeGreaterThan(2);
  }
  // A month goes back to calendars.
  await page.getByRole('button', { name: '近 30 天' }).click();
  await expect(chart.locator('.wheel')).toHaveCount(0);
  await expect(chart.locator('.calendar')).toHaveCount(1);
});

test('summary: the day panel keeps its size however many doses a day holds; the doses are a timeline that scrolls inside', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  // Two dozen more doses on yesterday, one every few minutes: more than the panel can show at once.
  await page.evaluate(async () => {
    const csrf = (await (await fetch('/api/v1/auth/csrf')).json()).data.csrf_token;
    const date = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    for (let i = 0; i < 24; i++) await fetch('/api/v1/me/wellbeing/doses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ medication_name: `乙药${i}`, pills: 1, taken_at: `${date}T12:${String(10 + i).padStart(2, '0')}:00+08:00`, regimen: 'as_needed' }) });
  });
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 14 天' }).click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  const panel = page.getByTestId('wellbeing-report-day-detail');
  const slices = chart.locator('.wheel .slice');
  await slices.first().click();
  await settled(page);
  const small = (await panel.boundingBox())!;
  await slices.nth(12).click();
  await settled(page);
  const timeline = page.getByTestId('wellbeing-report-dose-timeline');
  await expect(timeline.getByTestId('wellbeing-report-dose').nth(10)).toBeVisible();
  expect(await timeline.getByTestId('wellbeing-report-dose').count()).toBeGreaterThanOrEqual(11);
  const big = (await panel.boundingBox())!;
  // Same panel, same size: the long list scrolls inside its own section.
  expect(Math.abs(big.height - small.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(big.width - small.width)).toBeLessThanOrEqual(1);
  expect(await timeline.evaluate(el => ({ over: el.scrollHeight > el.clientHeight + 4, overflow: getComputedStyle(el).overflowY }))).toEqual({ over: true, overflow: 'auto' });
  expect(await panel.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  // In time order, each on the line: the times only go up.
  const times = await timeline.locator('.time').allTextContents();
  expect([...times].sort()).toEqual(times);
  await expect(timeline.locator('.node').first()).toBeVisible();
  await timeline.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await timeline.evaluate(el => { const box = el.getBoundingClientRect(), last = el.querySelector('li:last-child')!.getBoundingClientRect(); return last.bottom <= box.bottom + 1 && last.top >= box.top; })).toBe(true);
  // Narrow screens stack the panel under the circle at a fixed height too.
  await page.setViewportSize({ width: 390, height: 900 });
  await settled(page);
  const stacked = (await panel.boundingBox())!;
  await slices.first().click();
  await settled(page);
  expect(Math.abs((await panel.boundingBox())!.height - stacked.height)).toBeLessThanOrEqual(1);
});

test('summary: the day panel is filled: the answers as bars, the doses as a timeline beside them, side effects underneath', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 14 天' }).click();
  const panel = page.getByTestId('wellbeing-report-day-detail');
  await settled(page);
  // A day with answers: one bar per answer, in that answer's colour, as long as its value.
  const rows = panel.locator('.rows li');
  await expect(rows.first()).toBeVisible();
  const widths = await rows.evaluateAll(els => els.map(el => { const meter = el.querySelector('.meter')!.getBoundingClientRect(), fill = el.querySelector('.meter > span')!.getBoundingClientRect(); return fill.width / meter.width; }));
  expect(widths.every(w => w > 0 && w <= 1.001)).toBe(true);
  // The head says in the ring's three colours what the day holds.
  await expect(panel.locator('.tally li')).toHaveCount(3);
  await expect(panel.locator('.tally')).toContainText('服药');
  // Wide: the answers and the timeline sit side by side and the side effects under both; nothing is left over to the right.
  const boxes = await panel.evaluate(el => { const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect(), pane = box('.pane'), states = box('.states'), doses = box('.doses'), effects = box('.effects-box'); return { sideBySide: states.right <= doses.left + 1 && Math.abs(states.top - doses.top) < 2, below: effects.top >= Math.max(states.bottom, doses.bottom) - 1, spread: doses.right > pane.right - 40 }; });
  expect(boxes).toEqual({ sideBySide: true, below: true, spread: true });
  // A day without answers says so inside the bars' place.
  await page.getByRole('button', { name: '近 30 天' }).click();
  await settled(page);
  const empty = page.getByTestId('wellbeing-report-timeline').locator('[data-testid="wellbeing-report-day"]:has([data-part="entry"]:not(.lit))').first();
  await empty.click();
  await settled(page);
  await expect(panel.locator('.states .boxed')).toContainText('这天没有状态记录');
});

test('summary: a day with every answer and many side effects never overlaps: the answers scroll inside their own box like the doses', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const csrf = (await (await fetch('/api/v1/auth/csrf')).json()).data.csrf_token;
    const call = async (method: string, path: string, body: unknown) => (await (await fetch(`/api/v1/me/wellbeing${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })).json()).data;
    const date = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    await call('PUT', `/days/${date}/entry`, { mood: 5, anxiety: 5, energy: 4, focus: 7, functioning: 7, sleep_hours: 6.8, sleep_quality: 8 });
    const dose = await call('POST', '/doses', { medication_name: '甲药', pills: 1, taken_at: `${date}T07:35:00+08:00`, regimen: 'scheduled' });
    for (const name of ['困倦、嗜睡', '协调力下降', '头晕', '乏力', '恶心', '头痛', '心悸', '出汗', '失眠', '食欲变化', '坐立不安', '口干', '耳鸣', '胸闷']) await call('POST', '/symptoms', { entry_date: date, dose_id: dose.id, symptom: name, onset_at: null, duration_minutes: null, affects_daily_life: null });
  });
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 7 天' }).click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  await chart.locator('.wheel .slice').nth(5).click();
  await settled(page);
  for (const width of [1440, 1100, 1000, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await settled(page);
    const geo = await chart.evaluate(el => {
      const box = (node: Element) => node.getBoundingClientRect(), pane = el.querySelector('.pane')!, list = el.querySelector('[data-testid="wellbeing-report-state-list"]')!;
      const parts = [...pane.querySelectorAll('.cols > section, .effects-box, .when')].map(node => box(node));
      const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const rows = [...list.querySelectorAll('li')].map(node => box(node)), inList = box(list);
      return { scrolls: getComputedStyle(list).overflowY === 'auto', contained: pane.scrollHeight <= pane.clientHeight + 1, noSpill: parts.every((a, i) => parts.slice(i + 1).every(b => !overlap(a, b))), listInside: rows.length === 7 && inList.bottom <= box(el.querySelector('.effects-box')!).top + 1 };
    });
    expect(geo, `at ${width}px`).toEqual({ scrolls: true, contained: true, noSpill: true, listInside: true });
  }
  // Scrolled to the end, the last answer is reachable.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settled(page);
  const list = page.getByTestId('wellbeing-report-state-list');
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await list.evaluate(el => { const box = el.getBoundingClientRect(), last = el.querySelector('li:last-child')!.getBoundingClientRect(); return last.bottom <= box.bottom + 1 && last.top >= box.top; })).toBe(true);
});

test('summary: "剂量变化" is always on its own line under the text of its dose, starting in the same place', async ({ page }) => {
  await open(page);
  // One medicine taken yesterday with different amounts, so some doses differ from the one before.
  await page.evaluate(async () => {
    const csrf = (await (await fetch('/api/v1/auth/csrf')).json()).data.csrf_token;
    const call = async (path: string, body: unknown) => (await (await fetch(`/api/v1/me/wellbeing${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })).json()).data;
    const date = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const rows: [string, number, string][] = [['甲药', 1, '08:00'], ['乙药很长很长的名字用来把一行撑长', 1, '09:00'], ['乙药很长很长的名字用来把一行撑长', 2, '10:00'], ['乙药很长很长的名字用来把一行撑长', 1, '11:00'], ['甲药', 1, '12:00']];
    for (const [name, pills, at] of rows) await call('/doses', { medication_name: name, pills, taken_at: `${date}T${at}:00+08:00`, regimen: 'scheduled' });
  });
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 7 天' }).click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  await chart.locator('.wheel .slice').nth(5).click();
  await settled(page);
  const tags = chart.getByTestId('wellbeing-report-dose-timeline').locator('.tag');
  await expect(tags).toHaveCount(2);
  await expect(tags.first()).toHaveText('剂量变化');
  // The same left edge in every row, and below the line of text, never beside it.
  const placed = await tags.evaluateAll(els => els.map(el => { const row = el.closest('li')!, text = row.querySelector('strong')!.getBoundingClientRect(), tag = el.getBoundingClientRect(); return { left: Math.round(tag.left), below: tag.top >= text.bottom - 1, height: tag.height }; }));
  expect(new Set(placed.map(item => item.left)).size).toBe(1);
  expect(placed.every(item => item.below && item.height < 26)).toBe(true);
});

test('summary: at every width the circle stays in its own space, the record never covers it, and nothing in the panel spills over another', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 14 天' }).click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  for (const width of [1680, 1440, 1280, 1100, 1000, 900, 800, 700, 600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await settled(page);
    const geo = await chart.evaluate(el => {
      const box = (node: Element | null) => node!.getBoundingClientRect(), side = box(el.querySelector('.side')), wheel = box(el.querySelector('.wheel')), panel = box(el.querySelector('.detail')), pane = el.querySelector('.pane')!, parts = [...pane.querySelectorAll('.cols > section, .effects-box, .when')].map(node => box(node));
      const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      return {
        wheelInside: wheel.left >= side.left - 1 && wheel.right <= side.right + 1,
        apart: !overlap(wheel, panel),
        panelClean: pane.scrollHeight <= pane.clientHeight + 1,
        noSpill: parts.every((a, i) => parts.slice(i + 1).every(b => !overlap(a, b)))
      };
    });
    expect(geo, `at ${width}px`).toEqual({ wheelInside: true, apart: true, panelClean: true, noSpill: true });
  }
});

test('summary: a custom range of several months shows one month at a time and turns by swiping or the arrows', async ({ page }) => {
  await open(page);
  await seed(page, 45);
  await page.getByTestId('wellbeing-tab-report').click();
  const day = (offset: number) => new Date(Date.now() - offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  await page.getByRole('group', { name: '总结范围' }).getByRole('button', { name: '自定义' }).click();
  await page.getByLabel('开始日期', { exact: true }).fill(day(60));
  await page.getByLabel('结束日期', { exact: true }).fill(day(0));
  await page.getByRole('button', { name: '查看', exact: true }).click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  await expect(chart.getByTestId('wellbeing-report-day')).toHaveCount(61);
  const pager = chart.locator('.pager');
  await expect(pager).toHaveClass(/paged/);
  expect(await pager.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto');
  const months = await chart.locator('.month').count();
  expect(months).toBeGreaterThanOrEqual(3);
  // It opens on the newest month, with the arrow back enabled and the one forward not.
  const label = chart.getByTestId('wellbeing-report-month');
  const newest = await label.textContent();
  await expect(chart.getByTestId('wellbeing-report-next')).toBeDisabled();
  await expect(chart.getByTestId('wellbeing-report-prev')).toBeEnabled();
  const width = await pager.evaluate(el => el.clientWidth);
  expect(await pager.evaluate(el => Math.round(el.scrollLeft))).toBe((months - 1) * width);
  // The arrow turns a page; so does a swipe (a scroll of the row), snapping to a whole month.
  await chart.getByTestId('wellbeing-report-prev').click();
  await expect(label).not.toHaveText(newest!);
  await expect(chart.getByTestId('wellbeing-report-next')).toBeEnabled();
  await pager.evaluate((el, w) => { el.scrollTo({ left: 0, behavior: 'instant' }); void w; }, width);
  await expect(chart.getByTestId('wellbeing-report-prev')).toBeDisabled();
  await expect(label).not.toHaveText(newest!);
  // A day of an earlier month can be chosen and shows its record beside the calendar.
  await chart.locator('.month').first().getByTestId('wellbeing-report-day').last().click();
  await settled(page);
  await expect(page.getByTestId('wellbeing-report-day-detail')).toContainText('状态');
});

test('summary: the range is drawn as one calendar per month it touches', async ({ page }) => {
  await open(page);
  await seed(page, 45);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 30 天' }).click();
  const chart = page.getByTestId('wellbeing-report-timeline');
  await expect(chart.getByTestId('wellbeing-report-day')).toHaveCount(30);
  const spanned = new Set(Array.from({ length: 30 }, (_, i) => new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7))).size;
  await expect(chart.locator('.month')).toHaveCount(spanned);
  // Weeks start on Monday, like the history calendar.
  await expect(chart.locator('.weekday').first()).toHaveText('一');
});

test('summary: each side effect is one card of the same shape: its days as a bar, and the medicines it was written under', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 14 天' }).click();
  const rows = page.getByTestId('wellbeing-effect-ranking').getByTestId('wellbeing-effect-row');
  // Most days first.
  await expect(rows.first()).toContainText('恶心');
  await expect(rows.first()).toContainText('天');
  await expect(rows.first().locator('.fill')).toBeVisible();
  // Under it, the medicine it was written for, with how often.
  await expect(rows.first().locator('.under .chip')).toContainText('甲药');
  await expect(rows.first().locator('.under .chip strong')).toContainText('×');
  // All the cards are the same width and their text the same size, so the list reads evenly.
  const look = await rows.evaluateAll(els => els.map(el => ({ width: Math.round(el.getBoundingClientRect().width), name: getComputedStyle(el.querySelector('.name')!).fontSize, chip: getComputedStyle(el.querySelector('.chip')!).fontSize })));
  expect(new Set(look.map(item => item.width)).size).toBe(1);
  expect(new Set(look.map(item => item.name)).size).toBe(1);
  expect(new Set(look.map(item => item.chip)).size).toBe(1);
  // Three to a row on a wide screen (the first three share one line), and the cards are not stretched wider than a third.
  const tops = await rows.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
  expect(tops.slice(0, 3).every(top => top === tops[0])).toBe(true);
  // It is only the order of what was written, and the page says so.
  await expect(page.getByTestId('wellbeing-report-effects')).toContainText('不代表是这种药引起的');
});

test('summary: side effects and notes share one row when there is room (side effects wider), and stack when there is not', async ({ page }) => {
  await open(page);
  await seed(page, 14);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 14 天' }).click();
  const effects = page.getByTestId('wellbeing-report-effects'), notes = page.getByTestId('report-notes');
  await expect(notes).toBeVisible();
  await settled(page);
  const rects = async () => ({ effects: (await effects.boundingBox())!, notes: (await notes.boundingBox())! });
  let { effects: e, notes: n } = await rects();
  expect(Math.abs(e.y - n.y)).toBeLessThanOrEqual(1); // the same row
  expect(e.x + e.width).toBeLessThanOrEqual(n.x + 1);   // side effects on the left
  expect(e.width).toBeGreaterThan(n.width);              // and the wider
  expect(Math.abs(e.height - n.height)).toBeLessThanOrEqual(1); // as tall as each other
  // Both have a heading of the same size as the other sections'.
  const sizes = await page.evaluate(() => ['#effects-title', '#notes-title', '#meds-title'].map(sel => getComputedStyle(document.querySelector(sel)!).fontSize));
  expect(new Set(sizes).size).toBe(1);
  // Too narrow for two columns: one under the other.
  await page.setViewportSize({ width: 900, height: 1000 });
  await settled(page);
  ({ effects: e, notes: n } = await rects());
  expect(n.y).toBeGreaterThanOrEqual(e.y + e.height - 1);
  expect(Math.abs(e.x - n.x)).toBeLessThanOrEqual(1);
});

test('summary: notes are a dated list, newest first, long ones fold and unfold', async ({ page }) => {
  await open(page);
  await seed(page, 30);
  await page.getByTestId('wellbeing-tab-report').click();
  await page.getByRole('button', { name: '近 30 天' }).click();
  const notes = page.getByTestId('report-notes');
  await expect(notes.locator('li')).toHaveCount(4);
  await expect(notes.getByRole('button', { name: '显示全部 6 条' })).toBeVisible();
  // The newest note is the short one and has nothing to unfold; the long one next to it does.
  await expect(notes.locator('li').first()).toContainText('短备注');
  await expect(notes.locator('li').first().getByRole('button')).toHaveCount(0);
  const second = notes.locator('li').nth(1).locator('p');
  expect(await second.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await notes.locator('li').nth(1).getByRole('button', { name: '展开' }).click();
  expect(await second.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await notes.locator('li').nth(1).getByRole('button', { name: '收起' }).click();
  await notes.getByRole('button', { name: '显示全部 6 条' }).click();
  await expect(notes.locator('li')).toHaveCount(6);
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
  await expect(dose.getByRole('radio', { name: '常规用药' })).toBeChecked();
  await expect(page.getByTestId('wellbeing-dose-converted')).toContainText('约合 12.5 mg');
  await dose.getByLabel(/^吃了几/).fill('1.5');
  await expect(page.getByTestId('wellbeing-dose-converted')).toContainText('约合 18.75 mg');
  await dose.getByRole('button', { name: '保存服药' }).click();
  await expect(page.getByTestId('wellbeing-dose')).toContainText('米那普仑 · 1.5 颗（18.75 mg）');
  await page.getByTestId('wellbeing-add-dose').click();
  await dose.getByTestId('wellbeing-dose-meds').getByRole('button', { name: '奥沙西泮', exact: true }).click();
  await expect(dose.getByRole('radio', { name: '按需用药' })).toBeChecked();
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
  // The × sits inside the tag as a plain round button: no glass disc or shadow of its own.
  const cross = form.getByTestId('wellbeing-effect-tag').first().getByRole('button');
  expect(await cross.evaluate(el => { const s = getComputedStyle(el), layer = el.querySelector('.rn-glass-surface'); return { bg: s.backgroundColor, shadow: s.boxShadow, round: s.borderRadius, layer: layer ? getComputedStyle(layer).display : 'none' }; })).toEqual({ bg: 'rgba(0, 0, 0, 0)', shadow: 'none', round: '50%', layer: 'none' });
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
