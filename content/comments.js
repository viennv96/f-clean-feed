// MAIN-world content script: shows a post's comments right under it in the
// feed instead of Facebook's post dialog ("inlineComments" option).
//
// Facebook's Comment button always opens the post dialog, and the comments
// arrive in that dialog's own query (CometSinglePostDialogContentQuery). So
// the click is let through, the dialog is kept invisible while it loads
// (html[data-fbc-cpending] in hide.css), its response is read from the XHR,
// the dialog is closed again and the comments are drawn under the post.
// Writing a comment or loading more still uses Facebook's dialog ("Write a
// comment" / "All comments" in the panel). Any failure shows the dialog as
// usual, so the worst case is Facebook's normal behaviour.
(() => {
  const root = document.documentElement;
  const QUERY = "CometSinglePostDialogContentQuery";
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
      ago: { m: "m", h: "h", d: "d", w: "w" },
    },
  };
  const t = () => TEXT[(root.lang || "").toLowerCase().startsWith("vi") ? "vi" : "en"];

  let pending = null; // { unit, button, panel, url, timer, started, requested }

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
      const button = e.target instanceof Element && e.target.closest('[role="button"]');
      if (!button || !button.querySelector(BUTTON) || button.closest('[role="dialog"]')) return;
      // "Write a comment" / "All comments" in the panel re-click the button
      // and want Facebook's own dialog.
      if (button.hasAttribute("data-fbc-native")) {
        button.removeAttribute("data-fbc-native");
        return;
      }
      const unit = button.closest('[role="main"] [data-virtualized], [role="main"] [role="article"]');
      // Reel posts open the Reels viewer; leave those to Facebook.
      if (!unit || unit.querySelector('a[href*="/reel/"]')) return;
      const open = unit.querySelector(":scope [data-fbc-comments]");
      if (open) {
        // Second click on Comment folds the panel away.
        e.preventDefault();
        e.stopPropagation();
        open.remove();
        return;
      }
      if (pending) finish(pending, false);
      const panel = buildPanel(button);
      const status = el("div", "fbc-cm-status fbc-cm-loading");
      status.setAttribute("role", "status");
      status.append(el("span", "fbc-cm-spin"), el("span", "", t().loading));
      panel.append(status, el("div", "fbc-cm-bar"));
      placePanel(button, panel);
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
  function parse(text) {
    let list = null;
    const find = (o) => {
      if (list || !o || typeof o !== "object") return;
      if (o.comment_list_renderer) {
        list = o.comment_list_renderer;
        return;
      }
      for (const k in o) find(o[k]);
    };
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        find(JSON.parse(line));
      } catch {
        // Partial or non-JSON line: skip.
      }
      if (list) break;
    }
    if (!list) return null;
    let conn = null;
    const findConn = (o) => {
      if (conn || !o || typeof o !== "object") return;
      if (o.comments && Array.isArray(o.comments.edges)) {
        conn = o.comments;
        return;
      }
      for (const k in o) findConn(o[k]);
    };
    findConn(list);
    if (!conn) return null;
    return {
      total: Number(conn.total_count) || conn.edges.length,
      comments: conn.edges.map((e) => e && e.node).filter(Boolean).map(comment),
    };
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
      p.panel.remove();
      showLayers();
      return;
    }
    // The data can be ready (preloaded) before Facebook has even opened the
    // dialog, and a close request sent while it is still opening is ignored,
    // so keep asking until it is gone. Closing goes through Facebook itself
    // (Escape, then its close button): it puts the URL back on its own, and
    // stepping back in history ourselves as well would leave the page.
    const started = Date.now();
    let lastClose = 0;
    let attempts = 0;
    let seenDialog = false;
    let routed = false;
    const step = () => {
      const now = Date.now();
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dialog) seenDialog = true;
      if (location.href !== p.url && !routed) {
        routed = true;
        if (p.data) remember(location.pathname, p.data);
      }
      // Once a routed dialog has given the URL back it is closing: let it go.
      const closing = routed && location.href === p.url;
      if (dialog && !closing && now - lastClose > 500) {
        lastClose = now;
        closeDialog(dialog, ++attempts);
      }
      const gone = !dialog && location.href === p.url;
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

  function render(p, data) {
    const s = t();
    const panel = p.panel;
    panel.textContent = "";
    if (!data.comments.length) panel.append(el("div", "fbc-cm-status", s.empty));
    for (const c of data.comments) panel.append(item(c, 0));
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
    for (const more of panel.querySelectorAll(".fbc-cm-more")) more.addEventListener("click", openDialog);
    const shown = data.comments.reduce((n, c) => n + 1 + c.replies.length, 0);
    if (data.total > shown) foot.append(native(s.all(data.total)));
    foot.append(native(s.write));
    const hide = el("button", "fbc-cm-link", s.hide);
    hide.type = "button";
    hide.addEventListener("click", () => panel.remove());
    foot.append(hide);
    panel.append(foot);
  }
})();
