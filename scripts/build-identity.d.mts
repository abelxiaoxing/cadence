export function digest(value: string | Uint8Array): string;
export function inputFiles(root: string, at: string): [string, string][];
export function contractIdentity(root: string): string;
export function browserIdentity(root: string): {
  sourceHash: string;
  contractHash: string;
  buildId: string;
};
