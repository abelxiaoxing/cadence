/* Replaces the pi-web-ui-adapted entry. MIT (c) 2026 xing-shuyin.
 * The conversation shell's initial/missing-folder state, not a project home.
 * No project client or Send exists until a directory has been selected. */
import { type ReactNode, useState } from "react";
import { FiArrowUp, FiFolder } from "react-icons/fi";
import { emptyFolderDraft, type FolderDraft } from "../../client/folder-draft";
import type { PreviewModels } from "../../client/model-preview";
import { useModelCatalog } from "../../client/use-model-catalog";
import { useT } from "../../i18n/locale";
import { AppShell } from "../../layout/AppShell";
import { StatusItem } from "../../layout/StatusItem";
import { usePanelLayout } from "../../layout/use-panel-layout";
import { ModelPicker } from "../actions/ModelPicker";
import { ActivityList, type ActivityListProps } from "./ActivityList";
import { ChatWelcome } from "./ChatWelcome";
import { ConversationActions } from "./ConversationActions";
import { WorkingFolderButton } from "./WorkingFolderButton";

export function FolderSetup({
  ready,
  previewModels,
  draft = emptyFolderDraft(),
  onDraftChange,
  restore,
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
  restore?: { status: "checking" | "unavailable"; path: string } | null;
  onChooseFolder(): void;
  onRefresh(): void;
  onOpenService?(): void;
  notices?: ReactNode;
  discovery?: ActivityListProps;
}) {
  const { t } = useT();
  const panels = usePanelLayout();
  const [modelOpen, setModelOpen] = useState(false);
  const modelRead = useModelCatalog(
    null,
    { status: "not-started" },
    "folder-setup",
    previewModels,
  );
  const choose = () => {
    panels.closeDrawer();
    onChooseFolder();
  };
  return (
    <AppShell
      panels={panels}
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
              {restore && (
                <p className="panel-hint" role="status">
                  {restore.status === "checking"
                    ? t("Returning to your last folder {path}…", {
                        path: restore.path,
                      })
                    : t(
                        "Could not restore {path}. Choose a folder to continue; nothing was started.",
                        { path: restore.path },
                      )}
                </p>
              )}
            </ChatWelcome>
          </div>
          <div className="chat-composer">
            <textarea
              aria-label={t("Message")}
              rows={3}
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
                scope="next-conversation"
                availability={{ status: "not-started" }}
                read={modelRead}
                draftModel={draft.model}
                onPreviewChoice={
                  onDraftChange
                    ? (model) => onDraftChange({ ...draft, model })
                    : undefined
                }
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
                {t("Choose a folder before sending.")}
              </span>
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
        <StatusItem tone="faint">{t("Choose a working folder")}</StatusItem>
      }
      folder={<WorkingFolderButton disabled={!ready} onClick={choose} />}
    />
  );
}
