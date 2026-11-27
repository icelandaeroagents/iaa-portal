/* Iceland Aero Agents – Staff Portal
   Ramp: log the services delivered on each flight (replaces the Apps Script
   phone page). Flights and the services list come from Notion; each logged
   service goes to the Notion Services Log with the signed-in person as "By".
   Needs database update 43 and api/ramp-sync.js. */
(function () {
  "use strict";

  let station = null, day = null, openId = null, notice = null;
  const tried = {};   // days already fetched from Notion during this visit
  function refreshDay(d) {
    return fetch("/api/ramp-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "refresh", day: d }) })
      .then((x) => x.json()).catch(() => ({ error: "No connection – try again" }));
  }
  const STATION_ORDER = ["BIRK", "BIKF", "BIAR", "BIEG"];

  function todayIso() { return new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Reykjavik" }); }
  function shiftDay(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function hhmm(ts) { return ts ? new Date(ts).toISOString().slice(11, 16) : "–"; }
  function niceDay(iso) {
    const t = todayIso(); if (iso === t) return "Today"; if (iso === shiftDay(t, 1)) return "Tomorrow"; if (iso === shiftDay(t, -1)) return "Yesterday";
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }
  function when(ts) { return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Atlantic/Reykjavik" }); }
  const op = (o) => (o && o !== "NONE" ? String(o).replace(/\s*-\s*[A-Z0-9]{3}$/, "") : "");
  const notionLink = (id) => "https://www.notion.so/" + String(id).replace(/-/g, "");
  // The same wording as the "Summary" formula in the Notion Services Log:
  // 2 × Crew Transport · 1.5 h GPU · 120 L Potable Water · 2 nights Hangar · Lav
  function describe(qty, name, unit) {
    const q = Number(qty), n = String(name || "Service");
    if (!q || unit === "service") return n;
    if (unit === "hours") return `${q} h ${n}`;
    if (unit === "litres") return `${q} L ${n}`;
    if (unit === "nights") return `${q} ${q === 1 ? "night" : "nights"} ${n}`;
    if (unit === "pax") return `${q} pax ${n}`;
    return `${q} × ${n}`;
  }

  function push() { return fetch("/api/ramp-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "push" }) }).catch(() => {}); }

  async function render(main, ctx) {
    const m = location.hash.match(/^#\/ramp\/(\d+)/);
    openId = m ? +m[1] : null;
    const st = ctx.state.profile.station_codes || [];
    if (!station) station = STATION_ORDER.find((s) => st.indexOf(s) !== -1) || "BIRK";
    if (!day) day = todayIso();
    return openId ? flightPage(main, ctx) : listPage(main, ctx);
  }

  // ------------------------------------------------------------------
  // Flights for a station and day
  // ------------------------------------------------------------------
  async function listPage(main, ctx) {
    const { h, fill, pageHead, db } = ctx;
    fill(main, pageHead("Ramp"), h("p", { class: "empty" }, "Loading flights…"));
    const from = day + "T00:00:00Z", to = day + "T23:59:59Z";
    // Timestamps are quoted: ":" is a reserved character in "or" filters.
    const fr = await db.from("flights").select("*").eq("station", station)
      .or(`and(arrival.gte."${from}",arrival.lte."${to}"),and(departure.gte."${from}",departure.lte."${to}")`).order("arrival", { ascending: true });
    if (fr.error) { fill(main, pageHead("Ramp"), h("p", { class: "notice is-error" }, "Ramp isn’t set up yet (database update 43).")); return; }
    const flights = fr.data || [];
    if (!flights.length && !tried[station + day]) {
      tried[station + day] = true;
      fill(main, pageHead("Ramp"), h("p", { class: "empty" }, "Checking Notion for flights on this day…"));
      await refreshDay(day);
      return listPage(main, ctx);
    }
    const logs = flights.length ? await db.from("service_logs").select("flight_id, status").in("flight_id", flights.map((f) => f.id)) : { data: [] };
    const counts = {}; (logs.data || []).forEach((l) => { if (l.status !== "removed" && l.status !== "remove") counts[l.flight_id] = (counts[l.flight_id] || 0) + 1; });
    const latest = flights.reduce((t, f) => (f.synced_at > t ? f.synced_at : t), "");
    const status = h("p", { class: "status", role: "status" });
    const refresh = h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: async function () {
      refresh.disabled = true; ctx.setStatus(status, "Getting the latest from Notion…");
      const r = await refreshDay(day);
      if (r.error) { refresh.disabled = false; ctx.setStatus(status, r.error, true); return; }
      notice = { text: `Updated ${r.flights} ${r.flights === 1 ? "flight" : "flights"} from Notion` + ((r.problems || []).length ? ` – couldn’t read: ${r.problems.join("; ")}` : ".") };
      listPage(main, ctx);
    } }, "↻ Refresh");
    const n = notice; notice = null;
    fill(main,
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Ramp"), h("p", null, "Log the services you deliver. They go straight to the Services Log in Notion, under your name.")),
        h("div", { class: "row row-tight" }, refresh)),
      n ? h("p", { class: "notice" }, n.text) : null, status,
      h("nav", { class: "tabs airport-picker", "aria-label": "Airport" }, STATION_ORDER.slice(0, 3).map((s) => h("a", { href: "#/ramp", "aria-current": s === station ? "page" : null, onclick: (e) => { e.preventDefault(); station = s; listPage(main, ctx); } }, s))),
      h("div", { class: "ramp-days" },
        h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Previous day", onclick: () => { day = shiftDay(day, -1); listPage(main, ctx); } }, "‹"),
        h("b", null, niceDay(day)),
        h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Next day", onclick: () => { day = shiftDay(day, 1); listPage(main, ctx); } }, "›"),
        day !== todayIso() ? h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => { day = todayIso(); listPage(main, ctx); } }, "Today") : null),
      flights.length
        ? h("div", { class: "ramp-list" }, flights.map((f) => h("a", { class: "panel ramp-flight" + (f.services_complete ? " is-done" : ""), href: "#/ramp/" + f.id },
            h("div", { class: "ramp-flight-head" },
              h("b", { class: "ramp-reg" }, f.registration || f.name),
              h("span", { class: "ramp-type" }, f.aircraft_type || ""),
              f.services_complete ? h("span", { class: "chip chip-pass" }, "✓ Complete") : counts[f.id] ? h("span", { class: "chip" }, `${counts[f.id]} logged`) : null),
            h("span", { class: "sub" }, [op(f.operator), f.arrival ? `Arr ${hhmm(f.arrival)}${f.origin ? " from " + f.origin : ""}` : null, f.departure ? `Dep ${hhmm(f.departure)}${f.destination ? " to " + f.destination : ""}` : null].filter(Boolean).join(" · ")),
            (f.services_requested || []).length ? h("span", { class: "ramp-req" }, f.services_requested.join(" · ")) : null)))
        : h("p", { class: "empty" }, `No ${station} flights ${niceDay(day).toLowerCase() === "today" ? "today" : "on this day"}.`),
      h("p", { class: "fineprint" }, latest ? `From Notion, last updated ${when(latest)}. Updates every 10 minutes for the next two weeks – tap Refresh for the latest.` : "Flights come from Notion every 10 minutes, for the next two weeks."));
  }

  // ------------------------------------------------------------------
  // One flight: log services, see what's logged, complete it
  // ------------------------------------------------------------------
  async function flightPage(main, ctx) {
    const { h, fill, db, state, setStatus } = ctx;
    fill(main, h("a", { class: "back-link", href: "#/ramp" }, "Ramp"), h("p", { class: "empty" }, "Loading…"));
    const [fr, sr, lr, cr] = await Promise.all([
      db.from("flights").select("*").eq("id", openId).single(),
      db.from("service_types").select("*").eq("active", true).order("sort", { ascending: true }),
      db.from("service_logs").select("*, service_types(name, unit)").eq("flight_id", openId).order("id", { ascending: true }),
      db.from("flight_completions").select("*").eq("flight_id", openId).order("id", { ascending: false })
    ]);
    if (fr.error || !fr.data) { fill(main, h("a", { class: "back-link", href: "#/ramp" }, "Ramp"), h("p", { class: "notice is-error" }, "Flight not found.")); return; }
    const f = fr.data, me = state.profile.id, isMgmt = state.profile.role === "management";
    station = f.station;
    const types = (sr.data || []).filter((s) => (s.stations || []).indexOf(f.station) !== -1);
    const logs = lr.data || [];
    const requested = new Set((f.services_requested || []).map((x) => x.toLowerCase()));
    const qty = {};
    const status = h("p", { class: "status", role: "status" });
    const reload = () => flightPage(main, ctx);

    // controls for each service, as its Entry type says
    const groups = {};
    types.forEach((s) => { (groups[s.grp || "Other"] = groups[s.grp || "Other"] || []).push(s); });
    function control(s) {
      const show = h("span", { class: "ramp-count" }, "0");
      const set = (v) => { qty[s.id] = Math.max(0, v); show.textContent = String(qty[s.id]); tile.classList.toggle("is-on", qty[s.id] > 0); };
      let input;
      if (s.entry === "number") {
        input = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: s.unit || "", "aria-label": `${s.name} (${s.unit || "amount"})`,
          oninput: (e) => { qty[s.id] = parseFloat(e.target.value) || 0; tile.classList.toggle("is-on", qty[s.id] > 0); } });
      } else if (s.entry === "yes / no") {
        input = h("button", { class: "btn btn-quiet btn-small ramp-yes", type: "button", onclick: (e) => { set(qty[s.id] ? 0 : 1); e.currentTarget.textContent = qty[s.id] ? "✓ Done" : "Add"; } }, "Add");
      } else {
        input = h("span", { class: "ramp-counter" },
          h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "Fewer " + s.name, onclick: () => set((qty[s.id] || 0) - 1) }, "−"), show,
          h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-label": "More " + s.name, onclick: () => set((qty[s.id] || 0) + 1) }, "+"));
      }
      const tile = h("div", { class: "ramp-svc" + (requested.has(s.name.toLowerCase()) ? " is-requested" : "") },
        h("span", { class: "ramp-svc-name" }, s.name, requested.has(s.name.toLowerCase()) ? h("span", { class: "sub" }, "Requested") : s.unit && s.entry !== "yes / no" ? h("span", { class: "sub" }, s.unit) : null),
        input);
      return tile;
    }
    const notes = h("input", { type: "text", id: "ramp-notes", maxlength: "300", placeholder: "Optional note for these services (e.g. Hotel Borg)" });
    const save = h("button", { class: "btn", type: "button" }, "Log services");
    save.addEventListener("click", async function () {
      const rows = Object.keys(qty).filter((id) => qty[id] > 0).map((id) => ({ flight_id: f.id, service_type_id: +id, quantity: qty[id], notes: notes.value.trim() || null }));
      if (!rows.length) { setStatus(status, "Choose at least one service.", true); return; }
      save.disabled = true; setStatus(status, "Saving…");
      const { error } = await db.from("service_logs").insert(rows);
      if (error) { save.disabled = false; setStatus(status, error.message, true); return; }
      await push();
      notice = { text: `${rows.length} ${rows.length === 1 ? "service" : "services"} logged under your name.` };
      reload();
    });

    const statusOf = (l) => l.status === "sent" ? h("span", { class: "chip chip-pass", title: "In the Notion Services Log" }, "✓ In Notion")
      : l.status === "failed" ? h("span", { class: "chip chip-sev-high", title: l.error || "" }, "⚠ Not sent – retrying")
      : l.status === "remove" ? h("span", { class: "chip" }, "Removing…")
      : l.status === "removed" ? h("span", { class: "chip" }, "Removed") : h("span", { class: "chip" }, "Sending…");
    const shown = logs.filter((l) => l.status !== "removed");
    const done = (cr.data || [])[0];
    const n = notice; notice = null;
    fill(main,
      h("a", { class: "back-link", href: "#/ramp" }, "Ramp"),
      h("div", { class: "page-head page-head-row" },
        h("div", null,
          h("p", { class: "briefing-kicker" }, `${f.station} · ${f.aircraft_type || "Aircraft"}${op(f.operator) ? " · " + op(f.operator) : ""}`),
          h("h1", null, f.registration || f.name),
          h("p", null, [f.arrival ? `Arrives ${when(f.arrival)}${f.origin ? " from " + f.origin : ""}` : null, f.departure ? `Departs ${when(f.departure)}${f.destination ? " to " + f.destination : ""}` : null].filter(Boolean).join(" · "))),
        h("a", { class: "btn btn-quiet btn-small", href: notionLink(f.notion_id), target: "_blank", rel: "noopener" }, "Open in Notion")),
      n ? h("p", { class: "notice" }, n.text) : null,
      (f.services_requested || []).length ? h("p", { class: "fineprint" }, "Requested: " + f.services_requested.join(", ")) : null,
      h("section", { class: "panel" },
        h("h2", null, "Log services"),
        types.length ? Object.keys(groups).map((g) => h("div", { class: "ramp-group" }, h("h3", null, g), h("div", { class: "ramp-grid" }, groups[g].map(control))))
          : h("p", { class: "empty" }, "No services set up for " + f.station + " yet."),
        h("div", { class: "field" }, h("label", { for: "ramp-notes" }, "Note"), notes),
        h("div", { class: "row" }, save), status),
      h("section", { class: "panel" },
        h("h2", null, `Logged (${shown.length})`),
        shown.length ? h("ul", { class: "ramp-logged" }, shown.map((l) => h("li", null,
          h("span", null, h("b", null, describe(l.quantity, l.service_types ? l.service_types.name : "Service", l.service_types && l.service_types.unit)),
            h("span", { class: "sub" }, `${l.logged_by_name || "–"} · ${when(l.logged_at)}${l.notes ? " · " + l.notes : ""}`)),
          statusOf(l),
          (l.logged_by === me || isMgmt) && ["pending", "sent", "failed"].indexOf(l.status) !== -1
            ? h("button", { class: "linkish", type: "button", onclick: async function () {
                if (!confirm("Remove this entry? It is taken out of the Notion Services Log too.")) return;
                const { error } = await db.from("service_logs").update({ status: "remove" }).eq("id", l.id);
                if (error) { notice = { text: error.message }; } else { await push(); notice = { text: "Entry removed." }; }
                reload(); } }, "Remove") : null)))
          : h("p", { class: "empty" }, "Nothing logged yet.")),
      h("section", { class: "panel" },
        f.services_complete || (done && done.status !== "failed")
          ? h("p", { class: "ramp-complete" }, "✓ Services complete", h("span", { class: "sub" }, f.services_checked || (done ? `${done.done_by_name} · ${when(done.done_at)}` : "")))
          : h("div", { class: "row" },
              h("button", { class: "btn", type: "button", onclick: async function (e) {
                if (!shown.length && !confirm("Nothing has been logged on this flight. Mark it complete anyway?")) return;
                e.currentTarget.disabled = true;
                const { error } = await db.from("flight_completions").insert({ flight_id: f.id });
                if (error) { notice = { text: error.message }; } else { await push(); notice = { text: "Services marked complete in Notion." }; }
                reload(); } }, "Services complete"),
              h("span", { class: "fineprint" }, "When everything for this flight is logged."))));
  }

  window.IAARamp = { render: render };
})();
