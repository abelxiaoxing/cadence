/** Small shape predicates shared by filesystem records; no task model. */
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function boundedString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) <= max &&
    !value.includes("\0")
  );
}
export function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}
