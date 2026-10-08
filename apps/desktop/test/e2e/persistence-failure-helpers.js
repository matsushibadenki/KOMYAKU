import { expect } from '@playwright/test';
export const draftKey = 'komyaku:local-draft:00000000-0000-4000-8000-000000000001';
const runtimeErrors = new WeakMap();
export async function failDraftWrites(page) {
  await expect(page).toHaveTitle('KOMYAKU');
  await expect(page).toHaveURL('http://127.0.0.1:1420/');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  runtimeErrors.set(page, errors);
  const before = await page.evaluate(key => localStorage.getItem(key), draftKey);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreDraftWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('komyaku:local-draft:')) throw new DOMException('Injected storage failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await editor.press('End');
  await editor.pressSequentially(' N0-failure-日本語-English-简体中文');
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'error');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe(before);
  await page.evaluate(() => window.restoreDraftWrites());
  return { before, editor };
}
export async function verifyBlockedThenRetry(page, before, editor) {
  await expect(editor).toContainText('N0-failure-日本語-English-简体中文');
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'error');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe(before);
  expect(runtimeErrors.get(page)).toEqual([]);
  await page.locator('.app-footer').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/komyaku-n0-blocked.png' });
  await page.getByRole('button', { name: 'ローカル保存を再試行' }).click();
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect(page.locator('.ProseMirror').first()).toContainText('N0-failure-日本語-English-简体中文');
}
