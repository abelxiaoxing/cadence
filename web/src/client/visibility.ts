interface VisibilityDocument {
  hidden?: boolean;
  addEventListener?(type: "visibilitychange", listener: () => void): void;
  removeEventListener?(type: "visibilitychange", listener: () => void): void;
}
function visibilityDocument(): VisibilityDocument | undefined {
  return (globalThis as { document?: VisibilityDocument }).document;
}
export function pageHidden(): boolean {
  return visibilityDocument()?.hidden === true;
}
export function onPageVisible(listener: () => void): () => void {
  const doc = visibilityDocument();
  if (!doc || typeof doc.addEventListener !== "function") return () => {};
  const handle = () => {
    if (!doc.hidden) listener();
  };
  doc.addEventListener("visibilitychange", handle);
  return () => doc.removeEventListener?.("visibilitychange", handle);
}
