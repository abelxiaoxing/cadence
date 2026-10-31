"""Actual POSIX terminal driver, isolated fixture only; no simulated host API."""
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
pid, fd = pty.fork()
if pid == 0:
    os.chdir(config["cwd"])
    os.execve(config["argv"][0], config["argv"], config["env"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
output = bytearray()
ansi = re.compile(r"\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z]|.)")
status = None

def drain(wait=0.1):
    if select.select([fd], [], [], wait)[0]:
        try:
            output.extend(os.read(fd, 65536))
        except OSError as error:
            if error.errno != errno.EIO:
                raise

def wait_for(text, after):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        drain()
        if text in ansi.sub("", output[after:].decode("utf-8", errors="replace")):
            return
    raise RuntimeError("terminal expectation: " + text)

try:
    wait_for("Context7", 0)
    for text, expected in [
        ("/cadence initial goal", "MODE-ANSWER-1"),
        ("clarify the next decision", "MODE-ANSWER-2"),
        ("exit cadence", "Cadence mode disabled"),
        ("ordinary conversation again", "MODE-ANSWER-3"),
    ]:
        mark = len(output)
        os.write(fd, text.encode("utf-8"))
        time.sleep(0.15)
        os.write(fd, b"\r")
        wait_for(expected, mark)
        # Final provider text precedes host idle by a small amount.
        time.sleep(0.2)
    os.write(fd, b"/quit")
    time.sleep(0.15)
    os.write(fd, b"\r")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        drain()
        got, result = os.waitpid(pid, os.WNOHANG)
        if got:
            status = result
            break
    if status is None or not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
        raise RuntimeError("original Pi process did not close successfully")
finally:
    open(os.path.join(config["root"], "terminal-output.bin"), "wb").write(output)
    if status is None:
        # Exact child still owned by this driver. Failed teardown is not a pass.
        os.kill(pid, signal.SIGTERM)
        os.waitpid(pid, 0)
    os.close(fd)
