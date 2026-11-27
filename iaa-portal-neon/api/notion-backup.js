/* Iceland Aero Agents – Staff Portal
   /api/notion-backup – weekly backup of Notion to a Google Shared drive.

   Runs every 10 minutes (vercel.json). Most runs do nothing. On Sunday from
   02:00 (Iceland time) it starts a backup, and it also picks up a backup or a
   check that management started on the Backups page. A backup is done in
   pieces of about 3 minutes until everything is copied:
     Databases/      each database as CSV (spreadsheet) and JSON (complete)
     Page contents/  the text inside each database page, as Markdown
     Pages/          standalone pages (e.g. the SOP manual), as Markdown
     Files/          attached files (gendecs, handling requests …)
   into "Notion backup YYYY-MM-DD", keeping the 12 newest backups.

   Covers everything shared with its Notion connection – best a read-only
   connection "IAA Notion Backup" (Notion: Settings → Connections → Develop
   or manage integrations; capability "Read content" only).
   Settings in Vercel:
     NOTION_BACKUP_TOKEN          that connection's secret (if not set, the
                                  portal's NOTION_TOKEN is used)
     GOOGLE_SERVICE_ACCOUNT_JSON  the service account key (the whole JSON file)
     GOOGLE_DRIVE_FOLDER_ID       the Shared drive (or a folder in it) to use
     DATABASE_URL, CRON_SECRET, SMTP_* (already set)
   Needs database update 48. */
const { Pool } = require("pg");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const NOTION = "https://api.notion.com/v1", NOTION_VERSION = "2025-09-03";
const DRIVE = "https://www.googleapis.com/drive/v3", UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const KEEP = 12;                                              // weekly backups kept
const BUDGET_MS = Number(process.env.BACKUP_BUDGET_MS || 200000); // work per call (the function may run 300 s)
const ROWS_PER_PART = 40, FILES_PER_TASK = 25;
const TZ = "Atlantic/Reykjavik";

