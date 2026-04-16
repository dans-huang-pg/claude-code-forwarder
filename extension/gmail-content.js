// Content script injected into mail.google.com on-demand
// Extracts Gmail thread from DOM — works in inbox (hover) and thread view
// Returns structured data or null on failure

(function () {
  try {
    const result = { thread: [], subject: null };

    // Check if we're in a thread view (email open) or inbox list
    const messageEls = document.querySelectorAll('[data-message-id]');
    const isThreadView = messageEls.length > 0;

    // INBOX VIEW: check if hovering over an email row
    if (!isThreadView) {
      const hoveredRow = document.querySelector('tr.zA:hover');
      if (hoveredRow) {
        // Extract from hovered inbox row
        const senderEl = hoveredRow.querySelector('[email]');
        const subjectEl = hoveredRow.querySelector('.bog, .bqe');
        const snippetEl = hoveredRow.querySelector('.y2');
        const threadId = hoveredRow.getAttribute('data-thread-id') || '';

        const sender = senderEl
          ? (senderEl.getAttribute('email') || senderEl.getAttribute('name') || senderEl.textContent.trim())
          : 'unknown';
        const subject = subjectEl ? subjectEl.textContent.trim() : '';
        const snippet = snippetEl ? snippetEl.textContent.trim().replace(/^\s*-\s*/, '') : '';

        result.subject = subject || 'Gmail';
        result.thread = [{
          from: sender,
          body: snippet,
          timestamp: '',
        }];

        // Build a Gmail URL with thread ID so Claude Code can fetch full thread
        if (threadId) {
          const cleanId = threadId.replace('#thread-f:', '');
          result.gmail_thread_id = cleanId;
          result.hint = 'This is an inbox preview. Use Gmail MCP tools or search to fetch the full thread.';
        }
        return result;
      }

      // No hover, no thread view — try main content area fallback
      const main = document.querySelector('[role="main"]');
      if (main) {
        const text = main.innerText.trim();
        if (text.length > 50) {
          result.thread = [{ from: 'unknown', body: text, timestamp: '' }];
          return result;
        }
      }
      return null;
    }

    // THREAD VIEW: extract full email thread (existing logic)
    const subjectEl =
      document.querySelector('h2[data-thread-perm-id]') ||
      document.querySelector('h2.hP') ||
      document.querySelector('[role="main"] h2');
    if (subjectEl) {
      result.subject = subjectEl.textContent.trim();
    }

    for (const msgEl of messageEls) {
      const msg = { from: '', body: '', timestamp: '' };

      // Sender
      const senderEl =
        msgEl.querySelector('[email]') ||
        msgEl.querySelector('.gD') ||
        msgEl.querySelector('[data-hovercard-id]');
      if (senderEl) {
        msg.from =
          senderEl.getAttribute('email') ||
          senderEl.getAttribute('data-hovercard-id') ||
          senderEl.textContent.trim();
      }

      // Timestamp
      const timeEl =
        msgEl.querySelector('[title]') ||
        msgEl.querySelector('.g3');
      if (timeEl) {
        msg.timestamp =
          timeEl.getAttribute('title') || timeEl.textContent.trim();
      }

      // Body
      const bodyEl =
        msgEl.querySelector('.a3s') ||
        msgEl.querySelector('.ii') ||
        msgEl.querySelector('.gmail_quote')?.parentElement;
      if (bodyEl) {
        msg.body = bodyEl.innerText.trim();
      } else {
        msg.body = msgEl.innerText.trim();
      }

      if (msg.body) {
        result.thread.push(msg);
      }
    }

    if (result.thread.length === 0) return null;
    return result;
  } catch (err) {
    console.error('Claude Forwarder: Gmail extraction failed:', err);
    return null;
  }
})();
