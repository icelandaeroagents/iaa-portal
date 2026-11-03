/* Iceland Aero Agents – Staff Portal
   Equipment Info: each station's equipment (Lav Unit, Water Unit, GPU, Tug,
   Air Stairs), where it is kept, important notes, whether it is in service,
   and its latest battery / fuel / tank levels.
   – Everyone can read, and log a level check and/or a comment.
   – Management, and station leads for their own stations, add, edit and
     remove equipment and choose which levels each item tracks. */

(function () {
  "use strict";

  // Types are free text. These are the starting suggestions; management can
  // type any other type, and every type in use is suggested from then on.
  const STARTER_TYPES = ["Lav Unit", "Water Unit", "GPU", "Tug", "Air Stairs"];
  // Levels tracked by default for each starter type (can be changed per item).
  const DEFAULT_LEVELS = { "lav unit": ["tank"], "water unit": ["tank"], "gpu": ["fuel"], "tug": ["fuel"], "air stairs": ["battery"] };
  let knownTypes = STARTER_TYPES.slice();
  const LEVELS = ["battery", "fuel", "tank"];
  const LOW = 25;   // % at or below which a level is flagged

  let station = null;
  let search = "";
  let editing = null;   // item id or "new"
  let logging = null;   // item id with the check/comment form open
  let openHistory = new Set();
  let notice = null;

  window.IAAEquipment = { render: render };

  function canEdit(profile, code) {
    return profile.role === "management" ||
      (profile.role === "station_lead" && (profile.station_codes || []).indexOf(code) !== -1);
  }
  function isLav(type) { return /\blav/i.test(String(type || "")); }
  function levelName(level, type) {
    if (level === "tank") return isLav(type) ? "Waste tank" : /water/i.test(String(type || "")) ? "Water tank" : "Tank";
    return level === "battery" ? "Battery" : "Fuel";
  }
  function when(v) {
    return new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  // For a waste tank, FULL is the problem; for everything else, EMPTY is.
  function isLow(level, category, pct) {
    if (pct === null || pct === undefined) return false;
    return level === "tank" && isLav(category) ? pct >= 100 - LOW : pct <= LOW;
  }

  async function render(main, ctx) {
    const { h, fill, pageHead, state } = ctx;
    const stations = (state.stations || []).filter((s) => s.active);
    if (!station || !stations.some((s) => s.code === station)) {
      const mine = (state.profile.station_codes || []).find((c) => stations.some((s) => s.code === c));
      station = mine || (stations[0] && stations[0].code) || null;
    }
    fill(main, pageHead("Equipment Info"), h("p", { class: "empty" }, "Loading equipment…"));

    const res = await ctx.db.from("equipment").select("*").order("station_code").order("category").order("name");
    if (res.error) throw res.error;
    const all = res.data || [];
    const seen = new Map();
    STARTER_TYPES.concat(all.map((e) => e.category)).forEach(function (t) {
      const k = String(t || "").trim();
      if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k);
    });
    knownTypes = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    const here = all.filter((e) => e.station_code === station);
    let logs = [];
    if (here.length) {
      const lr = await ctx.db.from("equipment_logs").select("*").in("equipment_id", here.map((e) => e.id)).order("created_at", { ascending: false }).limit(1000);
      logs = lr.error ? [] : lr.data || [];
    }
    const logsFor = (id) => logs.filter((l) => l.equipment_id === id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const q = search.trim().toLowerCase();
    const list = here.filter((e) => !q || [e.name, e.category, e.location, e.notes].concat(logsFor(e.id).map((l) => l.comment || "")).join(" ").toLowerCase().indexOf(q) !== -1);
    const editable = station && canEdit(state.profile, station);

    const tabs = h("nav", { class: "tabs", "aria-label": "Stations" }, stations.map((s) =>
      h("a", {
        href: "#/equipment",
        "aria-current": s.code === station ? "page" : null,
        onclick: function (e) { e.preventDefault(); station = s.code; editing = null; logging = null; render(main, ctx); }
      }, `${s.code} (${all.filter((x) => x.station_code === s.code).length})`)));

    const searchBox = h("input", { id: "eq-search", type: "search", value: search, placeholder: "Search name, location, notes or comments" });
    searchBox.addEventListener("input", function () {
      search = searchBox.value;
      clearTimeout(searchBox._t);
      searchBox._t = setTimeout(function () {
        render(main, ctx).then(function () { const b = document.getElementById("eq-search"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } });
      }, 250);
    });

    // Warnings: out of service, and levels that need attention.
    const out = here.filter((e) => e.status === "out_of_service");
    const lowItems = here.filter(function (e) {
      return (e.levels || []).some(function (lv) {
        const latest = logsFor(e.id).find((l) => l[lv + "_pct"] !== null && l[lv + "_pct"] !== undefined);
        return latest && isLow(lv, e.category, latest[lv + "_pct"]);
      });
    });
    const warnings = [];
    if (out.length) warnings.push(`${out.length} out of service: ${out.map((e) => e.name).join(", ")}`);
    if (lowItems.length) warnings.push(`Levels need attention: ${lowItems.map((e) => e.name).join(", ")}`);

    const n = notice; notice = null;
    fill(
      main,
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Equipment Info"), h("p", null, "Where equipment is kept at each station, its levels, and anything important to know about it.")),
        editable && editing !== "new" ? h("button", { class: "btn", type: "button", onclick: function () { editing = "new"; render(main, ctx); } }, "Add equipment") : null),
      tabs,
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      warnings.length ? h("div", { class: "notice is-error" }, warnings.map((w) => h("div", null, w))) : null,
      h("div", { class: "row" }, h("div", { class: "field" }, h("label", { for: "eq-search" }, "Search"), searchBox)),
      editing === "new" ? h("section", { class: "panel" }, editorForm(ctx, main, null)) : null,
      list.length
        ? h("div", { class: "equipment-grid" }, list.map((e) => (editing === e.id
            ? h("section", { class: "panel" }, editorForm(ctx, main, e))
            : card(ctx, main, e, logsFor(e.id), editable))))
        : h("section", { class: "panel" }, h("p", { class: "empty" }, q ? "Nothing matches your search." : `No equipment added for ${station} yet.` + (editable ? " Use Add equipment to start the list." : "")))
    );
  }

  function card(ctx, main, e, itemLogs, editable) {
    const { h, state } = ctx;
    const levels = (e.levels || []).map(function (lv) {
      const latest = itemLogs.find((l) => l[lv + "_pct"] !== null && l[lv + "_pct"] !== undefined);
      const pct = latest ? latest[lv + "_pct"] : null;
      const low = isLow(lv, e.category, pct);
      return h("div", { class: "level" + (low ? " is-low" : "") },
        h("div", { class: "level-head" }, h("span", null, levelName(lv, e.category)), h("b", null, pct === null ? "Not checked" : pct + "%")),
        h("div", { class: "level-bar", role: "img", "aria-label": levelName(lv, e.category) + " " + (pct === null ? "not checked" : pct + "%") },
          h("span", { style: "width:" + (pct || 0) + "%" })),
        latest ? h("span", { class: "sub" }, when(latest.created_at) + (latest.author_name ? " · " + latest.author_name : "")) : null);
    });
    const lastComment = itemLogs.find((l) => l.comment);

    const history = openHistory.has(e.id)
      ? h("ul", { class: "eq-history" }, itemLogs.map(function (l) {
          const bits = LEVELS.filter((lv) => l[lv + "_pct"] !== null && l[lv + "_pct"] !== undefined).map((lv) => `${levelName(lv, e.category)} ${l[lv + "_pct"]}%`);
          const mine = l.created_by === state.profile.id || state.profile.role === "management";
          return h("li", null,
            h("span", { class: "sub" }, when(l.created_at) + (l.author_name ? " · " + l.author_name : "")),
            bits.length ? h("span", null, bits.join(" · ")) : null,
            l.comment ? h("span", { class: "prewrap" }, l.comment) : null,
            mine ? h("button", { class: "linkish", type: "button", onclick: async function () {
              if (!confirm("Remove this entry?")) return;
              const { error } = await ctx.db.from("equipment_logs").delete().eq("id", l.id);
              notice = error ? { text: error.message, isError: true } : { text: "Entry removed." };
              render(main, ctx);
            } }, "Remove") : null);
        }))
      : null;

    return h("article", { class: "panel eq-card" + (e.status === "out_of_service" ? " is-out" : "") },
      h("div", { class: "eq-head" },
        h("div", null, h("h2", null, e.name), h("span", { class: "sub" }, e.category || "")),
        e.status === "out_of_service" ? h("span", { class: "chip chip-sev-high" }, "Out of service") : h("span", { class: "chip chip-pass" }, "In service")),
      e.location ? h("p", { class: "eq-line" }, h("b", null, "Location: "), h("span", { class: "prewrap" }, e.location)) : null,
      e.notes ? h("p", { class: "eq-line" }, h("b", null, "Notes: "), h("span", { class: "prewrap" }, e.notes)) : null,
      levels.length ? h("div", { class: "levels" }, levels) : null,
      lastComment ? h("div", { class: "eq-comment" },
        h("span", { class: "sub" }, "Latest comment · " + when(lastComment.created_at) + (lastComment.author_name ? " · " + lastComment.author_name : "")),
        h("p", { class: "prewrap" }, lastComment.comment)) : null,
      logging === e.id ? logForm(ctx, main, e) : null,
      h("div", { class: "row row-tight" },
        logging !== e.id ? h("button", { class: "btn btn-small", type: "button", onclick: function () { logging = e.id; render(main, ctx); } }, (e.levels || []).length ? "Log check or comment" : "Add comment") : null,
        itemLogs.length ? h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () {
          if (openHistory.has(e.id)) openHistory.delete(e.id); else openHistory.add(e.id);
          render(main, ctx);
        } }, openHistory.has(e.id) ? "Hide history" : `History (${itemLogs.length})`) : null,
        editable ? h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { editing = e.id; logging = null; render(main, ctx); } }, "Edit") : null),
      history,
      h("p", { class: "sub" }, "Details updated " + new Date(e.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + (e.updated_by_name ? " by " + e.updated_by_name : "")));
  }

  function logForm(ctx, main, e) {
    const { h, setStatus } = ctx;
    const inputs = {};
    const fields = (e.levels || []).map(function (lv) {
      inputs[lv] = h("input", { type: "number", min: "0", max: "100", step: "5", inputmode: "numeric", placeholder: "%", id: "lg-" + lv, class: "pct-input" });
      return h("div", { class: "field" }, h("label", { for: "lg-" + lv }, levelName(lv, e.category) + " (%)"), inputs[lv]);
    });
    const comment = h("textarea", { id: "lg-comment", rows: "2", placeholder: "e.g. Refuelled, tyre looks soft, left at stand 5" });
    const msg = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "submit" }, "Save");
    return h("form", {
      class: "eq-log",
      onsubmit: async function (ev) {
        ev.preventDefault();
        const row = { equipment_id: e.id, comment: comment.value.trim() || null };
        let any = !!row.comment;
        for (const lv of Object.keys(inputs)) {
          const raw = inputs[lv].value.trim();
          if (raw === "") continue;
          const v = Math.round(Number(raw));
          if (!(v >= 0 && v <= 100)) { setStatus(msg, levelName(lv, e.category) + " must be between 0 and 100%.", true); return; }
          row[lv + "_pct"] = v;
          any = true;
        }
        if (!any) { setStatus(msg, "Enter a level or a comment.", true); return; }
        save.disabled = true;
        const { error } = await ctx.db.from("equipment_logs").insert(row);
        save.disabled = false;
        if (error) { setStatus(msg, error.message, true); return; }
        notice = { text: `Saved for ${e.name}.` };
        logging = null;
        render(main, ctx);
      }
    },
      fields.length ? h("div", { class: "form-grid" }, fields) : null,
      h("div", { class: "field field-wide" }, h("label", { for: "lg-comment" }, "Comment (optional)"), comment),
      h("div", { class: "row row-tight" }, save, h("button", { class: "btn btn-quiet", type: "button", onclick: function () { logging = null; render(main, ctx); } }, "Cancel")),
      msg);
  }

  function editorForm(ctx, main, e) {
    const { h, setStatus } = ctx;
    const name = h("input", { id: "eq-name", type: "text", required: true, value: e ? e.name : "", placeholder: "e.g. GPU 1, Tug 2, Air Stairs 1" });
    const isManagement = ctx.state.profile.role === "management";
    let cat;
    if (isManagement) {
      const listId = "eq-types";
      cat = h("input", { id: "eq-cat", type: "text", list: listId, maxlength: "40", required: true, value: e ? e.category : "GPU", placeholder: "Choose or type a new type", autocomplete: "off" });
      cat._list = h("datalist", { id: listId }, knownTypes.map((t) => h("option", { value: t })));
    } else {
      const types = knownTypes.slice();
      if (e && types.indexOf(e.category) === -1) types.push(e.category);
      cat = h("select", { id: "eq-cat" }, types.map((t) => h("option", { value: t, selected: e ? e.category === t : t === "GPU" }, t)));
    }
    const loc = h("textarea", { id: "eq-loc", rows: "2", placeholder: "e.g. Storage behind the FBO, left side" });
    loc.value = e ? e.location || "" : "";
    const notes = h("textarea", { id: "eq-notes", rows: "3", placeholder: "e.g. Key on the hook by the door. Charge overnight in winter." });
    notes.value = e ? e.notes || "" : "";
    const status = h("select", { id: "eq-status" },
      h("option", { value: "in_service", selected: !e || e.status === "in_service" }, "In service"),
      h("option", { value: "out_of_service", selected: e && e.status === "out_of_service" }, "Out of service"));
    const chosen = new Set(e ? e.levels || [] : DEFAULT_LEVELS.gpu);
    // Match a typed type to a known one regardless of capitals ("gpu" → "GPU").
    function tidyType(v) {
      const t = String(v || "").trim().replace(/\s+/g, " ");
      const known = knownTypes.find((k) => k.toLowerCase() === t.toLowerCase());
      return known || t;
    }
    const levelBoxes = h("div", { class: "row row-tight" });
    function drawLevels() {
      levelBoxes.replaceChildren.apply(levelBoxes, LEVELS.map(function (lv) {
        const b = h("input", { type: "checkbox", checked: chosen.has(lv), onchange: function (ev) { if (ev.target.checked) chosen.add(lv); else chosen.delete(lv); } });
        return h("label", { class: "choice choice-inline" }, b, h("span", null, levelName(lv, cat.value)));
      }));
    }
    function typeChanged() {
      if (!e) { chosen.clear(); (DEFAULT_LEVELS[tidyType(cat.value).toLowerCase()] || []).forEach((lv) => chosen.add(lv)); }
      drawLevels();
    }
    cat.addEventListener("change", typeChanged);
    if (isManagement) cat.addEventListener("input", typeChanged);
    drawLevels();

    const msg = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "submit" }, e ? "Save changes" : "Add");
    const del = e ? h("button", { class: "btn btn-danger", type: "button", onclick: async function () {
      if (!confirm(`Remove ${e.name} from the ${e.station_code} list? Its level checks and comments are removed too.`)) return;
      const { error } = await ctx.db.from("equipment").delete().eq("id", e.id);
      if (error) { setStatus(msg, error.message, true); return; }
      await ctx.logEvent("equipment_removed", { id: e.id, name: e.name, station_code: e.station_code });
      notice = { text: `${e.name} removed.` };
      editing = null;
      render(main, ctx);
    } }, "Remove") : null;

    return h("form", {
      class: "equipment-editor",
      onsubmit: async function (ev) {
        ev.preventDefault();
        if (!name.value.trim()) { setStatus(msg, "Give the equipment a name.", true); name.focus(); return; }
        const type = tidyType(cat.value);
        if (!type) { setStatus(msg, "Choose or type the type of equipment.", true); cat.focus(); return; }
        save.disabled = true;
        const row = {
          station_code: e ? e.station_code : station,
          name: name.value.trim(), category: type,
          location: loc.value.trim() || null, notes: notes.value.trim() || null, status: status.value,
          levels: LEVELS.filter((lv) => chosen.has(lv))
        };
        const res = e
          ? await ctx.db.from("equipment").update(row).eq("id", e.id)
          : await ctx.db.from("equipment").insert(row);
        save.disabled = false;
        if (res.error) { setStatus(msg, res.error.message, true); return; }
        await ctx.logEvent(e ? "equipment_edited" : "equipment_added", { name: row.name, station_code: row.station_code, status: row.status });
        notice = { text: e ? `${row.name} updated.` : `${row.name} added to ${row.station_code}.` };
        editing = null;
        render(main, ctx);
      }
    },
      h("h2", null, e ? `Edit ${e.name}` : `Add equipment at ${station}`),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "eq-name" }, "Name"), name),
        h("div", { class: "field" }, h("label", { for: "eq-cat" }, "Type"), cat, cat._list || null,
          isManagement ? h("span", { class: "help" }, "Pick a type or type a new one.") : null),
        h("div", { class: "field" }, h("label", { for: "eq-status" }, "Status"), status)),
      h("div", { class: "field field-wide" }, h("span", { class: "label" }, "Levels to track"), levelBoxes),
      h("div", { class: "field field-wide" }, h("label", { for: "eq-loc" }, "Location"), loc),
      h("div", { class: "field field-wide" }, h("label", { for: "eq-notes" }, "Important information or notes"), notes),
      h("div", { class: "row" }, save, h("button", { class: "btn btn-quiet", type: "button", onclick: function () { editing = null; render(main, ctx); } }, "Cancel"), del),
      msg);
  }
})();
