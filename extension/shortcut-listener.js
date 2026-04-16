// Content script: listens for Cmd+Shift+F (Mac) / Ctrl+Shift+F (other)
// This bypasses chrome.commands which requires manual shortcut setup for unpacked extensions
document.addEventListener("keydown", (e) => {
  if (e.key === "F" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: "forward-to-claude" });
  }
}, true);
