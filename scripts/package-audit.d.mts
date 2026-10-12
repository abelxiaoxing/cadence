export function sha256(bytes: Uint8Array): string;
export function archiveBodies(archive: string): Map<string, Buffer>;
export function auditPackage(
  archive: string,
  sourceRoot: string,
  expected: string[],
  provenanceRoot?: string,
): {
  members: string[];
  archiveSha256: string;
  bodyHashes: Record<string, string>;
};
