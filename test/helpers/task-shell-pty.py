"""Excluded standard-library actual OS PTY; no virtual terminal substitution.
Failure retains namespace/output. SIGTERM requests actual child exit and is never
reported as clean success or native resource closure. No forced cleanup.
"""
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

config = json.load(open(sys.argv[1], encoding="utf-8"))
root = config["root"]
control = config["controlFd"]
# Additional readonly mixed-client lane, never a replacement for the HTTP4
# production barrier. Exact finite interactions cannot confirm Start or Cancel.
observer_run = config.get("readonlyObserverRun")
if observer_run is not None:
    if not re.fullmatch(r"[0-9a-f-]{36}", observer_run):
        raise RuntimeError("observer-run-invalid")
    expected_steps = [
        {"expect": "Context7", "send": ["/cadence", "\r"]},
        {"expect": "Cadence service", "send": ["\x1b[B", "\x1b[B", "\x1b[B", "\r"]},
        {"expect": observer_run, "send": ["\x1b"]},
        {"expect": "Cadence service", "send": ["\x1b"]},
        {"expect": "detached locally", "send": ["/quit", "\r"]},
    ]
    if config["steps"] != expected_steps:
        raise RuntimeError("observer-steps-invalid")
expected_event = {"event": "cancellation-http-pending", "requestOrdinal": 4, "editingOrdinal": 3}
pid, descriptor = pty.fork()
if pid == 0:
    # This is fixture-only coordination, never a capability of the actual CLI.
    os.close(control)
    os.chdir(config["cwd"])
    os.execve(config["argv"][0], config["argv"], config["env"])
fcntl.ioctl(descriptor, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 120, 0, 0))
ansi = re.compile(r"\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z]|.)")
raw = bytearray()
observations = []
escape_keys = []
status = None
failure = None
started = time.monotonic()
event_buffer = bytearray()
event_bytes = 0
barrier = {"event": None, "receivedBeforeWait": None, "waitStep": None, "consumed": False, "escapeAfterReady": False, "bytes": 0}


def read_event():
    global event_bytes
    chunk = os.read(control, 513)
    if not chunk:
        raise RuntimeError("control-event-eof")
    event_bytes += len(chunk)
    barrier["bytes"] = event_bytes
    if event_bytes > 512:
        raise RuntimeError("control-event-overflow")
    event_buffer.extend(chunk)
    while b"\n" in event_buffer:
        line, _, rest = event_buffer.partition(b"\n")
        event_buffer[:] = rest
        if barrier["event"] is not None:
            raise RuntimeError("control-event-duplicate")
        try:
            event = json.loads(line.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise RuntimeError("control-event-invalid") from None
        # Fixed bytes/types, not permissive Python bool/int or extra-field equality.
        if (not isinstance(event, dict) or event != expected_event or
                type(event.get("requestOrdinal")) is not int or
                type(event.get("editingOrdinal")) is not int):
            raise RuntimeError("control-event-unexpected")
        barrier["event"] = event
        barrier["receivedBeforeWait"] = barrier["waitStep"] is None
    if barrier["event"] is not None and event_buffer:
        raise RuntimeError("control-event-trailing-bytes")


def drain(timeout=0.1):
    ready = select.select([descriptor, control], [], [], timeout)[0]
    # Consume/validate control first, including events buffered before the wait.
    if control in ready:
        read_event()
    if descriptor in ready:
        try:
            chunk = os.read(descriptor, 65536)
            raw.extend(chunk)
            return bool(chunk)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
    return False


def child_exited():
    global status
    if status is None:
        got, receipt = os.waitpid(pid, os.WNOHANG)
        if got:
            status = receipt
    return status is not None


def wait_step(step, start, index):
    # ONE interaction deadline, shared by terminal matching and the HTTP event.
    deadline = time.monotonic() + 15
    pattern = step.get("expect")
    needs_event = "event" in step
    if needs_event:
        if step["event"] != expected_event["event"] or barrier["waitStep"] is not None:
            raise RuntimeError("control-event-invalid-wait")
        barrier["waitStep"] = index
    matched = pattern is None
    while time.monotonic() < deadline:
        drain(max(0, min(0.1, deadline - time.monotonic())))
        if child_exited():
            raise RuntimeError("child-exited-before-expected-terminal-or-event")
        if not matched:
            text = ansi.sub("", raw[start:].decode("utf-8", errors="replace"))
            if re.search(pattern, text):
                observations.append({"pattern": pattern, "matched": True, "rawStart": start, "rawEnd": len(raw)})
                matched = True
        if matched and (not needs_event or barrier["event"] is not None):
            if needs_event:
                barrier["consumed"] = True
            return
    raise RuntimeError("terminal-event-step-deadline" if needs_event else "terminal-step-deadline: " + pattern)


try:
    cursor = 0
    for index, step in enumerate(config["steps"]):
        if "expect" in step or "event" in step:
            wait_step(step, cursor, index)
        if "resize" in step:
            rows, cols = step["resize"]
            fcntl.ioctl(descriptor, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            os.kill(pid, signal.SIGWINCH)
        if "send" in step:
            # Separate input events; arrows plus Enter in one chunk are not
            # necessarily several native key dispatches.
            cursor = len(raw)
            for key in step["send"]:
                sent = time.monotonic()
                os.write(descriptor, key.encode("utf-8"))
                if key == "\x1b" and "event" in step:
                    barrier["escapeAfterReady"] = barrier["consumed"]
                # select/read can return immediately on already-buffered output.
                # Pump for a MINIMUM interval, not one opportunistic drain, so a
                # lone ESC is delivered before the next text becomes Alt+text.
                # This paces real input only; it proves no host/resource closure.
                delay = 0.1 if key == "\x1b" else 0.04
                until = sent + delay
                while time.monotonic() < until:
                    drain(max(0, min(0.04, until - time.monotonic())))
                if key == "\x1b":
                    escape_keys.append({"inputHex":"1b","minimumDelayMs":100,"elapsedMs":(time.monotonic()-sent)*1000})
    if observer_run is None and not barrier["consumed"]:
        raise RuntimeError("control-event-not-consumed")
    if observer_run is not None and not any(o["pattern"] == observer_run and o["matched"] for o in observations):
        raise RuntimeError("observer-run-not-seen")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        drain(max(0, min(0.1, deadline - time.monotonic())))
        if child_exited():
            break
    if status is None:
        raise RuntimeError("child-did-not-exit-after-quit")
except BaseException as error:
    failure = str(error)
    if status is None:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        # Always wait actual child, not timeout/EOF-derived closure. If graceful
        # exit is unavailable retain the driver too rather than kill/reset it.
        try:
            _, status = os.waitpid(pid, 0)
        except ChildProcessError:
            pass
finally:
    open(os.path.join(root, "terminal.bin"), "wb").write(raw)
    receipt = {"pid":pid,"waitpidReturned":status is not None,"waitStatus":status,"exitCode":os.waitstatus_to_exitcode(status) if status is not None else None,"failure":failure,"observations":observations,"seconds":time.monotonic()-started,"physicalHuman":False,"nativeExecutor":False,"escapeKeys":escape_keys,"barrier":barrier}
    json.dump(receipt, open(os.path.join(root,"pty-receipt.json"),"w",encoding="utf-8"), indent=2)
    os.close(control)
    os.close(descriptor)
if failure or receipt["exitCode"] != 0:
    sys.exit(1)
