/* Extracted from the pi-web-ui-adapted App. MIT (c) 2026 xing-shuyin.
 * Shared conversation chrome for folder setup and selected conversations.
 * Presentation only: no client, owner, execution context or navigation route. */
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import {
  FiChevronRight,
  FiFolder,
  FiGlobe,
  FiLogOut,
  FiMenu,
  FiMonitor,
  FiMoon,
  FiMoreHorizontal,
  FiRefreshCw,
  FiServer,
  FiSidebar,
  FiSun,
} from "react-icons/fi";
import { localBuild } from "../client/build-identity";
import { type MessageKey, Template, useT } from "../i18n/locale";
import { ResizeHandle } from "./ResizeHandle";
import { ToastStack } from "./ToastStack";
import {
  chooseTheme,
  currentTheme,
  nextTheme,
  type ThemeChoice,
} from "./theme";
import { useDrawerFocus } from "./use-drawer-focus";
import type { usePanelLayout } from "./use-panel-layout";
import { useSwipeDrawer } from "./use-swipe-drawer";

const THEMES: Readonly<
  Record<ThemeChoice, readonly [typeof FiSun, MessageKey]>
> = {
  system: [FiMonitor, "System"],
  light: [FiSun, "Light"],
  dark: [FiMoon, "Dark"],
};

export function AppShell({
  panels,
  navigation,
  inspector,
  inspectorLabel,
  inspectorTabs,
  toolbar,
  actions,
  notices,
  status,
  folder,
  onRefresh,
  onDisconnect,
  onOpenService,
  content,
}: {
  panels: ReturnType<typeof usePanelLayout>;
  navigation: ReactNode;
  inspector: ReactNode;
  inspectorLabel?: string;
  /** The inspector's tab buttons; one Files tab when absent. */
  inspectorTabs?: ReactNode;
  toolbar?: ReactNode;
  actions?: ReactNode;
  notices?: ReactNode;
  status: ReactNode;
  folder: ReactNode;
  onRefresh(): void;
  onDisconnect?(): void;
  onOpenService?(): void;
  content: ReactNode;
}) {
  const { t, locale, setLocale } = useT();
  const [theme, setTheme] = useState(currentTheme);
  const [ThemeIcon, themeName] = THEMES[theme];
  const themeTip = t("Theme: {current}. Switch to {next}.", {
    current: t(themeName),
    next: t(THEMES[nextTheme(theme)][1]),
  });
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
            <button
              type="button"
              className="chip chip-theme"
              aria-label={themeTip}
              data-tip={themeTip}
              onClick={() => {
                const next = nextTheme(theme);
                chooseTheme(next);
                setTheme(next);
              }}
            >
              <ThemeIcon aria-hidden="true" />
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
                  className="more-menu-build"
                  title={localBuild?.buildId ?? t("unbuilt source")}
                >
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
          <div className="workbench-right">
            <nav className="rp-tabs" aria-label={t("Workspace panels")}>
              {inspectorTabs ?? (
                <span className="rp-tab" aria-current="true">
                  <FiFolder aria-hidden="true" />
                  {t("Files")}
                </span>
              )}
              <button
                type="button"
                className="panel-collapse-btn"
                aria-label={t("Collapse panel")}
                title={t("Collapse panel")}
                onClick={() => panels.toggle("right")}
              >
                <FiChevronRight aria-hidden="true" />
              </button>
            </nav>
            {inspector}
          </div>
        </section>
      </div>
      <footer className="statusbar">
        <div className="statusbar-left">{status}</div>
        <div className="statusbar-right">{folder}</div>
      </footer>
      <ToastStack />
    </div>
  );
}
