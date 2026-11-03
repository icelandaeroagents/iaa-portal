/* Iceland Aero Agents – Staff Portal
   Equipment Info: where each piece of equipment is kept at each station,
   with important notes and whether it is in service. Everyone can read;
   management, and station leads for their own stations, can add, edit
   and remove. */

(function () {
  "use strict";

  const CATEGORIES = [
    ["gpu", "GPU"], ["tug", "Tug / pushback"], ["towbar", "Tow bar"], ["stairs", "Stairs"],
    ["vehicle", "Vehicle"], ["lavatory_water", "Lavatory / water"], ["safety", "Safety equipment"],
    ["tools", "Tools"], ["other", "Other"]
  ];
  const CAT = Object.fromEntries(CATEGORIES);
  let station = null;     // selected station tab
  let search = "";
  let editing = null;     // item id, or "new"
  let notice = null;

  window.IAAEquipment = { render: render };

  function canEdit(profile, code) {
    return profile.role === "management" ||
      (profile.role === "station_lead" && (profile.station_codes || []).indexOf(code) !== -1);
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
    const q = search.trim().toLowerCase();
    const list = all.filter((e) => e.station_code === station)
      .filter((e) => !q || [e.name, CAT[e.category], e.location, e.notes].join(" ").toLowerCase().indexOf(q) !== -1);
    const editable = station && canEdit(state.profile, station);

    const tabs = h("nav", { class: "tabs", "aria-label": "Stations" }, stations.map((s) =>
      h("a", {
        href: "#/equipment",
        "aria-current": s.code === station ? "page" : null,
        onclick: function (e) { e.preventDefault(); station = s.code; editing = null; render(main, ctx); }
      }, `${s.code} (${all.filter((x) => x.station_code === s.code).length})`)));

    const searchBox = h("input", { id: "eq-search", type: "search", value: search, placeholder: "Search name, location or notes" });
    searchBox.addEventListener("input", function () {
      search = searchBox.value;
      clearTimeout(searchBox._t);
      searchBox._t = setTimeout(function () { render(main, ctx).then(function () { const b = document.getElementById("eq-search"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }); }, 250);
    });

    const outCount = list.filter((e) => e.status === "out_of_service").length;
    const rows = list.map((e) => (editing === e.id ? editorRow(ctx, main, e) : itemRow(ctx, main, e, editable)));

    const n = notice; notice = null;
    fill(
      main,
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("h1", null, "Equipment Info"), h("p", null, "Where equipment is kept at each station, and anything important to know about it.")),
        editable && editing !== "new" ? h("button", { class: "btn", type: "button", onclick: function () { editing = "new"; render(main, ctx); } }, "Add equipment") : null),
      tabs,
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      h("div", { class: "row" }, h("div", { class: "field" }, h("label", { for: "eq-search" }, "Search"), searchBox)),
      outCount ? h("p", { class: "notice is-error" }, `${outCount} ${outCount === 1 ? "item is" : "items are"} out of service at ${station}.`) : null,
      editing === "new" ? h("section", { class: "panel" }, editorForm(ctx, main, null)) : null,
      h("section", { class: "panel" },
        list.length
          ? h("div", { class: "table-wrap" }, h("table", { class: "equipment-table" },
              h("thead", null, h("tr", null, h("th", null, "Equipment"), h("th", null, "Location"), h("th", null, "Notes"), h("th", null, "Status"), editable ? h("th", null, "") : null)),
              h("tbody", null, rows)))
          : h("p", { class: "empty" }, q ? "Nothing matches your search." : `No equipment added for ${station} yet.` + (editable ? " Use Add equipment to start the list." : "")))
    );
  }

  function itemRow(ctx, main, e, editable) {
    const { h } = ctx;
    return h("tr", { class: e.status === "out_of_service" ? "is-out" : null },
      h("td", null, h("b", null, e.name), h("span", { class: "sub" }, CAT[e.category] || "Other")),
      h("td", { class: "prewrap" }, e.location || "–"),
      h("td", { class: "prewrap" }, e.notes || "–",
        h("span", { class: "sub" }, "Updated " + new Date(e.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + (e.updated_by_name ? " by " + e.updated_by_name : ""))),
      h("td", null, e.status === "out_of_service" ? h("span", { class: "chip chip-sev-high" }, "Out of service") : h("span", { class: "chip chip-pass" }, "In service")),
      editable ? h("td", null, h("div", { class: "row row-tight" },
        h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { editing = e.id; render(main, ctx); } }, "Edit"))) : null);
  }

  function editorRow(ctx, main, e) {
    const { h } = ctx;
    return h("tr", null, h("td", { colspan: "5" }, editorForm(ctx, main, e)));
  }

  function editorForm(ctx, main, e) {
    const { h, setStatus } = ctx;
    const name = h("input", { id: "eq-name", type: "text", required: true, value: e ? e.name : "", placeholder: "e.g. GPU 1, Tug 2, Air-stairs" });
    const cat = h("select", { id: "eq-cat" }, CATEGORIES.map((c) => h("option", { value: c[0], selected: e ? e.category === c[0] : c[0] === "gpu" }, c[1])));
    const loc = h("textarea", { id: "eq-loc", rows: "2", placeholder: "e.g. Storage behind the FBO, left side" });
    loc.value = e ? e.location || "" : "";
    const notes = h("textarea", { id: "eq-notes", rows: "3", placeholder: "e.g. Key on the hook by the door. Charge overnight in winter." });
    notes.value = e ? e.notes || "" : "";
    const status = h("select", { id: "eq-status" },
      h("option", { value: "in_service", selected: !e || e.status === "in_service" }, "In service"),
      h("option", { value: "out_of_service", selected: e && e.status === "out_of_service" }, "Out of service"));
    const msg = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "submit" }, e ? "Save changes" : "Add");
    const del = e ? h("button", { class: "btn btn-danger", type: "button", onclick: async function () {
      if (!confirm(`Remove ${e.name} from the ${e.station_code} list?`)) return;
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
        save.disabled = true;
        const row = {
          station_code: e ? e.station_code : station,
          name: name.value.trim(), category: cat.value,
          location: loc.value.trim() || null, notes: notes.value.trim() || null, status: status.value
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
        h("div", { class: "field" }, h("label", { for: "eq-cat" }, "Type"), cat),
        h("div", { class: "field" }, h("label", { for: "eq-status" }, "Status"), status)),
      h("div", { class: "field field-wide" }, h("label", { for: "eq-loc" }, "Location"), loc),
      h("div", { class: "field field-wide" }, h("label", { for: "eq-notes" }, "Important information or notes"), notes),
      h("div", { class: "row" }, save, h("button", { class: "btn btn-quiet", type: "button", onclick: function () { editing = null; render(main, ctx); } }, "Cancel"), del),
      msg);
  }
})();
