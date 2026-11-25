/* Iceland Aero Agents – Staff Portal
   News: short posts from management, shown on Home (newest and pinned
   first) and in full on the News page. Management can post, edit, pin,
   aim a post at particular stations, and delete. */

(function () {
  "use strict";

  let notice = null;
  let editing = null;   // post id being edited, or "new"

  window.IAANews = { render: render, homePanel: homePanel };

  // How long a post stays on Home: until its "Show on Home until" date
  // (default 7 days, so staff on a 5-day break still see it). Posts stay on
  // the News page. Home shows at most HOME_MAX posts, pinned first.
  const HOME_DAYS = 7, HOME_MAX = 5;
  function localDay(d) { const x = d ? new Date(d) : new Date(); const pad = (n) => String(n).padStart(2, "0"); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; }
  function plusDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); }
  function homeUntil(p) {
    if (p.home_until) return String(p.home_until).slice(0, 10);
    const d = new Date(p.created_at); d.setDate(d.getDate() + HOME_DAYS); return localDay(d);
  }
  function onHome(p) { return homeUntil(p) >= localDay(); }

  // ------------------------------------------------------------------
  // Photos (database update 40): up to 4 per post, resized in the browser
  // before upload. The News page loads photos for the latest posts and
  // offers "Show photos" on older ones. Home shows the first photo.
  // ------------------------------------------------------------------
  const PHOTO_MAX = 4, PHOTO_EDGE = 1400, PHOTOS_EAGER = 20;
  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      const fail = () => reject(new Error(`${file.name} couldn’t be read as a photo`));
      const reader = new FileReader();
      reader.onerror = fail;
      reader.onload = function () {
        const img = new Image();
        img.onerror = fail;
        img.onload = function () {
          const scale = Math.min(1, PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * scale), hgt = Math.round(img.naturalHeight * scale);
          const c = document.createElement("canvas"); c.width = w; c.height = hgt;
          c.getContext("2d").drawImage(img, 0, 0, w, hgt);
          const url = c.toDataURL("image/jpeg", 0.82);
          resolve({ mime: "image/jpeg", data: url.split(",")[1], width: w, height: hgt, preview: url });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  async function loadPhotos(ctx, ids, firstOnly) {
    if (!ids.length) return {};
    let q = ctx.db.from("news_photos").select("id, post_id, sort, mime, data, width, height").in("post_id", ids);
    if (firstOnly) q = q.eq("sort", 0);
    const res = await q.order("sort", { ascending: true }).order("id", { ascending: true });
    if (res.error) return {};
    const by = {};
    (res.data || []).forEach((x) => { (by[x.post_id] = by[x.post_id] || []).push(x); });
    return by;
  }
  async function countPhotos(ctx, ids) {
    if (!ids.length) return {};
    const res = await ctx.db.from("news_photos").select("post_id").in("post_id", ids);
    const n = {}; if (!res.error) (res.data || []).forEach((x) => { n[x.post_id] = (n[x.post_id] || 0) + 1; });
    return n;
  }
  function openPhoto(h, src) {
    const close = h("button", { class: "btn btn-quiet btn-small photo-view-close", type: "button" }, "Close");
    const dlg = h("dialog", { class: "photo-view", "aria-label": "Photo" }, h("img", { src: src, alt: "" }), close);
    close.addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.appendChild(dlg); dlg.showModal();
  }
  function photosNode(h, list, compact) {
    if (!list || !list.length) return null;
    return h("div", { class: "news-photos" + (compact ? " is-compact" : "") + (list.length === 1 ? " is-single" : "") },
      list.map((x) => { const src = `data:${x.mime};base64,${x.data}`;
        return h("button", { type: "button", class: "news-photo", "aria-label": "Open photo full size", onclick: () => openPhoto(h, src) },
          h("img", { src: src, alt: "", loading: "lazy" })); }));
  }

  function fmt(v) {
    return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function go(hash) {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  }

  // Posts aimed at stations only show to people at those stations (management sees all).
  function visibleTo(post, profile) {
    if (profile.role === "management") return true;
    const codes = post.station_codes || [];
    if (!codes.length) return true;
    return (profile.station_codes || []).some((c) => codes.indexOf(c) !== -1);
  }

  // Post text with line breaks kept and web links clickable. Built from
  // text nodes, so nothing in a post can run as code.
  function bodyNode(h, text) {
    const wrap = h("div", { class: "news-body" });
    const parts = String(text || "").split(/(https?:\/\/[^\s<>"]+)/g);
    parts.forEach(function (part, i) {
      if (i % 2 === 1) {
        const clean = part.replace(/[).,;:!?]+$/, "");
        const tail = part.slice(clean.length);
        wrap.appendChild(h("a", { href: clean, target: "_blank", rel: "noopener" }, clean));
        if (tail) wrap.appendChild(document.createTextNode(tail));
      } else if (part) {
        wrap.appendChild(document.createTextNode(part));
      }
    });
    return wrap;
  }

  let ctx_role = null;
  function fmtDay(d) { return new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

  function meta(h, p) {
    const bits = [p.author_name || "Management", fmt(p.created_at)];
    if (p.updated_at) bits.push("edited " + fmt(p.updated_at));
    const isMgmt = ctx_role === "management";
    return h("p", { class: "news-meta" },
      p.pinned ? h("span", { class: "chip chip-status-new" }, "Pinned") : null,
      (p.station_codes || []).length ? h("span", { class: "chip chip-none" }, p.station_codes.join(", ")) : null,
      h("span", null, bits.join(" · ")),
      isMgmt ? h("span", { class: "chip " + (onHome(p) ? "chip-pass" : "chip-none") }, onHome(p) ? "On Home until " + fmtDay(homeUntil(p)) : "Off Home") : null);
  }

  async function load(ctx, limit) {
    let q = ctx.db.from("news_posts").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false });
    if (limit) q = q.limit(limit);
    const res = await q;
    if (res.error) throw res.error;
    return (res.data || []).filter((p) => visibleTo(p, ctx.state.profile));
  }

  // ------------------------------------------------------------------
  // Home panel: pinned and latest posts
  // ------------------------------------------------------------------
  async function homePanel(ctx) {
    const { h } = ctx;
    let posts;
    try { posts = await load(ctx, 40); } catch (e) { return null; }
    ctx_role = ctx.state.profile.role;
    const isManagement = ctx.state.profile.role === "management";
    const current = posts.filter(onHome);
    if (!current.length && !isManagement) return null;
    const shown = current.slice(0, HOME_MAX);
    const firstPhotos = await loadPhotos(ctx, shown.map((p) => p.id), true);
    return h(
      "section",
      { class: "panel news-home", "aria-labelledby": "news-h" },
      h("div", { class: "briefing-latest-head" },
        h("div", null, h("p", { class: "briefing-kicker" }, "News"), h("h2", { id: "news-h" }, "Latest from management")),
        isManagement ? h("a", { class: "btn btn-small", href: "#/news/new" }, "Post news") : null),
      shown.length
        ? h("div", { class: "news-list" }, shown.map((p) => h("article", { class: "news-item" },
            h("h3", null, p.title), meta(h, p), bodyNode(h, p.body), photosNode(h, firstPhotos[p.id], true))))
        : h("p", { class: "empty" }, posts.length ? "No current news. Older posts are on the News page." : "No news yet. Post the first update for the team."),
      posts.length ? h("div", { class: "row" }, h("a", { class: "btn btn-quiet", href: "#/news" }, posts.length > shown.length ? `All news (${posts.length})` : "All news")) : null
    );
  }

  // ------------------------------------------------------------------
  // News page
  // ------------------------------------------------------------------
  async function render(main, ctx) {
    const { h, fill, pageHead, state } = ctx;
    const isManagement = state.profile.role === "management";
    ctx_role = state.profile.role;
    if (/^#\/news\/new/.test(location.hash) && isManagement) editing = "new";
    fill(main, pageHead("News"), h("p", { class: "empty" }, "Loading news…"));
    const posts = await load(ctx);
    const eagerIds = posts.slice(0, PHOTOS_EAGER).map((p) => p.id);
    const [photos, counts] = await Promise.all([loadPhotos(ctx, eagerIds, false), countPhotos(ctx, posts.slice(PHOTOS_EAGER).map((p) => p.id))]);

    const items = posts.map(function (p) {
      if (editing === p.id) return editor(ctx, main, p);
      let photoBox = photosNode(h, photos[p.id], false);
      if (!photoBox && counts[p.id]) {
        photoBox = h("div", null);
        const more = h("button", { class: "btn btn-quiet btn-small", type: "button" }, `Show photos (${counts[p.id]})`);
        more.addEventListener("click", async function () { more.disabled = true; const got = await loadPhotos(ctx, [p.id], false); photoBox.replaceChildren(photosNode(h, got[p.id], false) || h("span")); });
        photoBox.append(more);
      }
      return h("article", { class: "panel news-item" },
        h("h2", null, p.title),
        meta(h, p),
        bodyNode(h, p.body),
        photoBox,
        isManagement
          ? h("div", { class: "row" },
              h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { editing = p.id; render(main, ctx); } }, "Edit"),
              h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: async function () {
                const { error } = await ctx.db.from("news_posts").update({ pinned: !p.pinned }).eq("id", p.id);
                if (error) { notice = { text: error.message, isError: true }; } else { notice = { text: p.pinned ? "Unpinned." : "Pinned to the top." }; }
                render(main, ctx);
              } }, p.pinned ? "Unpin" : "Pin to top"),
              h("button", { class: "btn btn-danger btn-small", type: "button", onclick: async function () {
                if (!confirm(`Delete “${p.title}”? This cannot be undone.`)) return;
                const { error } = await ctx.db.from("news_posts").delete().eq("id", p.id);
                if (error) { notice = { text: error.message, isError: true }; render(main, ctx); return; }
                await ctx.logEvent("news_deleted", { id: p.id, title: p.title });
                notice = { text: "Post deleted." };
                render(main, ctx);
              } }, "Delete"))
          : null);
    });

    const n = notice; notice = null;
    fill(
      main,
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "News"), h("p", null, "Updates from management. Pinned posts stay at the top.")),
        isManagement && editing !== "new" ? h("button", { class: "btn", type: "button", onclick: function () { editing = "new"; render(main, ctx); } }, "Post news") : null),
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      editing === "new" ? editor(ctx, main, null) : null,
      items.length ? items : h("section", { class: "panel" }, h("p", { class: "empty" }, "No news yet."))
    );
  }

  function editor(ctx, main, post) {
    const { h, state, setStatus } = ctx;
    const title = h("input", { id: "n-title", type: "text", required: true, maxlength: "140", value: post ? post.title : "" });
    const body = h("textarea", { id: "n-body", rows: "6", placeholder: "Write the update. Links are made clickable." });
    body.value = post ? post.body : "";
    const pinned = h("input", { type: "checkbox", id: "n-pinned", checked: post ? post.pinned : false });
    const until = h("input", { id: "n-until", type: "date", min: localDay(), value: post ? homeUntil(post) : plusDays(HOME_DAYS) });
    const quick = [3, 7, 14, 30].map((n) => h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { until.value = plusDays(n); } }, n + " days"));
    const chosen = new Set(post ? post.station_codes || [] : []);
    const boxes = (state.stations || []).filter((s) => s.active).map(function (s) {
      const b = h("input", { type: "checkbox", checked: chosen.has(s.code), onchange: function (e) { if (e.target.checked) chosen.add(s.code); else chosen.delete(s.code); } });
      return h("label", { class: "choice choice-inline" }, b, h("span", null, s.code));
    });
    const status = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "submit" }, post ? "Save changes" : "Post");
    // photos: kept (already saved), added (new, not yet uploaded), removed (ids to delete)
    let kept = [], added = [], removed = [];
    const fileIn = h("input", { id: "n-photos", type: "file", accept: "image/*", multiple: true, class: "file-input" });
    const photoBox = h("div", { class: "news-photo-edit" });
    const photoStatus = h("p", { class: "status", role: "status" });
    function drawPhotos() {
      const all = kept.map((x) => ({ x, kind: "kept" })).concat(added.map((x) => ({ x, kind: "added" })));
      photoBox.replaceChildren(...all.map(({ x, kind }) => h("div", { class: "news-photo-thumb" },
        h("img", { src: x.preview, alt: "" }),
        h("button", { type: "button", class: "news-photo-remove", "aria-label": "Remove this photo", onclick: function () {
          if (kind === "kept") { removed.push(x.id); kept = kept.filter((k) => k !== x); } else added = added.filter((a) => a !== x);
          drawPhotos(); } }, "×"))),
        all.length < PHOTO_MAX ? h("label", { for: "n-photos", class: "btn btn-quiet btn-small file-label news-photo-add" }, all.length ? "Add more" : "Add photos") : null);
    }
    fileIn.addEventListener("change", async function () {
      const files = Array.from(fileIn.files || []); fileIn.value = "";
      const room = PHOTO_MAX - kept.length - added.length;
      if (files.length > room) setStatus(photoStatus, `Up to ${PHOTO_MAX} photos per post – only the first ${Math.max(0, room)} were added.`, true);
      else setStatus(photoStatus, files.length ? "Preparing photos…" : "");
      for (const f of files.slice(0, Math.max(0, room))) {
        try { added.push(await resizePhoto(f)); } catch (err) { setStatus(photoStatus, err.message, true); }
      }
      if (files.length <= room) setStatus(photoStatus, "");
      drawPhotos();
    });
    drawPhotos();
    if (post) ctx.db.from("news_photos").select("id, sort, mime, data").eq("post_id", post.id).order("sort", { ascending: true }).then(function (r) {
      if (r.error) return;
      kept = (r.data || []).map((x) => ({ id: x.id, preview: `data:${x.mime};base64,${x.data}` }));
      drawPhotos();
    });
    async function savePhotos(postId) {
      const problems = [];
      if (removed.length) { const d = await ctx.db.from("news_photos").delete().in("id", removed); if (d.error) problems.push(d.error.message); }
      for (let i = 0; i < kept.length; i++) { await ctx.db.from("news_photos").update({ sort: i }).eq("id", kept[i].id); }
      for (let j = 0; j < added.length; j++) {
        const a = added[j];
        const up = await ctx.db.from("news_photos").insert({ post_id: postId, sort: kept.length + j, mime: a.mime, data: a.data, width: a.width, height: a.height });
        if (up.error) problems.push(up.error.message);
      }
      return problems;
    }
    const cancel = h("button", { class: "btn btn-quiet", type: "button", onclick: function () { editing = null; if (/^#\/news\/new/.test(location.hash)) go("#/news"); else render(main, ctx); } }, "Cancel");

    return h("form", {
      class: "panel news-editor",
      onsubmit: async function (e) {
        e.preventDefault();
        if (!title.value.trim()) { setStatus(status, "Give the post a title.", true); title.focus(); return; }
        if (!until.value) { setStatus(status, "Choose how long the post shows on Home.", true); until.focus(); return; }
        save.disabled = true;
        const row = { title: title.value.trim(), body: body.value.trim(), pinned: pinned.checked, station_codes: Array.from(chosen), home_until: until.value };
        const res = post
          ? await ctx.db.from("news_posts").update(row).eq("id", post.id)
          : await ctx.db.from("news_posts").insert(row).select("id").single();
        if (res.error) { save.disabled = false; setStatus(status, res.error.message, true); return; }
        const postId = post ? post.id : res.data && res.data.id;
        let photoProblems = [];
        if (postId && (added.length || removed.length || kept.length)) { setStatus(status, "Saving photos…"); photoProblems = await savePhotos(postId); }
        save.disabled = false;
        await ctx.logEvent(post ? "news_edited" : "news_posted", { title: row.title });
        notice = { text: (post ? "Post updated." : `Posted. It shows on everyone’s Home page until ${fmtDay(row.home_until)}.`) +
          (photoProblems.length ? ` Some photos couldn’t be saved: ${photoProblems[0]}` : ""), isError: photoProblems.length > 0 };
        editing = null;
        if (/^#\/news\/new/.test(location.hash)) go("#/news"); else render(main, ctx);
      }
    },
      h("h2", null, post ? "Edit post" : "Post news"),
      h("div", { class: "field field-wide" }, h("label", { for: "n-title" }, "Title"), title),
      h("div", { class: "field field-wide" }, h("label", { for: "n-body" }, "Text"), body),
      h("div", { class: "field field-wide" }, h("span", { class: "label" }, "Photos"),
        h("span", { class: "help" }, `Up to ${PHOTO_MAX}. They are made smaller automatically before upload. The first photo is the one shown on Home.`),
        fileIn, photoBox, photoStatus),
      h("div", { class: "field" }, h("span", { class: "label" }, "Show to"),
        h("span", { class: "help" }, "Leave all unticked to show to everyone, or tick stations to show it only to staff at those stations."),
        h("div", { class: "row row-tight" }, boxes)),
      h("div", { class: "field" }, h("label", { for: "n-until" }, "Show on Home until"),
        h("span", { class: "help" }, "After this date the post is still on the News page, but not on Home. 7 days means staff coming back from a 5-day break still see it."),
        h("div", { class: "row row-tight" }, until, quick)),
      h("label", { class: "choice" }, pinned, h("span", null, "Pin to the top while it is on Home")),
      h("div", { class: "row" }, save, cancel),
      status);
  }
})();
