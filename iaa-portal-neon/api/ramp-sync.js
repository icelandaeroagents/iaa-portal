/* Iceland Aero Agents – Staff Portal
   Ramp: service logging, linked to Notion (replaces the Apps Script phone page).

   GET  /api/ramp-sync              every 10 minutes (Vercel cron, with CRON_SECRET):
                                     copy the services list and recent flights from Notion,
                                     then send logged services and completions to Notion
   POST /api/ramp-sync { kind }      from the portal:
        "push"                        send what has just been logged (the database decides what)
        "refresh"                     copy today's flights again (at most once a minute)
        "import", from, to            copy flights for a date range (October 2026 onwards, up to 62 days)

   Notion stays the master record. Needs NOTION_TOKEN (an internal integration with
   access to the three station databases, the Services Log and Services) and DATABASE_URL. */
const { Pool } = require("pg");

const NOTION = "https://api.notion.com/v1", NOTION_VERSION = "2025-09-03";
const STATIONS = {                                   // Notion data sources (collections)
  BIRK: "1cee8ba6-2aeb-80bf-9e3e-000b9a46e202",
  BIKF: "1cee8ba6-2aeb-8133-b156-000bc7ff2fb6",
  BIAR: "1cee8ba6-2aeb-81c2-8888-000bd6958a69"
};
const SERVICES = "668f02da-5f88-4ea2-a554-ad9e28acb8a3";
const SERVICES_LOG = "c2a774de-bb50-4da3-a4d9-9f15c92e2ad8";

let pool;
function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, max: 2, ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

// ----------------------------------------------------------------------
// Notion API
// ----------------------------------------------------------------------
async function notion(path, method, body) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not set in Vercel");
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(NOTION + path, {
      method: method || "GET",
      headers: { Authorization: "Bearer " + token, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 429 || r.status >= 500) {                    // rate limited or Notion having a moment
      const wait = Math.min(8, Number(r.headers.get("retry-after")) || 1 + attempt * 2);
      await new Promise((res) => setTimeout(res, wait * 1000));
      continue;
    }
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const hint = r.status === 401 ? " – check NOTION_TOKEN" : r.status === 404 ? " – is the database shared with the IAA Staff Portal integration?" : "";
      throw new Error(`Notion ${r.status}: ${json.message || r.statusText}${hint}`);
    }
    return json;
  }
  throw new Error("Notion is busy – will try again on the next run");
}
async function queryAll(dataSource, filter, maxPages) {
  const out = []; let cursor;
  for (let i = 0; i < (maxPages || 20); i++) {
    const body = { page_size: 100 }; if (filter) body.filter = filter; if (cursor) body.start_cursor = cursor;
    const r = await notion(`/data_sources/${dataSource}/query`, "POST", body);
    out.push(...(r.results || []));
    if (!r.has_more) break; cursor = r.next_cursor;
  }
  return out;
}
const text = (p) => (p && (p.title || p.rich_text) || []).map((t) => t.plain_text || "").join("").trim();
const rich = (s) => [{ type: "text", text: { content: String(s || "").slice(0, 1900) } }];

