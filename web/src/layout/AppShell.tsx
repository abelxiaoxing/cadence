/* Extracted from the pi-web-ui-adapted App. MIT (c) 2026 xing-shuyin.
 * Shared conversation chrome for folder setup and selected conversations.
 * Presentation only: no client, owner, execution context or navigation route. */
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FiChevronDown,
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
  FiX,
} from "react-icons/fi";
import { type MessageKey, useT } from "../i18n/locale";
import { Crystal } from "../optics/Crystal";
import { ResizeHandle } from "./ResizeHandle";
import { ToastStack } from "./ToastStack";
import {
  chooseTheme,
  currentTheme,
  nextTheme,
  type ThemeChoice,
} from "./theme";
import { useDrawerFocus } from "./use-drawer-focus";
import { useMobileViewport } from "./use-mobile-viewport";
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
  mobileTitle,
  mobileStatusDot,
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
  /** Compact single-row title shown in the mobile topbar; opens the detail sheet. */
  mobileTitle?: string;
  /** Glanceable status indicator beside the mobile topbar title. */
  mobileStatusDot?: "ok" | "busy" | "error" | "";
  onRefresh(): void;
  onDisconnect?(): void;
  onOpenService?(): void;
  content: ReactNode;
}) {
  const { t, locale, setLocale } = useT();
  const [theme, setTheme] = useState(currentTheme);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ThemeIcon, themeName] = THEMES[theme];
  const themeTip = t("Theme: {current}. Switch to {next}.", {
    current: t(themeName),
    next: t(THEMES[nextTheme(theme)][1]),
  });
  const { mobile, overlay: drawer, closeDrawer } = panels;
  const layout = useRef<HTMLDivElement>(null);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const mobileFolderBox = useRef<HTMLDivElement>(null);
  const mobileTitleButton = useRef<HTMLButtonElement>(null);
  const mobileDetailsSheet = useRef<HTMLElement>(null);
  const hasFolder = Boolean(folder);
  const closeMore = () => {
    if (moreMenu.current) moreMenu.current.open = false;
  };
  useMobileViewport(mobile);
  useEffect(() => {
    if (!mobile) setDetailsOpen(false);
  }, [mobile]);
  useEffect(() => {
    if (!detailsOpen) return;
    mobileDetailsSheet.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDetailsOpen(false);
      mobileTitleButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailsOpen]);
  useEffect(() => {
    const box = mobileFolderBox.current;
    if (!mobile || !detailsOpen || !hasFolder || !box) return;
    const closeOnFolderAction = (event: Event) => {
      if ((event.target as Element | null)?.closest("button"))
        setDetailsOpen(false);
    };
    box.addEventListener("click", closeOnFolderAction);
    return () => box.removeEventListener("click", closeOnFolderAction);
  }, [mobile, detailsOpen, hasFolder]);
  useSwipeDrawer({
    enabled: mobile && !detailsOpen,
    open: drawer,
    onOpenChange: panels.setDrawer,
    container: layout,
  });
  useDrawerFocus(layout, drawer, !!drawer, closeDrawer);
  const toggleTheme = () => {
    const next = nextTheme(theme);
    chooseTheme(next);
    setTheme(next);
  };
  const toggleLocale = () => setLocale(locale === "zh" ? "en" : "zh");
  const titleText = mobileTitle || "Cadence";
  return (
    <div
      className={`app${panels.className}${mobile ? " is-mobile" : ""} antialiased`}
    >
      <header
        className={`topbar${mobile ? " mobile-topbar" : ""}`}
        inert={mobile && detailsOpen}
      >
        <button
          type="button"
          className="panel-toggle navigation-toggle"
          aria-label={t("Toggle conversation navigation")}
          aria-expanded={mobile ? drawer === "left" : panels.navigation}
          onClick={() => {
            setDetailsOpen(false);
            panels.toggle("left");
          }}
        >
          <FiMenu aria-hidden="true" />
        </button>
        {mobile ? (
          <>
            <button
              ref={mobileTitleButton}
              type="button"
              className="mobile-title-trigger"
              aria-label={t("Session details")}
              aria-haspopup="dialog"
              aria-expanded={detailsOpen}
              onClick={() => {
                closeDrawer();
                setDetailsOpen((open) => !open);
              }}
            >
              {mobileStatusDot ? (
                <span
                  className={`status-dot ${mobileStatusDot}`}
                  aria-hidden="true"
                />
              ) : null}
              <span className="mobile-title-text">{titleText}</span>
              <FiChevronDown
                className="mobile-title-chevron"
                aria-hidden="true"
              />
            </button>
            {actions && (
              <div className="tb-actions mobile-tb-actions">{actions}</div>
            )}
          </>
        ) : (
          <div className="topbar-flow">
            <span className="brand">
              <span className="brand-logo" aria-hidden="true">
                <Crystal />
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
                aria-label={
                  locale === "zh" ? "Switch to English" : "切换到中文"
                }
                data-tip={locale === "zh" ? "Switch to English" : "切换到中文"}
                onClick={toggleLocale}
              >
                <FiGlobe aria-hidden="true" />
                <span>{locale === "zh" ? "EN" : "中文"}</span>
              </button>
              <button
                type="button"
                className="chip chip-theme"
                aria-label={themeTip}
                data-tip={themeTip}
                onClick={toggleTheme}
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
                </div>
              </details>
            </div>
          </div>
        )}
        <button
          type="button"
          className="panel-toggle has-label inspector-toggle"
          aria-label={t("Toggle workspace panels")}
          aria-expanded={mobile ? drawer === "right" : panels.inspector}
          onClick={() => {
            setDetailsOpen(false);
            panels.toggle("right");
          }}
        >
          <FiSidebar aria-hidden="true" />
          <span>{inspectorLabel ?? t("Files")}</span>
        </button>
        {mobile && toolbar}
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
        <main className="main" inert={drawer !== null || detailsOpen}>
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
            <div className="workbench-right-body">{inspector}</div>
          </div>
        </section>
      </div>
      {mobile ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("Close details")}
            className={`mobile-details-backdrop${detailsOpen ? " on" : ""}`}
            hidden={!detailsOpen}
            onClick={() => setDetailsOpen(false)}
          />
          <section
            ref={mobileDetailsSheet}
            tabIndex={-1}
            className={`mobile-details-sheet${detailsOpen ? " open" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={t("Session details")}
            hidden={!detailsOpen}
          >
            <header className="mobile-details-head">
              <div className="mobile-details-title">
                <span className="brand-logo" aria-hidden="true">
                  <Crystal />
                </span>
                <h2>{titleText}</h2>
              </div>
              <button
                type="button"
                className="ghost icon"
                aria-label={t("Close details")}
                onClick={() => {
                  setDetailsOpen(false);
                  mobileTitleButton.current?.focus({ preventScroll: true });
                }}
              >
                <FiX aria-hidden="true" />
              </button>
            </header>
            <div className="mobile-details-body">
              {folder && (
                <div className="mobile-details-section">
                  <h3>{t("Working folder")}</h3>
                  <div className="mobile-details-folder" ref={mobileFolderBox}>
                    {folder}
                  </div>
                </div>
              )}
              <div className="mobile-details-section">
                <h3>{t("Status")}</h3>
                <div className="mobile-details-status">{status}</div>
              </div>
              <div className="mobile-details-section">
                <h3>{t("Preferences")}</h3>
                <div className="mobile-details-actions">
                  <button
                    type="button"
                    lang={locale === "zh" ? "en" : "zh-CN"}
                    aria-label={
                      locale === "zh" ? "Switch to English" : "切换到中文"
                    }
                    onClick={toggleLocale}
                  >
                    <FiGlobe aria-hidden="true" />
                    <span>
                      {locale === "zh"
                        ? "Switch to English (EN)"
                        : "切换到中文"}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={themeTip}
                    onClick={toggleTheme}
                  >
                    <ThemeIcon aria-hidden="true" />
                    <span>{t(themeName)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("Observe current state")}
                    onClick={() => {
                      setDetailsOpen(false);
                      onRefresh();
                    }}
                  >
                    <FiRefreshCw aria-hidden="true" />
                    <span>{t("Refresh status")}</span>
                  </button>
                  {onOpenService && (
                    <button
                      type="button"
                      aria-label={t("Cadence service")}
                      onClick={() => {
                        setDetailsOpen(false);
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
                        setDetailsOpen(false);
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
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <footer className="statusbar">
          <div className="statusbar-left">{status}</div>
          <div className="statusbar-right">{folder}</div>
        </footer>
      )}
      <ToastStack />
    </div>
  );
}
