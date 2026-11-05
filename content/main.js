// MAIN-world content script. Facebook obfuscates the visible "Sponsored"
// label, so units are recognised from several independent signals: the label
// as drawn through chains of SVG <use> references, React fiber props (older
// builds expose them), aria-labelledby targets, link patterns and headings.
//
// It only classifies: elements get data-fbc-kind, and hide.css decides what is
// hidden based on the settings bridge.js reflects onto <html>.
(() => {
  if (window.__fbcLoaded) return;
  window.__fbcLoaded = true;

  // Current Facebook wraps each feed story in a virtualised-list item
  // (div[data-virtualized]) inside [role="main"]; older builds used role=feed.
  const UNIT_SELECTOR = [
    '[role="main"] div[data-virtualized]',
    '[role="feed"] > div',
    '[data-pagelet^="FeedUnit"]',
    '[data-pagelet^="GroupsFeed"] [role="feed"] > div',
  ].join(",");

  // Lower-cased phrases, per kind. Facebook localises these, so the lists
  // cover the most common UI languages; link patterns below are
  // language-independent and catch the rest.
  const PHRASES = {
    sponsored: ["sponsored", "được tài trợ", "patrocinado", "sponsorisé", "gesponsert", "bersponsor", "sponsorizzato", "реклама", "広告", "赞助内容", "贊助"],
    suggested: ["suggested for you", "gợi ý cho bạn", "sugerencias para ti", "sugerido para você", "suggéré pour vous", "vorgeschlagen für dich", "disarankan untuk anda", "suggeriti per te"],
    pymk: ["people you may know", "những người bạn có thể biết", "người bạn có thể biết", "personas que quizás conozcas", "pessoas que talvez você conheça", "vous connaissez peut-être", "personen, die du kennen könntest", "orang yang mungkin anda kenal"],
    groups: ["suggested groups", "groups you might like", "nhóm gợi ý", "nhóm bạn có thể thích", "grupos sugeridos", "groupes suggérés", "vorgeschlagene gruppen", "grup yang disarankan"],
    reels: ["reels and short videos", "reels", "thước phim", "reels y videos cortos", "reels e vídeos curtos"],
    birthdays: ["birthdays", "sinh nhật", "cumpleaños", "aniversários", "anniversaires", "geburtstage", "ulang tahun", "compleanni"],
    stories: ["stories", "tin", "historias", "histórias", "cerita"],
  };

  // Vietnamese and other accented text can arrive decomposed (NFD) or with
  // non-breaking / zero-width spaces; compare everything in one canonical form.
  function norm(s) {
    return (s || "").normalize("NFC").replace(/[\s\u00a0\u200b-\u200f\u2060\ufeff]+/g, " ").trim().toLowerCase();
  }
  for (const k in PHRASES) PHRASES[k] = PHRASES[k].map(norm);

  const SPONSORED_LINK = 'a[href*="/ads/about"], a[aria-label="Sponsored"], a[href*="ad_preferences"]';
  const PYMK_LINK = 'a[href*="/friends/suggestions"], a[href*="/friends/?"]';
  const GROUPS_LINK = 'a[href*="/groups/discover"], a[href*="/groups/feed/?"][href*="suggest"]';
  const REEL_LINK = 'a[href*="/reel/"], a[href*="/reels/"]';

  // ---- React fiber inspection ----------------------------------------------

  function fiberOf(el) {
    for (const key in el) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) return el[key];
    }
    return null;
  }

  // Keys worth descending into when looking for the feed edge or listing in props.
  const EDGE_KEYS = ["feedEdge", "edge", "story", "node", "feedUnit", "feedStory", "unit", "listing", "item", "result", "props", "value"];

  function categoryInProps(p, depth) {
    if (!p || typeof p !== "object") return null;
    if (typeof p.category === "string") return p.category;
    if (p.sponsored_data || p.sponsoredData || p.is_sponsored === true || p.isSponsored === true) return "SPONSORED";
    if (depth === 0) return null;
    for (const k of EDGE_KEYS) {
      const v = p[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const c = categoryInProps(v, depth - 1);
        if (c) return c;
      }
    }
    return null;
  }

  // Breadth-first over the element's own fiber subtree (bounded), then a few
  // ancestors, since the component holding the edge may sit just above the div.
  function fiberCategory(el) {
    const start = fiberOf(el);
    if (!start) return null;
    const queue = [start];
    for (let seen = 0; queue.length && seen < 80; seen++) {
      const f = queue.shift();
      const c = categoryInProps(f.memoizedProps, 3);
      if (c) return c;
      for (let child = f.child; child; child = child.sibling) queue.push(child);
    }
    let up = start.return;
    for (let i = 0; up && i < 6; i++, up = up.return) {
      const c = categoryInProps(up.memoizedProps, 2);
      if (c) return c;
    }
    return null;
  }

  function kindFromCategory(cat) {
    const c = cat.toUpperCase();
    if (c.includes("SPONSOR") || c === "AD" || c.includes("PROMOT")) return "sponsored";
    if (c.includes("SHORTS") || c.includes("REEL")) return "reels";
    if (c.includes("PYMK") || c.includes("PEOPLE_YOU_MAY_KNOW")) return "pymk";
    if (c.includes("GROUP") && c.includes("SUGGEST")) return "groups";
    if (c.includes("SUGGEST") || c.includes("RECOMMEND")) return "suggested";
    return null; // ORGANIC and anything unrecognised fall through to DOM checks
  }

  // ---- DOM heuristics -------------------------------------------------------

  // Facebook pads each story with runs of hidden "Facebook" filler text;
  // drop it, then keep ~300 characters, which cover the header ("Suggested
  // for you", "People you may know", ...) without reading the whole post.
  function headerText(unit) {
    return norm((unit.textContent || "").slice(0, 2000)).replace(/facebook/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
  }

  // Labels such as "Sponsored" and the post time are drawn as SVG: a <use>
  // pointing at an <svg> holding another <use>, several hops deep, ending in
  // a <text>. Follow the chain and return the text it finally draws.
  function svgText(use, budget = 40) {
    let node = use;
    while (node && budget-- > 0) {
      const ref = (node.getAttribute("href") || node.getAttribute("xlink:href") || "").replace(/^#/, "");
      const target = ref && document.getElementById(ref);
      if (!target) return null; // definitions not inserted yet
      const uses = target.querySelectorAll("use");
      if (!uses.length) return target.textContent || "";
      if (uses.length > 1) {
        const parts = [...uses].map((u) => svgText(u, budget));
        return parts.includes(null) ? null : parts.join("");
      }
      node = uses[0];
    }
    return "";
  }

  // Texts drawn by the first few SVG labels inside links (the meta line under
  // the author's name sits at the top of the unit).
  function svgLabels(unit) {
    const uses = unit.querySelectorAll("a use");
    const out = [];
    for (let i = 0; i < uses.length && i < 6; i++) {
      const t = svgText(uses[i]);
      out.push(t === null ? null : norm(t));
    }
    return out;
  }

  function hasPhrase(text, kind) {
    return PHRASES[kind].some((p) => text.includes(p));
  }

  function isPhrase(el, kind) {
    return PHRASES[kind].includes(norm(el.textContent));
  }

  // Facebook renders "Sponsored" through aria-labelledby pointing to a hidden
  // node; resolve the first few references and compare their text.
  function labelledSponsored(root) {
    const refs = root.querySelectorAll("[aria-labelledby]");
    for (let i = 0; i < refs.length && i < 8; i++) {
      for (const id of refs[i].getAttribute("aria-labelledby").split(/\s+/)) {
        const t = norm(document.getElementById(id)?.textContent);
        if (t && PHRASES.sponsored.includes(t)) return true;
      }
    }
    return false;
  }

  // Recommendation trays carry a bare heading ("Reels", "People you may
  // know"); a short heading-like leaf whose whole text is the phrase is a far
  // stronger signal than the phrase appearing somewhere in a post.
  const HEADING_SELECTOR = 'h2, h3, h4, span[dir="auto"]';
  const HEADING_KINDS = ["reels", "pymk", "groups", "suggested"];

  function headingKind(el) {
    const text = norm(el.textContent);
    if (!text || text.length > 40) return null;
    return HEADING_KINDS.find((k) => PHRASES[k].includes(text)) || null;
  }

  function unitHeadingKind(unit) {
    const heads = unit.querySelectorAll(HEADING_SELECTOR);
    for (let i = 0; i < heads.length && i < 6; i++) {
      const k = headingKind(heads[i]);
      if (k) return k;
    }
    return null;
  }

  function domKind(unit) {
    const labels = svgLabels(unit);
    if (labels.some((t) => PHRASES.sponsored.includes(t))) return "sponsored";
    if (unit.querySelector(SPONSORED_LINK) || labelledSponsored(unit)) return "sponsored";
    if (labels.some((t) => PHRASES.suggested.includes(t))) return "suggested";
    // The meta label's SVG definitions can land a moment after the story;
    // until they resolve the unit cannot be called organic.
    if (labels.includes(null)) return "pending";
    const byHeading = unitHeadingKind(unit);
    if (byHeading) return byHeading;
    const head = headerText(unit);
    if (hasPhrase(head, "pymk") || unit.querySelector(PYMK_LINK)) return "pymk";
    if (hasPhrase(head, "groups") || unit.querySelector(GROUPS_LINK)) return "groups";
    if (hasPhrase(head, "suggested")) return "suggested";
    // A tray of several reels is recommended content; a post with a single
    // reel is someone's own reel.
    const reelLinks = unit.querySelectorAll(REEL_LINK).length;
    if (reelLinks >= 3) return "reels";
    if (reelLinks > 0) return "reelpost";
    return null;
  }

  // ---- Page context ---------------------------------------------------------

  function section() {
    const p = location.pathname;
    if (p.startsWith("/marketplace")) return "market";
    if (p.startsWith("/search")) return "search";
    if (p === "/" || p === "/home.php" || p.startsWith("/?")) return "home";
    return "other";
  }

  // Ads outside the news feed are counted and toggled separately.
  function adKind(sec) {
    return sec === "market" ? "market" : sec === "search" ? "search" : "sponsored";
  }

  // ---- Marking --------------------------------------------------------------

  let nextId = 1;

  function mark(el, kind) {
    el.setAttribute("data-fbc-kind", kind);
    if (kind === "organic") return;
    const id = nextId++;
    el.setAttribute("data-fbc-id", id);
    window.postMessage({ __fbc: "classified", kind, id }, location.origin);
  }

  // Climb from el to the block that sits beside its siblings in a list or
  // grid: the first ancestor whose parent holds several children.
  function cellOf(el, stopAt) {
    let node = el;
    while (node.parentElement && node.parentElement !== stopAt && node.parentElement.childElementCount < 2) {
      node = node.parentElement;
    }
    return node;
  }

  // ---- Scanners -------------------------------------------------------------

  // Units hydrate lazily: a skeleton first, real content later (a Reels tray
  // gets its heading and links well after the unit is inserted). A unit not
  // matched yet is kept as "organic" and re-checked whenever its element
  // count changes; a matched unit is final.
  function classifyUnit(unit, sec) {
    const size = unit.getElementsByTagName("*").length;
    if (size < 8 || size === Number(unit.getAttribute("data-fbc-size"))) return;
    unit.setAttribute("data-fbc-size", size);

    const cat = fiberCategory(unit);
    let kind = (cat && kindFromCategory(cat)) || domKind(unit);
    if (kind === "pending") {
      unit.removeAttribute("data-fbc-size"); // re-check on the next pass
      return;
    }
    if (kind === "sponsored") kind = adKind(sec);
    if (kind) mark(unit, kind);
    else if (!unit.hasAttribute("data-fbc-kind")) mark(unit, "organic");
  }

  function scanFeed(sec) {
    for (const unit of document.querySelectorAll(UNIT_SELECTOR)) {
      // Comment threads and similar nested lists are virtualised too; only
      // the outermost item is a feed unit.
      if (unit.parentElement && unit.parentElement.closest("[data-virtualized]")) continue;
      const kind = unit.getAttribute("data-fbc-kind");
      if (!kind || kind === "organic") classifyUnit(unit, sec);
    }
  }

  // Fallback for trays that sit outside the selectors above (Facebook changes
  // feed markup often): find the bare heading itself and hide the block it
  // heads. Runs on the slow heartbeat only, since it sweeps the whole main
  // column.
  function scanHeadings() {
    const main = document.querySelector('[role="main"]');
    if (!main) return;
    for (const h of main.querySelectorAll(HEADING_SELECTOR)) {
      // The "Stories | Reels" switcher is a tab, not a tray heading. (Tray
      // headings themselves are often links to /reels/, so links are allowed.)
      if (h.closest('[role="tab"], [role="tablist"]')) continue;
      const kind = headingKind(h);
      if (!kind) continue;
      const owner = h.closest("[data-fbc-kind]");
      if (owner && owner.getAttribute("data-fbc-kind") !== "organic") continue;
      // Widen until the block is a sizeable card that sits among siblings.
      let block = h;
      while (
        block.parentElement &&
        block.parentElement !== main &&
        (block.parentElement.childElementCount < 2 || block.offsetHeight < 150)
      ) {
        block = block.parentElement;
      }
      if (block === main || block.contains(main)) continue;
      mark(owner && owner.contains(block) ? owner : block, kind);
    }
  }

  // Right column: sections are found by their heading ("Sponsored",
  // "Birthdays") and hidden as a whole block.
  const RAIL_SECTIONS = { rail: "sponsored", birthdays: "birthdays" };
  const RAIL_HEADINGS = "h2, h3, h4, span";

  function railKind(h) {
    if (h.closest('[data-fbc-kind="rail"], [data-fbc-kind="birthdays"]')) return null;
    return Object.keys(RAIL_SECTIONS).find((k) => isPhrase(h, RAIL_SECTIONS[k])) || null;
  }

  // From the heading, widen to the block that holds both it and its ads.
  function markRailSection(h, kind, root) {
    let block = cellOf(h, root);
    while (block.parentElement && block.parentElement !== root && !block.querySelector("a[href]")) {
      block = block.parentElement;
    }
    if (block === document.body || block.querySelector('[role="main"], [role="feed"]')) return;
    mark(block, kind);
  }

  function scanRail(full) {
    for (const rail of document.querySelectorAll('[role="complementary"]')) {
      for (const h of rail.querySelectorAll(RAIL_HEADINGS)) {
        const kind = railKind(h);
        if (kind) markRailSection(h, kind, rail);
      }
    }
    if (!full) return;
    // Layout fallback: same headings anywhere outside the centre column.
    for (const h of document.body.querySelectorAll(RAIL_HEADINGS)) {
      if (h.closest('[role="main"], [role="banner"], [role="complementary"], [role="feed"], [role="dialog"]')) continue;
      const kind = railKind(h);
      if (kind) markRailSection(h, kind, null);
    }
  }

  // Stories tray on the home page: anchored on the "create story" tile, then
  // widened until it holds several story links.
  function scanStories() {
    const anchors = document.querySelectorAll(
      '[data-pagelet="Stories"], [role="region"][aria-label], a[href*="/stories/create"]'
    );
    for (const a of anchors) {
      if (a.closest('[data-fbc-kind="stories"]')) continue;
      if (a.matches('[data-pagelet="Stories"]')) {
        mark(a, "stories");
        continue;
      }
      if (a.matches("[role=region]")) {
        if (PHRASES.stories.includes(norm(a.getAttribute("aria-label")))) mark(a, "stories");
        continue;
      }
      let tray = a;
      while (tray.parentElement && tray.querySelectorAll('a[href*="/stories/"]').length < 3) {
        tray = tray.parentElement;
        if (tray.matches('[role="main"], [role="feed"], body')) break;
      }
      if (tray.matches('[role="main"], [role="feed"], body')) continue;
      mark(cellOf(tray), "stories");
    }
  }

  // Marketplace and search: ads are cards in a grid/list rather than feed
  // units. Listings are checked through their fiber props, and any leaf
  // element reading exactly "Sponsored" marks the card it belongs to.
  function scanCards(sec) {
    const main = document.querySelector('[role="main"]');
    if (!main) return;
    const kind = adKind(sec);

    for (const link of main.querySelectorAll('a[href*="/marketplace/item/"]:not([data-fbc-seen])')) {
      if (!link.querySelector("img")) continue;
      link.setAttribute("data-fbc-seen", "");
      const cat = fiberCategory(link);
      if ((cat && kindFromCategory(cat) === "sponsored") || labelledSponsored(link)) mark(cellOf(link, main), kind);
    }

    for (const el of main.querySelectorAll("span")) {
      if (el.firstElementChild || el.closest("[data-fbc-kind], [role='feed']")) continue;
      if (!isPhrase(el, "sponsored")) continue;
      let card = el.closest("a[href]") || el;
      while (card.parentElement && card.parentElement !== main && !(card.querySelector("img") && card.querySelector("a[href]"))) {
        card = card.parentElement;
      }
      mark(cellOf(card, main), kind);
    }
  }

  // Unread counters in the top bar: a leaf showing "3" or "9+", widened to
  // the small pill that draws the red dot.
  function scanBadges() {
    const banner = document.querySelector('[role="banner"]');
    if (!banner) return;
    for (const el of banner.querySelectorAll("span, div")) {
      if (el.firstElementChild || el.closest('[data-fbc-kind="badges"]')) continue;
      const text = el.textContent.trim();
      if (!/^\d{1,2}\+?$/.test(text)) continue;
      let badge = el;
      while (
        badge.parentElement &&
        badge.parentElement.textContent.trim() === text &&
        badge.parentElement.offsetWidth > 0 &&
        badge.parentElement.offsetWidth <= 40
      ) {
        badge = badge.parentElement;
      }
      mark(badge, "badges");
    }
  }

  // Clean mode: the left shortcuts column and the right column on the home
  // page. hide.css only applies it while <html data-fbc-home> is set, so
  // these stay visible after navigating elsewhere.
  function scanClean() {
    for (const el of document.querySelectorAll('[role="navigation"], [role="complementary"]')) {
      if (el.hasAttribute("data-fbc-kind") || el.closest('[role="banner"]')) continue;
      mark(el, "clean");
    }
  }

  function scan() {
    scheduled = false;
    if (!document.body) return;
    const sec = section();
    document.documentElement.toggleAttribute("data-fbc-home", sec === "home");
    scanFeed(sec);
    if (heartbeatDue && sec !== "market" && sec !== "search") scanHeadings();
    scanRail(heartbeatDue);
    heartbeatDue = false;
    scanBadges();
    if (sec === "home") {
      scanStories();
      scanClean();
    }
    if (sec === "market" || sec === "search") scanCards(sec);
  }

  // Feed units are classified straight from the MutationObserver callback.
  // It runs as a microtask, before the browser paints, so an ad is hidden
  // before it ever appears on screen. Everything else (rails, trays, badges)
  // goes through a coalesced full scan.
  function classifyAdded(records) {
    const units = new Set();
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        const own = n.closest("[data-virtualized], [role='feed'] > div");
        if (own) units.add(own);
        else if (n.firstElementChild) for (const u of n.querySelectorAll("[data-virtualized]")) units.add(u);
      }
    }
    if (!units.size) return;
    const sec = section();
    for (const unit of units) {
      if (!unit.closest('[role="main"], [role="feed"]')) continue; // e.g. chat windows
      if (unit.parentElement && unit.parentElement.closest("[data-virtualized]")) continue;
      const kind = unit.getAttribute("data-fbc-kind");
      if (!kind || kind === "organic") classifyUnit(unit, sec);
    }
  }

  let scheduled = false;
  let heartbeatDue = true;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 120);
  }

  function onMutations(records) {
    classifyAdded(records);
    // Right-column ads get the same before-paint treatment.
    if (records.some((r) => r.addedNodes.length && r.target.nodeType === 1 && r.target.closest('[role="complementary"]'))) {
      scanRail(false);
    }
    schedule();
  }

  // Observe from document_start on <html>, so units rendered before
  // DOMContentLoaded are caught too.
  new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
  // Lazy hydration does not always add nodes to the unit itself; a slow
  // heartbeat re-checks pending units, sweeps headings and catches SPA
  // navigation.
  setInterval(() => {
    heartbeatDue = true;
    schedule();
  }, 1500);
  schedule();

  // Debug hook: window.__fbcDebug(el) shows how an element was classified.
  window.__fbcDebug = (el) => ({ category: fiberCategory(el), dom: domKind(el), kind: el.getAttribute("data-fbc-kind") });
})();
