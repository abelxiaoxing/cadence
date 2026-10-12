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
pid, descriptor = pty.fork()
if pid == 0:
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

def drain(timeout=0.1):
    if select.select([descriptor], [], [], timeout)[0]:
        try:
            chunk = os.read(descriptor, 65536)
            raw.extend(chunk)
            return bool(chunk)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
    return False

def wait_text(pattern, start):
    global status
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        drain()
        text = ansi.sub("", raw[start:].decode("utf-8", errors="replace"))
        if re.search(pattern, text):
            observations.append({"pattern": pattern, "matched": True, "rawStart": start, "rawEnd": len(raw)})
            return
        got, receipt = os.waitpid(pid, os.WNOHANG)
        if got:
            status = receipt
            raise RuntimeError("child-exited-before-expected-terminal-bytes: " + pattern + ": " + str(receipt))
    raise RuntimeError("terminal-step-deadline: " + pattern)

try:
    cursor = 0
    for step in config["steps"]:
        if "expect" in step:
            wait_text(step["expect"], cursor)
        if "pause" in step:
            end = time.monotonic() + step["pause"]
            while time.monotonic() < end:
                drain(0.05)
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
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        drain()
        got, receipt = os.waitpid(pid, os.WNOHANG)
        if got:
            status = receipt
            break
    if status is None:
        raise RuntimeError("child-did-not-exit-after-quit")
except BaseException as error:
    failure = str(error)
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
    receipt = {"pid":pid,"waitpidReturned":status is not None,"waitStatus":status,"exitCode":os.waitstatus_to_exitcode(status) if status is not None else None,"failure":failure,"observations":observations,"seconds":time.monotonic()-started,"physicalHuman":False,"nativeExecutor":False,"escapeKeys":escape_keys}
    json.dump(receipt, open(os.path.join(root,"pty-receipt.json"),"w",encoding="utf-8"), indent=2)
    os.close(descriptor)
if failure or receipt["exitCode"] != 0:
    sys.exit(1)
