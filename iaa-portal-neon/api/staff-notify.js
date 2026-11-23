/* Iceland Aero Agents – Staff Portal
   Server function for staff emails:
   – leave: management is told about a new request; the person is told
     when it is approved or declined
   – service requests: vehicle defects and urgent requests are emailed
     to management straight away
   – passes & certificates: the person (with management copied) is
     reminded 30 days and 7 days before expiry, and when it has expired
   – invitations: the invited person gets the portal link and how to sign in
   – training renewals: when a module is due (P1–P5 6 months after passing,
     winter modules each 1 October), the person gets one email listing it
   – reminders from management: one email listing everything the person
     has outstanding (training, policies, passes, practical sign-offs)
   – new briefings: one email to everyone with a link to read and confirm
     (only briefings dated within the last 10 days, each emailed once)
   – contracts: the owner is emailed 60 and 30 days before the date notice
     must be given (or the contract ends), and before the date notice of each
     annual price review must reach the carrier

   POST /api/staff-notify  { "kind": "leave" | "service" | "remind" | "briefing", "id": 12 }
                           { "kind": "invite", "email": "name@gmail.com" }
   GET  /api/staff-notify  – Vercel every 10 minutes: sends anything missed
                             and any expiry reminders that are due

   Every email goes out once. Uses the same settings as report-notify.js. */

"use strict";

const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pool = null;
function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, max: 2, ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

let mailer = null;
function smtp() {
  if (!mailer) {
    if (process.env.SMTP_HOST === "json") {
      mailer = nodemailer.createTransport({ jsonTransport: true }); // local testing only
    } else {
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error("Email settings (SMTP_HOST, SMTP_USER, SMTP_PASS) are not set");
      }
      const port = parseInt(process.env.SMTP_PORT || "465", 10);
      mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: port, secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    }
  }
  return mailer;
}

const LEAVE_LABELS = { holiday: "Holiday", unavailable: "Unavailable", sick: "Sick leave", other: "Other" };
const SERVICE_LABELS = { stock: "Stock refill", vehicle_defect: "Vehicle defect", equipment: "Equipment request", issue: "Issue" };
const PASS_LABELS = {
  airport_pass: "Airport ID pass", airside_driving: "Airside driving permit", deicing: "De-icing",
  first_aid: "First aid", dangerous_goods: "Dangerous goods", security: "Security training",
  driving_licence: "Driving licence", other: "Other"
};

module.exports = async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
      if (body.kind === "invite") {
        const email = String(body.email || "").trim().toLowerCase();
        if (!email) return send(res, 400, { error: "email needed" });
        return send(res, 200, { results: [await inviteEmail(email)] });
      }
      const id = parseInt(body.id, 10);
      if (!id || ["leave", "service", "remind", "briefing"].indexOf(body.kind) === -1) return send(res, 400, { error: "kind and id needed" });
      const results = body.kind === "leave"
        ? [await leaveRequestEmail(id), await leaveDecisionEmail(id)]
        : body.kind === "remind" ? [await reminderEmail(id)]
        : body.kind === "briefing" ? [await briefingEmail(id)]
        : [await serviceEmail(id)];
      return send(res, 200, { results: results });
    }

    if (req.method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== "Bearer " + secret) return send(res, 401, { error: "Not allowed" });
      const results = [];
      const leave = await db().query(
        `select id from public.leave_requests
          where (status = 'pending' and notified_at is null)
             or (status in ('approved', 'declined') and decision_notified_at is null)
          order by id limit 20`);
      for (const r of leave.rows) { results.push(await leaveRequestEmail(r.id)); results.push(await leaveDecisionEmail(r.id)); }
      const service = await db().query(
        `select id from public.service_requests
          where notified_at is null and (kind = 'vehicle_defect' or urgency = 'urgent')
            and created_at < now() - interval '1 minute'
          order by id limit 20`);
      for (const r of service.rows) results.push(await serviceEmail(r.id));
      results.push.apply(results, await pendingReminders());
      results.push.apply(results, await pendingBriefings());
      results.push.apply(results, await contractReminders());
      results.push.apply(results, await priceReviewReminders());
      results.push.apply(results, await expiryReminders());
      results.push.apply(results, await trainingReminders());
      const invites = await db().query(
        `select email from public.invitations
          where accepted_at is null and invite_sent_at is null and invite_attempts < 5
            and created_at > now() - interval '60 days'
          order by created_at limit 20`);
      for (const r of invites.rows) results.push(await inviteEmail(r.email));
      return send(res, 200, { results: results });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("staff-notify failed:", err);
    return send(res, 500, { error: "Email could not be sent" });
  }
};

// ----------------------------------------------------------------------
async function managers() {
  const r = await db().query("select email from public.report_recipients order by email");
  return r.rows.map((x) => x.email);
}

