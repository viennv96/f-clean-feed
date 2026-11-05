// Service worker.
//
// 1. While "keepFeed" is on, a Facebook tab is marked as not auto-discardable,
//    so Chrome's Memory Saver does not unload it in the background (a
//    discarded tab reloads from scratch when you come back). tabs.update needs
//    no "tabs" permission for this.
// 2. Update check for copies installed from GitHub (unpacked): Chrome cannot
//    update those by itself, so the latest GitHub release is checked every
//    hour, at browser start and when the popup opens; a newer version puts
//    "NEW" on the toolbar icon and a banner in the popup. Copies from the
//    Chrome Web Store (manifest has update_url) are updated by Chrome and skip
//    this.

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "keepTab" && sender.tab?.id != null) {
    chrome.tabs.update(sender.tab.id, { autoDiscardable: !msg.on }).catch(() => {});
    return;
  }
  if (msg?.type === "checkUpdate") {
    checkUpdate().then(reply);
    return true; // reply asynchronously
  }
});

const REPO = "viennv96/f-clean-feed";
const RELEASES = `https://github.com/${REPO}/releases/`;
const CHECK_EVERY_MIN = 60;

const fromStore = () => "update_url" in chrome.runtime.getManifest();

// "1.10.0" > "1.9.2"
function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Resolves to { update, checkedAt, error? }; update is null when up to date.
async function checkUpdate() {
  const checkedAt = Date.now();
  if (fromStore()) return { update: null, checkedAt };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = await res.json();
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    const current = chrome.runtime.getManifest().version;
    let update = null;
    if (/^\d+(\.\d+){0,3}$/.test(latest) && isNewer(latest, current)) {
      // Only ever link to this repository's own release pages and files.
      const page = String(rel.html_url || "");
      const asset = (rel.assets || []).find((a) => /\.zip$/i.test(a.name || ""));
      const zip = asset ? String(asset.browser_download_url || "") : "";
      update = {
        version: latest,
        page: page.startsWith(RELEASES) ? page : `${RELEASES}latest`,
        zip: zip.startsWith(`${RELEASES}download/`) ? zip : "",
      };
    }
    await chrome.storage.local.set({ update, updateCheckedAt: checkedAt });
    setBadge(update);
    return { update, checkedAt };
  } catch (e) {
    const { update = null } = await chrome.storage.local.get("update");
    return { update, checkedAt, error: String(e && e.message) };
  }
}

function setBadge(update) {
  chrome.action.setBadgeText({ text: update ? "NEW" : "" });
  if (update) chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
}

// Installed, reloaded or updated: (re)start the schedule and check now, which
// also clears the badge once the new version is in place.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("update-check", { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MIN });
  checkUpdate();
});
chrome.runtime.onStartup.addListener(() => checkUpdate());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "update-check") checkUpdate();
});
