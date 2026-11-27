/* Iceland Aero Agents – Staff Portal
   Management → Backups (#/backups): the weekly Notion backup to Google Drive.
   Shows whether it is set up (with a step-by-step guide if not), lets
   management check what is included or back up now, and lists every run.
   The work is done by api/notion-backup.js. Needs database update 48. */
(function () {
  "use strict";

  const STATUS = {
    queued: ["Waiting to start", "chip-leave-pending"],
    running: ["Running", "chip-leave-pending"],
    done: ["Done", "chip-leave-approved"],
    done_with_problems: ["Done – with problems", "chip-leave-declined"],
    failed: ["Failed", "chip-leave-declined"]
  };
  let poll = null;
  const when = (ts) => ts ? new Date(ts).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Atlantic/Reykjavik" }) : "–";
  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;
  const kick = () => fetch("/api/notion-backup", { method: "POST" }).then((r) => r.json()).catch(() => ({}));

  async function render(main, ctx) {
    const { h, fill, pageHead, db, setStatus } = ctx;
    const redraw = () => render(main, ctx);
    if (poll) { clearTimeout(poll); poll = null; }
    fill(main, pageHead("Backups"), h("p", { class: "empty" }, "Loading…"));
    const [cfg, rr] = await Promise.all([
      fetch("/api/notion-backup?status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      db.from("backup_runs").select("*").order("created_at", { ascending: false }).limit(30)
    ]);
    if (rr.error) { fill(main, pageHead("Backups"), h("p", { class: "notice is-error" }, "Backups aren’t set up yet (database update 48).")); return; }
    const runs = rr.data || [];
    const active = runs.find((r) => r.status === "queued" || r.status === "running");
    const ready = cfg && cfg.notion && cfg.google && cfg.folder;
    const status = h("p", { class: "status", role: "status" });

    async function start(kind) {
      const r = await db.rpc("queue_backup", { p_kind: kind });
      if (r.error) { setStatus(status, r.error.message, true); return; }
      setStatus(status, kind === "check" ? "Checking what the Notion connection can see…" : "Backup started. It carries on in the background – you can leave this page.");
      kick().then(redraw);
      setTimeout(redraw, 1500);
    }

    // ---- setup ----
    const step = (done, text) => h("li", { class: done ? "is-done" : "" }, done ? "✓ " : "", text);
    const setup = h("section", { class: "panel" + (ready ? "" : " panel-attention"), "aria-labelledby": "bk-setup" },
      h("h2", { id: "bk-setup" }, ready ? "Set up ✓" : "Setting up"),
      ready
        ? h("p", null, `Every Sunday from 02:00 Notion is copied to your Google Shared drive (as ${cfg.service_account}), using the Notion connection “${cfg.connection || "?"}”. The 12 newest backups are kept.`)
        : h("div", null,
            h("p", null, "A one-time setup in Google, then three settings in Vercel. Until then you can still use “Check what’s included”."),
            h("ol", { class: "bk-steps" },
              step(cfg && cfg.own_token, h("span", null, "A read-only Notion connection: in Notion, Settings → Connections → Develop or manage integrations → New integration “IAA Notion Backup” (Internal, capability ", h("b", null, "Read content"), " only). Copy its secret and add it in Vercel as ", h("code", null, "NOTION_BACKUP_TOKEN"), ". Then add the connection (••• → Connections) to the databases and the top page of each section to back up.",
                cfg && cfg.notion && !cfg.own_token ? " (Until then the portal’s own connection" + (cfg.connection ? " “" + cfg.connection + "”" : "") + " is used.)" : "")),
              step(cfg && cfg.google, h("span", null, "Google service account: in ", h("b", null, "console.cloud.google.com"), " create a project (e.g. “IAA Portal”), turn on the ", h("b", null, "Google Drive API"), ", then IAM & Admin → Service accounts → Create (e.g. “notion-backup”) → Keys → Add key → JSON. In Vercel add ", h("code", null, "GOOGLE_SERVICE_ACCOUNT_JSON"), " and paste the whole downloaded file as its value.")),
              step(cfg && cfg.folder, h("span", null, "Shared drive: in Google Drive create a Shared drive “IAA Notion backups”, add only management, and add the service account’s email as ", h("b", null, "Content manager"), ". Open it and copy the ID from the address (after /folders/). In Vercel add ", h("code", null, "GOOGLE_DRIVE_FOLDER_ID"), " with that ID.")),
              h("li", null, "Redeploy in Vercel, come back here and press “Back up now” to try it.")),
            cfg && cfg.service_account ? h("p", { class: "fineprint" }, "Service account: ", h("code", null, cfg.service_account)) : null),
      h("p", { class: "fineprint" }, `Only pages and databases shared with the Notion connection “${(cfg && cfg.connection) || "IAA Notion Backup"}” are included (••• → Connections on each page – sub-pages come with it). The backup holds personal data, so keep the Shared drive to management only.`));

    // ---- actions ----
    const chk = h("button", { class: "btn btn-quiet", type: "button", disabled: !!active || null }, "Check what’s included");
    const go = h("button", { class: "btn", type: "button", disabled: !!active || !ready || null }, "Back up now");
    chk.addEventListener("click", () => { chk.disabled = go.disabled = true; start("check"); });
    go.addEventListener("click", () => { chk.disabled = go.disabled = true; start("backup"); });

    // ---- what's included (latest check or backup) ----
    const latest = runs.find((r) => r.found);
    const found = latest ? h("details", { class: "panel", open: latest.kind === "check" || null },
      h("summary", null, `What’s included (${many((latest.found.databases || []).length, "database", "databases")}, ${many((latest.found.pages || []).length, "page", "pages")} – as of ${when(latest.started_at)})`),
      h("div", { class: "bk-found" },
        h("div", null, h("h3", null, "Databases"), h("ul", null, (latest.found.databases || []).map((d) => h("li", null, d.title)))),
        h("div", null, h("h3", null, "Pages"), (latest.found.pages || []).length ? h("ul", null, latest.found.pages.map((p) => h("li", null, p.title))) : h("p", { class: "empty" }, "None"))),
      h("p", { class: "fineprint" }, `Missing something? In Notion, open it, then ••• → Connections → add “${(cfg && cfg.connection) || "IAA Notion Backup"}”. Sub-pages are included with their page.`)) : null;

    // ---- history ----
    const hist = h("section", { class: "panel", "aria-labelledby": "bk-hist" },
      h("h2", { id: "bk-hist" }, "History"),
      runs.length ? h("div", { class: "table-wrap" }, h("table", { class: "mgmt-table" },
        h("thead", null, h("tr", null, ["Started", "What", "Status", "Copied", "Folder"].map((x) => h("th", null, x)))),
        h("tbody", null, runs.map((r) => {
          const c = r.counts || {};
          const copied = r.kind === "check" ? `${many(c.databases || 0, "database", "databases")}, ${many(c.pages || 0, "page", "pages")} found`
            : [c.databases != null ? `${c.databases} databases` : null, c.rows != null ? `${c.rows} rows` : null, c.page_texts != null ? `${c.page_texts} page texts` : null, c.files != null ? `${c.files} files` : null].filter(Boolean).join(", ") || "–";
          const probs = (r.problems || []).length || r.error
            ? h("details", null, h("summary", null, r.error ? "What went wrong" : `${r.problems.length} ${r.problems.length === 1 ? "problem" : "problems"}`),
                h("ul", null, (r.error ? [r.error] : r.problems).map((p) => h("li", null, p)))) : null;
          return h("tr", null,
            h("td", null, when(r.started_at || r.created_at)),
            h("td", null, r.kind === "check" ? "Check" : "Backup", h("div", { class: "fineprint" }, r.requested_by_name || "")),
            h("td", null, h("span", { class: "chip " + (STATUS[r.status] || ["", ""])[1] }, (STATUS[r.status] || [r.status])[0]), probs),
            h("td", null, copied),
            h("td", null, r.drive_folder_url ? h("a", { href: r.drive_folder_url, target: "_blank", rel: "noopener" }, "Open in Drive") : "–"));
        })))) : h("p", { class: "empty" }, "No backups yet."));

    fill(main, pageHead("Backups", "A weekly copy of Notion in your Google Drive."),
      active ? h("p", { class: "notice" }, active.kind === "check" ? "Checking what’s included…" : `A backup is running (started ${when(active.started_at || active.created_at)}). It carries on in the background, in steps of a few minutes.`) : null,
      setup, h("div", { class: "row" }, chk, go), status, found, hist);

    // While something runs: keep it moving and refresh the page.
    if (active) poll = setTimeout(async () => { if (!document.body.contains(main.firstChild)) return; await kick(); if (location.hash.startsWith("#/backups")) redraw(); }, 8000);
  }

  window.IAABackups = { render };
})();
