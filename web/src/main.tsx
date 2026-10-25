import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LocaleProvider, useT } from "./i18n/locale";
import "./styles.css";

function PresentationUnavailable() {
  const { t } = useT();
  return (
    <main className="entry">
      <h1>{t("Presentation unavailable")}</h1>
      <p>
        {t(
          "No execution result is inferred. Reconnect to observe the owner; accepted work continues.",
        )}
      </p>
      <button type="button" onClick={() => window.location.reload()}>
        {t("Reload observation")}
      </button>
    </main>
  );
}
class PresentationBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <PresentationUnavailable />
    ) : (
      this.props.children
    );
  }
}
const root = document.getElementById("root");
if (!root) throw new Error("Application root unavailable");
createRoot(root).render(
  <LocaleProvider>
    <PresentationBoundary>
      <App />
    </PresentationBoundary>
  </LocaleProvider>,
);
