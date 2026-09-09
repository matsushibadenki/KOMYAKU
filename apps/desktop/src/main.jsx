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

if (new URLSearchParams(window.location.search).get("mode") === "history-qa") {
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
