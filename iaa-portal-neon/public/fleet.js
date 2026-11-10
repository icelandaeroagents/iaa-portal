// =====================================================================
// Iceland Aero Agents – Staff Portal
// GSE and vehicle register (Management → Equipment)
//
// The register required by the GSE Maintenance Programme (GH-GSE-001) and
// Regulation (EU) 2025/20, Subpart ORGH.GSE: each unit's details, service
// and inspection dates, airport passes, and a maintenance log.
// Management only (database update 29). Daily checks stay in Equipment Info.
// =====================================================================
(function () {
  "use strict";

  const TYPES = {
    acceptance: "Acceptance inspection", pre_season: "Pre-season inspection", preventive: "Preventive maintenance",
    statutory: "Statutory inspection (VER)", vehicle_inspection: "Vehicle inspection (skoðun)", defect: "Defect",
    repair: "Repair", release: "Release to service", recall: "Recall or bulletin", water_test: "Water quality test", other: "Other"
  };
  const SETS_LAST = ["acceptance", "pre_season", "preventive", "statutory"];
  const IN_SERVICE = { yes: "In service", no: "Out of service", planned: "Planned" };

  let filter = { kind: "all", station: "all", show: "all" };
  let openId = null;      // unit shown on its own page, or "new"
  let notice = null;

  // ------------------------------------------------------------------
  // Dates and status
  // ------------------------------------------------------------------
  function today() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function plusDays(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
  function addMonths(iso, m) {
    const d = new Date(iso + "T12:00:00Z"); const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10);
  }
  function fmt(iso) { if (!iso) return "–"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}.${m}.${y}`; }

  // When the next service is due: the date recorded, or last service + interval.
  function serviceDue(u) {
    if (u.next_due_on) return u.next_due_on;
    if (u.last_service_on && u.service_interval_months) return addMonths(u.last_service_on, u.service_interval_months);
    return null;
  }
  function passes(u) {
    return [["BIRK", u.pass_birk], ["BIKF", u.pass_bikf], ["BIAR", u.pass_biar]].filter((p) => p[1]);
  }
  function issues(u) {
    if (u.removed_on || u.in_service === "planned") return [];
    const out = []; const t = today(), soon = plusDays(30);
    const check = (date, what) => {
      if (!date) return;
      if (date < t) out.push({ level: "bad", text: `${what} overdue since ${fmt(date)}` });
      else if (date <= soon) out.push({ level: "warn", text: `${what} due ${fmt(date)}` });
    };
    check(serviceDue(u), "Service");
    check(u.inspection_due_on, u.kind === "vehicle" ? "Vehicle inspection" : "Inspection");
    passes(u).forEach(([st, d]) => {
      if (d < t) out.push({ level: "bad", text: `${st} airport pass expired ${fmt(d)}` });
      else if (d <= soon) out.push({ level: "warn", text: `${st} airport pass expires ${fmt(d)}` });
    });
    if (u.in_service === "no") out.push({ level: "warn", text: "Out of service" });
    return out;
  }
  function status(u) {
    if (u.removed_on) return ["Removed", "chip-none"];
    if (u.in_service === "planned") return ["Planned", "chip-none"];
    const is = issues(u);
    if (is.some((i) => i.level === "bad")) return ["Action needed", "chip-sev-high"];
    if (is.length) return [u.in_service === "no" && is.length === 1 ? "Out of service" : "Due soon", "chip-status-new"];
    if (!serviceDue(u) && !u.inspection_due_on && !passes(u).length) return ["No dates recorded", "chip-none"];
    return ["OK", "chip-pass"];
  }

  // Short lines for Home and the Management overview.
  async function attention(db) {
    const res = await db.from("fleet_units").select("*").is("removed_on", null);
    if (res.error) return [];
    const units = res.data || [];
    const t = today();
    const svc = units.filter((u) => u.in_service === "yes" && serviceDue(u) && serviceDue(u) < t).length;
    const insp = units.filter((u) => u.in_service === "yes" && u.inspection_due_on && u.inspection_due_on < t).length;
    const pass = units.filter((u) => u.in_service === "yes" && passes(u).some((p) => p[1] < t)).length;
    const out = [];
    if (svc) out.push(`${svc} ${svc === 1 ? "unit is" : "units are"} overdue for service`);
    if (insp) out.push(`${insp} ${insp === 1 ? "vehicle or unit is" : "vehicles or units are"} overdue for inspection`);
    if (pass) out.push(`${pass} ${pass === 1 ? "unit has" : "units have"} an expired airport pass`);
    return out;
  }

  // ------------------------------------------------------------------
  // Register list
  // ------------------------------------------------------------------
  async function view(ctx, main, rerender) {
    const { h } = ctx;
    if (openId !== null) return detail(ctx, main, rerender);
    const res = await ctx.db.from("fleet_units").select("*").order("kind").order("ref");
    if (res.error) return h("section", { class: "panel" }, h("p", { class: "empty" }, "The equipment register isn’t set up yet (database update 29)."));
    const all = res.data || [];
    const active = all.filter((u) => !u.removed_on);
    const removed = all.filter((u) => u.removed_on);
    const stations = Array.from(new Set(active.map((u) => u.station).filter(Boolean))).sort();
    const shown = active.filter((u) =>
      (filter.kind === "all" || u.kind === filter.kind) &&
      (filter.station === "all" || u.station === filter.station || String(u.station || "").split("/").indexOf(filter.station) !== -1) &&
      (filter.show === "all" ||
        (filter.show === "attention" && issues(u).length) ||
        (filter.show === "out" && u.in_service === "no") ||
        (filter.show === "planned" && u.in_service === "planned")));
    shown.sort((a, b) => rank(a) - rank(b) || a.ref.localeCompare(b.ref));

    const n = notice; notice = null;
    const bad = active.filter((u) => issues(u).some((i) => i.level === "bad")).length;
    const warn = active.filter((u) => !issues(u).some((i) => i.level === "bad") && issues(u).length).length;
    const sel = (id, label, value, options, key) => h("div", { class: "field" }, h("label", { for: id }, label),
      h("select", { id: id, onchange: function (e) { filter[key] = e.target.value; rerender(); } },
        options.map(([v, t]) => h("option", { value: v, selected: v === value }, t))));

    return h("div", null,
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      h("div", { class: "stat-grid" },
        stat(h, bad, "Need action now", bad ? "is-bad" : ""),
        stat(h, warn, "Due within 30 days or out of service", warn ? "is-warn" : ""),
        stat(h, active.filter((u) => u.kind === "gse").length, "GSE units", ""),
        stat(h, active.filter((u) => u.kind === "vehicle").length, "Vehicles", "")),
      h("section", { class: "panel" },
        h("p", { class: "fineprint" }, "The register required by the GSE Maintenance Programme (GH-GSE-001). Next service is the date recorded, or last service plus the service interval. Daily checks and levels stay in Equipment Info; car servicing in the Car Maintenance Tracker."),
        h("div", { class: "form-grid filters" },
          sel("fl-kind", "Type", filter.kind, [["all", "GSE and vehicles"], ["gse", "GSE"], ["vehicle", "Vehicles"]], "kind"),
          sel("fl-st", "Station", filter.station, [["all", "All"]].concat(stations.map((s) => [s, s])), "station"),
          sel("fl-show", "Show", filter.show, [["all", "All"], ["attention", "Needs attention"], ["out", "Out of service"], ["planned", "Planned"]], "show")),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", onclick: function () { openId = "new"; rerender(); } }, "Add unit"),
          h("button", { class: "btn btn-quiet", type: "button", onclick: function () { exportCsv(active); } }, "Export CSV")),
        shown.length
          ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table fleet-table" },
              h("thead", null, h("tr", null, h("th", null, "Ref"), h("th", null, "Unit"), h("th", null, "Station"), h("th", null, "Next service or inspection"), h("th", null, "Airport pass"), h("th", null, "Status"))),
              h("tbody", null, shown.map((u) => {
                const st = status(u); const is = issues(u);
                const due = [serviceDue(u) ? "Service " + fmt(serviceDue(u)) : null, u.inspection_due_on ? "Inspection " + fmt(u.inspection_due_on) : null].filter(Boolean);
                const ps = passes(u);
                return h("tr", { class: "is-clickable", onclick: function () { openId = u.id; rerender(); } },
                  h("td", null, h("b", null, u.ref)),
                  h("td", null, u.kind === "vehicle" ? (u.make_model || "Vehicle") : u.item_type, h("span", { class: "sub" }, u.kind === "vehicle" ? (u.year_made || "") : [u.make_model, u.qty > 1 ? "× " + u.qty : null].filter(Boolean).join(" "))),
                  h("td", null, u.station || "–"),
                  h("td", null, due.length ? due.join(" · ") : "–"),
                  h("td", null, ps.length ? ps.map((p) => `${p[0]} ${fmt(p[1])}`).join(" · ") : (u.pass_note ? h("span", { class: "sub" }, u.pass_note) : "–")),
                  h("td", null, h("span", { class: "chip " + st[1] }, st[0]), is.length ? h("span", { class: "sub" }, is.map((i) => i.text).join(" · ")) : null));
              }))))
          : h("p", { class: "empty" }, "Nothing matches these filters.")),
      removed.length
        ? h("details", { class: "panel" },
            h("summary", null, `Removed from service (${removed.length})`),
            h("p", { class: "fineprint" }, "Records are kept at least 24 months after a unit leaves service (ORGH.DOC.105)."),
            h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
              h("thead", null, h("tr", null, h("th", null, "Ref"), h("th", null, "Unit"), h("th", null, "Removed"), h("th", null, "Reason"), h("th", null, "Keep records until"))),
              h("tbody", null, removed.map((u) => h("tr", { class: "is-clickable", onclick: function () { openId = u.id; rerender(); } },
                h("td", null, u.ref), h("td", null, [u.item_type, u.make_model].filter(Boolean).join(" – ")), h("td", null, fmt(u.removed_on)),
                h("td", null, u.removed_reason || "–"), h("td", null, fmt(addMonths(u.removed_on, 24)))))))))
        : null);
  }
  function rank(u) {
    const s = status(u)[0];
    return s === "Action needed" ? 0 : s === "Due soon" || s === "Out of service" ? 1 : s === "No dates recorded" ? 2 : s === "OK" ? 3 : 4;
  }
  function stat(h, n, label, cls) {
    return h("div", { class: "stat " + cls }, h("span", { class: "stat-n" }, String(n)), h("span", { class: "stat-label" }, label));
  }

  // ------------------------------------------------------------------
  // One unit: details, status and maintenance log
  // ------------------------------------------------------------------
  async function detail(ctx, main, rerender) {
    const { h, db } = ctx;
    const isNew = openId === "new";
    let u = { kind: "gse", qty: 1, in_service: "yes" };
    let log = [];
    if (!isNew) {
      const r = await db.from("fleet_units").select("*").eq("id", openId).single();
      if (r.error) { openId = null; notice = { text: r.error.message, isError: true }; return view(ctx, main, rerender); }
      u = r.data;
      const lr = await db.from("fleet_log").select("*").eq("unit_id", u.id).order("done_on", { ascending: false }).order("id", { ascending: false });
      log = lr.data || [];
    }
    const eq = await db.from("equipment").select("id, name, station_code").order("station_code").order("name");
    const cards = eq.data || [];
    const back = function () { openId = null; rerender(); };
    const n = notice; notice = null;

    // --- form fields
    const inp = (key, type, attrs) => h("input", Object.assign({ id: "fu-" + key, type: type || "text", value: u[key] == null ? "" : String(u[key]) }, attrs || {}));
    const f = {
      ref: inp("ref", "text", { required: true }), item_type: inp("item_type", "text", { required: true }), make_model: inp("make_model"),
      station: inp("station", "text", { placeholder: "e.g. BIRK or BIRK/BIKF" }), qty: inp("qty", "number", { min: 1 }),
      serial_no: inp("serial_no"), year_made: inp("year_made", "number"), registration_no: inp("registration_no"),
      condition: inp("condition"), ownership: inp("ownership"), suitable_aircraft: inp("suitable_aircraft"), maintenance_provider: inp("maintenance_provider"),
      delivered_on: inp("delivered_on", "date"), last_service_on: inp("last_service_on", "date"), service_interval_months: inp("service_interval_months", "number", { min: 1 }),
      next_due_on: inp("next_due_on", "date"), inspection_due_on: inp("inspection_due_on", "date"), odometer_km: inp("odometer_km", "number", { min: 0 }),
      pass_birk: inp("pass_birk", "date"), pass_bikf: inp("pass_bikf", "date"), pass_biar: inp("pass_biar", "date"),
      pass_note: inp("pass_note"), runway_crossing: inp("runway_crossing"),
      remarks: h("textarea", { id: "fu-remarks", rows: 3 }, u.remarks || "")
    };
    f.kind = h("select", { id: "fu-kind" }, [["gse", "GSE"], ["vehicle", "Vehicle"]].map(([v, t]) => h("option", { value: v, selected: u.kind === v }, t)));
    f.in_service = h("select", { id: "fu-in" }, Object.keys(IN_SERVICE).map((k) => h("option", { value: k, selected: u.in_service === k }, IN_SERVICE[k])));
    f.equipment_id = h("select", { id: "fu-eq" }, [h("option", { value: "" }, "Not linked")].concat(cards.map((c) => h("option", { value: c.id, selected: String(u.equipment_id) === String(c.id) }, `${c.station_code} – ${c.name}`))));
    const field = (key, label, hint, wide) => h("div", { class: "field" + (wide ? " field-wide" : "") }, h("label", { for: f[key].id }, label), f[key], hint ? h("span", { class: "hint" }, hint) : null);
    const msg = h("p", { class: "status", role: "status" });

    const collect = function () {
      const v = {};
      ["ref", "item_type", "make_model", "station", "serial_no", "registration_no", "condition", "ownership", "suitable_aircraft", "maintenance_provider", "pass_note", "runway_crossing"].forEach((k) => { v[k] = f[k].value.trim() || null; });
      ["qty", "year_made", "service_interval_months", "odometer_km"].forEach((k) => { v[k] = f[k].value === "" ? null : parseInt(f[k].value, 10); });
      ["delivered_on", "last_service_on", "next_due_on", "inspection_due_on", "pass_birk", "pass_bikf", "pass_biar"].forEach((k) => { v[k] = f[k].value || null; });
      v.remarks = f.remarks.value.trim() || null;
      v.kind = f.kind.value; v.in_service = f.in_service.value;
      v.equipment_id = f.equipment_id.value ? parseInt(f.equipment_id.value, 10) : null;
      if (!v.qty) v.qty = 1;
      return v;
    };
    const save = async function (e) {
      e.preventDefault();
      const v = collect();
      if (!v.ref || !v.item_type) { ctx.setStatus(msg, "Enter the reference and what the unit is.", true); return; }
      const res = isNew ? await db.from("fleet_units").insert(v).select("id").single() : await db.from("fleet_units").update(v).eq("id", u.id);
      if (res.error) { ctx.setStatus(msg, /duplicate|unique/i.test(res.error.message) ? "That reference is already used." : res.error.message, true); return; }
      await ctx.logEvent(isNew ? "fleet_unit_added" : "fleet_unit_updated", { ref: v.ref });
      notice = { text: `${v.ref} saved.` };
      if (isNew) openId = res.data.id;
      rerender();
    };
    const removeUnit = async function () {
      const why = prompt(`Remove ${u.ref} from service? Give the reason (for example sold, scrapped, returned to lessor). Its records are kept.`);
      if (!why || !why.trim()) return;
      const { error } = await db.from("fleet_units").update({ removed_on: today(), removed_reason: why.trim(), in_service: "no" }).eq("id", u.id);
      if (error) { ctx.setStatus(msg, error.message, true); return; }
      await ctx.logEvent("fleet_unit_removed", { ref: u.ref, reason: why.trim() });
      notice = { text: `${u.ref} removed from service. Its records are kept.` }; openId = null; rerender();
    };
    const restoreUnit = async function () {
      if (!confirm(`Return ${u.ref} to the register?`)) return;
      const { error } = await db.from("fleet_units").update({ removed_on: null, removed_reason: null, in_service: "yes" }).eq("id", u.id);
      if (error) { ctx.setStatus(msg, error.message, true); return; }
      notice = { text: `${u.ref} is back in the register.` }; rerender();
    };

    // --- maintenance log
    const lf = {
      done_on: h("input", { id: "fl-date", type: "date", value: today(), max: today(), required: true }),
      entry_type: h("select", { id: "fl-type" }, Object.keys(TYPES).map((k) => h("option", { value: k }, TYPES[k]))),
      work_done: h("input", { id: "fl-work", type: "text", placeholder: "What was done or found", required: true }),
      done_by: h("input", { id: "fl-by", type: "text", placeholder: "Workshop or person" }),
      evidence: h("input", { id: "fl-ev", type: "text", placeholder: "Work order or report number" }),
      released_by: h("input", { id: "fl-rel", type: "text", placeholder: "Name" }),
      released_on: h("input", { id: "fl-reld", type: "date", max: today() }),
      next_insp: h("input", { id: "fl-next", type: "date" }),
      next_svc: h("input", { id: "fl-nextsvc", type: "date" })
    };
    const setLast = h("input", { type: "checkbox", id: "fl-setlast", checked: true });
    const setLastRow = h("label", { class: "choice" }, setLast, h("span", null, "Make this the last service date"));
    const nextRow = h("div", { class: "field" }, h("label", { for: "fl-next" }, "Next vehicle inspection due"), lf.next_insp);
    const nextSvcRow = h("div", { class: "field" }, h("label", { for: "fl-nextsvc" }, "Next service due"), lf.next_svc,
      h("span", { class: "hint" }, u.service_interval_months ? `Leave empty to calculate it from the ${u.service_interval_months}-month interval` : "Required: this unit has no service interval set"));
    const syncType = function () {
      const sets = SETS_LAST.indexOf(lf.entry_type.value) !== -1;
      setLastRow.hidden = !sets;
      nextSvcRow.hidden = !sets || !setLast.checked;
      nextRow.hidden = lf.entry_type.value !== "vehicle_inspection";
    };
    setLast.addEventListener("change", syncType);
    lf.entry_type.addEventListener("change", syncType);
    if (u.kind === "vehicle") lf.entry_type.value = "vehicle_inspection";
    else lf.entry_type.value = "preventive";
    syncType();
    const lmsg = h("p", { class: "status", role: "status" });
    const addLog = async function (e) {
      e.preventDefault();
      if (!lf.work_done.value.trim()) { ctx.setStatus(lmsg, "Describe what was done or found.", true); return; }
      const settingLast = SETS_LAST.indexOf(lf.entry_type.value) !== -1 && setLast.checked;
      if (settingLast && !u.service_interval_months && !lf.next_svc.value) {
        ctx.setStatus(lmsg, "Enter when the next service is due, or set the service interval on this unit first.", true); return;
      }
      const row = { unit_id: u.id, done_on: lf.done_on.value, entry_type: lf.entry_type.value, work_done: lf.work_done.value.trim(),
        done_by: lf.done_by.value.trim() || null, evidence: lf.evidence.value.trim() || null,
        released_by: lf.released_by.value.trim() || null, released_on: lf.released_on.value || null };
      const { error } = await db.from("fleet_log").insert(row);
      if (error) { ctx.setStatus(lmsg, error.message, true); return; }
      const upd = {};
      if (settingLast) { upd.last_service_on = row.done_on; upd.next_due_on = lf.next_svc.value || null; }
      if (row.entry_type === "vehicle_inspection" && lf.next_insp.value) upd.inspection_due_on = lf.next_insp.value;
      if (row.entry_type === "defect") upd.in_service = "no";
      if (row.entry_type === "release") upd.in_service = "yes";
      if (Object.keys(upd).length) await db.from("fleet_units").update(upd).eq("id", u.id);
      await ctx.logEvent("fleet_log_added", { ref: u.ref, type: row.entry_type });
      notice = { text: "Logged." + (upd.in_service === "no" ? ` ${u.ref} is now out of service until released.` : upd.in_service === "yes" ? ` ${u.ref} is back in service.` : "") };
      rerender();
    };
    const delLog = async function (l) {
      if (!confirm("Delete this log entry? Only delete entries made by mistake.")) return;
      const { error } = await db.from("fleet_log").delete().eq("id", l.id);
      notice = error ? { text: error.message, isError: true } : { text: "Entry deleted." }; rerender();
    };

    const st = isNew ? null : status(u);
    const is = isNew ? [] : issues(u);
    return h("div", null,
      h("a", { class: "back-link", href: "#/management", onclick: function (e) { e.preventDefault(); back(); } }, "Equipment register"),
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      h("div", { class: "unit-head" },
        h("p", { class: "briefing-kicker" }, isNew ? "New unit" : `${u.ref} · ${u.kind === "vehicle" ? "Vehicle" : "GSE"}${u.station ? " · " + u.station : ""}`),
        h("h2", { class: "unit-title" }, isNew ? "Add unit" : (u.kind === "vehicle" ? (u.make_model || u.ref) : u.item_type)),
        st ? h("p", null, h("span", { class: "chip " + st[1] }, st[0]), u.removed_on ? ` Removed ${fmt(u.removed_on)}: ${u.removed_reason || ""}` : "") : null),
      is.length ? h("section", { class: "panel panel-attention" }, h("ul", { class: "attention-list" }, is.map((i) => h("li", null, i.text)))) : null,
      h("form", { class: "panel", onsubmit: save },
        h("h2", null, "Details"),
        h("div", { class: "form-grid" },
          field("ref", "Reference", "G-number for GSE, the plate for vehicles"), field("kind", "Type"), field("item_type", "What it is", "e.g. GPU, Tow tractor, Vehicle"),
          field("make_model", "Make and model"), field("station", "Station"), field("qty", "Quantity"),
          field("serial_no", "Serial number"), field("year_made", "Year"), field("registration_no", "Registration no."),
          field("condition", "Condition"), field("ownership", "Owner or financing"), field("in_service", "In service?")),
        h("h2", null, "Service and inspection"),
        h("div", { class: "form-grid" },
          field("maintenance_provider", "Maintenance provider"), field("service_interval_months", "Service interval (months)", "From the manufacturer’s manual"),
          field("last_service_on", "Last service"), field("next_due_on", "Next service due (if set)", "Leave empty to calculate from the interval"),
          field("inspection_due_on", "Next inspection due", "Vehicle skoðun, or statutory inspection"), field("delivered_on", "Delivered or accepted"),
          field("odometer_km", "Odometer (km)"), field("suitable_aircraft", "Suitable aircraft types", null, true)),
        h("h2", null, "Airside"),
        h("div", { class: "form-grid" },
          field("pass_birk", "Airport pass expires – BIRK"), field("pass_bikf", "Airport pass expires – BIKF"), field("pass_biar", "Airport pass expires – BIAR"),
          field("pass_note", "Pass notes", "e.g. renewal applied for", true), field("runway_crossing", "Runway crossing (BIRK)"),
          field("equipment_id", "Equipment Info card", "Link to the daily-check card for this unit")),
        h("div", { class: "field field-wide" }, h("label", { for: "fu-remarks" }, "Remarks"), f.remarks),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "submit" }, isNew ? "Add unit" : "Save"),
          !isNew && !u.removed_on ? h("button", { class: "btn btn-quiet", type: "button", onclick: removeUnit }, "Remove from service") : null,
          !isNew && u.removed_on ? h("button", { class: "btn btn-quiet", type: "button", onclick: restoreUnit }, "Return to the register") : null),
        msg,
        !isNew && u.updated_by_name ? h("p", { class: "fineprint" }, `Last changed by ${u.updated_by_name}, ${fmt(String(u.updated_at).slice(0, 10))}.`) : null),
      isNew ? null : h("section", { class: "panel" },
        h("h2", null, "Maintenance log"),
        h("p", { class: "fineprint" }, u.kind === "vehicle"
          ? "Record vehicle inspections here. Routine car servicing is kept in the Car Maintenance Tracker."
          : "Inspections, maintenance, defects, repairs and releases to service, with evidence. A defect takes the unit out of service until a release is logged."),
        log.length
          ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
              h("thead", null, h("tr", null, h("th", null, "Date"), h("th", null, "Type"), h("th", null, "Work done"), h("th", null, "By"), h("th", null, "Evidence"), h("th", null, "Released"), h("th", null, ""))),
              h("tbody", null, log.map((l) => h("tr", null,
                h("td", null, fmt(l.done_on)), h("td", null, TYPES[l.entry_type] || l.entry_type), h("td", null, l.work_done),
                h("td", null, l.done_by || "–", l.created_by_name ? h("span", { class: "sub" }, "Logged by " + l.created_by_name) : null),
                h("td", null, l.evidence || "–"),
                h("td", null, l.released_by ? `${l.released_by}${l.released_on ? ", " + fmt(l.released_on) : ""}` : "–"),
                h("td", null, h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { delLog(l); } }, "Delete")))))))
          : h("p", { class: "empty" }, "Nothing logged yet."),
        h("form", { class: "log-form", onsubmit: addLog },
          h("h3", null, "Add an entry"),
          h("div", { class: "form-grid" },
            h("div", { class: "field" }, h("label", { for: "fl-date" }, "Date"), lf.done_on),
            h("div", { class: "field" }, h("label", { for: "fl-type" }, "Type"), lf.entry_type),
            h("div", { class: "field" }, h("label", { for: "fl-by" }, "Done by"), lf.done_by),
            h("div", { class: "field field-wide" }, h("label", { for: "fl-work" }, "Work done or defect found"), lf.work_done),
            h("div", { class: "field" }, h("label", { for: "fl-ev" }, "Evidence"), lf.evidence),
            h("div", { class: "field" }, h("label", { for: "fl-rel" }, "Released to service by"), lf.released_by),
            h("div", { class: "field" }, h("label", { for: "fl-reld" }, "Release date"), lf.released_on),
            nextRow,
            nextSvcRow),
          setLastRow,
          h("div", { class: "row" }, h("button", { class: "btn", type: "submit" }, "Add to log")),
          lmsg)));
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  function exportCsv(units) {
    const cols = [["Ref", "ref"], ["Type", "kind"], ["Station", "station"], ["What it is", "item_type"], ["Make and model", "make_model"], ["Qty", "qty"],
      ["Serial", "serial_no"], ["Year", "year_made"], ["Registration", "registration_no"], ["Condition", "condition"], ["Owner or financing", "ownership"],
      ["Last service", "last_service_on"], ["Interval (months)", "service_interval_months"], ["Next service", null], ["Next inspection", "inspection_due_on"],
      ["Odometer", "odometer_km"], ["Pass BIRK", "pass_birk"], ["Pass BIKF", "pass_bikf"], ["Pass BIAR", "pass_biar"], ["Pass notes", "pass_note"],
      ["Runway crossing", "runway_crossing"], ["In service", "in_service"], ["Status", null], ["Remarks", "remarks"]];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map((c) => c[0]).join(",")].concat(units.map((u) => cols.map((c) =>
      esc(c[0] === "Next service" ? serviceDue(u) : c[0] === "Status" ? status(u)[0] + (issues(u).length ? " – " + issues(u).map((i) => i.text).join(" · ") : "") : u[c[1]])).join(",")));
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `IAA_GSE_and_vehicle_register_${today()}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function reset() { openId = null; }

  window.IAAFleet = { view: view, attention: attention, issues: issues, serviceDue: serviceDue, reset: reset };
})();
