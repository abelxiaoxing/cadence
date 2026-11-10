import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatImage } from "../../../../src/service/contracts/workbench.ts";
import type { TurnSource } from "../../client/conversation-reader";
import { validatedImageFile, validateImageFiles } from "../../client/images";
import { useT } from "../../i18n/locale";
import { ImageLightbox } from "./ImageLightbox";

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
/** One image enlarged at a time. The lightbox takes the bytes rather than the
 * thumbnail's URL and is rendered beside the thumbnail, so it stays open while
 * the thumbnail is read again or replaced. */
function useLightbox(label: string) {
  const [viewing, setViewing] = useState<Blob | null>(null);
  return {
    open: setViewing,
    lightbox: viewing && (
      <ImageLightbox
        blob={viewing}
        label={label}
        onClose={() => setViewing(null)}
      />
    ),
  };
}
function Thumbnail({
  url,
  alt,
  onOpen,
  onError,
}: {
  url: string;
  alt: string;
  onOpen(): void;
  onError?(): void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      className="chat-image-open"
      aria-label={t("Open image: {name}", { name: alt })}
      title={t("Open image")}
      onClick={onOpen}
    >
      <img src={url} alt={alt} loading="lazy" onError={onError} />
    </button>
  );
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
  const { open, lightbox } = useLightbox(file.name);
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
      {url && <Thumbnail url={url} alt={file.name} onOpen={() => open(file)} />}
      {failed && <span className="banner-notice">{t("Invalid image.")}</span>}
      <span title={file.name}>{file.name}</span>
      <button
        type="button"
        className="chat-image-remove"
        disabled={disabled}
        aria-label={t("Remove image: {name}", { name: file.name })}
        onClick={remove}
      >
        ×
      </button>
      {lightbox}
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
  const [shown, setShown] = useState<{ url: string; blob: Blob } | null>(null);
  const [failed, setFailed] = useState(false);
  const { open, lightbox } = useLightbox(t("Attached image"));
  const { entry, index, mimeType, live } = image;
  useEffect(() => {
    const abort = new AbortController();
    let url = "";
    setShown(null);
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
        setShown({ url, blob });
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [read, entry, index, mimeType, live]);
  return (
    <>
      {failed ? (
        <span className="banner-notice">{t("Image unavailable.")}</span>
      ) : shown ? (
        <Thumbnail
          url={shown.url}
          alt={t("Attached image")}
          onOpen={() => open(shown.blob)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="inspector-note">{t("Loading image…")}</span>
      )}
      {lightbox}
    </>
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
