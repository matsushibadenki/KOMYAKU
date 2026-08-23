import { expect, test } from "@playwright/test";

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
