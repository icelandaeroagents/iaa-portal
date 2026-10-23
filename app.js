/* Iceland Aero Agents – Staff Portal
   Foundation: sign-in, roles, stations, navigation and admin pages.
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
    session: null,
    profile: null,
    stations: [],
    authMessage: null
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
  if (!cfg.supabaseUrl || cfg.supabaseUrl.indexOf("YOUR-PROJECT") !== -1 || !window.supabase) {
    root.replaceChildren(
      messageScreen(
        "The portal isn’t connected yet",
        "Add the Supabase project URL and key to config.js, then reload this page."
      )
    );
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "implicit"
    }
  });

  init();

  async function init() {
    const authError = readAuthErrorFromUrl();
    const { data } = await sb.auth.getSession();
    cleanAuthFromUrl();

    state.session = data.session;
    if (authError) state.authMessage = authError;

    sb.auth.onAuthStateChange(function (event, session) {
      const wasSignedIn = !!state.session;
      state.session = session;
      if (event === "SIGNED_OUT") {
        state.profile = null;
        render();
      } else if (event === "SIGNED_IN" && !wasSignedIn) {
        // Supabase advises not calling it directly inside this callback.
        setTimeout(loadAndRender, 0);
      }
    });

    window.addEventListener("hashchange", render);
    await loadAndRender();
  }

  async function loadAndRender() {
    if (!state.session) {
      render();
      return;
    }

    root.replaceChildren(h("p", { class: "boot" }, "Loading your details…"));

    const uid = state.session.user.id;
    const [profileRes, stationsRes] = await Promise.all([
      sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
      sb.from("stations").select("*").order("sort_order").order("code")
    ]);

    if (profileRes.error || stationsRes.error) {
      const err = profileRes.error || stationsRes.error;
      root.replaceChildren(
        messageScreen("Your details couldn’t be loaded", err.message, signOutButton())
      );
      return;
    }

    state.profile = profileRes.data;
    state.stations = stationsRes.data || [];
    render();
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function render() {
    if (!state.session) {
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
      fill(main, 
        pageHead(mod.title),
        h("p", { class: "status is-error" }, "This page couldn’t load: " + err.message)
      );
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
            h(
              "a",
              { href: "#/" + m.id, "aria-current": m.id === activeModule.id ? "page" : null },
              m.title
            )
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
        h(
          "span",
          { class: "user-name" },
          displayName(),
          h("span", { class: "user-role" }, ROLE_LABELS[state.profile.role])
        ),
        signOutButton()
      )
    );

    return h("div", { class: "shell" }, topbar, nav, main);
  }

  // ---------- Sign-in ----------

  function renderSignIn() {
    const methods = Array.isArray(cfg.signInMethods) && cfg.signInMethods.length
      ? cfg.signInMethods
      : ["email"];

    const status = h("p", { class: "status", role: "status" });
    if (state.authMessage) {
      status.textContent = state.authMessage;
      status.className = "status is-error";
    }

    const parts = [];

    const oauth = methods.filter((m) => m === "google" || m === "azure");
    oauth.forEach(function (provider) {
      const label = provider === "google" ? "Sign in with Google" : "Sign in with Microsoft";
      parts.push(
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: async function (e) {
              e.currentTarget.disabled = true;
              const options = { redirectTo: redirectUrl() };
              if (provider === "azure") options.scopes = "email";
              const { error } = await sb.auth.signInWithOAuth({ provider: provider, options: options });
              if (error) {
                e.currentTarget.disabled = false;
                setStatus(status, error.message, true);
              }
            }
          },
          label
        )
      );
    });

    if (methods.indexOf("email") !== -1) {
      if (oauth.length) parts.push(h("p", { class: "divider" }, "or"));

      const email = h("input", {
        id: "signin-email",
        type: "email",
        name: "email",
        autocomplete: "email",
        required: true,
        placeholder: "name@iaa.is"
      });
      const submit = h("button", { class: oauth.length ? "btn btn-quiet" : "btn", type: "submit" }, "Email me a sign-in link");

      parts.push(
        h(
          "form",
          {
            onsubmit: async function (e) {
              e.preventDefault();
              const address = email.value.trim();
              if (!address) return;
              submit.disabled = true;
              setStatus(status, "Sending…");
              const { error } = await sb.auth.signInWithOtp({
                email: address,
                options: { emailRedirectTo: redirectUrl() }
              });
              submit.disabled = false;
              if (error) {
                setStatus(status, friendlyAuthError(error.message), true);
              } else {
                setStatus(status, `Check your inbox. We sent a sign-in link to ${address}. The link works once.`, false, true);
              }
            }
          },
          h("div", { class: "field" }, h("label", { for: "signin-email" }, "Work email"), email),
          submit
        )
      );
    }

    return h(
      "div",
      { class: "signin" },
      h(
        "div",
        { class: "signin-card" },
        h(
          "div",
          { class: "signin-head" },
          h("span", { class: "brand-company" }, cfg.companyName),
          h("h1", null, cfg.portalName)
        ),
        h("p", null, "Training, reports and station information for Iceland Aero Agents staff."),
        parts,
        status
      )
    );
  }

  // ---------- Home ----------

  async function renderHome(main) {
    const p = state.profile;
    const station = state.stations.find((s) => s.code === p.station_code);
    const sections = MODULES.filter((m) => m.id !== "home" && m.roles.indexOf(p.role) !== -1);

    const nameInput = h("input", {
      id: "my-name",
      type: "text",
      autocomplete: "name",
      value: p.full_name || ""
    });
    const nameStatus = h("p", { class: "status", role: "status" });
    const nameSave = h("button", { class: "btn", type: "submit" }, "Save name");

    fill(main, 
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
        h(
          "form",
          {
            class: "row",
            onsubmit: async function (e) {
              e.preventDefault();
              const name = nameInput.value.trim();
              nameSave.disabled = true;
              const { error } = await sb.from("profiles").update({ full_name: name || null }).eq("id", p.id);
              nameSave.disabled = false;
              if (error) {
                setStatus(nameStatus, error.message, true);
              } else {
                state.profile.full_name = name || null;
                setStatus(nameStatus, "Name saved.", false, true);
              }
            }
          },
          h("div", { class: "field" }, h("label", { for: "my-name" }, "Your name"), nameInput),
          nameSave
        ),
        nameStatus
      )
    );
  }

  // ---------- Training (placeholder until the migration) ----------

  async function renderTraining(main) {
    fill(main, 
      pageHead("Training", "Your courses, quizzes and certificates."),
      h(
        "p",
        { class: "notice" },
        "Training is moving here soon. Until then, keep using the current training page."
      )
    );
  }

  // ---------- Reports (placeholder) ----------

  async function renderReports(main) {
    fill(main, 
      pageHead("Reports", "Submit and follow up internal reports."),
      h("p", { class: "notice" }, "Reporting is being set up and will open here.")
    );
  }

  // ---------- People (management) ----------

  async function renderPeople(main) {
    fill(main, pageHead("People", "Give staff access and set their role and station."), h("p", { class: "empty" }, "Loading staff…"));

    const { data, error } = await sb.from("profiles").select("*").order("full_name", { nullsFirst: false }).order("email");
    if (error) throw error;

    const status = h("p", { class: "status", role: "status" });

    const rows = (data || []).map(function (person) {
      const isMe = person.id === state.profile.id;

      const role = h(
        "select",
        { "aria-label": "Role for " + (person.full_name || person.email) },
        ALL_ROLES.map((r) => h("option", { value: r, selected: r === person.role }, ROLE_LABELS[r]))
      );

      const station = h(
        "select",
        { "aria-label": "Station for " + (person.full_name || person.email) },
        h("option", { value: "", selected: !person.station_code }, "None"),
        state.stations.map((s) =>
          h("option", { value: s.code, selected: s.code === person.station_code }, s.active ? s.code : s.code + " (inactive)")
        )
      );

      const active = h("input", {
        type: "checkbox",
        checked: person.active,
        disabled: isMe,
        "aria-label": "Access for " + (person.full_name || person.email)
      });

      const save = h(
        "button",
        {
          class: "btn btn-small",
          type: "button",
          onclick: async function () {
            if (isMe && role.value !== "management" && !confirm("You’re removing your own management access. Continue?")) {
              return;
            }
            const changes = {
              role: role.value,
              station_code: station.value || null,
              active: active.checked
            };
            save.disabled = true;
            const { error: upErr } = await sb.from("profiles").update(changes).eq("id", person.id);
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
            setStatus(status, `Saved changes for ${person.full_name || person.email}.`, false, true);
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

    fill(main, 
      pageHead("People", "Give staff access and set their role and station."),
      h(
        "p",
        null,
        "Staff appear here after they sign in for the first time with their company email. New staff get the Staff role and no station."
      ),
      h(
        "section",
        { class: "panel" },
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
          : h("p", { class: "empty" }, "No one has signed in yet. Share the portal address with staff to get started."),
        status
      )
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
            const changes = {
              name: name.value.trim() || s.name,
              sort_order: parseInt(order.value, 10) || 0,
              active: active.checked
            };
            save.disabled = true;
            const { error } = await sb.from("stations").update(changes).eq("code", s.code);
            save.disabled = false;
            if (error) {
              setStatus(status, error.message, true);
              return;
            }
            await logEvent("station_updated", { code: s.code, before: { name: s.name, sort_order: s.sort_order, active: s.active }, after: changes });
            Object.assign(s, changes);
            setStatus(status, `Saved ${s.code}.`, false, true);
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

    fill(main, 
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
              const sortOrder = (state.stations.reduce((max, s) => Math.max(max, s.sort_order), 0) || 0) + 10;
              const { data, error } = await sb.from("stations").insert({ code: code, name: name, sort_order: sortOrder }).select().single();
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

  function signOutButton() {
    return h(
      "button",
      {
        class: "btn btn-quiet btn-small",
        type: "button",
        onclick: async function () {
          await sb.auth.signOut();
          state.session = null;
          state.profile = null;
          history.replaceState(null, "", "#/home");
          render();
        }
      },
      "Sign out"
    );
  }

  function setStatus(node, text, isError, isOk) {
    node.textContent = text;
    node.className = "status" + (isError ? " is-error" : "") + (isOk ? " is-ok" : "");
  }

  async function logEvent(action, details) {
    const { error } = await sb.from("audit_log").insert({
      action: action,
      details: details || {},
      actor_id: state.session.user.id
    });
    if (error) console.warn("Audit log entry failed:", error.message);
  }

  function currentRoute() {
    const match = location.hash.match(/^#\/([a-z-]+)/);
    return match ? match[1] : "home";
  }

  function redirectUrl() {
    return location.origin + location.pathname;
  }

  function readAuthErrorFromUrl() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const code = params.get("error_code");
    const description = params.get("error_description");
    if (!code && !description) return null;
    if (code === "otp_expired") return "That sign-in link has expired or was already used. Request a new one below.";
    return friendlyAuthError(description || "Sign-in failed. Try again.");
  }

  function cleanAuthFromUrl() {
    if (/access_token|refresh_token|error_code|error_description/.test(location.hash)) {
      history.replaceState(null, "", location.pathname + location.search + "#/home");
    }
  }

  function friendlyAuthError(message) {
    if (/limited to company email/i.test(message) || /database error saving new user/i.test(message)) {
      return "Use your company email address to sign in.";
    }
    if (/rate limit/i.test(message)) {
      return "Too many sign-in emails were sent. Wait a few minutes and try again.";
    }
    return message;
  }

  function displayName() {
    return state.profile.full_name || state.profile.email;
  }

  function firstName() {
    if (state.profile.full_name) return state.profile.full_name.split(" ")[0];
    return state.profile.email.split("@")[0];
  }
})();
