/* Replaces the pi-web-ui-adapted entry. MIT (c) 2026 xing-shuyin.
 * The conversation shell's initial/missing-folder state, not a project home.
 * No project client or Send exists until a directory has been selected. */
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { FiArrowUp, FiFolder } from "react-icons/fi";
import { emptyFolderDraft, type FolderDraft } from "../../client/folder-draft";
import type { PreviewModels } from "../../client/model-preview";
import { useModelCatalog } from "../../client/use-model-catalog";
import { useT } from "../../i18n/locale";
import { AppShell } from "../../layout/AppShell";
import { usePanelLayout } from "../../layout/use-panel-layout";
import { ModelPicker } from "../actions/ModelPicker";
import { ActivityList, type ActivityListProps } from "./ActivityList";
import {
  composerHeightCap,
  composerMinHeight,
  composerMobileHeightCap,
} from "./ChatComposer";
import { ChatWelcome } from "./ChatWelcome";
import { ConversationActions } from "./ConversationActions";
import { WorkingFolderButton } from "./WorkingFolderButton";

import { WorkspaceConnection } from "./WorkspaceNotice";

export function FolderSetup({
  ready,
  previewModels,
  draft = emptyFolderDraft(),
  onDraftChange,
  restoring,
  missing,
  pending = !ready,
  entryError,
  restoreError,
  onChooseFolder,
  onRefresh,
  onOpenService,
  notices,
  discovery,
}: {
  ready: boolean;
  previewModels?: PreviewModels;
  draft?: FolderDraft;
  onDraftChange?(draft: FolderDraft): void;
  restoring?: string;
  missing?: boolean;
  pending?: boolean;
  entryError?: string;
  restoreError?: string;
  onChooseFolder(): void;
  onRefresh(): void;
  onOpenService?(): void;
  notices?: ReactNode;
  discovery?: ActivityListProps;
}) {
  const { t } = useT();
  const panels = usePanelLayout();
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const modelRead = useModelCatalog(
    null,
    { status: "not-started" },
    "folder-setup",
    previewModels,
  );
  useLayoutEffect(() => {
    void draft.text;
    const ta = draftInput.current;
    if (!ta) return;
    const vh =
      typeof window === "undefined"
        ? 0
        : Math.round(window.visualViewport?.height || window.innerHeight);
    const min = composerMinHeight(
      typeof window === "undefined" ? 0 : window.innerWidth,
    );
    const cap = panels.mobile
      ? composerMobileHeightCap(vh)
      : composerHeightCap(vh);
    ta.style.height = "auto";
    const natural = ta.scrollHeight;
    const next = Math.min(Math.max(natural, min), cap);
    ta.style.height = `${next}px`;
    ta.style.overflowY = natural > next ? "auto" : "hidden";
  }, [draft.text, panels.mobile]);
  const choose = () => {
    panels.closeDrawer();
    onChooseFolder();
  };
  return (
    <AppShell
      panels={panels}
      mobileTitle="Cadence"
      mobileStatusDot={
        entryError || restoreError ? "error" : pending ? "busy" : ""
      }
      onRefresh={onRefresh}
      onOpenService={onOpenService}
      notices={notices}
      navigation={
        <aside className="panel panel-left lp-panel">
          <ConversationActions disabled={!ready} onConversation={choose} />
          {discovery && <ActivityList {...discovery} />}
          <section className="lp-section grow">
            <header className="lp-section-header">
              <span className="lp-section-title">
                {t("Conversation history")}
              </span>
            </header>
            <div className="lp-section-body">
              <p className="panel-hint" role="status">
                {t("Choose a working folder to see its conversation history.")}
              </p>
            </div>
          </section>
        </aside>
      }
      content={
        <section
          className="chat-workspace"
          aria-label={t("Ordinary conversation")}
        >
          <div className="chat-messages">
            <ChatWelcome
              hint={t(
                "Choose a working folder to start. You can write a draft below.",
              )}
            >
              <button
                type="button"
                className="primary welcome-action"
                disabled={!ready}
                onClick={choose}
              >
                <FiFolder aria-hidden="true" />
                {t("Choose a folder…")}
              </button>
              {missing && (
                <p className="panel-hint" role="status">
                  {t(
                    "This folder is unavailable. Choose another folder; nothing was moved or recreated.",
                  )}
                </p>
              )}
            </ChatWelcome>
          </div>
          <div className="composer-dock">
            <div className="chat-composer">
              <textarea
                ref={draftInput}
                aria-label={t("Message")}
                rows={1}
                value={draft.text}
                onChange={(event) =>
                  onDraftChange?.({ ...draft, text: event.target.value })
                }
                placeholder={t(
                  "Write a message. Choose a folder before sending…",
                )}
              />
              <div className="composer-toolbar">
                <ModelPicker
                  availability={{ status: "not-started" }}
                  read={modelRead}
                  draftModel={draft.model}
                  onPreviewChoice={
                    onDraftChange
                      ? (model) => onDraftChange({ ...draft, model })
                      : undefined
                  }
                  locked={!ready}
                  onOpenChange={(open) => {
                    if (open) modelRead.reread(false, { background: true });
                  }}
                  onChanged={() => {}}
                />
                <span className="composer-hint">
                  {t("Choose a folder before sending.")}
                </span>
                <span className="composer-mobile-sep" aria-hidden="true" />
                <div className="composer-toolbar composer-delivery">
                  <button
                    type="button"
                    className="primary"
                    aria-label={t("Send")}
                    title={t("Send")}
                    disabled
                  >
                    <FiArrowUp aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      }
      inspector={
        <aside className="panel files-panel">
          <p className="panel-hint">
            {t("Files appear here after you open a working folder.")}
          </p>
        </aside>
      }
      status={
        <WorkspaceConnection
          phase={pending ? (ready ? "updating" : "connecting") : "folder"}
          entryError={entryError}
          projectError={restoreError}
          retained={ready && !restoring}
          latency={null}
          onRefresh={onRefresh}
        />
      }
      folder={<WorkingFolderButton disabled={!ready} onClick={choose} />}
    />
  );
}