async function leaveRequestEmail(id) {
  const c = await db().query(
    `update public.leave_requests set notify_claimed_at = now()
      where id = $1 and status = 'pending' and notified_at is null
        and (notify_claimed_at is null or notify_claimed_at < now() - interval '5 minutes')
      returning *`, [id]);
  if (!c.rows.length) return { id: id, email: "leave request", status: "nothing to send" };
  const l = c.rows[0];
  try {
    const p = (await db().query("select full_name, email from public.profiles where id = $1", [l.profile_id])).rows[0] || {};
    const name = p.full_name || p.email || "A staff member";
    const to = await managers();
    if (!to.length) throw new Error("No management recipients set up");
    const rows = [
      ["Person", name], ["Type", LEAVE_LABELS[l.kind] || l.kind],
      ["Dates", dateRange(l.start_date, l.end_date)], ["Note", l.note]
    ];
    await mail({
      to: to, replyTo: p.email,
      subject: `[IAA portal] ${LEAVE_LABELS[l.kind] || "Leave"} request: ${name}, ${dateRange(l.start_date, l.end_date)}`,
      kicker: "Leave request", title: name, rows: rows,
      link: portal() + "/#/requests/leave", linkLabel: "Approve or decline"
    });
    await db().query("update public.leave_requests set notified_at = now(), notify_claimed_at = null, notify_error = null where id = $1", [id]);
    return { id: id, email: "leave request", status: "sent" };
  } catch (err) {
    await db().query("update public.leave_requests set notify_claimed_at = null, notify_error = $2 where id = $1", [id, msg(err)]);
    return { id: id, email: "leave request", status: "failed" };
  }
}

async function leaveDecisionEmail(id) {
  const c = await db().query(
    `update public.leave_requests set decision_claimed_at = now()
      where id = $1 and status in ('approved', 'declined') and decision_notified_at is null
        and (decision_claimed_at is null or decision_claimed_at < now() - interval '5 minutes')
      returning *`, [id]);
  if (!c.rows.length) return { id: id, email: "leave decision", status: "nothing to send" };
  const l = c.rows[0];
  try {
    const p = (await db().query("select full_name, email from public.profiles where id = $1", [l.profile_id])).rows[0];
    if (!p || !p.email) throw new Error("Person has no email address");
    const word = l.status === "approved" ? "approved" : "declined";
    await mail({
      to: [p.email],
      subject: `Your ${(LEAVE_LABELS[l.kind] || "leave").toLowerCase()} request was ${word}`,
      kicker: "Leave request " + word,
      title: `${LEAVE_LABELS[l.kind] || "Leave"}: ${dateRange(l.start_date, l.end_date)}`,
      rows: [["Decision", word.charAt(0).toUpperCase() + word.slice(1)], ["Note from management", l.decision_note]],
      link: portal() + "/#/requests/leave", linkLabel: "Open in the portal"
    });
    await db().query("update public.leave_requests set decision_notified_at = now(), decision_claimed_at = null, notify_error = null where id = $1", [id]);
    return { id: id, email: "leave decision", status: "sent" };
  } catch (err) {
    await db().query("update public.leave_requests set decision_claimed_at = null, notify_error = $2 where id = $1", [id, msg(err)]);
    return { id: id, email: "leave decision", status: "failed" };
  }
}

async function serviceEmail(id) {
  const c = await db().query(
    `update public.service_requests set notify_claimed_at = now()
      where id = $1 and notified_at is null and (kind = 'vehicle_defect' or urgency = 'urgent')
        and (notify_claimed_at is null or notify_claimed_at < now() - interval '5 minutes')
      returning *`, [id]);
  if (!c.rows.length) return { id: id, email: "service request", status: "nothing to send" };
  const s = c.rows[0];
  try {
    const to = await managers();
    if (!to.length) throw new Error("No management recipients set up");
    const label = SERVICE_LABELS[s.kind] || s.kind;
    await mail({
      to: to,
      subject: `[IAA portal] ${s.urgency === "urgent" ? "URGENT " : ""}${label}: ${s.title}${s.station_code ? " (" + s.station_code + ")" : ""}`,
      kicker: label + (s.urgency === "urgent" ? " · Urgent" : ""), title: s.title,
      rows: [["Station", s.station_code || "Not given"], ["Vehicle / item", s.item], ["Quantity", s.quantity],
             ["Details", s.details], ["Raised by", s.requester_name], ["Raised", formatTime(s.created_at)]],
      link: portal() + "/#/requests/service", linkLabel: "Open in the portal"
    });
    await db().query("update public.service_requests set notified_at = now(), notify_claimed_at = null, notify_error = null where id = $1", [id]);
    return { id: id, email: "service request", status: "sent" };
  } catch (err) {
    await db().query("update public.service_requests set notify_claimed_at = null, notify_error = $2 where id = $1", [id, msg(err)]);
    return { id: id, email: "service request", status: "failed" };
  }
}

