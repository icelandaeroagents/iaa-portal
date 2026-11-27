/* Iceland Aero Agents – Staff Portal
   POST /api/kiosk – the time clock iPad (public/kiosk.html).
   The iPad has no staff sign-in. It sends its device key (given once when
   management set it up) and the kennitala typed on the number pad. The
   kennitala is matched against the fingerprints in the private part of the
   database and is never stored or logged.
   Five wrong numbers within five minutes pause that iPad for five minutes.
   Needs database updates 44 and 45, and DATABASE_URL in Vercel. */
const { Pool } = require("pg");
const crypto = require("crypto");

let pool = null;
function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, max: 2, ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false } });
  }
  return pool;
}
const q = (sql, args) => db().query(sql, args);
const sha = (t) => crypto.createHash("sha256").update(String(t), "utf8").digest("hex");
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

const MAX_WRONG = 5;        // wrong numbers allowed …
const WRONG_WINDOW = 5;     // … within this many minutes

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch (e) { return send(res, 400, { error: "Bad request" }); }

  try {
    // 1. Which iPad is this?
    const token = String(body.token || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return send(res, 401, { error: "This iPad isn’t set up as a time clock. Ask management to set it up.", notSetUp: true });
    const k = (await q("select id, station, name, active from public.time_kiosks where token_hash = $1", [sha(token)])).rows[0];
    if (!k || !k.active) return send(res, 401, { error: "This iPad isn’t set up as a time clock, or has been switched off. Ask management.", notSetUp: true });
    if (body.action === "ping") return send(res, 200, { station: k.station, name: k.name });

    // 2. Too many wrong numbers recently?
    const wrong = (await q(`select count(*)::int as n from private.kiosk_attempts where kiosk_id = $1 and not ok and at > now() - make_interval(mins => $2)`, [k.id, WRONG_WINDOW])).rows[0].n;
    if (wrong >= MAX_WRONG) return send(res, 429, { error: `Too many wrong numbers. Wait ${WRONG_WINDOW} minutes and try again, or ask management.` });

    // 3. Who is it?
    const kt = String(body.kennitala || "").replace(/[^0-9]/g, "");
    if (kt.length !== 10) return send(res, 400, { error: "Type all ten digits of your kennitala." });
    const person = (await q(
      `select p.id, coalesce(nullif(trim(p.full_name), ''), p.email) as name
         from private.kennitala k join public.profiles p on p.id = k.profile_id
        where k.kt_hash = private.kennitala_hash($1) and p.active`, [kt])).rows[0];
    await q("insert into private.kiosk_attempts (kiosk_id, ok) values ($1, $2)", [k.id, !!person]);
    if (Math.random() < 0.05) await q("delete from private.kiosk_attempts where at < now() - interval '1 day'");
    if (!person) {
      const left = MAX_WRONG - wrong - 1;
      return send(res, 404, { error: "Kennitala not recognised. Check the number, or ask management to add it to your profile." +
        (left <= 0 ? ` This iPad is now paused for ${WRONG_WINDOW} minutes.` : left <= 2 ? ` (${left} ${left === 1 ? "try" : "tries"} left)` : "") });
    }
    await q("update public.time_kiosks set last_used_at = now() where id = $1", [k.id]);

    const openShift = async () => (await q(
      `select s.id, s.clock_in, (select count(*)::int from public.time_lunches l where l.shift_id = s.id) as lunches
         from public.time_shifts s where s.profile_id = $1 and s.clock_out is null limit 1`, [person.id])).rows[0] || null;
    let open = await openShift();
    const who = { name: firstName(person.name) };

    // 4. What do they want to do?
    const action = body.action || "lookup";
    if (action === "lookup") return send(res, 200, Object.assign(who, { open }));

    if (action === "clock_in") {
      if (open) return send(res, 409, Object.assign(who, { open, error: "You’re already clocked in." }));
      const ins = await q(
        `insert into public.time_shifts (profile_id, person_name, clock_in, in_station, in_confirmed, in_via, reviewed)
         values ($1, $2, now(), $3, true, $4, true) returning id, clock_in`, [person.id, person.name, k.station, k.name]);
      if (body.lunch) await q("insert into public.time_lunches (shift_id, kind) values ($1, 'at clock-in')", [ins.rows[0].id]);
      return send(res, 200, Object.assign(who, { done: "in", at: ins.rows[0].clock_in, lunch: !!body.lunch }));
    }

    if (!open) return send(res, 409, Object.assign(who, { open: null, error: "You’re not clocked in." }));

    if (action === "add_lunch") {
      const l = await q("insert into public.time_lunches (shift_id, kind) values ($1, 'added') returning added_at", [open.id]);
      return send(res, 200, Object.assign(who, { done: "lunch", at: l.rows[0].added_at }));
    }

    if (action === "clock_out") {
      if (body.lunch) await q("insert into public.time_lunches (shift_id, kind) values ($1, 'added')", [open.id]);
      const up = await q(
        `update public.time_shifts
            set clock_out = greatest(now(), clock_in + interval '1 minute'),
                out_station = $2, out_confirmed = true, out_via = $3
          where id = $1 and clock_out is null
          returning clock_in, clock_out`, [open.id, k.station, k.name]);
      const r = up.rows[0];
      const worked = Math.round((new Date(r.clock_out) - new Date(r.clock_in)) / 60000);
      return send(res, 200, Object.assign(who, { done: "out", at: r.clock_out, worked_minutes: worked }));
    }

    return send(res, 400, { error: "Unknown action" });
  } catch (err) {
    console.error("kiosk:", err && err.message);
    return send(res, 500, { error: "Something went wrong – try again, or use your phone to clock in." });
  }
};
