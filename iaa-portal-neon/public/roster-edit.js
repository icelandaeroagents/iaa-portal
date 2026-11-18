/* Iceland Aero Agents – Staff Portal
   Roster editor (management): build the roster in the portal.
   – Pick a person, tick one or more duties and as many days as needed, Add.
   – Shifts 0700-1900, 0800-2000, 0800-1500, 1100-2300, plus BIKF Resp,
     BIAR Resp and Management on duty (these three are needed every day).
   – Changes are a draft. "Publish changes" writes what staff see, in the
     same form as an uploaded Excel roster, so Home and the Roster page
     work as before. Each month has its own "Visible to staff" switch.
   Needs database update 33. */
(function () {
  "use strict";

  const DUTIES = [
    { key: "0700-1900", group: "Shifts" },
    { key: "0800-2000", group: "Shifts" },
    { key: "0800-1500", group: "Shifts" },
    { key: "1100-2300", group: "Shifts" },
    { key: "BIKF Resp", group: "Responsible", required: true },
    { key: "BIAR Resp", group: "Responsible", required: true },
    { key: "Management on duty", group: "Responsible", required: true }
  ];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let month = null;            // "YYYY-MM-01"
  let sel = { person: "", duties: new Set(), days: new Set(), note: "" };
  let notice = null;

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
  function dutyOrder(entries) {
    const keys = DUTIES.map((d) => d.key);
    entries.forEach((e) => { if (keys.indexOf(e.duty) === -1) keys.push(e.duty); });
    return keys;
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
    if (/manag|stjorn|duty manager/.test(t)) return "Management on duty";
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
  // Page
  // ------------------------------------------------------------------
  async function render(main, ctx) {
    const { h, fill, setStatus, db, state } = ctx;
    if (state.profile.role !== "management") { location.hash = "#/roster"; return; }
    if (!month) month = firstOfMonth(new Date());
    fill(main, h("a", { class: "back-link", href: "#/roster" }, "Roster"), h("p", { class: "empty" }, "Loading the roster editor…"));

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
    const rerender = () => render(main, ctx);
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
    const statusPanel = h("section", { class: "panel roster-pub" + (changed && visible ? " panel-attention" : "") },
      h("div", { class: "row" },
        h("label", { class: "choice" }, visBox, h("span", null, h("b", null, "Visible to staff"), h("span", { class: "sub" }, "Untick while a month is still being planned."))),
        pubBtn),
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
      addBtn.disabled = true;
      const res = await db.from("roster_entries").upsert(rows, { onConflict: "work_date,duty,profile_id", ignoreDuplicates: true }).select("id");
      addBtn.disabled = false;
      if (res.error) { setStatus(aStatus, res.error.message, true); return; }
      const added = (res.data || []).length;
      const who = names[sel.person] || "";
      notice = { text: `Added ${who} to ${added} ${added === 1 ? "shift" : "shifts"}` + (rows.length > added ? ` (${rows.length - added} already on the roster).` : ".") + (visible ? " Publish when you’re ready." : "") };
      sel.days.clear();
      rerender();
    });
    const removeBtn = h("button", { class: "btn btn-quiet", type: "button" }, "Remove from these days");
    removeBtn.addEventListener("click", async function () {
      const msg = check(); if (msg) { setStatus(aStatus, msg, true); return; }
      if (!confirm(`Remove ${names[sel.person]} from the ticked duties on ${sel.days.size} ${sel.days.size === 1 ? "day" : "days"}?`)) return;
      const res = await db.from("roster_entries").delete().eq("profile_id", sel.person).in("work_date", Array.from(sel.days)).in("duty", Array.from(sel.duties)).select("id");
      if (res.error) { setStatus(aStatus, res.error.message, true); return; }
      notice = { text: `Removed ${(res.data || []).length} ${((res.data || []).length === 1) ? "entry" : "entries"} for ${names[sel.person]}.` };
      rerender();
    });
    const assign = h("section", { class: "panel" },
      h("h2", null, "Place someone on the roster"),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "re-person" }, "Person"), personSel),
        h("div", { class: "field" }, h("label", { for: "re-note" }, "Note"), noteIn)),
      h("fieldset", { class: "re-duties" }, h("legend", null, "Shifts and duties"),
        h("div", { class: "re-duty-group" }, h("span", { class: "sub" }, "Shifts"), dutyBoxes.slice(0, 4)),
        h("div", { class: "re-duty-group" }, h("span", { class: "sub" }, "Responsible"), dutyBoxes.slice(4))),
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
    const missing = DUTIES.filter((d) => d.required).map((d) => [d.key, days.filter((day) => !entries.some((e) => e.work_date === day && e.duty === d.key))]).filter((x) => x[1].length);
    const coverage = h("section", { class: "panel" + (missing.length ? " panel-attention" : "") },
      h("h2", null, "Cover"),
      missing.length
        ? h("ul", { class: "attention-list" }, missing.map(([k, ds]) => h("li", null, h("b", null, k), ` missing on ${ds.length === days.length ? "every day" : ds.map(dayNum).join(", ")}`)))
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
    const order = dutyOrder(entries);
    const grid = (dates) => h("div", { class: "table-wrap roster-wrap" }, h("table", { class: "roster-grid re-grid" },
      h("thead", null, h("tr", null, h("th", null, ""), dates.map((d) => h("th", { class: (d === iso(new Date()) ? "is-today " : "") + (window.IAARotation && window.IAARotation.colour(d) ? "rot-" + window.IAARotation.colour(d) : "") },
        h("span", { class: "sub" }, WEEKDAYS[weekday(d)]), String(dayNum(d)))))),
      h("tbody", null, order.map(function (duty) {
        const req = DUTIES.some((x) => x.key === duty && x.required);
        return h("tr", null, h("th", { scope: "row" }, duty), dates.map(function (d) {
          const here = entries.filter((e) => e.work_date === d && e.duty === duty)
            .sort((a, b) => String(names[a.profile_id]).localeCompare(String(names[b.profile_id])));
          return h("td", { class: !here.length && req ? "is-missing" : null },
            here.length ? here.map((e) => h("span", { class: "re-chip" }, (names[e.profile_id] || "?") + (e.note ? " (" + e.note + ")" : ""),
              h("button", { type: "button", class: "re-x", "aria-label": `Remove ${names[e.profile_id]} from ${duty} on ${d}`, onclick: async function () {
                const { error } = await db.from("roster_entries").delete().eq("id", e.id);
                notice = error ? { text: error.message, isError: true } : null; rerender();
              } }, "×")))
              : req ? "–" : "");
        }));
      }))));

    fill(main,
      h("a", { class: "back-link", href: "#/roster" }, "Roster"),
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Edit roster"), h("p", null, "Place people on shifts and duties, then publish so staff see it.")),
        nav),
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      statusPanel, copyPanel, assign, coverage,
      h("section", { class: "panel" }, h("h2", null, monthName(month)),
        grid(days.slice(0, 15)), grid(days.slice(15)),
        h("p", { class: "fineprint" }, "Select × to remove someone. A red dash means nobody is assigned to a duty that is needed every day.")));
  }

  window.IAARosterEdit = { render: render, buildSheets: buildSheets, displayNames: displayNames, DUTIES: DUTIES };
})();
