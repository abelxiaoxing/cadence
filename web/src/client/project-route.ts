/** A project address is an opaque owner key, never a filesystem path or token. */
export function currentProject(
  search = typeof window === "undefined" ? "" : window.location.search,
): string | null {
  const id = new URLSearchParams(search).get("project");
  return id && /^[a-f0-9]{64}$/.test(id) ? id : null;
}
export function projectPrefix(): string {
  const id = currentProject();
  return id ? `/projects/${id}` : "";
}
