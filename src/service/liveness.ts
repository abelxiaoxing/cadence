/** Evidence that a lock holder can no longer act. Startup self-healing reclaims
 * only what this module proves dead; it never guesses from age or a PID alone. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname, uptime } from "node:os";

/** Written into every new lock so a later process can prove its holder gone. */
export interface ProcessMark {
  pid: number;
  host: string;
  /** Kernel boot identity; a different one proves every old process exited. */
  boot?: string | null;
  /** Platform start identity of `pid`; a different one proves PID reuse. */
  started?: string | null;
}
export type HolderState =
  /** The recorded process is running (or cannot be told apart from it). */
  | "live"
  /** Proven gone: different boot, absent PID or a reused PID. */
  | "dead"
  /** Recorded on another host; nothing here can observe it. */
  | "foreign"
  /** The PID exists but neither its identity nor its absence can be shown. */
  | "unknown";
export interface Holder {
  state: HolderState;
  /** The holder belonged to an earlier boot of this machine. */
  reboot: boolean;
}
/** Legacy locks carry no boot identity. Their file must predate this boot by
 * this much before the boot time alone counts as proof (clock steps at boot). */
export const LEGACY_BOOT_MARGIN_MS = 10 * 60 * 1000;
/** A live PID that started this long after its lock was written is not the
 * process that wrote it. */
const REUSE_SLACK_MS = 5000;
const LINUX_TICKS_PER_SECOND = 100;

