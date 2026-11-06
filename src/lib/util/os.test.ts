import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const desktop = vi.hoisted(() => ({ on: false, openUrl: vi.fn(async (_url: string) => {}) }));
vi.mock('$lib/api/backend', () => ({ isTauri: () => desktop.on }));
vi.mock('$lib/api', () => ({ api: { openLink: desktop.openUrl } }));

import { handleExternalLinks, openExternal } from './os';

describe('openExternal', () => {
  let open: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockImplementation(() => null);
    desktop.openUrl.mockClear();
  });
  afterEach(() => {
    open.mockRestore();
    desktop.on = false;
  });

  it('asks the app to open it in the desktop app', async () => {
    desktop.on = true;
    await openExternal('https://castwright.sinist3r.lol/changelog/');
    expect(desktop.openUrl).toHaveBeenCalledWith('https://castwright.sinist3r.lol/changelog/');
    expect(open).not.toHaveBeenCalled();
  });

  it('uses window.open in the browser', async () => {
    await openExternal('https://github.com/AmeliaFromFinance/castwright');
    expect(open).toHaveBeenCalledWith('https://github.com/AmeliaFromFinance/castwright', '_blank', 'noopener');
    expect(desktop.openUrl).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a web address', async () => {
    desktop.on = true;
    await openExternal('javascript:alert(1)');
    await openExternal('file:///etc/passwd');
    expect(desktop.openUrl).not.toHaveBeenCalled();
  });

  it("doesn't throw when it can't be opened", async () => {
    desktop.on = true;
    desktop.openUrl.mockRejectedValueOnce(new Error('not allowed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(openExternal('https://example.com')).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('handleExternalLinks', () => {
  it('opens web links and leaves the rest alone', async () => {
    desktop.on = true;
    desktop.openUrl.mockClear();
    const root = document.createElement('div');
    root.innerHTML = '<a id="web" href="https://example.com/a" target="_blank"><b>docs</b></a><a id="local" href="#top">top</a>';
    document.body.append(root);
    const stop = handleExternalLinks(root);

    const web = new MouseEvent('click', { bubbles: true, cancelable: true });
    root.querySelector('b')!.dispatchEvent(web);
    expect(web.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(desktop.openUrl).toHaveBeenCalledWith('https://example.com/a'));

    const local = new MouseEvent('click', { bubbles: true, cancelable: true });
    root.querySelector('#local')!.dispatchEvent(local);
    expect(local.defaultPrevented).toBe(false);

    stop();
    root.remove();
    desktop.on = false;
  });
});
