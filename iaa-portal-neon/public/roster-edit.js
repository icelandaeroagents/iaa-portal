/* Iceland Aero Agents – Staff Portal
   Roster editor (management): build the roster in the portal.
   – Pick a person, tick one or more duties and as many days as needed, Add.
   – Shifts 0630-1830, 0700-1500, 0700-1900, 0800-1500, 0800-1800,
     0800-2000, 1100-2300, 1700-2300, plus BIKF Resp,
     BIAR Resp and Management on duty (these three are needed every day).
   – Changes are a draft. "Publish changes" writes what staff see, in the
     same form as an uploaded Excel roster, so Home and the Roster page
     work as before. Each month has its own "Visible to staff" switch.
   Needs database update 33. */
(function () {
  "use strict";

  const DUTIES = [
    { key: "0630-1830", group: "Shifts" },
    { key: "0700-1500", group: "Shifts" },
    { key: "0700-1900", group: "Shifts" },
    { key: "0800-1500", group: "Shifts" },
    { key: "0800-1800", group: "Shifts" },
    { key: "0800-2000", group: "Shifts" },
    { key: "1100-2300", group: "Shifts" },
    { key: "1700-2300", group: "Shifts" },
    { key: "BIKF Resp", group: "Responsible", required: true },
    { key: "BIAR Resp", group: "Responsible", required: true },
    { key: "Management on duty", group: "Responsible", required: true }
  ];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let month = null;            // "YYYY-MM-01"
  let sel = { person: "", duties: new Set(), days: new Set(), note: "" };
  let notice = null;
  let keepScroll = null;
  let pasteOpen = false;       // keep the paste panel open after pasting       // page and grid scroll positions to restore after a change

  // ------------------------------------------------------------------
  // Dates and names
  // ------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function firstOfMonth(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; }
  function shiftMonth(m, n) { const d = new Date(m + "T12:00:00"); d.setDate(1); d.setMonth(d.getMonth() + n); return firstOfMonth(d); }
  function daysIn(m) {
    const d = new Date(m + "T12:00:00"); const out = []; const mo = d.getMonth();
    while (d.getMonth() === mo) { out.push(iso(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function lastDay(m) { const ds = daysIn(m); return ds[ds.length - 1]; }
  function monthName(m) { return new Date(m + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
  function dayNum(d) { return parseInt(d.slice(8), 10); }
  function weekday(d) { return (new Date(d + "T12:00:00").getDay() + 6) % 7; }   // Mon = 0
  function when(v) { return v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }

  function fold(t) {
    return String(t || "").toLowerCase().replace(/ð/g, "d").replace(/þ/g, "th").replace(/æ/g, "ae").replace(/ø/g, "o")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }
  // The name shown on the roster: the person's roster name (People page), or
  // their first name. If two people would show the same, add a surname initial.
  function displayNames(people) {
    const base = {};
    people.forEach((p) => {
      const rn = String(p.roster_names || "").split(/[,;\/]+/).map((x) => x.trim()).filter(Boolean)[0];
      base[p.id] = rn || String(p.full_name || p.email || "").trim().split(/\s+/)[0];
    });
    const count = {};
    Object.values(base).forEach((n) => { count[fold(n)] = (count[fold(n)] || 0) + 1; });
    const out = {};
    people.forEach((p) => {
      const parts = String(p.full_name || "").trim().split(/\s+/);
      out[p.id] = count[fold(base[p.id])] > 1 && parts.length > 1 ? `${base[p.id]} ${parts[parts.length - 1][0]}.` : base[p.id];
    });
    return out;
  }

  // ------------------------------------------------------------------
  // Publishing: the roster staff see, in the uploaded-roster format
  // ------------------------------------------------------------------
  // Shifts in order of start time (then end time), then any other rows,
  // then BIKF Resp, BIAR Resp and Management on duty at the bottom.
  const LAST = ["BIKF Resp", "BIAR Resp", "Management on duty"];
  function isShift(k) { return /^\d{4}-\d{4}$/.test(k); }
  function dutyOrder(entries) {
    const all = DUTIES.map((d) => d.key);
    entries.forEach((e) => { if (all.indexOf(e.duty) === -1) all.push(e.duty); });
    const shifts = all.filter(isShift).sort();
    const other = all.filter((k) => !isShift(k) && LAST.indexOf(k) === -1).sort();
    return shifts.concat(other, LAST);
  }
  function buildSheets(months, entries, names) {
    const order = dutyOrder(entries);
    const blocks = [];
    months.forEach(function (m) {
      const all = daysIn(m);
      [all.slice(0, 15), all.slice(15)].forEach(function (dates) {
        if (!dates.length) return;
        blocks.push({
          dates: dates,
          rows: order.map((duty) => ({
            label: duty,
            values: dates.map((d) => entries.filter((e) => e.work_date === d && e.duty === duty)
              .map((e) => (names[e.profile_id] || "?") + (e.note ? " (" + e.note + ")" : "")).sort().join(", "))
          }))
        });
      });
    });
    return [{ name: "Roster", label: "Roster", blocks: blocks }];
  }

  async function publish(ctx) {
    const db = ctx.db;
    const mr = await db.from("roster_months").select("*").eq("visible", true).order("month");
    if (mr.error) throw new Error(mr.error.message);
    const months = (mr.data || []).map((x) => x.month);
    if (!months.length) throw new Error("No month is visible to staff yet. Tick “Visible to staff” for at least one month.");
    const er = await db.from("roster_entries").select("work_date, duty, profile_id, note").gte("work_date", months[0]).lte("work_date", lastDay(months[months.length - 1]));
    if (er.error) throw new Error(er.error.message);
    const visible = new Set(months);
    const entries = (er.data || []).filter((e) => visible.has(e.work_date.slice(0, 8) + "01"));
    const pr = await db.from("profiles").select("id, full_name, email, roster_names");
    if (pr.error) throw new Error(pr.error.message);
    const sheets = buildSheets(months, entries, displayNames(pr.data || []));
    const ins = await db.from("rosters").insert({ file_name: null, file_data: null, sheets: sheets });
    if (ins.error) throw new Error(ins.error.message);
    const by = ctx.state.profile.full_name || ctx.state.profile.email;
    await db.from("roster_months").update({ published_at: new Date().toISOString(), published_by_name: by }).in("month", months);
    if (ctx.logEvent) await ctx.logEvent("roster_published", { months: months, entries: entries.length });
    return { months: months, entries: entries.length };
  }

  // ------------------------------------------------------------------
  // Copying a month from the roster currently published (e.g. an uploaded file)
  // ------------------------------------------------------------------
  function dutyFromLabel(label) {
    const t = fold(label);
    const digits = t.replace(/[^0-9]/g, "");
    const shift = DUTIES.find((d) => /^\d/.test(d.key) && d.key.replace(/[^0-9]/g, "") === digits);
    if (shift) return shift.key;
    if (/bikf/.test(t)) return "BIKF Resp";
    if (/biar/.test(t)) return "BIAR Resp";
    if (/manag|stjorn|duty manager|go ?to ?boss/.test(t)) return "Management on duty";
    if (digits.length === 8) return digits.slice(0, 4) + "-" + digits.slice(4);
    return label ? String(label).trim().slice(0, 40) : null;
  }
  function personMatcher(people) {
    const list = [];
    people.forEach(function (p) {
      const names = String(p.roster_names || "").split(/[,;\/]+/).map((x) => x.trim()).filter(Boolean);
      const first = String(p.full_name || "").trim().split(/\s+/)[0];
      if (first) names.push(first);
      if (p.full_name) names.push(p.full_name);
      names.forEach((n) => { if (fold(n).length >= 2) list.push([fold(n), p.id]); });
    });
    return function (token) {
      const t = fold(token);
      const hits = Array.from(new Set(list.filter((x) => x[0] === t).map((x) => x[1])));
      return hits.length === 1 ? hits[0] : null;
    };
  }
  async function copyFromPublished(ctx, m, people) {
    const r = await ctx.db.from("rosters").select("sheets").order("uploaded_at", { ascending: false }).limit(1);
    if (r.error) throw new Error(r.error.message);
    const sheets = ((r.data || [])[0] || {}).sheets || [];
    const match = personMatcher(people);
    const rows = [], unmatched = new Set(), seen = new Set();
    sheets.forEach(function (s) {
      (s.blocks || []).forEach(function (b) {
        b.dates.forEach(function (d, i) {
          if (d.slice(0, 8) + "01" !== m) return;
          (b.rows || []).forEach(function (row) {
            if (row.struck && row.struck[i]) return;
            const duty = dutyFromLabel(row.label);
            const cell = String(row.values[i] || "").trim();
            if (!duty || !cell) return;
            cell.split(/\s*(?:[,\/&+]|\bog\b|\band\b)\s*/i).filter(Boolean).forEach(function (part) {
              const mm = part.match(/^(.*?)\s*(?:\((.*)\)|(-?\s*\d{3,4}.*))?$/);
              const nameText = (mm ? mm[1] : part).trim();
              const note = mm ? (mm[2] || mm[3] || "").trim() : "";
              if (!nameText) return;
              const pid = match(nameText);
              if (!pid) { unmatched.add(nameText); return; }
              const k = d + "|" + duty + "|" + pid;
              if (seen.has(k)) return; seen.add(k);
              rows.push({ work_date: d, duty: duty, profile_id: pid, note: note ? note.slice(0, 60) : null });
            });
          });
        });
      });
    });
    let added = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const res = await ctx.db.from("roster_entries").upsert(rows.slice(i, i + 200), { onConflict: "work_date,duty,profile_id", ignoreDuplicates: true }).select("id");
      if (res.error) throw new Error(res.error.message);
      added += (res.data || []).length;
    }
    return { added: added, found: rows.length, unmatched: Array.from(unmatched).sort() };
  }

  // ------------------------------------------------------------------
  // Paste from Excel: a block of cells copied from the roster spreadsheet
  // (tab-separated). It needs the row with the day numbers and the shift
  // labels in the first column. Names are matched to people as when copying.
  // ------------------------------------------------------------------
  function splitNames(cell) {
    return String(cell || "").split(/\s*(?:[,\/&+]|\bog\b|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  }
  function parsePaste(text, m, people) {
    const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
    const grid = lines.map((l) => l.split("\t"));
    if (!grid.length) return { error: "Nothing pasted yet." };
    // The header row: the row with the most cells that are day numbers (1–31).
    const dayOf = (c) => { const t = String(c).trim(); const mm = t.match(/^(\d{1,2})(?:[.\/]\d{1,2}(?:[.\/]\d{2,4})?)?\.?$/); const n = mm ? +mm[1] : NaN; return n >= 1 && n <= 31 ? n : null; };
    let hi = -1, best = 0;
    grid.forEach((r, i) => { const n = r.filter((c) => dayOf(c) !== null).length; if (n > best) { best = n; hi = i; } });
    if (best < 2) return { error: "Include the row with the day numbers (1, 2, 3 …) when you copy from Excel." };
    // Columns → dates in this month (rolling into the next month if the numbers wrap round).
    const cols = {}; let monthStart = m, prev = 0;
    grid[hi].forEach((c, i) => {
      const n = dayOf(c); if (n === null) return;
      if (n < prev) monthStart = shiftMonth(monthStart, 1);
      prev = n;
      const d = monthStart.slice(0, 8) + pad(n);
      if (daysIn(monthStart).indexOf(d) !== -1) cols[i] = d;
    });
    const firstDayCol = Math.min.apply(null, Object.keys(cols).map(Number));
    const match = personMatcher(people);
    const rows = [], rowsUsed = {}, unmatched = {}, skipped = [], multi = [];
    grid.forEach(function (r, i) {
      if (i === hi) return;
      const label = r.slice(0, firstDayCol).map((x) => x.trim()).filter(Boolean).join(" ");
      if (!label) return;
      if (r.slice(firstDayCol).every((c) => !String(c).trim())) return;
      const duty = dutyFromLabel(label);
      if (!duty || (!isShift(duty) && LAST.indexOf(duty) === -1)) { if (/[a-z]/i.test(label) && !/^(mon|tue|wed|thu|fri|sat|sun|m[aá]n|þri|mi[dð]|fim|f[oö]s|lau|sun)/i.test(label)) skipped.push(label); return; }
      rowsUsed[duty] = (rowsUsed[duty] || 0);
      Object.keys(cols).forEach(function (ci) {
        const parts = splitNames(r[ci]);
        // One person per row per day: a cell with more than one name is not split.
        if (parts.length > 1) { multi.push(`${duty} on ${dayNum(cols[ci])}: “${String(r[ci]).trim()}”`); return; }
        parts.forEach(function (part) {
          const mm = part.match(/^(.*?)\s*(?:\((.*)\)|(-?\s*\d{3,4}.*))?$/);
          const who = (mm ? mm[1] : part).trim(), note = mm ? (mm[2] || mm[3] || "").trim() : "";
          if (!who) return;
          const pid = match(who);
          if (!pid) { unmatched[who] = (unmatched[who] || 0) + 1; return; }
          rows.push({ work_date: cols[ci], duty: duty, profile_id: pid, note: note ? note.slice(0, 60) : null });
          rowsUsed[duty] += 1;
        });
      });
    });
    const seen = {}; const uniq = rows.filter((x) => { const k = x.work_date + "|" + x.duty + "|" + x.profile_id; if (seen[k]) return false; seen[k] = 1; return true; });
    const dates = Object.values(cols).sort();
    return { rows: uniq, dates: dates, duties: Object.keys(rowsUsed), rowsUsed: rowsUsed, unmatched: unmatched, skipped: skipped, multi: multi };
  }

  // Excel also puts an HTML table on the clipboard, which keeps merged cells,
  // cell colours and crossed-out text. Read it the same way as an uploaded
  // file (roster-parse.js): a name merged or coloured across several days
  // counts for each of them, and crossed-out names are cancelled.
  function excelHtmlToTsv(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (!table) return null;
    // Class styles from Excel's <style> block (.xl65 { background:#92D050; text-decoration:line-through }).
    const css = {};
    Array.from(doc.querySelectorAll("style")).forEach((st) => {
      String(st.textContent).replace(/\.([\w-]+)\s*\{([^}]*)\}/g, (all, cls, body) => { css[cls] = (css[cls] || "") + ";" + body; return all; });
    });
    const styleOf = (el) => (el.getAttribute("class") || "").split(/\s+/).map((c) => css[c] || "").join(";") + ";" + (el.getAttribute("style") || "");
    const bgOf = (st, el) => {
      const m = st.match(/background(?:-color)?\s*:\s*([^;]+)/i);
      const v = (m ? m[1] : el.getAttribute("bgcolor") || "").trim().toLowerCase().replace(/\s+/g, "");
      return !v || /^(none|transparent|white|#fff|#ffffff|windowtext|auto|inherit)$/.test(v) ? null : v;
    };
    const struckOf = (st, el) => /line-through/i.test(st) || !!el.querySelector("s, strike, del, [style*='line-through']");
    const grid = [], filled = [];
    let r = 0;
    Array.from(table.querySelectorAll("tr")).forEach((tr) => {
      if (/display\s*:\s*none/i.test(tr.getAttribute("style") || "")) return;
      grid[r] = grid[r] || [];
      let c = 0;
      Array.from(tr.children).forEach((td) => {
        if (!/^t[dh]$/i.test(td.tagName)) return;
        while (grid[r][c]) c++;
        const st = styleOf(td);
        const cell = { text: String(td.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(), bg: bgOf(st, td), struck: struckOf(st, td) };
        const cs = Math.max(1, +td.getAttribute("colspan") || 1), rs = Math.max(1, +td.getAttribute("rowspan") || 1);
        for (let dr = 0; dr < rs; dr++) {
          grid[r + dr] = grid[r + dr] || [];
          for (let dc = 0; dc < cs; dc++) {
            // 1. Merged cells: every cell of the merge gets the name.
            grid[r + dr][c + dc] = { text: cell.text, bg: cell.bg, struck: cell.struck, merged: dr > 0 || dc > 0 };
          }
        }
        c += cs;
      });
      r++;
    });
    let spans = 0, struck = 0;
    const width = grid.reduce((m, row) => Math.max(m, (row || []).length), 0);
    grid.forEach((row) => {
      for (let i = 0; i < width; i++) if (!row[i]) row[i] = { text: "", bg: null, struck: false };
      // 2. Coloured spans: a run of same-coloured cells with the name written once.
      let c = 0;
      while (c < width) {
        const key = row[c].bg; let end = c;
        if (key) while (end + 1 < width && row[end + 1].bg === key) end++;
        if (key && end > c) {
          const written = [];
          for (let k = c; k <= end; k++) if (row[k].text && !row[k].merged) written.push(k);
          if (written.length === 1) {
            const src = row[written[0]];
            for (let k = c; k <= end; k++) if (!row[k].text) { row[k] = { text: src.text, bg: key, struck: src.struck, merged: true }; spans++; }
          }
        }
        c = end + 1;
      }
    });
    // 3. Crossed-out names are cancelled.
    const tsv = grid.map((row) => row.map((cell) => {
      if (cell.struck && cell.text) { struck++; return ""; }
      return cell.text.replace(/\t/g, " ");
    }).join("\t")).join("\n");
    const merged = grid.reduce((n, row) => n + row.filter((x) => x.merged && x.text).length, 0);
    return { tsv: tsv, merged: merged, struck: struck };
  }

  function pastePanel(ctx, people, names, rerender) {
    const { h, db, setStatus } = ctx;
    const area = h("textarea", { id: "re-paste", rows: 6, placeholder: "Copy the block from Excel – including the row with the day numbers and the shift names on the left – and paste it here." });
    const replace = h("input", { type: "checkbox", id: "re-paste-replace", checked: true });
    const preview = h("div", { class: "re-paste-preview" });
    const st = h("p", { class: "status", role: "status" });
    const go = h("button", { class: "btn", type: "button", disabled: true }, "Paste into roster");
    let parsed = null;
    const fmtD = (d) => `${dayNum(d)} ${new Date(d + "T12:00:00").toLocaleDateString("en-GB", { month: "short" })}`;
    const draw = function () {
      parsed = area.value.trim() ? parsePaste(area.value, month, people) : null;
      preview.replaceChildren();
      go.disabled = !parsed || !!parsed.error || !parsed.rows.length;
      if (!parsed) return;
      if (parsed.error) { preview.append(h("p", { class: "notice is-error" }, parsed.error)); return; }
      const um = Object.keys(parsed.unmatched);
      [
        h("p", null, h("b", null, `${parsed.rows.length} ${parsed.rows.length === 1 ? "entry" : "entries"}`),
          ` for ${parsed.dates.length} ${parsed.dates.length === 1 ? "day" : "days"} (${fmtD(parsed.dates[0])} – ${fmtD(parsed.dates[parsed.dates.length - 1])}).`),
        h("ul", { class: "re-paste-rows" }, dutyOrder(parsed.duties.map((d) => ({ duty: d }))).filter((d) => parsed.rowsUsed[d] !== undefined)
          .map((d) => h("li", null, h("b", null, d), ` – ${parsed.rowsUsed[d]}`))),
        um.length ? h("p", { class: "notice" }, "Not matched to a person, so left out: ", um.join(", "),
          ". Set their roster name on the People page (e.g. “Beggi”), then paste again – or add them by hand.") : null,
        parsed.multi.length ? h("div", { class: "notice is-error" }, h("b", null, "Check in Excel – more than one name in a cell, so left out:"),
          h("ul", { class: "re-paste-rows" }, parsed.multi.map((x) => h("li", null, x)))) : null,
        parsed.skipped.length ? h("p", { class: "fineprint" }, "Rows not recognised as a shift or duty, left out: " + parsed.skipped.join(", ") + ".") : null
      ].filter(Boolean).forEach((el) => preview.append(el));
    };
    const how = h("p", { class: "fineprint re-paste-how" });
    area.addEventListener("input", function () { how.textContent = ""; draw(); });
    area.addEventListener("paste", function (e) {
      const html = e.clipboardData && e.clipboardData.getData("text/html");
      if (!html || !/<table/i.test(html)) return;      // plain text: read as it is
      const res = excelHtmlToTsv(html);
      if (!res) return;
      e.preventDefault();
      area.value = res.tsv;
      how.textContent = "Read from Excel with its formatting: " +
        (res.merged ? `${res.merged} ${res.merged === 1 ? "cell" : "cells"} filled from merged or coloured spans` : "no merged or coloured spans") +
        (res.struck ? `, ${res.struck} crossed-out ${res.struck === 1 ? "name" : "names"} left out as cancelled.` : ".");
      draw();
    });
    go.addEventListener("click", async function () {
      if (!parsed || parsed.error) return;
      if (replace.checked && !confirm(`Clear everything on these ${parsed.dates.length} days (${fmtD(parsed.dates[0])} – ${fmtD(parsed.dates[parsed.dates.length - 1])}), in every row, and put the pasted roster in its place?`)) return;
      go.disabled = true; setStatus(st, "Saving…");
      try {
        let cleared = 0;
        if (replace.checked) {
          const del = await db.from("roster_entries").delete().in("work_date", parsed.dates).select("id");
          if (del.error) throw new Error(del.error.message);
          cleared = (del.data || []).length;
        }
        let added = 0;
        for (let i = 0; i < parsed.rows.length; i += 200) {
          const res = await db.from("roster_entries").upsert(parsed.rows.slice(i, i + 200), { onConflict: "work_date,duty,profile_id", ignoreDuplicates: true }).select("id");
          if (res.error) throw new Error(res.error.message);
          added += (res.data || []).length;
        }
        if (ctx.logEvent) await ctx.logEvent("roster_pasted", { days: parsed.dates.length, entries: added });
        notice = { local: true, paste: true, text: (replace.checked ? `Cleared ${cleared} old ${cleared === 1 ? "entry" : "entries"}, then pasted ` : "Pasted ") + `${added} ${added === 1 ? "entry" : "entries"} for ${parsed.dates.length} days.` + (Object.keys(parsed.unmatched).length ? ` Left out (not matched): ${Object.keys(parsed.unmatched).join(", ")}.` : "") + (parsed.multi.length ? ` Left out (more than one name in a cell): ${parsed.multi.length}.` : "") + " Publish when you’re ready." };
        rerender();
      } catch (e) { go.disabled = false; setStatus(st, e.message, true); }
    });
    return h("details", { class: "panel re-paste", open: pasteOpen, ontoggle: function () { pasteOpen = this.open; } },
      h("summary", null, "Paste from Excel"),
      h("p", { class: "fineprint" }, `Pastes into ${monthName(month)}. Copy a block of the Excel roster – any number of days – with the row of day numbers at the top and the shift names (0700-1900, BIKF Resp, Go to Boss …) in the first column. It is read like an uploaded file: a name merged or coloured across several days counts for each of them, and crossed-out names are left out.`),
      area, how,
      h("label", { class: "choice" }, replace, h("span", null, "Clear the pasted days first (every row), then add the pasted roster")),
      preview,
      h("div", { class: "row" }, go, h("button", { class: "btn btn-quiet", type: "button", onclick: () => { area.value = ""; draw(); } }, "Clear")),
      st);
  }

  // ------------------------------------------------------------------
  // Page
  // ------------------------------------------------------------------
  async function render(main, ctx, quiet) {
    const { h, fill, setStatus, db, state } = ctx;
    if (state.profile.role !== "management") { location.hash = "#/roster"; return; }
    if (!month) month = firstOfMonth(new Date());
    // Only show "Loading…" on first opening. After a change the old page stays
    // in place until the new one is ready, so the page does not jump.
    if (!quiet) fill(main, h("a", { class: "back-link", href: "#/roster" }, "Roster"), h("p", { class: "empty" }, "Loading the roster editor…"));

    const [pr, er, mr, pub] = await Promise.all([
      db.from("profiles").select("id, full_name, email, roster_names, station_codes, role, active").order("full_name"),
      db.from("roster_entries").select("id, work_date, duty, profile_id, note").gte("work_date", month).lte("work_date", lastDay(month)),
      db.from("roster_months").select("*").eq("month", month),
      db.from("rosters").select("sheets, uploaded_at").order("uploaded_at", { ascending: false }).limit(1)
    ]);
    if (er.error || mr.error) {
      fill(main, h("a", { class: "back-link", href: "#/roster" }, "Roster"),
        h("p", { class: "notice is-error" }, "The roster editor isn’t set up yet (database update 33)."));
      return;
    }
    const allPeople = pr.data || [];
    const people = allPeople.filter((p) => p.active);
    const names = displayNames(allPeople);
    const entries = er.data || [];
    const mrow = (mr.data || [])[0] || null;
    const days = daysIn(month);
    const scroller = () => document.scrollingElement || document.documentElement;
    const rerender = () => {
      keepScroll = { y: scroller().scrollTop, x: Array.from(main.querySelectorAll(".roster-wrap")).map((w) => w.scrollLeft) };
      return render(main, ctx, true);
    };
    const n = notice; notice = null;

    // --- month navigation
    const monthOpts = [];
    for (let i = -3; i <= 6; i++) monthOpts.push(shiftMonth(firstOfMonth(new Date()), i));
    if (monthOpts.indexOf(month) === -1) monthOpts.push(month);
    const pick = h("select", { id: "re-month", onchange: (e) => { month = e.target.value; sel.days.clear(); rerender(); } },
      monthOpts.sort().reverse().map((m) => h("option", { value: m, selected: m === month }, monthName(m))));
    const nav = h("div", { class: "re-nav" },
      h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Previous month", onclick: () => { month = shiftMonth(month, -1); sel.days.clear(); rerender(); } }, "‹"),
      h("label", { for: "re-month", class: "visually-hidden" }, "Month"), pick,
      h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Next month", onclick: () => { month = shiftMonth(month, 1); sel.days.clear(); rerender(); } }, "›"));

    // --- publishing status
    const visible = !!(mrow && mrow.visible);
    const changed = mrow && mrow.updated_at && (!mrow.published_at || mrow.updated_at > mrow.published_at);
    const pubStatus = h("p", { class: "status", role: "status" });
    const visBox = h("input", { type: "checkbox", id: "re-visible", checked: visible });
    visBox.addEventListener("change", async function () {
      const { error } = await db.from("roster_months").upsert({ month: month, visible: visBox.checked }, { onConflict: "month" });
      if (error) { setStatus(pubStatus, error.message, true); visBox.checked = !visBox.checked; return; }
      notice = { text: visBox.checked ? `${monthName(month)} will be shown to staff when you publish.` : `${monthName(month)} will be hidden from staff when you publish.` };
      rerender();
    });
    const pubBtn = h("button", { class: "btn", type: "button" }, "Publish changes");
    pubBtn.addEventListener("click", async function () {
      if (!confirm("Publish the roster? Staff will see every month marked “Visible to staff”, as it is now.")) return;
      pubBtn.disabled = true; setStatus(pubStatus, "Publishing…");
      try {
        const r = await publish(ctx);
        notice = { text: `Published: ${r.months.map(monthName).join(", ")}. Staff now see it on Home and the Roster page.` };
        rerender();
      } catch (e) { pubBtn.disabled = false; setStatus(pubStatus, e.message, true); }
    });
    const clearBtn = h("button", { class: "btn btn-danger", type: "button", disabled: !entries.length }, `Clear ${monthName(month).split(" ")[0]}`);
    clearBtn.addEventListener("click", async function () {
      if (!confirm(`Remove all ${entries.length} entries in ${monthName(month)} from the editor?\n\nStaff keep seeing the last published roster until you publish again, so you can clear, paste or rebuild the month, check it, then publish.`)) return;
      clearBtn.disabled = true; setStatus(pubStatus, "Clearing…");
      const res = await db.from("roster_entries").delete().gte("work_date", month).lte("work_date", lastDay(month)).select("id");
      if (res.error) { clearBtn.disabled = false; setStatus(pubStatus, res.error.message, true); return; }
      if (ctx.logEvent) await ctx.logEvent("roster_month_cleared", { month: month, entries: (res.data || []).length });
      notice = { text: `Cleared ${(res.data || []).length} entries from ${monthName(month)}. Staff still see the last published roster until you publish.` };
      rerender();
    });
    const statusPanel = h("section", { class: "panel roster-pub" + (changed && visible ? " panel-attention" : "") },
      h("div", { class: "row" },
        h("label", { class: "choice" }, visBox, h("span", null, h("b", null, "Visible to staff"), h("span", { class: "sub" }, "Untick while a month is still being planned."))),
        pubBtn, clearBtn),
      h("p", { class: "fineprint" },
        mrow && mrow.published_at ? `Last published ${when(mrow.published_at)} by ${mrow.published_by_name || "management"}. ` : "Not published yet. ",
        mrow && mrow.updated_at ? `Last changed ${when(mrow.updated_at)}${mrow.updated_by_name ? " by " + mrow.updated_by_name : ""}.` : ""),
      changed && visible ? h("p", { class: "notice" }, "This month has changes staff can’t see yet. Publish to update the roster on the portal.") : null,
      !visible && entries.length ? h("p", { class: "fineprint" }, "Staff can’t see this month. Tick “Visible to staff” and publish when it is ready.") : null,
      pubStatus);

    // --- assign panel
    const personSel = h("select", { id: "re-person", onchange: (e) => { sel.person = e.target.value; } },
      [h("option", { value: "" }, "Choose a person")].concat(people.map((p) =>
        h("option", { value: p.id, selected: sel.person === p.id }, `${p.full_name || p.email}${names[p.id] && fold(names[p.id]) !== fold(String(p.full_name || "").split(/\s+/)[0]) ? " (" + names[p.id] + ")" : ""}`))));
    const dutyBoxes = DUTIES.map((d) => {
      const box = h("input", { type: "checkbox", checked: sel.duties.has(d.key), onchange: (e) => { e.target.checked ? sel.duties.add(d.key) : sel.duties.delete(d.key); } });
      return h("label", { class: "choice choice-inline" }, box, h("span", null, d.key));
    });
    const dayBoxes = {};
    const cal = h("div", { class: "re-cal" },
      WEEKDAYS.map((w) => h("span", { class: "re-cal-h" }, w)),
      Array.from({ length: weekday(days[0]) }, () => h("span", { class: "re-cal-blank" })),
      days.map(function (d) {
        const box = h("input", { type: "checkbox", checked: sel.days.has(d), "aria-label": d, onchange: (e) => { e.target.checked ? sel.days.add(d) : sel.days.delete(d); } });
        dayBoxes[d] = box;
        const rc = window.IAARotation ? window.IAARotation.colour(d) : null;
        return h("label", { class: "re-cal-day" + (rc ? " rot-" + rc : "") + (d === iso(new Date()) ? " is-today" : ""), title: rc ? window.IAARotation.label[rc] + " shift" : null }, box, h("span", null, String(dayNum(d))));
      }));
    const setDays = (fn) => { days.forEach((d) => { const on = fn(d); dayBoxes[d].checked = on; on ? sel.days.add(d) : sel.days.delete(d); }); };
    const noteIn = h("input", { id: "re-note", type: "text", maxlength: 60, value: sel.note, placeholder: "Optional, e.g. until 1600", oninput: (e) => { sel.note = e.target.value; } });
    const aStatus = h("p", { class: "status", role: "status" });
    const check = () => {
      if (!sel.person) return "Choose a person.";
      if (!sel.duties.size) return "Tick at least one shift or duty.";
      if (!sel.days.size) return "Tick at least one day.";
      return null;
    };
    const addBtn = h("button", { class: "btn", type: "button" }, "Add to roster");
    addBtn.addEventListener("click", async function () {
      const msg = check(); if (msg) { setStatus(aStatus, msg, true); return; }
      const rows = [];
      Array.from(sel.days).sort().forEach((d) => sel.duties.forEach((duty) => rows.push({ work_date: d, duty: duty, profile_id: sel.person, note: sel.note.trim() || null })));
      // One person per row per day: anyone else already there is replaced.
      const others = entries.filter((e) => sel.days.has(e.work_date) && sel.duties.has(e.duty) && e.profile_id !== sel.person);
      if (others.length) {
        const list = others.slice(0, 6).map((e) => `${names[e.profile_id] || "?"} (${e.duty}, ${dayNum(e.work_date)})`).join(", ") + (others.length > 6 ? ` and ${others.length - 6} more` : "");
        if (!confirm(`Only one person per row per day. Replace ${list} with ${names[sel.person]}?`)) return;
        const del = await db.from("roster_entries").delete().in("id", others.map((e) => e.id)).select("id");
        if (del.error) { setStatus(aStatus, del.error.message, true); return; }
      }
      addBtn.disabled = true;
      const res = await db.from("roster_entries").upsert(rows, { onConflict: "work_date,duty,profile_id", ignoreDuplicates: true }).select("id");
      addBtn.disabled = false;
      if (res.error) { setStatus(aStatus, res.error.message, true); return; }
      const added = (res.data || []).length;
      const who = names[sel.person] || "";
      notice = { local: true, text: `Added ${who} to ${added} ${added === 1 ? "shift" : "shifts"}` + (others.length ? `, replacing ${others.length}` : "") + (rows.length > added ? ` (${rows.length - added} already on the roster).` : ".") + (visible ? " Publish when you’re ready." : "") };
      sel.days.clear();
      rerender();
    });
    const removeBtn = h("button", { class: "btn btn-quiet", type: "button" }, "Remove from these days");
    removeBtn.addEventListener("click", async function () {
      const msg = check(); if (msg) { setStatus(aStatus, msg, true); return; }
      if (!confirm(`Remove ${names[sel.person]} from the ticked duties on ${sel.days.size} ${sel.days.size === 1 ? "day" : "days"}?`)) return;
      const res = await db.from("roster_entries").delete().eq("profile_id", sel.person).in("work_date", Array.from(sel.days)).in("duty", Array.from(sel.duties)).select("id");
      if (res.error) { setStatus(aStatus, res.error.message, true); return; }
      notice = { local: true, text: `Removed ${(res.data || []).length} ${((res.data || []).length === 1) ? "entry" : "entries"} for ${names[sel.person]}.` };
      rerender();
    });
    const assign = h("section", { class: "panel" },
      h("h2", null, "Place someone on the roster"),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "re-person" }, "Person"), personSel),
        h("div", { class: "field" }, h("label", { for: "re-note" }, "Note"), noteIn)),
      h("fieldset", { class: "re-duties" }, h("legend", null, "Shifts and duties"),
        h("div", { class: "re-duty-group" }, h("span", { class: "sub" }, "Shifts"), DUTIES.map((d, i) => [d.key, dutyBoxes[i]]).filter((x) => isShift(x[0])).sort((a, b) => a[0].localeCompare(b[0])).map((x) => x[1])),
        h("div", { class: "re-duty-group" }, h("span", { class: "sub" }, "Responsible"), dutyBoxes.filter((b, i) => DUTIES[i].group !== "Shifts"))),
      h("fieldset", { class: "re-days" }, h("legend", null, `Days in ${monthName(month)}`),
        h("div", { class: "row row-tight" },
          h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => setDays(() => true) }, "All"),
          h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => setDays((d) => weekday(d) < 5) }, "Weekdays"),
          h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => setDays((d) => weekday(d) >= 5) }, "Weekends"),
          window.IAARotation ? h("button", { class: "btn btn-quiet btn-small rot-btn rot-green", type: "button", onclick: () => setDays((d) => window.IAARotation.colour(d) === "green") }, "Green days") : null,
          window.IAARotation ? h("button", { class: "btn btn-quiet btn-small rot-btn rot-orange", type: "button", onclick: () => setDays((d) => window.IAARotation.colour(d) === "orange") }, "Orange days") : null,
          h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => setDays(() => false) }, "Clear")),
        cal,
        window.IAARotation ? window.IAARotation.legend(h) : null),
      h("div", { class: "row" }, addBtn, removeBtn),
      aStatus);

    // --- coverage
    const doubled = [];
    dutyOrder(entries).forEach((duty) => days.forEach((day) => { const n2 = entries.filter((e) => e.work_date === day && e.duty === duty).length; if (n2 > 1) doubled.push(`${duty} on ${dayNum(day)}`); }));
    const missing = DUTIES.filter((d) => d.required).map((d) => [d.key, days.filter((day) => !entries.some((e) => e.work_date === day && e.duty === d.key))]).filter((x) => x[1].length);
    const coverage = h("section", { class: "panel" + (missing.length || doubled.length ? " panel-attention" : "") },
      h("h2", null, "Cover"),
      missing.length || doubled.length
        ? h("ul", { class: "attention-list" },
            missing.map(([k, ds]) => h("li", null, h("b", null, k), ` missing on ${ds.length === days.length ? "every day" : ds.map(dayNum).join(", ")}`)),
            doubled.length ? h("li", null, h("b", null, "More than one person in a cell: "), doubled.join(", "), " – remove one with ×") : null)
        : h("p", { class: "fineprint" }, "BIKF Resp, BIAR Resp and Management on duty are assigned every day this month."));

    // --- copy from the published roster
    const pubSheets = ((pub.data || [])[0] || {}).sheets || [];
    const pubHasMonth = pubSheets.some((s) => (s.blocks || []).some((b) => b.dates.some((d) => d.slice(0, 8) + "01" === month)));
    const copyPanel = !entries.length && pubHasMonth
      ? h("section", { class: "panel" },
          h("p", null, `The roster currently on the portal has ${monthName(month)}. Copy it here to edit it instead of starting from scratch.`),
          h("button", { class: "btn btn-quiet", type: "button", onclick: async function (e) {
            e.target.disabled = true;
            try {
              const r = await copyFromPublished(ctx, month, allPeople);
              notice = { text: `Copied ${r.added} entries from the published roster.` + (r.unmatched.length ? ` Names not matched to a person (add them by hand, or set their roster name on the People page): ${r.unmatched.join(", ")}.` : ""), isError: false };
              rerender();
            } catch (err) { e.target.disabled = false; alert(err.message); }
          } }, `Copy ${monthName(month)} from the published roster`))
      : null;

    // --- grid
    const gStatus = h("p", { class: "status", role: "status" });

    // Drag and drop: move a name to another cell (hold Alt/Option to copy),
    // drop it on someone else's name to swap them, or drag a name from the
    // row of people onto a cell to add them. Every drop can be undone.
    const short = (d) => `${dayNum(d)} ${monthName(month).split(" ")[0].slice(0, 3)}`;
    const place = (duty, d) => `${duty} on ${short(d)}`;
    const byId = {};
    entries.forEach((e) => { byId[e.id] = e; });
    let dragging = null;
    async function applyDrop(data, toDate, toDuty, ontoId, copy) {
      const who = names[data.profile_id] || "?";
      let res, text, undo;
      if (data.kind === "person") {
        res = await db.from("roster_entries").insert({ work_date: toDate, duty: toDuty, profile_id: data.profile_id }).select("id");
        const id = res.data && res.data[0] && res.data[0].id;
        text = `Added ${who} to ${place(toDuty, toDate)}.`;
        undo = async () => db.from("roster_entries").delete().eq("id", id);
      } else {
        const e = byId[data.id]; if (!e) return;
        if (e.work_date === toDate && e.duty === toDuty && !ontoId) return;   // dropped where it was
        const other = ontoId && ontoId !== e.id ? byId[ontoId] : null;
        if (other && !copy) {
          // swap the two people
          res = await db.from("roster_entries").update({ profile_id: other.profile_id }).eq("id", e.id);
          if (!res.error) res = await db.from("roster_entries").update({ profile_id: e.profile_id }).eq("id", other.id);
          text = `Swapped ${who} (${place(e.duty, e.work_date)}) and ${names[other.profile_id] || "?"} (${place(other.duty, other.work_date)}).`;
          undo = async () => { await db.from("roster_entries").update({ profile_id: e.profile_id }).eq("id", e.id); return db.from("roster_entries").update({ profile_id: other.profile_id }).eq("id", other.id); };
        } else if (copy) {
          res = await db.from("roster_entries").insert({ work_date: toDate, duty: toDuty, profile_id: e.profile_id, note: e.note }).select("id");
          const id = res.data && res.data[0] && res.data[0].id;
          text = `Copied ${who} to ${place(toDuty, toDate)}.`;
          undo = async () => db.from("roster_entries").delete().eq("id", id);
        } else {
          res = await db.from("roster_entries").update({ work_date: toDate, duty: toDuty }).eq("id", e.id);
          text = `Moved ${who} from ${place(e.duty, e.work_date)} to ${place(toDuty, toDate)}.`;
          undo = async () => db.from("roster_entries").update({ work_date: e.work_date, duty: e.duty }).eq("id", e.id);
        }
      }
      if (res && res.error) {
        const dup = /duplicate|unique/i.test(res.error.message);
        notice = { local: true, grid: true, isError: true, text: dup ? `${who} is already on ${place(toDuty, toDate)}.` : res.error.message };
      } else {
        notice = { local: true, grid: true, text: text, undo: undo };
      }
      rerender();
    }
    function dropTarget(td, d, duty) {
      td.dataset.date = d; td.dataset.duty = duty;
      td.addEventListener("dragover", (ev) => { if (!dragging) return; ev.preventDefault(); ev.dataTransfer.dropEffect = dragging.kind === "person" || ev.altKey ? "copy" : "move"; td.classList.add("is-drop"); });
      td.addEventListener("dragleave", (ev) => { if (!td.contains(ev.relatedTarget)) td.classList.remove("is-drop"); });
      td.addEventListener("drop", (ev) => {
        ev.preventDefault(); td.classList.remove("is-drop");
        const data = dragging; dragging = null; if (!data) return;
        const chip = ev.target.closest && ev.target.closest(".re-chip[data-id]");
        applyDrop(data, d, duty, chip ? +chip.dataset.id : null, ev.altKey);
      });
    }
    function draggable(node, data) {
      node.setAttribute("draggable", "true");
      node.addEventListener("dragstart", (ev) => {
        dragging = data;
        ev.dataTransfer.effectAllowed = "copyMove";
        try { ev.dataTransfer.setData("text/plain", names[data.profile_id] || ""); } catch (e) { /* older browsers */ }
        node.classList.add("is-dragging");
        main.classList.add("re-dragging");
      });
      node.addEventListener("dragend", () => { node.classList.remove("is-dragging"); main.classList.remove("re-dragging"); dragging = null;
        main.querySelectorAll(".is-drop").forEach((x) => x.classList.remove("is-drop")); });
      return node;
    }
    const palette = h("div", { class: "re-palette", "aria-label": "Drag a name onto the roster" },
      h("span", { class: "sub" }, "Drag onto the roster:"),
      people.slice().sort((a, b) => String(names[a.id]).localeCompare(String(names[b.id])))
        .map((p) => draggable(h("span", { class: "re-chip re-person", title: "Drag onto a cell to add " + names[p.id] }, names[p.id] || p.email), { kind: "person", profile_id: p.id })));
    const order = dutyOrder(entries);
    const grid = (dates) => h("div", { class: "table-wrap roster-wrap" }, h("table", { class: "roster-grid re-grid" },
      h("thead", null, h("tr", null, h("th", null, ""), dates.map((d) => h("th", { class: (d === iso(new Date()) ? "is-today " : "") + (window.IAARotation && window.IAARotation.colour(d) ? "rot-" + window.IAARotation.colour(d) : "") },
        h("span", { class: "sub" }, WEEKDAYS[weekday(d)]), String(dayNum(d)))))),
      h("tbody", null, order.map(function (duty) {
        const req = DUTIES.some((x) => x.key === duty && x.required);
        return h("tr", null, h("th", { scope: "row" }, duty), dates.map(function (d) {
          const here = entries.filter((e) => e.work_date === d && e.duty === duty)
            .sort((a, b) => String(names[a.profile_id]).localeCompare(String(names[b.profile_id])));
          const td = h("td", { class: !here.length && req ? "is-missing" : here.length > 1 ? "is-doubled" : null, title: here.length > 1 ? "More than one person – remove one" : null },
            here.length ? here.map((e) => draggable(h("span", { class: "re-chip", "data-id": String(e.id), title: "Drag to move · Alt/Option to copy · drop on a name to swap" }, (names[e.profile_id] || "?") + (e.note ? " (" + e.note + ")" : ""),
              h("button", { type: "button", class: "re-x", "aria-label": `Remove ${names[e.profile_id]} from ${duty} on ${d}`, onclick: async function () {
                this.disabled = true;
                const { error } = await db.from("roster_entries").delete().eq("id", e.id);
                notice = error ? { text: error.message, isError: true, grid: true, local: true }
                  : { local: true, text: `Removed ${names[e.profile_id] || "?"} from ${duty} on ${dayNum(d)} ${monthName(month).split(" ")[0]}.`, grid: true };
                rerender();
              } }, "×")), { kind: "entry", id: e.id, profile_id: e.profile_id }))
              : req ? "–" : "");
          dropTarget(td, d, duty);
          return td;
        }));
      }))));

    fill(main,
      h("a", { class: "back-link", href: "#/roster" }, "Roster"),
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Edit roster"), h("p", null, "Place people on shifts and duties, then publish so staff see it.")),
        nav),
      n && !n.local ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      statusPanel, copyPanel, pastePanel(ctx, allPeople, names, rerender), assign, coverage,
      h("section", { class: "panel" }, h("h2", null, monthName(month)),
        palette, gStatus,
        grid(days.slice(0, 15)), grid(days.slice(15)),
        h("p", { class: "fineprint" }, "Drag a name to move it, hold Alt (Option on a Mac) while dropping to copy it, or drop it on another name to swap the two. Drag from the names above to add someone. Select × to remove someone. A red dash means nobody is assigned to a duty that is needed every day.")));
    if (n) {
      if (n.paste) { const ps = main.querySelector(".re-paste .status"); if (ps) setStatus(ps, n.text, !!n.isError); }
      else setStatus(aStatus, n.text, !!n.isError);
      if (n.grid) setStatus(gStatus, n.text, !!n.isError);
      if (n.grid && n.undo) {
        const u = h("button", { class: "btn btn-quiet btn-small re-undo", type: "button" }, "Undo");
        u.addEventListener("click", async () => {
          u.disabled = true;
          const r = await n.undo();
          notice = r && r.error ? { local: true, grid: true, isError: true, text: r.error.message } : { local: true, grid: true, text: "Undone." };
          rerender();
        });
        gStatus.append(" ", u);
      }
    }
    if (keepScroll) {
      const k = keepScroll; keepScroll = null;
      main.querySelectorAll(".roster-wrap").forEach((w, i) => { if (k.x[i] != null) w.scrollLeft = k.x[i]; });
      scroller().scrollTop = k.y;
    }
  }

  window.IAARosterEdit = { render: render, buildSheets: buildSheets, displayNames: displayNames, DUTIES: DUTIES };
})();
