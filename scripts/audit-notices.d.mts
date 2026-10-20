export function auditNotices(
  root: string,
  emitted?: { name: string; modules: string[] }[],
): { families: number; modules: number; notices: number; fonts: number };
