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
