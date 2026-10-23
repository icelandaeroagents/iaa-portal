/* Iceland Aero Agents – Staff Portal
   Server function: emails each new report to the people in the
   report_recipients table, with its photos attached.

   POST /api/report-notify  { "id": 12 }  – called by the portal right after a report is submitted
   GET  /api/report-notify                 – called by Vercel every 10 minutes to send anything missed

   Each report is emailed once. Calling this again for a report that has
   already been sent does nothing, so it is safe to call without signing in.

   Settings (Vercel → Project → Settings → Environment Variables):
     DATABASE_URL   added automatically by the Neon integration
     SMTP_HOST      e.g. smtp.gmail.com
     SMTP_PORT      e.g. 465
     SMTP_USER      e.g. admin@iaa.is
     SMTP_PASS      the app password (never put it in code)
     SMTP_FROM      optional, e.g. "IAA Staff Portal <admin@iaa.is>"
     PORTAL_URL     e.g. https://portal.iaa.is
     CRON_SECRET    any long random text; Vercel sends it with the 10-minute check */

"use strict";

const { Pool } = require("pg");
const nodemailer = require("nodemailer");

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
        host: process.env.SMTP_HOST,
        port: port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    }
  }
  return mailer;
}

const TYPE_LABELS = {
  incident: "Incident",
  near_miss: "Near miss",
  injury: "Injury",
  aircraft_damage: "Aircraft damage",
  equipment_damage: "Equipment (GSE) damage",
  hazard: "Safety hazard",
  security: "Security",
  customer_complaint: "Customer complaint",
  other: "Other"
};

const SEVERITY_LABELS = { low: "Low", medium: "Medium", high: "High" };

module.exports = async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
      const id = parseInt(body.id, 10);
      if (!id) return send(res, 400, { error: "Report id missing" });
      const result = await notifyOne(id);
      return send(res, 200, result);
    }

    if (req.method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== "Bearer " + secret) {
        return send(res, 401, { error: "Not allowed" });
      }
      const pending = await db().query(
        `select id from public.reports
          where notified_at is null
            and created_at < now() - interval '2 minutes'
            and (notify_claimed_at is null or notify_claimed_at < now() - interval '5 minutes')
          order by id limit 10`
      );
      const results = [];
      for (const row of pending.rows) results.push(await notifyOne(row.id));
      return send(res, 200, { checked: pending.rows.length, results: results });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("report-notify failed:", err);
    return send(res, 500, { error: "Email could not be sent" });
  }
};

