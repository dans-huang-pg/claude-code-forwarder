const WEBHOOK_URL = "http://localhost:5581/forward";

// Handle forward trigger from either chrome.commands or content script message
async function handleForward() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const url = tab.url || "";
  let source = null;
  if (url.includes("mail.google.com")) source = "gmail";
  else if (url.includes("app.slack.com")) source = "slack";
  if (!source) return;

  const scriptFile =
    source === "gmail" ? "gmail-content.js" : "slack-content.js";

  try {
    // Capture selected text first
    const selResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString().trim(),
    });
    const selectedText = selResults?.[0]?.result || "";

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [scriptFile],
    });

    let extracted = results?.[0]?.result;
    // If text is selected, ONLY send the selection — skip thread extraction
    if (selectedText) {
      extracted = {
        thread: [{ from: "", body: selectedText, timestamp: "" }],
        subject: extracted?.subject || null,
        selectedOnly: true,
      };
    }
    // Build a better URL if we have thread_id (Slack)
    let finalUrl = url;
    if (extracted?.thread_id) {
      const { channel_id, thread_ts } = extracted.thread_id;
      const tsNoDot = thread_ts.replace(".", "");
      finalUrl = url.replace(/\/client\/[^/]+.*/, `/client/${url.match(/T[A-Z0-9]+/)?.[0] || ""}/` + channel_id + "/thread/" + channel_id + "-" + thread_ts);
    }

    showPopup(tab.id, source, finalUrl, extracted || null);
  } catch (err) {
    console.error("Content script injection failed:", err);
    showPopup(tab.id, source, url, null);
  }
}

// Listen from chrome.commands (if user sets shortcut manually or sets to Global)
chrome.commands.onCommand.addListener((command) => {
  if (command === "forward-to-claude") handleForward();
});

// Listen from content script (works immediately on Gmail/Slack pages)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "forward-to-claude") {
    handleForward();
    return;
  }

  // Relay webhook calls from popup (avoids CORS issues in page context)
  if (msg.action === "send-to-webhook") {
    fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    })
      .then((r) => r.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep sendResponse channel open for async
  }
});

function showPopup(tabId, source, url, extracted) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: injectInstructionPopup,
    args: [source, url, extracted],
  });
}