// ----------------------------------------------------------------------
// Database
// ----------------------------------------------------------------------
let pool = null;
function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, max: 3, ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false } });
  }
  return pool;
}
const q = (sql, args) => db().query(sql, args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------------
// Notion
// ----------------------------------------------------------------------
const notionToken = () => process.env.NOTION_BACKUP_TOKEN || process.env.NOTION_TOKEN;
async function notion(path, method, body) {
  const token = notionToken();
  if (!token) throw new Error("No Notion token – set NOTION_BACKUP_TOKEN in Vercel");
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(NOTION + path, {
      method: method || "GET",
      headers: { Authorization: "Bearer " + token, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 429 || r.status >= 500) { await sleep(Math.min(10, Number(r.headers.get("retry-after")) || 1 + attempt * 2) * 1000); continue; }
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Notion ${r.status}: ${json.message || r.statusText}`);
    return json;
  }
  throw new Error("Notion is busy – will try again on the next run");
}
async function searchAll() {
  const out = []; let cursor;
  for (let i = 0; i < 100; i++) {
    const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor;
    const r = await notion("/search", "POST", body);
    out.push(...(r.results || []));
    if (!r.has_more) break; cursor = r.next_cursor;
  }
  return out;
}
async function queryAll(ds) {
  const out = []; let cursor;
  for (let i = 0; i < 300; i++) {
    const body = { page_size: 100 }; if (cursor) body.start_cursor = cursor;
    const r = await notion(`/data_sources/${ds}/query`, "POST", body);
    out.push(...(r.results || []));
    if (!r.has_more) break; cursor = r.next_cursor;
  }
  return out;
}
async function childrenOf(id) {
  const out = []; let cursor;
  for (let i = 0; i < 50; i++) {
    const r = await notion(`/blocks/${id}/children?page_size=100${cursor ? "&start_cursor=" + cursor : ""}`);
    out.push(...(r.results || []));
    if (!r.has_more) break; cursor = r.next_cursor;
  }
  return out;
}
const plain = (rt) => (rt || []).map((t) => t.plain_text || "").join("");
function titleOf(obj) {
  if (!obj) return "Untitled";
  if (Array.isArray(obj.title)) return plain(obj.title).trim() || "Untitled";            // data source / database
  const props = obj.properties || {};
  for (const k of Object.keys(props)) if (props[k] && props[k].type === "title") return plain(props[k].title).trim() || "Untitled";
  return "Untitled";
}

// A property value as text, for the spreadsheet.
function propText(p) {
  if (!p) return "";
  switch (p.type) {
    case "title": return plain(p.title);
    case "rich_text": return plain(p.rich_text);
    case "number": return p.number == null ? "" : String(p.number);
    case "select": return p.select ? p.select.name : "";
    case "status": return p.status ? p.status.name : "";
    case "multi_select": return (p.multi_select || []).map((x) => x.name).join("; ");
    case "date": return p.date ? p.date.start + (p.date.end ? " → " + p.date.end : "") : "";
    case "people": return (p.people || []).map((x) => x.name || x.id).join("; ");
    case "files": return (p.files || []).map((f) => f.name).join("; ");
    case "checkbox": return p.checkbox ? "Yes" : "No";
    case "url": return p.url || "";
    case "email": return p.email || "";
    case "phone_number": return p.phone_number || "";
    case "formula": { const f = p.formula || {}; return f.type === "date" ? (f.date ? f.date.start : "") : String(f[f.type] == null ? "" : f[f.type]); }
    case "relation": return (p.relation || []).map((x) => x.id).join("; ");
    case "rollup": {
      const r = p.rollup || {};
      if (r.type === "array") return (r.array || []).map(propText).join("; ");
      if (r.type === "date") return r.date ? r.date.start : "";
      return String(r[r.type] == null ? "" : r[r.type]);
    }
    case "created_time": return p.created_time || "";
    case "last_edited_time": return p.last_edited_time || "";
    case "created_by": return p.created_by ? (p.created_by.name || p.created_by.id) : "";
    case "last_edited_by": return p.last_edited_by ? (p.last_edited_by.name || p.last_edited_by.id) : "";
    case "unique_id": return p.unique_id ? (p.unique_id.prefix ? p.unique_id.prefix + "-" : "") + p.unique_id.number : "";
    case "verification": return p.verification ? p.verification.state || "" : "";
    case "place": return p.place ? (p.place.name || p.place.address || "") : "";
    default: return "";
  }
}
const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// Rich text → Markdown
function md(rt) {
  return (rt || []).map((t) => {
    let s = t.plain_text || "";
    if (!s) return "";
    const a = t.annotations || {};
    if (a.code) s = "`" + s + "`";
    if (a.bold) s = "**" + s + "**";
    if (a.italic) s = "_" + s + "_";
    if (a.strikethrough) s = "~~" + s + "~~";
    const href = t.href || (t.text && t.text.link && t.text.link.url);
    if (href) s = `[${s}](${href})`;
    return s;
  }).join("");
}

// ----------------------------------------------------------------------
// Google Drive (service account in a Shared drive)
// ----------------------------------------------------------------------
let gtok = null;
function serviceAccount() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw) return null;
  if (!raw.trim().startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(raw);
}
async function googleToken() {
  if (gtok && gtok.exp > Date.now() + 60000) return gtok.token;
  const sa = serviceAccount();
  if (!sa) throw new Error("Google Drive isn’t connected yet – GOOGLE_SERVICE_ACCOUNT_JSON is not set in Vercel");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive", aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + sig
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Google sign-in failed: " + (j.error_description || j.error || r.status) + " – check GOOGLE_SERVICE_ACCOUNT_JSON");
  gtok = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return gtok.token;
}
async function gfetch(url, opts) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const o = Object.assign({}, opts || {});
    o.headers = Object.assign({ Authorization: "Bearer " + await googleToken() }, o.headers || {});
    const r = await fetch(url, o);
    if (r.status === 429 || r.status >= 500) { await sleep((1 + attempt * 2) * 1000); continue; }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const m = (j.error && j.error.message) || r.statusText;
      const hint = /storage quota/i.test(m) ? " – the folder must be in a Shared drive, with the service account as a member" :
        r.status === 404 ? " – check GOOGLE_DRIVE_FOLDER_ID and that the service account is a member of the Shared drive" : "";
      throw new Error(`Google Drive ${r.status}: ${m}${hint}`);
    }
    return r;
  }
  throw new Error("Google Drive is busy – will try again on the next run");
}
const safeName = (s) => String(s || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
async function makeFolder(name, parent) {
  const r = await gfetch(`${DRIVE}/files?supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: safeName(name), mimeType: "application/vnd.google-apps.folder", parents: [parent] })
  });
  return (await r.json()).id;
}
async function upload(name, parent, mime, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const meta = JSON.stringify({ name: safeName(name), parents: [parent] });
  if (buf.length < 4.5 * 1024 * 1024) {
    const boundary = "iaa" + crypto.randomBytes(8).toString("hex");
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      buf, Buffer.from(`\r\n--${boundary}--`)]);
    const r = await gfetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    return (await r.json()).id;
  }
  const start = await gfetch(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime }, body: meta });
  const loc = start.headers.get("location");
  const r = await gfetch(loc, { method: "PUT", headers: { "Content-Type": mime }, body: buf });
  return (await r.json()).id;
}
async function listFolders(parent) {
  const qs = encodeURIComponent(`'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const r = await gfetch(`${DRIVE}/files?q=${qs}&fields=files(id,name,createdTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return (await r.json()).files || [];
}
async function trash(id) {
  await gfetch(`${DRIVE}/files/${id}?supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
}
// A sub-folder of the run's folder ("Files/BIKF Aircraft Database"), created once and remembered.
async function folderFor(run, path) {
  if (run.folders[path]) return run.folders[path];
  const parts = path.split("/"); let parent = run.drive_folder_id, sofar = "";
  for (const p of parts) {
    sofar = sofar ? sofar + "/" + p : p;
    if (!run.folders[sofar]) {
      run.folders[sofar] = await makeFolder(p, parent);
      await q("update public.backup_runs set folders = $2 where id = $1", [run.id, JSON.stringify(run.folders)]);
    }
    parent = run.folders[sofar];
  }
  return parent;
}
async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "application/octet-stream" };
}

// ----------------------------------------------------------------------
// Page contents → Markdown (attached files are copied to Drive as they are met)
// ----------------------------------------------------------------------
async function pageMarkdown(run, pageId, filesPath, depth, budget) {
  const lines = [];
  const blocks = await childrenOf(pageId);
  let n = 0;
  for (const b of blocks) {
    if (budget.blocks-- <= 0) { lines.push("_(more content not copied – page too long)_"); break; }
    const t = b.type, v = b[t] || {};
    const pad = "  ".repeat(Math.max(0, depth));
    let line = "";
    switch (t) {
      case "paragraph": line = md(v.rich_text); break;
      case "heading_1": line = "## " + md(v.rich_text); break;
      case "heading_2": line = "### " + md(v.rich_text); break;
      case "heading_3": line = "#### " + md(v.rich_text); break;
      case "bulleted_list_item": line = pad + "- " + md(v.rich_text); break;
      case "numbered_list_item": line = pad + (++n) + ". " + md(v.rich_text); break;
      case "to_do": line = pad + (v.checked ? "- [x] " : "- [ ] ") + md(v.rich_text); break;
      case "toggle": line = pad + "▸ " + md(v.rich_text); break;
      case "quote": line = "> " + md(v.rich_text); break;
      case "callout": line = "> " + (v.icon && v.icon.emoji ? v.icon.emoji + " " : "") + md(v.rich_text); break;
      case "code": line = "```" + (v.language || "") + "\n" + plain(v.rich_text) + "\n```"; break;
      case "divider": line = "---"; break;
      case "equation": line = "$$" + (v.expression || "") + "$$"; break;
      case "bookmark": case "embed": case "link_preview": line = v.url ? `<${v.url}>` : ""; break;
      case "child_page": line = "\n## 📄 " + (v.title || "Untitled"); break;
      case "child_database": line = `_(Database “${v.title || "Untitled"}” – see the Databases folder)_`; break;
      case "table_row": line = "| " + (v.cells || []).map((c) => md(c).replace(/\|/g, "\\|")).join(" | ") + " |"; break;
      case "image": case "file": case "pdf": case "video": case "audio": {
        const name = v.name || (v.caption && plain(v.caption)) || t;
        if (v.type === "file" && v.file && v.file.url) {
          try {
            const d = await download(v.file.url);
            const fname = safeName((name.includes(".") ? name : name + "-" + b.id.slice(0, 8)));
            await upload(fname, await folderFor(run, filesPath), d.mime, d.buf);
            run.counts.files = (run.counts.files || 0) + 1;
            line = `📎 ${name} – saved in ${filesPath}`;
          } catch (e) { line = `📎 ${name} – could not copy (${e.message})`; }
        } else if (v.external && v.external.url) line = `📎 [${name}](${v.external.url})`;
        break;
      }
      default: line = "";
    }
    if (t !== "numbered_list_item") n = 0;
    if (line) lines.push(line);
    if (b.has_children && depth < 6 && t !== "child_database") {
      const inner = await pageMarkdown(run, b.id, filesPath, t === "child_page" ? 0 : depth + 1, budget);
      if (inner) lines.push(inner);
    }
  }
  return lines.join("\n\n").replace(/\n{3,}/g, "\n\n");
}

// ----------------------------------------------------------------------
// The work
// ----------------------------------------------------------------------
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
async function addTask(run, kind, title, target, info) {
  await q("insert into public.backup_tasks (run_id, kind, title, target, info) values ($1, $2, $3, $4, $5)", [run.id, kind, title, target, JSON.stringify(info || {})]);
}
async function saveRun(run, extra) {
  await q("update public.backup_runs set counts = $2, problems = $3 where id = $1", [run.id, JSON.stringify(run.counts), JSON.stringify(run.problems)]);
  if (extra) for (const k of Object.keys(extra)) await q(`update public.backup_runs set ${k} = $2 where id = $1`, [run.id, extra[k]]);
}

// What the connection can see: databases (data sources) and top-level pages.
async function discover() {
  const all = await searchAll();
  const sources = all.filter((o) => o.object === "data_source" || o.object === "database");
  const pages = all.filter((o) => o.object === "page" && !(o.parent && (o.parent.type === "data_source_id" || o.parent.type === "database_id")));
  const pageIds = new Set(pages.map((p) => p.id.replace(/-/g, "")));
  let top = pages.filter((p) => !(p.parent && p.parent.type === "page_id" && pageIds.has(String(p.parent.page_id).replace(/-/g, ""))));
  // A page inside a database row (e.g. a blank page inside a flight) is already backed up
  // with that row's page contents, so it is left out. Others get their parent's name.
  const parents = {};
  const keep = [], blank = [];
  for (const p of top) {
    if (p.parent && p.parent.type === "page_id") {
      const pid = p.parent.page_id;
      if (!(pid in parents)) {
        try {
          const parent = await notion(`/pages/${pid}`);
          parents[pid] = { inDatabase: !!(parent.parent && (parent.parent.type === "data_source_id" || parent.parent.type === "database_id")), title: titleOf(parent), url: parent.url || null };
        } catch (e) { parents[pid] = { inDatabase: false, title: "" }; }
      }
      if (parents[pid].inDatabase) {
        // listed on the Backups page so they can be tidied up in Notion
        if (titleOf(p) === "Untitled") blank.push({ id: p.id, url: p.url || null, inside: parents[pid].title, inside_url: parents[pid].url, created: p.created_time || null, edited: p.last_edited_time || null });
        continue;
      }
      p._parentTitle = parents[pid].title;
    }
    keep.push(p);
  }
  top = keep;
  const pageTitle = (p) => {
    const t = titleOf(p);
    return t !== "Untitled" ? t : "Untitled" + (p._parentTitle ? " – inside " + p._parentTitle : "") + " (" + p.id.replace(/-/g, "").slice(0, 8) + ")";
  };
  return {
    databases: sources.map((s) => ({ id: s.id, title: titleOf(s), url: s.url || null })).sort((a, b) => a.title.localeCompare(b.title)),
    pages: top.map((p) => ({ id: p.id, title: pageTitle(p), url: p.url || null })).sort((a, b) => a.title.localeCompare(b.title)),
    blank: blank.sort((a, b) => String(a.created).localeCompare(String(b.created)))
  };
}

async function startRun(run) {
  await q("update public.backup_runs set status = 'running', started_at = now() where id = $1", [run.id]);
  const found = await discover();
  await q("update public.backup_runs set found = $2 where id = $1", [run.id, JSON.stringify(found)]);
  run.counts = { databases: found.databases.length, pages: found.pages.length };
  if (run.kind === "check") {
    await q("update public.backup_runs set status = 'done', finished_at = now(), counts = $2 where id = $1", [run.id, JSON.stringify(run.counts)]);
    return false;
  }
  const parent = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!parent) throw new Error("Google Drive isn’t connected yet – GOOGLE_DRIVE_FOLDER_ID is not set in Vercel");
  const existing = (await listFolders(parent)).filter((f) => f.name.startsWith("Notion backup " + today()));
  const name = "Notion backup " + today() + (existing.length ? ` (${existing.length + 1})` : "");
  run.drive_folder_id = await makeFolder(name, parent);
  run.folders = {};
  await q("update public.backup_runs set drive_folder_id = $2, drive_folder_url = $3, folders = '{}'::jsonb where id = $1",
    [run.id, run.drive_folder_id, "https://drive.google.com/drive/folders/" + run.drive_folder_id]);
  for (const d of found.databases) await addTask(run, "database", d.title, d.id);
  for (const p of found.pages) await addTask(run, "page", p.title, p.id);
  await addTask(run, "cleanup", "Remove backups older than " + KEEP + " weeks", parent);
  // A list of what was found, saved with the backup.
  const list = ["# What this backup contains", "", `Made ${new Date().toISOString()} by the IAA Staff Portal.`, "", "## Databases", ...found.databases.map((d) => "- " + d.title), "", "## Pages", ...found.pages.map((p) => "- " + p.title)].join("\n");
  await upload("README – contents.md", run.drive_folder_id, "text/markdown", list);
  await saveRun(run);
  return true;
}

async function doTask(run, t) {
  if (t.kind === "database") {
    const rows = await queryAll(t.target);
    const names = new Set();
    rows.forEach((r) => Object.keys(r.properties || {}).forEach((k) => names.add(k)));
    const first = rows[0] ? Object.keys(rows[0].properties).find((k) => rows[0].properties[k].type === "title") : null;
    const cols = Array.from(names).sort((a, b) => (a === first ? -1 : b === first ? 1 : a.localeCompare(b)));
    const csv = ["\ufeff" + ["Notion page ID", "Created", "Last edited", ...cols].map(csvCell).join(",")]
      .concat(rows.map((r) => [r.id, r.created_time, r.last_edited_time, ...cols.map((c) => propText((r.properties || {})[c]))].map(csvCell).join(",")));
    const dir = await folderFor(run, "Databases");
    await upload(t.title + ".csv", dir, "text/csv", csv.join("\r\n"));
    await upload(t.title + ".json", dir, "application/json", JSON.stringify({ data_source_id: t.target, title: t.title, exported_at: new Date().toISOString(), rows }, null, 1));
    run.counts.rows = (run.counts.rows || 0) + rows.length;
    // the text inside each row's page, in parts
    for (let i = 0, part = 1; i < rows.length; i += ROWS_PER_PART, part++) {
      await addTask(run, "rows", `${t.title} – part ${part}`, t.target, { db: t.title, part, rows: rows.slice(i, i + ROWS_PER_PART).map((r) => ({ id: r.id, title: titleOf(r) })) });
    }
    // attached files (their links expire, so they are fetched again when copied)
    const withFiles = rows.filter((r) => Object.values(r.properties || {}).some((p) => p.type === "files" && (p.files || []).length));
    for (let i = 0; i < withFiles.length; i += FILES_PER_TASK) {
      await addTask(run, "files", `${t.title} – files ${i / FILES_PER_TASK + 1}`, t.target, { db: t.title, rows: withFiles.slice(i, i + FILES_PER_TASK).map((r) => ({ id: r.id, title: titleOf(r) })) });
    }
    return;
  }
  if (t.kind === "rows") {
    const out = [`# ${t.info.db} – page contents, part ${t.info.part}`, ""];
    for (const r of t.info.rows) {
      const text = await pageMarkdown(run, r.id, "Files/" + safeName(t.info.db), 0, { blocks: 600 });
      out.push(`## ${r.title}`, `_Notion page ${r.id}_`, "", text || "_(no text on this page)_", "", "---", "");
    }
    await upload(`${t.info.db} – part ${t.info.part}.md`, await folderFor(run, "Page contents"), "text/markdown", out.join("\n"));
    run.counts.page_texts = (run.counts.page_texts || 0) + t.info.rows.length;
    return;
  }
  if (t.kind === "page") {
    const text = await pageMarkdown(run, t.target, "Files/" + safeName(t.title), 0, { blocks: 4000 });
    await upload(t.title + ".md", await folderFor(run, "Pages"), "text/markdown", `# ${t.title}\n\n${text}\n`);
    run.counts.page_texts = (run.counts.page_texts || 0) + 1;
    return;
  }
  if (t.kind === "files") {
    const dirPath = "Files/" + safeName(t.info.db);
    for (const r of t.info.rows) {
      const page = await notion(`/pages/${r.id}`);
      for (const [pname, p] of Object.entries(page.properties || {})) {
        if (p.type !== "files") continue;
        for (const f of p.files || []) {
          if (f.type !== "file" || !f.file || !f.file.url) continue;
          try {
            const d = await download(f.file.url);
            await upload(`${r.title} – ${pname} – ${f.name}`, await folderFor(run, dirPath), d.mime, d.buf);
            run.counts.files = (run.counts.files || 0) + 1;
          } catch (e) { run.problems.push(`File “${f.name}” on ${r.title}: ${e.message}`); }
        }
      }
    }
    return;
  }
  if (t.kind === "cleanup") {
    const backups = (await listFolders(t.target)).filter((f) => /^Notion backup \d{4}-\d{2}-\d{2}/.test(f.name) && f.id !== run.drive_folder_id)
      .sort((a, b) => (b.createdTime || b.name).localeCompare(a.createdTime || a.name));
    const old = backups.slice(KEEP - 1);                        // this run + the 11 before it
    for (const f of old) await trash(f.id);
    run.counts.removed_old = old.length;
  }
}

async function finish(run) {
  const failed = (await q("select title, error from public.backup_tasks where run_id = $1 and status = 'failed'", [run.id])).rows;
  failed.forEach((f) => run.problems.push(`${f.title}: ${f.error}`));
  const status = run.problems.length ? "done_with_problems" : "done";
  await q("update public.backup_runs set status = $2, finished_at = now(), counts = $3, problems = $4 where id = $1",
    [run.id, status, JSON.stringify(run.counts), JSON.stringify(run.problems)]);
  if (status !== "done") await tellManagement(run, `The Notion backup finished with ${run.problems.length} ${run.problems.length === 1 ? "problem" : "problems"}`, run.problems.slice(0, 20));
}

async function tellManagement(run, subject, lines) {
  try {
    if (!process.env.SMTP_HOST) return;
    const to = (await q("select email from public.profiles where role = 'management' and active")).rows.map((r) => r.email);
    if (!to.length) return;
    const port = parseInt(process.env.SMTP_PORT || "465", 10);
    const mail = process.env.SMTP_HOST === "json" ? nodemailer.createTransport({ jsonTransport: true }) :
      nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await mail.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "IAA Staff Portal <no-reply@iaa.is>", bcc: to.join(", "),
      subject: "IAA Staff Portal: " + subject,
      text: subject + ".\n\n" + lines.map((l) => "• " + l).join("\n") + "\n\nSee Backups in the staff portal." + (run.drive_folder_url ? "\nBackup folder: " + run.drive_folder_url : "")
    });
  } catch (e) { console.error("backup email:", e.message); }
}

