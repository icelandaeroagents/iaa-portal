/* Iceland Aero Agents – Staff Portal
   Management (#/management): management only.
   – Overview: what is overdue and due soon, training renewals due, quick links
   – Calendar: the management compliance calendar (from the management
     documents), with status, comments and new actions
   – When it happens, Training plan, Who holds what: reference */

(function () {
  "use strict";

  const OWNERS = ["Guðmundur", "Hjalti", "Josh"];
  const CATEGORIES = ["Set-up", "Meeting", "Review", "Audit", "Inspection", "Training", "Exercise", "Preparation"];
  const STATUSES = ["Not started", "In progress", "Done", "Not needed"];
  const EVENTS = [{"when": "Before opening a new station (e.g. Egilsstaðir, BIEG)", "what": "Risk assessment and approval under management of change; add the station to the audit plan; emergency card for the station", "owner": "Hjalti", "source": "SMS §3.4; QA §1"}, {"when": "Before new equipment goes into use (e.g. a towbarless tractor)", "what": "Risk assessment under management of change; training before use; add to Equipment Info", "owner": "Hjalti", "source": "SMS §3.4; Management Structure §3.6"}, {"when": "Before handling a new aircraft type, operator or service", "what": "Risk assessment under management of change; check the operator's requirements", "owner": "Hjalti", "source": "SMS §3.4"}, {"when": "After any occurrence report", "what": "Review within 2 working days; investigate Level 1 and 2; notify Samgöngustofa within 72 hours where required", "owner": "Hjalti", "source": "SMS §4.2"}, {"when": "After a serious accident or injury", "what": "Notify Vinnueftirlitið as the law requires; investigate; review the risk assessment", "owner": "Josh", "source": "Health & Safety Policy §4, §6"}, {"when": "After a security incident", "what": "Report to airport security / Border Police as needed; notify Samgöngustofa where required; review the Security Programme", "owner": "Hjalti", "source": "Security Programme §7, §10"}, {"when": "Suspected data breach", "what": "Assess straight away; notify Persónuvernd within 72 hours where required", "owner": "Hjalti", "source": "Data Protection Policy §12"}, {"when": "Within 90 days of finishing a corrective action", "what": "Effectiveness check; close the finding only if satisfactory", "owner": "Hjalti", "source": "QA Programme, §6"}, {"when": "When someone joins", "what": "Before the first shift: induction, PPE issue, policies read in the portal. Before working alone: modules P1–P5 and their station modules, dangerous goods recognition, security awareness and escort training, practical sign-off. Airport ID application and background check", "owner": "Josh", "source": "SMS §5.1; Security Programme §4–5; Training plan tab"}, {"when": "When someone leaves", "what": "Return airport ID; remove portal and system access the same day", "owner": "Hjalti", "source": "Security Programme §4.2"}, {"when": "When a post holder changes", "what": "Update the Management Structure and deputisation register; re-issue", "owner": "Guðmundur", "source": "Management Structure §4"}, {"when": "When a regulation or airport programme changes", "what": "Review the affected documents and procedures", "owner": "Hjalti", "source": "Each document's Document Control section"}];
  const TRAINING_PLAN = [{"training": "Induction: company, SMS and Just Culture, PPE, emergency cards, policies", "who": "All new staff", "first": "Before the first shift", "renewed": "–", "recorded": "Portal: Policies (read and confirmed)", "owner": "Josh", "source": "SMS §5.1; H&S Policy §7"}, {"training": "Portal modules: SOP P1–P5, Safety Management and Reporting, Health and Safety, Security, Data Protection", "who": "All staff", "first": "Before working unsupervised", "renewed": "Every 6 months: the portal emails each person when a module is due", "recorded": "Portal: Training, signed off; earlier completions kept", "owner": "Josh", "source": "SMS §5.1; H&S §7; Security §5; DP Policy §13"}, {"training": "Winter modules: W plus their station module", "who": "All operational staff", "first": "Before their first winter", "renewed": "Every year before 1 October: the portal emails each person", "recorded": "Portal: Training, signed off; earlier completions kept", "owner": "Josh", "source": "SMS §5.1; SOP Part 6"}, {"training": "Practical sign-offs: marshalling, towing and pushback, GPU, air stairs, lavatory and water servicing, baggage loading and safe lifting, airside driving", "who": "Staff who do these tasks (where needed)", "first": "Before doing the task alone", "renewed": "Every year", "recorded": "Portal: Training record → Practical assessments, signed off by management", "owner": "Josh", "source": "Management Structure §3.6; H&S Policy §7"}, {"training": "Dangerous goods recognition", "who": "Staff who handle baggage", "first": "Before handling baggage", "renewed": "Within 24 months (IATA DGR)", "recorded": "Portal: Passes & certificates", "owner": "Josh", "source": "SMS §5.1; Security Programme §5"}, {"training": "Security awareness", "who": "Everyone with an airport ID", "first": "Before the airport ID is issued", "renewed": "As required by Regulation (EU) 2015/1998 and the airport", "recorded": "Portal: Passes & certificates", "owner": "Hjalti", "source": "Security Programme §5"}, {"training": "Escort training", "who": "Staff who escort passengers, crew or visitors", "first": "Before escorting alone", "renewed": "With security awareness", "recorded": "Portal: Passes & certificates", "owner": "Hjalti", "source": "Security Programme §5"}, {"training": "Airside driving", "who": "Staff who drive airside", "first": "Before driving airside", "renewed": "When the airport permit is renewed", "recorded": "Portal: Passes & certificates", "owner": "Josh", "source": "Security Programme §5; H&S §5.3"}, {"training": "First aid", "who": "First-aiders at each station", "first": "–", "renewed": "Before the certificate expires", "recorded": "Portal: Passes & certificates", "owner": "Josh", "source": "H&S Policy §5.10"}, {"training": "Security management", "who": "Safety & Security Manager", "first": "On appointment", "renewed": "As required by regulation", "recorded": "Portal: Passes & certificates", "owner": "Guðmundur", "source": "Security Programme §5"}];
  const PEOPLE = [
    { name: "Guðmundur Þengill Vilhelmsson", title: "Founder & Managing Director, Chief Financial Officer", posts: "Accountable Manager", deputy: "Safety & Security Manager, Quality & Compliance Manager, Data Protection Lead, Operations Manager, Training Manager" },
    { name: "Hjalti Þór Guðmundsson", title: "Founder & Managing Director, Chief Security Officer", posts: "Safety & Security Manager, Quality & Compliance Manager, Data Protection Lead", deputy: "Accountable Manager, Health & Safety Officer" },
    { name: "Josh Fadaely", title: "Chief Operating Officer", posts: "Operations Manager, Training Manager, Health & Safety Officer", deputy: "–" }
  ];

  let tab = "overview";
  let filters = { owner: "all", show: "open" };
  let adding = false;
  let notice = null;

  window.IAAManagement = { render: render, overdueCount: overdueCount };

  const today = () => new Date().toISOString().slice(0, 10);
  const isOpen = (a) => a.status !== "Done" && a.status !== "Not needed";
  const fmt = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const monthOf = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  function daysLeft(d) { return Math.round((Date.parse(d) - Date.parse(today())) / 86400000); }

  // For "Needs attention" on Home.
  async function overdueCount(db) {
    const res = await db.from("mgmt_actions").select("id, due_on, status").lt("due_on", today());
    if (res.error) return 0;
    return (res.data || []).filter(isOpen).length;
  }

  async function load(ctx) {
    const res = await ctx.db.from("mgmt_actions").select("*").order("due_on").order("id");
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function render(main, ctx) {
    const { h, fill, pageHead } = ctx;
    if (ctx.state.profile.role !== "management") { fill(main, pageHead("Management"), h("p", { class: "empty" }, "Management only.")); return; }
    fill(main, pageHead("Management"), h("p", { class: "empty" }, "Loading…"));
    const actions = await load(ctx);
    const tabs = h("nav", { class: "tabs", "aria-label": "Management views" }, [
      ["overview", "Overview"], ["calendar", "Calendar"], ["events", "When it happens"], ["training", "Training plan"], ["people", "Who holds what"]
    ].map(([id, label]) => h("a", { href: "#/management", "aria-current": tab === id ? "page" : null, onclick: function (e) { e.preventDefault(); tab = id; adding = false; render(main, ctx); } }, label)));
    const n = notice; notice = null;
    const body = tab === "overview" ? await overview(ctx, main, actions)
      : tab === "calendar" ? calendarView(ctx, main, actions)
      : tab === "events" ? refTable(ctx, ["When", "What to do", "Owner", "Source"], EVENTS.map((e) => [e.when, e.what, e.owner, e.source]), "Not on a fixed date: do these whenever the trigger happens.")
      : tab === "training" ? refTable(ctx, ["Training", "Who needs it", "First required", "Renewed", "Recorded in", "Owner", "Source"], TRAINING_PLAN.map((t) => [t.training, t.who, t.first, t.renewed, t.recorded, t.owner, t.source]), "Portal modules renew every 6 months and winter modules every October, with reminder emails. Practical sign-offs renew every year.")
      : refTable(ctx, ["Person", "Title", "Posts", "Deputises for"], PEOPLE.map((p) => [p.name, p.title, p.posts, p.deputy]), "From the Defined Management Structure (GH-MGT-001), revision 2.0.");
    fill(main,
      h("div", { class: "page-head" }, h("h1", null, "Management"), h("p", null, "For the management team: the compliance calendar from our management documents, and what needs doing.")),
      tabs,
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      body);
  }

  // ------------------------------------------------------------------
  // Overview
  // ------------------------------------------------------------------
  async function overview(ctx, main, actions) {
    const { h } = ctx;
    const overdue = actions.filter((a) => isOpen(a) && a.due_on < today());
    const soon = actions.filter((a) => isOpen(a) && a.due_on >= today() && daysLeft(a.due_on) <= 30);
    const doneYear = actions.filter((a) => !isOpen(a) && String(a.completed_on || "").slice(0, 4) === today().slice(0, 4));
    let renewals = [];
    try { if (window.IAATraining && window.IAATraining.renewalsDue) renewals = await window.IAATraining.renewalsDue(ctx); } catch (e) { renewals = []; }
    const byOwner = OWNERS.map((o) => [o, actions.filter((a) => isOpen(a) && a.owner === o).length, actions.filter((a) => isOpen(a) && a.owner === o && a.due_on < today()).length]);

    return h("div", null,
      h("div", { class: "stat-grid" },
        stat(h, overdue.length, "Overdue", overdue.length ? "is-bad" : ""),
        stat(h, soon.length, "Due in the next 30 days", soon.length ? "is-warn" : ""),
        stat(h, renewals.filter((r) => r.overdue).length, "Training renewals overdue", renewals.some((r) => r.overdue) ? "is-bad" : ""),
        stat(h, doneYear.length, "Done this year", "")),
      h("section", { class: "panel" + (overdue.length ? " panel-attention" : "") },
        h("h2", null, overdue.length ? `Overdue: ${overdue.length}` : "Nothing overdue"),
        overdue.length ? actionTable(ctx, main, overdue) : h("p", { class: "fineprint" }, "Everything due so far is done.")),
      h("section", { class: "panel" },
        h("h2", null, "Due in the next 30 days"),
        soon.length ? actionTable(ctx, main, soon) : h("p", { class: "fineprint" }, "Nothing due in the next 30 days.")),
      h("section", { class: "panel" },
        h("h2", null, "Training renewals"),
        renewals.length
          ? h("div", { class: "table-wrap" }, h("table", null,
              h("thead", null, h("tr", null, h("th", null, "Person"), h("th", null, "Module"), h("th", null, "Due"))),
              h("tbody", null, renewals.map((r) => h("tr", null, h("td", null, r.name), h("td", null, h("b", null, r.module.code + " "), r.module.title),
                h("td", null, h("span", { class: "chip " + (r.overdue ? "chip-sev-high" : "chip-status-new") }, (r.overdue ? "Overdue since " : "Due ") + fmt(r.due))))))))
          : h("p", { class: "fineprint" }, "No training renewals due in the next 30 days. Staff are emailed when a module is due."),
        h("div", { class: "row" }, h("a", { class: "btn btn-quiet btn-small", href: "#/training/records" }, "Training records"))),
      h("section", { class: "panel" },
        h("h2", null, "Open actions by owner"),
        h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, h("th", null, "Owner"), h("th", null, "Open"), h("th", null, "Overdue"))),
          h("tbody", null, byOwner.map((r) => h("tr", null, h("td", null, r[0]), h("td", null, String(r[1])), h("td", null, r[2] ? h("b", { class: "is-error-text" }, String(r[2])) : "0")))))),
        h("div", { class: "row" },
          h("a", { class: "btn btn-quiet btn-small", href: "#/people" }, "Access review (People)"),
          h("a", { class: "btn btn-quiet btn-small", href: "#/manuals" }, "Manuals"),
          h("a", { class: "btn btn-quiet btn-small", href: "#/reports" }, "Reports"))));
  }
  function stat(h, n, label, cls) {
    return h("div", { class: "stat " + cls }, h("span", { class: "stat-n" }, String(n)), h("span", { class: "stat-label" }, label));
  }

  // ------------------------------------------------------------------
  // Calendar
  // ------------------------------------------------------------------
  function calendarView(ctx, main, actions) {
    const { h } = ctx;
    const shown = actions.filter((a) => (filters.owner === "all" || a.owner === filters.owner) &&
      (filters.show === "all" || (filters.show === "open" ? isOpen(a) : !isOpen(a))));
    const select = (id, label, value, options, onchange) => h("div", { class: "field" }, h("label", { for: id }, label),
      h("select", { id: id, onchange: onchange }, options.map(([v, t]) => h("option", { value: v, selected: v === value }, t))));
    const months = [];
    shown.forEach((a) => { const m = monthOf(a.due_on); let g = months.find((x) => x.m === m); if (!g) { g = { m: m, list: [] }; months.push(g); } g.list.push(a); });
    return h("div", null,
      h("div", { class: "row row-end" },
        select("mg-owner", "Owner", filters.owner, [["all", "Everyone"]].concat(OWNERS.map((o) => [o, o])), function (e) { filters.owner = e.target.value; render(main, ctx); }),
        select("mg-show", "Show", filters.show, [["open", "Still to do"], ["done", "Done"], ["all", "All"]], function (e) { filters.show = e.target.value; render(main, ctx); }),
        h("button", { class: "btn btn-quiet", type: "button", onclick: function () { exportCsv(actions); } }, "Export CSV"),
        !adding ? h("button", { class: "btn", type: "button", onclick: function () { adding = true; render(main, ctx); } }, "Add action") : null),
      adding ? editForm(ctx, main, null) : null,
      months.length
        ? months.map((g) => h("section", { class: "panel" }, h("h2", null, g.m), actionTable(ctx, main, g.list, true)))
        : h("section", { class: "panel" }, h("p", { class: "empty" }, "Nothing to show with these filters.")));
  }

  function actionTable(ctx, main, list, full) {
    const { h } = ctx;
    return h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
      h("thead", null, h("tr", null, h("th", null, "Due"), h("th", null, "Action"), h("th", null, "Owner"), h("th", null, "Status"), h("th", null, "Comments"))),
      h("tbody", null, list.map((a) => actionRow(ctx, main, a, full)))));
  }

  function actionRow(ctx, main, a, full) {
    const { h } = ctx;
    const late = isOpen(a) && a.due_on < today();
    const close = isOpen(a) && !late && daysLeft(a.due_on) <= 14;
    const status = h("select", { "aria-label": "Status", onchange: async function () {
      const { error } = await ctx.db.from("mgmt_actions").update({ status: status.value }).eq("id", a.id);
      notice = error ? { text: error.message, isError: true } : { text: `“${a.title}” – ${status.value.toLowerCase()}.` };
      render(main, ctx);
    } }, STATUSES.map((s) => h("option", { value: s, selected: s === a.status }, s)));
    const comment = h("input", { type: "text", value: a.comments || "", placeholder: "Add a comment", "aria-label": "Comment" });
    comment.addEventListener("change", async function () {
      const { error } = await ctx.db.from("mgmt_actions").update({ comments: comment.value.trim() || null }).eq("id", a.id);
      if (error) { notice = { text: error.message, isError: true }; render(main, ctx); }
      else { comment.classList.add("is-saved"); setTimeout(() => comment.classList.remove("is-saved"), 1200); }
    });
    return h("tr", { class: late ? "is-late" : close ? "is-close" : !isOpen(a) ? "is-done" : null },
      h("td", { class: "nowrap" }, fmt(a.due_on), late ? h("span", { class: "sub is-error-text" }, "Overdue") : close ? h("span", { class: "sub" }, `In ${daysLeft(a.due_on)} days`) : null),
      h("td", null, h("b", null, a.title), h("span", { class: "sub" }, [a.category, a.source].filter(Boolean).join(" · ")),
        full && a.notes ? h("span", { class: "sub" }, a.notes) : null,
        a.completed_on ? h("span", { class: "sub" }, "Completed " + fmt(a.completed_on) + (a.updated_by_name ? " · " + a.updated_by_name : "")) : null,
        full ? h("button", { class: "linkish", type: "button", onclick: function () { editing(ctx, main, a); } }, "Edit") : null),
      h("td", null, a.owner),
      h("td", null, status),
      h("td", null, comment));
  }

  function editing(ctx, main, a) {
    const { fill, h } = ctx;
    fill(main, h("a", { class: "back-link", href: "#/management", onclick: function (e) { e.preventDefault(); render(main, ctx); } }, "Back"),
      h("div", { class: "page-head" }, h("h1", null, "Edit action")), editForm(ctx, main, a));
  }

  function editForm(ctx, main, a) {
    const { h, setStatus } = ctx;
    const due = h("input", { id: "ma-due", type: "date", required: true, value: a ? a.due_on : today() });
    const title = h("input", { id: "ma-title", type: "text", required: true, value: a ? a.title : "" });
    const cat = h("select", { id: "ma-cat" }, CATEGORIES.map((c) => h("option", { value: c, selected: a ? a.category === c : c === "Review" }, c)));
    const owner = h("select", { id: "ma-owner" }, OWNERS.map((o) => h("option", { value: o, selected: a ? a.owner === o : false }, o)));
    const source = h("input", { id: "ma-src", type: "text", value: a ? a.source || "" : "", placeholder: "e.g. SMS Manual §4.4" });
    const notes = h("textarea", { id: "ma-notes", rows: "2" }); notes.value = a ? a.notes || "" : "";
    const msg = h("p", { class: "status", role: "status" });
    return h("form", { class: "panel", onsubmit: async function (e) {
      e.preventDefault();
      if (!title.value.trim() || !due.value) { setStatus(msg, "Add a due date and a title.", true); return; }
      const row = { due_on: due.value, title: title.value.trim(), category: cat.value, owner: owner.value, source: source.value.trim() || null, notes: notes.value.trim() || null };
      const res = a ? await ctx.db.from("mgmt_actions").update(row).eq("id", a.id) : await ctx.db.from("mgmt_actions").insert(Object.assign({ kind: "calendar" }, row));
      if (res.error) { setStatus(msg, res.error.message, true); return; }
      await ctx.logEvent(a ? "mgmt_action_edited" : "mgmt_action_added", { title: row.title, due_on: row.due_on, owner: row.owner });
      adding = false; notice = { text: a ? "Action updated." : "Action added." }; tab = "calendar"; render(main, ctx);
    } },
      h("h2", null, a ? "Edit action" : "Add action"),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "ma-due" }, "Due"), due),
        h("div", { class: "field" }, h("label", { for: "ma-cat" }, "Type"), cat),
        h("div", { class: "field" }, h("label", { for: "ma-owner" }, "Owner"), owner)),
      h("div", { class: "field field-wide" }, h("label", { for: "ma-title" }, "Action"), title),
      h("div", { class: "field field-wide" }, h("label", { for: "ma-src" }, "Source (optional)"), source),
      h("div", { class: "field field-wide" }, h("label", { for: "ma-notes" }, "Notes (optional)"), notes),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit" }, a ? "Save" : "Add"),
        h("button", { class: "btn btn-quiet", type: "button", onclick: function () { adding = false; render(main, ctx); } }, "Cancel"),
        a ? h("button", { class: "btn btn-danger", type: "button", onclick: async function () {
          if (!confirm(`Delete “${a.title}”?`)) return;
          const { error } = await ctx.db.from("mgmt_actions").delete().eq("id", a.id);
          if (error) { setStatus(msg, error.message, true); return; }
          await ctx.logEvent("mgmt_action_deleted", { title: a.title, due_on: a.due_on });
          notice = { text: "Action deleted." }; render(main, ctx);
        } }, "Delete") : null),
      msg);
  }

  function refTable(ctx, headers, rows, note) {
    const { h } = ctx;
    return h("section", { class: "panel" },
      note ? h("p", { class: "fineprint" }, note) : null,
      h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
        h("thead", null, h("tr", null, headers.map((t) => h("th", null, t)))),
        h("tbody", null, rows.map((r) => h("tr", null, r.map((c, i) => h("td", null, i === 0 ? h("b", null, c) : c))))))));
  }

  function exportCsv(actions) {
    const cols = ["due_on", "title", "category", "owner", "status", "completed_on", "comments", "source", "notes"];
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const csv = [cols.join(",")].concat(actions.map((a) => cols.map((c) => esc(a[c])).join(","))).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url; link.download = "IAA_management_calendar_" + today() + ".csv";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
