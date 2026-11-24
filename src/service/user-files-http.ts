/** Shared HTTP handler for `/workbench/v1/files/*`, mounted identically on
 * both the multi-project gateway and standalone owner servers. */
import {
  closeSync,
  constants,
  createReadStream,
  createWriteStream,
  openSync,
  unlinkSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { ContractError, parseWireJson } from "../service-contract.ts";
import { fixedHeaders } from "./http.ts";
import {
  copyUserEntry,
  createUserEntry,
  deleteUserEntry,
  listUserFiles,
  MAX_UPLOAD_BYTES,
  prepareUploadTarget,
  readUserFile,
  renameUserEntry,
  resolveRawFile,
  searchUserFiles,
  UserFileError,
  writeUserFile,
} from "./user-files.ts";

export const USER_FILES_PREFIX = "/workbench/v1/files/";
const MAX_JSON_BODY_BYTES = 3 * 1024 * 1024;
const MAX_CONTROL_JSON_BYTES = 64 * 1024;

function jsonReply(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  if (res.destroyed || res.writableEnded) return;
  fixedHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(
  req: IncomingMessage,
  limit: number,
  resetIdle?: () => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const done = (err?: unknown, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (err) rejectBody(err);
      else resolveBody(value ?? {});
    };
    const onAbort = () => done(new UserFileError("io", "Request aborted", 499));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      resetIdle?.();
      if (total > limit) {
        req.pause();
        done(new UserFileError("oversize", "Request body too large", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = parseWireJson(raw, limit);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new UserFileError("invalid", "Expected JSON object");
        done(undefined, parsed as Record<string, unknown>);
      } catch (err) {
        done(
          err instanceof UserFileError
            ? err
            : new UserFileError("invalid", "Invalid JSON body"),
        );
      }
    });
    req.on("close", () => {
      if (!req.complete)
        done(new UserFileError("io", "Request interrupted", 499));
    });
    req.on("error", (err) => done(new UserFileError("io", err.message, 500)));
  });
}

function strField(
  body: Record<string, unknown>,
  key: string,
  optional = false,
): string {
  const v = body[key];
  if (v === undefined && optional) return "";
  if (typeof v !== "string")
    throw new UserFileError("invalid", `Missing or invalid field: ${key}`);
  return v;
}

function streamRawFile(
  res: ServerResponse,
  absPath: string,
  name: string,
  size: number,
  mimeType: string,
  download: boolean,
  resetIdle?: () => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolveStream, rejectStream) => {
    const stream = createReadStream(absPath);
    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      stream.destroy();
      if (err) rejectStream(err);
      else resolveStream();
    };
    const onAbort = () => finish();
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.once("open", () => {
      if (res.destroyed || res.writableEnded) return finish();
      fixedHeaders(res);
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", String(size));
      if (download) {
        const fallback = name
          .replace(/[^\x20-\x7e]/g, "_")
          .replace(/["\\]/g, "_");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
      }
      stream.on("data", () => resetIdle?.());
      stream.pipe(res);
    });
    stream.on("error", (err) => {
      if (!res.headersSent)
        finish(
          new UserFileError("io", err.message || "Failed to read file", 500),
        );
      else {
        res.destroy();
        finish();
      }
    });
    res.on("finish", () => finish());
    res.on("close", () => finish());
  });
}

