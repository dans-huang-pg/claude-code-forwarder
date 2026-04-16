#!/usr/bin/env python3
"""
Claude Code Forwarder Webhook
Receives forwarded Gmail/Slack threads from Chrome extension,
spawns Claude Code CLI sessions in tmux for Claude Island integration.

Usage:
  pip install -r requirements.txt
  python claude_forwarder_webhook.py
"""

import os
import stat
import subprocess
import tempfile
import uuid
from flask import Flask, request, jsonify

app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route("/forward", methods=["OPTIONS"])
@app.route("/status", methods=["OPTIONS"])
def handle_preflight():
    return "", 204


WORKSPACE_DIR = os.path.expanduser("~/claude")
active_jobs = {}


def build_prompt(payload):
    source = payload["source"]
    url = payload.get("url", "")
    instruction = payload.get("instruction", "").strip()
    extraction_method = payload.get("extraction_method", "dom")

    thread_id = payload.get("thread_id")
    hint = payload.get("hint", "")

    if extraction_method == "dom" and payload.get("thread"):
        thread_lines = []
        for msg in payload["thread"]:
            sender = msg.get("from", "unknown")
            timestamp = msg.get("timestamp", "")
            body = msg.get("body", "")
            thread_lines.append(f"[{timestamp}] {sender}:\n{body}")
        thread_content = "\n\n".join(thread_lines)
    else:
        thread_content = f"Fetch content from this URL using MCP tools: {url}"

    # Add thread identifiers so Claude Code can fetch full content via MCP
    thread_id_line = ""
    gmail_thread_id = payload.get("gmail_thread_id")
    if thread_id:
        thread_id_line = f"Slack Thread ID: channel={thread_id['channel_id']}, thread_ts={thread_id['thread_ts']}\n"
    if gmail_thread_id:
        thread_id_line += f"Gmail Thread ID: {gmail_thread_id}\n"
    if hint:
        thread_id_line += f"Hint: {hint}\n"

    subject_line = ""
    if payload.get("subject"):
        subject_line = f"Subject: {payload['subject']}\n"

    if not instruction:
        instruction = "Auto — 根據內容和你的 skills 決定怎麼處理"

    # Build a clear header for Claude Island preview
    # Extract key info: who sent it, what channel, first line of content
    subject = payload.get("subject", "")
    first_sender = ""
    preview = ""
    thread = payload.get("thread", [])
    if thread:
        first_sender = thread[0].get("from", "")
        body = thread[0].get("body", "")
        preview = body[:80].replace("\n", " ").strip()
        if len(body) > 80:
            preview += "..."

    if source == "slack":
        channel = subject.replace("Slack: ", "") if subject else "Slack"
        header = f"[{channel}]"
        if first_sender:
            header += f" {first_sender}"
        if preview:
            header += f": {preview}"
    elif source == "gmail":
        header = subject or "Gmail"
        if first_sender:
            header += f" (from {first_sender})"
    else:
        header = subject or f"Forwarded {source}"

    if instruction:
        header += f"\n→ {instruction}"

    return f"""{header}

Source: {source} | URL: {url}
{thread_id_line}
--- Thread Content ---
{thread_content}
---

User instruction: {instruction}

Act on this using your existing skills. If it's an email, draft a reply via Gmail.
If it's a Slack message, research and draft a response via Slack.
Always use the draft-first pattern — never send directly."""


def launch_in_tmux(session_name, prompt):
    """Write prompt to temp file, launch claude in a tmux session."""

    # Write prompt to temp file (avoids shell escaping issues)
    prompt_fd = tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, prefix="claude-fwd-"
    )
    prompt_fd.write(prompt)
    prompt_fd.close()
    prompt_path = prompt_fd.name

    # Write launcher script that runs claude then cleans up
    launcher_fd = tempfile.NamedTemporaryFile(
        mode="w", suffix=".sh", delete=False, prefix="claude-fwd-"
    )
    launcher_fd.write(f"""#!/bin/bash
cd {WORKSPACE_DIR}
claude --name "{session_name}" --dangerously-skip-permissions "$(cat '{prompt_path}')"
rm -f '{prompt_path}' '{launcher_fd.name}'
# Kill the tmux session when claude exits so it doesn't show as idle
tmux kill-session -t "{session_name}" 2>/dev/null
""")
    launcher_fd.close()
    launcher_path = launcher_fd.name
    os.chmod(launcher_path, stat.S_IRWXU)

    # Launch in a new tmux session
    process = subprocess.Popen(
        [
            "tmux", "new-session", "-d",
            "-s", session_name,
            launcher_path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return process


@app.route("/forward", methods=["POST"])
def forward():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"ok": False, "error": "Missing JSON body"}), 400

    source = payload.get("source")
    if source not in ("gmail", "slack"):
        return jsonify({"ok": False, "error": "source must be 'gmail' or 'slack'"}), 400

    url = payload.get("url", "")
    if not url and not payload.get("thread"):
        return jsonify({"ok": False, "error": "Must provide url or thread content"}), 400

    prompt = build_prompt(payload)
    job_id = str(uuid.uuid4())[:8]
    session_name = f"fwd-{source}-{job_id}"

    process = launch_in_tmux(session_name, prompt)

    active_jobs[job_id] = {
        "source": source,
        "url": url,
        "session_name": session_name,
        "tmux_session": session_name,
    }

    return jsonify({
        "ok": True,
        "job_id": job_id,
        "session_name": session_name,
        "message": f"Claude Code session '{session_name}' started in tmux",
    }), 202


@app.route("/status", methods=["GET"])
def status():
    # Clean up finished tmux sessions
    finished = []
    for job_id, job in active_jobs.items():
        result = subprocess.run(
            ["tmux", "has-session", "-t", job["tmux_session"]],
            capture_output=True,
        )
        if result.returncode != 0:
            finished.append(job_id)
    for job_id in finished:
        del active_jobs[job_id]

    return jsonify({
        "ok": True,
        "active_jobs": len(active_jobs),
        "jobs": active_jobs,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5581))
    print("=" * 50)
    print("  Claude Code Forwarder Webhook")
    print("=" * 50)
    print(f"  Listening: http://localhost:{port}")
    print(f"  Workspace: {WORKSPACE_DIR}")
    print(f"  Mode:      tmux + Claude Island")
    print("=" * 50)
    app.run(host="127.0.0.1", port=port)
