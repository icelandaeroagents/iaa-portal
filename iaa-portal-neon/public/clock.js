/* Iceland Aero Agents – Staff Portal
   Time clock (replaces Tímon): clock in and out on the Home page, lunches
   (recorded and counted, not deducted), My hours, and for management the
   Team view with corrections and the monthly Excel export.
   Worked time = clock-out − clock-in. Up to 12 hours on a shift is the
   shift, anything beyond 12 hours is additional hours.
   The phone's location is checked at clock-in and clock-out only. Only the
   result is saved (which airport, or how far away) – never coordinates.
   Needs database update 44. */
(function () {
  "use strict";

  // General airport areas that are accepted (centre of each airport, radius in km).
  const AIRPORTS = [
    { code: "BIRK", name: "Reykjavík Airport", lat: 64.1300, lon: -21.9406, km: 2.5 },
    { code: "BIKF", name: "Keflavík Airport", lat: 63.9850, lon: -22.6056, km: 4 },
    { code: "BIAR", name: "Akureyri Airport", lat: 65.6600, lon: -18.0728, km: 2.5 }
  ];
  const SHIFT_MIN = 12 * 60;           // minutes in a full shift
  const LUNCH_PROMPT_AFTER = 6 * 60;   // ask about lunch at clock-out after this many minutes
  const FORGOT_AFTER = 13 * 60;        // management are told after this many minutes on the clock
  const TZ = "Atlantic/Reykjavik";

  let month = null;      // "2026-11"
  let teamOpen = {};     // person id → expanded in the Team view
  let tick = null;

  // ---------- small helpers ----------
  const pad = (n) => String(n).padStart(2, "0");
  function hm(min) {
    if (min === null || min === undefined) return "–";
    const m = Math.max(0, Math.round(min));
    const hh = Math.floor(m / 60), mm = m % 60;
    return hh ? `${hh} h${mm ? " " + mm + " min" : ""}` : `${mm} min`;
  }
  const dec = (min) => Math.round((min || 0) / 60 * 100) / 100;   // 12.5 for the export
  function clock(ts) { return ts ? new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "–"; }
  function dayLabel(ts) { return new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }); }
  function thisMonth() { return new Date().toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7); }
  function monthLabel(m) { return new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }); }
  function shiftMonth(m, n) { const d = new Date(m + "-15T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); }
  function daysIn(m) { return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); }
  const dayOf = (ts) => +new Date(ts).toLocaleDateString("en-CA", { timeZone: TZ }).slice(8, 10);
  const hrs = (min) => { const v = Math.round((min || 0) / 6) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };   // 12, 13.4
  function monthRange(m) { return [m + "-01T00:00:00Z", shiftMonth(m, 1) + "-01T00:00:00Z"]; }
  // Iceland is on UTC all year, so a datetime-local value is UTC.
  const toLocalInput = (ts) => (ts ? new Date(ts).toISOString().slice(0, 16) : "");
  const fromLocalInput = (v) => (v ? new Date(v + ":00Z").toISOString() : null);
  function minutesSince(ts) { return (Date.now() - new Date(ts).getTime()) / 60000; }
  const lunchWord = (n) => (n === 1 ? "1 lunch" : `${n} lunches`);
  function where(s, dir) {
    const st = s[dir + "_station"], ok = s[dir + "_confirmed"], km = s[dir + "_distance_km"], why = s[dir + "_reason"];
    if (s[dir + "_via"]) return s[dir + "_via"];
    if (ok) return st || "Confirmed";
    if (ok === null || ok === undefined) return "–";
    return "⚠ " + (km != null ? `${km} km from ${st || "nearest airport"}` : "location not available") + (why ? ` – “${why}”` : "");
  }

  // ---------- location ----------
  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // Resolves to { confirmed, station, km, message } – only these are saved.
  function locate() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ confirmed: false, station: null, km: null, message: "This device can’t share its location." });
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          const slack = Math.min((accuracy || 0) / 1000, 1.5);   // allow for an inaccurate fix, up to 1.5 km
          let best = null;
          AIRPORTS.forEach((a) => {
            const d = distanceKm(latitude, longitude, a.lat, a.lon);
            if (!best || d - a.km < best.d - best.a.km) best = { a, d };
          });
          const inside = best.d - slack <= best.a.km;
          resolve({
            confirmed: inside, station: best.a.code, km: Math.round(best.d * 10) / 10,
            message: inside ? `At ${best.a.code}` : `You seem to be ${Math.round(best.d * 10) / 10} km from ${best.a.code} (${best.a.name}).`
          });
        },
        (err) => resolve({ confirmed: false, station: null, km: null,
          message: err.code === 1 ? "Location isn’t allowed for the portal on this device." : "Your location couldn’t be found just now." }),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  // "Add a comment" link that opens a box (for example "Forgot to clock in – started at 06:00").
  function commentControl(h, placeholder) {
    const box = h("input", { type: "text", maxlength: "300", class: "clock-comment", placeholder: placeholder, hidden: true, "aria-label": "Comment for management" });
    const link = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Add a comment");
    link.addEventListener("click", () => { box.hidden = false; link.hidden = true; box.focus(); });
    return { box, link, value: () => box.value.trim() || null };
  }

  // ======================================================================
  // Home page card
  // ======================================================================
  // Append children, skipping empty ones (the browser's own append would print "null").
  function appendAll(el, ...kids) { kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false) el.append(k); }); return el; }

  async function homePanel(ctx, rerender) {
    const { h, db, state } = ctx;
    const me = state.profile.id;
    const r = await db.from("time_shift_hours").select("*").eq("profile_id", me).is("clock_out", null).limit(1);
    if (r.error) return null;   // update 44 not installed yet
    const open = (r.data || [])[0] || null;
    let lunches = [];
    if (open) {
      const lr = await db.from("time_lunches").select("*").eq("shift_id", open.id).order("added_at", { ascending: true });
      lunches = lr.data || [];
    }
    const status = h("p", { class: "status", role: "status" });
    const area = h("div", { class: "clock-ask" });
    const panel = h("section", { class: "panel clock-panel" + (open ? " is-on" : ""), "aria-labelledby": "clock-h" }, h("h2", { id: "clock-h" }, "Time clock"));

    // Asks for a reason when the location isn't confirmed. Resolves to {loc, reason} or null.
    function withLocation(verb) {
      return new Promise(async (resolve) => {
        // Management don't need a location check (database update 49).
        if (ctx.state.profile.role === "management") {
          return resolve({ loc: { confirmed: false, station: null, km: null }, reason: "Management – no location check" });
        }
        ctx.setStatus(status, "Checking your location…");
        const loc = await locate();
        if (loc.confirmed) { ctx.setStatus(status, ""); return resolve({ loc, reason: null }); }
        ctx.setStatus(status, "");
        const why = h("input", { type: "text", maxlength: "300", placeholder: "e.g. picking up crew in town, phone location off" });
        const go = h("button", { class: "btn", type: "button" }, verb + " anyway");
        const cancel = h("button", { class: "btn btn-quiet", type: "button" }, "Cancel");
        area.replaceChildren(
          h("p", { class: "notice" }, `Your location couldn’t be confirmed at BIRK, BIKF or BIAR. ${loc.message} You can still ${verb.toLowerCase()} – please say why. Management will see it.`),
          h("label", { class: "field" }, h("span", null, "Reason"), why),
          h("div", { class: "row" }, go, cancel));
        why.focus();
        go.addEventListener("click", () => {
          if (!why.value.trim()) { ctx.setStatus(status, "Please give a reason.", true); return; }
          area.replaceChildren(); resolve({ loc, reason: why.value.trim() });
        });
        cancel.addEventListener("click", () => { area.replaceChildren(); resolve(null); });
      });
    }

    if (!open) {
      const lunchNow = h("input", { type: "checkbox" });
      const note = commentControl(h, "e.g. Forgot to clock in – started at 06:00");
      const btn = h("button", { class: "btn", type: "button" }, "Clock in");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const got = await withLocation("Clock in");
        if (!got) { btn.disabled = false; return; }
        ctx.setStatus(status, "Clocking in…");
        const ins = await db.from("time_shifts").insert({
          in_station: got.loc.station, in_distance_km: got.loc.km, in_confirmed: got.loc.confirmed, in_reason: got.reason,
          staff_note: note.value()
        }).select("id");
        if (ins.error) { btn.disabled = false; ctx.setStatus(status, ins.error.message, true); return; }
        const id = ins.data && ins.data[0] && ins.data[0].id;
        if (id && lunchNow.checked) await db.from("time_lunches").insert({ shift_id: id, kind: "at clock-in" });
        rerender();
      });
      appendAll(panel, 
        h("p", null, "You’re not clocked in."),
        h("div", { class: "row clock-row" }, btn, h("label", { class: "clock-check" }, lunchNow, " Add lunch now"), note.link),
        note.box,
        area, status,
        h("p", { class: "fineprint" }, ctx.state.profile.role === "management"
          ? "As management, your location isn’t checked when you clock in and out."
          : "Your location is checked once when you clock in and out, to confirm you’re at BIRK, BIKF or BIAR. Only the result is saved, never where you were."));
      return panel;
    }

    // ---- clocked in ----
    const worked = h("b");
    const update = () => { worked.textContent = hm(minutesSince(open.clock_in)); };
    update();
    if (tick) clearInterval(tick);
    tick = setInterval(() => { if (!document.body.contains(worked)) { clearInterval(tick); tick = null; return; } update(); }, 30000);

    const lunchLine = h("p", null, "Lunch: ",
      lunches.length ? lunches.map((l) => `added ${clock(l.added_at)}`).join(", ") : "none yet");
    const addLunch = h("button", { class: "btn btn-quiet", type: "button" }, lunches.length ? "Add another lunch" : "Add lunch");
    const undo = lunches.length ? h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Remove last lunch") : null;
    const out = h("button", { class: "btn", type: "button" }, "Clock out");
    const outNote = commentControl(h, "e.g. Forgot to clock out – finished at 19:00");

    addLunch.addEventListener("click", async () => {
      addLunch.disabled = true;
      const r2 = await db.from("time_lunches").insert({ shift_id: open.id, kind: "added" });
      if (r2.error) { addLunch.disabled = false; ctx.setStatus(status, r2.error.message, true); return; }
      rerender();
    });
    if (undo) undo.addEventListener("click", async () => {
      undo.disabled = true;
      const r2 = await db.from("time_lunches").delete().eq("id", lunches[lunches.length - 1].id);
      if (r2.error) { undo.disabled = false; ctx.setStatus(status, r2.error.message, true); return; }
      rerender();
    });

    async function doClockOut(withLunch) {
      out.disabled = true;
      const got = await withLocation("Clock out");
      if (!got) { out.disabled = false; return; }
      ctx.setStatus(status, "Clocking out…");
      if (withLunch) await db.from("time_lunches").insert({ shift_id: open.id, kind: "added" });
      const u = await db.from("time_shifts").update({
        clock_out: new Date().toISOString(), out_station: got.loc.station, out_distance_km: got.loc.km,
        out_confirmed: got.loc.confirmed, out_reason: got.reason,
        staff_note: outNote.value()
      }).eq("id", open.id);
      if (u.error) { out.disabled = false; ctx.setStatus(status, u.error.message, true); return; }
      rerender();
    }
    out.addEventListener("click", () => {
      const soFar = minutesSince(open.clock_in);
      if (soFar >= LUNCH_PROMPT_AFTER && !lunches.length) {
        const add = h("button", { class: "btn", type: "button" }, "Yes – add lunch and clock out");
        const none = h("button", { class: "btn btn-quiet", type: "button" }, "No lunch – clock out");
        const back = h("button", { class: "btn btn-quiet", type: "button" }, "Cancel");
        area.replaceChildren(h("p", { class: "notice" }, "No lunch is recorded on this shift. Did you have lunch?"), h("div", { class: "row" }, add, none, back));
        add.addEventListener("click", () => { area.replaceChildren(); doClockOut(true); });
        none.addEventListener("click", () => { area.replaceChildren(); doClockOut(false); });
        back.addEventListener("click", () => area.replaceChildren());
        return;
      }
      doClockOut(false);
    });

    appendAll(panel, 
      h("p", { class: "clock-now" }, `Clocked in since ${clock(open.clock_in)}`, open.clock_in && new Date(open.clock_in).toDateString() !== new Date().toDateString() ? ` (${dayLabel(open.clock_in)})` : "",
        ` · ${open.in_confirmed ? open.in_station : /^Management/.test(open.in_reason || "") ? "no location check" : "location not confirmed"} · on the clock `, worked),
      lunchLine,
      open.staff_note ? h("p", { class: "fineprint" }, "Your comment: “" + open.staff_note + "”") : null,
      h("div", { class: "row clock-row" }, addLunch, undo, out, outNote.link),
      outNote.box,
      area, status);
    return panel;
  }

  // ======================================================================
  // Hours page (#/hours, #/hours/team)
  // ======================================================================
  async function render(main, ctx) {
    if (!month) month = thisMonth();
    const team = /^#\/hours\/team/.test(location.hash) && ctx.state.profile.role === "management";
    return team ? teamPage(main, ctx) : myPage(main, ctx);
  }

  function tabs(ctx, active) {
    if (ctx.state.profile.role !== "management") return null;
    const h = ctx.h;
    return h("nav", { class: "tabs", "aria-label": "Hours" },
      h("a", { href: "#/hours", "aria-current": active === "me" ? "page" : null }, "My hours"),
      h("a", { href: "#/hours/team", "aria-current": active === "team" ? "page" : null }, "Team"));
  }

  function monthNav(ctx, redraw) {
    const h = ctx.h;
    const prev = h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Previous month" }, "‹");
    const next = h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Next month" }, "›");
    prev.addEventListener("click", () => { month = shiftMonth(month, -1); redraw(); });
    next.addEventListener("click", () => { month = shiftMonth(month, 1); redraw(); });
    if (month >= thisMonth()) next.disabled = true;
    return h("div", { class: "row clock-month" }, prev, h("b", null, monthLabel(month)), next);
  }

  function totals(rows) {
    const done = rows.filter((s) => s.clock_out);
    return {
      shifts: done.length,
      worked: done.reduce((t, s) => t + (s.worked_minutes || 0), 0),
      shift: done.reduce((t, s) => t + (s.shift_minutes || 0), 0),
      extra: done.reduce((t, s) => t + (s.additional_minutes || 0), 0),
      lunches: done.reduce((t, s) => t + (s.lunches || 0), 0),
      flagged: rows.filter((s) => !s.reviewed).length
    };
  }
  function stat(h, n, label, cls) { return h("div", { class: "stat " + (cls || "") }, h("span", { class: "stat-n" }, String(n)), h("span", { class: "stat-label" }, label)); }

  // ---------------- My hours ----------------
  async function myPage(main, ctx) {
    const { h, fill, pageHead, db, state } = ctx;
    const redraw = () => myPage(main, ctx);
    fill(main, pageHead("Hours"), tabs(ctx, "me"), h("p", { class: "empty" }, "Loading…"));
    const [from, to] = monthRange(month);
    const r = await db.from("time_shift_hours").select("*").eq("profile_id", state.profile.id).gte("clock_in", from).lt("clock_in", to).order("clock_in", { ascending: true });
    if (r.error) { fill(main, pageHead("Hours"), h("p", { class: "notice is-error" }, "The time clock isn’t set up yet (database update 44).")); return; }
    const rows = r.data || [];
    const t = totals(rows);
    const status = h("p", { class: "status", role: "status" });

    const table = rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table clock-table" },
      h("thead", null, h("tr", null, ["Date", "In", "Out", "Lunch", "Worked", "Additional", "Location", "Note to management"].map((x) => h("th", null, x)))),
      h("tbody", null, rows.map((s) => {
        const noteCell = h("td", null);
        const showNote = () => {
          const btn = h("button", { class: "btn btn-quiet btn-small", type: "button" }, s.staff_note ? "Edit note" : "Ask for a correction");
          btn.addEventListener("click", () => {
            const input = h("textarea", { rows: "2", maxlength: "500" }, s.staff_note || "");
            const save = h("button", { class: "btn btn-small", type: "button" }, "Send");
            save.addEventListener("click", async () => {
              save.disabled = true;
              const u = await db.from("time_shifts").update({ staff_note: input.value.trim() || null }).eq("id", s.id);
              if (u.error) { save.disabled = false; ctx.setStatus(status, u.error.message, true); return; }
              redraw();
            });
            noteCell.replaceChildren(input, save);
            input.focus();
          });
          noteCell.replaceChildren();
          if (s.staff_note) noteCell.append(h("span", { class: "clock-note" }, s.staff_note));
          noteCell.append(btn);
        };
        showNote();
        return h("tr", { class: s.clock_out ? "" : "is-open" },
          h("td", null, dayLabel(s.clock_in)),
          h("td", null, clock(s.clock_in)),
          h("td", null, s.clock_out ? clock(s.clock_out) : h("b", null, "on shift")),
          h("td", null, s.lunches ? (s.lunches === 1 ? "Yes" : String(s.lunches)) : "–"),
          h("td", null, s.clock_out ? hm(s.worked_minutes) : "–"),
          h("td", null, s.additional_minutes ? h("b", null, hm(s.additional_minutes)) : "–"),
          h("td", null, where(s, "in"), s.clock_out ? h("br") : null, s.clock_out ? where(s, "out") : null,
            s.edited_by_name ? h("span", { class: "fineprint" }, h("br"), `Corrected by ${s.edited_by_name}`) : null),
          noteCell);
      })))) : h("p", { class: "empty" }, "No shifts this month.");

    // Forgot to clock in and out altogether: ask management to add the shift.
    const rq = await db.from("time_requests").select("*").eq("profile_id", state.profile.id).order("created_at", { ascending: false }).limit(20);
    const myReqs = rq.error ? null : (rq.data || []);
    const reqPanel = myReqs === null ? null : requestPanel(ctx, myReqs, redraw);

    const locBtn = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Check my location");
    const locOut = h("p", { class: "status", role: "status" });
    locBtn.addEventListener("click", async () => {
      locBtn.disabled = true; ctx.setStatus(locOut, "Checking…");
      const loc = await locate();
      locBtn.disabled = false;
      if (loc.confirmed) ctx.setStatus(locOut, `✓ Accepted: at ${loc.station} (${loc.km} km from the airport centre). Clocking in here would be confirmed.`, false, true);
      else ctx.setStatus(locOut, `Not accepted here. ${loc.message} You could still clock in with a reason.`, true);
    });

    fill(main, pageHead("Hours", "Your shifts, lunch and hours. Clock in and out on the Home page."),
      tabs(ctx, "me"),
      monthNav(ctx, redraw),
      h("div", { class: "stat-grid" },
        stat(h, t.shifts, "Shifts"),
        stat(h, hm(t.worked), "Hours worked"),
        stat(h, hm(t.extra), "Additional hours (beyond 12 h)", t.extra ? "is-warn" : ""),
        stat(h, t.lunches, "Lunches")),
      table, status, reqPanel,
      h("div", { class: "row clock-row" }, locBtn), locOut,
      h("p", { class: "fineprint" }, "Worked = clock-out − clock-in. Up to 12 hours on a shift counts as the shift; anything beyond 12 hours is additional hours. Lunches are recorded, not deducted. If something is wrong, ask for a correction – management will fix it and the change is kept in a history."));
  }

  const REQ_STATUS = { pending: ["Waiting for management", "chip-leave-pending"], approved: ["Approved – shift added", "chip-leave-approved"], declined: ["Declined", "chip-leave-declined"], cancelled: ["Cancelled", "chip-leave-cancelled"] };
  const reqChip = (h, r) => h("span", { class: "chip " + (REQ_STATUS[r.status] || ["", ""])[1] }, (REQ_STATUS[r.status] || [r.status])[0]);
  const reqWhen = (r) => { const sameDay = new Date(r.clock_in).toDateString() === new Date(r.clock_out).toDateString();
    return `${dayLabel(r.clock_in)} ${clock(r.clock_in)}–${sameDay ? "" : dayLabel(r.clock_out) + " "}${clock(r.clock_out)} · ${hm((new Date(r.clock_out) - new Date(r.clock_in)) / 60000)}${r.lunches ? " · " + (r.lunches === 1 ? "1 lunch" : r.lunches + " lunches") : ""}`; };

  function requestPanel(ctx, reqs, redraw) {
    const { h, db } = ctx;
    const date = h("input", { type: "date", max: new Date().toLocaleDateString("en-CA", { timeZone: TZ }) });
    const start = h("input", { type: "time", value: "07:00" });
    const end = h("input", { type: "time", value: "19:00" });
    const lunches = h("input", { type: "number", min: "0", max: "5", step: "1", value: "1" });
    const reason = h("input", { type: "text", maxlength: "300", placeholder: "e.g. Phone was flat – forgot to clock in and out" });
    const send = h("button", { class: "btn", type: "button" }, "Send request");
    const msg = h("p", { class: "status", role: "status" });
    const preview = h("p", { class: "clock-result" });
    const times = () => {
      if (!date.value || !start.value || !end.value) return null;
      const ci = new Date(`${date.value}T${start.value}:00Z`);
      let co = new Date(`${date.value}T${end.value}:00Z`);
      if (co <= ci) co = new Date(co.getTime() + 86400000);   // finished after midnight
      return { ci: ci.toISOString(), co: co.toISOString() };
    };
    const show = () => { const t = times(); preview.textContent = t ? reqWhen({ clock_in: t.ci, clock_out: t.co, lunches: Math.max(0, Math.round(+lunches.value || 0)) }) : ""; };
    [date, start, end, lunches].forEach((x) => x.addEventListener("input", show));
    send.addEventListener("click", async () => {
      const t = times();
      if (!t) { ctx.setStatus(msg, "Choose the date and the start and finish times.", true); return; }
      if (reason.value.trim().length < 3) { ctx.setStatus(msg, "Please say briefly why the shift is missing.", true); return; }
      if (new Date(t.co) > new Date()) { ctx.setStatus(msg, "The shift must have finished already.", true); return; }
      send.disabled = true;
      const r = await db.from("time_requests").insert({ clock_in: t.ci, clock_out: t.co, lunches: Math.min(5, Math.max(0, Math.round(+lunches.value || 0))), reason: reason.value.trim() });
      send.disabled = false;
      if (r.error) { ctx.setStatus(msg, r.error.message, true); return; }
      redraw();
    });
    const list = reqs.length ? h("ul", { class: "clock-list" }, reqs.map((r) => {
      const cancel = r.status === "pending" ? h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Cancel") : null;
      if (cancel) cancel.addEventListener("click", async () => { cancel.disabled = true; await db.from("time_requests").update({ status: "cancelled" }).eq("id", r.id); redraw(); });
      return h("li", null, reqChip(h, r), " ", reqWhen(r), h("div", { class: "fineprint" }, `“${r.reason}”` + (r.decision_note ? ` – ${r.decided_by_name}: “${r.decision_note}”` : "")), cancel);
    })) : null;
    // Stay open while something is waiting, and for a week after a decision so the outcome is seen.
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const waiting = reqs.filter((r) => r.status === "pending").length;
    const recent = reqs.filter((r) => (r.status === "approved" || r.status === "declined") && r.decided_at && r.decided_at > weekAgo);
    const sumText = waiting ? ` (${waiting} waiting)` : recent.length ? ` (${recent.filter((r) => r.status === "approved").length ? "approved" : "declined"} – see below)` : "";
    return h("details", { class: "panel", open: (waiting || recent.length) ? true : null },
      h("summary", null, "Forgot to clock in at all? Request a shift" + sumText),
      h("p", null, "For a day you worked but didn’t clock in or out at all. Management checks it and adds the shift. (If you clocked in but a time is wrong, use “Ask for a correction” on that shift instead.)"),
      h("div", { class: "form-grid" },
        h("label", { class: "field" }, h("span", null, "Date"), date),
        h("label", { class: "field" }, h("span", null, "Started"), start),
        h("label", { class: "field" }, h("span", null, "Finished"), end),
        h("label", { class: "field" }, h("span", null, "Lunches"), lunches),
        h("label", { class: "field field-wide" }, h("span", null, "Reason"), reason)),
      preview, send, msg,
      list ? h("div", null, h("h3", null, "Your requests"), list) : null);
  }

  // ---------------- Team (management) ----------------
  async function teamPage(main, ctx) {
    const { h, fill, pageHead, db } = ctx;
    const redraw = () => teamPage(main, ctx);
    fill(main, pageHead("Hours"), tabs(ctx, "team"), h("p", { class: "empty" }, "Loading…"));
    const [from, to] = monthRange(month);
    const [mr, or, pr, kr, tq] = await Promise.all([
      db.from("time_shift_hours").select("*").gte("clock_in", from).lt("clock_in", to).order("clock_in", { ascending: true }),
      db.from("time_shift_hours").select("*").is("clock_out", null).order("clock_in", { ascending: true }),
      db.from("profiles").select("id, full_name, email, active").eq("active", true).order("full_name", { ascending: true }),
      db.from("time_kiosks").select("*").order("created_at", { ascending: true }),
      db.from("time_requests").select("*").eq("status", "pending").order("clock_in", { ascending: true })
    ]);
    if (mr.error) { fill(main, pageHead("Hours"), tabs(ctx, "team"), h("p", { class: "notice is-error" }, "The time clock isn’t set up yet (database update 44).")); return; }
    const rows = mr.data || [], openNow = or.data || [], people = pr.data || [];
    const status = h("p", { class: "status", role: "status" });
    const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? (p.full_name || p.email) : "Former staff"; };

    // On the clock now
    const nowPanel = h("section", { class: "panel", "aria-labelledby": "on-h" }, h("h2", { id: "on-h" }, `On the clock now (${openNow.length})`),
      openNow.length ? h("ul", { class: "clock-list" }, openNow.map((s) => {
        const mins = minutesSince(s.clock_in);
        return h("li", { class: mins > FORGOT_AFTER ? "is-late" : "" },
          h("b", null, s.person_name), ` since ${clock(s.clock_in)} ${new Date(s.clock_in).toDateString() !== new Date().toDateString() ? "(" + dayLabel(s.clock_in) + ")" : ""} · ${where(s, "in")} · ${hm(mins)}`,
          mins > FORGOT_AFTER ? h("span", { class: "chip chip-sev-high" }, "Forgot to clock out?") : null,
          editButton(s));
      })) : h("p", { class: "empty" }, "Nobody is clocked in."));

    // To review: location not confirmed, or a note from staff
    const review = rows.concat(openNow.filter((s) => s.clock_in < from)).filter((s) => !s.reviewed);
    const reviewPanel = review.length ? h("section", { class: "panel panel-attention", "aria-labelledby": "rev-h" }, h("h2", { id: "rev-h" }, `To review (${review.length})`),
      h("ul", { class: "clock-list" }, review.map((s) => {
        const ok = h("button", { class: "btn btn-small", type: "button" }, "Mark reviewed");
        ok.addEventListener("click", async () => {
          ok.disabled = true;
          const u = await db.from("time_shifts").update({ reviewed: true }).eq("id", s.id);
          if (u.error) { ok.disabled = false; ctx.setStatus(status, u.error.message, true); return; }
          redraw();
        });
        return h("li", null, h("b", null, s.person_name), ` · ${dayLabel(s.clock_in)} ${clock(s.clock_in)}–${s.clock_out ? clock(s.clock_out) : "…"}`,
          !s.in_confirmed ? h("div", null, "In: " + where(s, "in")) : null,
          s.out_confirmed === false ? h("div", null, "Out: " + where(s, "out")) : null,
          s.staff_note ? h("div", null, "Note: “", h("i", null, s.staff_note), "”") : null,
          h("div", { class: "row" }, ok, editButton(s)));
      }))) : null;

    // Missed-shift requests from staff
    const pendingReqs = tq.error ? [] : (tq.data || []);
    const reqsPanel = pendingReqs.length ? h("section", { class: "panel panel-attention", "aria-labelledby": "rq-h" },
      h("h2", { id: "rq-h" }, `Missed-shift requests (${pendingReqs.length})`),
      h("ul", { class: "clock-list" }, pendingReqs.map((r) => {
        const note = h("input", { type: "text", maxlength: "300", placeholder: "Note to them (optional)" });
        const ok = h("button", { class: "btn btn-small", type: "button" }, "Approve – add the shift");
        const no = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Decline");
        const m = h("span", { class: "status", role: "status" });
        const decide = async (to) => {
          ok.disabled = no.disabled = true;
          const u = await db.from("time_requests").update({ status: to, decision_note: note.value.trim() || null }).eq("id", r.id);
          if (u.error) { ok.disabled = no.disabled = false; ctx.setStatus(m, u.error.message, true); return; }
          redraw();
        };
        ok.addEventListener("click", () => decide("approved"));
        no.addEventListener("click", () => decide("declined"));
        return h("li", null, h("b", null, r.person_name), " · ", reqWhen(r), h("div", null, "Reason: “", h("i", null, r.reason), "”"),
          h("div", { class: "row" }, note, ok, no), m);
      })),
      h("p", { class: "fineprint" }, "Check it against the roster. Approving adds the shift exactly as asked, marked as added by you."))
      : null;

    // Month summary per person
    const byPerson = {};
    rows.forEach((s) => { (byPerson[s.profile_id] = byPerson[s.profile_id] || []).push(s); });
    const ids = Object.keys(byPerson).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const all = totals(rows);

    function editButton(s) {
      const b = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Correct");
      b.addEventListener("click", () => openEditor(s, b));
      return b;
    }

    // Shift editor (correct times and lunch, delete, history)
    async function openEditor(s, anchor) {
      const holder = h("div", { class: "clock-edit panel" });
      const inI = h("input", { type: "datetime-local", value: toLocalInput(s.clock_in) });
      const outI = h("input", { type: "datetime-local", value: toLocalInput(s.clock_out) });
      const lunchI = h("input", { type: "number", min: "0", max: "5", step: "1", value: String(s.lunches || 0) });
      const save = h("button", { class: "btn btn-small", type: "button" }, "Save correction");
      const del = h("button", { class: "btn btn-danger btn-small", type: "button" }, "Delete shift");
      const cancel = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Close");
      const msg = h("p", { class: "status", role: "status" });
      const hist = h("div", { class: "fineprint" });
      const hr = await db.from("time_changes").select("*").eq("shift_id", s.id).order("changed_at", { ascending: true });
      (hr.data || []).forEach((c) => hist.append(h("div", null, `${dayLabel(c.changed_at)} ${clock(c.changed_at)} – ${c.what} by ${c.changed_by_name || "?"}`)));
      save.addEventListener("click", async () => {
        const ci = fromLocalInput(inI.value), co = fromLocalInput(outI.value);
        if (!ci) { ctx.setStatus(msg, "Clock-in is needed.", true); return; }
        if (co && co <= ci) { ctx.setStatus(msg, "Clock-out must be after clock-in.", true); return; }
        save.disabled = true;
        // send the times only if they were changed (the boxes show minutes, not seconds)
        const change = { reviewed: true };
        if (inI.value !== toLocalInput(s.clock_in)) change.clock_in = ci;
        if (outI.value !== toLocalInput(s.clock_out)) change.clock_out = co;
        const u = await db.from("time_shifts").update(change).eq("id", s.id);
        if (u.error) { save.disabled = false; ctx.setStatus(msg, u.error.message, true); return; }
        const want = Math.min(5, Math.max(0, Math.round(+lunchI.value || 0)));
        if (want !== (s.lunches || 0)) {
          await db.from("time_lunches").delete().eq("shift_id", s.id);
          if (want) await db.from("time_lunches").insert(Array.from({ length: want }, () => ({ shift_id: s.id, kind: "correction" })));
        }
        redraw();
      });
      del.addEventListener("click", async () => {
        if (!confirm(`Delete ${s.person_name}’s shift on ${dayLabel(s.clock_in)}? It stays in the history.`)) return;
        const d = await db.from("time_shifts").delete().eq("id", s.id);
        if (d.error) { ctx.setStatus(msg, d.error.message, true); return; }
        redraw();
      });
      cancel.addEventListener("click", () => holder.remove());

      // Why this shift may need fixing: the person's comment and where they clocked in and out.
      const context = h("ul", { class: "clock-context" },
        s.staff_note ? h("li", null, h("b", null, "Comment: "), "“" + s.staff_note + "”") : null,
        h("li", null, h("b", null, "Clocked in: "), `${clock(s.clock_in)} · ${where(s, "in")}`),
        h("li", null, h("b", null, "Clocked out: "), s.clock_out ? `${clock(s.clock_out)} · ${where(s, "out")}` : "not yet – still on the clock"));

      // The result, updated as the times change, so it can be checked before saving.
      const result = h("p", { class: "clock-result" });
      const showResult = () => {
        const ci = fromLocalInput(inI.value), co = fromLocalInput(outI.value);
        if (!ci) { result.textContent = "Enter the clock-in time."; return; }
        if (!co) { result.textContent = `${dayLabel(ci)} ${clock(ci)} → no clock-out yet (the shift stays open).`; return; }
        const mins = Math.round((new Date(co) - new Date(ci)) / 60000);
        if (mins <= 0) { result.textContent = "Clock-out must be after clock-in."; return; }
        const n = Math.max(0, Math.round(+lunchI.value || 0));
        const sameDay = new Date(ci).toDateString() === new Date(co).toDateString();
        result.textContent = `${dayLabel(ci)} ${clock(ci)} → ${sameDay ? "" : dayLabel(co) + " "}${clock(co)} · ${hm(mins)} worked` +
          ` (${hm(Math.min(mins, SHIFT_MIN))} shift + ${hm(Math.max(0, mins - SHIFT_MIN))} additional) · ${n === 1 ? "1 lunch" : n + " lunches"}`;
        result.classList.toggle("is-long", mins > 16 * 60);
      };
      [inI, outI, lunchI].forEach((x) => x.addEventListener("input", showResult));
      showResult();

      holder.append(h("h3", null, `${s.person_name} – ${dayLabel(s.clock_in)}`), context,
        h("div", { class: "form-grid" },
          h("label", { class: "field" }, h("span", null, "Clock in (Iceland time)"), inI),
          h("label", { class: "field" }, h("span", null, "Clock out (Iceland time)"), outI),
          h("label", { class: "field" }, h("span", null, "Lunches"), lunchI)),
        result,
        h("div", { class: "row" }, save, del, cancel), msg,
        h("p", { class: "fineprint" }, "Set the times the person actually worked, then Save correction. It’s marked reviewed, the person sees “Corrected by " + (ctx.state.profile.full_name || "management") + "”, and the change is kept in the history below."));
      if (hist.childNodes.length) holder.append(h("div", { class: "clock-history" }, h("b", null, "History"), hist));
      const old = main.querySelector(".clock-edit"); if (old) old.remove();
      (anchor.closest(".clock-grid-panel") || anchor.closest("li, tr, section")).after(holder);
      inI.focus();
    }

    const summary = h("section", { class: "panel", "aria-labelledby": "sum-h" }, h("h2", { id: "sum-h" }, "Monthly totals"),
      rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table clock-table" },
        h("thead", null, h("tr", null, ["Name", "Shifts", "Hours worked", "Shift hours (up to 12 h each)", "Additional hours", "Lunches", ""].map((x) => h("th", null, x)))),
        h("tbody", null, ids.map((id) => {
          const list = byPerson[id], t = totals(list);
          const toggle = h("button", { class: "btn btn-quiet btn-small", type: "button" }, teamOpen[id] ? "Hide shifts" : "Show shifts");
          toggle.addEventListener("click", () => { teamOpen[id] = !teamOpen[id]; redraw(); });
          const rowsOut = [h("tr", null,
            h("td", null, h("b", null, nameOf(id))), h("td", null, String(t.shifts) + (list.some((s) => !s.clock_out) ? " (1 on shift)" : "")), h("td", null, hm(t.worked)),
            h("td", null, hm(t.shift)), h("td", null, t.extra ? h("b", null, hm(t.extra)) : "–"), h("td", null, String(t.lunches)), h("td", null, toggle))];
          if (teamOpen[id]) list.forEach((s) => rowsOut.push(h("tr", { class: "clock-sub" + (s.reviewed ? "" : " is-flag") },
            h("td", null, `${dayLabel(s.clock_in)} ${clock(s.clock_in)}–${s.clock_out ? clock(s.clock_out) : "on shift"}`),
            h("td", null, ""),
            h("td", null, s.clock_out ? hm(s.worked_minutes) : "–"),
            h("td", null, s.clock_out ? hm(s.shift_minutes) : "–"),
            h("td", null, s.additional_minutes ? hm(s.additional_minutes) : "–"),
            h("td", null, s.lunches ? (s.lunches === 1 ? "Yes" : String(s.lunches)) : "–"),
            h("td", null, editButton(s)))));
          return rowsOut;
        }),
        h("tr", { class: "clock-total" }, h("td", null, h("b", null, "Total")), h("td", null, String(all.shifts)), h("td", null, hm(all.worked)), h("td", null, hm(all.shift)), h("td", null, hm(all.extra)), h("td", null, String(all.lunches)), h("td", null))))) : h("p", { class: "empty" }, "No shifts this month."));

    // Add a missed shift
    const who = h("select", null, people.map((p) => h("option", { value: p.id }, p.full_name || p.email)));
    const aIn = h("input", { type: "datetime-local" }), aOut = h("input", { type: "datetime-local" });
    const aLunch = h("input", { type: "number", min: "0", max: "5", step: "1", value: "1" });
    const aWhy = h("input", { type: "text", maxlength: "300", placeholder: "e.g. phone was flat" });
    const aBtn = h("button", { class: "btn", type: "button" }, "Add shift");
    const aMsg = h("p", { class: "status", role: "status" });
    aBtn.addEventListener("click", async () => {
      const ci = fromLocalInput(aIn.value), co = fromLocalInput(aOut.value);
      if (!ci || !co || co <= ci) { ctx.setStatus(aMsg, "Give a clock-in and a later clock-out.", true); return; }
      aBtn.disabled = true;
      const ins = await db.from("time_shifts").insert({ profile_id: who.value, clock_in: ci, clock_out: co, in_reason: aWhy.value.trim() || "Added by management" }).select("id");
      if (ins.error) { aBtn.disabled = false; ctx.setStatus(aMsg, ins.error.message, true); return; }
      const id = ins.data && ins.data[0] && ins.data[0].id;
      const nL = Math.min(5, Math.max(0, Math.round(+aLunch.value || 0)));
      if (id && nL) await db.from("time_lunches").insert(Array.from({ length: nL }, () => ({ shift_id: id, kind: "correction" })));
      redraw();
    });
    const addPanel = h("details", { class: "panel" }, h("summary", null, "Add a missed shift"),
      h("div", { class: "form-grid" },
        h("label", { class: "field" }, h("span", null, "Person"), who),
        h("label", { class: "field" }, h("span", null, "Clock in"), aIn),
        h("label", { class: "field" }, h("span", null, "Clock out"), aOut),
        h("label", { class: "field" }, h("span", null, "Lunches"), aLunch),
        h("label", { class: "field field-wide" }, h("span", null, "Reason"), aWhy)),
      aBtn, aMsg);

    const kioskPanel = kr.error ? null : ipadPanel(ctx, kr.data || [], redraw);
    const payPanel = payrollPanel(ctx, nameOf);

    // Month overview: one row per person, one column per day (hours worked that day).
    const nDays = daysIn(month);
    const dayNames = Array.from({ length: nDays }, (_, i) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, i + 1)));
    const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const dayTotals = new Array(nDays + 1).fill(0);
    const gridRows = ids.map((id) => {
      const list = byPerson[id], t = totals(list);
      const cells = dayNames.map((d, i) => {
        const day = i + 1;
        const shifts = list.filter((s) => dayOf(s.clock_in) === day);
        if (!shifts.length) return h("td", { class: isWeekend(d) ? "is-wkd" : "" }, "");
        const worked = shifts.reduce((a, s) => a + (s.worked_minutes || 0), 0);
        dayTotals[day] += worked;
        const open = shifts.some((s) => !s.clock_out), over = shifts.some((s) => s.additional_minutes > 0), flag = shifts.some((s) => !s.reviewed);
        const tip = shifts.map((s) => `${clock(s.clock_in)}–${s.clock_out ? clock(s.clock_out) : "on shift"}${s.lunches ? ", lunch" : ""}`).join("; ");
        const b = h("button", { type: "button", class: "clock-cell", title: `${nameOf(id)}, ${dayLabel(shifts[0].clock_in)}: ${tip}` }, open ? "on" : hrs(worked));
        b.addEventListener("click", () => openEditor(shifts[0], b));
        return h("td", { class: [isWeekend(d) ? "is-wkd" : "", over ? "is-over" : "", flag ? "is-flag" : ""].join(" ").trim() }, b);
      });
      return h("tr", null, h("th", { scope: "row" }, nameOf(id)), cells,
        h("td", { class: "tot" }, String(t.shifts)), h("td", { class: "tot" }, hrs(t.worked)), h("td", { class: "tot" }, t.extra ? hrs(t.extra) : "–"), h("td", { class: "tot" }, String(t.lunches)));
    });
    const grid = h("section", { class: "panel clock-grid-panel", "aria-labelledby": "grid-h" },
      h("h2", { id: "grid-h" }, "Month overview"),
      rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "clock-grid" },
        h("thead", null, h("tr", null, h("th", null, "Name"),
          dayNames.map((d, i) => h("th", { class: isWeekend(d) ? "is-wkd" : "", title: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) },
            String(i + 1), h("span", null, d.toLocaleDateString("en-GB", { weekday: "narrow", timeZone: "UTC" })))),
          h("th", { class: "tot" }, "Shifts"), h("th", { class: "tot" }, "Hours"), h("th", { class: "tot" }, "Additional"), h("th", { class: "tot" }, "Lunches"))),
        h("tbody", null, gridRows,
          h("tr", { class: "clock-total" }, h("th", { scope: "row" }, "Total"),
            dayNames.map((d, i) => h("td", { class: isWeekend(d) ? "is-wkd" : "" }, dayTotals[i + 1] ? hrs(dayTotals[i + 1]) : "")),
            h("td", { class: "tot" }, String(all.shifts)), h("td", { class: "tot" }, hrs(all.worked)), h("td", { class: "tot" }, all.extra ? hrs(all.extra) : "–"), h("td", { class: "tot" }, String(all.lunches))))))
        : h("p", { class: "empty" }, "No shifts this month."),
      rows.length ? h("p", { class: "fineprint" }, "Hours worked each day (by clock-in date). Orange: over 12 hours. Yellow edge: to review. Tap a day to correct that shift.") : null);

    const exportBtn = h("button", { class: "btn", type: "button" }, "Download Excel for " + monthLabel(month));
    exportBtn.addEventListener("click", () => exportMonth(rows, ids, byPerson, nameOf));

    const guide = h("details", { class: "panel clock-guide" }, h("summary", null, "How to fix shifts"),
      h("table", { class: "mgmt-table" },
        h("thead", null, h("tr", null, h("th", null, "Problem"), h("th", null, "Where you’ll see it"), h("th", null, "What to do"))),
        h("tbody", null,
          [["Forgot to clock out", "On the clock now – “Forgot to clock out?” after 13 hours", "Correct → set Clock out to when they finished → Save correction"],
           ["Clocked in late or out early by mistake (often with a comment)", "To review, or a day in the Month overview", "Correct → change the time → Save correction"],
           ["Didn’t clock in or out at all", "Missed-shift requests (staff can ask), or a blank day in the Month overview", "Approve the request – or Add a missed shift (below) → person, times, lunches, reason → Add shift"],
           ["Location not confirmed", "To review – shows the distance and their reason", "Reason fine? Mark reviewed. Times wrong? Correct"],
           ["Lunch missing or recorded by mistake", "The Lunches column, or the shift itself", "Correct → set Lunches → Save correction"],
           ["A shift that shouldn’t exist", "The Month overview or Show shifts", "Correct → Delete shift"]
          ].map((r) => h("tr", null, h("td", null, h("b", null, r[0])), h("td", null, r[1]), h("td", null, r[2]))))),
      h("p", { class: "fineprint" }, "Month end: when On the clock now and To review are both empty, the month is clean – download the Excel."));

    fill(main, pageHead("Hours", "Who’s on the clock, shifts to review, and each person’s monthly totals."),
      tabs(ctx, "team"), guide, reqsPanel, nowPanel, reviewPanel,
      monthNav(ctx, redraw),
      h("div", { class: "stat-grid" },
        stat(h, all.shifts, "Shifts"), stat(h, hm(all.worked), "Hours worked"),
        stat(h, hm(all.extra), "Additional hours", all.extra ? "is-warn" : ""), stat(h, all.lunches, "Lunches"), stat(h, review.length, "To review", review.length ? "is-warn" : "")),
      summary, grid, h("div", { class: "row" }, exportBtn), payPanel, addPanel, kioskPanel, status);
  }

  // ---------------- Payroll report (management) ----------------
  // Shifts and shift hours: the calendar month. Additional hours (over 12 h on a
  // shift) and lunches: the 26th of the previous month to the 25th of this month.
  // A shift belongs to the day it started.
  const PAY_CUTOFF = 25;
  function payPeriods(m) {
    const prev = shiftMonth(m, -1);
    return {
      shifts: { from: m + "-01T00:00:00Z", to: shiftMonth(m, 1) + "-01T00:00:00Z", label: `1–${daysIn(m)} ${monthName(m)}` },
      extra: { from: `${prev}-${PAY_CUTOFF + 1}T00:00:00Z`, to: `${m}-${PAY_CUTOFF + 1}T00:00:00Z`, label: `${PAY_CUTOFF + 1} ${monthName(prev)} – ${PAY_CUTOFF} ${monthName(m)}` }
    };
  }
  function monthName(m) { return new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }); }
  // The payroll month: from the 26th on, this month's report is the one to run.
  function payMonth() { return thisMonth(); }

  function payrollPanel(ctx, nameOf) {
    const { h, db } = ctx;
    let pm = payMonth();
    const out = h("div");
    const label = h("b");
    const gen = h("button", { class: "btn", type: "button" });
    const setLabel = () => { label.textContent = monthLabel(pm); gen.textContent = "Generate payroll report for " + monthLabel(pm); out.replaceChildren(); };
    const prev = h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Previous month" }, "‹");
    const next = h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Next month" }, "›");
    prev.addEventListener("click", () => { pm = shiftMonth(pm, -1); setLabel(); });
    next.addEventListener("click", () => { pm = shiftMonth(pm, 1); setLabel(); });
    setLabel();

    gen.addEventListener("click", async () => {
      gen.disabled = true;
      out.replaceChildren(h("p", { class: "empty" }, "Working it out…"));
      const per = payPeriods(pm);
      const from = per.extra.from < per.shifts.from ? per.extra.from : per.shifts.from;
      const r = await db.from("time_shift_hours").select("*").gte("clock_in", from).lt("clock_in", per.shifts.to).order("clock_in", { ascending: true });
      gen.disabled = false;
      if (r.error) { out.replaceChildren(h("p", { class: "notice is-error" }, r.error.message)); return; }
      const report = buildPayroll(r.data || [], per, nameOf);
      out.replaceChildren(renderPayroll(h, report, pm, per));
    });

    return h("section", { class: "panel clock-pay", "aria-labelledby": "pay-h" },
      h("h2", { id: "pay-h" }, "Payroll report"),
      h("p", null, "Shifts count for the calendar month. Additional hours (over 12 h on a shift) and lunches count from the 26th of the previous month to the 25th. Run it on the 26th, or any time after."),
      h("div", { class: "row clock-month" }, prev, label, next), gen, out);
  }

  function buildPayroll(rows, per, nameOf) {
    const inP = (s, p) => s.clock_in >= p.from && s.clock_in < p.to;
    const people = {};
    const get = (id) => (people[id] = people[id] || { id, name: nameOf(id), shifts: 0, shiftMin: 0, workedMin: 0, extraMin: 0, longShifts: 0, lunches: 0 });
    const issues = { open: [], review: [] };
    const now = new Date().toISOString();
    rows.forEach((s) => {
      const inShifts = inP(s, per.shifts), inExtra = inP(s, per.extra);
      if (!inShifts && !inExtra) return;
      if (!s.clock_out) { issues.open.push(s); return; }
      if (!s.reviewed) issues.review.push(s);
      const p = get(s.profile_id);
      if (inShifts) { p.shifts++; p.shiftMin += s.shift_minutes || 0; p.workedMin += s.worked_minutes || 0; }
      if (inExtra) { p.extraMin += s.additional_minutes || 0; if (s.additional_minutes > 0) p.longShifts++; p.lunches += s.lunches || 0; }
    });
    const list = Object.values(people).sort((a, b) => a.name.localeCompare(b.name));
    const total = list.reduce((t, p) => ({ shifts: t.shifts + p.shifts, shiftMin: t.shiftMin + p.shiftMin, workedMin: t.workedMin + p.workedMin, extraMin: t.extraMin + p.extraMin, longShifts: t.longShifts + p.longShifts, lunches: t.lunches + p.lunches }),
      { shifts: 0, shiftMin: 0, workedMin: 0, extraMin: 0, longShifts: 0, lunches: 0 });
    const complete = now >= per.shifts.to;
    return { list, total, issues, complete, generated: now };
  }

  function renderPayroll(h, rep, pm, per) {
    const warn = [];
    if (!rep.complete) warn.push(`The month isn’t over yet – shifts after ${dayLabel(rep.generated)} aren’t included. Additional hours and lunches up to the 25th are ${rep.generated >= per.extra.to ? "complete" : "not complete yet either"}.`);
    if (rep.issues.open.length) warn.push(`${rep.issues.open.length} ${rep.issues.open.length === 1 ? "shift is" : "shifts are"} still open (not clocked out) and not counted: ` + rep.issues.open.map((s) => `${s.person_name} ${dayLabel(s.clock_in)}`).join(", ") + ". Fix them first.");
    if (rep.issues.review.length) warn.push(`${rep.issues.review.length} ${rep.issues.review.length === 1 ? "shift is" : "shifts are"} still to review: ` + rep.issues.review.map((s) => `${s.person_name} ${dayLabel(s.clock_in)}`).join(", ") + ".");
    const dl = h("button", { class: "btn", type: "button" }, "Download as Excel");
    dl.addEventListener("click", () => exportPayroll(rep, pm, per));
    return h("div", { class: "clock-pay-out" },
      h("p", { class: "fineprint" }, `Generated ${dayLabel(rep.generated)} ${clock(rep.generated)}. Shifts: ${per.shifts.label}. Additional hours and lunches: ${per.extra.label}.`),
      warn.length ? h("div", { class: "notice" }, h("ul", null, warn.map((w) => h("li", null, w)))) : h("p", { class: "status is-ok" }, "✓ No open shifts and nothing left to review in these periods."),
      rep.list.length ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table clock-table" },
        h("thead", null,
          h("tr", null, h("th", null, ""), h("th", { colspan: "3" }, `Shifts · ${per.shifts.label}`), h("th", { colspan: "3" }, `${per.extra.label}`)),
          h("tr", null, ["Name", "Shifts", "Shift hours (up to 12 h)", "Hours worked", "Additional hours", "Long shifts", "Lunches"].map((x) => h("th", null, x)))),
        h("tbody", null, rep.list.map((p) => h("tr", null,
            h("td", null, h("b", null, p.name)), h("td", null, String(p.shifts)), h("td", null, hm(p.shiftMin)), h("td", null, hm(p.workedMin)),
            h("td", null, p.extraMin ? h("b", null, hm(p.extraMin)) : "–"), h("td", null, p.longShifts ? String(p.longShifts) : "–"), h("td", null, String(p.lunches)))),
          h("tr", { class: "clock-total" }, h("td", null, h("b", null, "Total")), h("td", null, String(rep.total.shifts)), h("td", null, hm(rep.total.shiftMin)), h("td", null, hm(rep.total.workedMin)),
            h("td", null, hm(rep.total.extraMin)), h("td", null, String(rep.total.longShifts)), h("td", null, String(rep.total.lunches))))))
        : h("p", { class: "empty" }, "No shifts in these periods."),
      rep.list.length ? h("div", { class: "row" }, dl) : null);
  }

  function exportPayroll(rep, pm, per) {
    if (!window.XLSX) { alert("The Excel library didn’t load – reload the page."); return; }
    const aoa = [
      [`Iceland Aero Agents – payroll report – ${monthLabel(pm)}`],
      [`Shifts and shift hours: ${per.shifts.label}`],
      [`Additional hours and lunches: ${per.extra.label}`],
      [`Generated ${new Date(rep.generated).toLocaleString("en-GB", { timeZone: TZ })}${rep.complete ? "" : " – the month isn’t over yet, later shifts aren’t included"}`],
      [],
      ["Name", "Shifts", "Shift hours (up to 12 h)", "Hours worked", "Additional hours", "Long shifts (over 12 h)", "Lunches"]
    ];
    rep.list.forEach((p) => aoa.push([p.name, p.shifts, dec(p.shiftMin), dec(p.workedMin), dec(p.extraMin), p.longShifts, p.lunches]));
    aoa.push(["Total", rep.total.shifts, dec(rep.total.shiftMin), dec(rep.total.workedMin), dec(rep.total.extraMin), rep.total.longShifts, rep.total.lunches]);
    if (rep.issues.open.length || rep.issues.review.length) {
      aoa.push([]);
      rep.issues.open.forEach((s) => aoa.push(["Not counted – still open", `${s.person_name}, ${new Date(s.clock_in).toLocaleDateString("en-CA", { timeZone: TZ })}`]));
      rep.issues.review.forEach((s) => aoa.push(["Still to review", `${s.person_name}, ${new Date(s.clock_in).toLocaleDateString("en-CA", { timeZone: TZ })}`]));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 22 }, { wch: 13 }, { wch: 16 }, { wch: 22 }, { wch: 9 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payroll " + pm);
    XLSX.writeFile(wb, `IAA payroll ${pm}.xlsx`);
  }

  // ---------------- Time clock iPads (management) ----------------
  function ipadPanel(ctx, kiosks, redraw) {
    const { h, db } = ctx;
    const msg = h("p", { class: "status", role: "status" });
    const list = kiosks.length ? h("ul", { class: "clock-list" }, kiosks.map((k) => {
      const toggle = h("button", { class: "btn btn-quiet btn-small", type: "button" }, k.active ? "Switch off" : "Switch on");
      toggle.addEventListener("click", async () => {
        if (k.active && !confirm(`Switch off “${k.name}”? It will stop working until switched on again.`)) return;
        toggle.disabled = true;
        const u = await db.from("time_kiosks").update({ active: !k.active }).eq("id", k.id);
        if (u.error) { toggle.disabled = false; ctx.setStatus(msg, u.error.message, true); return; }
        redraw();
      });
      return h("li", { class: k.active ? "" : "is-off" }, h("b", null, k.name), ` · ${k.station} · `,
        k.active ? (k.last_used_at ? `last used ${dayLabel(k.last_used_at)} ${clock(k.last_used_at)}` : "not used yet") : "switched off",
        ` · set up by ${k.created_by_name || "?"}`, toggle);
    })) : h("p", { class: "empty" }, "No iPads set up yet.");
    const st = h("select", null, ["BIRK", "BIKF", "BIAR"].map((c) => h("option", { value: c }, c)));
    const nm = h("input", { type: "text", maxlength: "60", placeholder: "e.g. BIRK front desk iPad" });
    const go = h("button", { class: "btn", type: "button" }, "Set up this device as a time clock");
    go.addEventListener("click", async () => {
      if (!confirm(`Make THIS device the ${st.value} time clock?\n\nYou’ll be signed out of the portal on this device, and it will show the kennitala number pad from then on.`)) return;
      go.disabled = true;
      const r = await db.rpc("register_kiosk", { p_station: st.value, p_name: nm.value.trim() || st.value + " iPad" });
      if (r.error) { go.disabled = false; ctx.setStatus(msg, r.error.message, true); return; }
      try { localStorage.setItem("iaa-kiosk-token", r.data); } catch (e) { go.disabled = false; ctx.setStatus(msg, "This browser can’t store the iPad key – check it isn’t in private browsing.", true); return; }
      try { await db.auth.signOut(); } catch (e) { /* carry on */ }
      location.href = "/kiosk.html";
    });
    return h("details", { class: "panel" }, h("summary", null, `Time clock iPads (${kiosks.filter((k) => k.active).length})`),
      h("p", null, "A station iPad where staff clock in and out by typing their kennitala. Set it up on the iPad itself: sign in there, open this page and press the button. Kennitölur are added on the People page."),
      list,
      h("div", { class: "form-grid" },
        h("label", { class: "field" }, h("span", null, "Station"), st),
        h("label", { class: "field" }, h("span", null, "Name"), nm)),
      go, msg,
      h("p", { class: "fineprint" }, "Lost or replaced iPad? Switch it off here – it stops working straight away."));
  }

  // ---------------- Excel export ----------------
  function exportMonth(rows, ids, byPerson, nameOf) {
    if (!window.XLSX) { alert("The Excel library didn’t load – reload the page."); return; }
    const done = rows.filter((s) => s.clock_out);
    const summary = ids.filter((id) => totals(byPerson[id]).shifts).map((id) => {
      const t = totals(byPerson[id]);
      return { "Name": nameOf(id), "Shifts": t.shifts, "Hours worked": dec(t.worked), "Shift hours (up to 12 h each)": dec(t.shift), "Additional hours (beyond 12 h)": dec(t.extra), "Lunches": t.lunches };
    });
    const all = totals(rows);
    summary.push({ "Name": "Total", "Shifts": all.shifts, "Hours worked": dec(all.worked), "Shift hours (up to 12 h each)": dec(all.shift), "Additional hours (beyond 12 h)": dec(all.extra), "Lunches": all.lunches });
    const shifts = done.map((s) => ({
      "Name": nameOf(s.profile_id), "Date": new Date(s.clock_in).toLocaleDateString("en-CA", { timeZone: TZ }), "Clock in": clock(s.clock_in), "Clock out": clock(s.clock_out),
      "Clock-out date": new Date(s.clock_out).toLocaleDateString("en-CA", { timeZone: TZ }),
      "Lunches": s.lunches || 0, "Hours worked": dec(s.worked_minutes), "Shift hours": dec(s.shift_minutes), "Additional hours": dec(s.additional_minutes),
      "Location in": where(s, "in"), "Location out": where(s, "out"),
      "Corrected by": s.edited_by_name || "", "Note": s.staff_note || ""
    }));
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(summary); ws1["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 28 }, { wch: 28 }, { wch: 10 }];
    const ws2 = XLSX.utils.json_to_sheet(shifts); ws2["!cols"] = [{ wch: 26 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 13 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 15 }, { wch: 30 }, { wch: 30 }, { wch: 16 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Monthly totals");
    XLSX.utils.book_append_sheet(wb, ws2, "Shifts");

    // Month overview: people down, days across, hours worked each day.
    const n = daysIn(month);
    const head = ["Name"].concat(Array.from({ length: n }, (_, i) => String(i + 1)), ["Shifts", "Hours worked", "Additional hours", "Lunches"]);
    const dayTot = new Array(n).fill(0);
    const grid = [head];
    ids.filter((id) => totals(byPerson[id]).shifts).forEach((id) => {
      const list = byPerson[id].filter((s) => s.clock_out), t = totals(list);
      const days = Array.from({ length: n }, (_, i) => {
        const m = list.filter((s) => dayOf(s.clock_in) === i + 1).reduce((a, s) => a + (s.worked_minutes || 0), 0);
        dayTot[i] += m;
        return m ? dec(m) : "";
      });
      grid.push([nameOf(id)].concat(days, [t.shifts, dec(t.worked), dec(t.extra), t.lunches]));
    });
    grid.push(["Total"].concat(dayTot.map((m) => (m ? dec(m) : "")), [all.shifts, dec(all.worked), dec(all.extra), all.lunches]));
    const ws3 = XLSX.utils.aoa_to_sheet(grid);
    ws3["!cols"] = [{ wch: 24 }].concat(Array.from({ length: n }, () => ({ wch: 5 })), [{ wch: 8 }, { wch: 13 }, { wch: 16 }, { wch: 9 }]);
    ws3["!freeze"] = { xSplit: 1, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws3, "Month overview");
    XLSX.writeFile(wb, `IAA hours ${month}.xlsx`);
  }

  // ---------------- Needs attention (management Home) ----------------
  async function attention(db) {
    const out = [];
    const r = await db.from("time_shifts").select("id, clock_in, clock_out, reviewed").or("clock_out.is.null,reviewed.eq.false");
    if (r.error) return out;
    const rows = r.data || [];
    const forgot = rows.filter((s) => !s.clock_out && minutesSince(s.clock_in) > FORGOT_AFTER).length;
    const review = rows.filter((s) => !s.reviewed).length;
    if (forgot) out.push(`${forgot} ${forgot === 1 ? "person has" : "people have"} been clocked in for over 13 hours – forgot to clock out?`);
    if (review) out.push(`${review} ${review === 1 ? "shift" : "shifts"} to review (location not confirmed or a correction request)`);
    const rq = await db.from("time_requests").select("id").eq("status", "pending");
    const nReq = rq.error ? 0 : (rq.data || []).length;
    if (nReq) out.push(`${nReq} missed-shift ${nReq === 1 ? "request" : "requests"} to approve`);
    return out;
  }

  window.IAAClock = { render, homePanel, attention };
})();
