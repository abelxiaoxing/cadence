export interface WorkerWorkspace {
  readonly cwd: string;
  readonly roots: readonly string[];
}
export function withinRoot(root: string, path: string): boolean;
export function bindWorkerWorkspace(
  cwd: string,
  roots?: readonly string[],
): WorkerWorkspace;
export function executionDirectory(
  execution: { cwd: string; checkoutRoot: string },
  tree: string,
): string;
