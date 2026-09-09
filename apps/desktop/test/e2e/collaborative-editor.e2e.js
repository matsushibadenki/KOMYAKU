import { expect, test } from "@playwright/test";
import { inspectConversationExport } from "../../src/services/conversation-import-preview.js";

const DRAFT_KEY = "komyaku:local-draft:00000000-0000-4000-8000-000000000001";
const PNG_FIXTURE = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84,
  120, 218, 99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0,
  73, 69, 78, 68, 174, 66, 96, 130
]);

async function openCleanWorkbench(page) {
  await page.goto("/?workbench=1");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".ProseMirror")).toHaveCount(2);
}

async function installMermaidDraft(page) {
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, DRAFT_KEY)).toBe(true);
  await page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key));
    const document = JSON.parse(record.contentJson);
    document.content.splice(1, 0, {
      id: "00000000-0000-4000-8000-000000000004",
      schemaVersion: 1,
      metadata: {},
      extensions: {},
      renderArtifacts: [],
      type: "diagram",
      sourceType: "mermaid",
      source: "flowchart LR\n  Draft[原稿] --> Review[確認]\n  Review --> Version[Version]",
      altText: "原稿から確認、Versionへ進む流れ",
      caption: []
    });
    record.contentJson = JSON.stringify(document);
    record.schemaVersion = document.schemaVersion;
    record.localRevision += 1;
    localStorage.setItem(key, JSON.stringify(record));
  }, DRAFT_KEY);
  await page.reload();
  await expect(page.locator(".structured-diagram-node")).toHaveCount(2);
}

async function installImageDraft(page) {
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, DRAFT_KEY)).toBe(true);
  await page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key));
    const document = JSON.parse(record.contentJson);
    document.content.splice(1, 0, {
      id: "00000000-0000-4000-8000-000000000007",
      schemaVersion: 1,
      metadata: {},
      extensions: {},
      renderArtifacts: [],
      type: "image",
      assetId: "00000000-0000-4000-8000-000000000008",
      mediaType: "image/png",
      altText: "検査済みローカル画像の代替テキスト",
      caption: [],
      width: 640,
      height: 480
    });
    record.contentJson = JSON.stringify(document);
    record.localRevision += 1;
    localStorage.setItem(key, JSON.stringify(record));
  }, DRAFT_KEY);
  await page.reload();
  await expect(page.locator(".structured-image-node")).toHaveCount(2);
}

test("uses a single-editor product workspace with session-scoped undo and redo", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".ProseMirror")).toHaveCount(1);
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" undo-redo-marker");
  await expect(editor).toContainText("undo-redo-marker");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(editor).not.toContainText("undo-redo-marker");
  await page.getByRole("button", { name: "やり直す" }).click();
  await expect(editor).toContainText("undo-redo-marker");
});

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