async function expiryReminders() {
  const due = await db().query(
    `select c.id, c.kind, c.label, c.expires_on, (c.expires_on - current_date) as days_left,
            c.reminded_30, c.reminded_7, c.reminded_expired, p.full_name, p.email
       from public.credentials c join public.profiles p on p.id = c.profile_id
      where p.active and c.expires_on is not null
        and ((c.expires_on < current_date and not c.reminded_expired)
          or (c.expires_on - current_date between 0 and 7 and not c.reminded_7)
          or (c.expires_on - current_date between 8 and 30 and not c.reminded_30))
      order by c.expires_on limit 50`);
  const out = [];
  if (!due.rows.length) return out;
  const cc = await managers();
  for (const c of due.rows) {
    const stage = c.days_left < 0 ? "expired" : c.days_left <= 7 ? "7" : "30";
    const set = stage === "expired" ? "reminded_expired = true, reminded_7 = true, reminded_30 = true"
      : stage === "7" ? "reminded_7 = true, reminded_30 = true" : "reminded_30 = true";
    const flag = stage === "expired" ? "reminded_expired" : "reminded_" + stage;
    const claimed = await db().query(`update public.credentials set ${set} where id = $1 and not ${flag} returning id`, [c.id]);
    if (!claimed.rows.length) continue;
    const what = c.label || PASS_LABELS[c.kind] || c.kind;
    const when = stage === "expired"
      ? `expired on ${formatDate(c.expires_on)}`
      : `expires on ${formatDate(c.expires_on)} (in ${c.days_left} ${c.days_left === 1 ? "day" : "days"})`;
    try {
      await mail({
        to: [c.email], cc: cc,
        subject: `${what} ${stage === "expired" ? "has expired" : "expires soon"}: ${c.full_name || c.email}`,
        kicker: "Passes & certificates", title: `${what} ${when}`,
        rows: [["Person", c.full_name || c.email], ["Pass / certificate", what], ["Expiry", formatDate(c.expires_on)]],
        note: "Please arrange the renewal, then update the new expiry date in the portal.",
        link: portal() + "/#/passes", linkLabel: "Update in the portal"
      });
      out.push({ id: c.id, email: "expiry " + stage, status: "sent" });
    } catch (err) {
      await db().query(`update public.credentials set ${flag} = false where id = $1`, [c.id]);
      out.push({ id: c.id, email: "expiry " + stage, status: "failed" });
    }
  }
  return out;
}

// ----------------------------------------------------------------------
// Training renewals. The modules and renewal rules come from the same file
// the portal uses (public/training-content.js), included with this function
// in vercel.json.
function trainingContent() {
  const file = path.join(process.cwd(), "public", "training-content.js");
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.window.TRAINING;
}

