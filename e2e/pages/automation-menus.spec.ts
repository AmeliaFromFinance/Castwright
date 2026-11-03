import { expect, test, type Locator, type Page } from '@playwright/test';
import { STEP_GROUPS, STEP_LABELS } from '../../src/lib/pages/automation/defaults';
import { stubProviders } from '../providers';

async function open(page: Page, action = /^Count deaths/): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static');
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await page.getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: action }).click();
  await expect(page.locator('[data-node]').first()).toBeVisible();
  return errors;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Add to the flow' });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const canvas = (page: Page) => page.getByRole('region', { name: /^Flow of/ });

/** DOM changes on the canvas over `ms`; a settled canvas makes none. */
async function churn(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (ms) =>
      new Promise<number>((done) => {
        let n = 0;
        const mo = new MutationObserver((list) => (n += list.length));
        mo.observe(document.querySelector('.flow')!, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => {
          mo.disconnect();
          done(n);
        }, ms);
      }),
    ms
  );
}

async function expectAdded(page: Page, picker: Locator, title: string) {
  await expect(picker).toBeHidden();
  const sel = page.locator('[data-node][aria-pressed="true"]');
  await expect(sel).toHaveCount(1);
  await expect(sel.locator('.title')).toHaveText(title);
  await expect(inspector(page)).toBeVisible();
}

