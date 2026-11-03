/* Iceland Aero Agents – Staff Portal
   News: short posts from management, shown on Home (newest and pinned
   first) and in full on the News page. Management can post, edit, pin,
   aim a post at particular stations, and delete. */

(function () {
  "use strict";

  let notice = null;
  let editing = null;   // post id being edited, or "new"

  window.IAANews = { render: render, homePanel: homePanel };

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

  function meta(h, p) {
    const bits = [p.author_name || "Management", fmt(p.created_at)];
    if (p.updated_at) bits.push("edited " + fmt(p.updated_at));
    return h("p", { class: "news-meta" },
      p.pinned ? h("span", { class: "chip chip-status-new" }, "Pinned") : null,
      (p.station_codes || []).length ? h("span", { class: "chip chip-none" }, p.station_codes.join(", ")) : null,
      h("span", null, bits.join(" · ")));
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
    try { posts = await load(ctx, 12); } catch (e) { return null; }
    const isManagement = ctx.state.profile.role === "management";
    if (!posts.length && !isManagement) return null;
    const shown = posts.slice(0, 3);
    return h(
      "section",
      { class: "panel news-home", "aria-labelledby": "news-h" },
      h("div", { class: "briefing-latest-head" },
        h("div", null, h("p", { class: "briefing-kicker" }, "News"), h("h2", { id: "news-h" }, "Latest from management")),
        isManagement ? h("a", { class: "btn btn-small", href: "#/news/new" }, "Post news") : null),
      shown.length
        ? h("div", { class: "news-list" }, shown.map((p) => h("article", { class: "news-item" },
            h("h3", null, p.title), meta(h, p), bodyNode(h, p.body))))
        : h("p", { class: "empty" }, "No news yet. Post the first update for the team."),
      posts.length > 3 || shown.length ? h("div", { class: "row" }, h("a", { class: "btn btn-quiet", href: "#/news" }, posts.length > 3 ? `All news (${posts.length})` : "All news")) : null
    );
  }

  // ------------------------------------------------------------------
  // News page
  // ------------------------------------------------------------------
  async function render(main, ctx) {
    const { h, fill, pageHead, state } = ctx;
    const isManagement = state.profile.role === "management";
    if (/^#\/news\/new/.test(location.hash) && isManagement) editing = "new";
    fill(main, pageHead("News"), h("p", { class: "empty" }, "Loading news…"));
    const posts = await load(ctx);

    const items = posts.map(function (p) {
      if (editing === p.id) return editor(ctx, main, p);
      return h("article", { class: "panel news-item" },
        h("h2", null, p.title),
        meta(h, p),
        bodyNode(h, p.body),
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
    const chosen = new Set(post ? post.station_codes || [] : []);
    const boxes = (state.stations || []).filter((s) => s.active).map(function (s) {
      const b = h("input", { type: "checkbox", checked: chosen.has(s.code), onchange: function (e) { if (e.target.checked) chosen.add(s.code); else chosen.delete(s.code); } });
      return h("label", { class: "choice choice-inline" }, b, h("span", null, s.code));
    });
    const status = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "submit" }, post ? "Save changes" : "Post");
    const cancel = h("button", { class: "btn btn-quiet", type: "button", onclick: function () { editing = null; if (/^#\/news\/new/.test(location.hash)) go("#/news"); else render(main, ctx); } }, "Cancel");

    return h("form", {
      class: "panel news-editor",
      onsubmit: async function (e) {
        e.preventDefault();
        if (!title.value.trim()) { setStatus(status, "Give the post a title.", true); title.focus(); return; }
        save.disabled = true;
        const row = { title: title.value.trim(), body: body.value.trim(), pinned: pinned.checked, station_codes: Array.from(chosen) };
        const res = post
          ? await ctx.db.from("news_posts").update(row).eq("id", post.id)
          : await ctx.db.from("news_posts").insert(row);
        save.disabled = false;
        if (res.error) { setStatus(status, res.error.message, true); return; }
        await ctx.logEvent(post ? "news_edited" : "news_posted", { title: row.title });
        notice = { text: post ? "Post updated." : "Posted. It now shows on everyone’s Home page." };
        editing = null;
        if (/^#\/news\/new/.test(location.hash)) go("#/news"); else render(main, ctx);
      }
    },
      h("h2", null, post ? "Edit post" : "Post news"),
      h("div", { class: "field field-wide" }, h("label", { for: "n-title" }, "Title"), title),
      h("div", { class: "field field-wide" }, h("label", { for: "n-body" }, "Text"), body),
      h("div", { class: "field" }, h("span", { class: "label" }, "Show to"),
        h("span", { class: "help" }, "Leave all unticked to show to everyone, or tick stations to show it only to staff at those stations."),
        h("div", { class: "row row-tight" }, boxes)),
      h("label", { class: "choice" }, pinned, h("span", null, "Pin to the top")),
      h("div", { class: "row" }, save, cancel),
      status);
  }
})();