// Registrations are written loosely in Notion ("DCWIR", "LX-FYG / FYL51YG", "HBFSD / PCH29N - Hangar 3").
const PREFIXES = ["VP-C", "9H", "HB", "OE", "OY", "LX", "CS", "EI", "EC", "PH", "SE", "LN", "OH", "OK", "SP", "TF", "YU", "9A", "A6", "A7", "HZ", "PR", "PP", "VH", "ZS", "TC", "SX", "OO", "D", "F", "G", "I", "M", "C", "B", "P"];
function registration(name) {
  // the first word, before any "/", " - ", "(", "*" or space ("CFKBC *Hangar*" → "CFKBC")
  let first = String(name || "").trim().split(/\s*\/+\s*|\s+-\s+|\s*\(|\s*\*|\s+/)[0].trim().toUpperCase();
  if (!first) return null;
  if (/^N[0-9][0-9A-Z]{0,5}$/.test(first)) return first;          // US: no hyphen
  if (first.indexOf("-") !== -1) return first;
  if (/^[A-Z0-9]{4,7}$/.test(first)) {
    const p = PREFIXES.find((x) => first.startsWith(x.replace("-", "")) && first.length - x.replace("-", "").length >= 2);
    if (p) { const bare = p.replace("-", ""); return p === "VP-C" ? "VP-C" + first.slice(3) : bare + "-" + first.slice(bare.length); }
  }
  return first;
}

// ----------------------------------------------------------------------
// Copying from Notion
// ----------------------------------------------------------------------
async function syncServices() {
  const rows = await queryAll(SERVICES);
  for (const r of rows) {
    const p = r.properties || {};
    const stations = ["BIRK", "BIKF", "BIAR"].filter((s) => p[s] && p[s].checkbox);
    await db().query(
      `insert into public.service_types (notion_id, name, grp, unit, entry, sort, stations, active, synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (notion_id) do update set name = excluded.name, grp = excluded.grp, unit = excluded.unit, entry = excluded.entry,
         sort = excluded.sort, stations = excluded.stations, active = excluded.active, synced_at = now()`,
      [r.id, text(p.Service) || "Service", p.Group && p.Group.select ? p.Group.select.name : null, p.Unit && p.Unit.select ? p.Unit.select.name : null,
       p.Entry && p.Entry.select ? p.Entry.select.name : null, p.Order ? p.Order.number : null, stations, !p.Active || !!p.Active.checkbox]);
  }
  return rows.length;
}

async function syncFlights(from, to) {
  let count = 0;
  for (const [station, ds] of Object.entries(STATIONS)) {
    const filter = { or: [
      { and: [{ property: "Arrival", date: { on_or_after: from } }, { property: "Arrival", date: { on_or_before: to + "T23:59:59Z" } }] },
      { and: [{ property: "Departure", date: { on_or_after: from } }, { property: "Departure", date: { on_or_before: to + "T23:59:59Z" } }] }
    ] };
    const rows = await queryAll(ds, filter);
    for (const r of rows) {
      const p = r.properties || {};
      const name = text(p.Name) || "Flight";
      await db().query(
        `insert into public.flights (notion_id, station, name, registration, aircraft_type, operator, origin, destination, arrival, departure,
                                     services_requested, services_complete, services_checked, synced_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         on conflict (notion_id) do update set station = excluded.station, name = excluded.name, registration = excluded.registration,
           aircraft_type = excluded.aircraft_type, operator = excluded.operator, origin = excluded.origin, destination = excluded.destination,
           arrival = excluded.arrival, departure = excluded.departure, services_requested = excluded.services_requested,
           services_complete = excluded.services_complete, services_checked = excluded.services_checked, synced_at = now()`,
        [r.id, station, name, registration(name), text(p["Aircraft Type"]) || null,
         p["Veovo Code:"] && p["Veovo Code:"].select ? p["Veovo Code:"].select.name : null,
         text(p.From) || null, text(p.To) || null,
         p.Arrival && p.Arrival.date ? p.Arrival.date.start : null, p.Departure && p.Departure.date ? p.Departure.date.start : null,
         (p["Services Provided"] && p["Services Provided"].multi_select || []).map((x) => x.name),
         !!(p["Services complete"] && p["Services complete"].checkbox), text(p["Services checked"]) || null]);
      count++;
    }
  }
  return count;
}

// ----------------------------------------------------------------------
// Sending to Notion
// ----------------------------------------------------------------------
function stamp(d) {   // "Josh · 9 Oct 13:52Z" – the same style as the phone page
  const t = new Date(d);
  return `${t.getUTCDate()} ${t.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}Z`;
}
async function pushLogs() {
  const out = [];
  // claim new entries (and any stuck for 10 minutes)
  await db().query("update public.service_logs set status = 'pending' where status = 'sending' and logged_at < now() - interval '10 minutes'");
  const claim = await db().query(
    `update public.service_logs set status = 'sending' where id in (select id from public.service_logs where status = 'pending' order by id limit 40)
     returning id`);
  for (const { id } of claim.rows) {
    const q = await db().query(
      `select l.*, f.notion_id as flight_notion, f.station, f.registration, f.name as flight_name, s.notion_id as service_notion, s.name as service_name, s.unit
         from public.service_logs l join public.flights f on f.id = l.flight_id join public.service_types s on s.id = l.service_type_id where l.id = $1`, [id]);
    const l = q.rows[0]; if (!l) continue;
    try {
      const qty = Number(l.quantity);
      const line = `${l.registration || l.flight_name} - ${qty !== 1 ? qty + " x " : ""}${l.service_name}`;
      const props = {
        Line: { title: rich(line) },
        Quantity: { number: qty },
        By: { rich_text: rich(l.logged_by_name || "Portal") },
        "Logged at": { date: { start: new Date(l.logged_at).toISOString() } },
        Source: { select: { name: "Portal" } },
        Station: { select: { name: l.station } },
        Service: { relation: [{ id: l.service_notion }] }
      };
      props[l.station + " Flight"] = { relation: [{ id: l.flight_notion }] };
      if (l.notes) props.Notes = { rich_text: rich(l.notes) };
      const page = await notion("/pages", "POST", { parent: { type: "data_source_id", data_source_id: SERVICES_LOG }, properties: props });
      await db().query("update public.service_logs set status = 'sent', notion_page_id = $2, error = null where id = $1", [id, page.id]);
      out.push({ kind: "log", id, status: "sent" });
    } catch (err) {
      await db().query("update public.service_logs set status = 'failed', error = $2 where id = $1", [id, msg(err)]);
      out.push({ kind: "log", id, status: "failed", error: msg(err) });
    }
  }
  // entries taken back: move their Services Log line to the Notion trash
  const rem = await db().query("select id, notion_page_id from public.service_logs where status = 'remove' order by id limit 40");
  for (const r of rem.rows) {
    try {
      if (r.notion_page_id) await notion(`/pages/${r.notion_page_id}`, "PATCH", { in_trash: true });
      await db().query("update public.service_logs set status = 'removed', error = null where id = $1", [r.id]);
      out.push({ kind: "remove", id: r.id, status: "removed" });
    } catch (err) {
      await db().query("update public.service_logs set error = $2 where id = $1", [r.id, msg(err)]);
      out.push({ kind: "remove", id: r.id, status: "failed", error: msg(err) });
    }
  }
  return out;
}
async function pushCompletions() {
  const out = [];
  const claim = await db().query(
    `update public.flight_completions set status = 'sending' where id in (select id from public.flight_completions where status = 'pending' order by id limit 20)
     returning id, flight_id, done_by_name, done_at`);
  for (const c of claim.rows) {
    try {
      const f = (await db().query("select notion_id from public.flights where id = $1", [c.flight_id])).rows[0];
      const checked = `${String(c.done_by_name || "Portal").split(/\s+/)[0]} · ${stamp(c.done_at)}`;
      await notion(`/pages/${f.notion_id}`, "PATCH", { properties: { "Services complete": { checkbox: true }, "Services checked": { rich_text: rich(checked) } } });
      await db().query("update public.flight_completions set status = 'sent', error = null where id = $1", [c.id]);
      await db().query("update public.flights set services_complete = true, services_checked = $2 where id = $1", [c.flight_id, checked]);
      out.push({ kind: "complete", id: c.id, status: "sent" });
    } catch (err) {
      await db().query("update public.flight_completions set status = 'failed', error = $2 where id = $1", [c.id, msg(err)]);
      out.push({ kind: "complete", id: c.id, status: "failed", error: msg(err) });
    }
  }
  return out;
}

// ----------------------------------------------------------------------
const isoDay = (d) => d.toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); };

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== "Bearer " + secret) return send(res, 401, { error: "Not allowed" });
      const services = await syncServices();
      const flights = await syncFlights(plusDays(-3), plusDays(3));
      const results = (await pushLogs()).concat(await pushCompletions());
      return send(res, 200, { services, flights, results });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (body.kind === "push") return send(res, 200, { results: (await pushLogs()).concat(await pushCompletions()) });
      if (body.kind === "refresh") {
        const last = await db().query("select max(synced_at) as t from public.flights");
        if (last.rows[0].t && Date.now() - new Date(last.rows[0].t).getTime() < 60000) return send(res, 200, { flights: 0, note: "Refreshed less than a minute ago" });
        const services = await syncServices();
        return send(res, 200, { services, flights: await syncFlights(plusDays(-1), plusDays(1)) });
      }
      if (body.kind === "import") {
        const from = String(body.from || ""), to = String(body.to || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from < "2026-10-01" || to < from) return send(res, 400, { error: "Choose dates from 1 October 2026 onwards" });
        if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) return send(res, 400, { error: "At most 62 days at a time" });
        await syncServices();
        return send(res, 200, { flights: await syncFlights(from, to) });
      }
      return send(res, 400, { error: "Unknown request" });
    }
    return send(res, 405, { error: "Use GET or POST" });
  } catch (err) {
    return send(res, 500, { error: msg(err) });
  }
};

function msg(err) { return String(err && err.message ? err.message : err).slice(0, 500); }
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
// for tests
module.exports.registration = registration;
