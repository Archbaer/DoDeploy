#!/usr/bin/env python3
"""Run the real CLI under a PTY and answer Clack prompts from a JSON recipe."""
import json
import fcntl
import os
import pty
import re
import struct
import select
import subprocess
import sys
import termios
import time


def clean(value):
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value).replace("\r", "")


def main():
    recipe = json.loads(sys.argv[1])
    command = recipe["command"]
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
        os.execvp(command[0], command)

    transcript = ""
    prompt_buffer = ""
    counts = {}
    last_prompt = None
    last_prompt_text = None
    deadline = time.monotonic() + recipe.get("timeout", 30)
    status = None
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.15)
        if ready:
            try:
                chunk = os.read(fd, 8192).decode("utf-8", "replace")
            except OSError:
                break
            transcript += chunk
            prompt_buffer += chunk
        waited, child_status = os.waitpid(pid, os.WNOHANG)
        if waited:
            status = os.waitstatus_to_exitcode(child_status)
            break

        visible = clean(prompt_buffer)
        active_lines = re.findall(r"◆\s*([^\n]+)", visible)
        active_prompt = active_lines[-1] if active_lines else ""
        if active_prompt and active_prompt == last_prompt_text:
            continue
        answer = None
        key = None
        prompt_id = None
        cancel_at = recipe.get("cancelAt")
        if cancel_at and cancel_at in visible:
            os.write(fd, b"\x1b")
            prompt_buffer = ""
            continue
        def hit(text): return text in active_prompt
        def next_value(name, default=None):
            if active_prompt == last_prompt_text:
                return default
            index = counts.get(name, 0)
            values = recipe.get(name, [])
            counts[name] = index + 1
            return values[index] if index < len(values) else default
        if hit("Target cloud provider?"):
            prompt_id = "provider"
            value = recipe.get("provider", "aws")
            key = "provider"
            answer = {"aws": 0, "gcp": 1, "azure": 2}[value]
        elif hit("What matters most for this deployment?"):
            prompt_id = "budget"
            value = recipe.get("budget", "balanced")
            key = "budget"
            answer = {"cheapest": 0, "balanced": 1, "production": 2}[value]
        elif hit("Region?"):
            prompt_id = "region"
            region_default = {"aws": "us-east-1", "gcp": "us-central1", "azure": "eastus"}[recipe.get("provider", "aws")]
            key, answer = "region", recipe.get("region", region_default)
        elif hit("Add a service?"):
            prompt_id = "add-service"
            wanted_services = len(set(recipe.get("services", ["api"])))
            answer = "yes" if counts.get("service-confirm", 0) < wanted_services else "no"
            if active_prompt != last_prompt_text:
                counts["service-confirm"] = counts.get("service-confirm", 0) + 1
            key = "confirm"
        elif hit("Service name?") or hit("Name already used"):
            prompt_id = "service-name"
            key, answer = "service-name", next_value("services", "api")
        elif hit("Service role?"):
            prompt_id = "service-role"
            role = next_value("roles", "web")
            key, answer = "role", {"web": 0, "worker": 1, "cron": 2, "stateful": 3}[role]
        elif hit(" image?"):
            prompt_id = "image-kind"
            image_kind = next_value("imageKinds", "pushed")
            key, answer = "image", {"pushed": 0, "build": 1, "unknown": 2}[image_kind]
        elif hit("Image URI") or hit("Build context"):
            prompt_id = "image-uri"
            key, answer = "image-uri", next_value("images", "ghcr.io/example/app:1.0")
        elif hit("Expose ") and hit("public HTTP traffic?"):
            prompt_id = "public"
            key, answer = "public", "yes" if next_value("public", True) else "no"
        elif hit("Public ports detected"):
            prompt_id = "public-ingress"
            key, answer = "public-ingress", "yes"
        elif hit("Container HTTP port") or hit("Invalid port; enter integer"):
            prompt_id = "port"
            key, answer = "port", next_value("ports", "8080")
        elif hit("compatible run target?") or hit("run on?"):
            prompt_id = "target"
            key, answer = "target", 0
        elif hit("persistent mounted storage?"):
            prompt_id = "persistent"
            key, answer = "persistent", "yes" if next_value("persistent", False) else "no"
        elif hit("Persistent volume name"):
            prompt_id = "volume-name"
            key, answer = "volume-name", next_value("volumeNames", "data")
        elif hit("Named volumes detected"):
            prompt_id = "keep-volume"
            key, answer = "keep-volume", "yes"
        elif hit("Add a datastore?"):
            prompt_id = "add-datastore"
            wanted = len(recipe.get("datastores", []))
            seen = counts.get("datastore-confirm", 0)
            answer = "yes" if seen < wanted else "no"
            if active_prompt != last_prompt_text:
                counts["datastore-confirm"] = seen + 1
            key = "confirm"
        elif hit("Datastore engine?"):
            prompt_id = "engine"
            engine = next_value("datastores", "postgres")
            key, answer = "engine", {"postgres": 0, "mysql": 1, "redis": 2, "mongodb": 3}[engine]
        elif hit("Unique datastore name?"):
            prompt_id = "datastore-name"
            key, answer = "datastore-name", next_value("datastore_names", "db")
        elif hit("Version for "):
            prompt_id = "version"
            key, answer = "version", next_value("versions", "")
        elif hit("Provision managed "):
            prompt_id = "managed"
            key, answer = "managed", "yes" if next_value("managed", True) else "no"
        elif hit("Services/datastores used by"):
            prompt_id = "dependencies"
            key, answer = "dependencies", next_value("dependencies", "")
        elif hit("Do you serve static assets"):
            prompt_id = "storage"
            key, answer = "storage", "yes" if recipe.get("storageAssets", False) else "no"
        elif hit("What kind of storage?"):
            prompt_id = "storage-kind"
            choice = recipe.get("storageChoice", "both")
            key, answer = "storage-kind", {"static-assets": 0, "uploads": 1, "both": 2}[choice]
        elif hit("Review configuration:"):
            prompt_id = "review"
            key, answer = "review", "yes"
        elif hit("Configure advanced"):
            key, answer = "advanced", "no"

        if key is not None and active_prompt != last_prompt_text:
            last_prompt = prompt_id
            last_prompt_text = active_prompt
            if key in {"provider", "budget", "role", "image", "target", "engine"}:
                if answer:
                    os.write(fd, b"\x1b[B" * answer)
                os.write(fd, b"\r")
            elif isinstance(answer, bool):
                os.write(fd, (b"y\r" if answer else b"n\r"))
            else:
                os.write(fd, (str(answer) + "\r").encode())
            prompt_buffer = ""

    if status is None:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
        status = 124
    print(json.dumps({"status": status, "output": clean(transcript), "counts": counts}))


if __name__ == "__main__":
    main()
