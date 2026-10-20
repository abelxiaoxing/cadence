/** Private crypto primitive for bounded read checkpoints. Not access, membership,
 * admission or recovery authority. The finite validator owns plaintext decoding. */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  ContractError,
  canonicalJson,
  decodeCursor,
  decodeEntityReadRequest,
  decodeGraphReadRequest,
  decodeListRequest,
  type EntityReadRequest,
  type GraphReadRequest,
  LIMITS,
  type ListRequest,
  type ReadCursor,
  readIdentity,
} from "../service-contract.ts";
import { type HistoryFiles, HistoryReadBudget } from "./files.ts";

const PREFIX = "rp1.";
export const READ_PROOF_PLAINTEXT_BYTES = 6000;
export type ReadProofContext =
  | { purpose: "search" | "detail"; request: ReadCursor }
  | { purpose: "list"; request: ListRequest }
  | { purpose: "graph"; request: GraphReadRequest }
  | { purpose: "entity"; request: EntityReadRequest };
function refuse(): never {
  throw new ContractError("corrupt-selected");
}

export class HistoryReadProof {
  constructor(private readonly files: HistoryFiles) {}
  /** Pre-admit only the fixed format/key completion IO before running a bounded
   * synchronous decode unit. Its completion may cross the cooperative deadline;
   * we must still capture that completed unit rather than retry it forever.
   * No read quantum is renewed: both exact selected metadata rereads are charged
   * to the original one BEFORE work, including legal metadata whitespace. */
  prepareCompletion(budget: HistoryReadBudget): {
    seal: (context: ReadProofContext, plaintext: Uint8Array) => string;
    validate: () => void;
  } {
    const material = this.files.readProofMaterial(budget);
    budget.reserve(material.readBytes * 2);
    let remaining = material.readBytes * 2,
      used = false;
    const completion = new HistoryReadBudget();
    completion.reserve = (bytes) => {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > remaining)
        refuse();
      remaining -= bytes;
    };
    const once = () => {
      if (used) refuse();
      used = true;
    };
    return {
      seal: (context, plaintext) => {
        once();
        return this.seal(context, plaintext, completion);
      },
      validate: () => {
        once();
        this.files.readProofMaterial(completion);
      },
    };
  }
  private aad(
    context: ReadProofContext,
    material: { formatStamp: string; keyStamp: string },
  ): Buffer {
    const request =
      context.purpose === "list"
        ? decodeListRequest(context.request)
        : context.purpose === "entity"
          ? decodeEntityReadRequest(context.request)
          : context.purpose === "graph"
            ? decodeGraphReadRequest(context.request)
            : decodeCursor(context.request);
    if (
      request.storeId !== this.files.format.storeId ||
      !["list", "search", "detail", "graph", "entity"].includes(context.purpose)
    )
      refuse();
    return Buffer.from(
      canonicalJson({
        domain: "cadence-history-read-progress/1",
        purpose: context.purpose,
        store: this.files.format.storeId,
        workspace: this.files.format.workspaceId,
        root: this.files.format.rootIdentity,
        format: material.formatStamp,
        key: material.keyStamp,
        request: createHash("sha256")
          .update(canonicalJson(readIdentity(request)))
          .digest("hex"),
      }),
    );
  }
  seal(
    context: ReadProofContext,
    plaintext: Uint8Array,
    budget: HistoryReadBudget,
  ): string {
    try {
      if (
        !plaintext.byteLength ||
        plaintext.byteLength > READ_PROOF_PLAINTEXT_BYTES
      )
        refuse();
      const material = this.files.readProofMaterial(budget),
        nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", material.key, nonce, {
        authTagLength: 16,
      });
      cipher.setAAD(this.aad(context, material));
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const token =
        PREFIX +
        Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString(
          "base64url",
        );
      if (token.length > LIMITS.navigationBytes) refuse();
      this.files.readProofMaterial(budget);
      return token;
    } catch (error) {
      if (
        error instanceof ContractError &&
        error.code === "receipt-inconclusive"
      )
        throw error;
      return refuse();
    }
  }
  open(
    context: ReadProofContext,
    token: string,
    budget: HistoryReadBudget,
  ): Buffer {
    try {
      if (
        typeof token !== "string" ||
        token.length > LIMITS.navigationBytes ||
        !token.startsWith(PREFIX) ||
        !/^[A-Za-z0-9_-]+$/.test(token.slice(PREFIX.length))
      )
        refuse();
      const encoded = token.slice(PREFIX.length),
        packed = Buffer.from(encoded, "base64url");
      if (
        packed.length < 29 ||
        packed.length > READ_PROOF_PLAINTEXT_BYTES + 28 ||
        packed.toString("base64url") !== encoded
      )
        refuse();
      const material = this.files.readProofMaterial(budget);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        material.key,
        packed.subarray(0, 12),
        { authTagLength: 16 },
      );
      decipher.setAAD(this.aad(context, material));
      decipher.setAuthTag(packed.subarray(-16));
      // No parse/callback/publication can observe update() until final() succeeds.
      const partial = decipher.update(packed.subarray(12, -16));
      const plaintext = Buffer.concat([partial, decipher.final()]);
      this.files.readProofMaterial(budget);
      return plaintext;
    } catch (error) {
      if (
        error instanceof ContractError &&
        error.code === "receipt-inconclusive"
      )
        throw error;
      return refuse();
    }
  }
}
