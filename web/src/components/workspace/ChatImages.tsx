import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatImage } from "../../../../src/service/contracts/workbench.ts";
import type { TurnSource } from "../../client/conversation-reader";
import { validatedImageFile, validateImageFiles } from "../../client/images";
import { useT } from "../../i18n/locale";

export function useImageDraft() {
  const [files, setFiles] = useState<readonly File[]>([]);
  const current = useRef(files);
  const keys = useRef(new WeakMap<File, string>());
  const add = (added: File[]) => {
    const next = [...new Set([...current.current, ...added])];
    validateImageFiles(next);
    for (const file of added)
      if (!keys.current.has(file)) keys.current.set(file, crypto.randomUUID());
    current.current = next;
    setFiles(next);
  };
  const remove = useCallback((removed: readonly File[]) => {
    current.current = current.current.filter((f) => !removed.includes(f));
    setFiles(current.current);
  }, []);
  return { files, add, remove, key: (file: File) => keys.current.get(file) };
}
export function DraftImage({
  file,
  disabled,
  remove,
}: {
  file: File;
  disabled: boolean;
  remove(): void;
}) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true,
      url = "";
    setUrl("");
    setFailed(false);
    void validatedImageFile(file)
      .then(() => {
        if (!current) return;
        url = URL.createObjectURL(file);
        setUrl(url);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  return (
    <div className="chat-image-draft">
      {url && <img src={url} alt={file.name} />}
      {failed && (
        <span className="banner-notice">
          {t("Invalid or oversized image.")}
        </span>
      )}
      <span title={file.name}>{file.name}</span>
      <button
        type="button"
        disabled={disabled}
        aria-label={t("Remove image: {name}", { name: file.name })}
        onClick={remove}
      >
        ×
      </button>
    </div>
  );
}
function RecordedImage({
  image,
  read,
}: {
  image: ChatImage;
  read: TurnSource["image"];
}) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const { entry, index, mimeType, live } = image;
  useEffect(() => {
    const abort = new AbortController();
    let url = "";
    setUrl("");
    setFailed(false);
    if (!read) {
      setFailed(true);
      return;
    }
    void read(
      { entry, index, mimeType, ...(live ? { live } : {}) },
      abort.signal,
    )
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setUrl(url);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [read, entry, index, mimeType, live]);
  if (failed)
    return <span className="banner-notice">{t("Image unavailable.")}</span>;
  if (!url)
    return <span className="inspector-note">{t("Loading image…")}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" aria-label={t("Open image")}>
      <img
        src={url}
        alt={t("Attached image")}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}
export function ChatImages({
  images,
  turn,
}: {
  images: readonly ChatImage[];
  turn: TurnSource;
}) {
  return (
    <div className="chat-images">
      {images.map((image) => (
        <RecordedImage
          key={`${image.live ? "live" : "session"}:${image.entry}:${image.index}`}
          image={image}
          read={turn.image}
        />
      ))}
    </div>
  );
}
