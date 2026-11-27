/* Iceland Aero Agents – Staff Portal
   Requests → Shift swaps (#/requests/swaps).
   1. Someone asks a colleague to swap shifts (their date for the colleague's
      date) or to cover a shift (no date in return).
   2. The colleague accepts or declines.
   3. Management approves or declines. On approval the database swaps the two
      people in the roster editor; management then publishes the roster.
   Needs database update 47. */
(function () {
  "use strict";

  const STATUS = {
    waiting_colleague: ["Waiting for colleague", "chip-leave-pending"],
    colleague_declined: ["Colleague declined", "chip-leave-declined"],
    waiting_management: ["Waiting for management", "chip-leave-pending"],
    approved: ["Approved", "chip-leave-approved"],
    declined: ["Declined by management", "chip-leave-declined"],
    cancelled: ["Cancelled", "chip-leave-cancelled"]
  };
  let notice = null;

  const fmt = (d) => new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Reykjavik" });
  const first = (n) => String(n || "").split(" ")[0];
  function what(s) {
    return s.colleague_date
      ? `${first(s.requester_name)} works ${fmt(s.colleague_date)} instead of ${first(s.colleague_name)} · ${first(s.colleague_name)} works ${fmt(s.requester_date)} instead of ${first(s.requester_name)}`
      : `${first(s.colleague_name)} covers ${first(s.requester_name)}’s shift on ${fmt(s.requester_date)}`;
  }

  async function render(main, ctx, tabsNode) {
    const { h, fill, pageHead, db, state, setStatus } = ctx;
    const me = state.profile.id, isMgmt = state.profile.role === "management";
    const redraw = () => render(main, ctx, tabsNode);
    fill(main, pageHead("Requests"), tabsNode, h("p", { class: "empty" }, "Loading…"));
    const [sr, cr] = await Promise.all([
      db.from("shift_swaps").select("*").order("created_at", { ascending: false }).limit(200),
      db.rpc("colleagues")
    ]);
    if (sr.error) { fill(main, pageHead("Requests"), tabsNode, h("p", { class: "notice is-error" }, "Shift swaps aren’t set up yet (database update 47).")); return; }
    const swaps = sr.data || [], colleagues = (cr.data || []).filter((c) => c.id !== me);
    const status = h("p", { class: "status", role: "status" });

    async function setTo(s, to, extra, okText) {
      const r = await db.from("shift_swaps").update(Object.assign({ status: to }, extra || {})).eq("id", s.id).select("*");
      if (r.error) { setStatus(status, r.error.message, true); return; }
      const row = (r.data || [])[0] || {};
      if (to === "approved") {
        notice = row.roster_changes
          ? { text: `Approved. The roster editor has been updated (${row.roster_changes} ${row.roster_changes === 1 ? "entry" : "entries"}) – publish the roster so staff see it.`, link: true }
          : { text: "Approved. These dates weren’t found in the roster editor (for example an uploaded Excel roster), so please update the roster by hand.", link: true };
      } else notice = { text: okText };
      redraw();
    }
    const chip = (s) => h("span", { class: "chip " + (STATUS[s.status] || ["", ""])[1] }, (STATUS[s.status] || [s.status])[0]);

    // ---- ask for a swap ----
    const myDate = h("input", { type: "date", min: today(), required: true });
    const who = h("select", { required: true }, h("option", { value: "" }, "Choose a colleague…"), colleagues.map((c) => h("option", { value: c.id }, c.name)));
    const theirDate = h("input", { type: "date", min: today() });
    const msg = h("input", { type: "text", maxlength: "300", placeholder: "e.g. Family event on the 3rd" });
    const send = h("button", { class: "btn", type: "button" }, "Send request");
    const formMsg = h("p", { class: "status", role: "status" });
    send.addEventListener("click", async () => {
      if (!myDate.value) { setStatus(formMsg, "Choose the date of your shift.", true); return; }
      if (!who.value) { setStatus(formMsg, "Choose a colleague.", true); return; }
      send.disabled = true;
      const r = await db.from("shift_swaps").insert({ requester_date: myDate.value, colleague_id: who.value, colleague_date: theirDate.value || null, message: msg.value.trim() || null });
      send.disabled = false;
      if (r.error) { setStatus(formMsg, r.error.message, true); return; }
      notice = { text: `Request sent to ${who.options[who.selectedIndex].text}. They’ll see it on their Home page and here.` };
      redraw();
    });
    const askPanel = h("details", { class: "panel", open: !swaps.length || null },
      h("summary", null, "Ask to swap or cover a shift"),
      h("p", null, "Your colleague accepts first, then management approves. Once approved, the roster is updated."),
      h("div", { class: "form-grid" },
        h("label", { class: "field" }, h("span", null, "Your shift (date)"), myDate),
        h("label", { class: "field" }, h("span", null, "Colleague"), who),
        h("label", { class: "field" }, h("span", null, "Their shift you’ll work (date)"), theirDate, h("span", { class: "sub" }, "Leave empty if they’re just covering your shift")),
        h("label", { class: "field field-wide" }, h("span", null, "Message (optional)"), msg)),
      send, formMsg);

    // ---- waiting for me (as the colleague) ----
    const forMe = swaps.filter((s) => s.colleague_id === me && s.status === "waiting_colleague");
    const forMePanel = forMe.length ? h("section", { class: "panel panel-attention", "aria-labelledby": "sw-me" },
      h("h2", { id: "sw-me" }, `Waiting for your answer (${forMe.length})`),
      h("ul", { class: "clock-list" }, forMe.map((s) => {
        const yes = h("button", { class: "btn btn-small", type: "button" }, "Accept");
        const no = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Decline");
        yes.addEventListener("click", () => setTo(s, "waiting_management", null, "Accepted – it now goes to management for approval."));
        no.addEventListener("click", () => setTo(s, "colleague_declined", null, `Declined – ${first(s.requester_name)} can see your answer.`));
        return h("li", null, h("b", null, s.requester_name), " asks: ", what(s),
          s.message ? h("div", null, "“", h("i", null, s.message), "”") : null, h("div", { class: "row" }, yes, no));
      }))) : null;

    // ---- management: waiting for approval ----
    let mgmtPanel = null;
    if (isMgmt) {
      const waiting = swaps.filter((s) => s.status === "waiting_management" || s.status === "waiting_colleague");
      mgmtPanel = h("section", { class: "panel panel-management", "aria-labelledby": "sw-mg" },
        h("h2", { id: "sw-mg" }, `To approve (${waiting.filter((s) => s.status === "waiting_management").length})`),
        waiting.length ? h("ul", { class: "clock-list" }, waiting.map((s) => {
          const note = h("input", { type: "text", maxlength: "300", placeholder: "Note (optional)" });
          const ok = h("button", { class: "btn btn-small", type: "button", disabled: s.status !== "waiting_management" || null }, "Approve");
          const no = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Decline");
          ok.addEventListener("click", () => { if (confirm(`Approve? ${what(s)}.`)) setTo(s, "approved", { decision_note: note.value.trim() || null }); });
          no.addEventListener("click", () => setTo(s, "declined", { decision_note: note.value.trim() || null }, "Declined."));
          return h("li", null, h("b", null, `${s.requester_name} ↔ ${s.colleague_name}`), " ", chip(s),
            h("div", null, what(s)), s.message ? h("div", null, "“", h("i", null, s.message), "”") : null,
            s.status === "waiting_colleague" ? h("div", { class: "fineprint" }, `${first(s.colleague_name)} hasn’t answered yet.`) : null,
            h("div", { class: "row" }, note, ok, no));
        })) : h("p", { class: "empty" }, "Nothing waiting."));
    }

    // ---- history: mine (or everyone's for management) ----
    const shown = swaps.filter((s) => isMgmt || s.requester_id === me || s.colleague_id === me)
      .filter((s) => !(s.colleague_id === me && s.status === "waiting_colleague"))
      .filter((s) => !(isMgmt && (s.status === "waiting_management" || s.status === "waiting_colleague")));
    const list = h("section", { class: "panel", "aria-labelledby": "sw-all" },
      h("h2", { id: "sw-all" }, isMgmt ? "All swaps" : "Your swaps"),
      shown.length ? h("ul", { class: "clock-list" }, shown.map((s) => {
        const cancel = s.requester_id === me && (s.status === "waiting_colleague" || s.status === "waiting_management")
          ? h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Cancel request") : null;
        if (cancel) cancel.addEventListener("click", () => { if (confirm("Cancel this request?")) setTo(s, "cancelled", null, "Request cancelled."); });
        return h("li", null, chip(s), " ", what(s),
          s.decision_note ? h("div", { class: "fineprint" }, `${s.decided_by_name}: “${s.decision_note}”`) : (s.decided_by_name ? h("div", { class: "fineprint" }, `By ${s.decided_by_name}`) : null),
          cancel);
      })) : h("p", { class: "empty" }, "No swaps yet."));

    const n = notice; notice = null;
    fill(main, pageHead("Requests"), tabsNode,
      n ? h("p", { class: "notice" }, n.text, n.link && isMgmt ? [" ", h("a", { href: "#/roster/edit" }, "Open the roster editor")] : null) : null,
      forMePanel, mgmtPanel, askPanel, list, status);
  }

  // For Home: swaps waiting for this person, and (management) waiting for approval.
  async function attention(ctx) {
    const me = ctx.state.profile.id;
    const r = await ctx.db.from("shift_swaps").select("id, colleague_id, status").in("status", ["waiting_colleague", "waiting_management"]);
    if (r.error) return [];
    const rows = r.data || [], out = [];
    const mine = rows.filter((s) => s.colleague_id === me && s.status === "waiting_colleague").length;
    if (mine) out.push(`${mine} shift swap ${mine === 1 ? "request is" : "requests are"} waiting for your answer`);
    if (ctx.state.profile.role === "management") {
      const m = rows.filter((s) => s.status === "waiting_management").length;
      if (m) out.push(`${m} shift ${m === 1 ? "swap" : "swaps"} to approve`);
    }
    return out;
  }

  window.IAASwaps = { render, attention };
})();
