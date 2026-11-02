/** Domain-separated stable identities for native sessions and context versions.
 * These identify public context, never credentials, grants or native capabilities. */
import { createHash } from "node:crypto";
export function conversationIdentity(identity: string): string {
  const h = createHash("sha256").update(identity).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
