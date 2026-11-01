export const CONTEXT_BYTES: number;
export function conversationMessages(
  messages: unknown,
  secrets?: readonly string[],
): unknown[];
export function readConversationContext(path: string | null): unknown[];
export function encodeConversationContext(
  messages: unknown,
  secrets: readonly string[],
): string;

export const CONTEXT_RECORD_BYTES: number;
export function iterateConversationContext(
  path: string | null,
): Generator<unknown>;
export function conversationContextRecords(
  messages: unknown,
  secrets?: readonly string[],
): Generator<string>;
