import { expect, test } from '@playwright/test';

// Only the native history boundary is substituted. Editor, edit-session,
// checkpoint persistence and App event handlers are the real browser code.
async function openHistory(page, initial = false, paged = false) {
  if (initial) await page.addInitScript(() => { window.startWithoutHistory = true; });
  if (paged) await page.addInitScript(() => { window.pagedHistory = true; });
  await page.route('**/src/services/local-version-history.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      const history = { versions: [{ id: 'version-1', label: 'Saved', reason: 'initial',
        createdAt: '2026-09-09T00:00:00Z', snapshotHash: 'a'.repeat(64), parentIds: ['version-2'] }],
        branches: [{ id: 'branch-1', name: 'Main', headVersionId: 'version-1' }],
        currentBranchId: 'branch-1', currentVersionId: 'version-1',
        documentId: '00000000-0000-4000-8000-000000000001', nextCursor: null };
      history.versions.push({ ...history.versions[0], id: 'version-2', label: 'Other', parentIds: [] });
      if (window.pagedHistory) {
        history.versions = Array.from({ length: 10 }, (_, index) => ({ ...history.versions[0],
          id: 'version-' + (index + 1), label: 'Saved ' + (index + 1),
          parentIds: [index === 1 ? 'version-4'
            : index < 9 ? 'version-' + (index + 2) : 'version-older-1'] }));
        history.versions[2].parentIds = ['version-4'];
        history.branches = [history.branches[0],
          { id: 'branch-2', name: 'Alternative', headVersionId: 'version-3' }];
        history.nextCursor = { createdAt: history.versions[9].createdAt, versionId: history.versions[9].id };
      }
      const initialVersions = structuredClone(history.versions);
      if (window.startWithoutHistory) { history.versions = []; history.currentVersionId = null; }
      window.versionWrites = [];
      export const localVersionHistoryAvailable = () => true;
      export const getOrCreateLocalVersionAuthorId = () => 'author';
      export const listLocalVersionHistory = async (documentId, options = {}) => {
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
        if (options.cursor) {
          window.historyPageRequests ??= [];
          window.historyPageRequests.push(structuredClone(options.cursor));
          return { ...structuredClone(history), versions: [
            { ...history.versions[0], id: 'version-older-1', label: 'Older 1', parentIds: ['version-older-2'] },
            { ...history.versions[0], id: 'version-older-2', label: 'Older 2', parentIds: [] }
          ], nextCursor: null };
        }
        return structuredClone(history);
      };
      export const appendLocalVersionHistoryPage = (loaded, page) => ({ ...loaded,
        branches: page.branches, versions: [...loaded.versions, ...page.versions], nextCursor: page.nextCursor });
      export const loadLocalHistoryArchiveSource = async documentId => {
        const record = JSON.parse(localStorage.getItem('komyaku:local-draft:' + documentId));
        return {
          documentId,
          currentBranchId: '00000000-0000-4000-8000-000000000022',
          currentVersionId: '00000000-0000-4000-8000-000000000021',
          versions: [{
            id: '00000000-0000-4000-8000-000000000021', schemaVersion: 1,
            snapshotEncoding: 'canonical-json-v1', snapshotJson: record.contentJson,
            parentIds: [], authorId: '00000000-0000-4000-8000-000000000023',
            reason: 'initial', restoredFromVersionId: null, label: 'Exported',
            createdAt: '2026-09-12T00:00:00.000Z'
          }],
          branches: [{
            id: '00000000-0000-4000-8000-000000000022', name: 'Main',
            headVersionId: '00000000-0000-4000-8000-000000000021',
            createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z'
          }],
          assets: []
        };
      };
      export const createLocalDocumentVersion = async input => {
        window.versionWrites.push(input);
        if (window.holdVersionWrite) await new Promise(resolve => { window.resumeVersionWrite = resolve; });
        if (window.failVersionWrite) throw new Error('injected version write failure');
        if (input.kind === 'initial') { history.versions = initialVersions; history.currentVersionId = 'version-1'; }
      };
      export const compareLocalDocumentVersions = async () => {
        await new Promise((resolve, reject) => {
          window.resumeComparison = () => window.rejectComparison ? reject(new Error('old comparison failed')) : resolve();
        });
        return { summary: {}, changes: [] };
      };
      export const loadLocalVersionAssets = () => { throw new Error('unexpected assets'); };
      export const loadLocalVersionSnapshot = () => { throw new Error('unexpected snapshot'); };
      export const restoreLocalDocumentVersion = async () => {
        const record = JSON.parse(localStorage.getItem('komyaku:local-draft:00000000-0000-4000-8000-000000000001'));
        return { document: JSON.parse(record.contentJson), localRevision: record.localRevision };
      };
    `
  }));
  await page.goto('/');
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'saved');
  await expect(page.getByRole('button', { name: initial ? '最初の版を作成' : '名前付き版を保存' })).toBeEnabled();
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

for (const alternative of [false, true]) {
  for (const failed of [false, true]) {
    test(`keyboard ${alternative ? 'alternative' : 'named'} save ${failed ? 'failure' : 'success'} preserves focus and form intent`, async ({ page }) => {
      await openHistory(page);
      const input = page.getByLabel(alternative ? '別案の名前' : '版の名前（任意）', { exact: true });
      for (let steps = 0; steps < 80 && !await input.evaluate(element => element === document.activeElement); steps++) {
        await page.keyboard.press('Tab');
      }
      await expect(input).toBeFocused();
      await page.keyboard.type('Keyboard draft');
      await page.keyboard.press('Tab');
      const button = page.getByRole('button', { name: alternative ? '現在の版から別案を作成' : '名前付き版を保存', exact: true });
      await expect(button).toBeFocused();
      await page.evaluate(failed => { window.holdVersionWrite = true; window.failVersionWrite = failed; }, failed);
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => typeof window.resumeVersionWrite)).toBe('function');
      await expect(page.locator('main')).toHaveAttribute('inert', '');
      await page.evaluate(() => window.resumeVersionWrite());
      await expect(page.locator('main')).not.toHaveAttribute('inert', '');
      await expect(button).toBeFocused();
      await expect(input).toHaveValue(failed ? 'Keyboard draft' : '');
      await expect(page.locator('.version-history-heading .persistence-status')).toHaveAttribute('data-state', failed ? 'error' : 'ready');
      if (failed) {
        await page.evaluate(() => { window.holdVersionWrite = false; window.failVersionWrite = false; });
        await page.keyboard.press('Enter');
        await expect(input).toHaveValue('');
        expect(await page.evaluate(() => window.versionWrites.map(input => input.branchName || input.label)))
          .toEqual(['Keyboard draft', 'Keyboard draft']);
      }
      await page.keyboard.press('Shift+Tab');
      await expect(input).toBeFocused();
    });
  }
}

for (const initial of [true, false]) {
  test(`keyboard ${initial ? 'initial creation' : 'restore'} retains a focus destination after controls remount`, async ({ page }) => {
    await openHistory(page, initial);
    const action = page.getByRole('button', { name: initial ? '最初の版を作成' : 'この版を復元', exact: true });
    for (let steps = 0; steps < 80 && !await action.evaluate(element => element === document.activeElement); steps++) {
      await page.keyboard.press('Tab');
    }
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#version-history-title')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('版の名前（任意）', { exact: true })).toBeFocused();
  });
}

test('comparison can be submitted from the keyboard and leaves focus usable', async ({ page }) => {
  await openHistory(page);
  const button = page.getByRole('button', { name: '差分を表示', exact: true });
  for (let steps = 0; steps < 80 && !await button.evaluate(element => element === document.activeElement); steps++) {
    await page.keyboard.press('Tab');
  }
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => typeof window.resumeComparison)).toBe('function');
  await page.evaluate(() => window.resumeComparison());
  await expect(page.locator('.version-compare .persistence-status')).toHaveAttribute('data-state', 'ready');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.version-compare select').nth(1)).toBeFocused();
});

test('older Version paging appends the next native page and keeps loaded items visible', async ({ page }) => {
  const runtimeErrors = [];
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await openHistory(page, false, true);
  await expect(page).toHaveTitle('KOMYAKU');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.locator('.version-list li')).toHaveCount(10);
  await expect(page.locator('.version-lineage-node')).toHaveCount(10);
  await expect(page.locator('.version-lineage-edge')).toHaveCount(9);
  await expect(page.locator('.version-lineage-branches').filter({ hasText: /^Main$/ })).toBeVisible();
  await expect(page.locator('.version-lineage-branches').filter({ hasText: /^Alternative$/ })).toBeVisible();
  await expect(page.locator('.version-lineage-current')).toHaveText('現在位置');
  expect(await page.locator('.version-lineage-node').evaluateAll((nodes) =>
    new Set(nodes.map((node) => node.getAttribute('cx'))).size)).toBe(2);
  const loadOlder = page.getByRole('button', { name: '古い版を10件表示', exact: true });
  await loadOlder.click();
  await expect(page.locator('.version-list li')).toHaveCount(12);
  await expect(page.locator('.version-lineage-node')).toHaveCount(12);
  await expect(page.locator('.version-lineage-edge')).toHaveCount(11);
  await expect(loadOlder).toHaveCount(0);
  expect(await page.evaluate(() => window.historyPageRequests)).toEqual([
    { createdAt: '2026-09-09T00:00:00Z', versionId: 'version-10' }
  ]);
  const screenshotDirectory = process.env.KOMYAKU_QA_SCREENSHOT_DIRECTORY;
  if (screenshotDirectory) await page.screenshot({
    path: `${screenshotDirectory}/version-lineage-desktop.png`, fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth
    <= document.documentElement.clientWidth)).toBe(true);
  const graphBounds = await page.locator('.version-lineage-canvas').boundingBox();
  expect(graphBounds.x).toBeGreaterThanOrEqual(0);
  expect(graphBounds.x + graphBounds.width).toBeLessThanOrEqual(390);
  if (screenshotDirectory) await page.screenshot({
    path: `${screenshotDirectory}/version-lineage-mobile.png`, fullPage: true
  });
  expect(runtimeErrors).toEqual([]);
});

test('full-history export verifies v2 and initiates a local download', async ({ page }) => {
  await openHistory(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '.komyaku 全履歴', exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toMatch(/\.komyaku$/);
  await expect(page.locator('.version-export .persistence-status'))
    .toHaveText('検証済みファイルのダウンロードを開始しました');
});
