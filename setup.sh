#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  Claude Code Forwarder — One-Click Setup
# ─────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBHOOK_DIR="$SCRIPT_DIR/webhook"
PLIST_NAME="com.claude-code-forwarder.webhook"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo ""
echo -e "${BOLD}🚀 Claude Code Forwarder — Setup${NC}"
echo "─────────────────────────────────"
echo ""

# ─── Check Homebrew ──────────────────────────
if ! command -v brew &>/dev/null; then
    echo -e "${YELLOW}Installing Homebrew...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo -e "${GREEN}✓${NC} Homebrew"
fi

# ─── Check Claude Code CLI ───────────────────
if ! command -v claude &>/dev/null; then
    echo -e "${RED}✗ Claude Code CLI not found${NC}"
    echo "  Install: npm install -g @anthropic-ai/claude-code"
    echo "  Or visit: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
else
    echo -e "${GREEN}✓${NC} Claude Code CLI"
fi

# ─── Install tmux ────────────────────────────
if ! command -v tmux &>/dev/null; then
    echo -e "${YELLOW}Installing tmux...${NC}"
    brew install tmux
else
    echo -e "${GREEN}✓${NC} tmux"
fi

# ─── Install Claude Island ───────────────────
if [ ! -d "/Applications/Claude Island.app" ]; then
    echo -e "${YELLOW}Installing Claude Island...${NC}"
    brew install --cask claude-island
else
    echo -e "${GREEN}✓${NC} Claude Island"
fi

# ─── Install Flask ───────────────────────────
if ! python3 -c "import flask" &>/dev/null; then
    echo -e "${YELLOW}Installing Flask...${NC}"
    pip3 install flask
else
    echo -e "${GREEN}✓${NC} Flask"
fi

# ─── Install webhook as launchd service ──────
echo ""
echo -e "${BOLD}Setting up webhook service...${NC}"

# Stop existing service if running
launchctl unload "$PLIST_PATH" 2>/dev/null || true

# Create launchd plist
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(command -v python3)</string>
        <string>${WEBHOOK_DIR}/claude_forwarder_webhook.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/claude-forwarder-webhook.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/claude-forwarder-webhook.log</string>
</dict>
</plist>
PLIST

# Start the service
launchctl load "$PLIST_PATH"

# Verify it's running
sleep 2
if curl -s http://localhost:5581/status | grep -q '"ok":true'; then
    echo -e "${GREEN}✓${NC} Webhook running on localhost:5581 (auto-starts on login)"
else
    echo -e "${RED}✗${NC} Webhook failed to start. Check: /tmp/claude-forwarder-webhook.log"
    exit 1
fi

# ─── Chrome Extension ────────────────────────
echo ""
echo -e "${BOLD}Last step: Load the Chrome extension${NC}"
echo ""
echo "  1. Opening chrome://extensions for you..."
echo "  2. Enable ${BOLD}Developer mode${NC} (top-right toggle)"
echo "  3. Click ${BOLD}Load unpacked${NC}"
echo "  4. Select: ${SCRIPT_DIR}/extension"
echo ""

# Open extensions page in default browser (must be Chromium-based)
DEFAULT_BROWSER=$(defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | \
    grep -B1 'https' | grep -o '"[^"]*"' | head -1 | tr -d '"' || true)

case "$DEFAULT_BROWSER" in
    com.google.chrome*)   BROWSER_APP="Google Chrome" ;;
    company.thebrowser.*) BROWSER_APP="Arc" ;;
    com.brave.browser*)   BROWSER_APP="Brave Browser" ;;
    com.microsoft.edge*)  BROWSER_APP="Microsoft Edge" ;;
    com.vivaldi.vivaldi*) BROWSER_APP="Vivaldi" ;;
    *)                    BROWSER_APP="" ;;
esac

if [ -n "$BROWSER_APP" ]; then
    open -a "$BROWSER_APP" "chrome://extensions" 2>/dev/null || \
    echo "  Open chrome://extensions manually in your browser"
else
    echo -e "  ${YELLOW}⚠${NC}  Could not detect a Chromium browser as default."
    echo "  Open chrome://extensions manually in Chrome, Arc, Brave, or Edge."
fi

# ─── Done ────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✅ Setup complete!${NC}"
echo ""
echo "  Usage: Open Gmail or Slack → Cmd+Shift+F"
echo ""
echo "  • In a thread    → extracts full thread"
echo "  • Hover a message → extracts that message"
echo "  • Select text     → sends only the selection"
echo ""
echo "  Sessions appear in Claude Island."
echo "  Webhook auto-starts on login. To stop:"
echo "    launchctl unload $PLIST_PATH"
echo ""