async function trainingReminders() {
  let T;
  try { T = trainingContent(); } catch (err) { return [{ kind: "training", status: "skipped – training content not found" }]; }
  const today = new Date().toISOString().slice(0, 10);
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
  const [people, atts, certs, sentRows] = await Promise.all([
    db().query("select id, email, full_name, station_codes from public.profiles where active"),
    db().query("select profile_id, module, attempted_at from public.training_attempts where profile_id is not null and passed"),
    db().query("select profile_id, module, passed_at, signed_at from public.training_signoffs where profile_id is not null and revoked_at is null"),
    db().query("select profile_id, module, due_on::text as due_on from public.training_reminders")
  ]);
  const sent = new Set(sentRows.rows.map((r) => r.profile_id + "|" + r.module + "|" + r.due_on));
  const results = [];
  for (const p of people.rows) {
    const codes = p.station_codes || [];
    const due = [];
    for (const m of T.modules) {
      if (m.stations && !m.stations.some((c) => codes.indexOf(c) !== -1)) continue;
      // Same rule as the portal: the latest completion decides the due date.
      const passes = atts.rows.filter((a) => a.profile_id === p.id && a.module === m.id).map((a) => iso(a.attempted_at)).sort();
      const cs = certs.rows.filter((c) => c.profile_id === p.id && c.module === m.id)
        .sort((x, y) => iso(x.signed_at || x.passed_at).localeCompare(iso(y.signed_at || y.passed_at)));
      const lastPass = passes.length ? passes[passes.length - 1] : null;
      const lastCert = cs.length ? cs[cs.length - 1] : null;
      const certTime = lastCert ? iso(lastCert.signed_at || lastCert.passed_at) : "";
      const completed = lastPass && (!lastCert || lastPass > certTime) ? lastPass : lastCert ? iso(lastCert.passed_at) : lastPass;
      if (!completed) continue;
      const dueOn = T.dueDate(completed, m);
      if (dueOn && dueOn <= today && !sent.has(p.id + "|" + m.id + "|" + dueOn)) due.push({ m: m, completed: completed, dueOn: dueOn });
    }
    if (!due.length) continue;
    try {
      const fmt = (d) => new Date(d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      await mail({
        to: [p.email],
        subject: due.length === 1 ? `Training due for renewal: ${due[0].m.code} ${due[0].m.title}` : `${due.length} training modules due for renewal`,
        kicker: "Training",
        title: "Your training is due for renewal",
        rows: due.map((x) => [x.m.code + " " + x.m.title, "Completed " + fmt(x.completed) + ". Due " + fmt(x.dueOn) + "."]),
        note: "Open each module in the IAA Staff Portal, read through it and retake the quiz. Each module is renewed on its own cycle: most every 6 months, the winter modules every year before 1 October. Your earlier completions and certificates stay on your record.",
        link: portal() + "/#/training", linkLabel: "Open my training"
      });
      for (const x of due) {
        await db().query("insert into public.training_reminders (profile_id, module, due_on) values ($1, $2, $3) on conflict do nothing", [p.id, x.m.id, x.dueOn]);
      }
      results.push({ kind: "training", email: p.email, modules: due.map((x) => x.m.code), status: "sent" });
    } catch (err) {
      results.push({ kind: "training", email: p.email, status: "failed", error: msg(err) });
    }
  }
  return results;
}

const ROLE_LABELS = { staff: "Staff", station_lead: "Station lead", management: "Management" };

async function inviteEmail(email) {
  const c = await db().query(
    `update public.invitations
        set invite_claimed_at = now(), invite_attempts = invite_attempts + 1
      where email = $1 and accepted_at is null and invite_sent_at is null and invite_attempts < 5
        and (invite_claimed_at is null or invite_claimed_at < now() - interval '5 minutes')
      returning *`, [email]);
  if (!c.rows.length) return { email: email, kind: "invite", status: "nothing to send" };
  const inv = c.rows[0];
  try {
    const by = inv.invited_by
      ? (await db().query("select full_name, email from public.profiles where id = $1", [inv.invited_by])).rows[0]
      : null;
    const byName = by ? (by.full_name || by.email) : "Iceland Aero Agents management";
    const stations = (inv.station_codes || []).length ? inv.station_codes.join(", ") : null;
    await mail({
      to: [inv.email],
      replyTo: by && by.email ? by.email : undefined,
      subject: "You're invited to the Iceland Aero Agents Staff Portal",
      kicker: "Invitation",
      title: (inv.full_name ? "Hi " + inv.full_name.split(/\s+/)[0] + ", you're invited" : "You're invited") + " to the IAA Staff Portal",
      rows: [
        ["Sign in with", inv.email],
        ["Role", ROLE_LABELS[inv.role] || inv.role],
        ["Stations", stations],
        ["Invited by", byName]
      ],
      steps: [
        "Open the staff portal with the button below. On a phone, if it opens inside your email app, choose Open in Safari or Chrome.",
        "Enter this email address (" + inv.email + ") and press Send code.",
        "We email you a 6-digit code from admin@iaa.is. If it doesn't arrive within a couple of minutes, check Spam or Promotions.",
        "Enter the code and you're in. Next time, sign in the same way."
      ],
      note: "In the portal you'll find the weekly briefings, the roster, your training and certificates, reports, and leave and other requests.",
      link: portal() + "/", linkLabel: "Open the staff portal"
    });
    await db().query("update public.invitations set invite_sent_at = now(), invite_claimed_at = null, invite_error = null where email = $1", [email]);
    return { email: email, kind: "invite", status: "sent" };
  } catch (err) {
    await db().query("update public.invitations set invite_claimed_at = null, invite_error = $2 where email = $1", [email, msg(err)]);
    return { email: email, kind: "invite", status: "failed" };
  }
}

// ----------------------------------------------------------------------
// Reminders from management: one email per person, listing everything they
// have outstanding. Built with the same rules as the preview (outstanding.js).
function outstandingLib() {
  const file = path.join(process.cwd(), "public", "outstanding.js");
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.window.IAAOutstanding;
}

async function reminderEmail(id) {
  // Claim it, so the button and the sweep never send the same reminder twice.
  const claim = await db().query("update public.staff_reminders set status = 'sending' where id = $1 and status = 'pending' returning *", [id]);
  if (!claim.rows.length) return { kind: "remind", id: id, status: "skipped – already handled" };
  const r = claim.rows[0];
  try {
    const T = trainingContent(), O = outstandingLib();
    const pr = await db().query("select id, email, full_name, station_codes, active from public.profiles where id = $1", [r.profile_id]);
    const p = pr.rows[0];
    if (!p || !p.active) throw new Error("No active portal account");
    const [atts, certs, pols, reads, creds, prac, sender] = await Promise.all([
      db().query("select module, attempted_at from public.training_attempts where profile_id = $1 and passed", [p.id]),
      db().query("select module, passed_at, signed_at from public.training_signoffs where profile_id = $1 and revoked_at is null", [p.id]),
      db().query("select id, title, version, requires_ack from public.documents where kind = 'policy' order by sort_order, title"),
      db().query("select document_id, version from public.document_reads where profile_id = $1", [p.id]),
      db().query("select kind, label, expires_on::text as expires_on from public.credentials where profile_id = $1", [p.id]),
      db().query("select skill, assessed_on::text as assessed_on, result from public.practical_signoffs where profile_id = $1", [p.id]),
      db().query("select email, full_name from public.profiles where id = $1", [r.created_by])
    ]);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Reykjavik" });
    const items = O.compute({ T: T, stations: p.station_codes || [], attempts: atts.rows, certs: certs.rows, policies: pols.rows,
      reads: reads.rows, credentials: creds.rows, practical: prac.rows, today: today });
    if (!items.count) {
      await db().query("update public.staff_reminders set status = 'nothing', items = $2, sent_at = now() where id = $1", [id, JSON.stringify(items)]);
      return { kind: "remind", id: id, email: p.email, status: "nothing outstanding – not sent" };
    }
    const first = String(p.full_name || "").trim().split(/\s+/)[0];
    const by = sender.rows[0] || {};
    await mail({
      to: [p.email],
      replyTo: by.email || undefined,
      subject: `Reminder: ${items.count} ${items.count === 1 ? "thing" : "things"} to complete in the IAA Staff Portal`,
      kicker: "Reminder from management",
      title: `${first ? "Hi " + first + ", you" : "You"} have ${items.count} ${items.count === 1 ? "thing" : "things"} to complete`,
      intro: r.message ? { from: r.created_by_name || by.full_name || "Management", text: r.message } : null,
      sections: O.SECTIONS.filter((x) => items[x[0]].length).map((x) => ({ heading: x[1], rows: items[x[0]], link: x[2] && portal() ? portal() + x[2] : null })),
      note: "Please complete these as soon as you can. If something is wrong or already done, reply to this email.",
      link: portal() + "/", linkLabel: "Open the staff portal"
    });
    await db().query("update public.staff_reminders set status = 'sent', items = $2, sent_at = now(), error = null where id = $1", [id, JSON.stringify(items)]);
    return { kind: "remind", id: id, email: p.email, count: items.count, status: "sent" };
  } catch (err) {
    await db().query("update public.staff_reminders set status = 'failed', error = $2 where id = $1", [id, msg(err)]);
    return { kind: "remind", id: id, status: "failed", error: msg(err) };
  }
}

// Sweep: send any reminder the button did not (for example if the page was closed).
async function pendingReminders() {
  const t = await db().query("select to_regclass('public.staff_reminders') is not null as ok");
  if (!t.rows[0].ok) return [];
  await db().query("update public.staff_reminders set status = 'pending' where status = 'sending' and created_at < now() - interval '15 minutes'");
  const rows = await db().query("select id from public.staff_reminders where status = 'pending' and created_at < now() - interval '1 minute' order by id limit 30");
  const out = [];
  for (const r of rows.rows) out.push(await reminderEmail(r.id));
  return out;
}

// ----------------------------------------------------------------------
// New briefings: one email to everyone with an active portal account.
// Each briefing is emailed once. Only briefings dated within the last
// 10 days are emailed, so uploading back issues sends nothing.
async function briefingEmail(id) {
  const t = await db().query("select to_regclass('public.briefings') is not null and exists (select 1 from information_schema.columns where table_name = 'briefings' and column_name = 'emailed_at') as ok");
  if (!t.rows[0].ok) return { kind: "briefing", id: id, status: "skipped – database update 34 not run" };
  const claim = await db().query(
    "update public.briefings set emailed_at = now(), email_note = null where id = $1 and emailed_at is null " +
    "returning id, issue_no, issue_date::text as issue_date, title, sections", [id]);
  if (!claim.rows.length) return { kind: "briefing", id: id, status: "skipped – already emailed" };
  const b = claim.rows[0];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Reykjavik" });
  const tenAgo = new Date(Date.parse(today + "T12:00:00Z") - 10 * 86400000).toISOString().slice(0, 10);
  if (b.issue_date < tenAgo) {
    await db().query("update public.briefings set email_note = 'Older than 10 days – not emailed' where id = $1", [id]);
    return { kind: "briefing", id: id, issue: b.issue_no, status: "not emailed – older than 10 days" };
  }
  try {
    const people = await db().query("select email from public.profiles where active and email is not null and email <> ''");
    const emails = Array.from(new Set(people.rows.map((p) => String(p.email).trim().toLowerCase()).filter(Boolean)));
    if (!emails.length) throw new Error("No active staff to email");
    const link = portal() + "/#/briefings/" + b.issue_no;
    const sections = (b.sections || []).filter(Boolean);
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@iaa.is";
    const fromAddr = (String(from).match(/<([^>]+)>/) || [null, from])[1];
    // Everyone as blind copies, in groups, so nobody sees the whole list.
    for (let i = 0; i < emails.length; i += 45) {
      await mail({
        to: [fromAddr], bcc: emails.slice(i, i + 45),
        subject: `New briefing: #${b.issue_no} ${b.title || "IAA Briefing"}`,
        kicker: "Briefing #" + b.issue_no + " · " + new Date(b.issue_date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
        title: b.title || "IAA Briefing",
        sections: sections.length ? [{ heading: "In this issue", rows: sections.slice(0, 12).map((x) => [x, ""]) }] : [],
        note: "Please read it in the staff portal, then select “I’ve read this briefing” at the end so management knows you have seen it.",
        link: link, linkLabel: "Read and confirm"
      });
    }
    await db().query("update public.briefings set email_note = $2 where id = $1", [id, "Emailed to " + emails.length + " people"]);
    return { kind: "briefing", id: id, issue: b.issue_no, status: "sent", to: emails.length };
  } catch (err) {
    // Let the 10-minute sweep try again.
    await db().query("update public.briefings set emailed_at = null, email_note = $2 where id = $1", [id, "Failed: " + msg(err)]);
    return { kind: "briefing", id: id, status: "failed", error: msg(err) };
  }
}

async function pendingBriefings() {
  const t = await db().query("select exists (select 1 from information_schema.columns where table_name = 'briefings' and column_name = 'emailed_at') as ok");
  if (!t.rows[0].ok) return [];
  const rows = await db().query("select id from public.briefings where emailed_at is null and published_at < now() - interval '2 minutes' order by issue_no limit 5");
  const out = [];
  for (const r of rows.rows) out.push(await briefingEmail(r.id));
  return out;
}

// Contracts: the owner (or all management, if there is no owner) is emailed
// 60 and 30 days before the date notice must be given – the end date less the
// notice period – and once if that date has already passed.
async function contractReminders() {
  const t = await db().query("select to_regclass('public.contracts') is not null as ok");
  if (!t.rows[0].ok) return [];
  const rows = await db().query(
    "select c.*, c.end_date::text as end_txt, (c.end_date - coalesce(c.notice_days, 0))::text as act_txt, " +
    "(c.end_date - coalesce(c.notice_days, 0)) - (now() at time zone 'Atlantic/Reykjavik')::date as days_left, " +
    "p.email as owner_email, p.full_name as owner_name " +
    "from public.contracts c left join public.profiles p on p.id = c.owner_id and p.active " +
    "where c.status = 'active' and c.end_date is not null and c.end_date > (now() at time zone 'Atlantic/Reykjavik')::date - 60 " +
    "and ((c.reminded_30_at is null and (c.end_date - coalesce(c.notice_days, 0)) - (now() at time zone 'Atlantic/Reykjavik')::date <= 30) " +
    "  or (c.reminded_60_at is null and (c.end_date - coalesce(c.notice_days, 0)) - (now() at time zone 'Atlantic/Reykjavik')::date <= 60))");
  if (!rows.rows.length) return [];
  const mgmt = await db().query("select email from public.profiles where role = 'management' and active");
  const out = [];
  const nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  for (const c of rows.rows) {
    const days = Number(c.days_left);
    const which = days <= 30 ? "30" : "60";
    const to = c.owner_email ? [c.owner_email] : mgmt.rows.map((r) => r.email);
    if (!to.length) continue;
    const what = c.auto_renews ? "renews automatically unless notice is given" : c.kind === "licence" ? "expires – apply for renewal" : "ends";
    const when = days < 0 ? `was due ${nice(c.act_txt)}` : days === 0 ? "is due today" : `is due by ${nice(c.act_txt)} (${days} ${days === 1 ? "day" : "days"})`;
    try {
      await mail({
        to: to,
        subject: `Contract: action ${days < 0 ? "overdue" : "due"} – ${c.title || c.counterparty}`,
        kicker: "Contracts tracker",
        title: `${c.title || c.counterparty}: action ${when}`,
        rows: [
          ["Counterparty", c.counterparty],
          ["What happens", `${c.auto_renews ? "Renews" : "Ends"} on ${nice(c.end_txt)}` + (c.notice_days ? `, notice period ${c.notice_days} days` : "")],
          ["Action", what.charAt(0).toUpperCase() + what.slice(1)],
          c.reference ? ["Reference", c.reference] : null,
          c.notes ? ["Notes", c.notes] : null
        ].filter(Boolean),
        note: "Update the contract in Management → Contracts once it is renewed, ended or replaced – a new end date restarts these reminders.",
        link: portal() + "/#/management", linkLabel: "Open the contracts tracker"
      });
      if (which === "30") await db().query("update public.contracts set reminded_30_at = now(), reminded_60_at = coalesce(reminded_60_at, now()) where id = $1", [c.id]);
      else await db().query("update public.contracts set reminded_60_at = now() where id = $1", [c.id]);
      out.push({ kind: "contract", id: c.id, to: to, mark: which, status: "sent" });
    } catch (err) { out.push({ kind: "contract", id: c.id, status: "failed", error: msg(err) }); }
  }
  return out;
}

// Annual price reviews: on the anniversary of the start date, prices may be
// adjusted if the carrier is told review_notice_days before. The owner is
// reminded 60 and 30 days before that notice date, once per anniversary.
function nextAnniversary(start, todayIso) {
  const m = start.slice(5, 7), d = start.slice(8, 10);
  const at = (y) => { const dt = new Date(`${y}-${m}-${d}T12:00:00Z`); return isNaN(dt) || dt.getUTCDate() !== +d ? `${y}-${m}-28` : `${y}-${m}-${d}`; };
  let y = +todayIso.slice(0, 4), a = at(y);
  if (a < todayIso) a = at(++y);
  while (a <= start) a = at(++y);
  return a;
}
async function priceReviewReminders() {
  const t = await db().query("select exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'annual_review') as ok");
  if (!t.rows[0].ok) return [];
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Reykjavik" });
  const rows = await db().query(
    "select c.id, c.counterparty, c.title, c.start_date::text as start_txt, c.review_notice_days, c.review_done_for::text as done_for, " +
    "c.review_reminded_60_for::text as r60, c.review_reminded_30_for::text as r30, c.notes, p.email as owner_email " +
    "from public.contracts c left join public.profiles p on p.id = c.owner_id and p.active " +
    "where c.status = 'active' and c.annual_review and c.start_date is not null");
  if (!rows.rows.length) return [];
  const mgmt = await db().query("select email from public.profiles where role = 'management' and active");
  const nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const out = [];
  for (const c of rows.rows) {
    const ann = nextAnniversary(c.start_txt, todayIso);
    if (c.done_for === ann) continue;
    const by = new Date(Date.parse(ann + "T12:00:00Z") - (c.review_notice_days || 0) * 86400000).toISOString().slice(0, 10);
    const days = Math.round((Date.parse(by + "T12:00:00Z") - Date.parse(todayIso + "T12:00:00Z")) / 86400000);
    const which = days <= 30 ? (c.r30 === ann ? null : "30") : days <= 60 ? (c.r60 === ann ? null : "60") : null;
    if (!which) continue;
    const to = c.owner_email ? [c.owner_email] : mgmt.rows.map((r) => r.email);
    if (!to.length) continue;
    try {
      await mail({
        to: to,
        subject: `Price review: ${c.counterparty} – ${days < 0 ? "notice date passed" : "send notice by " + nice(by)}`,
        kicker: "Contracts tracker · annual price review",
        title: `${c.counterparty}: price review on ${nice(ann)}`,
        rows: [
          ["Agreement", c.title || "–"],
          ["Anniversary of the start date", nice(ann)],
          ["Notice to the carrier needed by", nice(by) + (c.review_notice_days ? ` (${c.review_notice_days} days before)` : "")],
          c.notes ? ["Notes", c.notes] : null
        ].filter(Boolean),
        note: "Decide whether to adjust prices (for example by the Icelandic price or wage index), send written notice to the carrier in time, update the rates in Regla, then mark the review done in Management → Contracts.",
        link: portal() + "/#/management", linkLabel: "Open the contracts tracker"
      });
      if (which === "30") await db().query("update public.contracts set review_reminded_30_for = $2, review_reminded_60_for = coalesce(review_reminded_60_for, $2) where id = $1", [c.id, ann]);
      else await db().query("update public.contracts set review_reminded_60_for = $2 where id = $1", [c.id, ann]);
      out.push({ kind: "price_review", id: c.id, anniversary: ann, mark: which, status: "sent" });
    } catch (err) { out.push({ kind: "price_review", id: c.id, status: "failed", error: msg(err) }); }
  }
  return out;
}

// ----------------------------------------------------------------------
async function mail(o) {
  const rows = (o.rows || []).filter((r) => r[1] !== null && r[1] !== undefined && String(r[1]).trim() !== "");
  const steps = o.steps || [];
  const sections = o.sections || [];
  const text = (o.intro ? "Message from " + o.intro.from + ":\n" + o.intro.text + "\n\n" : "") +
    sections.map((sec) => sec.heading.toUpperCase() + "\n" + sec.rows.map((r) => "- " + r[0] + (r[1] ? ": " + r[1] : "")).join("\n") + (sec.link ? "\n" + sec.link : "")).join("\n\n") +
    (sections.length && rows.length ? "\n\n" : "") +
    rows.map((r) => r[0] + ": " + r[1]).join("\n") +
    (steps.length ? "\n\nHow to sign in:\n" + steps.map((t, i) => (i + 1) + ". " + t).join("\n") : "") +
    (o.note ? "\n\n" + o.note : "") + (portal() && o.link ? "\n\n" + o.linkLabel + ": " + o.link : "");
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a222f;max-width:620px">' +
    '<div style="background:#263449;color:#ffffff;padding:16px 20px;border-radius:8px 8px 0 0">' +
    '<div style="font-size:13px;color:#a9ddd5">IAA Staff Portal · ' + esc(o.kicker) + "</div>" +
    '<div style="font-size:20px;font-weight:bold;margin-top:4px">' + esc(o.title) + "</div></div>" +
    '<div style="border:1px solid #c9e0db;border-top:0;padding:16px 20px;border-radius:0 0 8px 8px">' +
    (o.intro ? '<div style="background:#eef6f4;border-left:4px solid #07766d;padding:10px 14px;margin:0 0 14px;font-size:14px">' +
      '<div style="color:#4f6470;font-size:12px;margin-bottom:4px">Message from ' + esc(o.intro.from) + '</div>' +
      '<div style="white-space:pre-wrap">' + esc(o.intro.text) + '</div></div>' : "") +
    sections.map((sec) => '<p style="font-size:15px;font-weight:bold;margin:14px 0 4px">' + esc(sec.heading) + "</p>" +
      '<table style="width:100%;border-collapse:collapse">' + sec.rows.map((r) => r[1]
        ? '<tr><td style="padding:5px 0;vertical-align:top;width:50%;font-size:14px;border-top:1px solid #e3eeeb">' + esc(r[0]) +
          '</td><td style="padding:5px 0;vertical-align:top;font-size:14px;color:#4f6470;border-top:1px solid #e3eeeb">' + esc(r[1]) + "</td></tr>"
        : '<tr><td colspan="2" style="padding:5px 0;vertical-align:top;font-size:14px;border-top:1px solid #e3eeeb">' + esc(r[0]) + "</td></tr>").join("") + "</table>" +
      (sec.link ? '<p style="margin:4px 0 0;font-size:13px"><a href="' + esc(sec.link) + '" style="color:#07766d">Open in the portal</a></p>' : "")).join("") +
    '<table style="width:100%;border-collapse:collapse">' + rows.map((r) =>
      '<tr><td style="padding:6px 0;vertical-align:top;width:34%;color:#4f6470;font-size:14px">' + esc(r[0]) +
      '</td><td style="padding:6px 0;font-size:14px;white-space:pre-wrap">' + esc(r[1]) + "</td></tr>").join("") + "</table>" +
    (steps.length ? '<p style="font-size:14px;font-weight:bold;margin:16px 0 6px">How to sign in</p><ol style="font-size:14px;padding-left:20px;margin:0">' +
      steps.map((t) => '<li style="margin:4px 0">' + esc(t) + "</li>").join("") + "</ol>" : "") +
    (o.note ? '<p style="font-size:14px">' + esc(o.note) + "</p>" : "") +
    (portal() && o.link ? '<p style="margin:18px 0"><a href="' + esc(o.link) + '" style="background:#07766d;color:#ffffff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:bold">' + esc(o.linkLabel) + "</a></p>" : "") +
    "</div></div>";
  await smtp().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "IAA Staff Portal <no-reply@iaa.is>",
    to: o.to, cc: o.cc && o.cc.length ? o.cc : undefined, bcc: o.bcc && o.bcc.length ? o.bcc : undefined, replyTo: o.replyTo || undefined,
    subject: o.subject, text: text, html: html
  });
}

function portal() { return (process.env.PORTAL_URL || "").replace(/\/+$/, ""); }
function msg(err) { return String(err && err.message ? err.message : err).slice(0, 500); }
function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(String(d).slice(0, 10) + "T12:00:00Z");
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Atlantic/Reykjavik" });
}
function dateRange(a, b) {
  const x = formatDate(a), y = formatDate(b);
  return x === y ? x : x + " – " + y;
}
function formatTime(v) {
  return new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Atlantic/Reykjavik" });
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
