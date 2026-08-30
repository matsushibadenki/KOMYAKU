import { expect, test } from "@playwright/test";
import { inspectConversationExport } from "../../src/services/conversation-import-preview.js";

const DRAFT_KEY = "komyaku:local-draft:00000000-0000-4000-8000-000000000001";

async function openCleanWorkbench(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".ProseMirror")).toHaveCount(2);
}

test("synchronizes independent replicas across disconnect and reconnect", async ({ page }) => {
  await openCleanWorkbench(page);
  const editors = page.locator(".ProseMirror");
  const local = editors.first();
  const marker = " offline-rejoin-日本語-简体中文";

  await local.click();
  await local.press("End");
  await local.pressSequentially(" live-sync");
  await expect(editors.nth(1)).toContainText("live-sync");

  await page.getByRole("button", { name: "2つ目を切断" }).click();
  await local.pressSequentially(marker);
  await page.getByRole("button", { name: "再接続" }).click();

  await expect(page.locator(".ProseMirror").nth(1)).toContainText(marker.trim());
});

test("pauses checkpointing during composition and resumes after compositionend", async ({ page }) => {
  await openCleanWorkbench(page);
  const local = page.locator(".ProseMirror").first();

  await local.dispatchEvent("compositionstart", { data: "変換中" });
  await expect(page.getByText("IME入力中—保存を保留")).toBeVisible();
  await local.dispatchEvent("compositionend", { data: "変換完了" });
  await expect(page.getByText("検証済み")).toBeVisible({ timeout: 5_000 });
});

test("restores the last validated Canonical draft after a page restart", async ({ page }) => {
  await openCleanWorkbench(page);
  const local = page.locator(".ProseMirror").first();
  const marker = " restart-recovery-20260824";

  await local.click();
  await local.press("End");
  await local.pressSequentially(marker);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key)?.includes("restart-recovery-20260824"), DRAFT_KEY))
    .toBe(true);

  await page.reload();
  await expect(page.locator(".ProseMirror").first()).toContainText(marker.trim());
  await expect(page.getByText("この端末に自動保存済み")).toBeVisible();
});

test("assigns stable Node IDs to newly created blocks before autosave", async ({ page }) => {
  await openCleanWorkbench(page);
  const local = page.locator(".ProseMirror").first();
  const marker = "new-block-stable-id";

  await local.click();
  await local.press("End");
  await local.press("Enter");
  await local.pressSequentially(marker);

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key)?.includes("new-block-stable-id"), DRAFT_KEY))
    .toBe(true);
  await expect(page.getByText("この端末に自動保存済み")).toBeVisible();
});

test("keeps controls readable without horizontal overflow", async ({ page }) => {
  await openCleanWorkbench(page);
  for (const width of [320, 375, 414, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      buttonWraps: [...document.querySelectorAll("button")]
        .some((button) => button.scrollWidth > button.clientWidth)
    }));
    expect(layout.content).toBeLessThanOrEqual(layout.viewport);
    expect(layout.buttonWraps).toBe(false);
  }
});

