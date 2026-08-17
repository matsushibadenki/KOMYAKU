import i18next from "i18next";
import ja from "./locales/ja/common.json";
import en from "./locales/en/common.json";
import zhHans from "./locales/zh-Hans/common.json";

export const supportedLocales = ["ja", "en", "zh-Hans"];

export const i18n = i18next.createInstance();

void i18n.init({
  lng: "ja",
  fallbackLng: "en",
  supportedLngs: supportedLocales,
  nonExplicitSupportedLngs: false,
  interpolation: { escapeValue: false },
  resources: {
    ja: { translation: ja },
    en: { translation: en },
    "zh-Hans": { translation: zhHans }
  }
});