// Every Sunday from 02:00 Iceland time, if no backup has started in the last 6 days.
async function scheduleWeekly() {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  if (local.getDay() !== 0 || local.getHours() < 2) return;
  const recent = await q("select 1 from public.backup_runs where kind = 'backup' and created_at > now() - interval '6 days' limit 1");
  if (recent.rows.length) return;
  await q("insert into public.backup_runs (kind, requested_by_name) values ('backup', 'Weekly schedule') on conflict do nothing");
}

async function tick() {
  const t0 = Date.now();
  const client = await db().connect();
  let locked = false;
  try {
    locked = (await client.query("select pg_try_advisory_lock(48480001) as ok")).rows[0].ok;
    if (!locked) return { busy: true };
    await scheduleWeekly();
    const r = (await q("select * from public.backup_runs where status in ('queued', 'running') order by id limit 1")).rows[0];
    if (!r) return { idle: true };
    const run = Object.assign(r, { counts: r.counts || {}, problems: r.problems || [], folders: r.folders || {} });
    try {
      if (run.status === "queued") { const more = await startRun(run); if (!more) return { done: run.id, kind: "check" }; }
    } catch (e) {
      await q("update public.backup_runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [run.id, e.message]);
      await tellManagement(run, "The Notion backup could not start", [e.message]);
      return { failed: run.id, error: e.message };
    }
    let did = 0;
    while (Date.now() - t0 < BUDGET_MS) {
      const t = (await q(`select * from public.backup_tasks where run_id = $1 and status = 'todo'
                          order by (kind = 'cleanup'), id limit 1`, [run.id])).rows[0];
      if (!t) { await finish(run); return { done: run.id, tasks: did, counts: run.counts }; }
      try {
        await doTask(run, t);
        await q("update public.backup_tasks set status = 'done', done_at = now() where id = $1", [t.id]);
      } catch (e) {
        await q("update public.backup_tasks set status = 'failed', error = $2, done_at = now() where id = $1", [t.id, String(e.message).slice(0, 500)]);
      }
      did++;
      await saveRun(run);
    }
    return { running: run.id, tasks: did, counts: run.counts };
  } finally {
    if (locked) await client.query("select pg_advisory_unlock(48480001)").catch(() => {});
    client.release();
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url || "/", "http://x");
    // The Backups page: is everything set up?
    if (req.method === "GET" && url.searchParams.has("status")) {
      let sa = null; try { sa = serviceAccount(); } catch (e) { sa = null; }
      let connection = null;
      if (notionToken()) { try { const me = await notion("/users/me"); connection = me.name || null; } catch (e) { connection = null; } }
      return send(res, 200, { notion: !!notionToken(), own_token: !!process.env.NOTION_BACKUP_TOKEN, connection, google: !!(sa && sa.client_email && sa.private_key), folder: !!process.env.GOOGLE_DRIVE_FOLDER_ID, service_account: sa ? sa.client_email : null });
    }
    // The schedule (GET with CRON_SECRET) or the Backups page asking it to carry on (POST).
    // Both only work through backups that are already queued, so no sign-in is needed for POST.
    if (req.method === "GET") {
      if (process.env.CRON_SECRET && req.headers.authorization !== "Bearer " + process.env.CRON_SECRET) return send(res, 401, { error: "Not allowed" });
    } else if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST" });
    return send(res, 200, await tick());
  } catch (e) {
    console.error("notion-backup:", e);
    return send(res, 500, { error: e.message });
  }
};
module.exports.propText = propText;
module.exports.md = md;
