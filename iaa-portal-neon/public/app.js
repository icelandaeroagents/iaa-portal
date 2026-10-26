/* Iceland Aero Agents – Staff Portal
   Foundation: sign-in, roles, stations, navigation and admin pages.
   Runs on Neon (Managed Better Auth + Data API).
   New sections are added to the MODULES list further down. */

(function () {
  "use strict";

  const cfg = window.PORTAL_CONFIG || {};
  const root = document.getElementById("app");

  const ALL_ROLES = ["staff", "station_lead", "management"];
  const ROLE_LABELS = {
    staff: "Staff",
    station_lead: "Station lead",
    management: "Management"
  };

  const state = {
    user: null,        // signed-in Neon Auth user
    profile: null,     // row from public.profiles
    stations: [],
    signin: { step: "email", email: "" },
    message: null      // message to show on the sign-in screen
  };

  // ------------------------------------------------------------------
  // Sections of the portal. Each one lists which roles can see it.
  // ------------------------------------------------------------------
  const MODULES = [
    {
      id: "home",
      title: "Home",
      roles: ALL_ROLES,
      render: renderHome
    },
    {
      id: "briefings",
      title: "Briefings",
      description: "This week’s briefing and every issue before it.",
      roles: ALL_ROLES,
      render: renderBriefings
    },
    {
      id: "roster",
      title: "Roster",
      description: "Who’s on today, and the full roster.",
      roles: ALL_ROLES,
      render: renderRoster
    },
    {
      id: "training",
      title: "Training",
      description: "Your courses, quizzes and certificates.",
      roles: ALL_ROLES,
      render: renderTraining
    },
    {
      id: "passes",
      title: "Passes & certificates",
      description: "Your airport passes, permits and certificates, with expiry reminders.",
      roles: ALL_ROLES,
      render: renderPasses
    },
    {
      id: "requests",
      title: "Requests",
      description: "Leave and availability, stock refills, equipment and vehicle defects.",
      roles: ALL_ROLES,
      render: renderRequests
    },
    {
      id: "reports",
      title: "Reports",
      description: "Submit and follow up internal reports.",
      roles: ALL_ROLES,
      render: renderReports
    },
    {
      id: "people",
      title: "People",
      description: "Give staff access and set their role and station.",
      roles: ["management"],
      render: renderPeople
    },
    {
      id: "stations",
      title: "Stations",
      description: "Add stations and choose which ones are active.",
      roles: ["management"],
      render: renderStations
    }
  ];

  // ------------------------------------------------------------------
  // Start-up
  // ------------------------------------------------------------------
  const notConfigured =
    !cfg.neonAuthUrl || !cfg.neonDataApiUrl ||
    cfg.neonAuthUrl.indexOf("ep-XXXX") !== -1 || cfg.neonDataApiUrl.indexOf("ep-XXXX") !== -1;

  if (notConfigured || !window.NeonJS) {
    root.replaceChildren(
      messageScreen(
        "The portal isn’t connected yet",
        "Add the Neon Auth URL and Data API URL to config.js, then reload this page."
      )
    );
    return;
  }

  const db = window.NeonJS.createClient({
    auth: { url: cfg.neonAuthUrl },
    dataApi: { url: cfg.neonDataApiUrl }
  });

  init();

  async function init() {
    readReturnErrorFromUrl();
    if (restoreSignin() && !state.message) {
      state.message = { text: `Enter the code we sent to ${state.signin.email}.`, isError: false };
    }
    window.addEventListener("hashchange", render);
    await refreshSession();
  }

  async function refreshSession() {
    root.replaceChildren(h("p", { class: "boot" }, "Loading the portal…"));
    try {
      const res = await db.auth.getSession();
      state.user = sessionUser(res);
    } catch (err) {
      state.user = null;
      console.warn("Session check failed:", err);
    }
    await loadAndRender();
  }

  async function loadAndRender() {
    if (!state.user) {
      state.profile = null;
      render();
      return;
    }

    root.replaceChildren(h("p", { class: "boot" }, "Loading your details…"));

    // Returns the person's profile, creating it on their first visit.
    const profileRes = await db.rpc("claim_profile");
    if (profileRes.error) {
      const msg = profileRes.error.message || "";
      if (/no invitation/i.test(msg)) {
        await renderRequestAccess();
      } else if (/not verified/i.test(msg)) {
        root.replaceChildren(
          messageScreen(
            "Confirm your email address",
            "Sign out, then sign in again with a one-time code sent to your email.",
            signOutButton("Sign out")
          )
        );
      } else {
        root.replaceChildren(
          messageScreen("Your details couldn’t be loaded", msg || "Try reloading the page.", signOutButton())
        );
      }
      return;
    }

    state.profile = Array.isArray(profileRes.data) ? profileRes.data[0] : profileRes.data;

    const stationsRes = await db.from("stations").select("*").order("sort_order").order("code");
    if (stationsRes.error) {
      root.replaceChildren(
        messageScreen("Your details couldn’t be loaded", stationsRes.error.message, signOutButton())
      );
      return;
    }
    state.stations = stationsRes.data || [];
    render();
  }

  // ------------------------------------------------------------------
  // Asking for access (signed in, but not invited)
  // ------------------------------------------------------------------
  async function renderRequestAccess(sentNow) {
    const [reqRes, stRes] = await Promise.all([
      db.from("access_requests").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }),
      db.from("stations").select("*").order("sort_order").order("code")
    ]);
    state.stations = stRes.data || [];
    const latest = (reqRes.data || [])[0];

    if (latest && latest.status === "pending") {
      root.replaceChildren(
        messageScreen(
          sentNow ? "Request sent" : "Your request is waiting",
          `Management has been asked to give ${latest.email} access to the staff portal. You’ll get an email when it’s approved. Then open the portal again.`,
          h("div", { class: "row" },
            h("button", { class: "btn", type: "button", onclick: function () { refreshSession(); } }, "Check again"),
            signOutButton("Sign out"))
        )
      );
      return;
    }

    const name = h("input", { id: "ra-name", type: "text", autocomplete: "name", required: true, value: (state.user.name || "").trim() });
    const stations = stationPicker([], "Stations you work at", true);
    const job = h("input", { id: "ra-job", type: "text", placeholder: "e.g. ramp agent, operations officer" });
    const message = h("textarea", { id: "ra-message", rows: "3", placeholder: "Anything that helps management recognise you" });
    const status = h("p", { class: "status", role: "status" });
    const submit = h("button", { class: "btn", type: "submit" }, "Request access");

    root.replaceChildren(
      h(
        "div",
        { class: "signin" },
        h("img", { class: "signin-logo", src: "logo.svg", alt: cfg.companyName, width: "260", height: "85" }),
        h(
          "div",
          { class: "signin-card" },
          h("div", { class: "signin-head" }, h("h1", null, "Request access")),
          h("p", null, `You’re signed in as ${state.user.email}, which hasn’t been given access yet. Send a request and management will review it.`),
          latest && latest.status === "declined"
            ? h("p", { class: "notice" }, "Your last request was declined. Contact management if you think that was a mistake.")
            : null,
          h(
            "form",
            {
              onsubmit: async function (e) {
                e.preventDefault();
                if (!name.value.trim()) { setStatus(status, "Enter your full name.", true); name.focus(); return; }
                submit.disabled = true;
                setStatus(status, "Sending…");
                const ins = await db.from("access_requests").insert({
                  user_id: state.user.id,
                  email: state.user.email,
                  full_name: name.value.trim(),
                  station_codes: stations.values(),
                  job: job.value.trim() || null,
                  message: message.value.trim() || null
                }).select("id").single();
                if (ins.error) {
                  submit.disabled = false;
                  setStatus(status, /duplicate|one_pending/i.test(ins.error.message) ? "You’ve already sent a request." : ins.error.message, true);
                  return;
                }
                try {
                  await fetch("/api/access-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ins.data.id }) });
                } catch (err) {
                  // management is still emailed by the 10-minute check
                }
                renderRequestAccess(true);
              }
            },
            h("div", { class: "field" }, h("label", { for: "ra-name" }, "Full name"), name),
            h("div", { class: "field" }, h("span", { class: "field-label" }, "Stations you work at"), stations.node),
            h("div", { class: "field" }, h("label", { for: "ra-job" }, "Job"), job),
            h("div", { class: "field" }, h("label", { for: "ra-message" }, "Message (optional)"), message),
            submit
          ),
          status,
          signOutButton("Sign out")
        )
      )
    );
    name.focus();
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function render() {
    if (!state.user) {
      root.replaceChildren(renderSignIn());
      document.title = `Sign in – ${cfg.portalName} – ${cfg.companyName}`;
      return;
    }

    if (!state.profile) {
      root.replaceChildren(
        messageScreen(
          "Your account is being set up",
          "Reload the page in a moment. If this message stays, ask management to check your access.",
          signOutButton()
        )
      );
      return;
    }

    if (!state.profile.active) {
      root.replaceChildren(
        messageScreen(
          "Your access is paused",
          "Contact management if you need access to the staff portal.",
          signOutButton()
        )
      );
      return;
    }

    const allowed = MODULES.filter((m) => m.roles.indexOf(state.profile.role) !== -1);
    const route = currentRoute();
    const mod = allowed.find((m) => m.id === route) || allowed[0];
    if (mod.id !== route) history.replaceState(null, "", "#/" + mod.id);

    const main = h("main", { class: "main", id: "main", tabindex: "-1" });
    root.replaceChildren(renderShell(mod, allowed, main));
    document.title = `${mod.title} – ${cfg.portalName} – ${cfg.companyName}`;

    Promise.resolve(mod.render(main)).catch(function (err) {
      fill(main, pageHead(mod.title), h("p", { class: "status is-error" }, "This page couldn’t load: " + err.message));
    });
  }

  function renderShell(activeModule, modules, main) {
    const myStations = state.profile.station_codes || [];
    const activeStations = state.stations.filter((s) => s.active);

    const board = h(
      "ul",
      { class: "station-board", "aria-label": "Stations" },
      activeStations.map((s) =>
        h(
          "li",
          {
            class: "plate" + (myStations.indexOf(s.code) !== -1 ? " is-home" : ""),
            title: myStations.indexOf(s.code) !== -1 ? `${s.name} – your station` : s.name
          },
          s.code
        )
      )
    );

    const nav = h(
      "nav",
      { class: "sidenav", "aria-label": "Portal sections" },
      h(
        "ul",
        null,
        modules.map((m) =>
          h(
            "li",
            null,
            h("a", { href: "#/" + m.id, "aria-current": m.id === activeModule.id ? "page" : null }, m.title)
          )
        )
      )
    );

    const topbar = h(
      "header",
      { class: "topbar" },
      h(
        "a",
        { class: "brand", href: "#/home", "aria-label": `${cfg.companyName} ${cfg.portalName} – Home` },
        h("img", { class: "brand-logo", src: "logo.svg", alt: cfg.companyName, width: "122", height: "40" }),
        h("span", { class: "brand-portal" }, cfg.portalName)
      ),
      board,
      h(
        "div",
        { class: "user-menu" },
        h("span", { class: "user-name" }, displayName(), h("span", { class: "user-role" }, ROLE_LABELS[state.profile.role])),
        signOutButton()
      )
    );

    return h("div", { class: "shell" }, topbar, nav, main);
  }

  // ---------- Sign-in ----------

  // The sign-in step is remembered for 10 minutes, so switching to the email
  // app to read the code (which often reloads the page on phones) doesn't
  // send people back to the start.
  function saveSignin() {
    const SIGNIN_KEY = "iaa-portal-signin";
    try {
      if (state.signin.step === "code") localStorage.setItem(SIGNIN_KEY, JSON.stringify({ email: state.signin.email, at: Date.now() }));
      else localStorage.removeItem(SIGNIN_KEY);
    } catch (e) { /* storage off */ }
  }
  function restoreSignin() {
    const SIGNIN_KEY = "iaa-portal-signin";
    try {
      const saved = JSON.parse(localStorage.getItem(SIGNIN_KEY) || "null");
      if (saved && saved.email && Date.now() - saved.at < 10 * 60000) {
        state.signin = { step: "code", email: saved.email };
        return true;
      }
      localStorage.removeItem(SIGNIN_KEY);
    } catch (e) { /* storage off */ }
    return false;
  }

  function renderSignIn() {
    const methods = Array.isArray(cfg.signInMethods) && cfg.signInMethods.length ? cfg.signInMethods : ["email"];
    const status = h("p", { class: "status", role: "status" });
    if (state.message) {
      setStatus(status, state.message.text, state.message.isError, !state.message.isError);
      state.message = null;
    }

    const parts = [];

    if (methods.indexOf("google") !== -1 && state.signin.step === "email") {
      parts.push(
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async function (e) {
              e.currentTarget.disabled = true;
              const { error } = await db.auth.signIn.social({ provider: "google", callbackURL: redirectUrl() });
              if (error) {
                e.currentTarget.disabled = false;
                setStatus(status, error.message, true);
              }
            }
          },
          "Sign in with Google"
        )
      );
      if (methods.indexOf("email") !== -1) parts.push(h("p", { class: "divider" }, "or"));
    }

    if (methods.indexOf("email") !== -1) {
      parts.push(state.signin.step === "code" ? codeForm(status) : emailForm(status, methods.indexOf("google") !== -1));
    }

    return h(
      "div",
      { class: "signin" },
      h("img", { class: "signin-logo", src: "logo.svg", alt: cfg.companyName, width: "260", height: "85" }),
      h(
        "div",
        { class: "signin-card" },
        h("div", { class: "signin-head" }, h("h1", null, cfg.portalName)),
        h("p", null, "Training, reports and station information for Iceland Aero Agents staff. Sign in with the email address management invited."),
        parts,
        status
      )
    );
  }

  function emailForm(status, quiet) {
    const email = h("input", {
      id: "signin-email",
      type: "email",
      name: "email",
      autocomplete: "email",
      required: true,
      placeholder: "you@example.com",
      value: state.signin.email
    });
    const submit = h("button", { class: quiet ? "btn btn-quiet" : "btn", type: "submit" }, "Email me a sign-in code");

    return h(
      "form",
      {
        onsubmit: async function (e) {
          e.preventDefault();
          const address = email.value.trim().toLowerCase();
          if (!address) return;
          submit.disabled = true;
          setStatus(status, "Sending…");
          const { error } = await db.auth.emailOtp.sendVerificationOtp({ email: address, type: "sign-in" });
          submit.disabled = false;
          if (error) {
            setStatus(status, friendlyAuthError(error), true);
            return;
          }
          state.signin = { step: "code", email: address };
          saveSignin();
          state.message = { text: `We sent a 6-digit code to ${address}. It can take a minute to arrive.`, isError: false };
          render();
        }
      },
      h("div", { class: "field" }, h("label", { for: "signin-email" }, "Email"), email),
      submit
    );
  }

  function codeForm(status) {
    const code = h("input", {
      id: "signin-code",
      type: "text",
      name: "one-time-code",
      inputmode: "numeric",
      autocomplete: "one-time-code",
      required: true,
      maxlength: "10",
      placeholder: "123456"
    });
    const submit = h("button", { class: "btn", type: "submit" }, "Sign in");

    const resend = h(
      "button",
      {
        class: "btn btn-quiet btn-small",
        type: "button",
        onclick: async function () {
          resend.disabled = true;
          const { error } = await db.auth.emailOtp.sendVerificationOtp({ email: state.signin.email, type: "sign-in" });
          resend.disabled = false;
          if (error) setStatus(status, friendlyAuthError(error), true);
          else setStatus(status, "We sent a new code. Use the newest email.", false, true);
        }
      },
      "Send a new code"
    );

    const back = h(
      "button",
      {
        class: "btn btn-quiet btn-small",
        type: "button",
        onclick: function () {
          state.signin = { step: "email", email: state.signin.email };
          saveSignin();
          render();
        }
      },
      "Use a different email"
    );

    setTimeout(function () { code.focus(); }, 0);

    return h(
      "form",
      {
        onsubmit: async function (e) {
          e.preventDefault();
          const otp = code.value.replace(/\s+/g, "");
          if (!otp) return;
          submit.disabled = true;
          setStatus(status, "Checking the code…");
          const { error } = await db.auth.signIn.emailOtp({ email: state.signin.email, otp: otp });
          submit.disabled = false;
          if (error) {
            setStatus(status, friendlyAuthError(error), true);
            return;
          }
          const address = state.signin.email;
          state.signin = { step: "email", email: "" };
          saveSignin();
          await refreshSession();
          if (!state.user) {
            // The code was accepted but the browser didn't keep the sign-in.
            state.signin = { step: "email", email: address };
            state.message = {
              text: "Your code was correct, but this browser didn’t keep you signed in. This usually happens inside an email or social app. Open the portal in Safari or Chrome and sign in again.",
              isError: true
            };
            render();
          }
        }
      },
      h("div", { class: "field" }, h("label", { for: "signin-code" }, "Code from the email"), code),
      h("p", { class: "fineprint" }, "Use the code from the newest email: asking for a new code cancels the old one."),
      submit,
      h("div", { class: "row" }, resend, back)
    );
  }

  // ---------- Home ----------

  async function renderHome(main) {
    const p = state.profile;
    const myStations = (p.station_codes || []).map((code) => {
      const st = state.stations.find((s) => s.code === code);
      return st ? `${st.code} – ${st.name}` : code;
    });
    const sections = MODULES.filter((m) => m.id !== "home" && m.roles.indexOf(p.role) !== -1);

    const nameInput = h("input", { id: "my-name", type: "text", autocomplete: "name", value: p.full_name || "" });
    const titleInput = h("input", { id: "my-title", type: "text", autocomplete: "organization-title", value: p.job_title || "", placeholder: "e.g. Operations Officer" });
    const nameStatus = h("p", { class: "status", role: "status" });
    const nameSave = h("button", { class: "btn", type: "submit" }, "Save details");

    let latest = null;
    let roster = null;
    let attention = null;
    const rerenderHome = function () { renderHome(main); };
    await Promise.all([
      (async function () { if (window.IAABriefings) { try { latest = await window.IAABriefings.homePanel(sectionCtx()); } catch (e) { latest = null; } } })(),
      (async function () { if (window.IAARoster) { try { roster = await window.IAARoster.homePanel(sectionCtx(), rerenderHome); } catch (e) { roster = null; } } })(),
      (async function () { attention = await attentionPanel(); })()
    ]);

    fill(
      main,
      pageHead("Hello, " + firstName(), "Here’s what you can do in the staff portal."),
      attention,
      roster,
      latest,

      !myStations.length
        ? h("p", { class: "notice" }, "You haven’t been given a station yet. Management will add you to one.")
        : null,

      h(
        "section",
        { class: "panel", "aria-labelledby": "sections-h" },
        h("h2", { id: "sections-h" }, "Sections"),
        h(
          "ul",
          { class: "section-list" },
          sections.map((m) =>
            h(
              "li",
              null,
              h(
                "a",
                { href: "#/" + m.id },
                h("span", { class: "section-title" }, m.title),
                h("span", { class: "section-desc" }, m.description)
              )
            )
          )
        )
      ),

      h(
        "section",
        { class: "panel", "aria-labelledby": "me-h" },
        h("h2", { id: "me-h" }, "Your details"),
        h(
          "dl",
          { class: "facts" },
          h("dt", null, "Email"), h("dd", null, p.email),
          h("dt", null, "Role"), h("dd", null, ROLE_LABELS[p.role]),
          h("dt", null, myStations.length > 1 ? "Stations" : "Station"), h("dd", null, myStations.length ? myStations.join(", ") : "Not assigned")
        ),
        p.role === "management"
          ? h("p", { class: "fineprint" }, "Your name and job title are printed on the training certificates you sign off.")
          : null,
        h(
          "form",
          {
            class: "row",
            onsubmit: async function (e) {
              e.preventDefault();
              const name = nameInput.value.trim();
              const title = titleInput.value.trim();
              nameSave.disabled = true;
              const { error } = await db.from("profiles").update({ full_name: name || null, job_title: title || null }).eq("id", p.id);
              nameSave.disabled = false;
              if (error) {
                setStatus(nameStatus, error.message, true);
              } else {
                state.profile.full_name = name || null;
                state.profile.job_title = title || null;
                setStatus(nameStatus, "Details saved.", false, true);
              }
            }
          },
          h("div", { class: "field" }, h("label", { for: "my-name" }, "Your name"), nameInput),
          h("div", { class: "field" }, h("label", { for: "my-title" }, "Job title"), titleInput),
          nameSave
        ),
        nameStatus
      )
    );
  }

  // Shared helpers handed to the section files (training.js, reports.js, briefings.js).
  function sectionCtx() {
    return { db: db, state: state, h: h, fill: fill, pageHead: pageHead, setStatus: setStatus, logEvent: logEvent };
  }

  function sectionMissing(main, title) {
    fill(main, pageHead(title), h("p", { class: "notice" }, "This section’s files didn’t load. Reload the page."));
  }

  async function renderRoster(main) {
    if (!window.IAARoster || !window.IAARosterParse) return sectionMissing(main, "Roster");
    return window.IAARoster.render(main, sectionCtx());
  }

  async function renderPasses(main) {
    if (!window.IAAPasses) return sectionMissing(main, "Passes & certificates");
    return window.IAAPasses.render(main, sectionCtx());
  }

  async function renderRequests(main) {
    if (!window.IAARequests) return sectionMissing(main, "Requests");
    return window.IAARequests.render(main, sectionCtx());
  }

  // Management: one line per thing waiting for them.
  async function attentionPanel() {
    if (state.profile.role !== "management") return null;
    const items = [];
    try {
      const [acc, req, exp] = await Promise.all([
        db.from("access_requests").select("id").eq("status", "pending"),
        window.IAARequests ? window.IAARequests.counts(sectionCtx()) : Promise.resolve(null),
        window.IAAPasses ? window.IAAPasses.expiringCount(sectionCtx()) : Promise.resolve(0)
      ]);
      const nAcc = (acc.data || []).length;
      if (nAcc) items.push(["#/people", `${nAcc} access ${nAcc === 1 ? "request" : "requests"} to approve`]);
      if (req && req.leave) items.push(["#/requests/leave", `${req.leave} leave ${req.leave === 1 ? "request" : "requests"} waiting`]);
      if (req && req.urgent) items.push(["#/requests/service", `${req.urgent} urgent or vehicle defect ${req.urgent === 1 ? "request" : "requests"} open`]);
      else if (req && req.service) items.push(["#/requests/service", `${req.service} open stock, equipment or defect ${req.service === 1 ? "request" : "requests"}`]);
      if (exp) items.push(["#/passes", `${exp} ${exp === 1 ? "pass or certificate" : "passes or certificates"} expired or expiring within 30 days`]);
    } catch (e) {
      return null;
    }
    if (!items.length) return null;
    return h("section", { class: "panel panel-attention", "aria-labelledby": "attn-h" },
      h("h2", { id: "attn-h" }, "Needs attention"),
      h("ul", { class: "attention-list" }, items.map((i) => h("li", null, h("a", { href: i[0] }, i[1])))));
  }

  // ---------- Briefings (briefings.js) ----------

  async function renderBriefings(main) {
    if (!window.IAABriefings || !window.IAABriefingConvert) {
      fill(main, pageHead("Briefings"), h("p", { class: "notice" }, "The briefing files didn’t load. Reload the page."));
      return;
    }
    return window.IAABriefings.render(main, sectionCtx());
  }

  // ---------- Training (training.js) ----------

  async function renderTraining(main) {
    if (!window.IAATraining || !window.TRAINING) {
      fill(main, pageHead("Training"), h("p", { class: "notice" }, "The training files didn’t load. Reload the page."));
      return;
    }
    return window.IAATraining.render(main, {
      db: db,
      state: state,
      h: h,
      fill: fill,
      pageHead: pageHead,
      setStatus: setStatus,
      logEvent: logEvent
    });
  }

  // ---------- Reports (reports.js) ----------

  async function renderReports(main) {
    if (!window.IAAReports) {
      fill(main, pageHead("Reports"), h("p", { class: "notice" }, "The reports files didn’t load. Reload the page."));
      return;
    }
    return window.IAAReports.render(main, {
      db: db,
      state: state,
      h: h,
      fill: fill,
      pageHead: pageHead,
      setStatus: setStatus,
      logEvent: logEvent
    });
  }

  // ---------- People (management) ----------

  async function renderPeople(main) {
    fill(main, pageHead("People", "Give staff access and set their role and station."), h("p", { class: "empty" }, "Loading staff…"));

    const [peopleRes, invitesRes, requestsRes] = await Promise.all([
      db.from("profiles").select("*").order("full_name", { nullsFirst: false }).order("email"),
      db.from("invitations").select("*").is("accepted_at", null).order("created_at", { ascending: false }),
      db.from("access_requests").select("*").eq("status", "pending").order("created_at")
    ]);
    const requests = requestsRes.error ? [] : (requestsRes.data || []);
    if (peopleRes.error) throw peopleRes.error;
    if (invitesRes.error) throw invitesRes.error;
    const data = peopleRes.data || [];
    const invites = invitesRes.data || [];

    const status = h("p", { class: "status", role: "status" });

    const rows = data.map(function (person) {
      const isMe = person.id === state.profile.id;
      const label = person.full_name || person.email;

      const role = h(
        "select",
        { "aria-label": "Role for " + label },
        ALL_ROLES.map((r) => h("option", { value: r, selected: r === person.role }, ROLE_LABELS[r]))
      );

      const station = stationPicker(person.station_codes || [], "Stations for " + label);

      const active = h("input", { type: "checkbox", checked: person.active, disabled: isMe, "aria-label": "Access for " + label });

      const save = h(
        "button",
        {
          class: "btn btn-small",
          type: "button",
          onclick: async function () {
            if (isMe && role.value !== "management" && !confirm("You’re removing your own management access. Continue?")) {
              return;
            }
            const changes = { role: role.value, station_codes: station.values(), active: active.checked };
            save.disabled = true;
            const { error: upErr } = await db.from("profiles").update(changes).eq("id", person.id);
            save.disabled = false;
            if (upErr) {
              setStatus(status, upErr.message, true);
              return;
            }
            await logEvent("profile_updated", {
              profile_id: person.id,
              email: person.email,
              before: { role: person.role, station_codes: person.station_codes, active: person.active },
              after: changes
            });
            Object.assign(person, changes);
            setStatus(status, `Saved changes for ${label}.`, false, true);
            if (isMe) loadAndRender();
          }
        },
        "Save"
      );

      return h(
        "tr",
        null,
        h("td", null, person.full_name || "No name yet", h("span", { class: "sub" }, person.email)),
        h("td", null, role),
        h("td", null, station.node),
        h("td", null, active),
        h("td", null, save)
      );
    });

    fill(
      main,
      pageHead("People", "Give staff access and set their role and station."),
      requests.length ? renderRequestsPanel(requests) : null,
      renderInvitePanel(data, invites),
      h(
        "section",
        { class: "panel", "aria-labelledby": "staff-h" },
        h("h2", { id: "staff-h" }, "Staff with access"),
        rows.length
          ? h(
              "div",
              { class: "table-wrap" },
              h(
                "table",
                null,
                h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Role"), h("th", null, "Stations"), h("th", null, "Access"), h("th", null, ""))),
                h("tbody", null, rows)
              )
            )
          : h("p", { class: "empty" }, "No one has signed in yet. Invite staff above, then share the portal address with them."),
        status
      )
    );
  }

  function renderRequestsPanel(requests) {
    const status = h("p", { class: "status", role: "status" });
    const rows = requests.map(function (r) {
      const role = h("select", { "aria-label": "Role for " + r.full_name }, ALL_ROLES.map((x) => h("option", { value: x, selected: x === "staff" }, ROLE_LABELS[x])));
      const stations = stationPicker(r.station_codes || [], "Stations for " + r.full_name, true);
      const approve = h("button", {
        class: "btn btn-small",
        type: "button",
        onclick: async function () {
          approve.disabled = true;
          const { error } = await db.rpc("approve_access_request", { p_id: r.id, p_role: role.value, p_stations: stations.values() });
          if (error) { approve.disabled = false; setStatus(status, error.message, true); return; }
          try {
            await fetch("/api/access-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) });
          } catch (err) {
            // the 10-minute check sends the approval email
          }
          render();
        }
      }, "Approve");
      const decline = h("button", {
        class: "btn btn-quiet btn-small",
        type: "button",
        onclick: async function () {
          if (!confirm(`Decline the request from ${r.full_name} (${r.email})?`)) return;
          decline.disabled = true;
          const { error } = await db.rpc("decline_access_request", { p_id: r.id });
          if (error) { decline.disabled = false; setStatus(status, error.message, true); return; }
          render();
        }
      }, "Decline");
      return h(
        "tr",
        null,
        h("td", null, r.full_name, h("span", { class: "sub" }, r.email),
          r.job ? h("span", { class: "sub" }, r.job) : null,
          r.message ? h("span", { class: "sub request-message" }, "“" + r.message + "”") : null,
          h("span", { class: "sub" }, "Asked " + new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))),
        h("td", null, role),
        h("td", null, stations.node),
        h("td", null, h("div", { class: "row row-tight" }, approve, decline))
      );
    });

    return h(
      "section",
      { class: "panel panel-attention", "aria-labelledby": "requests-h" },
      h("h2", { id: "requests-h" }, `Access requests: ${requests.length}`),
      h("p", null, "These people signed in with a verified email address and asked for access. Only approve people you know work for Iceland Aero Agents. They’re emailed when you approve them."),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, h("th", null, "Person"), h("th", null, "Role"), h("th", null, "Stations"), h("th", null, ""))),
          h("tbody", null, rows)
        )
      ),
      status
    );
  }

  let inviteNotice = null;   // one-off message shown after inviting or resending

  function sendInvite(address) {
    return fetch("/api/staff-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "invite", email: address })
    })
      .then((r) => r.json())
      .then((j) => ((j.results || [])[0] || {}).status === "sent")
      .catch(() => false);
  }

  function inviteTime(v) {
    return new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function renderInvitePanel(people, invites) {
    const email = h("input", { id: "invite-email", type: "email", required: true, autocomplete: "off", placeholder: "name@gmail.com" });
    const name = h("input", { id: "invite-name", type: "text", autocomplete: "off", placeholder: "Full name" });
    const role = h(
      "select",
      { id: "invite-role" },
      ALL_ROLES.map((r) => h("option", { value: r, selected: r === "staff" }, ROLE_LABELS[r]))
    );
    const station = stationPicker([], "Stations for the new person", true);
    const addBtn = h("button", { class: "btn", type: "submit" }, "Invite");
    const status = h("p", { class: "status", role: "status" });

    const pending = invites.map(function (inv) {
      const resend = h(
        "button",
        {
          class: "btn btn-quiet btn-small",
          type: "button",
          onclick: async function () {
            resend.disabled = true;
            const { error } = await db.from("invitations")
              .update({ invite_sent_at: null, invite_error: null, invite_attempts: 0, invite_claimed_at: null })
              .eq("email", inv.email);
            if (error) { resend.disabled = false; setStatus(status, error.message, true); return; }
            const ok = await sendInvite(inv.email);
            await logEvent("invitation_resent", { email: inv.email });
            inviteNotice = ok
              ? { text: `Invitation emailed again to ${inv.email}.` }
              : { text: `The invitation to ${inv.email} couldn’t be sent just now. It will be retried within 10 minutes.`, isError: true };
            render();
          }
        },
        inv.invite_sent_at ? "Resend invite" : "Send invite"
      );
      const emailState = inv.invite_sent_at
        ? h("span", { class: "sub" }, "Emailed " + inviteTime(inv.invite_sent_at))
        : inv.invite_error
          ? h("span", { class: "sub is-error" }, "Not sent: " + inv.invite_error)
          : h("span", { class: "sub" }, "Sending…");
      const cancel = h(
        "button",
        {
          class: "btn btn-quiet btn-small",
          type: "button",
          onclick: async function () {
            if (!confirm(`Cancel the invitation for ${inv.email}?`)) return;
            cancel.disabled = true;
            const { error } = await db.from("invitations").delete().eq("email", inv.email);
            cancel.disabled = false;
            if (error) {
              setStatus(status, error.message, true);
              return;
            }
            await logEvent("invitation_cancelled", { email: inv.email });
            render();
          }
        },
        "Cancel invitation"
      );
      return h(
        "tr",
        null,
        h("td", null, inv.full_name || "No name given", h("span", { class: "sub" }, inv.email)),
        h("td", null, ROLE_LABELS[inv.role]),
        h("td", null, (inv.station_codes || []).join(", ") || "None"),
        h("td", null, emailState),
        h("td", null, h("div", { class: "row row-tight" }, resend, cancel))
      );
    });

    return h(
      "section",
      { class: "panel", "aria-labelledby": "invite-h" },
      h("h2", { id: "invite-h" }, "Invite staff"),
      h(
        "p",
        null,
        "Add the email address the person will sign in with. Personal addresses are fine. They are emailed an invitation with the portal link and how to sign in. Anyone with an @iaa.is address can also sign in without an invitation, as Staff with no station."
      ),
      h(
        "form",
        {
          class: "row",
          onsubmit: async function (e) {
            e.preventDefault();
            const address = email.value.trim().toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
              setStatus(status, "Enter a full email address, for example name@gmail.com.", true);
              return;
            }
            if (people.some((p) => p.email === address)) {
              setStatus(status, `${address} already has access. Change their role or station in the list below.`, true);
              return;
            }
            const invite = {
              email: address,
              full_name: name.value.trim() || null,
              role: role.value,
              station_codes: station.values()
            };
            addBtn.disabled = true;
            const { error } = await db.from("invitations").insert(invite);
            addBtn.disabled = false;
            if (error) {
              setStatus(status, error.code === "23505" ? `${address} has already been invited.` : error.message, true);
              return;
            }
            await logEvent("invitation_created", invite);
            const ok = await sendInvite(address);
            inviteNotice = ok
              ? { text: `Invitation emailed to ${address}.` }
              : { text: `${address} has been invited, but the email couldn’t be sent just now. It will be retried within 10 minutes.`, isError: true };
            render();
          }
        },
        h("div", { class: "field" }, h("label", { for: "invite-email" }, "Email"), email),
        h("div", { class: "field" }, h("label", { for: "invite-name" }, "Name"), name),
        h("div", { class: "field" }, h("label", { for: "invite-role" }, "Role"), role),
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Stations"), station.node),
        addBtn
      ),
      status,
      (function () {
        if (!inviteNotice) return null;
        const n = h("p", { class: inviteNotice.isError ? "notice is-error" : "notice" }, inviteNotice.text);
        inviteNotice = null;
        return n;
      })(),
      pending.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("caption", { class: "caption" }, "Waiting to sign in"),
              h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Role"), h("th", null, "Stations"), h("th", null, "Invitation email"), h("th", null, ""))),
              h("tbody", null, pending)
            )
          )
        : null
    );
  }

  // ---------- Stations (management) ----------

  async function renderStations(main) {
    const status = h("p", { class: "status", role: "status" });

    const rows = state.stations.map(function (s) {
      const name = h("input", { type: "text", value: s.name, "aria-label": "Name for " + s.code });
      const order = h("input", { type: "number", value: String(s.sort_order), "aria-label": "Order for " + s.code, min: "0", step: "10" });
      const active = h("input", { type: "checkbox", checked: s.active, "aria-label": s.code + " active" });
      const save = h(
        "button",
        {
          class: "btn btn-small",
          type: "button",
          onclick: async function () {
            const changes = { name: name.value.trim() || s.name, sort_order: parseInt(order.value, 10) || 0, active: active.checked };
            save.disabled = true;
            const { error } = await db.from("stations").update(changes).eq("code", s.code);
            save.disabled = false;
            if (error) {
              setStatus(status, error.message, true);
              return;
            }
            await logEvent("station_updated", { code: s.code, before: { name: s.name, sort_order: s.sort_order, active: s.active }, after: changes });
            Object.assign(s, changes);
            render();
          }
        },
        "Save"
      );
      return h("tr", null, h("td", { class: "code" }, s.code), h("td", null, name), h("td", null, order), h("td", null, active), h("td", null, save));
    });

    const newCode = h("input", { id: "new-code", type: "text", maxlength: "4", placeholder: "BIEG", autocomplete: "off" });
    const newName = h("input", { id: "new-name", type: "text", placeholder: "Egilsstaðir" });
    const addStatus = h("p", { class: "status", role: "status" });
    const addBtn = h("button", { class: "btn", type: "submit" }, "Add station");

    fill(
      main,
      pageHead("Stations", "Add stations and choose which ones are active."),
      h(
        "section",
        { class: "panel" },
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, h("th", null, "Code"), h("th", null, "Name"), h("th", null, "Order"), h("th", null, "Active"), h("th", null, ""))),
            h("tbody", null, rows)
          )
        ),
        status
      ),
      h(
        "section",
        { class: "panel", "aria-labelledby": "add-h" },
        h("h2", { id: "add-h" }, "Add a station"),
        h(
          "form",
          {
            class: "row",
            onsubmit: async function (e) {
              e.preventDefault();
              const code = newCode.value.trim().toUpperCase();
              const name = newName.value.trim();
              if (!/^[A-Z]{4}$/.test(code)) {
                setStatus(addStatus, "Enter the four-letter ICAO code, for example BIEG.", true);
                return;
              }
              if (!name) {
                setStatus(addStatus, "Enter the station name.", true);
                return;
              }
              addBtn.disabled = true;
              const sortOrder = state.stations.reduce((max, s) => Math.max(max, s.sort_order), 0) + 10;
              const { data, error } = await db.from("stations").insert({ code: code, name: name, sort_order: sortOrder }).select().single();
              addBtn.disabled = false;
              if (error) {
                setStatus(addStatus, error.code === "23505" ? `${code} already exists.` : error.message, true);
                return;
              }
              await logEvent("station_added", { code: code, name: name });
              state.stations.push(data);
              render();
            }
          },
          h("div", { class: "field" }, h("label", { for: "new-code" }, "ICAO code"), newCode),
          h("div", { class: "field" }, h("label", { for: "new-name" }, "Name"), newName),
          addBtn
        ),
        addStatus
      )
    );
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  // Builds DOM elements safely: text is never interpreted as HTML.
  function h(tag, props) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        const value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = value;
        else if (key.indexOf("on") === 0 && typeof value === "function") node.addEventListener(key.slice(2), value);
        else if (key === "value") node.value = value;
        else if (key === "checked") node.checked = !!value;
        else if (key === "selected") { node.setAttribute("selected", ""); node.selected = true; }
        else node.setAttribute(key, value === true ? "" : value);
      });
    }
    appendChildren(node, Array.prototype.slice.call(arguments, 2));
    return node;
  }

  function appendChildren(node, children) {
    children.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) appendChildren(node, child);
      else node.append(child instanceof Node ? child : String(child));
    });
  }

  // A row of tick boxes, one per station. Inactive stations only show
  // when the person already has them (or when hideInactive is false).
  function stationPicker(selected, label, hideInactive) {
    const boxes = [];
    const group = h(
      "div",
      { class: "station-picks", role: "group", "aria-label": label },
      state.stations
        .filter((s) => s.active || (!hideInactive && selected.indexOf(s.code) !== -1))
        .map(function (s) {
          const box = h("input", { type: "checkbox", value: s.code, checked: selected.indexOf(s.code) !== -1 });
          boxes.push(box);
          return h("label", { class: "station-pick", title: s.name }, box, h("span", null, s.active ? s.code : s.code + " (inactive)"));
        })
    );
    return {
      node: group,
      values: function () { return boxes.filter((b) => b.checked).map((b) => b.value); }
    };
  }

  // Replaces a container's content, skipping empty (null) entries.
  function fill(node) {
    node.replaceChildren();
    appendChildren(node, Array.prototype.slice.call(arguments, 1));
  }

  function pageHead(title, intro) {
    return h("div", { class: "page-head" }, h("h1", null, title), intro ? h("p", null, intro) : null);
  }

  function messageScreen(title, text) {
    const extras = Array.prototype.slice.call(arguments, 2);
    return h(
      "div",
      { class: "signin" },
      h("img", { class: "signin-logo", src: "logo.svg", alt: cfg.companyName || "Iceland Aero Agents", width: "260", height: "85" }),
      h(
        "div",
        { class: "signin-card" },
        h("div", { class: "signin-head" }, h("h1", null, title)),
        h("p", null, text),
        extras
      )
    );
  }

  function signOutButton(label) {
    return h(
      "button",
      {
        class: "btn btn-quiet btn-small",
        type: "button",
        onclick: async function () {
          try {
            await db.auth.signOut();
          } catch (err) {
            console.warn("Sign-out failed:", err);
          }
          state.user = null;
          state.profile = null;
          state.signin = { step: "email", email: "" };
          history.replaceState(null, "", location.pathname + "#/home");
          render();
        }
      },
      label || "Sign out"
    );
  }

  function setStatus(node, text, isError, isOk) {
    node.textContent = text;
    node.className = "status" + (isError ? " is-error" : "") + (isOk ? " is-ok" : "");
  }

  async function logEvent(action, details) {
    // actor_id is filled in by the database from the sign-in token.
    const { error } = await db.from("audit_log").insert({ action: action, details: details || {} });
    if (error) console.warn("Audit log entry failed:", error.message);
  }

  function sessionUser(res) {
    const data = res && res.data;
    if (!data) return null;
    if (data.user) return data.user;
    if (data.session && data.session.user) return data.session.user;
    return null;
  }

  function currentRoute() {
    const match = location.hash.match(/^#\/([a-z-]+)/);
    return match ? match[1] : "home";
  }

  function redirectUrl() {
    return location.origin + location.pathname;
  }

  // Google sign-in sends people back with ?error=... if something failed.
  function readReturnErrorFromUrl() {
    const params = new URLSearchParams(location.search);
    const err = params.get("error");
    if (!err) return;
    state.message = { text: "Sign-in didn’t complete (" + err.replace(/_/g, " ") + "). Try again.", isError: true };
    history.replaceState(null, "", location.pathname + location.hash);
  }

  function friendlyAuthError(error) {
    const code = (error && (error.code || error.status)) || "";
    const message = (error && error.message) || "";
    if (/TOO_MANY_ATTEMPTS/i.test(code) || /too many/i.test(message)) {
      return "Too many attempts. Request a new code and try again.";
    }
    if (/INVALID_OTP|OTP_EXPIRED/i.test(code) || /invalid otp|expired/i.test(message)) {
      return "That code is wrong or has expired. Check the newest email, or request a new code.";
    }
    if (code === 429 || /rate limit/i.test(message)) {
      return "Too many sign-in emails were sent. Wait a few minutes and try again.";
    }
    return message || "Something went wrong. Try again.";
  }

  function displayName() {
    return state.profile.full_name || state.profile.email;
  }

  function firstName() {
    if (state.profile.full_name) return state.profile.full_name.split(" ")[0];
    return state.profile.email.split("@")[0];
  }
})();
