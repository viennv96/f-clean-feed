// Isolated-world content script: owns settings and stats (chrome.storage),
// reflects settings onto <html> for hide.css, and receives classification
// events from main.js (MAIN world) via window.postMessage.
(() => {
  // Keep in sync with content/settings.js.
  const DEFAULTS = {
    enabled: true,
    mode: "hide",
    allowFriendReels: false,
    kinds: {
      sponsored: true, suggested: true, reels: true, pymk: true, groups: true, stories: false,
      market: true, search: true, rail: true, birthdays: false, badges: false, clean: false,
    },
  };
  // Kinds that get a click-to-show placeholder in collapse mode; the rest
  // (rails, trays, badges) are always removed outright.
  const LABEL_KEYS = {
    sponsored: "collapsedSponsored",
    suggested: "collapsedSuggested",
    reels: "collapsedReels",
    reelpost: "collapsedReels",
    pymk: "collapsedPymk",
    groups: "collapsedGroups",
    search: "collapsedSponsored",
  };
  // Stats bucket for each classified kind ("reelpost" counts as Reels).
  const STAT_KIND = { reelpost: "reels" };
  const root = document.documentElement;
  let settings = DEFAULTS;
  let hidden = new Set();

  function apply(s) {
    settings = { ...DEFAULTS, ...s, kinds: { ...DEFAULTS.kinds, ...(s && s.kinds) } };
    hidden = new Set(settings.enabled ? Object.keys(settings.kinds).filter((k) => settings.kinds[k]) : []);
    // A friend's own reel is a normal post with a reel attachment; it is only
    // hidden when Reels are hidden and friends' reels are not allowed.
    if (hidden.has("reels") && !settings.allowFriendReels) hidden.add("reelpost");
    root.setAttribute("data-fbc-hide", [...hidden].join(" "));
    root.setAttribute("data-fbc-mode", settings.mode);
  }

  apply(DEFAULTS);
  chrome.storage.sync.get("settings").then(({ settings: s }) => apply(s));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) apply(changes.settings.newValue);
  });

  // Stats are buffered and flushed at most every 2s to keep storage writes cheap.
  let pending = {};
  let flushTimer = 0;
  function count(kind) {
    if (!hidden.has(kind)) return;
    const bucket = STAT_KIND[kind] || kind;
    pending[bucket] = (pending[bucket] || 0) + 1;
    if (!flushTimer) flushTimer = setTimeout(flush, 2000);
  }
  async function flush() {
    flushTimer = 0;
    const batch = pending;
    pending = {};
    const today = new Date().toISOString().slice(0, 10);
    const { stats = {} } = await chrome.storage.local.get("stats");
    if (stats.day !== today) stats.today = {};
    stats.day = today;
    stats.today ||= {};
    stats.total ||= {};
    for (const [k, n] of Object.entries(batch)) {
      stats.today[k] = (stats.today[k] || 0) + n;
      stats.total[k] = (stats.total[k] || 0) + n;
    }
    await chrome.storage.local.set({ stats });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__fbc !== "classified") return;
    const { kind, id } = e.data;
    if (typeof kind !== "string") return;
    if (LABEL_KEYS[kind]) {
      const el = document.querySelector(`[data-fbc-id="${Number(id)}"]`);
      if (el) el.setAttribute("data-fbc-label", chrome.i18n.getMessage(LABEL_KEYS[kind]));
    }
    // Badges and layout chrome are not "blocked items"; keep them out of stats.
    if (kind !== "badges" && kind !== "clean") count(kind);
  });

  // Collapse mode: clicking the placeholder reveals that one unit.
  document.addEventListener(
    "click",
    (e) => {
      if (settings.mode !== "collapse") return;
      const unit = e.target instanceof Element && e.target.closest("[data-fbc-label]:not([data-fbc-revealed])");
      if (!unit || e.target !== unit) return;
      unit.setAttribute("data-fbc-revealed", "");
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );
})();
