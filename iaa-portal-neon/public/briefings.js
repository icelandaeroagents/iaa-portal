/* Iceland Aero Agents – Staff Portal
   Briefings section: the latest "IAA’s (Not so weekly) Briefing", the
   archive, a reading view with "Mark as read", and (management) upload
   of one or many Word files.
   The portal shell (app.js) calls IAABriefings.render(main, ctx), and
   IAABriefings.homePanel(ctx) for the Home page. */

(function () {
  "use strict";

  const C = window.IAABriefingConvert;
  const LIST_COLUMNS = "id, issue_no, issue_date, title, sections, published_at";
  let notice = null;
  let pending = []; // files prepared on the upload page

  window.IAABriefings = { render: render, homePanel: homePanel };

  async function render(main, ctx) {
    const parts = location.hash.replace(/^#\/briefings\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "upload" && ctx.state.profile.role === "management") return showUpload(main, ctx);
    if (parts[0] && /^\d+$/.test(parts[0])) return showIssue(main, ctx, parseInt(parts[0], 10));
    return showList(main, ctx);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function fmtDate(d) {
    if (!d) return "";
    try {
      return new Date(d + (String(d).length === 10 ? "T12:00:00Z" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return d; }
  }

  function go(hash) {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  }

  function noticeBox(ctx) {
    if (!notice) return null;
    const n = ctx.h("p", { class: notice.isError ? "notice is-error" : "notice" }, notice.text);
    notice = null;
    return n;
  }

  async function myReads(ctx) {
    const res = await ctx.db.from("briefing_reads").select("briefing_id, read_at").eq("profile_id", ctx.state.profile.id);
    const map = {};
    (res.data || []).forEach((r) => { map[r.briefing_id] = r.read_at; });
    return map;
  }

  // Keeps only ordinary document formatting from a briefing's HTML.
  const ALLOWED = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "S", "SUP", "SUB", "A", "UL", "OL", "LI",
    "H2", "H3", "H4", "H5", "H6", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "IMG", "BLOCKQUOTE", "SPAN"]);
  function safeFragment(html) {
    const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    const rootEl = doc.body.firstChild;
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
          if (child.tagName === "IMG") child.setAttribute("loading", "lazy");
          walk(child);
        } else if (child.nodeType !== 3) {
          child.remove();
        }
      });
    })(rootEl);
    const frag = document.createDocumentFragment();
    while (rootEl.firstChild) frag.appendChild(rootEl.firstChild);
    // Tables scroll on their own on small screens.
    Array.from(frag.querySelectorAll ? frag.querySelectorAll("table") : []).forEach(function (t) {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      t.replaceWith(wrap);
      wrap.appendChild(t);
    });
    return frag;
  }

  function readChip(ctx, readAt) {
    return readAt
      ? ctx.h("span", { class: "chip chip-pass" }, "Read")
      : ctx.h("span", { class: "chip chip-status-new" }, "Not read yet");
  }

  // ------------------------------------------------------------------
  // Home page panel
  // ------------------------------------------------------------------
  async function homePanel(ctx) {
    const { h } = ctx;
    const res = await ctx.db.from("briefings").select(LIST_COLUMNS).order("issue_no", { ascending: false }).limit(1);
    const b = (res.data || [])[0];
    if (!b) return null;
    const reads = await myReads(ctx);
    return h(
      "section",
      { class: "panel briefing-latest", "aria-labelledby": "latest-h" },
      h("div", { class: "briefing-latest-head" },
        h("div", null,
          h("p", { class: "briefing-kicker" }, "Latest briefing"),
          h("h2", { id: "latest-h" }, `#${b.issue_no} · ${fmtDate(b.issue_date)}`)),
        readChip(ctx, reads[b.id])),
      b.sections.length
        ? h("div", null, h("p", { class: "fineprint" }, "In this issue"), h("ul", { class: "briefing-topics" }, b.sections.map((s) => h("li", null, s))))
        : null,
      h("div", { class: "row" },
        h("a", { class: "btn", href: "#/briefings/" + b.issue_no }, reads[b.id] ? "Open briefing" : "Read briefing"),
        h("a", { class: "btn btn-quiet", href: "#/briefings" }, "All briefings"))
    );
  }

  // ------------------------------------------------------------------
  // Archive
  // ------------------------------------------------------------------
  async function showList(main, ctx) {
    const { h, fill, pageHead, state } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, pageHead("Briefings"), h("p", { class: "empty" }, "Loading briefings…"));

    const [res, reads] = await Promise.all([
      ctx.db.from("briefings").select(LIST_COLUMNS).order("issue_no", { ascending: false }),
      myReads(ctx)
    ]);
    if (res.error) throw res.error;
    const all = res.data || [];

    const rows = all.map((b) =>
      h("li", null,
        h("a", { href: "#/briefings/" + b.issue_no },
          h("span", { class: "briefing-no" }, "#" + b.issue_no),
          h("span", { class: "module-text" },
            h("span", { class: "section-title" }, fmtDate(b.issue_date)),
            h("span", { class: "section-desc" }, b.sections.slice(0, 4).join(" · ") + (b.sections.length > 4 ? ` · and ${b.sections.length - 4} more` : ""))),
          readChip(ctx, reads[b.id])))
    );

    fill(
      main,
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Briefings"), h("p", null, "IAA’s (Not so weekly) Briefing. The newest issue is at the top.")),
        isManagement ? h("a", { class: "btn", href: "#/briefings/upload" }, "Upload briefings") : null),
      noticeBox(ctx),
      h("section", { class: "panel" },
        all.length
          ? h("ul", { class: "module-list briefing-list" }, rows)
          : h("p", { class: "empty" }, isManagement ? "No briefings yet. Use Upload briefings to add them." : "No briefings have been published yet."))
    );
  }

  // ------------------------------------------------------------------
  // One issue
  // ------------------------------------------------------------------
  async function showIssue(main, ctx, issueNo) {
    const { h, fill, state, setStatus } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, h("p", { class: "empty" }, "Loading briefing…"));

    const [res, neighbours] = await Promise.all([
      ctx.db.from("briefings").select("id, issue_no, issue_date, title, sections, html, docx_name, published_at, updated_at").eq("issue_no", issueNo),
      ctx.db.from("briefings").select("issue_no").order("issue_no")
    ]);
    if (res.error) throw res.error;
    const b = (res.data || [])[0];
    if (!b) {
      notice = { text: `There’s no briefing #${issueNo}.`, isError: true };
      return go("#/briefings");
    }
    const numbers = (neighbours.data || []).map((x) => x.issue_no).sort((x, y) => x - y);
    const idx = numbers.indexOf(b.issue_no);
    const prev = idx > 0 ? numbers[idx - 1] : null;
    const next = idx >= 0 && idx < numbers.length - 1 ? numbers[idx + 1] : null;

    const mineRes = await ctx.db.from("briefing_reads").select("read_at").eq("briefing_id", b.id).eq("profile_id", state.profile.id);
    const myRead = ((mineRes.data || [])[0] || {}).read_at;

    const dlStatus = h("p", { class: "status", role: "status" });
    const download = h("button", {
      class: "btn btn-quiet",
      type: "button",
      onclick: async function () {
        download.disabled = true;
        const r = await ctx.db.from("briefings").select("docx, docx_name").eq("id", b.id);
        download.disabled = false;
        const row = (r.data || [])[0];
        if (r.error || !row || !row.docx) { setStatus(dlStatus, "The Word file isn’t available for this issue.", true); return; }
        const bytes = Uint8Array.from(atob(row.docx), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = row.docx_name || `IAA_Briefing_${b.issue_no}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }, "Download Word file");

    const readStatus = h("p", { class: "status", role: "status" });
    const readBox = myRead
      ? h("p", { class: "read-confirmed" }, `You confirmed you read this on ${new Date(myRead).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`)
      : h("div", { class: "row" },
          h("button", {
            class: "btn",
            type: "button",
            onclick: async function (e) {
              e.currentTarget.disabled = true;
              const { error } = await ctx.db.from("briefing_reads").insert({ briefing_id: b.id, profile_id: state.profile.id });
              if (error && !/duplicate/i.test(error.message)) { e.currentTarget.disabled = false; setStatus(readStatus, error.message, true); return; }
              showIssue(main, ctx, issueNo);
            }
          }, "I’ve read this briefing"));

    const body = h("div", { class: "briefing-body" });
    body.appendChild(safeFragment(b.html));

    fill(
      main,
      h("a", { class: "back-link", href: "#/briefings" }, "All briefings"),
      h("div", { class: "page-head page-head-row" },
        h("div", null,
          h("p", { class: "briefing-kicker" }, b.title),
          h("h1", null, `#${b.issue_no} · ${fmtDate(b.issue_date)}`)),
        readChip(ctx, myRead)),
      noticeBox(ctx),
      h("div", { class: "row" }, download),
      dlStatus,
      h("article", { class: "panel briefing-article" }, body),
      h("section", { class: "panel", "aria-labelledby": "confirm-h" },
        h("h2", { id: "confirm-h" }, "Confirm you’ve read it"),
        h("p", { class: "fineprint" }, "This replaces the signatures sheet."),
        readBox,
        readStatus),
      isManagement ? await readersPanel(ctx, b) : null,
      h("nav", { class: "row briefing-nav", "aria-label": "Other issues" },
        prev ? h("a", { class: "btn btn-quiet", href: "#/briefings/" + prev }, `‹ #${prev}`) : null,
        next ? h("a", { class: "btn btn-quiet", href: "#/briefings/" + next }, `#${next} ›`) : null)
    );
  }

  async function readersPanel(ctx, b) {
    const { h, setStatus } = ctx;
    const [readsRes, peopleRes] = await Promise.all([
      ctx.db.from("briefing_reads").select("profile_id, read_at").eq("briefing_id", b.id),
      ctx.db.from("profiles").select("id, full_name, email, active").order("full_name", { nullsFirst: false })
    ]);
    const readAt = {};
    (readsRes.data || []).forEach((r) => { readAt[r.profile_id] = r.read_at; });
    const people = (peopleRes.data || []).filter((p) => p.active || readAt[p.id]);
    const done = people.filter((p) => readAt[p.id]);
    const notYet = people.filter((p) => !readAt[p.id]);
    const name = (p) => p.full_name || p.email;
    const delStatus = h("p", { class: "status", role: "status" });

    return h(
      "section",
      { class: "panel panel-management", "aria-labelledby": "readers-h" },
      h("h2", { id: "readers-h" }, `Read by ${done.length} of ${people.length}`),
      h("p", { class: "fineprint" }, "Only management can see this section."),
      h("div", { class: "readers" },
        h("div", null, h("h3", null, "Not read yet"),
          notYet.length ? h("ul", { class: "plain-list" }, notYet.map((p) => h("li", null, name(p)))) : h("p", { class: "fineprint" }, "Everyone has read it.")),
        h("div", null, h("h3", null, "Read"),
          done.length
            ? h("ul", { class: "plain-list" }, done.map((p) => h("li", null, name(p), h("span", { class: "sub" }, new Date(readAt[p.id]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })))))
            : h("p", { class: "fineprint" }, "Nobody yet."))),
      h("div", { class: "row" },
        h("button", {
          class: "btn btn-quiet btn-small",
          type: "button",
          onclick: async function () {
            if (!confirm(`Delete briefing #${b.issue_no}? Its read confirmations are deleted too.`)) return;
            const { error } = await ctx.db.from("briefings").delete().eq("id", b.id);
            if (error) { setStatus(delStatus, error.message, true); return; }
            await ctx.logEvent("briefing_deleted", { issue_no: b.issue_no });
            notice = { text: `Briefing #${b.issue_no} deleted.` };
            go("#/briefings");
          }
        }, "Delete this issue")),
      delStatus
    );
  }

  // ------------------------------------------------------------------
  // Upload (management)
  // ------------------------------------------------------------------
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onerror = function () { reject(new Error("The file couldn’t be read")); };
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.readAsDataURL(file);
    });
  }

  async function prepare(file) {
    if (!/\.docx$/i.test(file.name)) throw new Error("Only Word .docx files can be uploaded");
    const buf = await file.arrayBuffer();
    const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    const m = C.meta(result.value, file.name);
    const html = C.clean(result.value);
    if (!html) throw new Error("No briefing content was found in this file");
    return {
      fileName: file.name,
      issueNo: m.issueNo,
      issueDate: m.issueDate,
      sections: m.sections,
      html: html,
      docx: await fileToBase64(file)
    };
  }

  async function showUpload(main, ctx) {
    const { h, fill, pageHead, setStatus } = ctx;
    const existingRes = await ctx.db.from("briefings").select("issue_no, issue_date").order("issue_no");
    const existing = {};
    (existingRes.data || []).forEach((b) => { existing[b.issue_no] = b.issue_date; });

    const input = h("input", { id: "b-files", type: "file", accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document", multiple: true, class: "file-input" });
    const status = h("p", { class: "status", role: "status" });
    const tableHost = h("div");
    const publish = h("button", { class: "btn", type: "button", disabled: true }, "Publish");

    function draw() {
      tableHost.replaceChildren();
      publish.disabled = !pending.length;
      publish.textContent = pending.length > 1 ? `Publish ${pending.length} briefings` : "Publish";
      if (!pending.length) return;
      const counts = {};
      pending.forEach((p) => { if (p.issueNo) counts[p.issueNo] = (counts[p.issueNo] || 0) + 1; });
      const rows = pending.map(function (p, i) {
        const num = h("input", { type: "number", min: "1", value: p.issueNo || "", "aria-label": "Issue number for " + p.fileName, oninput: function (e) { p.issueNo = parseInt(e.target.value, 10) || null; draw(); } });
        const date = h("input", { type: "date", value: p.issueDate || "", "aria-label": "Date for " + p.fileName, onchange: function (e) { p.issueDate = e.target.value || null; draw(); } });
        const warnings = [];
        if (!p.issueNo) warnings.push("Enter the issue number");
        if (!p.issueDate) warnings.push("Enter the date");
        if (p.issueNo && counts[p.issueNo] > 1) warnings.push("Same number as another file");
        if (p.issueNo && existing[p.issueNo]) warnings.push(`Replaces the published #${p.issueNo}`);
        return h(
          "tr",
          null,
          h("td", null, p.fileName, h("span", { class: "sub" }, `${p.sections.length} topics: ${p.sections.slice(0, 3).join(" · ")}${p.sections.length > 3 ? " …" : ""}`)),
          h("td", null, num),
          h("td", null, date),
          h("td", null, warnings.length ? warnings.map((w) => h("span", { class: /Replaces/.test(w) ? "sub" : "sub is-error" }, w)) : h("span", { class: "sub" }, "Ready")),
          h("td", null, h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { pending.splice(i, 1); draw(); } }, "Remove"))
        );
      });
      tableHost.append(h("div", { class: "table-wrap" },
        h("table", null,
          h("thead", null, h("tr", null, h("th", null, "File"), h("th", null, "Issue"), h("th", null, "Date"), h("th", null, "Check"), h("th", null, ""))),
          h("tbody", null, rows))));
    }

    input.addEventListener("change", async function () {
      const files = Array.from(input.files || []);
      input.value = "";
      for (let i = 0; i < files.length; i++) {
        setStatus(status, `Reading ${files[i].name} (${i + 1} of ${files.length})…`);
        try {
          pending.push(await prepare(files[i]));
        } catch (err) {
          setStatus(status, `${files[i].name}: ${err.message}`, true);
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      pending.sort((a, b) => (a.issueNo || 0) - (b.issueNo || 0));
      if (!/:/.test(status.textContent) || !status.classList.contains("is-error")) setStatus(status, "");
      draw();
    });

    publish.addEventListener("click", async function () {
      const counts = {};
      pending.forEach((p) => { counts[p.issueNo] = (counts[p.issueNo] || 0) + 1; });
      if (pending.some((p) => !p.issueNo || !p.issueDate)) { setStatus(status, "Every file needs an issue number and a date.", true); return; }
      if (Object.values(counts).some((n) => n > 1)) { setStatus(status, "Two files have the same issue number. Change or remove one.", true); return; }
      const replacing = pending.filter((p) => existing[p.issueNo]).map((p) => "#" + p.issueNo);
      if (replacing.length && !confirm(`This replaces ${replacing.join(", ")}, which ${replacing.length === 1 ? "is" : "are"} already published. Continue?`)) return;

      publish.disabled = true;
      let done = 0;
      const failed = [];
      for (const p of pending.slice()) {
        setStatus(status, `Publishing #${p.issueNo} (${done + failed.length + 1} of ${pending.length})…`);
        const { error } = await ctx.db.from("briefings").upsert({
          issue_no: p.issueNo,
          issue_date: p.issueDate,
          sections: p.sections,
          html: p.html,
          docx: p.docx,
          docx_name: p.fileName
        }, { onConflict: "issue_no" });
        if (error) failed.push(`#${p.issueNo}: ${error.message}`);
        else { done += 1; pending = pending.filter((x) => x !== p); }
      }
      if (done) await ctx.logEvent("briefings_published", { count: done });
      if (failed.length) {
        publish.disabled = false;
        setStatus(status, `${done} published. These didn’t work: ${failed.join("; ")}`, true);
        draw();
        return;
      }
      notice = { text: done === 1 ? "Briefing published." : `${done} briefings published.` };
      go("#/briefings");
    });

    fill(
      main,
      h("a", { class: "back-link", href: "#/briefings" }, "All briefings"),
      pageHead("Upload briefings", "Add the finished Word file for a new issue, or several older issues at once."),
      h("section", { class: "panel" },
        h("p", null, "The issue number and date are read from each file’s cover. Check them before publishing; you can correct them here. Uploading an issue number that already exists replaces that issue."),
        h("label", { for: "b-files", class: "btn btn-quiet file-label" }, "Choose Word files"),
        input,
        tableHost,
        h("div", { class: "row" }, publish, h("a", { class: "btn btn-quiet", href: "#/briefings", onclick: function () { pending = []; } }, "Cancel")),
        status)
    );
    draw();
  }
})();