async function notifyOne(id) {
  // Claim the report so two calls never send it twice.
  const claimed = await db().query(
    `update public.reports
        set notify_claimed_at = now(), notify_error = null
      where id = $1
        and notified_at is null
        and (notify_claimed_at is null or notify_claimed_at < now() - interval '5 minutes')
      returning *`,
    [id]
  );
  if (!claimed.rows.length) return { id: id, status: "already sent or in progress" };
  const r = claimed.rows[0];

  try {
    const [reporter, photos, recipients, station] = await Promise.all([
      db().query("select reporter_name, reporter_email, hide_name from public.report_reporters where report_id = $1", [id]),
      db().query("select id, mime, data from public.report_photos where report_id = $1 order by id", [id]),
      db().query("select email from public.report_recipients order by email"),
      r.station_code ? db().query("select name from public.stations where code = $1", [r.station_code]) : Promise.resolve({ rows: [] })
    ]);

    const to = recipients.rows.map((x) => x.email);
    if (!to.length) throw new Error("No report recipients set up");

    const who = reporter.rows[0] || {};
    const stationText = r.station_code ? r.station_code + (station.rows[0] ? " – " + station.rows[0].name : "") : "Not given";
    const number = reportNumber(r.id);
    const link = (process.env.PORTAL_URL || "").replace(/\/+$/, "") + "/#/reports/" + r.id;
    const typeLabel = TYPE_LABELS[r.report_type] || r.report_type;

    const rows = [
      ["Report", number],
      ["Type", typeLabel],
      ["Severity (reporter’s view)", SEVERITY_LABELS[r.severity] || "Not given"],
      ["Date and time", formatTime(r.occurred_at)],
      ["Station", stationText],
      ["Location", r.location],
      ["Description", r.description],
      ["Who was involved", r.people_involved],
      ["Aircraft", [r.aircraft_registration, r.aircraft_type].filter(Boolean).join(", ")],
      ["Flight number / callsign", r.flight_number],
      ["Operator / customer", r.operator],
      ["Equipment involved", r.equipment],
      ["Witnesses", r.witnesses],
      ["Conditions", r.conditions],
      ["Injuries", r.injuries ? "Yes" + (r.injury_details ? ": " + r.injury_details : "") : "No"],
      ["Damage", r.damage ? "Yes" + (r.damage_details ? ": " + r.damage_details : "") : "No"],
      ["Consequences", r.consequences],
      ["Immediate actions taken", r.immediate_actions],
      ["Suggestion for improvement", r.suggestion],
      ["Reported by", (who.reporter_name || r.reporter_display || "Unknown") + (who.reporter_email ? " <" + who.reporter_email + ">" : "") +
        (who.hide_name ? " (name withheld from other staff)" : "")],
      ["Submitted", formatTime(r.created_at)],
      ["Photos", photos.rows.length ? photos.rows.length + " attached" : "None"]
    ].filter((row) => row[1] !== null && row[1] !== undefined && String(row[1]).trim() !== "");

    const subject = `[IAA report ${number}] ${typeLabel} – ${r.station_code || "no station"} – ${formatTime(r.occurred_at, true)}`;

    const text =
      "A new internal report has been submitted in the IAA Staff Portal.\n\n" +
      rows.map((row) => row[0] + ":\n" + row[1]).join("\n\n") +
      (process.env.PORTAL_URL ? "\n\nOpen in the portal: " + link : "") +
      "\n\nThis report is confidential and for internal use only.";

    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a222f;max-width:680px">' +
      '<div style="background:#263449;color:#ffffff;padding:16px 20px;border-radius:8px 8px 0 0">' +
      '<div style="font-size:13px;color:#a9ddd5">IAA Staff Portal · Internal report</div>' +
      '<div style="font-size:20px;font-weight:bold;margin-top:4px">' + esc(number + " · " + typeLabel) + "</div></div>" +
      '<table style="width:100%;border-collapse:collapse;border:1px solid #c9e0db;border-top:0">' +
      rows.map((row) =>
        '<tr><td style="padding:8px 12px;border-bottom:1px solid #e4f2ef;vertical-align:top;width:34%;color:#4f6470;font-size:14px">' + esc(row[0]) +
        '</td><td style="padding:8px 12px;border-bottom:1px solid #e4f2ef;font-size:14px;white-space:pre-wrap">' + esc(row[1]) + "</td></tr>"
      ).join("") +
      "</table>" +
      (process.env.PORTAL_URL
        ? '<p style="margin:16px 0"><a href="' + esc(link) + '" style="background:#07766d;color:#ffffff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:bold">Open in the portal</a></p>'
        : "") +
      '<p style="font-size:12px;color:#4f6470">This report is confidential and for internal use only.</p></div>';

    const attachments = photos.rows.map((p, i) => ({
      filename: `${number}-photo-${i + 1}.${p.mime === "image/png" ? "png" : p.mime === "image/webp" ? "webp" : "jpg"}`,
      content: Buffer.from(p.data, "base64"),
      contentType: p.mime
    }));

    await smtp().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "IAA Staff Portal <no-reply@iaa.is>",
      to: to,
      replyTo: who.reporter_email || undefined,
      subject: subject,
      text: text,
      html: html,
      attachments: attachments
    });

    await db().query("update public.reports set notified_at = now(), notify_claimed_at = null, notify_error = null where id = $1", [id]);
    await db().query(
      "insert into public.audit_log (actor_id, action, details) values (null, 'report_emailed', $1)",
      [JSON.stringify({ report_id: id, recipients: to, photos: attachments.length })]
    );
    return { id: id, status: "sent", recipients: to.length };
  } catch (err) {
    await db().query(
      "update public.reports set notify_claimed_at = null, notify_error = $2 where id = $1",
      [id, String(err && err.message ? err.message : err).slice(0, 500)]
    );
    console.error("Report " + id + " email failed:", err);
    return { id: id, status: "failed" };
  }
}

function reportNumber(id) {
  return "R-" + String(id).padStart(4, "0");
}

function formatTime(value, short) {
  const d = new Date(value);
  const opts = short
    ? { day: "numeric", month: "short", year: "numeric", timeZone: "Atlantic/Reykjavik" }
    : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Atlantic/Reykjavik" };
  return d.toLocaleString("en-GB", opts) + (short ? "" : " (Iceland time)");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