function streamUploadFile(
  req: IncomingMessage,
  destAbs: string,
  resetIdle?: () => void,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolveUpload, rejectUpload) => {
    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      rejectUpload(
        new UserFileError(
          "oversize",
          `File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MiB upload limit`,
          413,
        ),
      );
      return;
    }
    if (signal?.aborted) {
      rejectUpload(new UserFileError("io", "Upload aborted", 499));
      return;
    }
    let fd: number;
    try {
      fd = openSync(
        destAbs,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o666,
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        rejectUpload(new UserFileError("exists", "File already exists", 409));
      } else {
        rejectUpload(
          new UserFileError(
            "io",
            (err as Error).message || "Upload open failed",
            500,
          ),
        );
      }
      return;
    }

    let writer: ReturnType<typeof createWriteStream>;
    try {
      writer = createWriteStream(destAbs, { fd, autoClose: true });
    } catch (err) {
      try {
        closeSync(fd);
      } catch {}
      try {
        unlinkSync(destAbs);
      } catch {}
      rejectUpload(
        new UserFileError(
          "io",
          (err as Error).message || "Upload stream failed",
          500,
        ),
      );
      return;
    }

    let total = 0;
    let settled = false;
    let failed = false;
    const unlinkOwned = () => {
      try {
        unlinkSync(destAbs);
      } catch {}
    };
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (err) {
        failed = true;
        req.unpipe(writer);
        if (writer.closed) {
          unlinkOwned();
          rejectUpload(err);
        } else {
          writer.once("close", () => {
            unlinkOwned();
            rejectUpload(err);
          });
          writer.destroy();
        }
      } else {
        resolveUpload(total);
      }
    };
    const onAbort = () => done(new UserFileError("io", "Upload aborted", 499));
    signal?.addEventListener("abort", onAbort, { once: true });

    writer.on("error", (err) => {
      if (failed) return;
      done(new UserFileError("io", err.message || "Upload write failed", 500));
    });
    writer.on("finish", () => done());

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      resetIdle?.();
      if (total > MAX_UPLOAD_BYTES) {
        req.pause();
        done(
          new UserFileError(
            "oversize",
            `File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MiB upload limit`,
            413,
          ),
        );
      }
    });
    req.on("close", () => {
      if (!req.complete)
        done(new UserFileError("io", "Upload interrupted", 499));
    });
    req.on("error", (err) =>
      done(new UserFileError("io", err.message || "Upload failed", 500)),
    );
    req.pipe(writer);
  });
}

export interface UserFilesHttpContext {
  csrf: string;
  assertCurrent(): void;
  resetIdle?: () => void;
  signal?: AbortSignal;
}

/** Handles `/workbench/v1/files/<action>` after authentication has succeeded.
 * Returns true if the URL matched `/workbench/v1/files/*`. */
