import { test, expect } from '@playwright/test';

// Browser storage substitutes only the native service. The ordinary App,
// editing/checkpoint queue, review panel and event handlers are exercised.
async function setup(page) {
  await page.route('**/src/App.jsx', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('Boolean(window.__TAURI_INTERNALS__)', 'true');
    await route.fulfill({ response, body });
  });
  await page.route('**/src/services/story-agent-reviews.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    const key='komyaku-e2e-agent-review';
    const read=()=>JSON.parse(localStorage.getItem(key)||'null');
    export const listStoryAgentReviews=async()=>{const r=read();return r&&r.status!=='adopted'&&r.status!=='rejected'?[{reviewId:r.reviewId,workspaceId:'workspace',status:r.status}]:[];};
    export const loadStoryAgentReview=async()=>read();
    export const prepareEditorStoryScope=async document=>({document});
    export const stageStoryAgentReview=async(scope,operations)=>{
      const r={reviewId:'review-1',status:'review',before:{document:scope.document},after:{document:operations[0].document},
        proposal:{commandJson:JSON.stringify({operations})}};localStorage.setItem(key,JSON.stringify(r));return r;};
    export const rejectStoryAgentReview=async()=>{const r=read();r.status='rejected';localStorage.setItem(key,JSON.stringify(r));};
    export const attemptStoryAgentReview=async()=>{
      const r=read();if(r.status==='adopted')return {replayed:true};
      const draftKey='komyaku:local-draft:'+r.after.document.id;const draft=JSON.parse(localStorage.getItem(draftKey));
      const current=JSON.parse(draft.contentJson);
      const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
      if(JSON.stringify(stable(current.content))!==JSON.stringify(stable(r.before.document.content)))throw new Error('story_review_editor_changed');
      draft.contentJson=JSON.stringify(r.after.document);draft.localRevision+=1;
      localStorage.setItem(draftKey,JSON.stringify(draft));r.status='adopted';localStorage.setItem(key,JSON.stringify(r));
      localStorage.setItem('komyaku-agent-adoptions',String(Number(localStorage.getItem('komyaku-agent-adoptions')||0)+1));
      throw new Error('lost-after-commit');};
  ` }));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'saved');
  return errors;
}

test('editing after review recovery blocks stale adoption and preserves the newer manuscript', async ({ page }) => {
  const errors = await setup(page);
  const record = await page.evaluate(() => JSON.parse(localStorage.getItem('komyaku:local-draft:00000000-0000-4000-8000-000000000001')));
  const after = JSON.parse(record.contentJson);
  after.content[0].content = [{ type: 'text', text: 'stale proposal', marks: [], metadata: {}, extensions: {} }];
  await page.getByRole('button', { name: 'Agentレビュー' }).click();
  await page.locator('.story-agent-panel input[type=file]').setInputFiles({ name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ operations: [{ type: 'replace-document', document: after }] })) });
  await expect(page.getByRole('button', { name: '採用', exact: true })).toBeVisible();
  await page.reload();
  const editor = page.locator('.ProseMirror').first();
  await editor.click(); await editor.press('End'); await editor.pressSequentially(' newer-manuscript');
  await expect(page.locator('.app-footer .persistence-status')).toHaveAttribute('data-state', 'saved');
  await page.getByRole('button', { name: '提案 1', exact: true }).click();
  await page.getByRole('button', { name: '採用', exact: true }).click();
  await expect(page.getByText('原稿が更新されています。この提案を却下し、新しい提案を用意してください。')).toBeVisible();
  await expect(editor).toContainText('newer-manuscript');
  await expect(page.locator('main.app-shell')).not.toHaveAttribute('inert');
  expect(await page.evaluate(() => localStorage.getItem('komyaku-agent-adoptions'))).toBeNull();
  expect(errors).toEqual([]);
});
for (const width of [1100, 390]) {
  test(`ordinary editor restores pending review and safely retries adoption at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const errors = await setup(page);
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('komyaku:local-draft:00000000-0000-4000-8000-000000000001')).contentJson);
    const after = JSON.parse(original);
    after.content[0].content = [{ type: 'text', text: 'Agent review restored 日本語 English 简体中文', marks: [], metadata: {}, extensions: {} }];
    await page.getByRole('button', { name: 'Agentレビュー' }).click();
    await page.locator('.story-agent-panel input[type=file]').setInputFiles({ name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ operations: [{ type: 'replace-document', document: after }] })) });
    await expect(page.getByRole('button', { name: '採用', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('komyaku-agent-adoptions'))).toBeNull();
    await page.reload();
    await page.getByRole('button', { name: '提案 1', exact: true }).click();
    await expect(page.locator('.story-agent-diff')).toContainText('Agent review restored');
    await page.screenshot({ path: '/tmp/komyaku-agent-review-' + width + '.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '採用', exact: true }).click();
    await expect(page.getByRole('button', { name: '採用を再試行' })).toBeVisible();
    await expect(page.locator('main.app-shell')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: '採用を再試行' }).click();
    await expect(page.locator('.ProseMirror').first()).toContainText('Agent review restored');
    expect(await page.evaluate(() => localStorage.getItem('komyaku-agent-adoptions'))).toBe('1');
    await page.reload();
    await expect(page.locator('.ProseMirror').first()).toContainText('Agent review restored');
    expect(await page.evaluate(() => localStorage.getItem('komyaku-agent-adoptions'))).toBe('1');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
