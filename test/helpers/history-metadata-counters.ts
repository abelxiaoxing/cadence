export type Counts = Record<string, number>;
export let active: Counts | undefined;
export function metadataCount(key: string, n = 1): void {
  if (active)
    active[key] = Math.min(Number.MAX_SAFE_INTEGER, (active[key] ?? 0) + n);
}
export function metadataIO(
  name: string,
  args: unknown[],
  result: unknown,
): void {
  metadataCount(`io.${name}`);
  if (name === "readSync" && typeof result === "number")
    metadataCount("io.readBytes", result);
  if (name === "readFileSync") {
    const size =
      typeof result === "string"
        ? Buffer.byteLength(result)
        : Buffer.isBuffer(result)
          ? result.length
          : 0;
    metadataCount("io.readFileBytes", size);
  }
  if (name === "writeSync" && typeof result === "number")
    metadataCount("io.writeBytes", result);
  if (name === "readSync" && typeof args[3] === "number")
    metadataCount("io.requestedBytes", args[3]);
}
export function setActive(value: Counts | undefined): void {
  active = value;
}
