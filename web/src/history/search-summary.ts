import type { SearchPage } from "../types";
export function emptySearchWindow(page: SearchPage): string {
  return page.next
    ? "No hits in this bounded window; search is not finished."
    : "No hits in the final retained window. Coverage limits above still apply.";
}