test('automation menus: If from the bar works with two chat commands', async ({ page }) => {
  const errors = await open(page);
  // A second command trigger used to list condition fields twice and break the If inspector.
  await bar(page).getByRole('button', { name: 'Add trigger' }).click();
  await page.getByRole('listbox', { name: 'Add a trigger' }).getByRole('option', { name: /^Chat command/ }).click();
  await page.keyboard.press('Escape');

  await bar(page).getByRole('button', { name: 'Logic' }).click();
  const picker = page.getByRole('listbox', { name: 'Add a step' });
  await picker.getByRole('option', { name: /^If/ }).click();
  await expectAdded(page, picker, 'If');
  await expect(inspector(page).getByText('Only if')).toBeVisible();

  // The canvas still answers: a click clears the selection, a click on the If opens it again.
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
  await expect(inspector(page)).toBeHidden();
  const ifCard = page.locator('[data-node-wrap]').filter({ has: page.locator('.title', { hasText: /^If$/ }) });
  await ifCard.locator('.title').click();
  await expect(inspector(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('automation menus: every bar item adds its node', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await open(page);
  const picker = page.getByRole('listbox', { name: 'Add a step' });
  for (const g of STEP_GROUPS) {
    for (const [type] of g.items) {
      await bar(page).getByRole('button', { name: g.label, exact: true }).click();
      await picker.getByRole('option', { name: new RegExp(`^${escape(STEP_LABELS[type])}`) }).first().click();
      await expectAdded(page, picker, STEP_LABELS[type]);
      expect(errors, `${g.label} → ${STEP_LABELS[type]}`).toEqual([]);
    }
  }
  const triggers = page.getByRole('listbox', { name: 'Add a trigger' });
  await bar(page).getByRole('button', { name: 'Add trigger' }).click();
  await triggers.getByRole('option', { name: /^Timer/ }).click();
  await expectAdded(page, triggers, 'Timer');

  // Nothing keeps re-rendering once a node is in.
  await page.waitForTimeout(400);
  expect(await churn(page, 800)).toBeLessThan(5);
  expect(errors).toEqual([]);
});

/** A point on empty canvas, in window pixels. */
async function emptySpot(page: Page) {
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + 120, y: box.y + box.height - 220 };
}

/** Screen point part way along a line. */
async function alongEdge(edge: Locator, t = 0.5) {
  return edge.locator('.line').evaluate((el, t) => {
    const p = el as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() * t);
    const m = p.getScreenCTM()!;
    return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
  }, t);
}

const card = (page: Page, text: string | RegExp) => page.locator('[data-node]', { hasText: text });
const wrapOf = (page: Page, text: string | RegExp) => page.locator('[data-node-wrap]').filter({ has: card(page, text) });

test('automation menus: right-click the canvas and search', async ({ page }) => {
  const errors = await open(page);
  const spot = await emptySpot(page);
  // Where the pointer is in the flow, before the inspector opens and pans the view.
  const want = await canvas(page).evaluate((el, p) => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec((el.querySelector('.world') as HTMLElement).style.transform)!;
    const r = el.getBoundingClientRect();
    const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { x: (p.x - r.left - x) / z, y: (p.y - r.top - y) / z };
  }, spot);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  const menu = page.getByRole('dialog', { name: 'Canvas' });
  const search = menu.getByRole('combobox');
  await expect(search).toBeFocused();
  for (const name of ['Add note', 'Add frame', 'Select all', 'Tidy up', 'Fit to view']) await expect(menu.getByRole('option', { name })).toBeVisible();

  await search.fill('chat');
  const first = menu.getByRole('option').first();
  await expect(first).toContainText('Send chat message');
  await expect(search).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);
  await search.press('ArrowDown');
  await search.press('ArrowUp');
  await search.press('Enter');
  await expect(menu).toBeHidden();

  // The new node sits at the pointer, selected and open in the inspector.
  const added = page.locator('[data-node][aria-pressed="true"]');
  await expect(added.locator('.title')).toHaveText('Send chat message');
  await expect(inspector(page)).toBeVisible();
  const wrap = page.locator(`[data-node-wrap="${await added.getAttribute('data-node')}"]`);
  expect(Math.abs(Number(await wrap.getAttribute('data-x')) + 140 - want.x)).toBeLessThanOrEqual(16);
  expect(Math.abs(Number(await wrap.getAttribute('data-y')) + 48 - want.y)).toBeLessThanOrEqual(16);

  // It's at the top of the list next time.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await expect(menu.getByRole('group', { name: 'Recent' }).getByRole('option').first()).toContainText('Send chat message');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('automation menus: node menu inserts a step after it', async ({ page }) => {
  const errors = await open(page);
  const chat = wrapOf(page, 'Send chat message');
  const chatId = (await chat.getAttribute('data-node-wrap'))!;
  await card(page, 'Send chat message').locator('.title').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Node' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  for (const name of ['Open in inspector', 'Duplicate', 'Copy', 'Group in frame', 'Disconnect all', 'Delete']) await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Insert step after…' }).click();

  const picker = page.getByRole('dialog', { name: 'Add a step' });
  await expect(picker).toContainText('After Send chat message');
  await picker.getByRole('combobox').fill('log');
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  const log = page.locator('[data-node][aria-pressed="true"]');
  await expect(log.locator('.title')).toHaveText('Log');
  const logId = (await log.getAttribute('data-node'))!;
  await expect(page.locator(`[data-edge][data-from="${chatId}"][data-to="${logId}"]`)).toHaveCount(1);

  // Disconnect all takes the new line away again.
  await log.locator('.title').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Node' }).getByRole('menuitem', { name: 'Disconnect all' }).click();
  await expect(page.locator(`[data-edge][data-to="${logId}"]`)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('automation menus: line menu inserts a step on the line', async ({ page }) => {
  const errors = await open(page);
  const edge = page.locator('[data-edge]').first();
  const [from, to] = [(await edge.getAttribute('data-from'))!, (await edge.getAttribute('data-to'))!];
  const p = await alongEdge(edge, 0.3);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Line' });
  await expect(menu.getByRole('menuitem', { name: 'Delete line' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Insert step here…' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a step' });
  await picker.getByRole('combobox').fill('wait');
  await page.keyboard.press('Enter');

  const wait = page.locator('[data-node][aria-pressed="true"]');
  await expect(wait.locator('.title')).toHaveText('Wait');
  const id = (await wait.getAttribute('data-node'))!;
  await expect(page.locator(`[data-edge][data-from="${from}"][data-to="${to}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-edge][data-from="${from}"][data-to="${id}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-edge][data-from="${id}"][data-to="${to}"]`)).toHaveCount(1);

  // Lines from an If can switch branch from the menu.
  await bar(page).getByRole('button', { name: 'Logic' }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^If/ }).click();
  const ifId = (await page.locator('[data-node][aria-pressed="true"]').getAttribute('data-node'))!;
  await bar(page).getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a step' }).getByRole('option', { name: /^Send chat message/ }).click();
  const branchLine = page.locator(`[data-edge][data-from="${ifId}"]`);
  await expect(branchLine).toHaveAttribute('data-branch', 'then');
  await page.keyboard.press('Escape');
  await page.locator(`[data-chip-edge="${await branchLine.getAttribute('data-edge')}"]`).click({ button: 'right' });
  const lineMenu = page.getByRole('menu', { name: 'Line' });
  await expect(lineMenu.getByRole('menuitemradio', { name: 'Then' })).toHaveAttribute('aria-checked', 'true');
  await lineMenu.getByRole('menuitemradio', { name: 'Otherwise' }).click();
  await expect(branchLine).toHaveAttribute('data-branch', 'otherwise');
  expect(errors).toEqual([]);
});

test('automation menus: close on outside click, Esc and scroll; keyboard opens them', async ({ page }) => {
  const errors = await open(page);
  const spot = await emptySpot(page);
  const menu = page.getByRole('dialog', { name: 'Canvas' });

  // Esc closes and gives focus back to the canvas.
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(canvas(page)).toBeFocused();

  // A click outside only closes it.
  await card(page, 'Send chat message').locator('.title').click();
  await expect(inspector(page)).toBeVisible();
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.mouse.click(spot.x + 300, spot.y - 100);
  await expect(menu).toBeHidden();
  await expect(inspector(page)).toBeVisible();
  await page.mouse.click(spot.x + 300, spot.y - 100);
  await expect(inspector(page)).toBeHidden();

  // Scrolling the canvas closes it too.
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.mouse.move(spot.x + 300, spot.y - 100);
  await page.mouse.wheel(0, 120);
  await expect(menu).toBeHidden();

  // So does leaving the window.
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(menu).toBeHidden();

  // Node menu: closes on outside click and Esc.
  await card(page, 'Send chat message').locator('.title').click({ button: 'right' });
  const node = page.getByRole('menu', { name: 'Node' });
  await expect(node).toBeVisible();
  await page.mouse.click(spot.x, spot.y);
  await expect(node).toBeHidden();
  await card(page, 'Send chat message').locator('.title').click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(node).toBeHidden();

  // Shift+F10 opens the selection's menu; A and / open the search.
  await card(page, 'Send chat message').focus();
  await page.keyboard.press('Shift+F10');
  await expect(node).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.move(spot.x, spot.y);
  await page.keyboard.press('a');
  await expect(menu.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});
