// MAIN-world content script: shows a post's comments right under it in the
// feed instead of Facebook's post dialog ("inlineComments" option).
//
// Facebook's Comment button always opens the post dialog, and the comments
// arrive in that dialog's own query (CometSinglePostDialogContentQuery). So
// the click is let through, the dialog is kept invisible while it loads
// (html[data-fbc-cpending] in hide.css), its response is read from the XHR,
// the dialog is closed again and the comments are drawn under the post.
// Changing the sort order asks Facebook's own comment list query
// (CommentListComponentsRootQuery) directly, with the post's feedback ID and
// the chosen ordering from that first response. A comment typed in the
// panel's box is posted by Facebook itself: the hidden dialog's own comment
// box (a Lexical editor) gets the text and submits it. Loading more comments,
// replies, photos and stickers still use Facebook's dialog.
// Any failure shows the dialog as usual, so the worst case is Facebook's
// normal behaviour.
(() => {
  const root = document.documentElement;
  const QUERY = "CometSinglePostDialogContentQuery";
  const SORT_QUERY = "CommentListComponentsRootQuery";
  const BUTTON = '[data-ad-rendering-role="comment_button"]';
  const TIMEOUT_MS = 8000;
  // Facebook keeps a post it has already shown in its Relay store and then
  // opens the dialog without a request; comments seen before are kept here
  // (by post URL) and anything else falls back to the dialog quickly.
  const NO_REQUEST_MS = 3000;
  // Facebook preloads the dialog's query when the pointer rests on Comment
  // (onCommentHoverIn / onCommentPressIn), i.e. before the click. Every such
  // request is remembered with the button it was made for.
  const PRELOAD_MS = 120000;
  const requests = []; // { button, at, done, data }
  const CACHE_MAX = 50;
  const OTHER_VIEWER = /^\/(reel|watch|stories|photo|photos)\b|\/(videos|reel|photos)\//;
  const cache = new Map();
  // Facebook's own "View more comments" link under a post opens the dialog
  // too; it opens this panel instead.
  const MORE = /^(Xem thêm bình luận|Xem bình luận trước|View more comments|View previous comments)/i;
  const UNIT = '[role="main"] [data-virtualized], [role="main"] [role="article"]';

  const TEXT = {
    vi: {
      loading: "Đang tải bình luận…",
      empty: "Chưa có bình luận nào.",
      all: (n) => `Xem tất cả ${n} bình luận`,
      write: "Viết bình luận",
      hide: "Ẩn bình luận",
      replies: (n) => `${n} phản hồi`,
      media: "Ảnh trong bình luận",
      like: (n) => `${n} lượt thích`,
      now: "Vừa xong",
      sort: "Sắp xếp bình luận",
      placeholder: "Viết bình luận…",
      send: "Gửi bình luận",
      posting: "Đang gửi…",
      postFailed: "Chưa gửi được. Bấm Gửi để thử lại.",
      you: "Bạn",
      failed: "Không tải được bình luận.",
      ago: { m: "phút", h: "giờ", d: "ngày", w: "tuần" },
    },
    en: {
      loading: "Loading comments…",
      empty: "No comments yet.",
      all: (n) => `View all ${n} comments`,
      write: "Write a comment",
      hide: "Hide comments",
      replies: (n) => `${n} ${n === 1 ? "reply" : "replies"}`,
      media: "Image in comment",
      like: (n) => `${n} ${n === "1" ? "like" : "likes"}`,
      now: "Just now",
      sort: "Sort comments",
      placeholder: "Write a comment…",
      send: "Post comment",
      posting: "Posting…",
      postFailed: "Couldn't post. Press Send to try again.",
      you: "You",
      failed: "Couldn't load comments.",
      ago: { m: "m", h: "h", d: "d", w: "w" },
    },
  };
  const t = () => TEXT[(root.lang || "").toLowerCase().startsWith("vi") ? "vi" : "en"];

  let pending = null; // { unit, button, panel, url, timer, started, requested }
  let sorting = null; // { done, data } while a re-sort goes through the dialog
  let posting = null; // { sent, done, ok, data } while a comment goes through the dialog

  const enabled = () => root.hasAttribute("data-fbc-inline");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- Click: let Facebook open its dialog, hidden --------------------------
  document.addEventListener(
    "click",
    (e) => {
      if (!enabled() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      let button = e.target instanceof Element && e.target.closest('[role="button"]');
      if (!button || button.closest('[role="dialog"]') || button.closest("[data-fbc-comments]")) return;
      if (!button.querySelector(BUTTON)) {
        // Facebook's "View more comments" under a post: open the panel.
        const host = MORE.test(button.textContent.trim()) && button.closest(UNIT);
        const comment = host && host.querySelector(BUTTON);
        if (!comment) return;
        e.preventDefault();
        e.stopPropagation();
        const open = host.querySelector("[data-fbc-comments]");
        if (open) open.scrollIntoView({ block: "nearest" });
        else comment.closest('[role="button"]').click();
        return;
      }
      // "Write a comment" / "All comments" in the panel re-click the button
      // and want Facebook's own dialog.
      if (button.hasAttribute("data-fbc-native")) {
        button.removeAttribute("data-fbc-native");
        return;
      }
      const unit = button.closest(UNIT);
      // Reel posts open the Reels viewer; leave those to Facebook.
      if (!unit || unit.querySelector('a[href*="/reel/"]')) return;
      const open = unit.querySelector(":scope [data-fbc-comments]");
      if (open) {
        // Second click on Comment folds the panel away.
        e.preventDefault();
        e.stopPropagation();
        removePanel(open);
        return;
      }
      if (pending) finish(pending, false);
      const panel = buildPanel(button);
      const status = el("div", "fbc-cm-status fbc-cm-loading");
      status.setAttribute("role", "status");
      status.append(el("span", "fbc-cm-spin"), el("span", "", t().loading));
      panel.append(status, el("div", "fbc-cm-bar"));
      placePanel(button, panel);
      hideNative(unit, button, panel);
      const p = { unit, button, panel, url: location.href, timer: 0, started: Date.now(), requested: false, data: null };
      pending = p;
      p.timer = setTimeout(() => finish(p, false), TIMEOUT_MS);
      root.setAttribute("data-fbc-cpending", "");
      layerObserver.observe(document.body, { childList: true, subtree: true });
      // Already requested while hovering: use that response.
      const pre = requests.filter((r) => r.button === button && Date.now() - r.at < PRELOAD_MS).pop();
      if (pre) {
        p.requested = true;
        if (pre.done) queueMicrotask(() => onData(p, pre.data));
      }
      requestAnimationFrame(() => watch(p));
    },
    true
  );

  // The dialog's layer also holds Facebook's dark backdrop next to the dialog
  // itself; the whole layer is hidden from the MutationObserver callback, i.e.
  // before it is ever painted.
  const layerObserver = new MutationObserver(hideLayer);
  function hideLayer() {
    for (const d of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
      const outer = d.parentElement && d.parentElement.closest('[role="dialog"]');
      const layer = (outer || d).parentElement;
      if (layer && layer !== document.body && !layer.hasAttribute("data-fbc-layer")) layer.setAttribute("data-fbc-layer", "");
    }
    // Popover menus (the dialog's sort menu) sit in a layer of their own.
    const main = document.querySelector('[role="main"]');
    for (const m of document.querySelectorAll('[role="menu"], [role="listbox"]')) {
      let layer = m;
      while (layer.parentElement && layer.parentElement !== document.body && !(main && layer.parentElement.contains(main))) layer = layer.parentElement;
      if (layer !== document.body && !layer.hasAttribute("data-fbc-layer")) layer.setAttribute("data-fbc-layer", "");
    }
  }
  function showLayers() {
    layerObserver.disconnect();
    for (const l of document.querySelectorAll("[data-fbc-layer]")) l.removeAttribute("data-fbc-layer");
    root.removeAttribute("data-fbc-cpending");
  }

  // Facebook moves to the post's URL as the dialog opens. Serve it from the
  // cache when possible. With no request on the way (Facebook already had the
  // post and drew the dialog straight away), show the dialog.
  function watch(p) {
    if (p !== pending) return;
    if (location.href !== p.url) {
      // Reels, videos and photos open their own viewer, not the post dialog.
      if (OTHER_VIEWER.test(location.pathname)) return finish(p, false);
      const hit = cache.get(location.pathname);
      if (hit && !p.requested) return onData(p, hit);
    }
    if (!p.requested) {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      const drawn = dialog && dialog.querySelector('[contenteditable="true"], [role="textbox"]');
      if (drawn || Date.now() - p.started > NO_REQUEST_MS) return finish(p, false);
    }
    requestAnimationFrame(() => watch(p));
  }

  // The Comment button under the pointer, for requests made on hover.
  function hoveredButton() {
    const hovered = document.querySelectorAll(":hover");
    const last = hovered[hovered.length - 1];
    const button = last && last.closest('[role="button"]');
    return button && button.querySelector(BUTTON) ? button : null;
  }

  // ---- XHR: read the dialog's own response ----------------------------------
  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  proto.open = function (method, url) {
    this.__fbcUrl = url;
    return origOpen.apply(this, arguments);
  };
  proto.send = function (body) {
    try {
      if (enabled() && typeof body === "string" && body.includes(QUERY) && String(this.__fbcUrl).includes("/api/graphql")) {
        const button = pending ? pending.button : hoveredButton();
        if (button) {
          const rec = { button, at: Date.now(), done: false, data: null };
          requests.push(rec);
          if (requests.length > 10) requests.shift();
          if (pending && pending.button === button) pending.requested = true;
          this.addEventListener("loadend", () => onResponse(rec, this));
        }
      }
      const po = posting;
      if (po && typeof body === "string" && /fb_api_req_friendly_name=[^&]*(CreateComment|CommentCreate)/i.test(body) && String(this.__fbcUrl).includes("/api/graphql")) {
        po.sent = true;
        this.addEventListener("loadend", () => {
          po.ok = this.status === 200 && !/^\s*\{"errors"/.test(this.responseText || "");
          try {
            po.data = po.ok ? newComment(this.responseText) : null;
          } catch {
            po.data = null;
          }
          po.done = true;
        });
      }
      const so = sorting;
      if (so && typeof body === "string" && body.includes(SORT_QUERY) && String(this.__fbcUrl).includes("/api/graphql")) {
        this.addEventListener("loadend", () => {
          try {
            so.data = this.status === 200 ? parse(this.responseText) : null;
          } catch {
            so.data = null;
          }
          so.done = true;
        });
      }
    } catch {
      // Never get in the way of Facebook's own request.
    }
    return origSend.apply(this, arguments);
  };

  function onResponse(rec, xhr) {
    try {
      rec.data = xhr.status === 200 ? parse(xhr.responseText) : null;
    } catch {
      rec.data = null;
    }
    rec.done = true;
    if (pending && pending.button === rec.button) onData(pending, rec.data);
  }

  function onData(p, data) {
    if (p !== pending) return;
    if (!data) return finish(p, false);
    p.data = data;
    render(p, data);
    finish(p, true);
  }

  function remember(path, data) {
    cache.delete(path);
    cache.set(path, data);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  // The response is several JSON documents (one per line, @defer chunks).
  // Returns the comments plus what a re-sort needs: the post's feedback ID and
  // the orderings Facebook offers for it.
  function parse(text) {
    const docs = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        docs.push(JSON.parse(line));
      } catch {
        // Partial or non-JSON line: skip.
      }
    }
    const find = (test) => {
      let hit = null;
      const walk = (o) => {
        if (hit || !o || typeof o !== "object") return;
        if (test(o)) {
          hit = o;
          return;
        }
        for (const k in o) walk(o[k]);
      };
      docs.forEach(walk);
      return hit;
    };
    const holder = find((o) => o.comment_list_renderer);
    const list = holder ? holder.comment_list_renderer : null;
    let conn = null;
    const findConn = (o) => {
      if (conn || !o || typeof o !== "object") return;
      if (o.comments && Array.isArray(o.comments.edges)) {
        conn = o.comments;
        return;
      }
      for (const k in o) findConn(o[k]);
    };
    if (list) findConn(list);
    else docs.forEach(findConn);
    if (!conn) return null;
    const intentsHolder = find((o) => o.selected_intent || Array.isArray(o.selectable_intents));
    const intents = [];
    const add = (i, selected) => {
      if (!i || !i.intent_token || !i.title) return;
      const known = intents.find((x) => x.token === i.intent_token);
      if (known) known.selected ||= selected;
      else intents.push({ token: i.intent_token, title: i.title, selected });
    };
    if (intentsHolder) {
      add(intentsHolder.selected_intent, true);
      (intentsHolder.selectable_intents || []).forEach((i) => add(i, false));
    }
    return {
      total: Number(conn.total_count) || conn.edges.length,
      comments: conn.edges.map((e) => e && e.node).filter(Boolean).map(comment),
      feedbackId: (list && list.feedback && list.feedback.id) || null,
      intents,
    };
  }

  // Comments in another order, straight from Facebook's comment list query.
  // Its document ID and provided variables come from Facebook's own module,
  // the session tokens from the page, as Facebook's own request has them.
  async function fetchSorted(feedbackId, token) {
    const req = window.require;
    const op = req("CommentListComponentsRootQuery.graphql").params;
    const provided = Object.fromEntries(Object.entries(op.providedVariables || {}).map(([k, v]) => [k, v.get()]));
    const user = req("CurrentUserInitialData").USER_ID;
    const variables = {
      commentsIntentToken: token,
      feedLocation: "POST_PERMALINK_DIALOG",
      feedbackSource: 2,
      focusCommentID: null,
      scale: Math.round(window.devicePixelRatio) || 1,
      useDefaultActor: false,
      id: feedbackId,
      ...provided,
    };
    const body = new URLSearchParams({
      av: user,
      __user: user,
      __a: "1",
      fb_dtsg: req("DTSGInitialData").token,
      lsd: req("LSD").token,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "CommentListComponentsRootQuery",
      variables: JSON.stringify(variables),
      server_timestamps: "true",
      doc_id: op.id,
    });
    const res = await fetch("/api/graphql/", { method: "POST", body, credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parse(await res.text());
    if (!data) throw new Error("no comments in response");
    return data;
  }

  function comment(node) {
    const a = node.author || {};
    const fb = node.feedback || {};
    const replies = ((fb.replies_connection && fb.replies_connection.edges) || []).map((e) => e && e.node).filter(Boolean);
    return {
      name: a.name || "",
      url: a.url || "",
      avatar: (a.profile_picture_depth_0 && a.profile_picture_depth_0.uri) || (a.profile_picture_depth_1 && a.profile_picture_depth_1.uri) || "",
      text: (node.preferred_body && node.preferred_body.text) || (node.body && node.body.text) || "",
      media: Array.isArray(node.attachments) ? node.attachments.map(attachment).find(Boolean) || null : null,
      time: Number(node.created_time) || 0,
      likes: (fb.reactors && fb.reactors.count_reduced) || "0",
      replyCount: (fb.replies_fields && Number(fb.replies_fields.total_count)) || replies.length,
      replies: replies.map(comment),
    };
  }

  // Photo, sticker, GIF or link preview attached to a comment: the first image
  // Facebook sends for it, plus where it links to.
  function attachment(a) {
    const att = a && a.style_type_renderer && a.style_type_renderer.attachment;
    if (!att) return null;
    const media = att.media || {};
    let img = null;
    for (const k of ["image", "animated_image", "preview_image", "fallback_image", "photo_image"]) {
      if (media[k] && media[k].uri) {
        img = media[k];
        break;
      }
    }
    if (!img) {
      const find = (o) => {
        if (img || !o || typeof o !== "object") return;
        if (typeof o.uri === "string" && o.width) img = o;
        else for (const k in o) find(o[k]);
      };
      find(media);
    }
    if (!img) return null;
    return { src: img.uri, width: Number(img.width) || 0, height: Number(img.height) || 0, href: att.url || "" };
  }

  // ---- Close the hidden dialog --------------------------------------------
  function finish(p, ok) {
    if (p !== pending) return;
    pending = null;
    clearTimeout(p.timer);
    if (!ok) {
      // Fall back to Facebook's dialog, which is already open underneath.
      removePanel(p.panel);
      showLayers();
      return;
    }
    closeHidden(p.url, () => p.data && remember(location.pathname, p.data));
  }

  // The data can be ready (preloaded) before Facebook has even opened the
  // dialog, and a close request sent while it is still opening is ignored, so
  // keep asking until it is gone. Closing goes through Facebook itself
  // (Escape, then its close button): it puts the URL back on its own, and
  // stepping back in history ourselves as well would leave the page.
  function closeHidden(url, onRouted) {
    const started = Date.now();
    let lastClose = 0;
    let attempts = 0;
    let seenDialog = false;
    let routed = false;
    const step = () => {
      const now = Date.now();
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dialog) seenDialog = true;
      if (location.href !== url && !routed) {
        routed = true;
        if (onRouted) onRouted();
      }
      // Once a routed dialog has given the URL back it is closing: let it go.
      const closing = routed && location.href === url;
      if (dialog && !closing && now - lastClose > 500) {
        lastClose = now;
        closeDialog(dialog, ++attempts);
      }
      const gone = !dialog && location.href === url;
      // Done once the dialog has come and gone (or never came at all).
      if ((gone && (seenDialog || now - started > 1500)) || now - started > 6000) showLayers();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Escape first; if Facebook ignores it, its own close button.
  function closeDialog(dialog, attempt) {
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    if (attempt > 2) {
      const close = dialog.querySelector('[role="button"][aria-label="Đóng"], [role="button"][aria-label="Close"]');
      if (close) close.click();
    }
  }

  // ---- Panel --------------------------------------------------------------
  // Facebook sometimes shows a few comments, "View more comments" and its own
  // comment box under a post, and draws them (again) once a comment has been
  // posted. While the panel is open all of that is hidden so nothing shows
  // twice, including what Facebook adds later.
  function hideNative(unit, button, panel) {
    const mark = (n) => {
      if (n && !n.hasAttribute("data-fbc-dup")) n.setAttribute("data-fbc-dup", "");
    };
    const sweep = () => {
      for (const a of unit.querySelectorAll('[role="article"]')) {
        if (a.contains(button) || panel.contains(a)) continue;
        const outer = a.parentElement && a.parentElement.closest('[role="article"]');
        if (outer && !outer.contains(button)) continue; // a reply: its parent goes
        mark(a);
      }
      for (const b of unit.querySelectorAll('[role="button"]')) {
        if (!panel.contains(b) && MORE.test(b.textContent.trim())) mark(b);
      }
      // Facebook's comment box: its whole row, avatar included.
      for (const box of unit.querySelectorAll('[contenteditable="true"][role="textbox"]')) {
        if (panel.contains(box)) continue;
        let row = box;
        while (
          row.parentElement &&
          !row.parentElement.hasAttribute("data-virtualized") &&
          !row.parentElement.contains(button) &&
          !row.parentElement.contains(panel) &&
          row.parentElement.getBoundingClientRect().height < 200
        ) {
          row = row.parentElement;
        }
        mark(row);
      }
    };
    sweep();
    let queued = false;
    const watcher = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (panel.isConnected) sweep();
      });
    });
    watcher.observe(unit, { childList: true, subtree: true });
    panel.__fbcWatcher = watcher;
  }

  function removePanel(panel) {
    if (panel.__fbcWatcher) panel.__fbcWatcher.disconnect();
    const unit = panel.closest("[data-virtualized]") || panel.parentElement;
    if (unit) for (const n of unit.querySelectorAll("[data-fbc-dup]")) n.removeAttribute("data-fbc-dup");
    panel.remove();
  }

  function buildPanel() {
    const panel = el("div", "fbc-cm");
    panel.setAttribute("data-fbc-comments", "");
    return panel;
  }

  // Right after the Like / Comment / Share row, as a sibling in the post's
  // content column. The row sits in fixed-height, overflow-hidden wrappers,
  // so climb out of everything that is only as tall as the row itself.
  function placePanel(button, panel) {
    let row = button;
    while (row.parentElement && !row.parentElement.hasAttribute("data-virtualized") && row.parentElement.getBoundingClientRect().height < 120) {
      row = row.parentElement;
    }
    row.after(panel);
  }

  function ago(sec) {
    const s = t();
    const d = Math.max(0, Date.now() / 1000 - sec);
    if (d < 60) return s.now;
    if (d < 3600) return `${Math.floor(d / 60)} ${s.ago.m}`;
    if (d < 86400) return `${Math.floor(d / 3600)} ${s.ago.h}`;
    if (d < 7 * 86400) return `${Math.floor(d / 86400)} ${s.ago.d}`;
    if (d < 30 * 86400) return `${Math.floor(d / (7 * 86400))} ${s.ago.w}`;
    return new Date(sec * 1000).toLocaleDateString(root.lang || undefined);
  }

  function item(c, depth) {
    const s = t();
    const row = el("div", "fbc-cm-item");
    if (depth) row.classList.add("fbc-cm-reply");
    const av = el("img", "fbc-cm-av");
    av.alt = "";
    av.loading = "lazy";
    if (/^https:\/\/[^/]+\.(fbcdn\.net|facebook\.com)\//.test(c.avatar)) av.src = c.avatar;
    const body = el("div", "fbc-cm-body");
    const bubble = el("div", "fbc-cm-bubble");
    const name = el(c.url ? "a" : "span", "fbc-cm-name", c.name);
    if (c.url && /^https:\/\/(www|web)\.facebook\.com\//.test(c.url)) name.href = c.url;
    bubble.append(name);
    if (c.text) bubble.append(el("div", "fbc-cm-text", c.text));
    let media = null;
    if (c.media && /^https:\/\/[^/]+\.(fbcdn\.net|facebook\.com)\//.test(c.media.src)) {
      media = el(/^https:\/\/(www|web|l)\.facebook\.com\//.test(c.media.href) ? "a" : "div", "fbc-cm-att");
      if (media.tagName === "A") {
        media.href = c.media.href;
        media.target = "_blank";
        media.rel = "noopener noreferrer";
      }
      const img = el("img");
      img.alt = s.media;
      img.loading = "lazy";
      img.src = c.media.src;
      if (c.media.width && c.media.height) {
        img.width = c.media.width;
        img.height = c.media.height;
      }
      media.append(img);
    } else if (c.media) bubble.append(el("div", "fbc-cm-media", s.media));
    if (!c.text && media) bubble.classList.add("fbc-cm-bare");
    const meta = el("div", "fbc-cm-meta", c.time ? ago(c.time) : "");
    if (c.likes && c.likes !== "0") meta.append(el("span", "", s.like(c.likes)));
    body.append(bubble);
    if (media) body.append(media);
    body.append(meta);
    for (const r of c.replies) body.append(item(r, depth + 1));
    if (c.replyCount > c.replies.length) body.append(el("div", "fbc-cm-more", s.replies(c.replyCount)));
    row.append(av, body);
    return row;
  }

  // p: { panel, button } of the post. Called for the first load and again
  // after every re-sort.
  function render(p, data) {
    const s = t();
    const panel = p.panel;
    panel.textContent = "";
    panel.__fbcData = data;
    // Sort menu, when Facebook offers more than one ordering for this post.
    if (data.feedbackId && data.intents.length > 1) {
      const head = el("div", "fbc-cm-head");
      const select = el("select", "fbc-cm-sort");
      select.setAttribute("aria-label", s.sort);
      for (const i of data.intents) {
        const o = el("option", "", i.title);
        o.value = i.token;
        o.selected = i.selected;
        select.append(o);
      }
      select.addEventListener("change", () => resort(p, select.value));
      head.append(select);
      panel.append(head);
    }
    const list = el("div", "fbc-cm-list");
    if (!data.comments.length) list.append(el("div", "fbc-cm-status", s.empty));
    for (const c of data.comments) list.append(item(c, 0));
    panel.append(list);
    const foot = el("div", "fbc-cm-foot");
    const openDialog = () => {
      p.button.setAttribute("data-fbc-native", "");
      p.button.click();
    };
    const native = (label) => {
      const b = el("button", "fbc-cm-link", label);
      b.type = "button";
      b.addEventListener("click", openDialog);
      return b;
    };
    // "N replies": the replies themselves live in Facebook's dialog.
    for (const more of list.querySelectorAll(".fbc-cm-more")) more.addEventListener("click", openDialog);
    const shown = data.comments.reduce((n, c) => n + 1 + c.replies.length, 0);
    if (data.total > shown) foot.append(native(s.all(data.total)));
    const write = el("button", "fbc-cm-link", s.write);
    write.type = "button";
    write.addEventListener("click", () => panel.querySelector(".fbc-cm-input")?.focus());
    foot.append(write);
    const hide = el("button", "fbc-cm-link", s.hide);
    hide.type = "button";
    hide.addEventListener("click", () => removePanel(panel));
    foot.append(hide);
    panel.append(composer(p), foot);
  }

  // ---- Writing a comment ----------------------------------------------------
  // Text only; Enter sends, Shift+Enter starts a new line. Facebook posts it:
  // see postThroughDialog.
  function composer(p) {
    const s = t();
    const form = el("form", "fbc-cm-compose");
    const input = el("textarea", "fbc-cm-input");
    input.rows = 1;
    input.placeholder = s.placeholder;
    input.setAttribute("aria-label", s.placeholder);
    const send = el("button", "fbc-cm-send");
    send.type = "submit";
    send.title = s.send;
    send.setAttribute("aria-label", s.send);
    // DOM APIs only: Facebook enforces Trusted Types, so no innerHTML.
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M3.4 20.4 21 12 3.4 3.6l-.1 6.5L15 12l-11.7 1.9z");
    svg.append(path);
    send.append(svg);
    const note = el("div", "fbc-cm-note");
    note.setAttribute("role", "status");
    const fit = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    };
    input.addEventListener("input", fit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || input.disabled) return;
      input.disabled = send.disabled = true;
      form.classList.add("busy");
      note.textContent = s.posting;
      let made;
      try {
        made = await postThroughDialog(p, text);
      } catch {
        input.disabled = send.disabled = false;
        form.classList.remove("busy");
        note.textContent = s.postFailed;
        return;
      }
      // Shown at once; the cached copy of this post is out of date now.
      for (const [k, v] of cache) if (v === p.panel.__fbcData) cache.delete(k);
      const list = p.panel.querySelector(".fbc-cm-list");
      list.querySelector(":scope > .fbc-cm-status")?.remove();
      const c = made || mine(text);
      if (!c.avatar) c.avatar = myAvatar();
      list.append(item(c, 0));
      input.value = "";
      fit();
      input.disabled = send.disabled = false;
      form.classList.remove("busy");
      note.textContent = "";
      input.focus();
    });
    form.append(input, send);
    const wrap = el("div", "fbc-cm-composer");
    wrap.append(form, note);
    return wrap;
  }

  // The new comment as Facebook returns it from the create mutation.
  function newComment(text) {
    for (const line of text.split("\n")) {
      let doc;
      try {
        doc = JSON.parse(line);
      } catch {
        continue;
      }
      let node = null;
      const walk = (o) => {
        if (node || !o || typeof o !== "object") return;
        if (o.__typename === "Comment" && (o.body || o.preferred_body)) {
          node = o;
          return;
        }
        for (const k in o) walk(o[k]);
      };
      walk(doc);
      if (node) return comment(node);
    }
    return null;
  }

  // The signed-in person's picture, from Facebook's top bar.
  function myAvatar() {
    const img = document.querySelector('[role="banner"] svg image, [role="navigation"] svg image');
    return (img && (img.getAttribute("xlink:href") || img.getAttribute("href"))) || "";
  }

  function mine(text) {
    let name = t().you;
    try {
      name = window.require("CurrentUserInitialData").NAME || name;
    } catch {
      // keep the generic label
    }
    return { name, url: "", avatar: "", text, media: null, time: Date.now() / 1000, likes: "0", replyCount: 0, replies: [] };
  }

  // Lexical editor state for plain text, one line break per newline.
  function lexicalState(text) {
    const children = [];
    text.split("\n").forEach((line, i) => {
      if (i) children.push({ type: "linebreak", version: 1 });
      if (line) children.push({ detail: 0, format: 0, mode: "normal", style: "", text: line, type: "text", version: 1 });
    });
    return {
      root: {
        children: [{ children, direction: null, format: "", indent: 0, type: "paragraph", version: 1 }],
        direction: null,
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    };
  }

  // Open the post's dialog hidden, put the text in Facebook's own comment box
  // and submit it the way a person would (Enter, then the Post button if Enter
  // did nothing), wait for Facebook's create-comment request, close.
  async function postThroughDialog(p, text) {
    if (pending || sorting || posting) throw new Error("busy");
    const url = location.href;
    const po = (posting = { sent: false, done: false, ok: false, data: null });
    root.setAttribute("data-fbc-cpending", "");
    layerObserver.observe(document.body, { childList: true, subtree: true });
    p.button.setAttribute("data-fbc-native", "");
    p.button.click();
    let box = null;
    try {
      box = await waitFor(() => {
        const d = document.querySelector('[role="dialog"][aria-modal="true"]');
        const ed = d && d.querySelector('[contenteditable="true"][role="textbox"]');
        return ed && ed.__lexicalEditor ? ed : null;
      }, 6000);
      if (!box) throw new Error("no comment box");
      const editor = box.__lexicalEditor;
      editor.setEditorState(editor.parseEditorState(JSON.stringify(lexicalState(text))));
      box.focus();
      await waitFor(() => box.textContent.trim().length > 0, 1000);
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      if (!(await waitFor(() => po.sent, 1500))) {
        const form = box.closest("form");
        const buttons = form ? [...form.querySelectorAll('[role="button"]')] : [];
        const submit = buttons.find((b) => /Đăng|Gửi|Post|Send|Comment/i.test(b.getAttribute("aria-label") || "")) || buttons[buttons.length - 1];
        if (submit) submit.click();
      }
      await waitFor(() => po.done, 12000);
      if (!po.ok) throw new Error("not posted");
      return po.data;
    } finally {
      // Never leave typed text behind: Facebook would ask before closing.
      if (box && !po.ok) {
        try {
          const editor = box.__lexicalEditor;
          editor.setEditorState(editor.parseEditorState(JSON.stringify(lexicalState(""))));
        } catch {
          // the dialog is going away anyway
        }
      }
      posting = null;
      closeHidden(url);
    }
  }

  function waitFor(test, ms) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const v = test();
        if (v || Date.now() - started > ms) resolve(v || null);
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }

  // First re-sort on a page: Facebook only loads its comment list query when
  // someone uses the sort menu, so do exactly that in the (hidden) dialog and
  // read the response. Later re-sorts call the query directly.
  async function sortThroughDialog(p, intents, intent) {
    if (!intent || pending || posting) throw new Error("busy");
    const titles = intents.map((i) => i.title);
    const url = location.href;
    const so = (sorting = { done: false, data: null });
    root.setAttribute("data-fbc-cpending", "");
    layerObserver.observe(document.body, { childList: true, subtree: true });
    p.button.setAttribute("data-fbc-native", "");
    p.button.click();
    try {
      const menuButton = await waitFor(() => {
        const d = document.querySelector('[role="dialog"][aria-modal="true"]');
        return d && [...d.querySelectorAll('[role="button"]')].find((b) => titles.includes(b.textContent.trim()));
      }, 6000);
      if (!menuButton) throw new Error("no sort menu");
      menuButton.click();
      const option = await waitFor(
        () => [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')].find((m) => m.textContent.trim().startsWith(intent.title)),
        3000
      );
      if (!option) throw new Error("no sort option");
      option.click();
      await waitFor(() => so.done, 8000);
      if (!so.data) throw new Error("no response");
      return so.data;
    } finally {
      sorting = null;
      closeHidden(url);
    }
  }

  async function resort(p, token) {
    const s = t();
    const before = p.panel.__fbcData;
    const list = p.panel.querySelector(".fbc-cm-list");
    if (list) {
      list.textContent = "";
      const status = el("div", "fbc-cm-status fbc-cm-loading");
      status.setAttribute("role", "status");
      status.append(el("span", "fbc-cm-spin"), el("span", "", s.loading));
      list.append(status, el("div", "fbc-cm-bar"));
    }
    let data;
    try {
      const ready = typeof window.require === "function" && window.require("CommentListComponentsRootQuery.graphql");
      const intent = before.intents.find((i) => i.token === token);
      data = ready ? await fetchSorted(before.feedbackId, token) : await sortThroughDialog(p, before.intents, intent);
    } catch {
      if (list) {
        list.textContent = "";
        list.append(el("div", "fbc-cm-status", s.failed));
      }
      return;
    }
    if (!p.panel.isConnected) return;
    // The ordering list comes with the first response; keep it, with the new
    // choice selected.
    data.feedbackId ||= before.feedbackId;
    if (data.intents.length < 2) data.intents = before.intents.map((i) => ({ ...i, selected: i.token === token }));
    render(p, data);
  }
})();