function injectInstructionPopup(source, url, extracted) {
  // Remove existing popup if any
  const existing = document.getElementById("claude-forwarder-popup");
  if (existing) existing.remove();

  // Use Shadow DOM to isolate styles from host page (Slack dark mode etc.)
  const host = document.createElement("div");
  host.id = "claude-forwarder-popup";
  host.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;";
  const shadow = host.attachShadow({ mode: "open" });

  const msgCount = extracted?.thread?.length || 0;
  const statusText = extracted?.selectedOnly
    ? `Selected text (${extracted.thread[0]?.body.length || 0} chars)`
    : extracted
      ? `${msgCount} message${msgCount !== 1 ? "s" : ""} extracted`
      : "Will fetch via MCP (DOM extraction failed)";

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #333;
      }
      .card {
        background: white; border-radius: 12px; padding: 24px;
        width: 420px; max-width: 90vw;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      }
      .header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
      .header span { font-size: 20px; }
      .header h3 { font-size: 16px; font-weight: 600; color: #111; }
      .meta { font-size: 13px; color: #666; margin-bottom: 12px; }
      .meta strong { color: #333; }
      .subject {
        font-size: 13px; color: #333; margin-bottom: 12px;
        padding: 8px; background: #f5f5f5; border-radius: 6px;
      }
      textarea {
        width: 100%; height: 80px; border: 1px solid #ddd; border-radius: 8px;
        padding: 10px; font-size: 14px; resize: vertical;
        font-family: inherit; color: #333; background: white;
      }
      textarea::placeholder { color: #999; }
      .hints {
        display: flex; gap: 12px; margin-top: 6px; font-size: 11px; color: #999;
      }
      .hints kbd {
        background: #f0f0f0; border: 1px solid #ddd; border-radius: 3px;
        padding: 1px 4px; font-family: inherit; font-size: 10px;
      }
      .buttons { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
      .btn-cancel {
        padding: 8px 16px; border: 1px solid #ddd; border-radius: 6px;
        background: white; cursor: pointer; font-size: 14px; color: #333;
      }
      .btn-send {
        padding: 8px 16px; border: none; border-radius: 6px;
        background: #D97706; color: white; cursor: pointer;
        font-size: 14px; font-weight: 500;
      }
      .btn-send:disabled { opacity: 0.6; cursor: default; }
      .status { margin-top: 12px; font-size: 13px; display: none; }
    </style>
    <div class="overlay">
      <div class="card">
        <div class="header">
          <span>&#x1F4E8;</span>
          <h3>Send to Claude Code</h3>
        </div>
        <div class="meta">
          Source: <strong>${source}</strong> &middot; ${statusText}
        </div>
        ${extracted?.subject ? `<div class="subject">${extracted.subject}</div>` : ""}
        <textarea id="instruction" placeholder="Add instruction (e.g. draft reply, summarize, research this...)"></textarea>
        <div class="hints">
          <span><kbd>Enter</kbd> send</span>
          <span><kbd>Shift+Enter</kbd> new line</span>
          <span><kbd>Esc</kbd> cancel</span>
        </div>
        <div class="buttons">
          <button class="btn-cancel" id="cancel">Cancel</button>
          <button class="btn-send" id="send">Send</button>
        </div>
        <div class="status" id="status"></div>
      </div>
    </div>
  `;

  document.body.appendChild(host);

  const overlay = shadow.querySelector(".overlay");
  const cancelBtn = shadow.getElementById("cancel");
  const sendBtn = shadow.getElementById("send");
  const statusEl = shadow.getElementById("status");
  const textarea = shadow.getElementById("instruction");

  function closePopup() {
    host.remove();
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePopup();
  });

  cancelBtn.addEventListener("click", closePopup);

  // Force focus into shadow DOM textarea — Slack aggressively reclaims focus
  textarea.focus();
  setTimeout(() => textarea.focus(), 50);
  setTimeout(() => textarea.focus(), 200);

  // Intercept ALL keyboard events at document level (capture phase)
  // This prevents Slack/Gmail from stealing keystrokes while popup is open
  // AND handles our popup keyboard shortcuts (Enter, Escape) directly
  function handleKeydown(e) {
    if (!document.getElementById("claude-forwarder-popup")) return;

    if (e.key === "Escape") {
      closePopup();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Enter = send (Shift+Enter = newline, let it through)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      sendBtn.click();
      return;
    }

    // Block everything else from reaching the host page
    e.stopPropagation();
  }

  function blockPropagation(e) {
    if (!document.getElementById("claude-forwarder-popup")) return;
    e.stopPropagation();
  }

  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("keyup", blockPropagation, true);
  document.addEventListener("keypress", blockPropagation, true);

  // Clean up event listeners when popup is removed
  const observer = new MutationObserver(() => {
    if (!document.getElementById("claude-forwarder-popup")) {
      document.removeEventListener("keydown", handleKeydown, true);
      document.removeEventListener("keyup", blockPropagation, true);
      document.removeEventListener("keypress", blockPropagation, true);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  async function sendToWebhook() {
    const instruction = textarea.value.trim();

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";
    statusEl.style.display = "block";
    statusEl.style.color = "#666";
    statusEl.textContent = "Forwarding to Claude Code...";

    const payload = {
      source,
      url,
      extraction_method: extracted ? "dom" : "url_only",
      instruction: instruction || "",
    };

    if (extracted) {
      if (extracted.subject) payload.subject = extracted.subject;
      if (extracted.thread) payload.thread = extracted.thread;
      if (extracted.thread_id) payload.thread_id = extracted.thread_id;
      if (extracted.gmail_thread_id) payload.gmail_thread_id = extracted.gmail_thread_id;
      if (extracted.hint) payload.hint = extracted.hint;
    }

    try {
      // Relay through background script to avoid CORS issues
      const resp = await chrome.runtime.sendMessage({
        action: "send-to-webhook",
        payload,
      });

      if (resp?.ok && resp?.data?.ok) {
        statusEl.style.color = "#16a34a";
        statusEl.textContent = `Sent! Session: ${resp.data.session_name}`;
        setTimeout(closePopup, 1500);
      } else {
        const errMsg = resp?.data?.error || resp?.error || "Unknown error";
        statusEl.style.color = "#dc2626";
        statusEl.textContent = `Error: ${errMsg}`;
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
      }
    } catch (err) {
      statusEl.style.color = "#dc2626";
      statusEl.textContent = `Connection failed. Is the webhook running? (localhost:5581)`;
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  }

  sendBtn.addEventListener("click", sendToWebhook);
}
