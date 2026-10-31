import { expect, type Locator, type Page } from '@playwright/test';

/** Desktop: opens the goal popover from the progress ring. Mobile (ring hidden): the goal is already inline in the menu. */
export async function openGoalPanel(page: Page): Promise<Locator> {
  // The goal container renders only after hydration and identity check; isVisible() below does not wait.
  await page.locator('.app-sidebar .goal-container:not([hidden])').waitFor({ state: 'attached' });
  const trigger = page.locator('.app-sidebar .goal-container .anchored-trigger');
  if (await trigger.isVisible()) {
    // Only the popover's own state tells whether a click would open or close it (aria-expanded follows the asynchronous toggle event).
    const isOpen = await trigger.evaluate(el => document.getElementById(el.getAttribute('aria-controls')!)!.matches(':popover-open'));
    if (!isOpen) await trigger.click();
  }
  const region = page.getByRole('region', { name: '跑量目标' });
  await expect(region).toBeVisible();
  // The popover scales in from the ring: measure it only once that has settled (a floating bar is busy building its glass, which delays the first frames).
  await region.evaluate(el => Promise.all((el.closest('.anchored-panel') ?? el).getAnimations().map(animation => animation.finished.catch(() => undefined))));
  return region;
}

/** Desktop: opens the avatar menu. Mobile: the inline account block is already in the opened menu. */
export async function openAccountMenu(page: Page): Promise<Locator> {
  // The logout button is disabled until the page has hydrated. Opening earlier would race with hydration's afterNavigate, which closes the menu again; isVisible() below does not wait.
  await expect(page.locator('.account-menu-host button.rn-menu-option, .account-inline .account-logout').first()).toBeEnabled();
  const trigger = page.locator('.account-menu-host .anchored-trigger');
  if (await trigger.isVisible()) {
    const menu = page.getByRole('group', { name: '账户' });
    // aria-expanded follows the asynchronous toggle event and a closing menu is still visible: only the popover's own state tells whether another click would open or close it.
    const isOpen = await trigger.evaluate(el => document.getElementById(el.getAttribute('aria-controls')!)!.matches(':popover-open'));
    if (!isOpen) await trigger.click();
    await expect(menu).toBeVisible();
    return menu;
  }
  return page.locator('.account-inline');
}
export async function settingsLink(page: Page): Promise<Locator> {
  return (await openAccountMenu(page)).getByRole('link', { name: '设置', exact: true });
}
