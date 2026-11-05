// Isolated-world content script: owns settings and stats (chrome.storage),
// reflects settings onto <html> for hide.css, and receives classification
// events from main.js (MAIN world) via window.postMessage.
(() => {
  // Keep in sync with content/settings.js.
  const DEFAULTS = {
    enabled: true,
    mode: "hide",
    allowFriendReels: false,
    showPromo: true,
    keepFeed: true,
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
  // Developer's card state (see placePromo below); declared up here because
  // apply() runs before the rest of the file.
  const PROMO_URL = "https://viennv.dev";
  const PROMO_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
  let promoSnoozedUntil = 0;
  let promoCard = null;
  // Last "keepFeed" value sent to the service worker for this tab.
  let keepTab = null;

  function apply(s) {
    settings = { ...DEFAULTS, ...s, kinds: { ...DEFAULTS.kinds, ...(s && s.kinds) } };
    hidden = new Set(settings.enabled ? Object.keys(settings.kinds).filter((k) => settings.kinds[k]) : []);
    // A friend's own reel is a normal post with a reel attachment; it is only
    // hidden when Reels are hidden and friends' reels are not allowed.
    if (hidden.has("reels") && !settings.allowFriendReels) hidden.add("reelpost");
    root.setAttribute("data-fbc-hide", [...hidden].join(" "));
    root.setAttribute("data-fbc-mode", settings.mode);
    // main.js reads this to stop Facebook's stale-feed refresh; the service
    // worker keeps the tab from being discarded by Chrome's Memory Saver.
    const keep = Boolean(settings.enabled && settings.keepFeed);
    root.toggleAttribute("data-fbc-keep", keep);
    if (keep !== keepTab) {
      keepTab = keep;
      try {
        chrome.runtime.sendMessage({ type: "keepTab", on: keep }).catch(() => {});
      } catch {
        // Extension reloaded or updated: this old content script is orphaned.
      }
    }
    placePromo();
  }

  apply(DEFAULTS);
  chrome.storage.sync.get("settings").then(({ settings: s }) => apply(s));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) apply(changes.settings.newValue);
    // Closing the card in one tab hides it in every open Facebook tab.
    if (area === "local" && changes.promoSnoozedUntil) {
      promoSnoozedUntil = changes.promoSnoozedUntil.newValue || 0;
      placePromo();
    }
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
    // The right column just got classified: the promo card's anchor exists now.
    if (kind === "rail" || kind === "birthdays") placePromo();
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
  // ---- Developer's card -------------------------------------------------------
  // One card for viennv.dev in the right column of the home page, placed where
  // Facebook's own "Sponsored" block sits (which this extension usually hides).
  // It is labelled as an ad, never enters the news feed, can be snoozed for a
  // week with its close button and switched off in the popup ("showPromo").
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }
  // The card sits inside Facebook's UI, so it follows Facebook's language
  // (<html lang>) rather than Chrome's, which chrome.i18n would use.
  const PROMO_TEXT = {
    vi: { label: "Quảng cáo", title: "MMO VPS", text: "Máy chủ ảo, proxy tĩnh · nhận máy trong vài phút", cta: "Xem gói", dismiss: "Ẩn trong 7 ngày" },
    en: { label: "Ad", title: "MMO VPS", text: "VPS & static proxies · ready in minutes", cta: "See plans", dismiss: "Hide for 7 days" },
  };

  // Built with DOM APIs only (no innerHTML), so Facebook's Trusted Types
  // policy has nothing to object to.
  function buildPromo() {
    const strings = PROMO_TEXT[(root.lang || "").toLowerCase().startsWith("vi") ? "vi" : "en"];
    const t = (k) => strings[k];
    const card = node("aside", "fbc-promo");
    card.setAttribute("aria-label", t("label"));

    const head = node("div", "fbc-promo-head");
    head.append(node("span", "fbc-promo-tag", t("label")), node("span", "fbc-promo-domain", "viennv.dev"));
    const close = node("button", "fbc-promo-close", "×");
    close.type = "button";
    close.title = t("dismiss");
    close.setAttribute("aria-label", t("dismiss"));
    close.addEventListener("click", (e) => {
      e.preventDefault();
      promoSnoozedUntil = Date.now() + PROMO_SNOOZE_MS;
      chrome.storage.local.set({ promoSnoozedUntil });
      placePromo();
    });
    head.append(close);

    const body = node("a", "fbc-promo-body");
    body.href = PROMO_URL;
    body.target = "_blank";
    body.rel = "noopener";
    const logo = node("span", "fbc-promo-logo");
    logo.setAttribute("role", "img");
    logo.setAttribute("aria-label", "MMO VPS");
    const text = node("span", "fbc-promo-text");
    text.append(node("b", "", t("title")), node("span", "", t("text")));
    body.append(logo, text, node("span", "fbc-promo-cta", t("cta")));

    card.append(head, body);
    return card;
  }

  function placePromo() {
    const wanted =
      settings.enabled && settings.showPromo && Date.now() >= promoSnoozedUntil && root.hasAttribute("data-fbc-home");
    // Facebook's sponsored block when there is one, else the birthdays block.
    const anchor = wanted && document.querySelector('[data-fbc-kind="rail"], [data-fbc-kind="birthdays"]');
    if (!anchor || !anchor.parentElement) {
      promoCard?.remove();
      return;
    }
    promoCard ||= buildPromo();
    if (promoCard.nextElementSibling !== anchor) anchor.parentElement.insertBefore(promoCard, anchor);
  }

  chrome.storage.local.get("promoSnoozedUntil").then(({ promoSnoozedUntil: until }) => {
    promoSnoozedUntil = until || 0;
    placePromo();
  });
  // The right column is re-rendered now and then, and SPA navigation leaves
  // or returns to the home page; a cheap periodic check keeps the card right.
  setInterval(placePromo, 1000);
})();
