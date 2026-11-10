import { test, expect } from "bun:test";
import { i18n, supportedLocales } from "../src/index.js";

for (const locale of supportedLocales) {
  test(`idle agent status stays visually empty in ${locale}`, () => {
    expect(i18n.getFixedT(locale)("storyAgent.status.idle")).toBe("");
  });
}
