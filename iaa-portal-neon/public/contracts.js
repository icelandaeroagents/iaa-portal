// =====================================================================
// Iceland Aero Agents – Staff Portal
// Contracts tracker (Management → Contracts)
//
// Customer agreements (SGHAs), suppliers, leases, insurance and licences:
// end dates, notice periods, owners and documents. The "act by" date is the
// end date less the notice period – the last day to give notice, renegotiate
// or apply for renewal. The owner is emailed 60 and 30 days before it
// (api/staff-notify.js). Management only (database update 34).
// =====================================================================
(function () {
  "use strict";

  const KINDS = { customer: "Customer agreement (SGHA)", supplier: "Supplier", lease: "Lease or rental", insurance: "Insurance", licence: "Licence or approval", other: "Other" };
  let openId = null;      // contract shown in the form, or "new"
  let filter = { kind: "all", show: "active" };
  let notice = null;

  function today() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000); }
  function fmt(iso) { return iso ? new Date(String(iso).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–"; }

  // Annual price review on the anniversary of the start date. Notice of a
  // price change must reach the carrier review_notice_days before it.
  function nextAnniversary(c) {
    if (!c.annual_review || !c.start_date) return null;
    const st = String(c.start_date).slice(0, 10), t = today();
    const m = st.slice(5, 7), d = st.slice(8, 10);
    const at = (y) => { const iso = `${y}-${m}-${d}`; return isNaN(Date.parse(iso + "T12:00:00Z")) || new Date(iso + "T12:00:00Z").getUTCDate() !== +d ? `${y}-${m}-28` : iso; };
    let y = +t.slice(0, 4), a = at(y);
    if (a < t) a = at(++y);
    while (a <= st) a = at(++y);
    return a;
  }
  function review(c) {
    const a = nextAnniversary(c);
    if (!a || c.status === "ended") return null;
    const by = addDays(a, -(c.review_notice_days || 0));
    const yr = a.slice(0, 4);
    if (c.review_done_for && String(c.review_done_for).slice(0, 10) === a) return { a, by, label: `Price review ${yr} done`, rank: 3, warn: false };
    const d = daysBetween(today(), by);
    if (d < 0) return { a, by, label: `Price review ${yr}: notice date ${fmt(by)} has passed`, rank: 1, warn: true };
    if (d <= 60) return { a, by, label: `Price review ${yr}: send notice by ${fmt(by)} (${d} ${d === 1 ? "day" : "days"})`, rank: 1, warn: true };
    return { a, by, label: `Next price review ${fmt(a)} – notice by ${fmt(by)}`, rank: 3, warn: false };
  }

  // The last day to give notice / renegotiate / apply for renewal.
  function actBy(c) { return c.end_date ? addDays(String(c.end_date).slice(0, 10), -(c.notice_days || 0)) : null; }
  function state(c) {
    const base = endState(c), rv = review(c);
    if (rv && rv.warn && rv.rank < base.rank) return { label: "Price review due", cls: "chip-status-new", rank: rv.rank, text: rv.label + (base.text ? " · " + base.text : "") };
    if (rv) return Object.assign({}, base, { text: [base.text, rv.label].filter(Boolean).join(" · ") });
    return base;
  }
  function endState(c) {
    if (c.status === "ended") return { label: "Ended", cls: "chip-none", rank: 5, text: "" };
    if (!c.end_date) return { label: c.start_date ? "Rolling" : "Dates missing", cls: c.start_date ? "chip-pass" : "chip-none", rank: c.start_date ? 3 : 4, text: c.start_date ? "Runs until terminated" + (c.notice_days ? ` on ${c.notice_days} days’ notice` : "") : "Enter the start date" };
    const t = today(), act = actBy(c), end = String(c.end_date).slice(0, 10);
    const d = daysBetween(t, act);
    if (end < t) return { label: c.auto_renews ? "Check renewal" : "Expired", cls: "chip-sev-high", rank: 0,
      text: c.auto_renews ? `Passed its end date ${fmt(end)} – it may have renewed. Update the dates.` : `Ended ${fmt(end)} – renew, replace or mark as ended.` };
    if (d < 0) return { label: "Act now", cls: "chip-sev-high", rank: 0,
      text: c.auto_renews ? `Notice date ${fmt(act)} has passed – it renews on ${fmt(end)} unless agreed otherwise.` : `Should have been acted on by ${fmt(act)} – ends ${fmt(end)}.` };
    if (d <= 60) return { label: "Due soon", cls: "chip-status-new", rank: 1, text: `Act by ${fmt(act)} (${d} ${d === 1 ? "day" : "days"})` };
    return { label: "OK", cls: "chip-pass", rank: 3, text: `Act by ${fmt(act)}` };
  }

  // Lines for Home and the Management overview.
  async function attention(db) {
    const res = await db.from("contracts").select("*").eq("status", "active");
    if (res.error) return [];
    const list = (res.data || []).map((c) => [c, state(c)]);
    const now = list.filter((x) => x[1].rank === 0).length;
    const soon = list.filter((x) => x[1].rank === 1).length;
    const out = [];
    if (now) out.push(`${now} ${now === 1 ? "contract needs" : "contracts need"} action now`);
    if (soon) out.push(`${soon} ${soon === 1 ? "contract has" : "contracts have"} a notice, renewal or price review date within 60 days`);
    return out;
  }

  // ------------------------------------------------------------------
  async function view(ctx, main, rerender) {
    const { h } = ctx;
    if (openId !== null) return form(ctx, main, rerender);
    const [res, ppl] = await Promise.all([
      ctx.db.from("contracts").select("*").order("end_date", { ascending: true }),
      ctx.db.from("profiles").select("id, full_name, email").eq("role", "management")
    ]);
    if (res.error) return h("section", { class: "panel" }, h("p", { class: "empty" }, "The contracts tracker isn’t set up yet (database update 34)."));
    const owners = {}; (ppl.data || []).forEach((p) => { owners[p.id] = p.full_name || p.email; });
    const all = res.data || [];
    const shown = all.filter((c) => (filter.kind === "all" || c.kind === filter.kind) &&
      (filter.show === "all" || (filter.show === "active" && c.status === "active") || (filter.show === "attention" && state(c).rank <= 1) || (filter.show === "ended" && c.status === "ended")))
      .sort((a, b) => state(a).rank - state(b).rank || String(actBy(a) || "9999").localeCompare(String(actBy(b) || "9999")));
    const n = notice; notice = null;
    const active = all.filter((c) => c.status === "active");
    const nowN = active.filter((c) => state(c).rank === 0).length, soonN = active.filter((c) => state(c).rank === 1).length;
    const sel = (id, label, value, options, key) => h("div", { class: "field" }, h("label", { for: id }, label),
      h("select", { id: id, onchange: (e) => { filter[key] = e.target.value; rerender(); } }, options.map(([v, t]) => h("option", { value: v, selected: v === value }, t))));
    return h("div", null,
      n ? h("p", { class: n.isError ? "notice is-error" : "notice" }, n.text) : null,
      h("div", { class: "stat-grid" },
        stat(h, nowN, "Need action now", nowN ? "is-bad" : ""),
        stat(h, soonN, "Act within 60 days", soonN ? "is-warn" : ""),
        stat(h, active.length, "Active contracts", "")),
      h("section", { class: "panel" },
        h("p", { class: "fineprint" }, "“Act by” is the end date less the notice period: the last day to give notice, renegotiate or apply for renewal. Contracts with an annual price review also show the next anniversary of their start date and the date notice of a price change must be sent by. The owner is emailed 60 and 30 days before each date."),
        h("div", { class: "form-grid filters" },
          sel("ct-kind", "Type", filter.kind, [["all", "All types"]].concat(Object.keys(KINDS).map((k) => [k, KINDS[k]])), "kind"),
          sel("ct-show", "Show", filter.show, [["active", "Active"], ["attention", "Needs attention"], ["ended", "Ended"], ["all", "All"]], "show")),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", onclick: () => { openId = "new"; rerender(); } }, "Add contract"),
          h("button", { class: "btn btn-quiet", type: "button", onclick: () => exportCsv(all, owners) }, "Export CSV")),
        shown.length
          ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
              h("thead", null, h("tr", null, h("th", null, "Contract"), h("th", null, "Type"), h("th", null, "Started"), h("th", null, "Ends"), h("th", null, "Act by"), h("th", null, "Owner"), h("th", null, "Status"))),
              h("tbody", null, shown.map((c) => {
                const st = state(c);
                return h("tr", { class: "is-clickable", onclick: () => { openId = c.id; rerender(); } },
                  h("td", null, h("b", null, c.title || c.counterparty), h("span", { class: "sub" }, [c.title ? c.counterparty : null, c.stations, c.reference].filter(Boolean).join(" · "))),
                  h("td", null, KINDS[c.kind] || c.kind, c.auto_renews ? h("span", { class: "sub" }, "Renews automatically") : null),
                  h("td", null, fmt(c.start_date), nextAnniversary(c) ? h("span", { class: "sub" }, "Review " + fmt(nextAnniversary(c)).replace(/ \d{4}$/, "")) : null),
                  h("td", null, fmt(c.end_date)),
                  h("td", null, fmt(actBy(c)), c.notice_days ? h("span", { class: "sub" }, `${c.notice_days} days’ notice`) : null),
                  h("td", null, owners[c.owner_id] || "–"),
                  h("td", null, h("span", { class: "chip " + st.cls }, st.label), st.text ? h("span", { class: "sub" }, st.text) : null));
              }))))
          : h("p", { class: "empty" }, all.length ? "Nothing matches these filters." : "No contracts yet. Add your SGHAs, supplier agreements and leases.")));
  }
  function stat(h, n, label, cls) {
    return h("div", { class: "stat " + cls }, h("span", { class: "stat-n" }, String(n)), h("span", { class: "stat-label" }, label));
  }

  // ------------------------------------------------------------------
  async function form(ctx, main, rerender) {
    const { h, db } = ctx;
    const isNew = openId === "new";
    let c = { kind: "customer", status: "active", auto_renews: false };
    if (!isNew) {
      const r = await db.from("contracts").select("*").eq("id", openId).single();
      if (r.error) { openId = null; notice = { text: r.error.message, isError: true }; return view(ctx, main, rerender); }
      c = r.data;
    }
    const ppl = await db.from("profiles").select("id, full_name, email").eq("role", "management").eq("active", true);
    const back = () => { openId = null; rerender(); };
    const inp = (k, type, attrs) => h("input", Object.assign({ id: "ct-" + k, type: type || "text", value: c[k] == null ? "" : String(c[k]).slice(0, type === "date" ? 10 : undefined) }, attrs || {}));
    const f = {
      counterparty: inp("counterparty", "text", { required: true, placeholder: "e.g. UAS, Iceland Jet Center" }),
      title: inp("title", "text", { placeholder: "e.g. SGHA Annex B – BIKF, BIRK" }),
      reference: inp("reference"), stations: inp("stations", "text", { placeholder: "e.g. BIRK, BIKF" }),
      start_date: inp("start_date", "date"), end_date: inp("end_date", "date"),
      notice_days: inp("notice_days", "number", { min: 0, placeholder: "e.g. 90" }),
      document_url: inp("document_url", "url", { placeholder: "Link to the signed copy (Drive, Notion…)" }),
      notes: h("textarea", { id: "ct-notes", rows: 3 }, c.notes || "")
    };
    f.kind = h("select", { id: "ct-kind-f" }, Object.keys(KINDS).map((k) => h("option", { value: k, selected: c.kind === k }, KINDS[k])));
    f.owner_id = h("select", { id: "ct-owner" }, [h("option", { value: "" }, "No owner (all management are emailed)")].concat((ppl.data || []).map((p) => h("option", { value: p.id, selected: c.owner_id === p.id }, p.full_name || p.email))));
    f.status = h("select", { id: "ct-status" }, [["active", "Active"], ["ended", "Ended"]].map(([v, t]) => h("option", { value: v, selected: c.status === v }, t)));
    const auto = h("input", { type: "checkbox", id: "ct-auto", checked: !!c.auto_renews });
    const annual = h("input", { type: "checkbox", id: "ct-annual", checked: !!c.annual_review });
    f.review_notice_days = inp("review_notice_days", "number", { min: 0, value: c.review_notice_days == null ? "30" : String(c.review_notice_days) });
    const field = (k, label, hint, wide) => h("div", { class: "field" + (wide ? " field-wide" : "") }, h("label", { for: f[k].id }, label), f[k], hint ? h("span", { class: "hint" }, hint) : null);
    const msg = h("p", { class: "status", role: "status" });
    const save = async (e) => {
      e.preventDefault();
      const v = {
        counterparty: f.counterparty.value.trim(), title: f.title.value.trim() || null, reference: f.reference.value.trim() || null,
        stations: f.stations.value.trim() || null, start_date: f.start_date.value || null, end_date: f.end_date.value || null,
        notice_days: f.notice_days.value === "" ? null : parseInt(f.notice_days.value, 10), auto_renews: auto.checked,
        owner_id: f.owner_id.value || null, document_url: f.document_url.value.trim() || null, notes: f.notes.value.trim() || null,
        annual_review: annual.checked, review_notice_days: f.review_notice_days.value === "" ? 30 : parseInt(f.review_notice_days.value, 10),
        kind: f.kind.value, status: f.status.value
      };
      if (!v.counterparty) { ctx.setStatus(msg, "Enter who the contract is with.", true); return; }
      if (v.start_date && v.end_date && v.end_date < v.start_date) { ctx.setStatus(msg, "The end date is before the start date.", true); return; }
      const res = isNew ? await db.from("contracts").insert(v) : await db.from("contracts").update(v).eq("id", c.id);
      if (res.error) { ctx.setStatus(msg, res.error.message, true); return; }
      if (ctx.logEvent) await ctx.logEvent(isNew ? "contract_added" : "contract_updated", { counterparty: v.counterparty, title: v.title });
      notice = { text: `${v.title || v.counterparty} saved.` + (v.end_date && !isNew && String(c.end_date || "").slice(0, 10) !== v.end_date ? " Reminders restart from the new end date." : "") };
      back();
    };
    const del = async () => {
      if (!confirm("Delete this contract from the tracker? Only for entries made by mistake – for a contract that has finished, set Status to Ended instead.")) return;
      const { error } = await db.from("contracts").delete().eq("id", c.id);
      if (error) { ctx.setStatus(msg, error.message, true); return; }
      notice = { text: "Deleted." }; back();
    };
    const st = isNew ? null : state(c);
    return h("div", null,
      h("a", { class: "back-link", href: "#/management", onclick: (e) => { e.preventDefault(); back(); } }, "Contracts"),
      h("div", { class: "unit-head" },
        h("p", { class: "briefing-kicker" }, isNew ? "New contract" : KINDS[c.kind] || c.kind),
        h("h2", { class: "unit-title" }, isNew ? "Add contract" : (c.title || c.counterparty)),
        st ? h("p", null, h("span", { class: "chip " + st.cls }, st.label), st.text ? " " + st.text : "") : null),
      h("form", { class: "panel", onsubmit: save },
        h("div", { class: "form-grid" },
          field("counterparty", "With (counterparty)"), field("title", "Contract"), field("kind", "Type"),
          field("reference", "Reference"), field("stations", "Stations"), field("owner_id", "Owner", "Gets the reminder emails")),
        h("div", { class: "form-grid" },
          field("start_date", "Start date"), field("end_date", "End date", "Leave empty if it runs until cancelled"),
          field("notice_days", "Notice period (days)", "Days before the end date that notice or a renewal application is needed"),
          field("status", "Status")),
        h("label", { class: "choice" }, auto, h("span", null, "Renews automatically unless notice is given")),
        h("label", { class: "choice" }, annual, h("span", null, "Annual price review on the anniversary of the start date")),
        h("div", { class: "form-grid" }, field("review_notice_days", "Price change notice (days)", "How long before the anniversary the carrier must be told of new prices")),
        !isNew && review(c) ? h("div", { class: "notice" }, review(c).label,
          !review(c).label.includes("done") ? h("div", { class: "row", style: "margin-top:0.5rem" },
            h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: async () => {
              const rv = review(c);
              const { error } = await db.from("contracts").update({ review_done_for: rv.a }).eq("id", c.id);
              if (error) { ctx.setStatus(msg, error.message, true); return; }
              if (ctx.logEvent) await ctx.logEvent("contract_review_done", { counterparty: c.counterparty, anniversary: rv.a });
              notice = { text: `Price review ${rv.a.slice(0, 4)} marked done for ${c.counterparty}.` }; back();
            } }, `Mark the ${review(c).a.slice(0, 4)} price review done`)) : null) : null,
        field("document_url", "Signed document", null, true),
        c.document_url ? h("p", null, h("a", { href: c.document_url, target: "_blank", rel: "noopener" }, "Open the signed document")) : null,
        h("div", { class: "field field-wide" }, h("label", { for: "ct-notes" }, "Notes"), f.notes),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "submit" }, isNew ? "Add contract" : "Save"),
          h("button", { class: "btn btn-quiet", type: "button", onclick: back }, "Cancel"),
          !isNew ? h("button", { class: "btn btn-danger", type: "button", onclick: del }, "Delete") : null),
        msg,
        !isNew && c.updated_by_name ? h("p", { class: "fineprint" }, `Last changed by ${c.updated_by_name}, ${fmt(c.updated_at)}.`) : null));
  }

  function exportCsv(list, owners) {
    const cols = [["Counterparty", "counterparty"], ["Contract", "title"], ["Type", "kind"], ["Reference", "reference"], ["Stations", "stations"],
      ["Start", "start_date"], ["End", "end_date"], ["Notice days", "notice_days"], ["Act by", null], ["Renews automatically", "auto_renews"],
      ["Next price review", null], ["Price notice by", null],
      ["Owner", null], ["Status", null], ["Document", "document_url"], ["Notes", "notes"]];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map((c) => c[0]).join(",")].concat(list.map((c) => cols.map(([label, k]) =>
      esc(label === "Act by" ? actBy(c) : label === "Next price review" ? (review(c) || {}).a : label === "Price notice by" ? (review(c) || {}).by : label === "Owner" ? owners[c.owner_id] : label === "Status" ? state(c).label : label === "Type" ? KINDS[c.kind] : c[k])).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `IAA_contracts_${today()}.csv`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function reset() { openId = null; }
  window.IAAContracts = { view: view, attention: attention, reset: reset };
})();
