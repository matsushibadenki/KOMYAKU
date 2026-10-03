import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@komyaku/i18n";
import "@fontsource-variable/newsreader";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/700.css";
import { App } from "./App.jsx";
import "./styles.css";

const isMermaidRenderer = new URLSearchParams(window.location.search).get("mode") === "mermaid-renderer";
const MermaidRendererHost = isMermaidRenderer
  ? lazy(() => import("./components/MermaidRendererHost.jsx").then((module) => ({
      default: module.MermaidRendererHost
    })))
  : null;

if (new URLSearchParams(window.location.search).get("mode") === "integration-ui-qa") {
  void import("./services/packaged-integration-ui-qa.js").then(async ({ prepareIntegrationUiQa }) => {
    const props = await prepareIntegrationUiQa();
    ReactDOM.createRoot(document.getElementById("root")).render(
      <I18nextProvider i18n={i18n}><App {...props} /></I18nextProvider>);
  }).catch(error => { document.getElementById("root").textContent = `QA failed: ${error.message}`; });
} else if (["integration-qa", "integration-retry-qa"].includes(new URLSearchParams(window.location.search).get("mode"))) {
  void import("./services/packaged-integration-qa.js").then(({ mountPackagedIntegrationQa }) =>
    mountPackagedIntegrationQa(document.getElementById("root"), {
      lostResponse: new URLSearchParams(window.location.search).get("mode") === "integration-retry-qa" }));
} else if (new URLSearchParams(window.location.search).get("mode") === "history-archive-qa") {
  void import("./services/packaged-history-archive-qa.js").then(({ mountPackagedHistoryArchiveQa }) =>
    mountPackagedHistoryArchiveQa(document.getElementById("root")));
} else if (new URLSearchParams(window.location.search).get("mode") === "history-qa") {
  void import("./services/packaged-history-qa.js").then(({ mountPackagedHistoryQa }) =>
    mountPackagedHistoryQa(document.getElementById("root")));
} else ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      {isMermaidRenderer
        ? <Suspense fallback={null}><MermaidRendererHost /></Suspense>
        : <App />}
    </I18nextProvider>
  </React.StrictMode>
);