let cachedBoot: string | null | undefined;
/** Stable for the life of this kernel boot; null where the platform has none. */
export function bootId(): string | null {
  if (cachedBoot !== undefined) return cachedBoot;
  cachedBoot = null;
  try {
    if (process.platform === "linux") {
      const id = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      if (/^[0-9a-f-]{36}$/.test(id)) cachedBoot = id;
    } else if (process.platform === "darwin") {
      const r = spawnSync("sysctl", ["-n", "kern.bootsessionuuid"], {
        encoding: "utf8",
        timeout: 2000,
      });
      const id = r.status === 0 ? r.stdout.trim() : "";
      if (/^[0-9A-Fa-f-]{36}$/.test(id)) cachedBoot = id;
    }
  } catch {
    cachedBoot = null;
  }
  return cachedBoot;
}
/** Wall-clock boot time in ms. */
export function bootTime(): number {
  if (process.platform === "linux")
    try {
      const line = /^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"));
      if (line) return Number(line[1]) * 1000;
    } catch {
      /* fall back below */
    }
  return Date.now() - uptime() * 1000;
}
function linuxStat(pid: number): string[] | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name may contain spaces and parentheses; fields follow the last ')'.
    return stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(" ");
  } catch {
    return null;
  }
}
/** Clock-independent start identity of a running process, or null. */
export function processStart(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  if (process.platform === "linux") {
    const fields = linuxStat(pid);
    // Field 22 (starttime) is the 20th after the command name.
    const ticks = fields?.[19];
    return ticks && /^\d+$/.test(ticks) ? `ticks:${ticks}` : null;
  }
  if (process.platform === "darwin") {
    const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
      env: { ...process.env, LC_ALL: "C" },
    });
    const value = r.status === 0 ? r.stdout.trim() : "";
    return value ? `lstart:${value}` : null;
  }
  return null;
}
/** Approximate wall-clock start in ms, for legacy marks without `started`. */
function processStartMs(pid: number): number | null {
  if (process.platform === "linux") {
    const ticks = linuxStat(pid)?.[19];
    return ticks && /^\d+$/.test(ticks)
      ? bootTime() + (Number(ticks) * 1000) / LINUX_TICKS_PER_SECOND
      : null;
  }
  const start = processStart(pid);
  if (start?.startsWith("lstart:")) {
    const ms = Date.parse(start.slice("lstart:".length));
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}
let cachedSelf: string | null | undefined;
/** This process's mark for a new lock. */
export function selfMark(): ProcessMark {
  cachedSelf ??= processStart(process.pid);
  return {
    pid: process.pid,
    host: hostname(),
    boot: bootId(),
    started: cachedSelf,
  };
}
function probe(pid: number): "alive" | "absent" | "error" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    // EPERM: the PID belongs to another account. Cadence state is private to
    // one account, so that process cannot be the holder that wrote it.
    return code === "ESRCH" || code === "EPERM" ? "absent" : "error";
  }
}
/** Classify the writer of a lock. `writtenAt` is the lock file's mtime. */
export function holderState(mark: ProcessMark, writtenAt?: number): Holder {
  if (mark.host !== hostname()) return { state: "foreign", reboot: false };
  const boot = bootId();
  if (mark.boot && boot && mark.boot !== boot)
    return { state: "dead", reboot: true };
  const legacyEarlierBoot =
    !mark.boot &&
    writtenAt !== undefined &&
    writtenAt < bootTime() - LEGACY_BOOT_MARGIN_MS;
  if (mark.pid === process.pid) {
    // Our own PID: either this process wrote it, or an earlier process with
    // the same number did (PIDs restart after a reboot, and a container's
    // first process always has the same one).
    const self = selfMark().started;
    if (mark.started && self)
      return mark.started === self ? live() : dead(legacyEarlierBoot);
    const ownStart = Date.now() - process.uptime() * 1000;
    return writtenAt !== undefined && writtenAt < ownStart - REUSE_SLACK_MS
      ? dead(legacyEarlierBoot)
      : live();
  }
  const seen = probe(mark.pid);
  if (seen === "absent") return { state: "dead", reboot: legacyEarlierBoot };
  if (seen === "error") return { state: "unknown", reboot: false };
  if (mark.started) {
    const now = processStart(mark.pid);
    if (now) return now === mark.started ? live() : dead(legacyEarlierBoot);
    // The process may have exited between the probe and this read.
    return probe(mark.pid) === "absent"
      ? dead(legacyEarlierBoot)
      : { state: "unknown", reboot: false };
  }
  // Legacy mark: the holder must have started before it wrote its lock.
  const startedAt = processStartMs(mark.pid);
  if (startedAt !== null && writtenAt !== undefined)
    return startedAt > writtenAt + REUSE_SLACK_MS
      ? dead(legacyEarlierBoot)
      : live();
  if (legacyEarlierBoot) return dead(true);
  return startedAt === null ? { state: "unknown", reboot: false } : live();
}
function live(): Holder {
  return { state: "live", reboot: false };
}
function dead(reboot: boolean): Holder {
  return { state: "dead", reboot };
}
/** mtime (ms) from a PrivateFiles stamp (`...:ctimeMs:mtimeMs`). */
export function stampTime(stamp: string): number | undefined {
  const value = Number(stamp.slice(stamp.lastIndexOf(":") + 1));
  return Number.isFinite(value) ? value : undefined;
}
/** Optional mark fields when decoding an existing lock. */
export function decodeMarkFields(o: Record<string, unknown>): {
  boot: string | null;
  started: string | null;
} {
  const field = (value: unknown) =>
    typeof value === "string" && value.length <= 128 ? value : null;
  return { boot: field(o.boot), started: field(o.started) };
}
/** Ask every process in a group to stop, then force it. Resolves true once
 * the group is empty; false if it is still present after the wait. */
export async function stopProcessGroup(
  pgid: number,
  waitMs = 5000,
): Promise<boolean> {
  const gone = () => {
    try {
      process.kill(process.platform === "win32" ? pgid : -pgid, 0);
      return false;
    } catch (error) {
      return (
        error instanceof Error && "code" in error && error.code === "ESRCH"
      );
    }
  };
  const send = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === "win32") process.kill(pgid, signal);
      else process.kill(-pgid, signal);
    } catch {
      /* already gone, or the next probe reports it */
    }
  };
  if (gone()) return true;
  send("SIGTERM");
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (gone()) return true;
    if (Date.now() > deadline - waitMs / 2) send("SIGKILL");
  }
  send("SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 200));
  return gone();
}
