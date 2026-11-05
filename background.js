// Service worker. While "keepFeed" is on, a Facebook tab is marked as not
// auto-discardable, so Chrome's Memory Saver does not unload it in the
// background (a discarded tab reloads from scratch when you come back).
// tabs.update needs no "tabs" permission for this.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "keepTab" || sender.tab?.id == null) return;
  chrome.tabs.update(sender.tab.id, { autoDiscardable: !msg.on }).catch(() => {});
});