test("failed persistence blocks navigation until explicit retry and survives reload", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".app-footer .persistence-status")).toHaveAttribute("data-state", "saved");
  const before = await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreDraftWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("komyaku:local-draft:")) throw new DOMException("Test storage full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" retry-preserves-日本語-简体中文");
  await expect(page.locator(".app-footer .persistence-status")).toHaveAttribute("data-state", "error");
  expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBe(before);
  await page.evaluate(() => window.restoreDraftWrites());
  // Restoring storage availability must not implicitly clear the blocked session.
  await page.getByRole("button", { name: "新しい文書" }).click();
  await expect(editor).toContainText("retry-preserves-日本語-简体中文");
  await expect(page.locator(".app-footer .persistence-status")).toHaveAttribute("data-state", "error");
  await page.getByRole("button", { name: "ローカル保存を再試行" }).click();
  await expect(page.locator(".app-footer .persistence-status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.locator(".ProseMirror").first()).toContainText("retry-preserves-日本語-简体中文");
});

test("new document checkpoints pending edits and is blocked during composition", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const editor = page.locator(".ProseMirror");
  await expect(page.locator(".app-footer .persistence-status")).toHaveAttribute("data-state", "saved");
  await editor.dispatchEvent("compositionstart", { data: "入力中" });
  await page.getByRole("button", { name: "新しい文書" }).click();
  await expect(page.getByText("IME入力中—保存を保留")).toBeVisible();
  await editor.dispatchEvent("compositionend", { data: "入力完了" });
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" pending-navigation-marker");
  await page.getByRole("button", { name: "新しい文書" }).click();
  await expect(editor).not.toContainText("pending-navigation-marker");
  expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toContain("pending-navigation-marker");
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

test("preserves Mermaid source and fails closed to the Desktop-only preview boundary on the web", async ({ page }) => {
  await openCleanWorkbench(page);
  await installMermaidDraft(page);
  const diagram = page.locator(".structured-diagram-node").first();
  await expect(diagram.locator(".structured-diagram-source")).toContainText("Draft[原稿]");
  await expect(diagram.getByText("Web版では図のSourceを表示します。安全なプレビューはDesktop版で利用できます。"))
    .toBeVisible();
  await expect(diagram.locator("iframe")).toHaveCount(0);
});

test("preserves Image identity and alternative text when no accepted local preview exists", async ({ page }) => {
  await openCleanWorkbench(page);
  await installImageDraft(page);
  const image = page.locator(".structured-image-node").first();
  await expect(image.locator(".structured-image-identity"))
    .toContainText("00000000-0000-4000-8000-000000000008");
  await expect(image.locator(".structured-image-alt-text"))
    .toHaveText("検査済みローカル画像の代替テキスト");
  await expect(image.getByText("画像を安全に表示できませんでした。Asset参照と代替テキストは保持されています。"))
    .toBeVisible();
  await expect(image.locator("iframe")).toHaveCount(0);
});

test("edits rich image captions, synchronizes them, and restores their structure after restart", async ({ page }) => {
  await openCleanWorkbench(page);
  await installImageDraft(page);
  const previousRevision = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).localRevision, DRAFT_KEY);
  const images = page.locator(".structured-image-node");
  const updatedAlt = "更新済み画像の代替テキスト";
  const updatedCaption = "図1：再起動後も保持される説明";

  await images.first().click();
  const editor = page.locator(".image-accessibility-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("画像の代替テキスト（必須）").fill(updatedAlt);
  await editor.getByRole("button", { name: "テキストを追加" }).click();
  await editor.getByLabel("テキスト要素 1").fill(updatedCaption);
  await editor.getByRole("button", { name: "太字" }).click();
  await editor.getByRole("button", { name: "改行を追加" }).click();
  await editor.getByRole("button", { name: "数式を追加" }).click();
  await editor.getByLabel("LaTeX Source").fill("E=mc^2");
  await editor.getByRole("button", { name: "説明を保存" }).click();

  await expect(images.locator(".structured-image-alt-text")).toHaveText([updatedAlt, updatedAlt]);
  await expect(images.locator(".structured-image-caption")).toHaveText([
    new RegExp(`${updatedCaption}[\\s\\S]*E=mc\\^2`, "u"),
    new RegExp(`${updatedCaption}[\\s\\S]*E=mc\\^2`, "u")
  ]);
  await expect(editor.getByText("代替テキストとキャプションを保存しました。")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).localRevision, DRAFT_KEY))
    .toBeGreaterThan(previousRevision);

  const beforeRestart = await page.evaluate((key) => {
    const document = JSON.parse(JSON.parse(localStorage.getItem(key)).contentJson);
    return document.content.find((node) => node.type === "image").caption;
  }, DRAFT_KEY);
  expect(beforeRestart.map(({ type }) => type)).toEqual(["text", "hard_break", "math_inline"]);
  expect(beforeRestart[0].marks).toEqual([{ type: "bold" }]);
  expect(beforeRestart[2].source).toBe("E=mc^2");

  await page.reload();
  await expect(page.locator(".structured-image-alt-text")).toHaveText([updatedAlt, updatedAlt]);
  await expect(page.locator(".structured-image-caption")).toHaveText([
    new RegExp(`${updatedCaption}[\\s\\S]*E=mc\\^2`, "u"),
    new RegExp(`${updatedCaption}[\\s\\S]*E=mc\\^2`, "u")
  ]);
  const afterRestart = await page.evaluate((key) => {
    const document = JSON.parse(JSON.parse(localStorage.getItem(key)).contentJson);
    return document.content.find((node) => node.type === "image").caption;
  }, DRAFT_KEY);
  expect(afterRestart).toEqual(beforeRestart);
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

  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
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
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
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

