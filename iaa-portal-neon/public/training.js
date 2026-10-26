/* Iceland Aero Agents – Staff Portal
   Training section: lessons, quizzes, certificates, records and sign-off.
   Content lives in training-content.js. The portal shell (app.js) calls
   IAATraining.render(main, ctx) whenever the Training section is shown. */

(function () {
  "use strict";

  const T = window.TRAINING || { modules: [], passMark: 0.8, manual: "" };
  const MODULES = T.modules;
  const PASS = T.passMark;

  // Station modules (those with a "stations" list) are only for people who
  // work at one of those stations. Everyone takes the others.
  function appliesTo(m, codes) {
    return !m.stations || (codes || []).some((c) => m.stations.indexOf(c) !== -1);
  }

  let quiz = null;            // the quiz in progress (kept while navigating)
  let notice = null;          // one-off message for the next page shown
  let recordsStation = "All"; // station filter on the Records page

  window.IAATraining = { render: render };

  // ------------------------------------------------------------------
  // Entry point
  // ------------------------------------------------------------------
  async function render(main, ctx) {
    const parts = location.hash.replace(/^#\/training\/?/, "").split("/").filter(Boolean);
    const view = parts[0] || "";
    const canSeeRecords = ctx.state.profile.role === "management" || ctx.state.profile.role === "station_lead";

    if (view === "quiz") return showQuiz(main, ctx);
    if (view === "result") return showResult(main, ctx);
    if (view === "records" && canSeeRecords) return showRecords(main, ctx);
    if (view === "cert" && parts[1]) return showCert(main, ctx, parts[1]);
    if (view === "record") return showTranscript(main, ctx, parts[1] ? decodeURIComponent(parts[1]) : null);
    if (MODULES.some((m) => m.id === view)) return showModule(main, ctx, view);
    return showHome(main, ctx);
  }

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  async function loadMine(ctx) {
    const me = ctx.state.profile.id;
    const [a, s] = await Promise.all([
      ctx.db.from("training_attempts").select("*").eq("profile_id", me).order("attempted_at"),
      ctx.db.from("training_signoffs").select("*").eq("profile_id", me).is("revoked_at", null)
    ]);
    if (a.error) throw a.error;
    if (s.error) throw s.error;
    return { attempts: a.data || [], certs: s.data || [] };
  }

  async function loadAll(ctx) {
    const [a, s, p] = await Promise.all([
      ctx.db.from("training_attempts").select("*").order("attempted_at"),
      ctx.db.from("training_signoffs").select("*").is("revoked_at", null),
      ctx.db.from("profiles").select("id, email, full_name, job_title, station_codes, role, active").order("full_name", { nullsFirst: false })
    ]);
    if (a.error) throw a.error;
    if (s.error) throw s.error;
    if (p.error) throw p.error;
    return { attempts: a.data || [], certs: s.data || [], people: p.data || [] };
  }

  function bestFor(atts, modId) {
    const list = atts.filter((a) => a.module === modId);
    if (!list.length) return null;
    const passed = list.filter((a) => a.passed).sort((x, y) => x.attempted_at.localeCompare(y.attempted_at));
    const best = list.reduce((m, a) => (a.pct > m.pct ? a : m), list[0]);
    return {
      best: best.pct,
      passedAt: passed.length ? passed[0].attempted_at : null,
      tries: list.length,
      last: list.map((a) => a.attempted_at).sort().pop()
    };
  }

  // ------------------------------------------------------------------
  // Shared pieces
  // ------------------------------------------------------------------
  function tabs(ctx, active) {
    const { h, state } = ctx;
    const canSeeRecords = state.profile.role === "management" || state.profile.role === "station_lead";
    if (!canSeeRecords) return null;
    return h(
      "nav",
      { class: "tabs", "aria-label": "Training views" },
      h("a", { href: "#/training", "aria-current": active === "mine" ? "page" : null }, "My training"),
      h("a", { href: "#/training/records", "aria-current": active === "records" ? "page" : null }, "Records")
    );
  }

  function noticeBox(ctx) {
    if (!notice) return null;
    const n = ctx.h("p", { class: notice.isError ? "notice is-error" : "notice" }, notice.text);
    notice = null;
    return n;
  }

  function chip(ctx, b, cert) {
    const { h } = ctx;
    if (cert) return h("span", { class: "chip chip-cert" }, "Certified");
    if (!b) return h("span", { class: "chip chip-none" }, "Not started");
    if (b.passedAt) return h("span", { class: "chip chip-pass" }, "Passed, awaiting sign-off");
    return h("span", { class: "chip chip-fail" }, `Best ${b.best}%, retake`);
  }

  function progressBar(ctx, fraction) {
    const bar = ctx.h("span", { class: "bar" }, ctx.h("i"));
    bar.firstChild.style.width = Math.round(fraction * 100) + "%";
    return bar;
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function go(hash) {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  }

  // ------------------------------------------------------------------
  // My training
  // ------------------------------------------------------------------
  async function showHome(main, ctx) {
    const { h, fill, pageHead } = ctx;
    fill(main, pageHead("Training", "Operations Officer SOP Manual v" + T.manual + ". Pass mark " + PASS * 100 + "%."), tabs(ctx, "mine"), h("p", { class: "empty" }, "Loading your training record…"));

    const { attempts, certs } = await loadMine(ctx);
    const myCodes = ctx.state.profile.station_codes || [];
    const mine = MODULES.filter((m) => appliesTo(m, myCodes));
    const others = MODULES.filter((m) => !appliesTo(m, myCodes));
    const done = mine.filter((m) => (bestFor(attempts, m.id) || {}).passedAt).length;

    function moduleItem(m) {
      const cert = certs.find((c) => c.module === m.id);
      return h(
        "li",
        null,
        h(
          "a",
          { href: "#/training/" + m.id },
          h("span", { class: "module-code" }, m.code),
          h("span", { class: "module-text" }, h("span", { class: "section-title" }, m.title), h("span", { class: "section-desc" }, m.summary)),
          chip(ctx, bestFor(attempts, m.id), cert)
        )
      );
    }

    // Management and station leads can open other stations' modules to review them.
    const showOthers = others.length && ctx.state.profile.role !== "staff";
    const othersPanel = showOthers
      ? h(
          "section",
          { class: "panel", "aria-labelledby": "other-h" },
          h("h2", { id: "other-h" }, "Other stations' modules"),
          h("p", { class: "fineprint" }, "Not required for you. Open them to review what staff at those stations learn."),
          h("ul", { class: "module-list" }, others.map(moduleItem))
        )
      : null;
    const noStationNote = !myCodes.length && others.length
      ? h("p", { class: "fineprint" }, "Station winter modules appear here once management has set your station.")
      : null;

    const list = h(
      "ul",
      { class: "module-list" },
      mine.map(function (m) {
        const cert = certs.find((c) => c.module === m.id);
        return h(
          "li",
          null,
          h(
            "a",
            { href: "#/training/" + m.id },
            h("span", { class: "module-code" }, m.code),
            h("span", { class: "module-text" }, h("span", { class: "section-title" }, m.title), h("span", { class: "section-desc" }, m.summary)),
            chip(ctx, bestFor(attempts, m.id), cert)
          )
        );
      })
    );

    fill(
      main,
      pageHead("Training", "Operations Officer SOP Manual v" + T.manual + ". Pass mark " + PASS * 100 + "%."),
      tabs(ctx, "mine"),
      noticeBox(ctx),
      h(
        "section",
        { class: "panel", "aria-labelledby": "rec-h" },
        h("h2", { id: "rec-h" }, "Your training record"),
        h("p", { class: "progress-line" }, h("span", null, `${done} of ${mine.length} passed, ${certs.length} certified`), progressBar(ctx, done / mine.length)),
        list,
        noStationNote,
        h("div", { class: "row" }, h("a", { class: "btn btn-quiet", href: "#/training/record" }, "View my training record"))
      ),
      othersPanel,
      h("p", { class: "fineprint" }, "Each module summarises the manual. The manual itself remains the reference: if anything here differs from a newer instruction, follow the newer one and tell management.")
    );
  }

  async function showModule(main, ctx, modId) {
    const { h, fill, pageHead } = ctx;
    const m = MODULES.find((x) => x.id === modId);
    fill(main, h("p", { class: "empty" }, "Loading…"));
    const { attempts, certs } = await loadMine(ctx);
    const b = bestFor(attempts, m.id);
    const cert = certs.find((c) => c.module === m.id);
    const needed = Math.ceil(m.quiz.length * PASS);

    const sections = m.lesson.map(function (s) {
      const body = document.createElement("div");
      body.className = "lesson-body";
      body.innerHTML = s.html; // fixed content from training-content.js
      return h("section", { class: "panel lesson" + (s.key ? " is-key" : "") }, h("h2", null, s.h), body);
    });

    fill(
      main,
      h("a", { class: "back-link", href: "#/training" }, "All modules"),
      pageHead(m.title, m.part),
      h("p", { class: "lede" }, m.summary),
      sections,
      h(
        "section",
        { class: "panel", "aria-labelledby": "quiz-h" },
        h("h2", { id: "quiz-h" }, `Quiz: ${m.quiz.length} questions`),
        h("p", null, `Answer each question, then check it. You need ${needed} correct (${PASS * 100}%) to pass.` + (b ? ` Your best so far is ${b.best}%.` : "")),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn", type: "button", onclick: function () { startQuiz(m.id); } }, "Start quiz"),
          cert ? h("a", { class: "btn btn-quiet", href: "#/training/cert/" + cert.id }, "View certificate") : null
        )
      )
    );
  }

  // ------------------------------------------------------------------
  // Quiz
  // ------------------------------------------------------------------
  function startQuiz(modId) {
    const m = MODULES.find((x) => x.id === modId);
    const qs = shuffle(m.quiz).map(function (q) {
      const order = shuffle(q.o.map((_, i) => i));
      return Object.assign({}, q, { order: order, ans: order.indexOf(q.a) });
    });
    quiz = { mod: modId, qs: qs, i: 0, pick: null, checked: false, right: 0, missed: [], result: null, saveMsg: "" };
    go("#/training/quiz");
  }

  function showQuiz(main, ctx) {
    const { h, fill } = ctx;
    if (!quiz || quiz.result) return go("#/training");
    const m = MODULES.find((x) => x.id === quiz.mod);
    const q = quiz.qs[quiz.i];
    const last = quiz.i === quiz.qs.length - 1;

    const opts = q.order.map(function (oi, k) {
      let cls = "opt";
      if (quiz.checked && k === q.ans) cls += " is-right";
      else if (quiz.checked && k === quiz.pick) cls += " is-wrong";
      else if (!quiz.checked && k === quiz.pick) cls += " is-picked";
      return h(
        "button",
        {
          class: cls,
          type: "button",
          "aria-pressed": quiz.pick === k ? "true" : "false",
          disabled: quiz.checked,
          onclick: function () { quiz.pick = k; showQuiz(main, ctx); }
        },
        h("span", { class: "opt-key" }, "ABCD"[k]),
        h("span", null, q.o[oi])
      );
    });

    const ok = quiz.pick === q.ans;
    const feedback = quiz.checked
      ? h(
          "div",
          { class: "feedback " + (ok ? "is-ok" : "is-no") },
          h("b", null, ok ? "Correct. " : "Not quite: the answer is " + "ABCD"[q.ans] + ". "),
          q.e + " ",
          h("span", { class: "ref" }, "§" + q.r)
        )
      : null;

    const action = quiz.checked
      ? h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: function () {
              if (last) finishQuiz(ctx);
              else { quiz.i += 1; quiz.pick = null; quiz.checked = false; showQuiz(main, ctx); }
            }
          },
          last ? "See result" : "Next question"
        )
      : h(
          "button",
          {
            class: "btn",
            type: "button",
            disabled: quiz.pick === null,
            onclick: function () {
              quiz.checked = true;
              if (quiz.pick === q.ans) quiz.right += 1;
              else quiz.missed.push(q);
              showQuiz(main, ctx);
            }
          },
          "Check answer"
        );

    fill(
      main,
      h("p", { class: "quiz-head" }, h("span", null, m.title), h("span", { class: "quiz-count" }, `${quiz.i + 1} of ${quiz.qs.length}`)),
      progressBar(ctx, quiz.i / quiz.qs.length),
      h("h1", { class: "quiz-question" }, q.q),
      h("div", { class: "opts" }, opts),
      feedback,
      h(
        "div",
        { class: "row" },
        action,
        h("button", { class: "btn btn-quiet", type: "button", onclick: function () {
          if (confirm("Leave this quiz? Your answers so far won’t be saved.")) { const id = quiz.mod; quiz = null; go("#/training/" + id); }
        } }, "Leave quiz")
      )
    );
  }

  async function finishQuiz(ctx) {
    const m = MODULES.find((x) => x.id === quiz.mod);
    const total = quiz.qs.length;
    const score = quiz.right;
    const rec = {
      profile_id: ctx.state.profile.id,
      learner_name: ctx.state.profile.full_name || ctx.state.profile.email,
      name_key: "-",
      module: m.id,
      module_title: m.title,
      score: score,
      total: total,
      pct: Math.round((score * 100) / total),
      passed: score * 5 >= total * 4,
      manual: T.manual,
      source: "portal"
    };
    quiz.result = rec;
    quiz.saveMsg = "Saving…";
    go("#/training/result");

    const { error } = await ctx.db.from("training_attempts").insert(rec);
    quiz.saveMsg = error
      ? "This result couldn’t be saved: " + error.message + ". Take a screenshot and tell management."
      : "Result saved to your training record.";
    if (location.hash === "#/training/result") go("#/training/result");
  }

  function showResult(main, ctx) {
    const { h, fill } = ctx;
    if (!quiz || !quiz.result) return go("#/training");
    const r = quiz.result;
    const m = MODULES.find((x) => x.id === quiz.mod);

    fill(
      main,
      h("p", { class: "quiz-head" }, h("span", null, m.title)),
      h("p", { class: "score " + (r.passed ? "is-ok" : "is-no") }, r.pct + "%"),
      h("h1", null, (r.passed ? "Passed" : "Not passed yet") + `: ${r.score} of ${r.total} correct`),
      h(
        "p",
        { class: "lede" },
        r.passed
          ? "Well done. Your certificate is issued once management signs this module off. It will then appear in your training record."
          : `You need ${PASS * 100}% to pass. Review the sections below, then retake the quiz.`
      ),
      h("p", { class: "status" + (/couldn’t/.test(quiz.saveMsg) ? " is-error" : "") }, quiz.saveMsg),
      quiz.missed.length
        ? h(
            "section",
            { class: "panel" },
            h("h2", null, "To review"),
            h("ul", null, quiz.missed.map((q) => h("li", null, q.q + " ", h("span", { class: "ref" }, "§" + q.r))))
          )
        : null,
      h(
        "div",
        { class: "row" },
        h("a", { class: "btn", href: "#/training" }, "Back to modules"),
        h("button", { class: "btn btn-quiet", type: "button", onclick: function () { startQuiz(m.id); } }, "Retake quiz"),
        h("a", { class: "btn btn-quiet", href: "#/training/" + m.id }, "Review module")
      )
    );
  }

  // ------------------------------------------------------------------
  // Certificates
  // ------------------------------------------------------------------
  async function showCert(main, ctx, id) {
    const { h, fill, state } = ctx;
    fill(main, h("p", { class: "empty" }, "Loading certificate…"));
    const res = await ctx.db.from("training_signoffs").select("*").eq("id", id).is("revoked_at", null);
    if (res.error) throw res.error;
    const c = (res.data || [])[0];
    if (!c) {
      notice = { text: "That certificate isn’t available. It may have been revoked.", isError: true };
      return go("#/training");
    }

    const isManagement = state.profile.role === "management";
    const back = c.profile_id === state.profile.id ? "#/training" : "#/training/records";
    const msg = h("p", { class: "status", role: "status" });

    fill(
      main,
      h("a", { class: "back-link", href: back }, "Back"),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", type: "button", onclick: function () { certPdf(c, msg, ctx); } }, "Download PDF"),
        isManagement
          ? h(
              "button",
              {
                class: "btn btn-quiet",
                type: "button",
                onclick: async function () {
                  if (!confirm(`Revoke certificate ${c.cert_no} for ${c.learner_name}? It stays on record as revoked.`)) return;
                  const { error } = await ctx.db.rpc("training_revoke", { p_signoff_id: c.id });
                  if (error) { ctx.setStatus(msg, error.message, true); return; }
                  notice = { text: `Certificate ${c.cert_no} revoked.` };
                  go("#/training/records");
                }
              },
              "Revoke"
            )
          : null
      ),
      msg,
      h(
        "div",
        { class: "cert-wrap" },
        h(
          "div",
          { class: "cert" },
          h("p", { class: "cert-brand" }, "ICELAND AERO AGENTS", h("span", null, "BIKF · BIRK · BIAR")),
          h("p", { class: "cert-kicker" }, "Certificate of Completion"),
          h("p", { class: "cert-small" }, "This certifies that"),
          h("p", { class: "cert-name" }, c.learner_name),
          h("p", { class: "cert-small" }, "has successfully completed the training module"),
          h("p", { class: "cert-mod" }, c.module_title),
          h("p", { class: "cert-small" }, `${c.part || ""} · Operations Officer SOP Manual v${c.manual || T.manual} · Score ${c.pct}% · Passed ${fmtDate(c.passed_at)}`),
          h(
            "div",
            { class: "cert-foot" },
            h(
              "div",
              { class: "cert-sig" },
              h("p", { class: "cert-sig-name" }, c.signer_name),
              h("p", null, c.signer_title || ""),
              h("p", { class: "cert-small" }, "Signed off electronically " + fmtDate(c.signed_at))
            ),
            h(
              "div",
              { class: "cert-no" },
              h("p", { class: "cert-small" }, "Certificate no."),
              h("p", { class: "cert-code" }, c.cert_no),
              h("p", { class: "cert-small" }, "Station: " + (c.station || "–"))
            )
          )
        )
      )
    );
  }

  function certPdf(c, msg, ctx) {
    try {
      const jsPDF = window.jspdf && window.jspdf.jsPDF;
      if (!jsPDF) throw new Error("PDF library missing");
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = 297;
      const teal = [8, 143, 131], navy = [27, 42, 65], grey = [91, 104, 102];
      doc.setDrawColor.apply(doc, teal); doc.setLineWidth(2.2); doc.rect(10, 10, W - 20, 190);
      doc.setLineWidth(0.4); doc.rect(14, 14, W - 28, 182);
      const center = function (t, y, size, font, style, col) {
        doc.setFont(font, style); doc.setFontSize(size); doc.setTextColor.apply(doc, col); doc.text(t, W / 2, y, { align: "center" });
      };
      center("ICELAND AERO AGENTS", 36, 20, "helvetica", "bold", teal);
      center("BIKF  ·  BIRK  ·  BIAR", 43, 9, "helvetica", "normal", grey);
      center("CERTIFICATE OF COMPLETION", 62, 26, "helvetica", "bold", navy);
      center("This certifies that", 78, 12, "helvetica", "normal", grey);
      center(c.learner_name, 94, 30, "times", "bolditalic", navy);
      center("has successfully completed the training module", 108, 12, "helvetica", "normal", grey);
      center(c.module_title || "", 122, 20, "helvetica", "bold", teal);
      center(`${c.part || ""}  ·  Operations Officer SOP Manual v${c.manual || T.manual}  ·  Score ${c.pct}%  ·  Passed ${fmtDate(c.passed_at)}`, 132, 10, "helvetica", "normal", grey);
      doc.setDrawColor.apply(doc, navy); doc.setLineWidth(0.3); doc.line(40, 168, 120, 168);
      doc.setFont("times", "italic"); doc.setFontSize(18); doc.setTextColor.apply(doc, navy); doc.text(c.signer_name, 80, 164, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(c.signer_title || "", 80, 174, { align: "center" });
      doc.setTextColor.apply(doc, grey); doc.setFontSize(8); doc.text("Signed off electronically " + fmtDate(c.signed_at), 80, 179, { align: "center" });
      doc.setFontSize(8); doc.text("Certificate no.", 217, 160, { align: "center" });
      doc.setFont("courier", "bold"); doc.setFontSize(11); doc.setTextColor.apply(doc, navy); doc.text(c.cert_no, 217, 166, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor.apply(doc, grey); doc.text("Station: " + (c.station || "–"), 217, 172, { align: "center" });
      const safe = c.learner_name.normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
      doc.save(`IAA_Certificate_${c.module_code || c.module}_${safe}.pdf`);
    } catch (e) {
      ctx.setStatus(msg, "The PDF couldn’t be created. Reload the page and try again.", true);
    }
  }

  // ------------------------------------------------------------------
  // Training record (transcript): every module required for one person,
  // with Pass / Fail / Not taken, date passed and certificate. No scores.
  // ------------------------------------------------------------------
  async function showTranscript(main, ctx, key) {
    const { h, fill, state } = ctx;
    const canSeeOthers = state.profile.role === "management" || state.profile.role === "station_lead";
    const ownKey = "p:" + state.profile.id;
    if (!key || !canSeeOthers) key = ownKey;
    fill(main, h("p", { class: "empty" }, "Loading training record…"));

    let person, atts, certs;
    if (key === ownKey) {
      const mine = await loadMine(ctx);
      atts = mine.attempts; certs = mine.certs;
      person = { name: state.profile.full_name || state.profile.email, job: state.profile.job_title || "", stations: state.profile.station_codes || [] };
    } else {
      const data = await loadAll(ctx);
      const isProfile = key.indexOf("p:") === 0;
      const id = key.slice(2);
      const match = (row) => (isProfile ? row.profile_id === id : (!row.profile_id && row.name_key === id));
      atts = data.attempts.filter(match);
      certs = data.certs.filter(match);
      const p = isProfile ? data.people.find((x) => x.id === id) : null;
      const first = atts[0] || certs[0] || {};
      if (!p && !first.learner_name) {
        notice = { text: "That training record isn’t available.", isError: true };
        return go("#/training/records");
      }
      person = p
        ? { name: p.full_name || p.email, job: p.job_title || "", stations: p.station_codes || [] }
        : { name: first.learner_name, job: "", stations: first.station ? [first.station] : [], legacy: true };
    }

    const rows = MODULES
      .filter((m) => appliesTo(m, person.stations) || atts.some((a) => a.module === m.id) || certs.some((c) => c.module === m.id))
      .map(function (m) {
        const b = bestFor(atts, m.id);
        const cert = certs.find((c) => c.module === m.id);
        const passed = !!(cert || (b && b.passedAt));
        return {
          code: m.code,
          title: m.title,
          part: m.part,
          required: appliesTo(m, person.stations),
          result: passed ? "Pass" : b ? "Fail" : "Not taken",
          date: cert ? cert.passed_at : b && b.passedAt ? b.passedAt : null,
          cert: cert ? cert.cert_no : null,
          signer: cert ? cert.signer_name : null,
          signed: cert ? cert.signed_at : null
        };
      });
    const required = rows.filter((r) => r.required);
    const passed = required.filter((r) => r.result === "Pass").length;
    const certified = required.filter((r) => r.cert).length;
    const rec = { person: person, rows: rows, passed: passed, certified: certified, total: required.length, issued: new Date().toISOString() };

    const msg = h("p", { class: "status", role: "status" });
    const back = key === ownKey ? "#/training" : "#/training/records";
    fill(
      main,
      h("a", { class: "back-link", href: back }, "Back"),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: function () { transcriptPdf(rec, msg, ctx); } }, "Download PDF")),
      msg,
      h(
        "section",
        { class: "panel transcript" },
        h("p", { class: "cert-brand" }, "ICELAND AERO AGENTS", h("span", null, "BIKF · BIRK · BIAR")),
        h("h1", null, "Training Record"),
        h("dl", { class: "transcript-who" },
          h("dt", null, "Name"), h("dd", null, person.name),
          person.job ? [h("dt", null, "Job title"), h("dd", null, person.job)] : null,
          h("dt", null, "Stations"), h("dd", null, person.stations.length ? person.stations.join(", ") : "Not set"),
          h("dt", null, "Manual"), h("dd", null, "Operations Officer SOP Manual v" + T.manual),
          h("dt", null, "Issued"), h("dd", null, fmtDate(rec.issued))),
        h("p", { class: "transcript-summary" }, `${passed} of ${required.length} required modules passed · ${certified} certified`),
        h("div", { class: "table-wrap" },
          h("table", null,
            h("thead", null, h("tr", null, h("th", null, "Module"), h("th", null, "Result"), h("th", null, "Passed"), h("th", null, "Certificate"))),
            h("tbody", null, rows.map((r) => h("tr", null,
              h("td", null, h("b", null, r.code + " "), r.title, h("span", { class: "sub" }, r.part + (r.required ? "" : " · not required for this person"))),
              h("td", null, h("span", { class: "chip " + (r.result === "Pass" ? "chip-pass" : r.result === "Fail" ? "chip-sev-high" : "chip-none") }, r.result)),
              h("td", null, r.date ? fmtDate(r.date) : "–"),
              h("td", null, r.cert ? [h("span", { class: "mono" }, r.cert), h("span", { class: "sub" }, "Signed off by " + r.signer + ", " + fmtDate(r.signed))] : r.result === "Pass" ? h("span", { class: "sub" }, "Awaiting sign-off") : "–")))))),
        h("p", { class: "fineprint" }, "Results are shown as pass or fail only. This record reflects the IAA Staff Portal on the date issued" + (person.legacy ? "; these are old records not yet linked to a portal account." : "."))
      )
    );
  }

  function transcriptPdf(rec, msg, ctx) {
    try {
      const jsPDF = window.jspdf && window.jspdf.jsPDF;
      if (!jsPDF) throw new Error("PDF library missing");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = 210, H = 297, L = 18, R = W - 18;
      const teal = [8, 143, 131], navy = [27, 42, 65], grey = [91, 104, 102], red = [180, 35, 24];
      const frame = function () {
        doc.setDrawColor.apply(doc, teal); doc.setLineWidth(1.6); doc.rect(8, 8, W - 16, H - 16);
        doc.setLineWidth(0.3); doc.rect(11, 11, W - 22, H - 22);
      };
      const txt = function (t, x, y, size, style, col, opts) {
        doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); doc.setTextColor.apply(doc, col || navy); doc.text(String(t), x, y, opts || {});
      };
      frame();
      txt("ICELAND AERO AGENTS", W / 2, 26, 16, "bold", teal, { align: "center" });
      txt("BIKF  ·  BIRK  ·  BIAR", W / 2, 32, 8, "normal", grey, { align: "center" });
      txt("TRAINING RECORD", W / 2, 46, 20, "bold", navy, { align: "center" });

      let y = 60;
      const p = rec.person;
      const field = function (label, value) {
        txt(label, L, y, 9, "normal", grey); txt(value, L + 32, y, 10, "bold", navy); y += 6.5;
      };
      field("Name", p.name);
      if (p.job) field("Job title", p.job);
      field("Stations", p.stations.length ? p.stations.join(", ") : "Not set");
      field("Manual", "Operations Officer SOP Manual v" + T.manual);
      field("Issued", fmtDate(rec.issued));
      y += 2;
      txt(`${rec.passed} of ${rec.total} required modules passed  ·  ${rec.certified} certified`, L, y, 10, "bold", teal);
      y += 8;

      const cols = [L, L + 92, L + 116, L + 140];
      const head = function () {
        doc.setFillColor(232, 244, 241); doc.rect(L - 2, y - 5, R - L + 4, 8, "F");
        ["Module", "Result", "Passed", "Certificate"].forEach((c, i) => txt(c, cols[i], y, 9, "bold", navy));
        y += 7;
      };
      head();
      rec.rows.forEach(function (r) {
        const titleLines = doc.setFont("helvetica", "bold").setFontSize(9).splitTextToSize(r.code + "  " + r.title, 88);
        const rowH = Math.max(11, titleLines.length * 4.2 + 6);
        if (y + rowH > H - 28) { doc.addPage(); frame(); y = 22; head(); }
        txt(titleLines, cols[0], y, 9, "bold", navy);
        txt(r.part + (r.required ? "" : " · not required"), cols[0], y + titleLines.length * 4.2, 7.5, "normal", grey);
        txt(r.result, cols[1], y, 9, "bold", r.result === "Pass" ? teal : r.result === "Fail" ? red : grey);
        txt(r.date ? fmtDate(r.date) : "–", cols[2], y, 9, "normal", navy);
        if (r.cert) {
          doc.setFont("courier", "bold"); doc.setFontSize(8); doc.setTextColor.apply(doc, navy); doc.text(r.cert, cols[3], y);
          txt(doc.splitTextToSize("Signed off by " + r.signer + ", " + fmtDate(r.signed), R - cols[3]), cols[3], y + 4.2, 7, "normal", grey);
        } else {
          txt(r.result === "Pass" ? "Awaiting sign-off" : "–", cols[3], y, 8, "normal", grey);
        }
        y += rowH;
        doc.setDrawColor(210, 225, 221); doc.setLineWidth(0.2); doc.line(L - 2, y - 4, R + 2, y - 4);
      });
      txt("Results are shown as pass or fail only. This record reflects the IAA Staff Portal on the date issued.", W / 2, H - 18, 7.5, "normal", grey, { align: "center" });
      const safe = p.name.normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
      doc.save(`IAA_Training_Record_${safe}.pdf`);
    } catch (e) {
      ctx.setStatus(msg, "The PDF couldn’t be created. Reload the page and try again.", true);
    }
  }

  // ------------------------------------------------------------------
  // Records (management and station leads)
  // ------------------------------------------------------------------
  async function showRecords(main, ctx) {
    const { h, fill, pageHead, state, setStatus } = ctx;
    const isManagement = state.profile.role === "management";
    fill(main, pageHead("Training records"), tabs(ctx, "records"), h("p", { class: "empty" }, "Loading records…"));

    const data = await loadAll(ctx);
    const peopleById = {};
    data.people.forEach((p) => { peopleById[p.id] = p; });

    // Group everything by person: linked records by account, old ones by name.
    const learners = {};
    function learnerFor(row) {
      const key = row.profile_id ? "p:" + row.profile_id : "n:" + row.name_key;
      if (!learners[key]) {
        const p = row.profile_id ? peopleById[row.profile_id] : null;
        learners[key] = {
          key: key,
          profileId: row.profile_id || null,
          name: p ? (p.full_name || p.email) : row.learner_name,
          stations: p ? (p.station_codes || []) : (row.station ? [row.station] : []),
          station: p ? (p.station_codes || []).join(", ") : (row.station || ""),
          atts: [],
          certs: [],
          last: ""
        };
      }
      return learners[key];
    }
    data.people.forEach((p) => { if (p.active) learnerFor({ profile_id: p.id }); });
    data.attempts.forEach((a) => {
      const L = learnerFor(a);
      L.atts.push(a);
      if (a.attempted_at > L.last) L.last = a.attempted_at;
    });
    data.certs.forEach((c) => learnerFor(c).certs.push(c));

    const all = Object.values(learners).sort((x, y) => x.name.localeCompare(y.name));
    const shown = all.filter((L) => recordsStation === "All" || L.stations.indexOf(recordsStation) !== -1);

    // ----- station filter and export
    const stationOptions = ["All"].concat(state.stations.map((s) => s.code), ["Multiple"]);
    const filter = h(
      "select",
      {
        id: "records-station",
        onchange: function (e) { recordsStation = e.target.value; showRecords(main, ctx); }
      },
      stationOptions.map((s) => h("option", { value: s, selected: s === recordsStation }, s))
    );
    const exportBtn = h("button", { class: "btn btn-quiet", type: "button", onclick: function () { exportCsv(all); } }, "Export CSV");

    // ----- sign-off queue (management)
    const queueStatus = h("p", { class: "status", role: "status" });
    const queue = [];
    if (isManagement) {
      all.forEach((L) => {
        if (!L.profileId) return;
        MODULES.forEach((m) => {
          const b = bestFor(L.atts, m.id);
          if (b && b.passedAt && !L.certs.some((c) => c.module === m.id)) queue.push({ L: L, m: m, b: b });
        });
      });
    }
    const missingTitle = isManagement && !(state.profile.full_name && state.profile.job_title);
    const queuePanel = isManagement
      ? h(
          "section",
          { class: "panel", "aria-labelledby": "queue-h" },
          h("h2", { id: "queue-h" }, `Awaiting sign-off: ${queue.length}`),
          missingTitle
            ? h("p", { class: "notice" }, "Add your name and job title under Your details on the Home page. They’re printed on the certificates you sign.")
            : h("p", null, `Certificates you sign show ${state.profile.full_name}, ${state.profile.job_title}. Confirm any practical assessment is complete before signing off.`),
          queue.length
            ? h(
                "div",
                { class: "table-wrap" },
                h(
                  "table",
                  null,
                  h("thead", null, h("tr", null, h("th", null, "Person"), h("th", null, "Module"), h("th", null, "Best"), h("th", null, "Passed"), h("th", null, ""))),
                  h(
                    "tbody",
                    null,
                    queue.map(function (item) {
                      const btn = h(
                        "button",
                        {
                          class: "btn btn-small",
                          type: "button",
                          disabled: missingTitle,
                          onclick: async function () {
                            btn.disabled = true;
                            const { error } = await ctx.db.rpc("training_sign_off", {
                              p_profile_id: item.L.profileId,
                              p_module: item.m.id,
                              p_module_code: item.m.code,
                              p_module_title: item.m.title,
                              p_part: item.m.part,
                              p_manual: T.manual
                            });
                            if (error) { btn.disabled = false; setStatus(queueStatus, error.message, true); return; }
                            notice = { text: `Signed off ${item.L.name}: ${item.m.title}.` };
                            showRecords(main, ctx);
                          }
                        },
                        "Sign off"
                      );
                      return h(
                        "tr",
                        null,
                        h("td", null, item.L.name, h("span", { class: "sub" }, item.L.station || "No station")),
                        h("td", null, item.m.title),
                        h("td", null, item.b.best + "%"),
                        h("td", null, fmtDate(item.b.passedAt)),
                        h("td", null, btn)
                      );
                    })
                  )
                )
              )
            : h("p", { class: "empty" }, "Nothing waiting. Passed modules appear here until someone in management signs them off."),
          queueStatus
        )
      : null;

    // ----- link old records (management)
    const unlinked = all.filter((L) => !L.profileId && (L.atts.length || L.certs.length));
    const linkStatus = h("p", { class: "status", role: "status" });
    const linkPanel = isManagement && unlinked.length
      ? h(
          "section",
          { class: "panel", "aria-labelledby": "link-h" },
          h("h2", { id: "link-h" }, `Link old records: ${unlinked.length}`),
          h("p", null, "These results came from the old training page, which only knew the name people typed in. Choose the portal account each name belongs to. Their attempts and certificates then show in their own training record. People need to have signed in to the portal at least once to appear in the list."),
          h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("thead", null, h("tr", null, h("th", null, "Name on old records"), h("th", null, "Records"), h("th", null, "Portal account"), h("th", null, ""))),
              h(
                "tbody",
                null,
                unlinked.map(function (L) {
                  const nameKey = L.key.slice(2);
                  const guess = data.people.find((p) => (p.full_name || "").trim().toLowerCase().replace(/\s+/g, " ") === nameKey);
                  const pick = h(
                    "select",
                    { "aria-label": "Portal account for " + L.name },
                    h("option", { value: "", selected: !guess }, "Choose…"),
                    data.people.map((p) => h("option", { value: p.id, selected: guess && guess.id === p.id }, (p.full_name || "No name") + " – " + p.email))
                  );
                  const btn = h(
                    "button",
                    {
                      class: "btn btn-small",
                      type: "button",
                      onclick: async function () {
                        if (!pick.value) { setStatus(linkStatus, "Choose a portal account first.", true); return; }
                        const person = peopleById[pick.value];
                        if (!confirm(`Link all old records for “${L.name}” to ${person.full_name || person.email}?`)) return;
                        btn.disabled = true;
                        const { error } = await ctx.db.rpc("training_link_records", { p_name_key: nameKey, p_profile_id: pick.value });
                        if (error) { btn.disabled = false; setStatus(linkStatus, error.message, true); return; }
                        notice = { text: `Linked the old records for ${L.name}.` };
                        showRecords(main, ctx);
                      }
                    },
                    "Link"
                  );
                  return h(
                    "tr",
                    null,
                    h("td", null, L.name, h("span", { class: "sub" }, L.station || "")),
                    h("td", null, `${L.atts.length} ${L.atts.length === 1 ? "attempt" : "attempts"}, ${L.certs.length} ${L.certs.length === 1 ? "certificate" : "certificates"}`),
                    h("td", null, pick),
                    h("td", null, btn)
                  );
                })
              )
            )
          ),
          linkStatus
        )
      : null;

    // ----- matrix of everyone
    const head = h("tr", null, h("th", null, "Person"), MODULES.map((m) => h("th", { title: m.title }, m.code)), h("th", null, "Passed"), h("th", null, "Last activity"));
    const rows = shown.map(function (L) {
      let n = 0;
      const required = MODULES.filter((m) => appliesTo(m, L.stations));
      const cells = MODULES.map(function (m) {
        const b = bestFor(L.atts, m.id);
        const cert = L.certs.find((c) => c.module === m.id);
        const needed = appliesTo(m, L.stations);
        if (!needed && !b && !cert) return h("td", null, h("span", { class: "cell cell-none", title: "Not required: other station" }, "n/a"));
        if (cert) {
          if (needed) n += 1;
          return h("td", null, h("a", { class: "cell cell-cert", href: "#/training/cert/" + cert.id }, "★ " + (b ? b.best : cert.pct) + "%"), h("span", { class: "sub" }, "Certified"));
        }
        if (!b) return h("td", null, h("span", { class: "cell cell-none" }, "–"));
        if (b.passedAt) {
          if (needed) n += 1;
          return h("td", null, h("span", { class: "cell cell-pass" }, "✓ " + b.best + "%"), h("span", { class: "sub" }, "Awaiting sign-off"));
        }
        return h("td", null, h("span", { class: "cell cell-fail" }, b.best + "%"), h("span", { class: "sub" }, b.tries + (b.tries === 1 ? " try" : " tries")));
      });
      return h(
        "tr",
        null,
        h("td", null, h("a", { href: "#/training/record/" + encodeURIComponent(L.key) }, L.name), h("span", { class: "sub" }, (L.station || "No station") + (L.profileId ? "" : " · old records, not linked"))),
        cells,
        h("td", null, `${n}/${required.length}`),
        h("td", { class: "sub-cell" }, L.last ? fmtDate(L.last) : "Not started")
      );
    });

    const fullyDone = shown.filter((L) => MODULES.filter((m) => appliesTo(m, L.stations)).every((m) => (bestFor(L.atts, m.id) || {}).passedAt)).length;

    fill(
      main,
      pageHead("Training records", isManagement ? "Everyone’s progress, sign-off and certificates." : "Progress for staff at your station."),
      tabs(ctx, "records"),
      noticeBox(ctx),
      h(
        "div",
        { class: "row" },
        h("div", { class: "field" }, h("label", { for: "records-station" }, "Station"), filter),
        exportBtn
      ),
      h("p", { class: "fineprint" }, `${shown.length} people, ${fullyDone} with all their required modules passed.`),
      queuePanel,
      linkPanel,
      h(
        "section",
        { class: "panel", "aria-labelledby": "matrix-h" },
        h("h2", { id: "matrix-h" }, "Everyone"),
        h("div", { class: "table-wrap" }, h("table", { class: "matrix" }, h("thead", null, head), h("tbody", null, rows))),
        h("p", { class: "fineprint" }, "★ certified (select to view) · ✓ passed, awaiting sign-off · % best score so far · n/a not required (other station)"),
        h("p", { class: "fineprint" }, MODULES.map((m) => m.code + " " + m.title).join(" · "))
      )
    );
  }

  function exportCsv(all) {
    const rows = [["Date", "Name", "Station", "Module", "Score", "Total", "Percent", "Passed", "Certificate no.", "Signed off by", "Signed off on", "Manual version", "Source"]];
    const atts = [];
    all.forEach((L) => L.atts.forEach((a) => atts.push({ L: L, a: a })));
    atts.sort((x, y) => x.a.attempted_at.localeCompare(y.a.attempted_at));
    atts.forEach(function (item) {
      const a = item.a;
      const c = a.passed ? item.L.certs.find((x) => x.module === a.module) : null;
      rows.push([a.attempted_at, item.L.name, item.L.station, a.module_title, a.score, a.total, a.pct, a.passed ? "Yes" : "No",
        c ? c.cert_no : "", c ? c.signer_name : "", c ? c.signed_at : "", a.manual, a.source === "legacy" ? "Old training page" : "Portal"]);
    });
    const csv = "\ufeff" + rows.map((r) => r.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `IAA_training_records_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
