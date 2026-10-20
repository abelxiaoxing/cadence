#!/usr/bin/env python3
"""One Linux scheduler execution; bounded metadata-only /proc observation.
No process arguments/environments, no ptrace, no signals to unowned processes.
The Popen handle owns only the actual Vitest Node runner, not a shell wrapper.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]).resolve()
if not OUT.is_dir() or stat.S_IMODE(OUT.stat().st_mode) != 0o700:
    raise SystemExit("requires an existing private 0700 output root")
if any(os.environ.get(k) != str(OUT) for k in ("TMPDIR", "TEMP", "TMP")):
    raise SystemExit("requires exact isolated temporary environment")
os.umask(0o077)
UID = os.getuid()
MAJOR, MINOR = os.major(OUT.stat().st_dev), os.minor(OUT.stat().st_dev)
START = time.monotonic()


def write(name, value):
    target = OUT / name
    with target.open("x") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    # Preserve the preceding complete executable freeze, plus this diagnostic harness.
    previous = json.loads(Path("/home/mirako/abel/cadence-private-review-fbwgnqml/inputs-final.json").read_text())
    paths = list(previous) if isinstance(previous, dict) else [item["path"] for item in previous]
    paths += ["test/helpers/scheduler-io-diagnostics.ts", "test/scheduler-io-diagnostics.test.ts", "test/helpers/scheduler-io-run.py"]
    result = {}
    for name in sorted(set(paths)):
        path = Path(name)
        if not path.is_absolute():
            path = ROOT / path
        result[name] = {"bytes": path.stat().st_size, "sha256": digest(path)}
    return result


def text(path, maximum=16384):
    with Path(path).open() as stream:
        value = stream.read(maximum + 1)
    if len(value) > maximum:
        raise ValueError("bounded proc read")
    return value


def proc_stat(path):
    value = text(path / "stat", 4096)
    fields = value[value.rfind(")") + 2:].split()
    return {"state": fields[0], "ppid": int(fields[1]), "userTicks": int(fields[11]), "systemTicks": int(fields[12]), "threads": int(fields[17]), "startTicks": int(fields[19]), "rssPages": int(fields[21]), "blockDelayTicks": int(fields[39])}


def thread(path):
    result = {}
    try:
        wait = text(path / "wchan", 128).strip()
        result["waitChannel"] = wait if re.fullmatch(r"[a-zA-Z0-9_]{1,96}", wait) else "unavailable"
    except (OSError, ValueError):
        result["waitChannel"] = "unavailable"
    try:
        # Read only the syscall number, never argument/register words.
        with (path / "syscall").open() as stream:
            first = ""
            for _ in range(24):
                ch = stream.read(1)
                if ch in ("", " ", "\n"):
                    break
                first += ch
        result["syscall"] = int(first) if re.fullmatch(r"-?[0-9]+", first) else "running"
    except (OSError, ValueError):
        result["syscall"] = "unavailable"
    try:
        result["schedulerNs"] = [int(x) for x in text(path / "schedstat", 256).split()[:3]]
    except (OSError, ValueError):
        result["schedulerNs"] = None
    return result


def snapshot(runner=None):
    observed = {}
    scanned = 0
    for path in Path("/proc").iterdir():
        if not path.name.isdecimal():
            continue
        scanned += 1
        if scanned > 4096:
            break
        try:
            if path.stat().st_uid != UID:
                continue
            item = proc_stat(path)
            name = text(path / "comm", 128).strip().lower()
            category = next((label for needle, label in (("vitest", "vitest"), ("node", "node"), ("bun", "bun"), ("chrom", "chromium")) if needle in name), None)
            observed[int(path.name)] = (path, item, category)
        except (OSError, ValueError, IndexError):
            continue
    owned = {runner} if runner else set()
    for _ in range(8):
        added = {pid for pid, (_, item, _) in observed.items() if item["ppid"] in owned}
        if added <= owned:
            break
        owned |= added
    processes = []
    eligible = [(pid, value) for pid, value in observed.items() if value[2] or pid in owned]
    for pid, (path, item, category) in sorted(eligible)[:64]:
        item = {**item, "pid": pid, "category": category or "owned-other", "ownedTree": pid in owned}
        try:
            item["io"] = {k: int(v.strip()) for k, v in (line.split(":", 1) for line in text(path / "io").splitlines()) if k in ("rchar", "wchar", "syscr", "syscw", "read_bytes", "write_bytes", "cancelled_write_bytes")}
        except (OSError, ValueError):
            item["io"] = None
        try:
            tids = sorted((int(p.name) for p in (path / "task").iterdir()))
            item["threadSamples"] = [{"tid": tid, **thread(path / "task" / str(tid))} for tid in tids[:32]]
            item["threadsOmitted"] = max(0, len(tids) - 32)
        except OSError:
            item["threadSamples"] = None
        processes.append(item)
    disks = []
    for line in text("/proc/diskstats", 65536).splitlines():
        parts = line.split()
        if parts[2].startswith(("loop", "ram")):
            continue
        if len(disks) == 64:
            break
        disks.append({"major": int(parts[0]), "minor": int(parts[1]), "rootDevice": (int(parts[0]), int(parts[1])) == (MAJOR, MINOR), "counters": [int(x) for x in parts[3:]]})
    mem = {}
    for line in text("/proc/meminfo").splitlines():
        key, value = line.split(":", 1)
        if key in ("MemAvailable", "Dirty", "Writeback"):
            mem[key] = int(value.split()[0])
    fs = os.statvfs(OUT)
    return {"seconds": time.monotonic() - START, "processes": processes, "processesOmitted": max(0, len(eligible) - 64), "scanLimitHit": scanned > 4096, "disks": disks, "memoryKiB": mem, "availableBytes": fs.f_bavail * fs.f_frsize, "availableInodes": fs.f_favail}


before = inputs()
write("inputs-before.json", before)
initial = snapshot()
write("system-before.json", initial)
node = shutil.which("node")
if not node:
    raise SystemExit("actual node unavailable")
command = [node, str(ROOT / "node_modules/vitest/vitest.mjs"), "run", "--no-file-parallelism", "test/service-scheduler.test.ts", "--reporter=verbose", "--reporter=json", f"--outputFile={OUT / 'scheduler-result.json'}"]
env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL")}
(OUT / "home").mkdir(mode=0o700)
env.update(HOME=str(OUT / "home"), USERPROFILE=str(OUT / "home"), CADENCE_SCHEDULER_IO_DIAGNOSTICS="1")
write("execution.json", {"schema": "cadence-scheduler-io-run/1", "command": command, "cwd": str(ROOT), "outerSeconds": 1200, "caseSeconds": 20, "childSeconds": 15, "rootMode": oct(stat.S_IMODE(OUT.stat().st_mode)), "device": [MAJOR, MINOR], "clockTicks": os.sysconf("SC_CLK_TCK"), "nodeExecutable": node, "nodeSha256": digest(Path(node)), "straceAvailable": bool(shutil.which("strace")), "perfAvailable": bool(shutil.which("perf")), "environmentPolicy": "allowlisted ordinary startup, fabricated home, exact private temp root; no environment dump"})
# Direct regular-file logging: no pipe backpressure from the observer.
with (OUT / "scheduler.log").open("xb") as log:
    process = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
    launched = time.monotonic()
    samples, sample_bytes, dropped = [], 0, 0
    forced, signal_sent = False, None
    last = None
    while process.poll() is None:
        last = snapshot(process.pid)
        size = len(json.dumps(last))
        if len(samples) < 1205 and sample_bytes + size <= 8 * 1024 * 1024:
            samples.append(last)
            sample_bytes += size
        else:
            dropped += 1
        if time.monotonic() - launched >= 1200:
            forced = True
            # Only the original Popen handle, never a discovered/unknown PID.
            process.terminate()
            signal_sent = "TERM"
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                signal_sent = "KILL"
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
            break
        time.sleep(1)
    exit_code = process.poll()
    waited = process.wait() if exit_code is not None else None
    after = snapshot(process.pid)
    # A short observation only, not a cleanup/wait extension for test assertions.
    time.sleep(2)
    late = snapshot(process.pid)
    write("runner.json", {"pid": process.pid, "exitCode": waited, "originalUnforcedExitObserved": waited is not None and not forced, "waitConfirmed": waited is not None, "forced": forced, "signalSent": signal_sent, "unconfirmed": waited is None, "seconds": time.monotonic() - launched, "observerCpu": resource.getrusage(resource.RUSAGE_SELF).ru_utime + resource.getrusage(resource.RUSAGE_SELF).ru_stime, "reapedChildUsage": dict(zip(("userSeconds", "systemSeconds", "maxRssKiB", "shared", "unshared", "stack", "minorFaults", "majorFaults", "swaps", "inBlocks", "outBlocks", "sent", "received", "signals", "voluntarySwitches", "involuntarySwitches"), resource.getrusage(resource.RUSAGE_CHILDREN))), "samples": len(samples), "sampleBytes": sample_bytes, "dropped": dropped})
    write("system-during.json", samples)
    write("system-last.json", last)
    write("system-after.json", after)
    write("system-late.json", late)
after_inputs = inputs()
write("inputs-after.json", after_inputs)
write("input-changes.json", [name for name in before if before[name] != after_inputs.get(name)])
print(json.dumps({"root": str(OUT), "pid": process.pid, "exit": waited, "forced": forced, "samples": len(samples), "inputChanges": json.loads((OUT / "input-changes.json").read_text())}))
