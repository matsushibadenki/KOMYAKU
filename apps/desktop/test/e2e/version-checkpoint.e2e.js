import { expect, test } from '@playwright/test';

// Only the native history boundary is substituted. Editor, edit-session,
// checkpoint persistence and App event handlers are the real browser code.
async function openHistory(page) {
  await page.route('**/src/services/local-version-history.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      const history = { versions: [{ id: 'version-1', label: 'Saved', reason: 'initial',
        createdAt: '2026-09-09T00:00:00Z', snapshotHash: 'a'.repeat(64) }],
        branches: [{ id: 'branch-1', name: 'Main' }], currentBranchId: 'branch-1', currentVersionId: 'version-1' };
      history.versions.push({ ...history.versions[0], id: 'version-2', label: 'Other' });
      window.versionWrites = [];
      export const localVersionHistoryAvailable = () => true;
      export const getOrCreateLocalVersionAuthorId = () => 'author';
      export const listLocalVersionHistory = async documentId => {
        if (window.holdOldDocument && documentId === '00000000-0000-4000-8000-000000000001') {
          await new Promise((resolve, reject) => {
            window.resumeOldHistory = () => window.rejectOldHistory ? reject(new Error('old read failed')) : resolve();
          });
        }
        if (!window.historyForAllDocuments && documentId !== '00000000-0000-4000-8000-000000000001') {
          return { versions: [], branches: [], currentBranchId: null, currentVersionId: null };
        }
        if (window.holdVersionHistory) {
          window.versionHistoryWaiters ??= [];
          await new Promise(resolve => {
            window.versionHistoryWaiters.push(resolve);
            window.resumeVersionHistory = () => {
              window.holdVersionHistory = false;
              window.versionHistoryWaiters.splice(0).forEach(resume => resume());
            };
          });
        }
        return structuredClone(history);
      };
      export const createLocalDocumentVersion = async input => {
        window.versionWrites.push(input);
        if (window.holdVersionWrite) await new Promise(resolve => { window.resumeVersionWrite = resolve; });
      };
      export const compareLocalDocumentVersions = async () => {
        await new Promise((resolve, reject) => {
          window.resumeComparison = () => window.rejectComparison ? reject(new Error('old comparison failed')) : resolve();
        });
        return { summary: {}, changes: [] };
      };
      export const loadLocalVersionAssets = () => { throw new Error('unexpected assets'); };
      export const loadLocalVersionSnapshot = () => { throw new Error('unexpected snapshot'); };
      export const restoreLocalDocumentVersion = () => { throw new Error('unexpected restore'); };
    `
  }));
  await page.goto('/');
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'saved');
  await expect(page.getByRole('button', { name: '名前付き版を保存' })).toBeEnabled();
}

for (const name of ['名前付き版を保存', '現在の版から別案を作成']) {
  test(`${name} refuses composition before checkpoint or native write`, async ({ page }) => {
    await openHistory(page);
    await page.getByLabel('別案の名前', { exact: true }).fill('Alternative');
    const before = await page.evaluate(() => localStorage.getItem('komyaku:local-draft:00000000-0000-4000-8000-000000000001'));
    await page.locator('.ProseMirror').dispatchEvent('compositionstart');
    await page.getByRole('button', { name, exact: true }).click();
    expect(await page.evaluate(() => window.versionWrites)).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('komyaku:local-draft:00000000-0000-4000-8000-000000000001'))).toBe(before);
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
    await page.locator('.ProseMirror').dispatchEvent('compositionend');
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.versionWrites.length)).toBe(1);
  });
}

test('version creation locks navigation until the native write completes', async ({ page }) => {
  await openHistory(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' latest-version-marker');
  await page.evaluate(() => { window.holdVersionWrite = true; });
  await page.getByRole('button', { name: '名前付き版を保存' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.resumeVersionWrite)).toBe('function');
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  expect(await page.evaluate(() => JSON.stringify(window.versionWrites[0].document))).toContain('latest-version-marker');
  await page.evaluate(() => window.resumeVersionWrite());
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.version-history-heading .persistence-status')).toHaveAttribute('data-state', 'ready');
});

test('composition beginning during history lookup cancels the version write', async ({ page }) => {
  await openHistory(page);
  await page.evaluate(() => { window.holdVersionHistory = true; });
  await page.getByRole('button', { name: '名前付き版を保存' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.resumeVersionHistory)).toBe('function');
  // Synthetic composition exercises the final guard even if a queued platform
  // event arrives after the workspace becomes inert; this is not native IME QA.
  await page.locator('.ProseMirror').dispatchEvent('compositionstart');
  await page.evaluate(() => window.resumeVersionHistory());
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  expect(await page.evaluate(() => window.versionWrites)).toEqual([]);
  await expect(page.locator('.version-history-heading .persistence-status')).toHaveAttribute('data-state', 'error');
});

for (const rejected of [false, true]) {
  test(`old history ${rejected ? 'failure' : 'success'} cannot replace a new document history`, async ({ page }) => {
    await openHistory(page);
    await page.evaluate(rejected => {
      window.holdOldDocument = true;
      window.rejectOldHistory = rejected;
    }, rejected);
    await page.getByRole('button', { name: '新しい文書', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.resumeOldHistory)).toBe('function');
    await expect(page.locator('.version-current')).toHaveCount(0);
    await expect(page.locator('.version-history-heading .persistence-status')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(async () => {
      window.resumeOldHistory();
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    await expect(page.locator('.version-current')).toHaveCount(0);
    await expect(page.locator('.version-history-heading .persistence-status')).toHaveAttribute('data-state', 'ready');
  });
}

for (const rejected of [false, true]) {
  test(`old comparison ${rejected ? 'failure' : 'success'} cannot update a new document`, async ({ page }) => {
    await openHistory(page);
    await page.evaluate(rejected => {
      window.historyForAllDocuments = true;
      window.rejectComparison = rejected;
    }, rejected);
    await page.getByRole('button', { name: '差分を表示', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.resumeComparison)).toBe('function');
    await page.getByRole('button', { name: '新しい文書', exact: true }).click();
    await expect(page.locator('.ProseMirror')).not.toContainText('稿脈を、同じ時間に書く。');
    await expect(page.locator('.version-compare .persistence-status')).toHaveAttribute('data-state', 'idle');
    await page.evaluate(async () => {
      window.resumeComparison();
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    await expect(page.locator('.version-compare .persistence-status')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('.version-diff-result')).toHaveCount(0);
  });
}
