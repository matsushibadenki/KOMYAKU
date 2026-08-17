import { useTranslation } from "react-i18next";

export function App() {
  const { t, i18n } = useTranslation();

  function changeLocale(event) {
    const locale = event.target.value;
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">KOMYAKU / 稿脈</p>
          <h1>{t("app.title")}</h1>
        </div>
        <label className="locale-control">
          <span>{t("settings.language")}</span>
          <select value={i18n.resolvedLanguage} onChange={changeLocale}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
            <option value="zh-Hans">简体中文</option>
          </select>
        </label>
      </header>

      <section className="foundation-card" aria-labelledby="foundation-title">
        <p className="status-pill">{t("foundation.status")}</p>
        <h2 id="foundation-title">{t("foundation.title")}</h2>
        <p>{t("foundation.description")}</p>
      </section>
    </main>
  );
}

