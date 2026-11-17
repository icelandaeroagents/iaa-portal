/* Iceland Aero Agents – Staff Portal
   What one person has outstanding: training, policies, passes and
   certificates, practical sign-offs. Shared by the management reminder
   preview (browser) and the reminder email (server, api/staff-notify.js),
   so the preview always matches what is sent. */
(function (root) {
  "use strict";

  const PASS_LABELS = {
    airport_pass: "Airport pass", airport_awareness: "Airport airside safety and security course", airside_driving: "Airside driving permit",
    deicing: "De-icing certificate", first_aid: "First aid", dangerous_goods: "Dangerous goods training", security: "Aviation security training",
    escort: "Escort training", inflight_supplies: "In-flight supplies procedures", data_protection: "Data protection training",
    operator_training: "Customer operator training", sms_course: "SMS course", internal_auditor: "Internal auditor course",
    security_management: "Security management course", driving_licence: "Driving licence", other: "Certificate"
  };
  const PRACTICAL_MONTHS = 12;
  const SOON_DAYS = 30;

  function iso(v) { return v instanceof Date ? v.toISOString() : String(v); }
  function day(v) { return iso(v).slice(0, 10); }
  function addDays(isoDay, n) { const d = new Date(isoDay + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function addMonths(isoDay, m) {
    const d = new Date(isoDay + "T12:00:00Z"); const dd = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dd, last)); return d.toISOString().slice(0, 10);
  }
  function fmt(isoDay) {
    return new Date(isoDay + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }

  // input: { T, stations, attempts, certs, policies, reads, credentials, practical, today }
  //   attempts:    passed quiz attempts   { module, attempted_at }
  //   certs:       sign-offs (not revoked) { module, passed_at, signed_at }
  //   policies:    { id, title, version, requires_ack }
  //   reads:       { document_id, version }
  //   credentials: { kind, label, expires_on }
  //   practical:   { skill, assessed_on, result }
  function compute(input) {
    const T = input.T, today = input.today || new Date().toISOString().slice(0, 10);
    const soon = addDays(today, SOON_DAYS);
    const codes = input.stations || [];
    const out = { training: [], policies: [], passes: [], practical: [] };

    // Training: same rule as the portal and the renewal emails –
    // the latest completion decides when the module is next due.
    (T.modules || []).forEach(function (m) {
      if (m.stations && !m.stations.some(function (c) { return codes.indexOf(c) !== -1; })) return;
      const passes = (input.attempts || []).filter(function (a) { return a.module === m.id; }).map(function (a) { return iso(a.attempted_at); }).sort();
      const cs = (input.certs || []).filter(function (c) { return c.module === m.id; })
        .sort(function (x, y) { return iso(x.signed_at || x.passed_at).localeCompare(iso(y.signed_at || y.passed_at)); });
      const lastPass = passes.length ? passes[passes.length - 1] : null;
      const lastCert = cs.length ? cs[cs.length - 1] : null;
      const certTime = lastCert ? iso(lastCert.signed_at || lastCert.passed_at) : "";
      const completed = lastPass && (!lastCert || lastPass > certTime) ? lastPass : lastCert ? iso(lastCert.passed_at) : lastPass;
      const name = m.code + " " + m.title;
      if (!completed) { out.training.push([name, "Not started"]); return; }
      const due = T.dueDate ? T.dueDate(completed, m) : null;
      if (!due) return;
      if (due < today) out.training.push([name, "Overdue since " + fmt(due)]);
      else if (due <= soon) out.training.push([name, "Due " + fmt(due)]);
    });

    // Policies not yet confirmed in their current version.
    (input.policies || []).forEach(function (p) {
      if (p.requires_ack === false) return;
      const mine = (input.reads || []).filter(function (r) { return String(r.document_id) === String(p.id); });
      const current = mine.some(function (r) { return Number(r.version) === Number(p.version); });
      if (!current) out.policies.push([p.title, mine.length ? "Updated – please read and confirm again" : "Please read and confirm"]);
    });

    // Passes and certificates expired or expiring within 30 days.
    (input.credentials || []).forEach(function (c) {
      if (!c.expires_on) return;
      const exp = day(c.expires_on);
      const name = c.label || PASS_LABELS[c.kind] || "Certificate";
      if (exp < today) out.passes.push([name, "Expired " + fmt(exp) + " – renew it and update the portal"]);
      else if (exp <= soon) out.passes.push([name, "Expires " + fmt(exp)]);
    });

    // Practical sign-offs: the latest competent assessment of each skill, renewed every 12 months.
    const latest = {};
    (input.practical || []).forEach(function (s) {
      if (s.result !== "competent") return;
      const d = day(s.assessed_on);
      if (!latest[s.skill] || d > latest[s.skill]) latest[s.skill] = d;
    });
    Object.keys(latest).sort().forEach(function (skill) {
      const due = addMonths(latest[skill], PRACTICAL_MONTHS);
      if (due < today) out.practical.push([skill, "Reassessment overdue since " + fmt(due)]);
      else if (due <= soon) out.practical.push([skill, "Reassessment due " + fmt(due)]);
    });

    out.count = out.training.length + out.policies.length + out.passes.length + out.practical.length;
    return out;
  }

  const SECTIONS = [
    ["training", "Training", "/#/training"],
    ["policies", "Policies to read", "/#/policies"],
    ["passes", "Passes and certificates", "/#/passes"],
    ["practical", "Practical sign-offs (arrange with your manager)", null]
  ];

  root.IAAOutstanding = { compute: compute, SECTIONS: SECTIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.IAAOutstanding;
})(typeof window !== "undefined" ? window : globalThis);