test("inserts a Cloud image only after decoder-backed inspection acceptance", async ({ page }) => {
  const workspaceId = "0198d0aa-0000-7000-8000-000000000020";
  const assetId = "0198d0aa-0000-7000-8000-000000000021";
  const referenceId = "0198d0aa-0000-7000-8000-000000000022";
  let uploadedNodeId = null;
  await page.route("http://127.0.0.1:3000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/login")) return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        user: { id: "user", email: "writer@example.com" },
        session: { token: "memory-only-session", expiresAt: "2099-01-01T00:00:00.000Z" }
      })
    });
    if (path.endsWith("/auth/workspaces")) return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ workspaces: [{
        id: workspaceId, name: "Image workspace", kind: "personal", role: "owner",
        canImportConversations: true
      }] })
    });
    if (path.endsWith("/assets") && request.method() === "POST") {
      uploadedNodeId = request.headers()["x-komyaku-node-id"];
      expect(request.postDataBuffer().equals(PNG_FIXTURE)).toBe(true);
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({
        nodeId: uploadedNodeId, assetId, referenceId, mediaType: "image/png",
        byteSize: PNG_FIXTURE.byteLength, inspectionStatus: "pending",
        detectedMediaType: null, policyVersion: null, width: null, height: null
      }) });
    }
    if (path.endsWith(`/assets/${assetId}/inspection`)) return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({
        assetId, mediaType: "image/png", byteSize: PNG_FIXTURE.byteLength,
        inspectionStatus: "accepted", detectedMediaType: "image/png",
        policyVersion: "decoder-backed-png-v1", width: 1, height: 1
      })
    });
    if (path.endsWith(`/assets/${assetId}/preview.png`)) return route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Access-Control-Allow-Origin": "http://127.0.0.1:1420",
        "Access-Control-Expose-Headers": "X-KOMYAKU-Inspection-Policy, X-KOMYAKU-Image-Width, X-KOMYAKU-Image-Height",
        "X-KOMYAKU-Inspection-Policy": "decoder-backed-png-v1",
        "X-KOMYAKU-Image-Width": "1",
        "X-KOMYAKU-Image-Height": "1"
      },
      body: PNG_FIXTURE
    });
    return route.fulfill({ status: 204 });
  });

  await openCleanWorkbench(page);
  await page.getByLabel("メールアドレス").fill("writer@example.com");
  await page.getByLabel("パスワード").fill("temporary-password");
  await page.getByRole("button", { name: "Workspaceに接続" }).click();
  await expect(page.getByLabel("保存先Workspace")).toHaveValue(workspaceId);

  await page.getByLabel("画像の代替テキスト（必須）").first().fill("Cloud検査済み画像");
  await page.locator('input[type="file"][accept="image/png"]').setInputFiles({
    name: "accepted.png", mimeType: "image/png", buffer: PNG_FIXTURE
  });
  await expect(page.getByText("検証済み画像を文書へ挿入しました。")).toBeVisible();
  await expect(page.locator(".structured-image-node")).toHaveCount(2);
  await expect(page.locator(".structured-image-identity")).toHaveText([
    `image/png · ${assetId}`, `image/png · ${assetId}`
  ]);
  await expect(page.locator(".image-preview-frame")).toHaveCount(2);
  expect(uploadedNodeId).toMatch(/^[0-9a-f-]{36}$/u);
});