export async function handleUserFilesHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: UserFilesHttpContext,
): Promise<boolean> {
  if (!url.pathname.startsWith(USER_FILES_PREFIX)) return false;
  const action = url.pathname.slice(USER_FILES_PREFIX.length);
  const method = req.method ?? "";
  try {
    if (action === "meta" && method === "GET") {
      ctx.assertCurrent();
      jsonReply(res, 200, {
        kind: "ok",
        value: {
          csrf: ctx.csrf,
          home: homedir(),
          platform: process.platform,
        },
      });
      return true;
    }
    if (action === "list" && method === "GET") {
      const cwd = url.searchParams.get("cwd") ?? "";
      const path = url.searchParams.get("path") ?? "";
      const listing = listUserFiles(cwd, path);
      ctx.assertCurrent();
      jsonReply(res, 200, { kind: "ok", value: listing });
      return true;
    }
    if (action === "search" && method === "GET") {
      const cwd = url.searchParams.get("cwd") ?? "";
      const q = url.searchParams.get("q") ?? "";
      const scope = url.searchParams.get("scope") ?? "";
      const hidden = url.searchParams.get("hidden") === "1";
      const result = searchUserFiles(cwd, q, scope, hidden);
      ctx.assertCurrent();
      jsonReply(res, 200, { kind: "ok", value: result });
      return true;
    }
    if (action === "read" && method === "GET") {
      const cwd = url.searchParams.get("cwd") ?? "";
      const path = url.searchParams.get("path") ?? "";
      const result = readUserFile(cwd, path);
      ctx.assertCurrent();
      jsonReply(res, 200, { kind: "ok", value: result });
      return true;
    }
    if (action === "raw" && method === "GET") {
      const cwd = url.searchParams.get("cwd") ?? "";
      const path = url.searchParams.get("path") ?? "";
      const download = url.searchParams.get("download") === "1";
      const info = resolveRawFile(cwd, path);
      ctx.assertCurrent();
      await streamRawFile(
        res,
        info.absPath,
        info.name,
        info.size,
        info.mimeType,
        download,
        ctx.resetIdle,
        ctx.signal,
      );
      return true;
    }
    if (action === "write" && method === "POST") {
      const body = await readJsonBody(
        req,
        MAX_JSON_BODY_BYTES,
        ctx.resetIdle,
        ctx.signal,
      );
      ctx.assertCurrent();
      const result = writeUserFile(
        strField(body, "cwd", true),
        strField(body, "path"),
        strField(body, "text"),
      );
      jsonReply(res, 200, { kind: "ok", value: result });
      return true;
    }
    if (action === "create" && method === "POST") {
      const body = await readJsonBody(
        req,
        MAX_CONTROL_JSON_BYTES,
        ctx.resetIdle,
        ctx.signal,
      );
      ctx.assertCurrent();
      const kind = strField(body, "kind");
      if (kind !== "file" && kind !== "dir")
        throw new UserFileError("invalid", "Invalid kind");
      const result = createUserEntry(
        strField(body, "cwd", true),
        strField(body, "dir", true),
        strField(body, "name"),
        kind,
      );
      jsonReply(res, 200, { kind: "ok", value: result });
      return true;
    }
    if (action === "rename" && method === "POST") {
      const body = await readJsonBody(
        req,
        MAX_CONTROL_JSON_BYTES,
        ctx.resetIdle,
        ctx.signal,
      );
      ctx.assertCurrent();
      const result = renameUserEntry(
        strField(body, "cwd", true),
        strField(body, "path"),
        strField(body, "newName"),
      );
      jsonReply(res, 200, { kind: "ok", value: result });
      return true;
    }
    if (action === "copy" && method === "POST") {
      const body = await readJsonBody(
        req,
        MAX_CONTROL_JSON_BYTES,
        ctx.resetIdle,
        ctx.signal,
      );
      ctx.assertCurrent();
      const move = body.move === true;
      const result = copyUserEntry(
        strField(body, "cwd", true),
        strField(body, "src"),
        strField(body, "destDir", true),
        move,
      );
      jsonReply(res, 200, { kind: "ok", value: result });
      return true;
    }
    if (action === "delete" && method === "POST") {
      const body = await readJsonBody(
        req,
        MAX_CONTROL_JSON_BYTES,
        ctx.resetIdle,
        ctx.signal,
      );
      ctx.assertCurrent();
      const result = deleteUserEntry(
        strField(body, "cwd", true),
        strField(body, "path"),
      );
      jsonReply(res, 200, { kind: "ok", value: result });
      return true;
    }
    if (action === "upload" && method === "POST") {
      const cwd = url.searchParams.get("cwd") ?? "";
      const dir = url.searchParams.get("dir") ?? "";
      const name = url.searchParams.get("name") ?? "";
      const target = prepareUploadTarget(cwd, dir, name);
      ctx.assertCurrent();
      const size = await streamUploadFile(
        req,
        target.destAbs,
        ctx.resetIdle,
        ctx.signal,
      );
      jsonReply(res, 200, {
        kind: "ok",
        value: {
          path: target.wirePath,
          absPath: target.destAbs,
          name: target.name,
          size,
        },
      });
      return true;
    }
    jsonReply(res, 404, {
      kind: "error",
      error: { code: "invalid", message: "Unknown file operation" },
    });
    return true;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    if (res.headersSent) {
      res.destroy();
      return true;
    }
    if (error instanceof UserFileError) {
      jsonReply(res, error.status, {
        kind: "error",
        error: { code: error.code, message: error.message },
      });
      return true;
    }
    jsonReply(res, 500, {
      kind: "error",
      error: {
        code: "io",
        message:
          error instanceof Error ? error.message : "File operation failed",
      },
    });
    return true;
  }
}
