/* Extracted from the pi-web-ui-adapted App. MIT (c) 2026 xing-shuyin.
 * Shared conversation chrome for folder setup and selected conversations.
 * Presentation only: no client, owner, execution context or navigation route. */
import { type CSSProperties, type ReactNode, useRef } from "react";
import {
  FiGlobe,
  FiLogOut,
  FiMenu,
  FiMoreHorizontal,
  FiRefreshCw,
  FiServer,
  FiSidebar,
} from "react-icons/fi";
import { localBuild } from "../client/build-identity";
import { Template, useT } from "../i18n/locale";
import { ResizeHandle } from "./ResizeHandle";
import { useDrawerFocus } from "./use-drawer-focus";
import type { usePanelLayout } from "./use-panel-layout";
import { useSwipeDrawer } from "./use-swipe-drawer";

export function AppShell({
  panels,
  navigation,
  inspector,
  inspectorLabel,
  toolbar,
  actions,
  notices,
  status,
  folder,
  compatible,
  onRefresh,
  onDisconnect,
  onOpenService,
  content,
}: {
  panels: ReturnType<typeof usePanelLayout>;
  navigation: ReactNode;
  inspector: ReactNode;
  inspectorLabel?: string;
  toolbar?: ReactNode;
  actions?: ReactNode;
  notices?: ReactNode;
  status: ReactNode;
  folder: ReactNode;
  compatible?: boolean;
  onRefresh(): void;
  onDisconnect?(): void;
  onOpenService?(): void;
  content: ReactNode;
}) {
  const { t, locale, setLocale } = useT();
  const { mobile, overlay: drawer, closeDrawer } = panels;
  const layout = useRef<HTMLDivElement>(null);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const closeMore = () => {
    if (moreMenu.current) moreMenu.current.open = false;
  };
  useSwipeDrawer({
    enabled: mobile,
    open: drawer,
    onOpenChange: panels.setDrawer,
    container: layout,
  });
  useDrawerFocus(layout, drawer, !!drawer, closeDrawer);
  return (
    <div className={`app${panels.className}`}>
      <header className="topbar">
        <button
          type="button"
          className="panel-toggle navigation-toggle"
          aria-label={t("Toggle conversation navigation")}
          aria-expanded={mobile ? drawer === "left" : panels.navigation}
          onClick={() => panels.toggle("left")}
        >
          <FiMenu aria-hidden="true" />
        </button>
        <div className="topbar-flow">
          <span className="brand">
            <span className="brand-logo" aria-hidden="true">
              C
            </span>
            <h1 className="brand-name">Cadence</h1>
          </span>
          <span className="tb-spacer" aria-hidden="true" />
          {toolbar}
          <span className="tb-spacer" aria-hidden="true" />
          <div className="tb-actions">
            {actions}
            <button
              type="button"
              className="chip chip-lang"
              lang={locale === "zh" ? "en" : "zh-CN"}
              aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
              data-tip={locale === "zh" ? "Switch to English" : "切换到中文"}
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            >
              <FiGlobe aria-hidden="true" />
              <span>{locale === "zh" ? "EN" : "中文"}</span>
            </button>
            <details
              className="more-menu"
              ref={moreMenu}
              onKeyDown={(event) => {
                if (event.key === "Escape" && moreMenu.current) {
                  moreMenu.current.open = false;
                  moreMenu.current.querySelector("summary")?.focus();
                }
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  event.currentTarget.open = false;
              }}
            >
              <summary
                className="chip"
                aria-label={t("More")}
                title={t("More")}
              >
                <FiMoreHorizontal aria-hidden="true" />
              </summary>
              <div className="more-menu-items">
                <button
                  type="button"
                  aria-label={t("Observe current state")}
                  onClick={() => {
                    closeMore();
                    onRefresh();
                  }}
                >
                  <FiRefreshCw aria-hidden="true" />
                  {t("Refresh status")}
                </button>
                {onOpenService && (
                  <button
                    type="button"
                    aria-label={t("Cadence service")}
                    onClick={() => {
                      closeMore();
                      onOpenService();
                    }}
                  >
                    <FiServer aria-hidden="true" />
                    <span className="more-menu-text">
                      {t("Cadence service")}
                      <small>{t("Version, restart and upgrade.")}</small>
                    </span>
                  </button>
                )}
                {onDisconnect && (
                  <button
                    type="button"
                    aria-label={t("Disconnect this page")}
                    title={t("Return — accepted work continues")}
                    onClick={() => {
                      closeMore();
                      closeDrawer();
                      onDisconnect();
                    }}
                  >
                    <FiLogOut aria-hidden="true" />
                    <span className="more-menu-text">
                      {t("Disconnect this page")}
                      <small>{t("Started work keeps running.")}</small>
                    </span>
                  </button>
                )}
                <div
                  className={`more-menu-build${compatible === false ? " warn" : ""}`}
                  title={localBuild?.buildId ?? t("unbuilt source")}
                >
                  <span>
                    {t("Shared compatibility: {state}.", {
                      state:
                        compatible === undefined
                          ? t("Execution compatibility not observed")
                          : compatible
                            ? t("compatible")
                            : t(
                                "unavailable / mismatch — reload built assets; normal actions disabled",
                              ),
                    })}
                  </span>
                  <Template
                    text={t("Local browser build: {build}.")}
                    slots={{
                      build: (
                        <code>
                          {localBuild?.buildId ?? t("unbuilt source")}
                        </code>
                      ),
                    }}
                  />
                </div>
              </div>
            </details>
          </div>
        </div>
        <button
          type="button"
          className="panel-toggle has-label inspector-toggle"
          aria-label={t("Toggle workspace panels")}
          aria-expanded={mobile ? drawer === "right" : panels.inspector}
          onClick={() => panels.toggle("right")}
        >
          <FiSidebar aria-hidden="true" />
          <span>{inspectorLabel ?? t("Files")}</span>
        </button>
      </header>
      {notices}
      <div
        ref={layout}
        className="layout"
        style={
          {
            "--left-w": `${panels.left}px`,
            "--right-w": `${panels.right}px`,
          } as CSSProperties
        }
      >
        <button
          type="button"
          aria-label={t("Close drawer")}
          tabIndex={-1}
          className={`drawer-backdrop persistent${drawer ? " on" : ""}`}
          onClick={closeDrawer}
        />
        <section
          className={`panel-drawer drawer-left${drawer === "left" ? " open" : ""}`}
          aria-label={t("Conversation navigation")}
          tabIndex={-1}
          inert={
            mobile
              ? drawer !== "left"
              : !panels.navigation || drawer === "right"
          }
        >
          {navigation}
        </section>
        <ResizeHandle
          side="left"
          width={panels.left}
          maximum={panels.leftMaximum}
          onResize={(width) => panels.resize("left", width)}
        />
        <main className="main" inert={drawer !== null}>
          {content}
        </main>
        <ResizeHandle
          side="right"
          width={panels.right}
          maximum={panels.rightMaximum}
          onResize={(width) => panels.resize("right", width)}
        />
        <section
          className={`panel-drawer drawer-right${drawer === "right" ? " open" : ""}`}
          aria-label={t("Files and history drawer")}
          tabIndex={-1}
          inert={mobile ? drawer !== "right" : !panels.inspector}
        >
          {inspector}
        </section>
      </div>
      <footer className="statusbar">
        <div className="statusbar-left">{status}</div>
        <div className="statusbar-right">{folder}</div>
      </footer>
    </div>
  );
}
