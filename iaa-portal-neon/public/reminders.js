/* Iceland Aero Agents – Staff Portal
   Reminders from management: one email per person listing everything they
   have outstanding (training, policies, passes and certificates, practical
   sign-offs). The preview uses outstanding.js – the same rules the server
   uses to build the email – so what you see is what is sent.
   Needs database update 32. */
(function () {
  "use strict";

  const SECTION_LABELS = { training: "Training", policies: "Policies to read", passes: "Passes and certificates", practical: "Practical sign-offs" };

  function todayIceland() { return new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Reykjavik" }); }
  function when(v) {
    return new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Atlantic/Reykjavik" });
  }
  function name(p) { return (p.full_name || "").trim() || p.email; }

  // Everything needed to work out what people have outstanding.
  async function loadData(db, profileIds) {
    const only = (q) => (profileIds ? q.in("profile_id", profileIds) : q);
    const [atts, certs, pols, reads, creds, prac, rems] = await Promise.all([
      only(db.from("training_attempts").select("profile_id, module, attempted_at").eq("passed", true)),
      only(db.from("training_signoffs").select("profile_id, module, passed_at, signed_at").is("revoked_at", null)),
      db.from("documents").select("id, title, version, requires_ack").eq("kind", "policy").order("sort_order"),
      only(db.from("document_reads").select("profile_id, document_id, version")),
      only(db.from("credentials").select("profile_id, kind, label, expires_on")),
      only(db.from("practical_signoffs").select("profile_id, skill, assessed_on, result")),
      only(db.from("staff_reminders").select("id, profile_id, status, created_at, created_by_name, sent_at").order("created_at", { ascending: false }))
    ]);
    const err = [atts, certs, pols, reads, creds, prac].find((r) => r.error);
    if (err) throw new Error(err.error.message);
    if (rems.error) throw new Error("Reminders aren’t set up yet (database update 32).");
    const by = (rows) => { const m = {}; (rows || []).forEach((r) => { (m[r.profile_id] = m[r.profile_id] || []).push(r); }); return m; };
    return { atts: by(atts.data), certs: by(certs.data), policies: pols.data || [], reads: by(reads.data), creds: by(creds.data), prac: by(prac.data), rems: by(rems.data) };
  }

  function outstandingFor(p, d) {
    return window.IAAOutstanding.compute({
      T: window.TRAINING, stations: p.station_codes || [], today: todayIceland(),
      attempts: d.atts[p.id] || [], certs: d.certs[p.id] || [], policies: d.policies,
      reads: d.reads[p.id] || [], credentials: d.creds[p.id] || [], practical: d.prac[p.id] || []
    });
  }
  function lastReminder(p, d) { return (d.rems[p.id] || []).find((r) => r.status !== "failed") || null; }
  function remindedToday(p, d) {
    const r = lastReminder(p, d);
    return !!r && ["pending", "sending", "sent"].indexOf(r.status) !== -1 && Date.now() - new Date(r.created_at).getTime() < 24 * 3600 * 1000;
  }

  async function sendOne(ctx, p, message) {
    const ins = await ctx.db.from("staff_reminders").insert({ profile_id: p.id, message: message || null }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    try {
      const r = await fetch("/api/staff-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "remind", id: ins.data.id }) });
      const body = await r.json().catch(() => ({}));
      const res = (body.results || [])[0] || {};
      if (res.status === "failed") throw new Error(res.error || "The email could not be sent");
      return res.status === "sent" ? "sent" : res.status && res.status.indexOf("nothing") === 0 ? "nothing" : "queued";
    } catch (e) {
      if (/could not be sent|SMTP|Email/i.test(String(e.message))) throw e;
      return "queued";   // saved – the 10-minute sweep will send it
    }
  }

  // ------------------------------------------------------------------
  // Dialog
  // ------------------------------------------------------------------
  function dialog(h, title) {
    const body = h("div", { class: "modal-body" });
    const close = h("button", { class: "btn btn-quiet btn-small modal-close", type: "button", "aria-label": "Close" }, "Close");
    const dlg = h("dialog", { class: "modal", "aria-labelledby": "modal-h" },
      h("div", { class: "modal-head" }, h("h2", { id: "modal-h" }, title), close), body);
    close.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    return { dlg: dlg, body: body };
  }
  // Like replaceChildren, but skips empty (null) slots instead of writing "null".
  function put(el) { el.replaceChildren.apply(el, Array.prototype.slice.call(arguments, 1).filter((x) => x !== null && x !== undefined && x !== false)); }

  function listView(h, items) {
    return Object.keys(SECTION_LABELS).filter((k) => items[k].length).map((k) =>
      h("div", { class: "remind-section" },
        h("h3", null, `${SECTION_LABELS[k]} (${items[k].length})`),
        h("ul", null, items[k].map((x) => h("li", null, h("b", null, x[0]), " – ", x[1])))));
  }

  // One person
  async function openOne(ctx, p, onDone) {
    const { h } = ctx;
    const { dlg, body } = dialog(h, "Send a reminder to " + name(p));
    body.append(h("p", { class: "fineprint" }, "Loading what is outstanding…"));
    let d;
    try { d = await loadData(ctx.db, [p.id]); } catch (e) { put(body, h("p", { class: "notice is-error" }, e.message)); return; }
    const items = outstandingFor(p, d);
    const last = lastReminder(p, d);
    const blocked = remindedToday(p, d);
    const msg = h("textarea", { id: "remind-msg", rows: 3, maxlength: 1000, placeholder: "Optional, for example: Please finish these before your next shift." });
    const status = h("p", { class: "status", role: "status" });
    const send = h("button", { class: "btn", type: "button", disabled: blocked || !items.count }, `Send reminder (${items.count} ${items.count === 1 ? "item" : "items"})`);
    send.addEventListener("click", async () => {
      send.disabled = true; ctx.setStatus(status, "Sending…");
      try {
        const how = await sendOne(ctx, p, msg.value.trim());
        if (ctx.logEvent) await ctx.logEvent("staff_reminder_sent", { to: p.email, items: items.count });
        put(body, h("p", { class: "notice" }, how === "sent" ? `Reminder sent to ${name(p)} (${p.email}).`
          : how === "nothing" ? `${name(p)} has nothing outstanding now, so no email was sent.`
          : `Reminder saved. It will be emailed to ${name(p)} within 10 minutes.`),
          h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Done")));
        if (onDone) onDone();
      } catch (e) { send.disabled = false; ctx.setStatus(status, e.message, true); }
    });
    put(body, 
      h("p", { class: "fineprint" }, `To ${p.email}. One email listing everything below. Replies come to you.`),
      last ? h("p", { class: "fineprint" }, `Last reminded ${when(last.created_at)} by ${last.created_by_name || "management"}` +
        (last.status === "nothing" ? " (nothing was outstanding, so no email was sent)." : ".")) : h("p", { class: "fineprint" }, "Not reminded before."),
      items.count ? h("div", { class: "remind-list" }, listView(h, items)) : h("p", { class: "notice" }, `${name(p)} has nothing outstanding.`),
      items.count ? h("div", { class: "field" }, h("label", { for: "remind-msg" }, "Personal message"), msg) : null,
      blocked ? h("p", { class: "notice is-error" }, "Already reminded in the last 24 hours. You can send another tomorrow.") : null,
      h("div", { class: "row" }, send, h("button", { class: "btn btn-quiet", type: "button", onclick: () => dlg.close() }, "Cancel")),
      status);
  }

  // Everyone with something outstanding
  async function openAll(ctx, onDone) {
    const { h } = ctx;
    const { dlg, body } = dialog(h, "Remind everyone with outstanding items");
    body.append(h("p", { class: "fineprint" }, "Working out what everyone has outstanding…"));
    let people, d;
    try {
      const pr = await ctx.db.from("profiles").select("id, email, full_name, station_codes, role, active").eq("active", true).order("full_name");
      if (pr.error) throw new Error(pr.error.message);
      const self = ctx.state && ctx.state.profile ? ctx.state.profile.id : null;
      people = (pr.data || []).filter((p) => p.id !== self);
      d = await loadData(ctx.db, null);
    } catch (e) { put(body, h("p", { class: "notice is-error" }, e.message)); return; }
    const rows = people.map((p) => ({ p: p, items: outstandingFor(p, d), last: lastReminder(p, d), blocked: remindedToday(p, d) }))
      .filter((r) => r.items.count).sort((a, b) => b.items.count - a.items.count);
    if (!rows.length) { put(body, h("p", { class: "notice" }, "Nobody has anything outstanding.")); return; }
    const boxes = rows.map((r) => h("input", { type: "checkbox", checked: !r.blocked, disabled: r.blocked, "aria-label": "Remind " + name(r.p) }));
    const msg = h("textarea", { id: "remind-all-msg", rows: 3, maxlength: 1000, placeholder: "Optional message included in every email" });
    const status = h("p", { class: "status", role: "status" });
    const count = () => boxes.filter((b) => b.checked).length;
    const send = h("button", { class: "btn", type: "button" });
    const label = () => { send.textContent = `Send ${count()} ${count() === 1 ? "reminder" : "reminders"}`; send.disabled = !count(); };
    boxes.forEach((b) => b.addEventListener("change", label)); label();
    send.addEventListener("click", async () => {
      if (!confirm(`Send a reminder email to ${count()} ${count() === 1 ? "person" : "people"}? Each gets one email with their own list.`)) return;
      send.disabled = true;
      let sent = 0, queued = 0, nothing = 0; const failed = [];
      const chosen = rows.filter((r, i) => boxes[i].checked);
      for (let i = 0; i < chosen.length; i++) {
        ctx.setStatus(status, `Sending ${i + 1} of ${chosen.length}…`);
        try {
          const how = await sendOne(ctx, chosen[i].p, msg.value.trim());
          if (how === "sent") sent++; else if (how === "nothing") nothing++; else queued++;
        } catch (e) { failed.push(name(chosen[i].p) + ": " + e.message); }
      }
      if (ctx.logEvent) await ctx.logEvent("staff_reminders_bulk", { sent: sent, queued: queued, failed: failed.length });
      put(body, 
        h("p", { class: "notice" + (failed.length ? " is-error" : "") },
          `${sent} sent` + (queued ? `, ${queued} saved and sent within 10 minutes` : "") + (nothing ? `, ${nothing} had nothing outstanding by then` : "") +
          (failed.length ? `, ${failed.length} could not be sent.` : ".")),
        failed.length ? h("ul", null, failed.map((f) => h("li", null, f))) : null,
        h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Done")));
      if (onDone) onDone();
    });
    put(body, 
      h("p", { class: "fineprint" }, "Each person gets one email listing only their own outstanding items. Anyone reminded in the last 24 hours is skipped."),
      h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
        h("thead", null, h("tr", null, h("th", null, ""), h("th", null, "Person"), h("th", null, "Outstanding"), h("th", null, "Last reminded"))),
        h("tbody", null, rows.map((r, i) => h("tr", null,
          h("td", null, boxes[i]),
          h("td", null, name(r.p), h("span", { class: "sub" }, (r.p.station_codes || []).join(", "))),
          h("td", null, String(r.items.count), h("span", { class: "sub" },
            Object.keys(SECTION_LABELS).filter((k) => r.items[k].length).map((k) => `${SECTION_LABELS[k]} ${r.items[k].length}`).join(" · "))),
          h("td", null, r.last ? when(r.last.created_at) : "Never", r.blocked ? h("span", { class: "sub" }, "Reminded in the last 24 hours") : null)))))),
      h("div", { class: "field" }, h("label", { for: "remind-all-msg" }, "Personal message"), msg),
      h("div", { class: "row" }, send, h("button", { class: "btn btn-quiet", type: "button", onclick: () => dlg.close() }, "Cancel")),
      status);
  }

  function button(ctx, p, opts) {
    return ctx.h("button", { class: "btn btn-quiet btn-small", type: "button", title: "Email " + name(p) + " a list of everything they have outstanding",
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openOne(ctx, p, opts && opts.onDone); } }, (opts && opts.label) || "Send reminder");
  }
  function bulkButton(ctx, opts) {
    return ctx.h("button", { class: "btn btn-quiet", type: "button", onclick: () => openAll(ctx, opts && opts.onDone) }, "Remind everyone with outstanding items");
  }

  window.IAAReminders = { button: button, bulkButton: bulkButton, openOne: openOne, openAll: openAll };
})();
