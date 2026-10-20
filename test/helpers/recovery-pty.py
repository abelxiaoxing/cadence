# Actual local TTY confirmation driver; no forced isTTY or piped product stdin.
import json, os, pty, select, signal, sys, time

config = json.load(open(sys.argv[1], encoding="utf-8"))
pid, fd = pty.fork()
if pid == 0:
    os.chdir(config["cwd"])
    os.execve(config["argv"][0], config["argv"], config["env"])
output = bytearray()
forced = False
status = None
fault = None

def read_until(needle):
    deadline = time.monotonic() + 15
    while needle.encode() not in output:
        if time.monotonic() >= deadline:
            raise RuntimeError("interaction-timeout")
        if select.select([fd], [], [], 0.1)[0]:
            part = os.read(fd, 8192)
            if not part:
                raise RuntimeError("terminal-eof")
            output.extend(part)
            if len(output) > 65536:
                raise RuntimeError("terminal-bound")

def send(text):
    for ch in text.encode():
        os.write(fd, bytes([ch]))
        time.sleep(0.04)

try:
    read_until("Type processes: ")
    if config["mode"] == "paste":
        os.write(fd, b"\x1b[200~processes\rcredentials\rstorage\r\x1b[201~")
    elif config["mode"] == "cancel":
        os.write(fd, b"\x03")
    else:
        send("processes\r")
        read_until("Type credentials: ")
        send("credentials\r")
        read_until("Type storage: ")
        send("storage\r")
        read_until("Type resolve " + config["epoch"] + ": ")
        send("resolve " + config["epoch"] + "\r")
    deadline = time.monotonic() + 15
    while status is None:
        waited, result = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = result
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("quit-timeout")
        if select.select([fd], [], [], 0.1)[0]:
            try:
                output.extend(os.read(fd, 8192))
            except OSError:
                pass
except Exception as error:
    fault = type(error).__name__ + ":" + str(error)
finally:
    if status is None:
        forced = True
        os.kill(pid, signal.SIGTERM)  # original fixture-owned process only
        _, status = os.waitpid(pid, 0)
    os.close(fd)
    open(config["receipt"] + ".terminal", "wb").write(output)
    json.dump({"waitpidReturned": True, "exitCode": os.waitstatus_to_exitcode(status), "forced": forced, "fault": fault}, open(config["receipt"], "w"))
sys.exit(1 if fault else 0)
