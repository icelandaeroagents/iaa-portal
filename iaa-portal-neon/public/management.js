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
  const EVENTS = [{"when": "Before opening a new station (e.g. Egilsstaðir, BIEG)", "what": "Ground handling licence from the airport operator; declare the station to the insurers; risk assessment under management of change; add the station to the audit plan; emergency card for the station", "owner": "Hjalti", "source": "SMS §3.4; QA §1, §4.6"}, {"when": "Before new equipment goes into use (e.g. a towbarless tractor)", "what": "Risk assessment under management of change; training before use; add to Equipment Info", "owner": "Hjalti", "source": "SMS §3.4; Management Structure §3.6"}, {"when": "Before handling a new aircraft type, operator or service", "what": "Risk assessment under management of change; check the operator's requirements", "owner": "Hjalti", "source": "SMS §3.4"}, {"when": "After any occurrence report", "what": "Review within 2 working days; investigate Level 1 and 2; notify Samgöngustofa within 72 hours where required", "owner": "Hjalti", "source": "SMS §4.2"}, {"when": "After a serious accident or injury", "what": "Notify Vinnueftirlitið as the law requires; investigate; review the risk assessment", "owner": "Josh", "source": "Health & Safety Policy §4, §6"}, {"when": "After a security incident", "what": "Report to airport security / Border Police as needed; notify Samgöngustofa where required; review the Security Programme", "owner": "Hjalti", "source": "Security Programme §7, §10"}, {"when": "Suspected data breach", "what": "Assess straight away; notify Persónuvernd within 72 hours where required", "owner": "Hjalti", "source": "Data Protection Policy §12"}, {"when": "Within 90 days of finishing a corrective action", "what": "Effectiveness check; close the finding only if satisfactory", "owner": "Hjalti", "source": "QA Programme, §6"}, {"when": "When someone joins", "what": "Before the first shift: induction, PPE issue, policies read in the portal. Before working alone: modules P1–P5 and their station modules, dangerous goods recognition, security awareness and escort training, practical sign-off. Airport ID application and background check", "owner": "Josh", "source": "SMS §5.1; Security Programme §4–5; Training plan tab"}, {"when": "When someone leaves", "what": "Return airport ID; remove portal and system access the same day", "owner": "Hjalti", "source": "Security Programme §4.2"}, {"when": "When a post holder changes", "what": "Update the Management Structure and deputisation register; re-issue; notify Isavia and, where required, Samgöngustofa", "owner": "Guðmundur", "source": "Management Structure §4"}, {"when": "After any emergency or Crisis Management Team activation", "what": "Report on the portal; investigate; CMT review within 30 days; update the Emergency Response Plan if needed", "owner": "Hjalti", "source": "Emergency Response Plan §11"}, {"when": "Before handling cargo or mail", "what": "Regulated agent / known consignor requirements in place, staff trained, Security Programme updated", "owner": "Hjalti", "source": "Security Programme §6.3"}, {"when": "When a regulation or airport programme changes", "what": "Review the affected documents and procedures", "owner": "Hjalti", "source": "Each document's Document Control section"}];
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

  window.IAAManagement = { render: render, overdueCount: overdueCount, riskAttention: riskAttention };

  // ------------------------------------------------------------------
  // Risk register helpers
  // ------------------------------------------------------------------
  const CATS = { aviation: "Aviation safety", workplace: "Workplace (H&S)", security: "Security" };
  const SEV = ["", "1 Negligible", "2 Minor", "3 Major", "4 Hazardous", "5 Catastrophic"];
  const LIK = ["", "1 Extremely improbable", "2 Improbable", "3 Remote", "4 Occasional", "5 Frequent"];
  let riskFilter = { status: "all", category: "all", station: "all" };
  function band(score) { return score >= 15 ? "intolerable" : score >= 6 ? "tolerable" : "acceptable"; }
  function bandChip(h, score) {
    const b = band(score);
    return h("span", { class: "chip risk-" + b }, score + " " + (b === "intolerable" ? "Intolerable" : b === "tolerable" ? "Tolerable" : "Acceptable"));
  }
  function riskStatus(r) {
    if (r.status === "draft") return ["Draft", "chip-none"];
    if (r.status === "closed") return ["Closed", "chip-none"];
    if (r.status === "accepted") return ["Accepted", "chip-pass"];
    const b = band(r.residual_score);
    if (b === "intolerable") return ["Intolerable – stop", "chip-sev-high"];
    if (b === "tolerable") return ["Awaiting acceptance", "chip-status-new"];
    return ["Assessed – acceptable", "chip-pass"];
  }
  const reviewLate = (r) => (r.status === "assessed" || r.status === "accepted") && r.review_due && r.review_due < today();

  // For "Needs attention" on Home.
  async function riskAttention(db) {
    const res = await db.from("risks").select("status, residual_score, review_due");
    if (res.error) return [];
    const list = res.data || [];
    const out = [];
    const stop = list.filter((r) => r.status !== "closed" && r.status !== "draft" && r.residual_score >= 15).length;
    const waiting = list.filter((r) => r.status === "assessed" && r.residual_score >= 6 && r.residual_score <= 12).length;
    const late = list.filter(reviewLate).length;
    if (stop) out.push(`${stop} ${stop === 1 ? "risk is" : "risks are"} intolerable – the activity must stop until reduced`);
    if (waiting) out.push(`${waiting} ${waiting === 1 ? "risk is" : "risks are"} waiting for the Accountable Manager to accept`);
    if (late) out.push(`${late} risk ${late === 1 ? "review is" : "reviews are"} overdue`);
    return out;
  }

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
      ["overview", "Overview"], ["calendar", "Calendar"], ["risks", "Risk register"], ["events", "When it happens"], ["training", "Training plan"], ["people", "Who holds what"]
    ].map(([id, label]) => h("a", { href: "#/management", "aria-current": tab === id ? "page" : null, onclick: function (e) { e.preventDefault(); tab = id; adding = false; render(main, ctx); } }, label)));
    const n = notice; notice = null;
    const body = tab === "overview" ? await overview(ctx, main, actions)
      : tab === "calendar" ? calendarView(ctx, main, actions)
      : tab === "risks" ? await riskView(ctx, main)
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
    const rr = await ctx.db.from("risks").select("ref, activity, status, residual_score, review_due");
    const risks = rr.error ? [] : rr.data || [];
    const riskItems = [
      ["Draft assessments to review", risks.filter((r) => r.status === "draft").length],
      ["Intolerable – activity must stop", risks.filter((r) => r.status !== "draft" && r.status !== "closed" && r.residual_score >= 15).length],
      ["Waiting for acceptance", risks.filter((r) => r.status === "assessed" && r.residual_score >= 6 && r.residual_score <= 12).length],
      ["Reviews overdue", risks.filter(reviewLate).length]
    ].filter((x) => x[1]);

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
      rr.error ? null : h("section", { class: "panel" },
        h("h2", null, "Risk register"),
        riskItems.length
          ? h("ul", { class: "attention-list" }, riskItems.map((x) => h("li", null, h("a", { href: "#/management", onclick: function (e) { e.preventDefault(); tab = "risks"; render(main, ctx); } }, `${x[0]}: ${x[1]}`))))
          : h("p", { class: "fineprint" }, "All risks assessed and in date."),
        h("p", { class: "fineprint" }, `${risks.length} risks in the register.`)),
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
  // Risk register
  // ------------------------------------------------------------------
  async function riskView(ctx, main) {
    const { h } = ctx;
    const res = await ctx.db.from("risks").select("*").order("residual_score", { ascending: false }).order("ref");
    if (res.error) return h("section", { class: "panel" }, h("p", { class: "empty" }, "The risk register isn’t set up yet (database update 24)."));
    const all = res.data || [];
    const stations = (ctx.state.stations || []).filter((x) => x.active).map((x) => x.code);
    const list = all.filter((r) =>
      (riskFilter.category === "all" || r.category === riskFilter.category) &&
      (riskFilter.station === "all" || !(r.stations || []).length || (r.stations || []).indexOf(riskFilter.station) !== -1) &&
      (riskFilter.status === "all" ||
        (riskFilter.status === "draft" && r.status === "draft") ||
        (riskFilter.status === "waiting" && r.status === "assessed" && r.residual_score >= 6 && r.residual_score <= 12) ||
        (riskFilter.status === "review" && reviewLate(r)) ||
        (riskFilter.status === "done" && (r.status === "accepted" || (r.status === "assessed" && r.residual_score <= 5)))))
      .sort((a, b) => b.residual_score - a.residual_score || a.ref.localeCompare(b.ref));

    // 5 × 5 heat map of where the assessed risks sit now (remaining risk).
    const counted = all.filter((r) => r.status !== "closed");
    const cell = (sv, lk) => counted.filter((r) => (r.residual_severity || r.severity) === sv && (r.residual_likelihood || r.likelihood) === lk).length;
    const heat = h("div", { class: "table-wrap" }, h("table", { class: "risk-heat" },
      h("thead", null, h("tr", null, h("th", null, "Likelihood \\ Severity"), [1, 2, 3, 4, 5].map((sv) => h("th", null, SEV[sv])))),
      h("tbody", null, [5, 4, 3, 2, 1].map((lk) => h("tr", null, h("th", null, LIK[lk]),
        [1, 2, 3, 4, 5].map((sv) => { const n = cell(sv, lk); return h("td", { class: "risk-" + band(sv * lk) }, n ? String(n) : ""); }))))));

    const sel = (id, label, value, options, key) => h("div", { class: "field" }, h("label", { for: id }, label),
      h("select", { id: id, onchange: function (e) { riskFilter[key] = e.target.value; render(main, ctx); } }, options.map(([v, t]) => h("option", { value: v, selected: v === value }, t))));
    return h("div", null,
      h("section", { class: "panel" },
        h("h2", null, "Where our risks sit now"),
        h("p", { class: "fineprint" }, "Number of risks in each cell of the matrix, after the extra controls (remaining risk). Red is intolerable, amber tolerable, green acceptable."),
        heat),
      h("div", { class: "row row-end" },
        sel("rk-status", "Show", riskFilter.status, [["all", "All"], ["draft", "Drafts to review"], ["waiting", "Waiting for acceptance"], ["review", "Reviews overdue"], ["done", "Assessed and in order"]], "status"),
        sel("rk-cat", "Type", riskFilter.category, [["all", "All"]].concat(Object.keys(CATS).map((k) => [k, CATS[k]])), "category"),
        sel("rk-st", "Station", riskFilter.station, [["all", "All"]].concat(stations.map((c) => [c, c])), "station"),
        h("button", { class: "btn", type: "button", onclick: function () { riskDetail(ctx, main, null, all); } }, "Add risk")),
      h("section", { class: "panel" },
        list.length
          ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table risk-table" },
              h("thead", null, h("tr", null, h("th", null, "Ref"), h("th", null, "Activity and hazard"), h("th", null, "Now"), h("th", null, "With extra controls"), h("th", null, "Status"), h("th", null, "Owner"), h("th", null, "Review"))),
              h("tbody", null, list.map((r) => {
                const st = riskStatus(r);
                return h("tr", { class: "is-clickable", onclick: function () { riskDetail(ctx, main, r, all); } },
                  h("td", { class: "mono nowrap" }, r.ref),
                  h("td", null, h("b", null, r.activity), h("span", { class: "sub" }, r.hazard),
                    h("span", { class: "sub" }, CATS[r.category] + ((r.stations || []).length ? " · " + r.stations.join(", ") : ""))),
                  h("td", null, bandChip(h, r.score)),
                  h("td", null, r.residual_score !== r.score ? bandChip(h, r.residual_score) : h("span", { class: "sub" }, "No extra controls")),
                  h("td", null, h("span", { class: "chip " + st[1] }, st[0])),
                  h("td", null, r.owner),
                  h("td", { class: "nowrap" }, r.review_due ? (reviewLate(r) ? h("b", { class: "is-error-text" }, fmt(r.review_due)) : fmt(r.review_due)) : "–"));
              }))))
          : h("p", { class: "empty" }, "Nothing to show with these filters.")));
  }

  async function riskDetail(ctx, main, r, all) {
    const { h, fill, setStatus } = ctx;
    const isNew = !r;
    r = r || { ref: "", activity: "", hazard: "", outcome: "", category: "aviation", stations: [], current_controls: "", severity: 3, likelihood: 3, extra_controls: "", residual_severity: null, residual_likelihood: null, owner: "Hjalti", status: "draft", staff_visible: true, report_refs: "" };
    let history = [];
    if (!isNew) {
      const hr = await ctx.db.from("risk_history").select("*").eq("risk_id", r.id).order("changed_at", { ascending: false });
      history = hr.error ? [] : hr.data || [];
    }
    const nextRef = isNew ? "R-" + String(all.reduce((m, x) => Math.max(m, parseInt(String(x.ref).replace(/\D/g, ""), 10) || 0), 0) + 1).padStart(3, "0") : r.ref;
    const text = (id, value, rows) => { const t = h("textarea", { id: id, rows: String(rows || 2) }); t.value = value || ""; return t; };
    const f = {
      activity: h("input", { id: "rk-act", type: "text", value: r.activity }),
      hazard: text("rk-haz", r.hazard),
      outcome: text("rk-out", r.outcome),
      category: h("select", { id: "rk-catx" }, Object.keys(CATS).map((k) => h("option", { value: k, selected: k === r.category }, CATS[k]))),
      controls: text("rk-ctl", r.current_controls, 3),
      extra: text("rk-extra", r.extra_controls, 3),
      owner: h("select", { id: "rk-own" }, OWNERS.map((o) => h("option", { value: o, selected: o === r.owner }, o))),
      visible: h("input", { id: "rk-vis", type: "checkbox", checked: r.staff_visible !== false }),
      reports: h("input", { id: "rk-reps", type: "text", value: r.report_refs || "", placeholder: "e.g. R-0012, R-0019" })
    };
    const scoreSel = (id, value, labels, allowNone) => h("select", { id: id },
      (allowNone ? [h("option", { value: "", selected: !value }, "Same as now")] : []).concat([1, 2, 3, 4, 5].map((n) => h("option", { value: String(n), selected: n === value }, labels[n]))));
    f.sev = scoreSel("rk-sev", r.severity, SEV); f.lik = scoreSel("rk-lik", r.likelihood, LIK);
    f.rsev = scoreSel("rk-rsev", r.residual_severity, SEV, true); f.rlik = scoreSel("rk-rlik", r.residual_likelihood, LIK, true);
    const chosen = new Set(r.stations || []);
    const stationBoxes = (ctx.state.stations || []).filter((x) => x.active).map((x) =>
      h("label", { class: "choice choice-inline" }, h("input", { type: "checkbox", checked: chosen.has(x.code), onchange: function (e) { if (e.target.checked) chosen.add(x.code); else chosen.delete(x.code); } }), h("span", null, x.code)));
    const live = h("p", { class: "risk-live" });
    function drawLive() {
      const now = (+f.sev.value) * (+f.lik.value);
      const rem = (+(f.rsev.value || f.sev.value)) * (+(f.rlik.value || f.lik.value));
      const parts = [h("span", null, "Now: "), bandChip(h, now), h("span", null, "With extra controls: "), bandChip(h, rem)];
      if (rem >= 15) parts.push(h("b", { class: "is-error-text" }, "Intolerable: stop the activity until the risk is reduced."));
      live.replaceChildren.apply(live, parts);
    }
    [f.sev, f.lik, f.rsev, f.rlik].forEach((x) => x.addEventListener("change", drawLive));
    drawLive();
    const msg = h("p", { class: "status", role: "status" });

    function row() {
      return {
        activity: f.activity.value.trim(), hazard: f.hazard.value.trim(), outcome: f.outcome.value.trim(),
        category: f.category.value, stations: Array.from(chosen), current_controls: f.controls.value.trim(),
        severity: +f.sev.value, likelihood: +f.lik.value, extra_controls: f.extra.value.trim() || null,
        residual_severity: f.rsev.value ? +f.rsev.value : null, residual_likelihood: f.rlik.value ? +f.rlik.value : null,
        owner: f.owner.value, staff_visible: f.visible.checked, report_refs: f.reports.value.trim() || null
      };
    }
    async function save(extra, done) {
      const data = Object.assign(row(), extra || {});
      if (!data.activity) { setStatus(msg, "Name the activity.", true); return; }
      const res = isNew ? await ctx.db.from("risks").insert(Object.assign({ ref: nextRef }, data)) : await ctx.db.from("risks").update(data).eq("id", r.id);
      if (res.error) { setStatus(msg, res.error.message, true); return; }
      await ctx.logEvent(isNew ? "risk_added" : "risk_updated", { ref: isNew ? nextRef : r.ref, status: data.status || r.status });
      notice = { text: done || "Saved." }; tab = "risks"; render(main, ctx);
    }
    const rem = r.residual_score || r.score;
    const buttons = [
      h("button", { class: "btn btn-quiet", type: "button", onclick: function () { save(null, "Saved as " + (r.status === "draft" ? "draft." : "is.")); } }, "Save"),
      h("button", { class: "btn", type: "button", onclick: function () { save({ status: "assessed" }, "Marked as assessed. Next review in 3 months."); } }, r.status === "draft" ? "Mark as assessed" : "Re-assess now"),
      !isNew && r.status === "assessed" && rem >= 6 && rem <= 12
        ? h("button", { class: "btn", type: "button", onclick: function () { if (confirm("Accept this remaining risk as the Accountable Manager?")) save({ status: "accepted" }, "Accepted. Your name and today’s date are recorded."); } }, "Accept (Accountable Manager)") : null,
      !isNew && (r.status === "assessed" || r.status === "accepted")
        ? h("button", { class: "btn btn-quiet", type: "button", onclick: async function () {
            const { error } = await ctx.db.from("risks").update({ review_due: new Date(Date.now() + 91 * 86400000).toISOString().slice(0, 10) }).eq("id", r.id);
            notice = error ? { text: error.message, isError: true } : { text: "Reviewed with no change. Next review in 3 months." }; tab = "risks"; render(main, ctx);
          } }, "Reviewed – no change") : null,
      !isNew && f.extra.value ? h("button", { class: "btn btn-quiet", type: "button", onclick: async function () {
            const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
            const { error } = await ctx.db.from("mgmt_actions").insert({ kind: "calendar", due_on: due, title: `${r.ref} ${r.activity}: put the extra controls in place`, category: "Review", owner: f.owner.value, source: "Risk register " + r.ref, notes: f.extra.value.trim() });
            setStatus(msg, error ? error.message : "Added to the calendar, due in 30 days. Change the date there if needed.", !!error);
          } }, "Add extra controls to the calendar") : null,
      !isNew ? h("button", { class: "btn btn-danger", type: "button", onclick: async function () {
            if (!confirm(`Close ${r.ref}? Close a risk when the activity no longer happens. Its history is kept.`)) return;
            save({ status: "closed" }, r.ref + " closed.");
          } }, "Close risk") : null
    ];
    fill(main,
      h("a", { class: "back-link", href: "#/management", onclick: function (e) { e.preventDefault(); tab = "risks"; render(main, ctx); } }, "Risk register"),
      h("div", { class: "page-head page-head-row" },
        h("div", null, h("p", { class: "briefing-kicker" }, (isNew ? nextRef : r.ref) + " · " + CATS[r.category]), h("h1", null, isNew ? "Add risk" : r.activity),
          !isNew ? h("p", null, [r.assessed_on ? "Assessed " + fmt(r.assessed_on) + (r.assessed_by_name ? " by " + r.assessed_by_name : "") : "Not yet assessed",
            r.accepted_on ? "accepted " + fmt(r.accepted_on) + " by " + r.accepted_by_name : null].filter(Boolean).join(" · ")) : null),
        !isNew ? h("span", { class: "chip " + riskStatus(r)[1] }, riskStatus(r)[0]) : null),
      h("form", { class: "panel risk-form", onsubmit: function (e) { e.preventDefault(); } },
        h("div", { class: "field field-wide" }, h("label", { for: "rk-act" }, "Activity"), f.activity),
        h("div", { class: "form-grid" },
          h("div", { class: "field" }, h("label", { for: "rk-catx" }, "Type"), f.category),
          h("div", { class: "field" }, h("label", { for: "rk-own" }, "Risk owner"), f.owner),
          h("div", { class: "field" }, h("span", { class: "label" }, "Stations (none ticked = all)"), h("div", { class: "row row-tight" }, stationBoxes))),
        h("div", { class: "field field-wide" }, h("label", { for: "rk-haz" }, "Hazard: what could go wrong"), f.hazard),
        h("div", { class: "field field-wide" }, h("label", { for: "rk-out" }, "Worst credible outcome"), f.outcome),
        h("div", { class: "field field-wide" }, h("label", { for: "rk-ctl" }, "Current controls"), f.controls),
        h("h2", null, "Risk now, with the current controls"),
        h("div", { class: "form-grid" },
          h("div", { class: "field" }, h("label", { for: "rk-sev" }, "Severity"), f.sev),
          h("div", { class: "field" }, h("label", { for: "rk-lik" }, "Likelihood"), f.lik)),
        h("div", { class: "field field-wide" }, h("label", { for: "rk-extra" }, "Extra controls needed (if any)"), f.extra),
        h("h2", null, "Remaining risk, with the extra controls"),
        h("div", { class: "form-grid" },
          h("div", { class: "field" }, h("label", { for: "rk-rsev" }, "Severity"), f.rsev),
          h("div", { class: "field" }, h("label", { for: "rk-rlik" }, "Likelihood"), f.rlik)),
        live,
        h("div", { class: "field field-wide" }, h("label", { for: "rk-reps" }, "Related reports"), f.reports),
        h("label", { class: "choice" }, f.visible, h("span", null, "Show the hazard and controls to staff (without scores) once assessed")),
        h("p", { class: "fineprint" }, "Severity and likelihood follow Appendix A of the SMS Manual. Tolerable risks (6–12) need the Accountable Manager to accept them. Assessed risks are reviewed every 3 months."),
        h("div", { class: "row" }, buttons),
        msg),
      history.length
        ? h("section", { class: "panel" }, h("h2", null, "History"),
            h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
              h("thead", null, h("tr", null, h("th", null, "When"), h("th", null, "By"), h("th", null, "Status"), h("th", null, "Now"), h("th", null, "Remaining"))),
              h("tbody", null, history.map((x) => h("tr", null,
                h("td", { class: "nowrap" }, new Date(x.changed_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })),
                h("td", null, x.changed_by_name || "–"),
                h("td", null, x.status),
                h("td", null, bandChip(h, x.severity * x.likelihood)),
                h("td", null, bandChip(h, (x.residual_severity || x.severity) * (x.residual_likelihood || x.likelihood)))))))))
        : null);
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
