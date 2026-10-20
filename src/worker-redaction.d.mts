export function own(value: unknown, name: string): unknown;
export function ownArray(value: unknown, maximum?: number): unknown[];
export function measureData(value: unknown, maximum?: number): number;
export class TextSanitizer {
  constructor(secrets?: readonly string[]);
  redacted: boolean;
  addSecrets(secrets: readonly string[]): void;
  get retainedBytes(): number;
  write(input: string, final?: boolean): string;
  end(): string;
}
export function sanitizeText(
  value: string,
  secrets?: readonly string[],
): string;
export function sanitizeData(
  value: unknown,
  secrets?: readonly string[],
): string;
export class DetailSanitizer {
  constructor(
    encoding: "utf8" | "canonical-json",
    secrets?: readonly string[],
    partial?: boolean,
  );
  redacted: boolean;
  limited: boolean;
  get retainedBytes(): number;
  write(input: string, final?: boolean): string;
  end(): string;
}

export function sanitizedJsonChunks(
  value: unknown,
  secrets: readonly string[],
  reserve: (bytes: number) => { grow(size: number): void; release(): void },
): Generator<string>;
