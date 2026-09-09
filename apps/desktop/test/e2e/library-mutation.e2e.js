import { expect, test } from '@playwright/test';

async function openLibrary(page) {
  await page.route('**/src/services/local-document-library.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      const document = { documentId: '00000000-0000-4000-8000-000000000001',
        title: 'QA document', defaultLanguage: 'ja', localRevision: 1, archivedAt: null };
      window.libraryMutations = [];
      export const listLocalDocuments = async () => {
        const snapshot = [structuredClone(document)];
        if (window.holdNextLibraryRead) {
          window.holdNextLibraryRead = false;
          await new Promise((resolve, reject) => {
            window.resumeOldLibraryRead = () => window.rejectOldLibraryRead ? reject(new Error('old list failed')) : resolve();
          });
        }
        return snapshot;
      };
      export const mutateLocalDocument = async input => {
        window.libraryMutations.push(input);
        if (window.holdLibraryMutation) await new Promise((resolve, reject) => {
          window.resumeLibraryMutation = () => window.failLibraryMutation ? reject(new Error('injected failure')) : resolve();
        });
        document.archivedAt = input.archived ? '2026-09-09T00:00:00Z' : null;
        return structuredClone(document);
      };
    `
  }));
  await page.goto('/');
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('.document-library-list li')).toHaveCount(1);
}

for (const failed of [false, true]) {
  test(`archive ${failed ? 'failure' : 'success'} releases the mutation gate`, async ({ page }) => {
    await openLibrary(page);
    await page.evaluate(failed => { window.holdLibraryMutation = true; window.failLibraryMutation = failed; }, failed);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.resumeLibraryMutation)).toBe('function');
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    // Direct DOM dispatch models an already-queued second action despite inert.
    await page.getByRole('button', { name: 'Archive', exact: true }).dispatchEvent('click');
    await page.getByRole('button', { name: '名前を変更', exact: true }).dispatchEvent('click');
    expect(await page.evaluate(() => window.libraryMutations.length)).toBe(1);
    await page.evaluate(() => window.resumeLibraryMutation());
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
    await expect(page.locator('.document-library-list li')).toHaveAttribute('data-archived', String(!failed));
    if (failed) {
      await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'error');
      await page.evaluate(() => { window.holdLibraryMutation = false; window.failLibraryMutation = false; });
      await page.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect(page.locator('.document-library-list li')).toHaveAttribute('data-archived', 'true');
      expect(await page.evaluate(() => window.libraryMutations.length)).toBe(2);
    }
  });
}

test('composition prevents archiving until it ends', async ({ page }) => {
  await openLibrary(page);
  await page.locator('.ProseMirror').dispatchEvent('compositionstart');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  expect(await page.evaluate(() => window.libraryMutations)).toEqual([]);
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await page.locator('.ProseMirror').dispatchEvent('compositionend');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.document-library-list li')).toHaveAttribute('data-archived', 'true');
});

for (const rejected of [false, true]) {
  test(`late library ${rejected ? 'failure' : 'success'} does not undo Archive feedback`, async ({ page }) => {
    await openLibrary(page);
    await page.evaluate(rejected => {
      window.holdNextLibraryRead = true;
      window.rejectOldLibraryRead = rejected;
    }, rejected);
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' list-refresh-marker');
    await expect.poll(() => page.evaluate(() => typeof window.resumeOldLibraryRead)).toBe('function');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.locator('.document-library-list li')).toHaveAttribute('data-archived', 'true');
    await page.evaluate(async () => {
      window.resumeOldLibraryRead();
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    await expect(page.locator('.document-library-list li')).toHaveCount(1);
    await expect(page.locator('.document-library-list li')).toHaveAttribute('data-archived', 'true');
  });
}

for (const failed of [false, true]) {
  test(`keyboard Archive ${failed ? 'failure' : 'success'} returns focus to its control`, async ({ page }) => {
    await openLibrary(page);
    await page.evaluate(failed => { window.holdLibraryMutation = true; window.failLibraryMutation = failed; }, failed);
    const archive = page.getByRole('button', { name: 'Archive', exact: true });
    for (let steps = 0; steps < 40 && !await archive.evaluate(element => element === document.activeElement); steps++) {
      await page.keyboard.press('Tab');
    }
    await expect(archive).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => typeof window.resumeLibraryMutation)).toBe('function');
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    await page.evaluate(() => window.resumeLibraryMutation());
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
    const action = page.locator('.document-library-list .library-actions button').last();
    await expect(action).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: '名前を変更', exact: true })).toBeFocused();
  });
}
