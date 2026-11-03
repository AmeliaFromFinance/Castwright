import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProviders } from '../providers';

const screens = join(dirname(fileURLToPath(import.meta.url)), '__screens__');

interface Pkg {
  kind: string;
  version: number;
  actions: Array<{ id: string; name: string; graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } }>;
  variables: Array<{ name: string; default: unknown; secret: boolean }>;
  refs: Array<Record<string, string>>;
}

let errors: string[] = [];

test.beforeAll(() => {
  mkdirSync(screens, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().includes('[svelte]'))) errors.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await stubProviders(page);
  await page.goto('/?demo=static');
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Automation' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Automation' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors, 'no page or console errors').toEqual([]);
});

const row = (page: Page, name: string) => page.getByRole('navigation', { name: 'Actions' }).locator('li').filter({ hasText: name });

async function download(page: Page, start: () => Promise<void>): Promise<Pkg> {
  const [file] = await Promise.all([page.waitForEvent('download'), start()]);
  return JSON.parse(readFileSync((await file.path())!, 'utf8')) as Pkg;
}

/** As if the file came from another project: it also shows a layer and plays a sound we don't have. */
function fromElsewhere(pkg: Pkg): Pkg {
  const a = pkg.actions[0]!;
  const last = a.graph.nodes[a.graph.nodes.length - 1]!;
  const y = Number(last.y);
  const node = (id: string, dy: number, step: Record<string, unknown>) => ({ id, x: last.x, y: y + dy, kind: { type: 'step', step } });
  a.graph.nodes.push(
    node('n-layer', 136, { type: 'set_layer_visible', overlay_id: 'x-main', layer_id: 'x-chat', state: 'on' }),
    node('n-sound', 272, { type: 'play_sound', src: 'assets/airhorn.mp3', volume: 80 })
  );
  const edge = (id: string, from: string, to: string) => ({ id, from, from_side: 'bottom', to, to_side: 'top', branch: 'next' });
  a.graph.edges.push(edge('e-1', String(last.id), 'n-layer'), edge('e-2', 'n-layer', 'n-sound'));
  pkg.refs.push(
    { kind: 'layer', id: 'x-chat', name: 'Chat', overlay_id: 'x-main', overlay_name: 'Main' },
    { kind: 'asset', id: 'airhorn.mp3', name: 'airhorn.mp3', overlay_id: '', overlay_name: '' }
  );
  return pkg;
}

test('exports an action and imports it with a conflict and a missing reference', async ({ page }, info) => {
  await row(page, 'Count deaths').click({ button: 'right' });
  const pkg = await download(page, () => page.getByRole('menuitem', { name: 'Export…' }).click());
  expect(pkg.kind).toBe('castwright-actions');
  expect(pkg.version).toBe(1);
  expect(pkg.actions.map((a) => a.name)).toEqual(['Count deaths']);
  expect(pkg.variables).toEqual([{ name: 'counter.deaths', default: 0, secret: false }]);

  const file = info.outputPath('count-deaths.cwactions');
  writeFileSync(file, JSON.stringify(fromElsewhere(pkg)));
  await page.getByLabel('Actions file to import').setInputFiles(file);

  const dlg = page.getByRole('dialog', { name: 'Import actions' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('note')).toContainText('start turned off');
  await expect(dlg.getByText('Name taken')).toBeVisible();
  const layer = dlg.getByLabel('Link layer “Chat”');
  const sound = dlg.getByLabel('Link file “airhorn.mp3”');
  await expect(layer.locator('option:checked')).toHaveText('Gameplay HUD › Chat');
  await expect(sound.locator('option:checked')).toHaveText('Leave unlinked');
  await expect(dlg.getByText("Steps using it won't work until you link it.")).toHaveCount(1);
  await expect(dlg.getByText('1 unlinked')).toBeVisible();
  // The flow preview shows the steps.
  await expect(dlg.getByRole('img', { name: 'Preview of the flow' })).toContainText('Show “Chat” in Main');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screens, 'import-actions.png') });

  await dlg.getByLabel('When “Count deaths” already exists').selectOption('replace');
  await sound.selectOption('fanfare.ogg');
  await expect(dlg.getByText('1 unlinked')).toHaveCount(0);
  await expect(dlg.getByText("Steps using it won't work until you link it.")).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Import 1 action' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText('1 replaced')).toBeVisible();

  await expect(row(page, 'Count deaths')).toHaveCount(1);
  await expect(row(page, 'Count deaths').getByRole('switch')).not.toBeChecked();
  await expect(page.getByLabel('Action name')).toHaveValue('Count deaths');
  await expect(page.locator('[data-node]', { hasText: 'in Gameplay HUD' })).toBeVisible();
  await expect(page.locator('[data-node]', { hasText: 'fanfare.ogg' })).toBeVisible();
});

test('imports a dropped file and keeps both copies', async ({ page }) => {
  await page.getByLabel('Action name').waitFor();
  await row(page, '!so').click();
  const pkg = await download(page, () => page.getByRole('button', { name: 'Export action' }).click());

  const area = page.getByRole('region', { name: 'Automation' });
  const data = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'so.cwactions', { type: 'application/json' }));
    return dt;
  }, JSON.stringify(pkg));
  await area.dispatchEvent('dragover', { dataTransfer: data });
  await expect(page.getByText('Drop to import actions')).toBeVisible();
  await area.dispatchEvent('drop', { dataTransfer: data });

  const dlg = page.getByRole('dialog', { name: 'Import actions' });
  await expect(dlg).toContainText('so.cwactions');
  await expect(dlg.getByLabel('When “!so” already exists')).toHaveValue('keep_both');
  await dlg.getByRole('button', { name: 'Import 1 action' }).click();
  await expect(row(page, '!so (2)')).toHaveCount(1);
  await expect(row(page, '!so (2)').getByRole('switch')).not.toBeChecked();
  await expect(page.getByLabel('Action name')).toHaveValue('!so (2)');
});

test('exports picked actions and whole groups, and refuses newer files', async ({ page }, info) => {
  await row(page, '!uptime').getByRole('button').first().click();
  await row(page, 'Count deaths').getByRole('button').first().click({ modifiers: ['ControlOrMeta'] });
  const bar = page.getByRole('toolbar', { name: 'Picked actions' });
  await expect(bar).toContainText('2 picked');
  const two = await download(page, () => bar.getByRole('button', { name: 'Export…' }).click());
  expect(two.actions.map((a) => a.name)).toEqual(['!uptime', 'Count deaths']);
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();

  await page.getByText('Chat commands', { exact: true }).hover();
  await page.getByRole('button', { name: 'More for Chat commands' }).click();
  const group = await download(page, () => page.getByRole('menuitem', { name: 'Export group…' }).click());
  expect(group.actions.map((a) => a.name)).toEqual(['!uptime', '!so', 'Count deaths']);

  const newer = info.outputPath('newer.cwactions');
  writeFileSync(newer, JSON.stringify({ ...group, version: 99 }));
  await page.getByLabel('Actions file to import').setInputFiles(newer);
  await expect(page.getByText('exported by a newer version of Castwright')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Import actions' })).toBeHidden();
});
