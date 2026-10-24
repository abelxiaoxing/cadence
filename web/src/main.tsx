import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

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
      <main className="entry">
        <h1>Presentation unavailable</h1>
        <p>
          No execution result is inferred. Reconnect to observe the owner;
          accepted work continues.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload observation
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const root = document.getElementById("root");
if (!root) throw new Error("Application root unavailable");
createRoot(root).render(
  <PresentationBoundary>
    <App />
  </PresentationBoundary>,
);
