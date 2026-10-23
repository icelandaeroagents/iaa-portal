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
      id: "training",
      title: "Training",
      description: "Your courses, quizzes and certificates.",
      roles: ALL_ROLES,
      render: renderTraining
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
        root.replaceChildren(
          messageScreen(
            "You don’t have access yet",
            `${state.user.email} hasn’t been invited to the staff portal. Ask management to invite this email address, then sign in again.`,
            signOutButton("Sign out")
          )
        );
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
    const homeStation = state.profile.station_code;
    const activeStations = state.stations.filter((s) => s.active);

    const board = h(
      "ul",
      { class: "station-board", "aria-label": "Stations" },
      activeStations.map((s) =>
        h(
          "li",
          {
            class: "plate" + (s.code === homeStation ? " is-home" : ""),
            title: s.code === homeStation ? `${s.name} – your station` : s.name
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
        { class: "brand", href: "#/home" },
        h("span", { class: "brand-company" }, cfg.companyName),
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
      h(
        "div",
        { class: "signin-card" },
        h("div", { class: "signin-head" }, h("span", { class: "brand-company" }, cfg.companyName), h("h1", null, cfg.portalName)),
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
          state.signin = { step: "email", email: "" };
          await refreshSession();
        }
      },
      h("div", { class: "field" }, h("label", { for: "signin-code" }, "Code from the email"), code),
      submit,
      h("div", { class: "row" }, resend, back)
    );
  }

  // ---------- Home ----------

  async function renderHome(main) {
    const p = state.profile;
    const station = state.stations.find((s) => s.code === p.station_code);
    const sections = MODULES.filter((m) => m.id !== "home" && m.roles.indexOf(p.role) !== -1);

    const nameInput = h("input", { id: "my-name", type: "text", autocomplete: "name", value: p.full_name || "" });
    const titleInput = h("input", { id: "my-title", type: "text", autocomplete: "organization-title", value: p.job_title || "", placeholder: "e.g. Operations Officer" });
    const nameStatus = h("p", { class: "status", role: "status" });
    const nameSave = h("button", { class: "btn", type: "submit" }, "Save details");

    fill(
      main,
      pageHead("Hello, " + firstName(), "Here’s what you can do in the staff portal."),

      !p.station_code
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
          h("dt", null, "Station"), h("dd", null, station ? `${station.code} – ${station.name}` : "Not assigned")
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

  // ---------- Reports (placeholder) ----------

  async function renderReports(main) {
    fill(
      main,
      pageHead("Reports", "Submit and follow up internal reports."),
      h("p", { class: "notice" }, "Reporting is being set up and will open here.")
    );
  }

  // ---------- People (management) ----------

  async function renderPeople(main) {
    fill(main, pageHead("People", "Give staff access and set their role and station."), h("p", { class: "empty" }, "Loading staff…"));

    const [peopleRes, invitesRes] = await Promise.all([
      db.from("profiles").select("*").order("full_name", { nullsFirst: false }).order("email"),
      db.from("invitations").select("*").is("accepted_at", null).order("created_at", { ascending: false })
    ]);
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

      const station = h(
        "select",
        { "aria-label": "Station for " + label },
        h("option", { value: "", selected: !person.station_code }, "None"),
        state.stations.map((s) =>
          h("option", { value: s.code, selected: s.code === person.station_code }, s.active ? s.code : s.code + " (inactive)")
        )
      );

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
            const changes = { role: role.value, station_code: station.value || null, active: active.checked };
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
              before: { role: person.role, station_code: person.station_code, active: person.active },
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
        h("td", null, station),
        h("td", null, active),
        h("td", null, save)
      );
    });

    fill(
      main,
      pageHead("People", "Give staff access and set their role and station."),
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
                h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Role"), h("th", null, "Station"), h("th", null, "Access"), h("th", null, ""))),
                h("tbody", null, rows)
              )
            )
          : h("p", { class: "empty" }, "No one has signed in yet. Invite staff above, then share the portal address with them."),
        status
      )
    );
  }

  function renderInvitePanel(people, invites) {
    const email = h("input", { id: "invite-email", type: "email", required: true, autocomplete: "off", placeholder: "name@gmail.com" });
    const name = h("input", { id: "invite-name", type: "text", autocomplete: "off", placeholder: "Full name" });
    const role = h(
      "select",
      { id: "invite-role" },
      ALL_ROLES.map((r) => h("option", { value: r, selected: r === "staff" }, ROLE_LABELS[r]))
    );
    const station = h(
      "select",
      { id: "invite-station" },
      h("option", { value: "", selected: true }, "None"),
      state.stations.filter((s) => s.active).map((s) => h("option", { value: s.code }, s.code))
    );
    const addBtn = h("button", { class: "btn", type: "submit" }, "Invite");
    const status = h("p", { class: "status", role: "status" });

    const pending = invites.map(function (inv) {
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
        h("td", null, inv.station_code || "None"),
        h("td", null, cancel)
      );
    });

    return h(
      "section",
      { class: "panel", "aria-labelledby": "invite-h" },
      h("h2", { id: "invite-h" }, "Invite staff"),
      h(
        "p",
        null,
        "Add the email address the person will sign in with. Personal addresses are fine. This doesn’t send an email: tell them the portal address and to sign in with this address. Anyone with an @iaa.is address can also sign in without an invitation, as Staff with no station."
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
              station_code: station.value || null
            };
            addBtn.disabled = true;
            const { error } = await db.from("invitations").insert(invite);
            addBtn.disabled = false;
            if (error) {
              setStatus(status, error.code === "23505" ? `${address} has already been invited.` : error.message, true);
              return;
            }
            await logEvent("invitation_created", invite);
            render();
          }
        },
        h("div", { class: "field" }, h("label", { for: "invite-email" }, "Email"), email),
        h("div", { class: "field" }, h("label", { for: "invite-name" }, "Name"), name),
        h("div", { class: "field" }, h("label", { for: "invite-role" }, "Role"), role),
        h("div", { class: "field" }, h("label", { for: "invite-station" }, "Station"), station),
        addBtn
      ),
      status,
      pending.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("caption", { class: "caption" }, "Waiting to sign in"),
              h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Role"), h("th", null, "Station"), h("th", null, ""))),
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
      h(
        "div",
        { class: "signin-card" },
        h("div", { class: "signin-head" }, h("span", { class: "brand-company" }, cfg.companyName || "Iceland Aero Agents"), h("h1", null, title)),
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
