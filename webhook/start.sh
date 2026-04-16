#!/bin/bash
# Start Claude Code Forwarder webhook
cd "$(dirname "$0")"
echo "Starting Claude Code Forwarder on port 5581..."
python3 claude_forwarder_webhook.py
