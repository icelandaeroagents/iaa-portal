/* Iceland Aero Agents – Staff Portal
   Requests:
   – Leave & availability (#/requests/leave): private to the person and
     management; management approves or declines.
   – Stock, equipment & defects (#/requests/service): shared with all
     staff; management and station leads update the status.
   Emails are sent by api/staff-notify.js. */

(function () {
  "use strict";

  const LEAVE = [["holiday", "Holiday"], ["unavailable", "Unavailable"], ["sick", "Sick leave"], ["other", "Other"]];
  const LEAVE_LABEL = Object.fromEntries(LEAVE);
  const LEAVE_STATUS = { pending: "Waiting", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };
  const SERVICE = [["stock", "Stock refill"], ["vehicle_defect", "Vehicle defect"], ["equipment", "Equipment request"], ["issue", "Issue or log"]];
  const SERVICE_LABEL = Object.fromEntries(SERVICE);
  const SERVICE_STATUS = [["open", "Open"], ["in_progress", "In progress"], ["done", "Done"], ["declined", "Declined"]];
  const SERVICE_STATUS_LABEL = Object.fromEntries(SERVICE_STATUS);
  let serviceFilter = "active";
  let notice = null;

  window.IAARequests = { render: render, counts: counts };

  function fmt(d) { return new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  function range(a, b) { return a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`; }
  function todayIso() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = hash; }
  function ping(kind, id) {
    return fetch("/api/staff-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: kind, id: id }) }).catch(function () {});
  }
  function noticeBox(ctx) {
    if (!notice) return null;
    const n = ctx.h("p", { class: notice.isError ? "notice is-error" : "notice" }, notice.text);
    notice = null;
    return n;
  }

  // For the management "Needs attention" box on Home.
  async function counts(ctx) {
    const [l, s] = await Promise.all([
      ctx.db.from("leave_requests").select("id").eq("status", "pending"),
      ctx.db.from("service_requests").select("id, urgency, kind").in("status", ["open", "in_progress"])
    ]);
    const open = s.data || [];
    return {
      leave: (l.data || []).length,
      service: open.length,
      urgent: open.filter((x) => x.urgency === "urgent" || x.kind === "vehicle_defect").length
    };
  }

  async function render(main, ctx) {
    const tab = /^#\/requests\/service/.test(location.hash) ? "service" : "leave";
    return tab === "service" ? showService(main, ctx) : showLeave(main, ctx);
  }

  function tabs(ctx, active) {
    const { h } = ctx;
    return h("nav", { class: "tabs", "aria-label": "Request types" },
      h("a", { href: "#/requests/leave", "aria-current": active === "leave" ? "page" : null }, "Leave & availability"),
      h("a", { href: "#/requests/service", "aria-current": active === "service" ? "page" : null }, "Stock, equipment & defects"));
  }

  // ------------------------------------------------------------------
  // Leave & availability
  // ------------------------------------------------------------------
  async function showLeave(main, ctx) {
    const { h, fill, pageHead, state, setStatus } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, pageHead("Requests"), tabs(ctx, "leave"), h("p", { class: "empty" }, "Loading…"));

    const mineRes = await ctx.db.from("leave_requests").select("*").eq("profile_id", state.profile.id).order("start_date", { ascending: false });
    if (mineRes.error) throw mineRes.error;
    const mine = mineRes.data || [];

    let pending = [], upcoming = [], peopleById = {};
    if (isManagement) {
      const [allRes, pRes] = await Promise.all([
        ctx.db.from("leave_requests").select("*").in("status", ["pending", "approved"]).gte("end_date", todayIso()).order("start_date"),
        ctx.db.from("profiles").select("id, full_name, email")
      ]);
      (pRes.data || []).forEach((p) => { peopleById[p.id] = p; });
      pending = (allRes.data || []).filter((l) => l.status === "pending");
      upcoming = (allRes.data || []).filter((l) => l.status === "approved");
    }
    const nameOf = (id) => (peopleById[id] || {}).full_name || (peopleById[id] || {}).email || "Someone";

    // Form
    const kind = h("select", { id: "l-kind" }, LEAVE.map((k) => h("option", { value: k[0] }, k[1])));
    const from = h("input", { id: "l-from", type: "date", required: true, min: todayIso() });
    const to = h("input", { id: "l-to", type: "date", required: true, min: todayIso() });
    from.addEventListener("change", function () { if (!to.value || to.value < from.value) to.value = from.value; to.min = from.value; });
    const note = h("textarea", { id: "l-note", rows: "2", placeholder: "Optional, e.g. half day, or available on call" });
    const fStatus = h("p", { class: "status", role: "status" });
    const submit = h("button", { class: "btn", type: "submit" }, "Send request");
    const form = h("form", {
      class: "panel",
      onsubmit: async function (e) {
        e.preventDefault();
        if (!from.value || !to.value) { setStatus(fStatus, "Choose the dates.", true); return; }
        if (to.value < from.value) { setStatus(fStatus, "The end date is before the start date.", true); return; }
        submit.disabled = true;
        const ins = await ctx.db.from("leave_requests").insert({
          profile_id: state.profile.id, kind: kind.value, start_date: from.value, end_date: to.value, note: note.value.trim() || null
        }).select("id").single();
        submit.disabled = false;
        if (ins.error) { setStatus(fStatus, ins.error.message, true); return; }
        ping("leave", ins.data.id);
        notice = { text: "Request sent. Management has been emailed, and you’ll get an email when it’s decided." };
        showLeave(main, ctx);
      }
    },
      h("h2", null, "Request leave or mark yourself unavailable"),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "l-kind" }, "Type"), kind),
        h("div", { class: "field" }, h("label", { for: "l-from" }, "From"), from),
        h("div", { class: "field" }, h("label", { for: "l-to" }, "To (including)"), to)),
      h("div", { class: "field field-wide" }, h("label", { for: "l-note" }, "Note"), h("span", { class: "help" }, "No need to give medical details for sick leave."), note),
      h("div", { class: "row" }, submit), fStatus);

    // My requests
    const mineStatus = h("p", { class: "status", role: "status" });
    const mineTable = mine.length
      ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, h("th", null, "Dates"), h("th", null, "Type"), h("th", null, "Status"), h("th", null, ""))),
          h("tbody", null, mine.map((l) => h("tr", null,
            h("td", null, range(l.start_date, l.end_date), l.note ? h("span", { class: "sub" }, l.note) : null),
            h("td", null, LEAVE_LABEL[l.kind]),
            h("td", null, h("span", { class: "chip chip-leave-" + l.status }, LEAVE_STATUS[l.status]), l.decision_note ? h("span", { class: "sub" }, "“" + l.decision_note + "”") : null),
            h("td", null, l.status === "pending" ? h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: async function () {
              if (!confirm("Cancel this request?")) return;
              const { error } = await ctx.db.from("leave_requests").update({ status: "cancelled" }).eq("id", l.id);
              if (error) { setStatus(mineStatus, error.message, true); return; }
              showLeave(main, ctx);
            } }, "Cancel") : null))))))
      : h("p", { class: "empty" }, "You haven’t made any requests yet.");

    // Management: decisions
    const decisionStatus = h("p", { class: "status", role: "status" });
    const pendingPanel = isManagement
      ? h("section", { class: "panel panel-attention", "aria-labelledby": "lp-h" },
          h("h2", { id: "lp-h" }, `Waiting for a decision: ${pending.length}`),
          pending.length
            ? h("div", { class: "table-wrap" }, h("table", null,
                h("thead", null, h("tr", null, h("th", null, "Person"), h("th", null, "Dates"), h("th", null, "Type"), h("th", null, "Note to them"), h("th", null, ""))),
                h("tbody", null, pending.map(function (l) {
                  const dn = h("input", { type: "text", placeholder: "Optional", "aria-label": "Note for " + nameOf(l.profile_id) });
                  const decide = async function (status) {
                    const { error } = await ctx.db.from("leave_requests").update({ status: status, decision_note: dn.value.trim() || null }).eq("id", l.id);
                    if (error) { setStatus(decisionStatus, error.message, true); return; }
                    await ctx.logEvent("leave_" + status, { leave_id: l.id, profile_id: l.profile_id });
                    ping("leave", l.id);
                    notice = { text: `${status === "approved" ? "Approved" : "Declined"}. ${nameOf(l.profile_id)} has been emailed.` };
                    showLeave(main, ctx);
                  };
                  return h("tr", null,
                    h("td", null, nameOf(l.profile_id)),
                    h("td", null, range(l.start_date, l.end_date), l.note ? h("span", { class: "sub" }, l.note) : null),
                    h("td", null, LEAVE_LABEL[l.kind]),
                    h("td", null, dn),
                    h("td", null, h("div", { class: "row row-tight" },
                      h("button", { class: "btn btn-small", type: "button", onclick: function () { decide("approved"); } }, "Approve"),
                      h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: function () { decide("declined"); } }, "Decline"))));
                }))))
            : h("p", { class: "empty" }, "Nothing waiting."),
          decisionStatus)
      : null;

    const awayPanel = isManagement
      ? h("section", { class: "panel", "aria-labelledby": "la-h" },
          h("h2", { id: "la-h" }, "Approved leave coming up"),
          upcoming.length
            ? h("ul", { class: "plain-list" }, upcoming.map((l) => h("li", null, `${nameOf(l.profile_id)}: ${range(l.start_date, l.end_date)}`, h("span", { class: "sub" }, LEAVE_LABEL[l.kind]))))
            : h("p", { class: "empty" }, "Nobody is booked off."))
      : null;

    fill(main,
      pageHead("Requests", "Leave and availability go to management only. Stock, equipment and defect requests are shared with all staff."),
      tabs(ctx, "leave"), noticeBox(ctx), pendingPanel, form,
      h("section", { class: "panel" }, h("h2", null, "Your requests"), mineTable, mineStatus),
      awayPanel);
  }

  // ------------------------------------------------------------------
  // Stock, equipment & defects
  // ------------------------------------------------------------------
  async function showService(main, ctx) {
    const { h, fill, pageHead, state, setStatus } = ctx;
    const role = state.profile.role;
    const myStations = state.profile.station_codes || [];
    const canUpdate = (r) => role === "management" || (role === "station_lead" && myStations.indexOf(r.station_code) !== -1);
    fill(main, pageHead("Requests"), tabs(ctx, "service"), h("p", { class: "empty" }, "Loading…"));

    const res = await ctx.db.from("service_requests").select("*").order("created_at", { ascending: false }).limit(300);
    if (res.error) throw res.error;
    const all = res.data || [];
    const shown = all.filter((r) =>
      serviceFilter === "all" ? true : serviceFilter === "closed" ? (r.status === "done" || r.status === "declined") : (r.status === "open" || r.status === "in_progress"));

    // Form
    const stations = state.stations.filter((s) => s.active);
    const ordered = stations.filter((s) => myStations.indexOf(s.code) !== -1).concat(stations.filter((s) => myStations.indexOf(s.code) === -1));
    const kind = h("select", { id: "s-kind" }, SERVICE.map((k) => h("option", { value: k[0] }, k[1])));
    const station = h("select", { id: "s-station" }, ordered.map((s, i) => h("option", { value: s.code, selected: i === 0 }, `${s.code} – ${s.name}`)), h("option", { value: "" }, "Not station-specific"));
    const title = h("input", { id: "s-title", type: "text", required: true, placeholder: "e.g. Hi-vis vests size L, GPU 2 cable damaged" });
    const item = h("input", { id: "s-item", type: "text", placeholder: "e.g. Tug 2, white van, air-stairs" });
    const qty = h("input", { id: "s-qty", type: "text", placeholder: "e.g. 10" });
    const details = h("textarea", { id: "s-details", rows: "3" });
    const urgent = h("input", { type: "checkbox", id: "s-urgent" });
    const fStatus = h("p", { class: "status", role: "status" });
    const submit = h("button", { class: "btn", type: "submit" }, "Send");
    const itemLabel = h("label", { for: "s-item" }, "Vehicle or equipment");
    const qtyField = h("div", { class: "field" }, h("label", { for: "s-qty" }, "Quantity"), qty);
    function adapt() {
      itemLabel.textContent = kind.value === "stock" ? "Item" : kind.value === "issue" ? "What it relates to (optional)" : "Vehicle or equipment";
      qtyField.classList.toggle("is-hidden", kind.value !== "stock" && kind.value !== "equipment");
    }
    kind.addEventListener("change", adapt);
    adapt();

    const form = h("form", {
      class: "panel",
      onsubmit: async function (e) {
        e.preventDefault();
        if (!title.value.trim()) { setStatus(fStatus, "Say briefly what’s needed or what’s wrong.", true); title.focus(); return; }
        submit.disabled = true;
        const ins = await ctx.db.from("service_requests").insert({
          kind: kind.value, station_code: station.value || null, title: title.value.trim(),
          item: item.value.trim() || null, quantity: qty.value.trim() || null, details: details.value.trim() || null,
          urgency: urgent.checked ? "urgent" : "normal"
        }).select("id").single();
        submit.disabled = false;
        if (ins.error) { setStatus(fStatus, ins.error.message, true); return; }
        ping("service", ins.data.id);
        const emailed = urgent.checked || kind.value === "vehicle_defect";
        notice = { text: emailed ? "Sent, and management has been emailed." : "Sent. It’s now in the list below." };
        showService(main, ctx);
      }
    },
      h("h2", null, "New request"),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "s-kind" }, "Type"), kind),
        h("div", { class: "field" }, h("label", { for: "s-station" }, "Station"), station),
        h("div", { class: "field" }, itemLabel, item),
        qtyField),
      h("div", { class: "field field-wide" }, h("label", { for: "s-title" }, "What’s needed, or what’s wrong"), title),
      h("div", { class: "field field-wide" }, h("label", { for: "s-details" }, "Details (optional)"), details),
      h("label", { class: "choice" }, urgent, h("span", null, "Urgent: affects safety or today’s operation. Vehicle defects and urgent requests are emailed to management straight away.")),
      h("div", { class: "row" }, submit), fStatus);

    // List
    const listStatus = h("p", { class: "status", role: "status" });
    const filter = h("select", { id: "s-filter", onchange: function (e) { serviceFilter = e.target.value; showService(main, ctx); } },
      [["active", "Open and in progress"], ["closed", "Done or declined"], ["all", "All"]].map((o) => h("option", { value: o[0], selected: serviceFilter === o[0] }, o[1])));
    const rows = shown.map(function (r) {
      let manage = null;
      if (canUpdate(r)) {
        const st = h("select", { "aria-label": "Status for request " + r.id }, SERVICE_STATUS.map((s) => h("option", { value: s[0], selected: r.status === s[0] }, s[1])));
        const sn = h("input", { type: "text", value: r.status_note || "", placeholder: "Note, e.g. ordered", "aria-label": "Status note for request " + r.id });
        const save = h("button", { class: "btn btn-small", type: "button", onclick: async function () {
          save.disabled = true;
          const { error } = await ctx.db.from("service_requests").update({ status: st.value, status_note: sn.value.trim() || null }).eq("id", r.id);
          save.disabled = false;
          if (error) { setStatus(listStatus, error.message, true); return; }
          notice = { text: "Updated." };
          showService(main, ctx);
        } }, "Save");
        manage = h("div", { class: "service-manage" }, st, sn, save);
      }
      return h("tr", null,
        h("td", null, h("span", { class: "report-no" }, "S-" + String(r.id).padStart(4, "0")), h("span", { class: "sub" }, fmt(r.created_at))),
        h("td", null, r.title,
          h("span", { class: "sub" }, [SERVICE_LABEL[r.kind], r.item, r.quantity ? "× " + r.quantity : null].filter(Boolean).join(" · ")),
          r.details ? h("span", { class: "sub prewrap" }, r.details) : null),
        h("td", null, r.station_code || "–", h("span", { class: "sub" }, r.requester_name || "")),
        h("td", null,
          r.urgency === "urgent" ? h("span", { class: "chip chip-sev-high" }, "Urgent") : null,
          h("span", { class: "chip chip-service-" + r.status }, SERVICE_STATUS_LABEL[r.status]),
          r.status_note && !manage ? h("span", { class: "sub" }, r.status_note) : null),
        h("td", null, manage));
    });

    fill(main,
      pageHead("Requests", "Leave and availability go to management only. Stock, equipment and defect requests are shared with all staff."),
      tabs(ctx, "service"), noticeBox(ctx), form,
      h("section", { class: "panel" },
        h("div", { class: "row" }, h("h2", null, "Requests"), h("div", { class: "field" }, h("label", { for: "s-filter" }, "Show"), filter)),
        shown.length
          ? h("div", { class: "table-wrap" }, h("table", null,
              h("thead", null, h("tr", null, h("th", null, "No."), h("th", null, "Request"), h("th", null, "Station"), h("th", null, "Status"), h("th", null, ""))),
              h("tbody", null, rows)))
          : h("p", { class: "empty" }, "Nothing here."),
        listStatus));
  }
})();
