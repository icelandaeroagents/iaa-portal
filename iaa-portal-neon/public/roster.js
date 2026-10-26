/* Iceland Aero Agents – Staff Portal
   Roster: management uploads the roster Excel file (e.g. Vaktir IAA.xlsx);
   Home shows who is on for a day, and the Roster page shows the full
   half-month grid. Reading the file: roster-parse.js + SheetJS (vendor). */

(function () {
  "use strict";

  const P = window.IAARosterParse;
  let homeOffset = 0;          // days from today shown on Home
  let pickedSheet = 0;         // tab on the Roster page
  let pickedBlock = null;      // half-month block on the Roster page
  let prepared = null;         // file being uploaded
  let notice = null;

  window.IAARoster = { render: render, homePanel: homePanel };

  // ------------------------------------------------------------------
  function iso(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
  function niceDate(isoDate, opts) {
    return new Date(isoDate + "T12:00:00").toLocaleDateString("en-GB", opts || { weekday: "long", day: "numeric", month: "long" });
  }
  function go(hash) {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  }

  // Letters folded so "Audur" matches "AUÐUR", "Briet" matches "Bríet" and
  // "Thrainn" matches "Þráinn"; capitals are ignored too.
  function fold(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/ð/g, "d").replace(/þ/g, "th").replace(/æ/g, "ae").replace(/ø/g, "o")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  // The names to look for: the roster names management set on the People
  // page (e.g. "Beggi" or "Josh, Joshy"), plus the person's first name.
  function namesFor(profile) {
    const names = String(profile.roster_names || "").split(/[,;\/]+/).map((x) => x.trim()).filter(Boolean);
    const first = String(profile.full_name || "").trim().split(/\s+/)[0];
    if (first && names.every((n) => fold(n) !== fold(first))) names.push(first);
    return names.filter((n) => fold(n).length >= 2);
  }

  // Matches a whole word in a roster cell ("Cesar", "Atli short", "Beggi -1600").
  function nameMatcher(profile) {
    const res = namesFor(profile).map(function (n) {
      return new RegExp("(^|[^\\p{L}])" + fold(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^\\p{L}]|$)", "u");
    });
    if (!res.length) return function () { return false; };
    return function (text) {
      const t = fold(text);
      return res.some((re) => re.test(t));
    };
  }

  async function latest(ctx, withFile) {
    const cols = withFile ? "id, file_name, file_data, sheets, uploaded_at" : "id, file_name, sheets, uploaded_at";
    const res = await ctx.db.from("rosters").select(cols).order("uploaded_at", { ascending: false }).limit(1);
    if (res.error) throw res.error;
    return (res.data || [])[0] || null;
  }

  // The roster for Home: a few quick retries (the first request after the
  // portal opens can fail while sign-in refreshes or the database wakes),
  // then the last roster this device saw, so the panel never just vanishes.
  const CACHE_KEY = "iaa-portal-roster";
  function saveCache(r) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), roster: r })); } catch (e) { /* storage full or off */ }
  }
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return c && c.roster ? c : null;
    } catch (e) { return null; }
  }
  async function latestForHome(ctx) {
    const waits = [0, 600, 1800];
    let lastErr = null;
    for (const w of waits) {
      if (w) await new Promise((res) => setTimeout(res, w));
      try {
        const r = await latest(ctx, false);
        if (r) saveCache(r);
        return { roster: r, fromCache: null };
      } catch (err) {
        lastErr = err;
      }
    }
    console.warn("Roster couldn’t load:", lastErr);
    const cached = readCache();
    if (cached) return { roster: cached.roster, fromCache: cached.at };
    return { roster: null, error: lastErr };
  }

  // ------------------------------------------------------------------
  // Home panel
  // ------------------------------------------------------------------
  async function homePanel(ctx, rerender) {
    const { h } = ctx;
    const got = await latestForHome(ctx);
    if (got.error) {
      return h("section", { class: "panel roster-home", "aria-labelledby": "roster-h" },
        h("p", { class: "briefing-kicker" }, "Roster"),
        h("h2", { id: "roster-h" }, "The roster couldn’t load just now"),
        h("div", { class: "row" }, h("button", { class: "btn btn-quiet", type: "button", onclick: function () { rerender(); } }, "Try again")));
    }
    const r = got.roster;
    if (!r) return null;
    const date = iso(addDays(homeOffset));
    const mine = nameMatcher(ctx.state.profile);
    const label = homeOffset === 0 ? "Today" : homeOffset === 1 ? "Tomorrow" : homeOffset === -1 ? "Yesterday" : niceDate(date, { weekday: "long" });

    const sheetsOut = (r.sheets || []).map(function (s) {
      const entries = P.day(s.blocks || [], date);
      return h("div", { class: "roster-day-sheet" },
        h("h3", null, s.label || s.name),
        entries === null
          ? h("p", { class: "fineprint" }, "Not on this roster.")
          : entries.length
            ? h("dl", { class: "roster-day" }, entries.map((e) => [
                h("dt", null, e.label || "Note"),
                h("dd", { class: mine(e.value) ? "is-me" : null }, e.value)
              ]))
            : h("p", { class: "fineprint" }, "Nothing scheduled."));
    });

    const myShifts = [];
    (r.sheets || []).forEach(function (s) {
      (P.day(s.blocks || [], date) || []).forEach(function (e) { if (mine(e.value) && e.label) myShifts.push(e.label); });
    });

    return h(
      "section",
      { class: "panel roster-home", "aria-labelledby": "roster-h" },
      h("div", { class: "briefing-latest-head" },
        h("div", null,
          h("p", { class: "briefing-kicker" }, "Roster"),
          h("h2", { id: "roster-h" }, `${label} · ${niceDate(date, { day: "numeric", month: "long" })}`)),
        h("div", { class: "row row-tight" },
          h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Previous day", onclick: function () { homeOffset -= 1; rerender(); } }, "‹"),
          homeOffset !== 0 ? h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { homeOffset = 0; rerender(); } }, "Today") : null,
          h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Next day", onclick: function () { homeOffset += 1; rerender(); } }, "›"))),
      got.fromCache ? h("p", { class: "fineprint" }, "Couldn’t reach the portal just now, so this is the roster as of " +
        new Date(got.fromCache).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + ". ",
        h("button", { class: "linkish", type: "button", onclick: function () { rerender(); } }, "Try again")) : null,
      (function () {
        const when = homeOffset === 0 ? "today" : homeOffset === 1 ? "tomorrow" : homeOffset === -1 ? "yesterday" : "on " + niceDate(date, { weekday: "long" });
        const looking = namesFor(ctx.state.profile);
        if (myShifts.length) return h("p", { class: "notice roster-mine" }, `You’re on ${when.replace(/^on /, "")}: ` + myShifts.join(", "));
        if (!looking.length) return h("p", { class: "fineprint" }, "Add your name under Your details below to see your own shifts here.");
        return h("p", { class: "fineprint" }, `You’re not on the roster ${when} (looking for ${looking.map((n) => "“" + n + "”").join(" or ")}).`);
      })(),
      h("div", { class: "roster-day-grid" }, sheetsOut),
      h("div", { class: "row" }, h("a", { class: "btn btn-quiet", href: "#/roster" }, "Full roster"))
    );
  }

  // ------------------------------------------------------------------
  // Roster page
  // ------------------------------------------------------------------
  async function render(main, ctx) {
    if (/^#\/roster\/upload/.test(location.hash) && ctx.state.profile.role === "management") return showUpload(main, ctx);
    return showRoster(main, ctx);
  }

  async function showRoster(main, ctx) {
    const { h, fill, pageHead, state, setStatus } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, pageHead("Roster"), h("p", { class: "empty" }, "Loading the roster…"));
    const r = await latest(ctx, false);

    const head = h("div", { class: "page-head page-head-row" },
      h("div", null, h("h1", null, "Roster"),
        h("p", null, r ? `From ${r.file_name || "the roster file"}, uploaded ${new Date(r.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.` : "No roster has been uploaded yet.")),
      isManagement ? h("a", { class: "btn", href: "#/roster/upload" }, r ? "Upload new roster" : "Upload roster") : null);

    if (!r || !(r.sheets || []).length) { fill(main, head, noticeBox(ctx)); return; }

    const sheets = r.sheets;
    if (pickedSheet >= sheets.length) pickedSheet = 0;
    const sheet = sheets[pickedSheet];
    const today = iso(new Date());
    const blocks = sheet.blocks || [];
    if (pickedBlock === null || pickedBlock >= blocks.length) {
      pickedBlock = Math.max(0, blocks.findIndex((b) => b.dates.indexOf(today) !== -1));
      if (pickedBlock === -1) pickedBlock = 0;
    }
    const block = blocks[pickedBlock];
    const mine = nameMatcher(state.profile);

    const tabs = sheets.length > 1
      ? h("nav", { class: "tabs", "aria-label": "Roster tabs" }, sheets.map((s, i) =>
          h("a", { href: "#/roster", "aria-current": i === pickedSheet ? "page" : null, onclick: function (e) { e.preventDefault(); pickedSheet = i; pickedBlock = null; showRoster(main, ctx); } }, s.label || s.name)))
      : null;

    const blockPicker = h("select", { id: "roster-block", onchange: function (e) { pickedBlock = parseInt(e.target.value, 10); showRoster(main, ctx); } },
      blocks.map((b, i) => h("option", { value: String(i), selected: i === pickedBlock },
        `${niceDate(b.dates[0], { day: "numeric", month: "short" })} – ${niceDate(b.dates[b.dates.length - 1], { day: "numeric", month: "short", year: "numeric" })}`)));

    const dlStatus = h("p", { class: "status", role: "status" });
    const download = h("button", {
      class: "btn btn-quiet", type: "button",
      onclick: async function () {
        download.disabled = true;
        try {
          const full = await latest(ctx, true);
          if (!full || !full.file_data) throw new Error("The original file isn’t stored for this roster.");
          const bytes = Uint8Array.from(atob(full.file_data), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          const a = document.createElement("a");
          a.href = url; a.download = full.file_name || "roster.xlsx";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) { setStatus(dlStatus, err.message, true); }
        download.disabled = false;
      }
    }, "Download Excel file");

    const table = block
      ? h("div", { class: "table-wrap roster-wrap" },
          h("table", { class: "roster-grid" },
            h("thead", null, h("tr", null, h("th", null, ""), block.dates.map((d) =>
              h("th", { class: d === today ? "is-today" : null },
                h("span", { class: "sub" }, niceDate(d, { weekday: "short" })), niceDate(d, { day: "numeric" }))))),
            h("tbody", null, block.rows.map((row) =>
              h("tr", null, h("th", { scope: "row" }, row.label || "Notes"),
                row.values.map(function (v, i) {
                  const struck = !!(row.struck && row.struck[i]);
                  const cls = [block.dates[i] === today ? "is-today" : "", v && !struck && mine(v) ? "is-me" : "", struck ? "is-struck" : ""].join(" ").trim() || null;
                  return h("td", { class: cls, title: struck ? "Crossed out in the roster" : null }, struck ? h("s", null, v) : v);
                }))))))
      : h("p", { class: "empty" }, "This tab has no dated roster.");

    fill(main, head, noticeBox(ctx), tabs,
      h("div", { class: "row" }, h("div", { class: "field" }, h("label", { for: "roster-block" }, "Period"), blockPicker), download),
      dlStatus,
      h("section", { class: "panel" }, table,
        h("p", { class: "fineprint" }, "Today is highlighted in teal; your own shifts are in bold. Crossed-out names are treated as cancelled.")));
  }

  function noticeBox(ctx) {
    if (!notice) return null;
    const n = ctx.h("p", { class: notice.isError ? "notice is-error" : "notice" }, notice.text);
    notice = null;
    return n;
  }

  // ------------------------------------------------------------------
  // Upload (management)
  // ------------------------------------------------------------------
  async function showUpload(main, ctx) {
    const { h, fill, pageHead, setStatus } = ctx;
    const input = h("input", { id: "roster-file", type: "file", accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", class: "file-input" });
    const status = h("p", { class: "status", role: "status" });
    const host = h("div");
    const publish = h("button", { class: "btn", type: "button", disabled: true }, "Publish roster");
    const today = iso(new Date());

    function draw() {
      host.replaceChildren();
      publish.disabled = !prepared || !prepared.sheets.some((s) => s.include);
      if (!prepared) return;
      host.append(h("p", null, `${prepared.fileName}: choose which tabs to show on the portal. Tabs without dated shifts can’t be shown.`),
        h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, h("th", null, "Show"), h("th", null, "Tab in the file"), h("th", null, "Name on the portal"), h("th", null, "Dates found"))),
          h("tbody", null, prepared.sheets.map(function (s) {
            const box = h("input", { type: "checkbox", checked: s.include, disabled: !s.blocks.length, "aria-label": "Show " + s.name, onchange: function (e) { s.include = e.target.checked; draw(); } });
            const label = h("input", { type: "text", value: s.label, "aria-label": "Name for " + s.name, oninput: function (e) { s.label = e.target.value; } });
            const rg = P.range(s.blocks);
            return h("tr", null, h("td", null, box), h("td", null, s.name), h("td", null, label),
              h("td", null, rg ? `${niceDate(rg.from, { day: "numeric", month: "short" })} – ${niceDate(rg.to, { day: "numeric", month: "short", year: "numeric" })}` : "None",
                rg && rg.from <= today && rg.to >= today ? h("span", { class: "sub" }, "Includes today") : null));
          })))));
      const overlap = prepared.sheets.filter((s) => s.include && s.blocks.some((b) => b.dates.indexOf(today) !== -1));
      if (overlap.length > 1) host.append(h("p", { class: "notice" }, `${overlap.length} of the chosen tabs cover today. If one is an older plan, untick it so staff only see the current one.`));
    }

    input.addEventListener("change", async function () {
      const file = (input.files || [])[0];
      input.value = "";
      if (!file) return;
      try {
        setStatus(status, "Reading the roster…");
        const buf = await file.arrayBuffer();
        const sheets = P.readWorkbook(window.XLSX, new Uint8Array(buf)).map(function (sh) {
          const blocks = P.blocks(sh.rows, sh.flags);
          return { name: sh.name, label: sh.name.trim(), blocks: blocks, include: blocks.some((b) => b.dates.indexOf(today) !== -1) || false };
        });
        if (!sheets.some((s) => s.include)) { const firstWith = sheets.find((s) => s.blocks.length); if (firstWith) firstWith.include = true; }
        const data = await new Promise(function (resolve, reject) {
          const fr = new FileReader();
          fr.onerror = () => reject(new Error("The file couldn’t be read"));
          fr.onload = () => resolve(String(fr.result).split(",")[1]);
          fr.readAsDataURL(file);
        });
        prepared = { fileName: file.name, data: data, sheets: sheets };
        setStatus(status, sheets.some((s) => s.blocks.length) ? "" : "No dated roster was found in this file. It needs month headings like “October , 2026” above the day numbers.", !sheets.some((s) => s.blocks.length));
      } catch (err) {
        setStatus(status, "This file couldn’t be read as a spreadsheet: " + err.message, true);
      }
      draw();
    });

    publish.addEventListener("click", async function () {
      if (!prepared) return;
      publish.disabled = true;
      setStatus(status, "Publishing…");
      const sheets = prepared.sheets.filter((s) => s.include).map((s) => ({ name: s.name, label: (s.label || s.name).trim(), blocks: s.blocks }));
      const { error } = await ctx.db.from("rosters").insert({ file_name: prepared.fileName, file_data: prepared.data, sheets: sheets });
      if (error) { publish.disabled = false; setStatus(status, error.message, true); return; }
      await ctx.logEvent("roster_uploaded", { file_name: prepared.fileName, tabs: sheets.map((s) => s.name) });
      prepared = null;
      notice = { text: "Roster published. Staff now see it on Home." };
      go("#/roster");
    });

    fill(main,
      h("a", { class: "back-link", href: "#/roster" }, "Roster"),
      pageHead("Upload roster", "Choose the roster Excel file. The portal reads the dated shift blocks from each tab."),
      h("section", { class: "panel" },
        h("label", { for: "roster-file", class: "btn btn-quiet file-label" }, "Choose Excel file"),
        input, host,
        h("div", { class: "row" }, publish, h("a", { class: "btn btn-quiet", href: "#/roster", onclick: function () { prepared = null; } }, "Cancel")),
        status));
    draw();
  }
})();
