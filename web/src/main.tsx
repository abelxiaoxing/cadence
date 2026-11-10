import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider, useT } from "./i18n/locale";
import { applyTheme, preferredTheme } from "./layout/theme";
import { Workbench } from "./Workbench";
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
// A saved theme choice is applied before the first render; the content policy
// allows no inline script, and without a choice the stylesheet needs none.
applyTheme(preferredTheme());
const root = document.getElementById("root");
if (!root) throw new Error("Application root unavailable");
createRoot(root).render(
  <LocaleProvider>
    <PresentationBoundary>
      <Workbench />
    </PresentationBoundary>
  </LocaleProvider>,
);