test("reviews, masks, and completes an exact streamed AI handoff", async ({ page }) => {
  await openCleanWorkbench(page);
  await page.route("http://127.0.0.1:11434/v1/models", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [{ id: "writer-z" }, { id: "writer-a" }] })
  }));
  await page.route("http://127.0.0.1:11434/v1/chat/completions", (route) => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: [
      'data: {"id":"desktop-stream","model":"writer-z","choices":[{"delta":{"content":"Safe "}}]}',
      '',
      'data: {"id":"desktop-stream","model":"writer-z","choices":[{"delta":{"content":"continuation"}}]}',
      '',
      'data: [DONE]',
      '',
      ''
    ].join("\n")
  }));
  const content = JSON.stringify([{
    id: "conversation-1",
    title: "Import preview",
    mapping: {
      root: { id: "root", parent: null, children: ["message"], message: null },
      message: {
        id: "message", parent: "root", children: [],
        message: { author: { role: "user" }, content: { parts: ["private source text for writer@example.com with sk-abcdefghijklmnop"] } }
      }
    }
  }]);

  await page.locator('input[type="file"]').setInputFiles({
    name: "conversations.json",
    mimeType: "application/json",
    buffer: Buffer.from(content)
  });

  await expect(page.locator(".import-summary strong").filter({ hasText: "ChatGPT" })).toBeVisible();
  await expect(page.getByText("レビュー完了")).toBeVisible();
  await expect(page.getByRole("heading", { name: /確認した会話から.*新しい分岐/ })).toBeVisible();
  await expect(page.locator(".handoff-context").getByText(/writer@example.com/)).toBeVisible();
  const sensitiveNotice = page.locator(".handoff-sensitive");
  await expect(sensitiveNotice.getByText("送信対象に秘密情報の候補があります")).toBeVisible();
  await expect(sensitiveNotice).not.toContainText("writer@example.com");
  await page.getByLabel(/検出候補を送信用Copyでマスク/).check();
  await expect(page.locator(".handoff-context")).toContainText("[REDACTED:EMAIL]");
  await expect(page.locator(".handoff-context")).toContainText("[REDACTED:API_KEY]");
  await expect(page.locator(".handoff-context")).not.toContainText("writer@example.com");

  await page.getByRole("button", { name: "この接続を使用" }).click();
  await expect(page.getByText(/Local compatible API.*local-model/)).toBeVisible();
  await page.getByRole("button", { name: "ProviderからModelを取得" }).click();
  await expect(page.getByLabel("取得したModel")).toHaveValue("writer-a");
  await page.getByLabel("取得したModel").selectOption("writer-z");
  await expect(page.getByText(/Local compatible API.*writer-z/)).toBeVisible();
  await page.getByRole("button", { name: "送信内容を生成してレビュー" }).click();

  await expect(page.getByText("http://127.0.0.1:11434/v1")).toBeVisible();
  await expect(page.locator(".handoff-review").getByText("writer-z")).toBeVisible();
  await expect(page.getByText("Context SHA-256")).toBeVisible();
  await expect(page.getByText("Outbound SHA-256")).toBeVisible();
  const send = page.getByRole("button", { name: "確認済み内容をAIへ送信" });
  await expect(send).toBeDisabled();
  await page.getByLabel(/表示された1 MessageをLocal compatible API/).check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText(/Memoryへ追加しました/)).toBeVisible();
  await expect(page.locator(".handoff-context")).toContainText("Safe continuation");

  const stored = await page.evaluate(() => JSON.stringify({
    local: { ...localStorage },
    session: { ...sessionStorage }
  }));
  expect(stored).not.toContain("apiKey");
});

test("connects an authenticated workspace and submits the exact reviewed bytes after confirmation", async ({ page }) => {
  const workspaceId = "0198d0aa-0000-7000-8000-000000000010";
  const importId = "0198d0aa-0000-7000-8000-000000000011";
  const content = JSON.stringify([{
    id: "conversation-cloud",
    title: "Exact cloud import",
    mapping: {
      root: { id: "root", parent: null, children: ["message"], message: null },
      message: {
        id: "message", parent: "root", children: [],
        message: { author: { role: "user" }, content: { parts: ["exact-private-source"] } }
      }
    }
  }]);
  const cloudInspection = await inspectConversationExport(Buffer.from(content), "auto", {
    identityScope: workspaceId
  });
  const conversationId = cloudInspection.canonicalConversations[0].id;
  let importedRequest = null;

  await page.route("http://127.0.0.1:3000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/login")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "user", email: "writer@example.com" },
          session: { token: "memory-only-session", expiresAt: "2099-01-01T00:00:00.000Z" }
        })
      });
    }
    if (path.endsWith("/auth/workspaces")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workspaces: [{
          id: workspaceId, name: "Private research", kind: "personal", role: "owner",
          canImportConversations: true
        }] })
      });
    }
    if (path.endsWith("/conversation-imports")) {
      importedRequest = {
        body: request.postDataBuffer(),
        authorization: request.headers().authorization,
        provider: request.headers()["x-komyaku-source-provider"],
        idempotencyKey: request.headers()["idempotency-key"]
      };
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          importId, conversationId, conversationIds: [conversationId],
          sourceProvider: "chatgpt", status: "complete", warnings: []
        })
      });
    }
    return route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cloud-conversations.json",
    mimeType: "application/json",
    buffer: Buffer.from(content)
  });
  await expect(page.getByText("レビュー完了")).toBeVisible();

  await page.getByLabel("メールアドレス").fill("writer@example.com");
  await page.getByLabel("パスワード").fill("temporary-password");
  await page.getByRole("button", { name: "Workspaceに接続" }).click();
  await expect(page.getByLabel("保存先Workspace")).toHaveValue(workspaceId);
  await expect(page.getByText("writer@example.com")).toBeVisible();

  await page.getByLabel(/レビュー済みの同一原文/).check();
  await page.getByRole("button", { name: "確認してCloudへ保存" }).click();
  await expect(page.getByText("Cloudへの保存が完了しました")).toBeVisible();
  await expect(page.getByText(importId)).toBeVisible();

  expect(importedRequest.body.equals(Buffer.from(content))).toBe(true);
  expect(importedRequest.authorization).toBe("Bearer memory-only-session");
  expect(importedRequest.provider).toBe("auto");
  expect(importedRequest.idempotencyKey.length).toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("memory-only-session");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("temporary-password");
});
