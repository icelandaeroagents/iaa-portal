/* Iceland Aero Agents – Staff Portal
   Time clock iPad (kiosk.html). Staff type their kennitala to clock in, add
   lunch and clock out. No staff sign-in: the iPad uses the device key that
   management created when setting it up (Hours → Team → Time clock iPads).
   The kennitala is only sent to /api/kiosk and is cleared from the screen
   after every step. */
(function () {
  "use strict";

  const KEY = "iaa-kiosk-token";
  const TZ = "Atlantic/Reykjavik";
  const RESET_AFTER = 25000;     // back to the number pad after 25 s without a tap
  const DONE_FOR = 5000;         // the "done" screen shows for 5 s
  const LUNCH_PROMPT_AFTER = 6 * 60;

  const root = document.getElementById("kiosk");
  let token = null;
  try { token = localStorage.getItem(KEY); } catch (e) { token = null; }
  let station = null, deviceName = "";
  let digits = "";
  let idleTimer = null;
  let version = null;

  function h(tag, props) {
    const n = document.createElement(tag);
    if (props) Object.keys(props).forEach((k) => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") n.className = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    Array.prototype.slice.call(arguments, 2).forEach(function add(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add); else n.append(c instanceof Node ? c : String(c));
    });
    return n;
  }
  const clock = (ts) => new Date(ts || Date.now()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  function hm(min) { const m = Math.max(0, Math.round(min)); const hh = Math.floor(m / 60), mm = m % 60; return hh ? `${hh} h${mm ? " " + mm + " min" : ""}` : `${mm} min`; }

  async function api(body) {
    try {
      const r = await fetch("/api/kiosk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ token: token }, body)) });
      const j = await r.json().catch(() => ({ error: "Something went wrong – try again." }));
      return Object.assign({ status: r.status }, j);
    } catch (e) {
      return { status: 0, error: "No connection – check the iPad’s Wi-Fi, or use your phone to clock in." };
    }
  }

  // ---------- frame: header with the time ----------
  const timeEl = h("p", { class: "kiosk-time" }, clock());
  const dateEl = h("p", { class: "kiosk-date" });
  function tickClock() {
    timeEl.textContent = clock();
    dateEl.textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
  }
  setInterval(tickClock, 5000); tickClock();

  function frame(card, foot) {
    root.replaceChildren();
    root.append(
      h("div", { class: "kiosk-top" },
        h("img", { src: "logo.svg", alt: "Iceland Aero Agents" }),
        h("div", { class: "kiosk-where" }, h("b", null, station || "Time clock"), deviceName ? h("span", null, deviceName) : null)),
      timeEl, dateEl, card);
    if (foot) root.append(h("p", { class: "kiosk-foot" }, foot));
  }

  function idle(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(padScreen, ms || RESET_AFTER);
  }

  // ---------- not set up ----------
  function notSetUp(text) {
    station = null; deviceName = "";
    frame(h("div", { class: "kiosk-card" },
      h("h1", null, "This iPad isn’t set up yet"),
      h("p", null, text || "Management: sign in to the portal on this iPad, open Hours → Team → Time clock iPads, and choose “Set up this device”.")),
      null);
  }

  // ---------- the number pad ----------
  function padScreen(message) {
    clearTimeout(idleTimer);
    digits = "";
    const display = h("div", { class: "kiosk-display", "aria-label": "Kennitala" });
    const msg = h("p", { class: "kiosk-msg", role: "alert" }, message || "");
    const show = () => {
      if (!digits) { display.replaceChildren(h("span", { class: "ph" }, "000000-0000")); return; }
      display.textContent = digits.length > 6 ? digits.slice(0, 6) + "-" + digits.slice(6) : digits;
    };
    show();
    const press = (d) => {
      if (digits.length >= 10) return;
      digits += d; msg.textContent = ""; show(); idle();
      if (digits.length === 10) lookup(digits, msg);
    };
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => h("button", { type: "button", onclick: () => press(d) }, d));
    keys.push(h("button", { type: "button", class: "k-clear", onclick: () => { digits = ""; show(); } }, "Clear"));
    keys.push(h("button", { type: "button", onclick: () => press("0") }, "0"));
    keys.push(h("button", { type: "button", class: "k-del", "aria-label": "Delete", onclick: () => { digits = digits.slice(0, -1); show(); } }, "⌫"));
    frame(h("div", { class: "kiosk-card" },
      h("h1", null, "Type your kennitala"),
      h("p", null, "To clock in, add lunch or clock out."),
      display, h("div", { class: "kiosk-pad" }, keys), msg),
      "Your kennitala is only used to find you and is cleared straight away. Problems? Clock in on your phone and tell management.");
    if (message) idle(8000);
  }

  async function lookup(kt, msg) {
    msg.textContent = "Checking…";
    const r = await api({ action: "lookup", kennitala: kt });
    if (r.notSetUp) return notSetUp(r.error);
    if (r.error) { padScreen(r.error); return; }
    personScreen(kt, r);
  }

  // ---------- what the person can do ----------
  function personScreen(kt, info) {
    const msg = h("p", { class: "kiosk-msg", role: "alert" });
    const busy = (on) => card.querySelectorAll("button").forEach((b) => { b.disabled = on; });
    async function act(action, extra) {
      busy(true); msg.textContent = "";
      const r = await api(Object.assign({ action: action, kennitala: kt }, extra || {}));
      if (r.notSetUp) return notSetUp(r.error);
      if (r.error) { busy(false); msg.textContent = r.error; idle(); return; }
      doneScreen(r);
    }
    const cancel = h("button", { class: "btn btn-quiet", type: "button", onclick: () => padScreen() }, "Not me – back");
    let card;
    if (!info.open) {
      const lunch = h("input", { type: "checkbox" });
      card = h("div", { class: "kiosk-card" },
        h("h1", null, `Hi ${info.name}`),
        h("p", null, "You’re not clocked in."),
        h("label", { class: "kiosk-check" }, lunch, "Add lunch now"),
        h("div", { class: "kiosk-actions" },
          h("button", { class: "btn", type: "button", onclick: () => act("clock_in", { lunch: lunch.checked }) }, "Clock in"),
          cancel),
        msg);
    } else {
      const on = (Date.now() - new Date(info.open.clock_in).getTime()) / 60000;
      const lunches = info.open.lunches || 0;
      const outBtn = h("button", { class: "btn", type: "button" }, "Clock out");
      const askArea = h("div");
      let actions = null;
      outBtn.addEventListener("click", () => {
        if (on >= LUNCH_PROMPT_AFTER && !lunches) {
          actions.hidden = true;
          askArea.replaceChildren(
            h("p", { class: "notice" }, "No lunch is recorded on this shift. Did you have lunch?"),
            h("div", { class: "kiosk-actions" },
              h("button", { class: "btn", type: "button", onclick: () => act("clock_out", { lunch: true }) }, "Yes – add lunch and clock out"),
              h("button", { class: "btn btn-quiet", type: "button", onclick: () => act("clock_out", { lunch: false }) }, "No lunch – clock out"),
              h("button", { class: "btn btn-quiet", type: "button", onclick: () => padScreen() }, "Cancel")));
          idle();
          return;
        }
        act("clock_out", { lunch: false });
      });
      card = h("div", { class: "kiosk-card" },
        h("h1", null, `Hi ${info.name}`),
        h("p", null, `Clocked in since ${clock(info.open.clock_in)} · on the clock ${hm(on)} · ${lunches ? (lunches === 1 ? "1 lunch" : lunches + " lunches") : "no lunch yet"}`),
        actions = h("div", { class: "kiosk-actions" },
          h("button", { class: "btn btn-quiet", type: "button", onclick: () => act("add_lunch") }, lunches ? "Add another lunch" : "Add lunch"),
          outBtn, cancel),
        askArea, msg);
    }
    frame(card, null);
    idle();
  }

  // ---------- done ----------
  function doneScreen(r) {
    const lines = {
      in: [`✓`, `Clocked in at ${clock(r.at)}`, r.lunch ? "Lunch added. Have a good shift!" : "Have a good shift!"],
      out: [`✓`, `Clocked out at ${clock(r.at)}`, `You worked ${hm(r.worked_minutes)}. See you next time!`],
      lunch: [`✓`, `Lunch added at ${clock(r.at)}`, "Enjoy your lunch!"]
    }[r.done] || ["✓", "Done", ""];
    frame(h("div", { class: "kiosk-card kiosk-done" },
      h("div", { class: "big", "aria-hidden": "true" }, lines[0]),
      h("h1", null, `${lines[1]}, ${r.name}`),
      h("p", null, lines[2]),
      h("div", { class: "kiosk-actions" }, h("button", { class: "btn btn-quiet", type: "button", onclick: () => padScreen() }, "Done"))), null);
    idle(DONE_FOR);
  }

  // ---------- keep the screen on, and pick up portal updates ----------
  async function keepAwake() {
    try { if (navigator.wakeLock) await navigator.wakeLock.request("screen"); } catch (e) { /* not supported */ }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });
  async function checkVersion() {
    try {
      const v = (await (await fetch("/api/version", { cache: "no-store" })).json()).version;
      if (version && v && v !== version && !digits) location.reload();
      version = v || version;
    } catch (e) { /* offline – try later */ }
  }
  setInterval(checkVersion, 10 * 60 * 1000);

  // ---------- start ----------
  async function start() {
    if (!token) return notSetUp();
    frame(h("div", { class: "kiosk-card" }, h("p", null, "Starting…")), null);
    const r = await api({ action: "ping" });
    if (r.notSetUp) return notSetUp(r.error);
    if (r.error) { frame(h("div", { class: "kiosk-card" }, h("h1", null, "Can’t reach the portal"), h("p", null, r.error)), null); setTimeout(start, 30000); return; }
    station = r.station; deviceName = r.name;
    keepAwake(); checkVersion();
    padScreen();
  }
  start();
})();
