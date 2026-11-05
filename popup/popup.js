import { DEFAULTS } from "../content/settings.js";

const $ = (sel) => document.querySelector(sel);

const { settings: stored } = await chrome.storage.sync.get("settings");
let settings = { ...DEFAULTS, ...stored, kinds: { ...DEFAULTS.kinds, ...(stored && stored.kinds) } };

// Language: the VI / EN switch in the header, otherwise Chrome's UI language.
// Strings come from the extension's own _locales so the switch works whatever
// language Chrome itself uses.
const uiLang =
  settings.lang === "vi" || settings.lang === "en"
    ? settings.lang
    : ((chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || "").toLowerCase().startsWith("vi")
      ? "vi"
      : "en";
let messages = {};
try {
  messages = await (await fetch(chrome.runtime.getURL(`_locales/${uiLang}/messages.json`))).json();
} catch {
  // Fall back to chrome.i18n below.
}
const t = (key, sub) => {
  const m = messages[key];
  if (!m) return chrome.i18n.getMessage(key, sub);
  return m.message.replace(/\$([A-Za-z_]+)\$/g, (_, name) => {
    const ph = m.placeholders && m.placeholders[name.toLowerCase()];
    return ph && ph.content === "$1" ? String(sub ?? "") : "";
  });
};
document.documentElement.lang = uiLang;

for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
$("#version").textContent = `v${chrome.runtime.getManifest().version}`;

// 24×24 stroke icons (currentColor), one per row.
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  sponsored: I('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  suggested: I('<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
  reels: I('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4l3 5M14 4l3 5"/><path d="M10.5 12.5v4l3.5-2z"/>'),
  pymk: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>'),
  groups: I('<circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M2.5 19a5.5 5.5 0 0 1 11 0"/><path d="M14 14.2a5 5 0 0 1 7.5 4.8"/>'),
  stories: I('<circle cx="12" cy="12" r="8.5" stroke-dasharray="4 2.6"/><path d="M12 8.5v7M8.5 12h7"/>'),
  market: I('<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-4.5h4V20"/>'),
  search: I('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  rail: I('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/><path d="M17.5 8.5h1M17.5 12h1"/>'),
  birthdays: I('<path d="M4 20h16v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M4 16c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0"/><path d="M12 12V8"/><path d="M12 5.5c.8-.6 1-1.5.3-2.5-.9 1-1.4 1.8-.3 2.5z"/>'),
  badges: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  keepFeed: I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>'),
  inlineComments: I('<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'),
  showPromo: '<img src="../icons/mmovps.png" alt="" width="18" height="18">',
  clean: I('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8.5 4v16M15.5 4v16" stroke-dasharray="2 2.4"/>'),
};

// Popup layout: groups of rows. "allowFriendReels" is an option of Reels
// rather than a kind, so it is drawn indented under it.
const GROUPS = [
  ["groupFeed", ["sponsored", "suggested", "reels", "allowFriendReels", "pymk", "groups", "stories"]],
  ["groupAds", ["market", "search", "rail"]],
  ["groupLayout", ["birthdays", "badges", "clean", "keepFeed", "inlineComments", "showPromo"]],
];

// Headline breakdown buckets, summed from per-kind totals.
const BUCKETS = {
  "#b-ads": ["sponsored", "market", "search", "rail"],
  "#b-suggested": ["suggested", "pymk", "groups"],
  "#b-reels": ["reels"],
};

const rows = {};

const OPTIONS = new Set(["allowFriendReels", "keepFeed", "inlineComments", "showPromo"]);
const isOption = (key) => OPTIONS.has(key);
const valueOf = (key) => (isOption(key) ? settings[key] : settings.kinds[key]);
const fmt = (n) => (n || 0).toLocaleString();

function save() {
  chrome.storage.sync.set({ settings });
  render();
}

function render() {
  $("#enabled").checked = settings.enabled;
  document.body.classList.toggle("off", !settings.enabled);
  $("#status").textContent = t(settings.enabled ? "statusOn" : "statusOff");
  for (const [key, row] of Object.entries(rows)) row.input.checked = valueOf(key);
  rows.allowFriendReels.el.classList.toggle("disabled", !settings.kinds.reels);
  for (const b of document.querySelectorAll("[data-mode]")) {
    const on = b.dataset.mode === settings.mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  }
}

function renderStats(stats = {}) {
  const today = stats.day === new Date().toISOString().slice(0, 10) ? stats.today || {} : {};
  const total = stats.total || {};
  const sum = (o, keys = Object.keys(o)) => keys.reduce((a, k) => a + (o[k] || 0), 0);
  $("#total").textContent = fmt(sum(total));
  const todayCount = sum(today);
  $("#today").textContent = todayCount ? t("statsToday", fmt(todayCount)) : "";
  for (const [sel, keys] of Object.entries(BUCKETS)) $(sel).textContent = fmt(sum(total, keys));
  for (const [key, row] of Object.entries(rows)) row.count.textContent = total[key] ? fmt(total[key]) : "";
}

const tpl = $("#kind-row");
for (const [title, keys] of GROUPS) {
  const h = document.createElement("h2");
  h.textContent = t(title);
  const group = document.createElement("div");
  group.className = "card group";
  for (const key of keys) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.querySelector(".name").textContent = t(`kind_${key}`);
    if (ICONS[key]) el.querySelector(".ico").innerHTML = ICONS[key];
    if (key === "allowFriendReels") el.classList.add("sub");
    const input = el.querySelector("input");
    input.addEventListener("change", () => {
      settings = isOption(key)
        ? { ...settings, [key]: input.checked }
        : { ...settings, kinds: { ...settings.kinds, [key]: input.checked } };
      save();
    });
    rows[key] = { el, input, count: el.querySelector(".count") };
    group.append(el);
  }
  $("#kinds").append(h, group);
}

$("#enabled").addEventListener("change", (e) => {
  settings = { ...settings, enabled: e.target.checked };
  save();
});
for (const b of document.querySelectorAll("[data-mode]")) {
  b.addEventListener("click", () => {
    settings = { ...settings, mode: b.dataset.mode };
    save();
  });
}
$("#reset").addEventListener("click", () => chrome.storage.local.set({ stats: {} }));

for (const b of document.querySelectorAll("[data-lang]")) {
  const on = b.dataset.lang === uiLang;
  b.classList.toggle("on", on);
  b.setAttribute("aria-checked", on);
  b.addEventListener("click", async () => {
    if (b.dataset.lang === uiLang) return;
    settings = { ...settings, lang: b.dataset.lang };
    await chrome.storage.sync.set({ settings });
    location.reload();
  });
}

render();
renderStats((await chrome.storage.local.get("stats")).stats);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.stats) renderStats(changes.stats.newValue);
  if (area === "local" && changes.update) showUpdate(changes.update.newValue);
});

