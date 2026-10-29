/** Project-less conversation shell. No project client, task or Send is created. */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FiArrowUp,
  FiFolder,
  FiGlobe,
  FiMenu,
  FiSidebar,
} from "react-icons/fi";
import { useT } from "../../i18n/locale";
import type { DrawerSide } from "../../layout/swipe-drawer";
import { useDrawerFocus } from "../../layout/use-drawer-focus";
import { useSwipeDrawer } from "../../layout/use-swipe-drawer";
import { ChatWelcome } from "./ChatWelcome";
import { ConversationActions } from "./ConversationActions";
import { WorkingFolderButton } from "./WorkingFolderButton";

export function WorkbenchHome({
  ready,
  onOpenFolder,
  children,
}: {
  ready: boolean;
  onOpenFolder(): void;
  children?: ReactNode;
}) {
  const { t, locale, setLocale } = useT();
  const [drawer, setDrawer] = useState<DrawerSide | null>(null);
  const [mobile, setMobile] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const layout = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const change = () => setMobile(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useSwipeDrawer({
    enabled: mobile,
    open: drawer,
    onOpenChange: setDrawer,
    container: layout,
  });
  useDrawerFocus(layout, drawer, mobile, closeDrawer);
  const openFolder = () => {
    closeDrawer();
    onOpenFolder();
  };
  return (
    <div
      className={`app workbench-entry${filesOpen ? "" : " inspector-hidden"}`}
    >
      <header className="topbar">
        <button
          type="button"
          className="panel-toggle"
          aria-label={t("Tasks")}
          onClick={() =>
            setDrawer((value) => (value === "left" ? null : "left"))
          }
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
          <span className="tb-spacer" />
          <div className="tb-actions">
            <button
              type="button"
              className="chip chip-lang"
              lang={locale === "zh" ? "en" : "zh-CN"}
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
            >
              <FiGlobe aria-hidden="true" />
              <span>{locale === "zh" ? "EN" : "中文"}</span>
            </button>
          </div>
        </div>
        <button
          type="button"
          className="panel-toggle has-label inspector-toggle"
          aria-label={t("Files")}
          aria-expanded={mobile ? drawer === "right" : filesOpen}
          onClick={() =>
            mobile
              ? setDrawer((value) => (value === "right" ? null : "right"))
              : setFilesOpen((value) => !value)
          }
        >
          <FiSidebar aria-hidden="true" />
          <span>{t("Files")}</span>
        </button>
      </header>
      {children}
      <div className="layout" ref={layout}>
        <button
          type="button"
          aria-label={t("Close drawer")}
          tabIndex={-1}
          className={`drawer-backdrop persistent${drawer ? " on" : ""}`}
          onClick={closeDrawer}
        />
        <section
          className={`panel-drawer drawer-left${drawer === "left" ? " open" : ""}`}
          aria-label={t("Task navigation drawer")}
          tabIndex={-1}
          inert={mobile && drawer !== "left"}
        >
          <aside className="panel panel-left lp-panel">
            <ConversationActions
              onConversation={openFolder}
              disabled={!ready}
            />
            <section className="lp-section">
              <header className="lp-section-header">
                <span className="lp-section-title">
                  {t("Conversation history")}
                </span>
              </header>
              <p className="panel-hint">{t("No conversations yet.")}</p>
            </section>
          </aside>
        </section>
        <main className="main" inert={mobile && drawer !== null}>
          <section
            className="chat-workspace"
            aria-label={t("Ordinary conversation")}
          >
            <div className="chat-messages">
              <ChatWelcome />
            </div>
            <div className="chat-composer">
              <textarea
                disabled
                aria-label={t("Message")}
                rows={3}
                placeholder={t(
                  "Choose a working folder at the bottom right to start chatting.",
                )}
              />
              <div className="composer-toolbar">
                <span className="composer-hint">
                  {t("Ordinary conversation")}
                </span>
                <button type="button" className="primary" disabled>
                  <FiArrowUp aria-hidden="true" />
                  {t("Send")}
                </button>
              </div>
            </div>
          </section>
        </main>
        <section
          className={`panel-drawer drawer-right${drawer === "right" ? " open" : ""}`}
          aria-label={t("Files")}
          tabIndex={-1}
          inert={mobile && drawer !== "right"}
        >
          <aside className="panel files-panel">
            <header className="files-toolbar">
              <FiFolder aria-hidden="true" />
              {t("Files")}
            </header>
            <p className="panel-hint">
              {t("Files appear here after you open a working folder.")}
            </p>
          </aside>
        </section>
      </div>
      <footer className="statusbar">
        <div className="statusbar-left">
          <span className="status-item faint">
            {t("No working folder selected")}
          </span>
        </div>
        <div className="statusbar-right">
          <WorkingFolderButton disabled={!ready} onClick={openFolder} />
        </div>
      </footer>
    </div>
  );
}
