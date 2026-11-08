/** Project-less conversation shell. No project client, task or Send is created.
 * History belongs to each project; one click on a recent project is its
 * nonactivating selection, and the central action opens the folder picker. */
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import {
  FiArrowUp,
  FiFolder,
  FiGlobe,
  FiMenu,
  FiServer,
  FiSidebar,
} from "react-icons/fi";
import type { ModelSelector } from "../../../../src/service-contract.ts";
import type { PreviewModels } from "../../client/model-preview";
import { useModelCatalog } from "../../client/use-model-catalog";
import { useT } from "../../i18n/locale";
import { useDrawerFocus } from "../../layout/use-drawer-focus";
import { usePanelLayout } from "../../layout/use-panel-layout";
import { useSwipeDrawer } from "../../layout/use-swipe-drawer";
import { ModelPicker } from "../actions/ModelPicker";
import { ActivityList, type ActivityListProps } from "./ActivityList";
import { ChatWelcome } from "./ChatWelcome";
import { WorkingFolderButton } from "./WorkingFolderButton";

export function WorkbenchHome({
  ready,
  previewModels,
  model,
  onModelChoice,
  projects = [],
  restore = null,
  opening = null,
  onOpenFolder,
  onOpenProject,
  onOpenService,
  children,
  discovery,
}: {
  ready: boolean;
  previewModels?: PreviewModels;
  model?: ModelSelector | null;
  onModelChoice?(model: ModelSelector): void;
  projects?: readonly string[];
  restore?: { status: "checking" | "unavailable"; path: string } | null;
  /** The recent project being opened, if any. */
  opening?: string | null;
  onOpenFolder(path?: string): void;
  /** Select a recent directory; without it, a click preselects the picker. */
  onOpenProject?(path: string): void;
  /** The workbench's service restart and upgrade. */
  onOpenService?(): void;
  children?: ReactNode;
  discovery?: ActivityListProps;
}) {
  const { t, locale, setLocale } = useT();
  const [modelOpen, setModelOpen] = useState(false);
  const modelRead = useModelCatalog(
    null,
    { status: "not-started" },
    "home",
    previewModels,
  );
  const panels = usePanelLayout();
  const { mobile, overlay: drawer, closeDrawer } = panels;
  const layout = useRef<HTMLDivElement>(null);
  useSwipeDrawer({
    enabled: mobile,
    open: drawer,
    onOpenChange: panels.setDrawer,
    container: layout,
  });
  useDrawerFocus(layout, drawer, !!drawer, closeDrawer);
  const openFolder = (path?: string) => {
    closeDrawer();
    onOpenFolder(path);
  };
  const openProject = (path: string) => {
    closeDrawer();
    if (onOpenProject) onOpenProject(path);
    else onOpenFolder(path);
  };
  const name = (path: string) =>
    path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return (
    <div className={`app workbench-entry${panels.className}`}>
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
          <span className="tb-spacer" />
          <div className="tb-actions">
            {onOpenService && (
              <button
                type="button"
                className="chip"
                aria-label={t("Cadence service")}
                data-tip={t("Cadence service")}
                onClick={onOpenService}
              >
                <FiServer aria-hidden="true" />
              </button>
            )}
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
          aria-label={t("Toggle workspace panels")}
          aria-expanded={mobile ? drawer === "right" : panels.inspector}
          onClick={() => panels.toggle("right")}
        >
          <FiSidebar aria-hidden="true" />
          <span>{t("Files")}</span>
        </button>
      </header>
      {children}
      <div
        className="layout"
        ref={layout}
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
          <aside className="panel panel-left lp-panel">
            {discovery && <ActivityList {...discovery} />}
            <section className="lp-section grow">
              <header className="lp-section-header">
                <span className="lp-section-title">
                  {t("Conversation history")}
                </span>
              </header>
              <div className="lp-section-body">
                <p className="panel-hint" role="status">
                  {restore?.status === "checking"
                    ? t("Returning to your last project {name}…", {
                        name: name(restore.path),
                      })
                    : restore?.status === "unavailable"
                      ? t(
                          "The retained conversations for {name} could not be observed. Choose a folder explicitly; nothing was started.",
                          { name: name(restore.path) },
                        )
                      : projects.length
                        ? t(
                            "Conversations stay with their folder. Select one to read its history; Send prepares execution.",
                          )
                        : t(
                            "Choose a working folder to see its conversation history.",
                          )}
                </p>
                {projects.map((path) => (
                  <button
                    type="button"
                    className="session-item project-item"
                    key={path}
                    title={path}
                    disabled={!ready || !!opening}
                    aria-busy={opening === path}
                    onClick={() => openProject(path)}
                  >
                    <span className="session-icon">
                      <FiFolder aria-hidden="true" />
                    </span>
                    <span className="session-info">
                      <span className="session-title">{name(path)}</span>
                      <span className="session-sub">
                        {opening === path ? t("Selecting folder…") : path}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </section>
        <main className="main" inert={drawer !== null}>
          <section
            className="chat-workspace"
            aria-label={t("Ordinary conversation")}
          >
            <div className="chat-messages">
              <ChatWelcome
                hint={t(
                  "Choose a working folder. Execution is prepared only when you send.",
                )}
              >
                <button
                  type="button"
                  className="primary welcome-action"
                  disabled={!ready}
                  onClick={() => openFolder()}
                >
                  <FiFolder aria-hidden="true" />
                  {t("Choose a folder…")}
                </button>
              </ChatWelcome>
            </div>
            <div className="chat-composer">
              <textarea
                disabled
                aria-label={t("Message")}
                rows={3}
                placeholder={t("Choose a working folder to start chatting.")}
              />
              <div className="composer-toolbar">
                <ModelPicker
                  scope="next-conversation"
                  availability={{ status: "not-started" }}
                  read={modelRead}
                  draftModel={model}
                  onPreviewChoice={onModelChoice}
                  locked={!ready}
                  open={modelOpen}
                  onOpenChange={(open) => {
                    if (open && !modelRead.preview && !modelRead.loading)
                      modelRead.reread();
                    setModelOpen(open);
                  }}
                  onChanged={() => {}}
                />
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
          inert={mobile ? drawer !== "right" : !panels.inspector}
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
          <WorkingFolderButton disabled={!ready} onClick={() => openFolder()} />
        </div>
      </footer>
    </div>
  );
}
