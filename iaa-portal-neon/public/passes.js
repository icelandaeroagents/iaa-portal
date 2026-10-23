/* Iceland Aero Agents – Staff Portal
   Passes & certificates: each person records their airport passes,
   permits and certificates with expiry dates (no ID or card numbers).
   Reminder emails are sent by api/staff-notify.js. Management sees
   everyone and can add or correct entries for anyone. */

(function () {
  "use strict";

  const KINDS = [
    ["airport_pass", "Airport ID pass"],
    ["airside_driving", "Airside driving permit"],
    ["deicing", "De-icing"],
    ["first_aid", "First aid"],
    ["dangerous_goods", "Dangerous goods"],
    ["security", "Security training"],
    ["driving_licence", "Driving licence"],
    ["other", "Other"]
  ];
  const KIND_LABEL = Object.fromEntries(KINDS);
  let view = "mine";
  let notice = null;

  window.IAAPasses = { render: render, expiringCount: expiringCount };

  function daysLeft(d) {
    if (!d) return null;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    return Math.round((new Date(d + "T12:00:00") - today) / 86400000);
  }
  function fmt(d) {
    return d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  }
  function statusChip(h, d) {
    const n = daysLeft(d);
    if (n === null) return h("span", { class: "chip chip-none" }, "No expiry");
    if (n < 0) return h("span", { class: "chip chip-sev-high" }, "Expired");
    if (n <= 30) return h("span", { class: "chip chip-status-new" }, n === 0 ? "Expires today" : `${n} ${n === 1 ? "day" : "days"} left`);
    if (n <= 60) return h("span", { class: "chip chip-sev-medium" }, "Renew soon");
    return h("span", { class: "chip chip-pass" }, "Valid");
  }

  async function expiringCount(ctx) {
    const soon = new Date(); soon.setDate(soon.getDate() + 30);
    const pad = (n) => String(n).padStart(2, "0");
    const limit = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`;
    const res = await ctx.db.from("credentials").select("id").lte("expires_on", limit);
    return res.error ? 0 : (res.data || []).length;
  }

  async function render(main, ctx) {
    const isManagement = ctx.state.profile.role === "management";
    if (!isManagement) view = "mine";
    return view === "everyone" ? showEveryone(main, ctx) : showMine(main, ctx);
  }

  function tabs(ctx, main, active) {
    const { h } = ctx;
    if (ctx.state.profile.role !== "management") return null;
    return h("nav", { class: "tabs", "aria-label": "Passes views" },
      h("a", { href: "#/passes", "aria-current": active === "mine" ? "page" : null, onclick: function (e) { e.preventDefault(); view = "mine"; render(main, ctx); } }, "Mine"),
      h("a", { href: "#/passes", "aria-current": active === "everyone" ? "page" : null, onclick: function (e) { e.preventDefault(); view = "everyone"; render(main, ctx); } }, "Everyone"));
  }

  function noticeBox(ctx) {
    if (!notice) return null;
    const n = ctx.h("p", { class: notice.isError ? "notice is-error" : "notice" }, notice.text);
    notice = null;
    return n;
  }

  // A form to add or edit one entry. `people` is only passed for management.
  function editor(ctx, main, item, people, onDone) {
    const { h, setStatus, state } = ctx;
    const kind = h("select", { id: "p-kind" }, KINDS.map((k) => h("option", { value: k[0], selected: item ? item.kind === k[0] : k[0] === "airport_pass" }, k[1])));
    const label = h("input", { id: "p-label", type: "text", value: item ? item.label || "" : "", placeholder: "e.g. BIKF airport pass" });
    const issued = h("input", { id: "p-issued", type: "date", value: item ? item.issued_on || "" : "" });
    const expires = h("input", { id: "p-expires", type: "date", value: item ? item.expires_on || "" : "" });
    const note = h("input", { id: "p-note", type: "text", value: item ? item.note || "" : "", placeholder: "Optional" });
    const who = people
      ? h("select", { id: "p-who" }, people.map((p) => h("option", { value: p.id, selected: item ? item.profile_id === p.id : p.id === state.profile.id }, p.full_name || p.email)))
      : null;
    const status = h("p", { class: "status", role: "status" });
    const save = h("button", { class: "btn", type: "submit" }, item ? "Save changes" : "Add");

    return h("form", {
      class: "panel",
      onsubmit: async function (e) {
        e.preventDefault();
        if (!expires.value && kind.value !== "other") { setStatus(status, "Enter the expiry date.", true); return; }
        const row = {
          kind: kind.value, label: label.value.trim() || null,
          issued_on: issued.value || null, expires_on: expires.value || null, note: note.value.trim() || null,
          profile_id: who ? who.value : state.profile.id
        };
        save.disabled = true;
        const res = item
          ? await ctx.db.from("credentials").update(row).eq("id", item.id)
          : await ctx.db.from("credentials").insert(row);
        save.disabled = false;
        if (res.error) { setStatus(status, res.error.message, true); return; }
        notice = { text: item ? "Saved." : "Added. You’ll get an email reminder before it expires." };
        onDone();
      }
    },
      h("h2", null, item ? "Edit" : "Add a pass or certificate"),
      h("p", { class: "fineprint" }, "Only the type and dates are stored, never card or licence numbers."),
      h("div", { class: "form-grid" },
        who ? h("div", { class: "field" }, h("label", { for: "p-who" }, "Person"), who) : null,
        h("div", { class: "field" }, h("label", { for: "p-kind" }, "Type"), kind),
        h("div", { class: "field" }, h("label", { for: "p-label" }, "Name (optional)"), label),
        h("div", { class: "field" }, h("label", { for: "p-issued" }, "Issued"), issued),
        h("div", { class: "field" }, h("label", { for: "p-expires" }, "Expires"), expires),
        h("div", { class: "field" }, h("label", { for: "p-note" }, "Note"), note)),
      h("div", { class: "row" }, save, h("button", { class: "btn btn-quiet", type: "button", onclick: onDone }, "Cancel")),
      status);
  }

  async function showMine(main, ctx, editing) {
    const { h, fill, pageHead, state, setStatus } = ctx;
    fill(main, pageHead("Passes & certificates"), h("p", { class: "empty" }, "Loading…"));
    const res = await ctx.db.from("credentials").select("*").eq("profile_id", state.profile.id).order("expires_on", { ascending: true, nullsFirst: false });
    if (res.error) throw res.error;
    const items = res.data || [];
    const status = h("p", { class: "status", role: "status" });

    const rows = items.map(function (c) {
      const edit = h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { showMine(main, ctx, c); } }, "Edit");
      const remove = h("button", {
        class: "btn btn-quiet btn-small",
        type: "button",
        onclick: async function () {
          if (!confirm(`Remove ${c.label || KIND_LABEL[c.kind]}?`)) return;
          const { error } = await ctx.db.from("credentials").delete().eq("id", c.id);
          if (error) { setStatus(status, error.message, true); return; }
          showMine(main, ctx);
        }
      }, "Remove");
      return h("tr", null,
        h("td", null, c.label || KIND_LABEL[c.kind], c.label ? h("span", { class: "sub" }, KIND_LABEL[c.kind]) : null, c.note ? h("span", { class: "sub" }, c.note) : null),
        h("td", null, fmt(c.expires_on) || "–"),
        h("td", null, statusChip(h, c.expires_on)),
        h("td", null, h("div", { class: "row row-tight" }, edit, remove)));
    });

    const list = items.length
      ? h("div", { class: "table-wrap" },
          h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Pass or certificate"), h("th", null, "Expires"), h("th", null, "Status"), h("th", null, ""))),
            h("tbody", null, rows)))
      : h("p", { class: "empty" }, "Nothing added yet. Add your airport passes, permits and certificates so you’re reminded before they expire.");

    fill(main,
      pageHead("Passes & certificates", "You’re emailed 30 days and 7 days before anything expires, and management is copied."),
      tabs(ctx, main, "mine"),
      noticeBox(ctx),
      editing !== undefined ? editor(ctx, main, editing || null, null, function () { showMine(main, ctx); }) : null,
      h("section", { class: "panel" },
        h("div", { class: "row" }, editing === undefined ? h("button", { class: "btn", type: "button", onclick: function () { showMine(main, ctx, null); } }, "Add a pass or certificate") : null),
        list, status));
  }

  async function showEveryone(main, ctx, editing) {
    const { h, fill, pageHead } = ctx;
    fill(main, pageHead("Passes & certificates"), tabs(ctx, main, "everyone"), h("p", { class: "empty" }, "Loading…"));
    const [cRes, pRes] = await Promise.all([
      ctx.db.from("credentials").select("*").order("expires_on", { ascending: true, nullsFirst: false }),
      ctx.db.from("profiles").select("id, full_name, email, active").order("full_name", { nullsFirst: false })
    ]);
    if (cRes.error) throw cRes.error;
    const people = (pRes.data || []).filter((p) => p.active);
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    const items = (cRes.data || []).filter((c) => byId[c.profile_id]);
    const soon = items.filter((c) => { const n = daysLeft(c.expires_on); return n !== null && n <= 60; });
    const noneYet = people.filter((p) => !items.some((c) => c.profile_id === p.id));

    const row = (c) => h("tr", null,
      h("td", null, (byId[c.profile_id] || {}).full_name || (byId[c.profile_id] || {}).email),
      h("td", null, c.label || KIND_LABEL[c.kind], c.label ? h("span", { class: "sub" }, KIND_LABEL[c.kind]) : null),
      h("td", null, fmt(c.expires_on) || "–"),
      h("td", null, statusChip(h, c.expires_on)),
      h("td", null, h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { showEveryone(main, ctx, c); } }, "Edit")));
    const table = (rows) => h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Person"), h("th", null, "Pass or certificate"), h("th", null, "Expires"), h("th", null, "Status"), h("th", null, ""))),
      h("tbody", null, rows.map(row))));

    fill(main,
      pageHead("Passes & certificates", "Everyone’s passes and certificates, soonest expiry first."),
      tabs(ctx, main, "everyone"),
      noticeBox(ctx),
      editing !== undefined ? editor(ctx, main, editing || null, people, function () { showEveryone(main, ctx); }) : null,
      h("section", { class: "panel panel-attention" },
        h("h2", null, `Expired or expiring within 60 days: ${soon.length}`),
        soon.length ? table(soon) : h("p", { class: "empty" }, "Nothing expiring in the next 60 days.")),
      h("section", { class: "panel" },
        h("div", { class: "row" }, h("h2", null, "Everything"),
          editing === undefined ? h("button", { class: "btn btn-small", type: "button", onclick: function () { showEveryone(main, ctx, null); } }, "Add for someone") : null),
        items.length ? table(items) : h("p", { class: "empty" }, "Nobody has added anything yet."),
        noneYet.length ? h("p", { class: "fineprint" }, "Nothing recorded yet for: " + noneYet.map((p) => p.full_name || p.email).join(", ")) : null));
  }
})();
