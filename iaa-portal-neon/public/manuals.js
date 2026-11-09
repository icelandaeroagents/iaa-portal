/* Iceland Aero Agents – Staff Portal
   Manuals (#/manuals): the company's controlled documents (Safety Management
   System Manual, Health and Safety Policy, QA Programme, Security Programme,
   Data Protection Policy). Management uploads the Word file; it is shown as a
   readable page with a download of the original, and is visible either to
   management only or to all staff. */

(function () {
  "use strict";

  let notice = null;
  window.IAAManuals = { render: render };

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
  const AUDIENCE = { management: "Management only", all: "All staff" };

  // Keep only ordinary document formatting from the converted Word file.
  const ALLOWED = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "S", "SUP", "SUB", "A", "UL", "OL", "LI",
    "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "IMG", "BLOCKQUOTE", "SPAN"]);
  function safeFragment(html) {
    const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    const root = doc.body.firstChild;
    (function walk(node) {
      Array.from(node.childNodes).forEach(function (child) {
        if (child.nodeType === 1) {
          if (!ALLOWED.has(child.tagName)) {
            if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].indexOf(child.tagName) !== -1) { child.remove(); return; }
            walk(child);
            child.replaceWith.apply(child, Array.from(child.childNodes));
            return;
          }
          Array.from(child.attributes).forEach(function (a) {
            const n = a.name.toLowerCase();
            const keep =
              (n === "href" && child.tagName === "A" && /^(https?:|mailto:|tel:)/i.test(a.value)) ||
              (n === "src" && child.tagName === "IMG" && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(a.value)) ||
              (n === "alt" && child.tagName === "IMG") ||
              ((n === "colspan" || n === "rowspan") && /^\d+$/.test(a.value));
            if (!keep) child.removeAttribute(a.name);
          });
          if (child.tagName === "A") { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener"); }
          walk(child);
        } else if (child.nodeType !== 3) {
          child.remove();
        }
      });
    })(root);
    const frag = document.createDocumentFragment();
    while (root.firstChild) frag.appendChild(root.firstChild);
    Array.from(frag.querySelectorAll("table")).forEach(function (t) {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      t.replaceWith(wrap);
      wrap.appendChild(t);
    });
    return frag;
  }

  async function render(main, ctx) {
    const isManagement = ctx.state.profile.role === "management";
    const part = (location.hash.match(/^#\/manuals\/([^/?]+)/) || [])[1];
    if (part === "upload" && isManagement) return showUpload(main, ctx, null);
    if (part && /^\d+$/.test(part)) return showManual(main, ctx, parseInt(part, 10));
    return showList(main, ctx);
  }

  async function showList(main, ctx) {
    const { h, fill, pageHead, state } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, pageHead("Manuals"), h("p", { class: "empty" }, "Loading…"));
    const res = await ctx.db.from("manuals").select("id, title, reference, revision, audience, updated_at, sort_order").order("sort_order").order("title");
    if (res.error) throw res.error;
    const list = res.data || [];
    fill(main,
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Manuals"),
          h("p", null, isManagement
            ? "The company’s controlled documents. Choose for each one whether all staff can see it, or management only."
            : "Company manuals shared with staff. The policies you need to confirm are under Policies.")),
        isManagement ? h("a", { class: "btn", href: "#/manuals/upload" }, "Upload manual") : null),
      takeNotice(h),
      h("section", { class: "panel" },
        list.length
          ? h("ul", { class: "module-list" }, list.map((m) => h("li", null, h("a", { href: "#/manuals/" + m.id },
              h("span", { class: "module-code" }, m.reference || "–"),
              h("span", { class: "module-text" }, h("span", { class: "section-title" }, m.title),
                h("span", { class: "section-desc" }, (m.revision ? "Revision " + m.revision + " · " : "") + "updated " + fmt(m.updated_at))),
              isManagement ? h("span", { class: "chip " + (m.audience === "all" ? "chip-pass" : "chip-none") }, AUDIENCE[m.audience]) : null))))
          : h("p", { class: "empty" }, isManagement ? "No manuals yet. Use Upload manual to add the Word files." : "No manuals have been shared with staff yet.")));
  }

  async function showManual(main, ctx, id) {
    const { h, fill, state, setStatus } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, h("p", { class: "empty" }, "Loading…"));
    const res = await ctx.db.from("manuals").select("id, title, reference, revision, audience, html, file_name, updated_at, updated_by_name").eq("id", id);
    const m = (res.data || [])[0];
    if (!m) { notice = { text: "That manual isn’t available.", isError: true }; return go("#/manuals"); }

    const status = h("p", { class: "status", role: "status" });
    const download = h("button", { class: "btn btn-quiet", type: "button", onclick: async function () {
      download.disabled = true;
      const r = await ctx.db.from("manuals").select("docx, file_name").eq("id", m.id);
      download.disabled = false;
      const row = (r.data || [])[0];
      if (!row || !row.docx) { setStatus(status, "The Word file isn’t available.", true); return; }
      const bytes = Uint8Array.from(atob(row.docx), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      const a = document.createElement("a");
      a.href = url; a.download = row.file_name || (m.title + ".docx");
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } }, "Download Word file");

    let manage = null;
    if (isManagement) {
      const audience = h("select", { id: "mn-aud" },
        h("option", { value: "management", selected: m.audience === "management" }, AUDIENCE.management),
        h("option", { value: "all", selected: m.audience === "all" }, AUDIENCE.all));
      const mStatus = h("p", { class: "status", role: "status" });
      manage = h("section", { class: "panel panel-management" },
        h("h2", null, "Manage"),
        h("p", { class: "fineprint" }, "Only management can see this section."),
        h("div", { class: "row" },
          h("div", { class: "field" }, h("label", { for: "mn-aud" }, "Who can see it"), audience),
          h("button", { class: "btn btn-small", type: "button", onclick: async function () {
            const { error } = await ctx.db.from("manuals").update({ audience: audience.value }).eq("id", m.id);
            if (error) { setStatus(mStatus, error.message, true); return; }
            await ctx.logEvent("manual_audience_changed", { id: m.id, title: m.title, audience: audience.value });
            notice = { text: `Now visible to: ${AUDIENCE[audience.value].toLowerCase()}.` };
            showManual(main, ctx, id);
          } }, "Save")),
        h("div", { class: "row" },
          h("a", { class: "btn btn-quiet", href: "#/manuals/upload?replace=" + m.id }, "Upload a new version"),
          h("button", { class: "btn btn-danger", type: "button", onclick: async function () {
            if (!confirm(`Remove “${m.title}” from the portal?`)) return;
            const { error } = await ctx.db.from("manuals").delete().eq("id", m.id);
            if (error) { setStatus(mStatus, error.message, true); return; }
            await ctx.logEvent("manual_removed", { id: m.id, title: m.title });
            notice = { text: "Manual removed." };
            go("#/manuals");
          } }, "Remove")),
        mStatus);
    }

    const body = h("div", { class: "briefing-body manual-body" });
    body.appendChild(safeFragment(m.html));
    fill(main,
      h("a", { class: "back-link", href: "#/manuals" }, "All manuals"),
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("p", { class: "briefing-kicker" }, [m.reference, m.revision ? "Revision " + m.revision : null].filter(Boolean).join(" · ")),
          h("h1", null, m.title),
          h("p", null, "Updated " + fmt(m.updated_at) + (m.updated_by_name ? " by " + m.updated_by_name : ""))),
        isManagement ? h("span", { class: "chip " + (m.audience === "all" ? "chip-pass" : "chip-none") }, AUDIENCE[m.audience]) : null),
      takeNotice(h),
      h("div", { class: "row" }, download), status,
      h("article", { class: "panel briefing-article" }, body),
      manage);
  }

  // ------------------------------------------------------------------
  // Upload (management): a new manual, or a new version of one
  // ------------------------------------------------------------------
  async function showUpload(main, ctx) {
    const { h, fill, pageHead, setStatus } = ctx;
    const replaceId = parseInt((location.hash.match(/replace=(\d+)/) || [])[1] || "0", 10) || null;
    let existing = null;
    if (replaceId) {
      const r = await ctx.db.from("manuals").select("id, title, reference, revision, audience").eq("id", replaceId);
      existing = (r.data || [])[0] || null;
    }
    const input = h("input", { id: "mn-file", type: "file", accept: ".docx", class: "file-input" });
    const title = h("input", { id: "mn-title", type: "text", value: existing ? existing.title : "" });
    const ref = h("input", { id: "mn-ref", type: "text", value: existing ? existing.reference || "" : "", placeholder: "e.g. GH-SMS-001" });
    const rev = h("input", { id: "mn-rev", type: "text", value: existing ? existing.revision || "" : "", placeholder: "e.g. 2.0" });
    const audience = h("select", { id: "mn-aud" },
      h("option", { value: "management", selected: !existing || existing.audience === "management" }, AUDIENCE.management),
      h("option", { value: "all", selected: existing && existing.audience === "all" }, AUDIENCE.all));
    const status = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "button", disabled: true }, existing ? "Publish new version" : "Add manual");
    let prepared = null;

    input.addEventListener("change", async function () {
      const file = (input.files || [])[0];
      if (!file) return;
      if (!/\.docx$/i.test(file.name)) { setStatus(status, "Choose a Word (.docx) file.", true); return; }
      try {
        setStatus(status, "Reading " + file.name + "…");
        const buf = await file.arrayBuffer();
        const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        const html = result.value.replace(/<p>(\s|&nbsp;)*<\/p>/g, "");
        const text = html.replace(/<[^>]+>/g, " ");
        if (!existing) {
          const m1 = text.match(/\bGH-[A-Z]{2,4}-\d{3}\b/);
          if (m1 && !ref.value) ref.value = m1[0];
          const m2 = text.match(/Revision\s+(\d+(?:\.\d+)?)/);
          if (m2 && !rev.value) rev.value = m2[1];
          if (!title.value) title.value = file.name.replace(/\.docx$/i, "").replace(/^\d+[_\s-]*/, "").replace(/_/g, " ");
          if (/^GH-(SMS|HS)-/.test(ref.value)) audience.value = "all";
        } else {
          const m2 = text.match(/Revision\s+(\d+(?:\.\d+)?)/);
          if (m2) rev.value = m2[1];
        }
        const data = await new Promise(function (resolve, reject) {
          const fr = new FileReader();
          fr.onerror = () => reject(new Error("The file couldn’t be read"));
          fr.onload = () => resolve(String(fr.result).split(",")[1]);
          fr.readAsDataURL(file);
        });
        prepared = { html: html, docx: data, file_name: file.name };
        save.disabled = false;
        setStatus(status, "Ready. Check the details, then " + (existing ? "publish." : "add it."));
      } catch (err) {
        setStatus(status, "This file couldn’t be read: " + err.message, true);
      }
    });

    save.addEventListener("click", async function () {
      if (!prepared) return;
      if (!title.value.trim()) { setStatus(status, "Give it a title.", true); return; }
      save.disabled = true;
      const row = Object.assign({ title: title.value.trim(), reference: ref.value.trim() || null, revision: rev.value.trim() || null, audience: audience.value }, prepared);
      const res = existing
        ? await ctx.db.from("manuals").update(row).eq("id", existing.id)
        : await ctx.db.from("manuals").insert(row);
      save.disabled = false;
      if (res.error) { setStatus(status, res.error.message, true); return; }
      await ctx.logEvent(existing ? "manual_replaced" : "manual_added", { title: row.title, reference: row.reference, audience: row.audience });
      notice = { text: existing ? "New version published." : `${row.title} added – visible to ${AUDIENCE[row.audience].toLowerCase()}.` };
      go(existing ? "#/manuals/" + existing.id : "#/manuals");
    });

    fill(main,
      h("a", { class: "back-link", href: existing ? "#/manuals/" + existing.id : "#/manuals" }, "Back"),
      pageHead(existing ? "New version: " + existing.title : "Upload manual", "Choose the Word file. The reference and revision are read from the document."),
      h("section", { class: "panel" },
        h("label", { for: "mn-file", class: "btn btn-quiet file-label" }, "Choose Word file"), input,
        h("div", { class: "form-grid" },
          h("div", { class: "field" }, h("label", { for: "mn-title" }, "Title"), title),
          h("div", { class: "field" }, h("label", { for: "mn-ref" }, "Reference"), ref),
          h("div", { class: "field" }, h("label", { for: "mn-rev" }, "Revision"), rev),
          h("div", { class: "field" }, h("label", { for: "mn-aud" }, "Who can see it"), audience)),
        h("p", { class: "fineprint" }, "Keep restricted documents, such as the Security Programme, to management only."),
        h("div", { class: "row" }, save),
        status));
  }
})();