// ---- Updates (copies installed from GitHub) ---------------------------------
// background.js checks the latest release every few hours; the popup shows
// what it found, re-checks when the last check is over 5 minutes old, and the
// version number in the footer checks on demand. "Update now" reloads the
// extension from its folder once the new files are in place.
const current = chrome.runtime.getManifest().version;
const isNewer = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};
function showUpdate(update) {
  const show = Boolean(update && update.version && isNewer(update.version, current));
  $("#update").hidden = !show;
  if (!show) return;
  $("#update-title").textContent = t("updateTitle", update.version);
  $("#update-notes").href = update.page;
  $("#update-download").href = update.zip || update.page;
}
// Manual check: the "Check for updates" button, and the version number too.
// The label shows the outcome for a few seconds.
let checking = false;
async function checkNow(label, idle) {
  if (checking) return;
  checking = true;
  checkButton.disabled = true;
  checkButton.classList.add("busy");
  label.textContent = t("updateChecking");
  const res = await chrome.runtime.sendMessage({ type: "checkUpdate" }).catch(() => null);
  if (res) showUpdate(res.update);
  label.textContent = !res || res.error ? t("updateFailed") : res.update ? t("updateTitle", res.update.version) : t("updateLatest");
  checkButton.classList.remove("busy");
  setTimeout(() => {
    label.textContent = idle;
    checkButton.disabled = false;
    checking = false;
  }, 2500);
}
const checkButton = $("#check-update");
const checkLabel = $("#check-label");
checkButton.addEventListener("click", () => checkNow(checkLabel, t("updateCheckNow")));
const versionButton = $("#version");
versionButton.title = t("updateCheck");
versionButton.addEventListener("click", () => checkNow(versionButton, `v${current}`));
$("#update-reload").addEventListener("click", () => chrome.runtime.reload());

const { update, updateCheckedAt = 0 } = await chrome.storage.local.get(["update", "updateCheckedAt"]);
showUpdate(update);
if (Date.now() - updateCheckedAt > 5 * 60 * 1000) {
  chrome.runtime.sendMessage({ type: "checkUpdate" }).then((res) => res && showUpdate(res.update)).catch(() => {});
}
