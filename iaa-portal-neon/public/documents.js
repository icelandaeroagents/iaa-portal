/* Iceland Aero Agents – Staff Portal
   Policies (#/policies) and Emergency cards (#/emergency).
   – Everyone reads. Policies ask staff to confirm "I've read and understood
     this"; management sees who has read the current version.
   – Management edits the text in the portal. Editing a policy can ask
     everyone to read it again (the version goes up).
   – Emergency cards are one per station and can be printed.

   Text format (kept simple so anyone can edit it):
     ## Heading         - bullet          1. numbered step
     | Label | Value |  (a two-column table, e.g. phone numbers)
     **bold**           links and phone numbers become clickable */

(function () {
  "use strict";

  let notice = null;
  let editing = false;
  let emergencyStation = null;

  window.IAADocuments = { renderPolicies: renderPolicies, renderEmergency: renderEmergency, homePanel: homePanel };

  function go(hash) {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  }
  function fmt(v) { return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  function takeNotice(h) {
    if (!notice) return null;
    const n = h("p", { class: notice.isError ? "notice is-error" : "notice" }, notice.text);
    notice = null;
    return n;
  }

  // ------------------------------------------------------------------
  // The text format → page elements (text nodes only, nothing runs as code)
  // ------------------------------------------------------------------
  function inline(h, text, opts) {
    const out = [];
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach(function (part) {
      if (/^\*\*[^*]+\*\*$/.test(part)) { out.push(h("b", null, part.slice(2, -2))); return; }
      part.split(/(https?:\/\/[^\s]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g).forEach(function (bit, i) {
        if (!bit) return;
        if (i % 2 === 1) {
          const clean = bit.replace(/[).,;:!?]+$/, "");
          const href = clean.indexOf("@") !== -1 && clean.indexOf("http") !== 0 ? "mailto:" + clean : clean;
          out.push(h("a", { href: href, target: href.indexOf("http") === 0 ? "_blank" : null, rel: "noopener" }, clean));
          if (bit.length > clean.length) out.push(bit.slice(clean.length));
        } else if (opts && opts.phones) {
          // "425 6200 / 444 2000" → each number a tap-to-call link
          bit.split(/(\+?\d[\d ]{5,}\d|\b112\b)/g).forEach(function (seg, j) {
            if (!seg) return;
            if (j % 2 === 1) out.push(h("a", { href: "tel:" + (seg === "112" || seg.charAt(0) === "+" ? "" : "+354") + seg.replace(/\s/g, "") }, seg));
            else out.push(seg);
          });
        } else {
          out.push(bit);
        }
      });
    });
    return out;
  }

  function renderBody(h, text) {
    const wrap = h("div", { class: "doc-body" });
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    let list = null, listType = null, table = null, para = [];
    function flushPara() { if (para.length) { wrap.appendChild(h("p", null, inline(h, para.join(" ")))); para = []; } }
    function flushList() { if (list) { wrap.appendChild(list); list = null; listType = null; } }
    function flushTable() { if (table) { wrap.appendChild(h("div", { class: "table-wrap" }, table)); table = null; } }
    function flushAll() { flushPara(); flushList(); flushTable(); }
    lines.forEach(function (raw) {
      const line = raw.trim();
      if (!line) { flushAll(); return; }
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushAll(); wrap.appendChild(h(m[1].length === 1 ? "h2" : "h3", null, inline(h, m[2]))); return; }
      if ((m = line.match(/^[-•]\s+(.*)$/))) {
        flushPara(); flushTable();
        if (listType !== "ul") { flushList(); list = h("ul"); listType = "ul"; }
        list.appendChild(h("li", null, inline(h, m[1]))); return;
      }
      if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
        flushPara(); flushTable();
        if (listType !== "ol") { flushList(); list = h("ol"); listType = "ol"; }
        list.appendChild(h("li", null, inline(h, m[1]))); return;
      }
      if (/^\|.*\|$/.test(line)) {
        flushPara(); flushList();
        const cells = line.slice(1, -1).split("|").map((c) => c.trim());
        if (cells.every((c) => /^-+$/.test(c))) return;
        if (!table) table = h("table", { class: "doc-table" }, h("tbody"));
        table.firstChild.appendChild(h("tr", null, cells.map((c, i) => h(i === 0 ? "th" : "td", i === 0 ? { scope: "row" } : null, inline(h, c, { phones: i > 0 })))));
        return;
      }
      flushList(); flushTable();
      para.push(line);
    });
    flushAll();
    return wrap;
  }

  async function loadDocs(ctx, kind) {
    const res = await ctx.db.from("documents").select("*").eq("kind", kind).order("sort_order").order("title");
    if (res.error) throw res.error;
    return res.data || [];
  }
  async function myReads(ctx) {
    const res = await ctx.db.from("document_reads").select("document_id, version, read_at").eq("profile_id", ctx.state.profile.id);
    return res.data || [];
  }
  function readOf(reads, doc) { return reads.find((r) => r.document_id === doc.id && r.version === doc.version) || null; }

  // ------------------------------------------------------------------
  // Home: tell people about policies they still need to read
  // ------------------------------------------------------------------
  async function homePanel(ctx) {
    const { h } = ctx;
    try {
      const [docs, reads] = await Promise.all([loadDocs(ctx, "policy"), myReads(ctx)]);
      const unread = docs.filter((d) => d.requires_ack && !readOf(reads, d));
      if (!unread.length) return null;
      return h("section", { class: "panel panel-attention", "aria-labelledby": "pol-h" },
        h("h2", { id: "pol-h" }, unread.length === 1 ? "1 policy to read" : `${unread.length} policies to read`),
        h("ul", { class: "attention-list" }, unread.map((d) => h("li", null, h("a", { href: "#/policies/" + d.slug }, d.title)))));
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Policies
  // ------------------------------------------------------------------
  async function renderPolicies(main, ctx) {
    const slug = decodeURIComponent((location.hash.match(/^#\/policies\/([^/?]+)/) || [])[1] || "");
    if (slug === "new" && ctx.state.profile.role === "management") return showEditor(main, ctx, null, "policy");
    if (slug) return showPolicy(main, ctx, slug);
    editing = false;
    const { h, fill, pageHead, state } = ctx;
    fill(main, pageHead("Policies"), h("p", { class: "empty" }, "Loading…"));
    const [docs, reads] = await Promise.all([loadDocs(ctx, "policy"), myReads(ctx)]);
    const isManagement = state.profile.role === "management";
    fill(main,
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Policies"), h("p", null, "Company policies and what they mean for you. Please read each one and confirm.")),
        isManagement ? h("a", { class: "btn", href: "#/policies/new" }, "Add policy") : null),
      takeNotice(h),
      h("section", { class: "panel" },
        docs.length
          ? h("ul", { class: "module-list" }, docs.map(function (d) {
              const r = readOf(reads, d);
              return h("li", null, h("a", { href: "#/policies/" + d.slug },
                h("span", { class: "module-text" }, h("span", { class: "section-title" }, d.title),
                  h("span", { class: "section-desc" }, `Version ${d.version} · updated ${fmt(d.updated_at)}`)),
                !d.requires_ack ? null : r
                  ? h("span", { class: "chip chip-pass" }, "Read")
                  : h("span", { class: "chip chip-status-new" }, "To read")));
            }))
          : h("p", { class: "empty" }, "No policies yet.")));
  }

  async function showPolicy(main, ctx, slug) {
    const { h, fill, state } = ctx;
    const isManagement = state.profile.role === "management";
    const res = await ctx.db.from("documents").select("*").eq("slug", slug);
    const d = ((res.data || [])[0]);
    if (!d) { notice = { text: "That policy isn’t available.", isError: true }; return go("#/policies"); }
    if (editing && isManagement) return showEditor(main, ctx, d, d.kind);
    const reads = await myReads(ctx);
    const r = readOf(reads, d);
    const status = h("p", { class: "status", role: "status" });
    const confirmBox = !d.requires_ack ? null : r
      ? h("p", { class: "read-confirmed" }, `You confirmed you read version ${d.version} on ${fmt(r.read_at)}.`)
      : h("div", { class: "row" }, h("button", {
          class: "btn", type: "button",
          onclick: async function (e) {
            e.currentTarget.disabled = true;
            const { error } = await ctx.db.from("document_reads").insert({ document_id: d.id, version: d.version, profile_id: state.profile.id });
            if (error && !/duplicate/i.test(error.message)) { e.currentTarget.disabled = false; ctx.setStatus(status, error.message, true); return; }
            notice = { text: "Thank you. Your confirmation is recorded." };
            showPolicy(main, ctx, slug);
          }
        }, "I’ve read and understood this"));

    fill(main,
      h("a", { class: "back-link", href: "#/policies" }, "All policies"),
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, d.title), h("p", null, `Version ${d.version} · updated ${fmt(d.updated_at)}${d.updated_by_name ? " by " + d.updated_by_name : ""}`)),
        isManagement ? h("button", { class: "btn btn-quiet", type: "button", onclick: function () { editing = true; showPolicy(main, ctx, slug); } }, "Edit") : null),
      takeNotice(h),
      h("article", { class: "panel" }, renderBody(h, d.body)),
      d.requires_ack ? h("section", { class: "panel" }, h("h2", null, "Confirm you’ve read it"), confirmBox, status) : null,
      isManagement && d.requires_ack ? await readersPanel(ctx, d) : null);
  }

  async function readersPanel(ctx, d) {
    const { h } = ctx;
    const [rRes, pRes] = await Promise.all([
      ctx.db.from("document_reads").select("profile_id, read_at").eq("document_id", d.id).eq("version", d.version),
      ctx.db.from("profiles").select("id, full_name, email, active").order("full_name", { nullsFirst: false })
    ]);
    const at = {};
    (rRes.data || []).forEach((r) => { at[r.profile_id] = r.read_at; });
    const people = (pRes.data || []).filter((p) => p.active);
    const done = people.filter((p) => at[p.id]);
    const notYet = people.filter((p) => !at[p.id]);
    const name = (p) => p.full_name || p.email;
    return h("section", { class: "panel panel-management" },
      h("h2", null, `Read by ${done.length} of ${people.length}`),
      h("p", { class: "fineprint" }, `Version ${d.version}. Only management can see this section.`),
      h("div", { class: "readers" },
        h("div", null, h("h3", null, "Not read yet"), notYet.length ? h("ul", { class: "plain-list" }, notYet.map((p) => h("li", null, name(p)))) : h("p", { class: "fineprint" }, "Everyone has read it.")),
        h("div", null, h("h3", null, "Read"), done.length ? h("ul", { class: "plain-list" }, done.map((p) => h("li", null, name(p), h("span", { class: "sub" }, fmt(at[p.id]))))) : h("p", { class: "fineprint" }, "Nobody yet."))));
  }

  // ------------------------------------------------------------------
  // Emergency cards
  // ------------------------------------------------------------------
  async function renderEmergency(main, ctx) {
    const { h, fill, pageHead, state } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, pageHead("Emergency"), h("p", { class: "empty" }, "Loading…"));
    const cards = await loadDocs(ctx, "emergency");
    if (!cards.length) { fill(main, pageHead("Emergency"), h("section", { class: "panel" }, h("p", { class: "empty" }, "No emergency cards yet."))); return; }
    if (!emergencyStation || !cards.some((c) => c.station_code === emergencyStation)) {
      const mine = (state.profile.station_codes || []).find((c) => cards.some((x) => x.station_code === c));
      emergencyStation = mine || cards[0].station_code;
    }
    const card = cards.find((c) => c.station_code === emergencyStation) || cards[0];
    if (editing && isManagement) return showEditor(main, ctx, card, "emergency");

    fill(main,
      h("div", { class: "page-head page-head-row no-print" },
        h("div", null, h("h1", null, "Emergency"), h("p", null, "In any emergency, call 112. These cards follow SOP Part 5, Section 23.")),
        h("div", { class: "row row-tight" },
          h("button", { class: "btn", type: "button", onclick: function () { window.print(); } }, "Print card"),
          isManagement ? h("button", { class: "btn btn-quiet", type: "button", onclick: function () { editing = true; renderEmergency(main, ctx); } }, "Edit") : null)),
      h("nav", { class: "tabs no-print", "aria-label": "Stations" }, cards.map((c) =>
        h("a", { href: "#/emergency", "aria-current": c.id === card.id ? "page" : null, onclick: function (e) { e.preventDefault(); emergencyStation = c.station_code; renderEmergency(main, ctx); } }, c.station_code))),
      takeNotice(h),
      h("article", { class: "panel emergency-card" },
        h("div", { class: "emergency-head" }, h("p", { class: "briefing-kicker" }, "ICELAND AERO AGENTS"), h("h2", null, card.title),
          h("p", { class: "emergency-112" }, "Emergency: ", h("a", { href: "tel:112" }, "112"))),
        renderBody(h, card.body),
        h("p", { class: "fineprint" }, `Updated ${fmt(card.updated_at)}${card.updated_by_name ? " by " + card.updated_by_name : ""}`)));
  }

  // ------------------------------------------------------------------
  // Editing (management)
  // ------------------------------------------------------------------
  function showEditor(main, ctx, d, kind) {
    const { h, fill, setStatus } = ctx;
    const title = h("input", { id: "d-title", type: "text", required: true, value: d ? d.title : "" });
    const body = h("textarea", { id: "d-body", rows: "22", class: "doc-editor-text" });
    body.value = d ? d.body : "## What this means for you\n- \n";
    const reask = h("input", { type: "checkbox", id: "d-reask" });
    const preview = h("div", { class: "panel doc-preview" });
    function drawPreview() { preview.replaceChildren(h("p", { class: "fineprint" }, "Preview"), renderBody(h, body.value)); }
    body.addEventListener("input", function () { clearTimeout(body._t); body._t = setTimeout(drawPreview, 200); });
    drawPreview();
    const status = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "submit" }, d ? "Save changes" : "Add policy");
    const back = kind === "emergency" ? "#/emergency" : d ? "#/policies/" + d.slug : "#/policies";
    const cancel = h("button", { class: "btn btn-quiet", type: "button", onclick: function () { editing = false; go(back); } }, "Cancel");
    const del = d && kind === "policy" ? h("button", { class: "btn btn-danger", type: "button", onclick: async function () {
      if (!confirm(`Delete “${d.title}”? Read confirmations for it are deleted too.`)) return;
      const { error } = await ctx.db.from("documents").delete().eq("id", d.id);
      if (error) { setStatus(status, error.message, true); return; }
      await ctx.logEvent("document_deleted", { slug: d.slug, title: d.title });
      editing = false; notice = { text: "Policy deleted." }; go("#/policies");
    } }, "Delete policy") : null;

    fill(main,
      h("a", { class: "back-link", href: back, onclick: function () { editing = false; } }, "Back"),
      h("div", { class: "page-head" }, h("h1", null, d ? "Edit: " + d.title : "Add policy")),
      h("form", {
        class: "doc-editor",
        onsubmit: async function (e) {
          e.preventDefault();
          if (!title.value.trim()) { setStatus(status, "Give it a title.", true); return; }
          save.disabled = true;
          let res;
          if (d) {
            const row = { title: title.value.trim(), body: body.value };
            if (kind === "policy" && reask.checked) row.version = d.version + 1;
            res = await ctx.db.from("documents").update(row).eq("id", d.id);
          } else {
            const slug = title.value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "policy";
            res = await ctx.db.from("documents").insert({ slug: slug + "-" + Date.now().toString(36).slice(-4), kind: "policy", title: title.value.trim(), body: body.value, sort_order: 200 });
          }
          save.disabled = false;
          if (res.error) { setStatus(status, res.error.message, true); return; }
          await ctx.logEvent(d ? "document_edited" : "document_added", { title: title.value.trim(), kind: kind, reask: !!(d && reask.checked) });
          editing = false;
          notice = { text: d ? (reask.checked && kind === "policy" ? "Saved. Everyone will be asked to read it again." : "Saved.") : "Policy added. Staff will see it under Policies and on Home." };
          go(kind === "emergency" ? "#/emergency" : "#/policies");
        }
      },
        h("section", { class: "panel" },
          h("div", { class: "field field-wide" }, h("label", { for: "d-title" }, "Title"), title),
          h("div", { class: "field field-wide" }, h("label", { for: "d-body" }, "Text"),
            h("span", { class: "help" }, "## for a heading · - for a bullet · 1. for a step · | Label | Number | for a table row · **bold**"),
            body),
          kind === "policy" && d ? h("label", { class: "choice" }, reask, h("span", null, "This is an important change: ask everyone to read it again")) : null,
          h("div", { class: "row" }, save, cancel, del),
          status),
        preview));
  }
})();
