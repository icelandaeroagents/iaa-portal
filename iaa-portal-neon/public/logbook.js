/* Iceland Aero Agents – Staff Portal
   Logbook: the aircraft each person has worked – type cards, registrations,
   operators, countries and badges. Credits come from services logged on the
   Ramp page, from the roster (October and November 2026), or from adding a
   flight yourself. Needs database update 43. */
(function () {
  "use strict";

  // Aircraft types are written many ways in Notion. Each rule maps them to one card.
  const TYPES = [
    [/^PC-?24/, "PC24", "Pilatus PC-24"], [/^(PC-?12|PILATUSPC-?12)/, "PC12", "Pilatus PC-12"],
    [/^TBM-?(8|850)/, "TBM8", "Daher TBM 850"], [/^TBM/, "TBM9", "Daher TBM 900 series"],
    [/^(E55P|PHENOM300|EMB-?505)/, "E55P", "Embraer Phenom 300"], [/^(E50P|PHENOM100|EMB-?500)/, "E50P", "Embraer Phenom 100"],
    [/^(E550|EMB-?550|PRAETOR600|LEGACY500)/, "E550", "Embraer Praetor 600"], [/^(E545|EMB-?545|PRAETOR500|LEGACY450)/, "E545", "Embraer Praetor 500"],
    [/^(E35L|LEGACY6)/, "E35L", "Embraer Legacy 600/650"], [/^(SF50|VISIONJET)/, "SF50", "Cirrus Vision Jet"],
    [/^SR20/, "SR20", "Cirrus SR20"], [/^(SR22|S22T)/, "SR22", "Cirrus SR22"],
    [/^(F2TH|FALCON2000)/, "F2TH", "Dassault Falcon 2000"], [/^(F900|FALCON900)/, "F900", "Dassault Falcon 900"], [/^(FA7X|FALCON7X)/, "FA7X", "Dassault Falcon 7X"],
    [/^(FA8X|FALCON8X)/, "FA8X", "Dassault Falcon 8X"], [/^(FA6X|FALCON6X)/, "FA6X", "Dassault Falcon 6X"],
    [/^C68A/, "C68A", "Cessna Citation Latitude"], [/^C680/, "C680", "Cessna Citation Sovereign"], [/^C700/, "C700", "Cessna Citation Longitude"],
    [/^(C56X|C560XL)/, "C56X", "Cessna Citation Excel/XLS"], [/^C560/, "C560", "Cessna Citation V/Encore"],
    [/^(C25B|CJ3)/, "C25B", "Cessna Citation CJ3"], [/^(C25C|CJ4)/, "C25C", "Cessna Citation CJ4"], [/^(C25A|CJ2)/, "C25A", "Cessna Citation CJ2"], [/^(C25M|M2)/, "C25M", "Cessna Citation M2"],
    [/^C182/, "C182", "Cessna 182"], [/^(T206|C206)/, "C206", "Cessna 206"], [/^(CL60|CHALLENGER6)/, "CL60", "Bombardier Challenger 600 series"],
    [/^(CL35|CHALLENGER3)/, "CL35", "Bombardier Challenger 350"], [/^(GL7T|GLOBAL7500)/, "GL7T", "Bombardier Global 7500"], [/^(GL5T|GLOBAL5)/, "GL5T", "Bombardier Global 5000/5500"],
    [/^(GLEX|GLOBALEXPRESS|GLOBAL6)/, "GLEX", "Bombardier Global 6000/6500"], [/^(GLF6|G650|GULFSTREAM650)/, "GLF6", "Gulfstream G650"],
    [/^(GLF5|G550|GULFSTREAM550)/, "GLF5", "Gulfstream G550"], [/^(GA6C|G600)/, "GA6C", "Gulfstream G600"], [/^(G280|GULFSTREAM280)/, "G280", "Gulfstream G280"],
    [/^(CRJ2|CRJ200)/, "CRJ2", "Bombardier CRJ200"], [/^(PRM1|PREMIER)/, "PRM1", "Beechcraft Premier I"], [/^(H25B|HAWKER8)/, "H25B", "Hawker 800"],
    [/^(HDJT|HONDA|HA-?420)/, "HDJT", "HondaJet"], [/^(LJ45|LEARJET45)/, "LJ45", "Learjet 45"], [/^(LJ75|LEARJET75)/, "LJ75", "Learjet 75"],
    [/^(BE9L|KINGAIRC?90)/, "BE9L", "Beechcraft King Air 90"], [/^(BE20|KINGAIR2)/, "BE20", "Beechcraft King Air 200"], [/^(B350|KINGAIR35)/, "B350", "Beechcraft King Air 350"],
    [/^(PA46|P46T|M500|M600)/, "PA46", "Piper PA-46"], [/^M700/, "M700", "Piper M700 Fury"], [/^PA34/, "PA34", "Piper Seneca"],
    [/^(DA62)/, "DA62", "Diamond DA62"], [/^(DA42)/, "DA42", "Diamond DA42"], [/^(LNP4|LANCAIR)/, "LNP4", "Lancair IV"], [/^(EA50|ECLIPSE)/, "EA50", "Eclipse 500"],
    [/(HU-?16|ALBATROSS)/, "U16", "Grumman HU-16 Albatross"], [/^(B737|B738|BBJ)/, "B737", "Boeing 737 / BBJ"], [/^(A319|ACJ)/, "A319", "Airbus A319 / ACJ"]
  ];
  function aircraft(raw) {
    const k = String(raw || "").toUpperCase().replace(/[\s_]+/g, "").replace(/–/g, "-");
    if (!k) return null;
    const t = TYPES.find(([re]) => re.test(k) || re.test(k.replace(/-/g, "")));
    return t ? { code: t[1], name: t[2] } : { code: k.slice(0, 8), name: String(raw).trim() };
  }
  // Countries from the departure airport's ICAO code.
  const ICAO = [["EKVG", "Faroe Islands", "🇫🇴"], ["BI", "Iceland", "🇮🇸"], ["BG", "Greenland", "🇬🇱"], ["EK", "Denmark", "🇩🇰"], ["EG", "United Kingdom", "🇬🇧"], ["EI", "Ireland", "🇮🇪"],
    ["LF", "France", "🇫🇷"], ["LS", "Switzerland", "🇨🇭"], ["LI", "Italy", "🇮🇹"], ["LE", "Spain", "🇪🇸"], ["LP", "Portugal", "🇵🇹"], ["ED", "Germany", "🇩🇪"], ["ET", "Germany", "🇩🇪"],
    ["EH", "Netherlands", "🇳🇱"], ["EB", "Belgium", "🇧🇪"], ["EL", "Luxembourg", "🇱🇺"], ["LO", "Austria", "🇦🇹"], ["LK", "Czechia", "🇨🇿"], ["EP", "Poland", "🇵🇱"],
    ["EN", "Norway", "🇳🇴"], ["ES", "Sweden", "🇸🇪"], ["EF", "Finland", "🇫🇮"], ["EE", "Estonia", "🇪🇪"], ["EV", "Latvia", "🇱🇻"], ["EY", "Lithuania", "🇱🇹"],
    ["LM", "Malta", "🇲🇹"], ["LG", "Greece", "🇬🇷"], ["LT", "Türkiye", "🇹🇷"], ["LH", "Hungary", "🇭🇺"], ["LD", "Croatia", "🇭🇷"], ["LL", "Israel", "🇮🇱"],
    ["OM", "United Arab Emirates", "🇦🇪"], ["OT", "Qatar", "🇶🇦"], ["OE", "Saudi Arabia", "🇸🇦"], ["GM", "Morocco", "🇲🇦"], ["PA", "United States", "🇺🇸"],
    ["K", "United States", "🇺🇸"], ["C", "Canada", "🇨🇦"], ["MM", "Mexico", "🇲🇽"], ["MY", "Bahamas", "🇧🇸"], ["TN", "Caribbean Netherlands", "🇸🇽"], ["SB", "Brazil", "🇧🇷"],
    ["FA", "South Africa", "🇿🇦"], ["VH", "Hong Kong", "🇭🇰"], ["RJ", "Japan", "🇯🇵"], ["WS", "Singapore", "🇸🇬"], ["Y", "Australia", "🇦🇺"]];
  function country(code) { const c = String(code || "").toUpperCase().trim(); if (!/^[A-Z]{4}$/.test(c)) return null; const m = ICAO.find(([p]) => c.startsWith(p)); return m ? { name: m[1], flag: m[2] } : null; }
  const opName = (o) => (o && o !== "NONE" ? String(o).replace(/\s*-\s*[A-Z0-9]{3}$/, "") : null);
  const BIG = ["GL7T", "GLEX", "GL5T", "GLF6", "GLF5", "GA6C", "FA7X", "FA8X", "CRJ2", "B737", "A319"];
  const night = (ts) => { if (!ts) return false; const hr = new Date(ts).getUTCHours(); return hr >= 22 || hr < 6; };

  function badgesFor(fl, rare) {
    const n = fl.length, stations = new Set(fl.map((f) => f.station));
    const has = (fn) => fl.some(fn);
    return [
      ["🛬", "First flight", "Worked your first flight", n >= 1], ["🔟", "Ten", "10 flights", n >= 10], ["⭐", "Fifty", "50 flights", n >= 50], ["🏅", "Century", "100 flights", n >= 100],
      ["🗺️", "All three", "Worked at BIRK, BIKF and BIAR", ["BIRK", "BIKF", "BIAR"].every((s) => stations.has(s))],
      ["❄️", "De-icing", "A flight with de-icing", has((f) => (f.services_requested || []).some((x) => /de-?ic/i.test(x)))],
      ["🌙", "Night owl", "An arrival between 22:00 and 06:00", has((f) => night(f.arrival))],
      ["🧊", "Greenland", "An aircraft in from Greenland", has((f) => /^BG/i.test(f.origin || ""))],
      ["🌎", "Across the pond", "An aircraft in from North America", has((f) => /^[KC]/i.test(f.origin || ""))],
      ["💎", "Rare visitor", "A type handled only once or twice at IAA", has((f) => { const a = aircraft(f.aircraft_type); return a && rare.has(a.code); })],
      ["🐋", "Heavy metal", "A Global, a big Gulfstream, a 7X/8X or larger", has((f) => { const a = aircraft(f.aircraft_type); return a && BIG.indexOf(a.code) !== -1; })]
    ];
  }

  async function render(main, ctx) {
    const { h, fill, pageHead, db, state, setStatus } = ctx;
    const me = state.profile.id, isMgmt = state.profile.role === "management";
    fill(main, pageHead("Logbook"), h("p", { class: "empty" }, "Loading your logbook…"));
    const [crewR, allR, peopleR] = await Promise.all([
      db.from("flight_crew").select("flight_id, profile_id, source").limit(20000),
      db.from("flights").select("id, station, name, registration, aircraft_type, operator, origin, arrival, departure, services_requested").limit(20000),
      db.from("profiles").select("id, full_name, email, active")
    ]);
    if (crewR.error || allR.error) { fill(main, pageHead("Logbook"), h("p", { class: "notice is-error" }, "The Logbook isn’t set up yet (database update 43).")); return; }
    const flights = {}; (allR.data || []).forEach((f) => { flights[f.id] = f; });
    const crew = crewR.data || [];
    // how often IAA has handled each type – one or two is rare
    const seen = {}; Object.values(flights).forEach((f) => { const a = aircraft(f.aircraft_type); if (a) seen[a.code] = (seen[a.code] || 0) + 1; });
    const rare = new Set(Object.keys(seen).filter((k) => seen[k] <= 2));
    const myCredits = crew.filter((c) => c.profile_id === me);
    const mine = myCredits.map((c) => flights[c.flight_id]).filter(Boolean);

    const types = {}, regs = {}, ops = {}, countries = {};
    mine.forEach((f) => {
      const a = aircraft(f.aircraft_type);
      if (a) { const t = types[a.code] || (types[a.code] = { ...a, n: 0, first: f.arrival || f.departure }); t.n++; const d = f.arrival || f.departure; if (d && d < t.first) t.first = d; }
      if (f.registration) regs[f.registration] = (regs[f.registration] || 0) + 1;
      const o = opName(f.operator); if (o) ops[o] = (ops[o] || 0) + 1;
      const c = country(f.origin); if (c) countries[c.name] = c.flag;
    });
    const badges = badgesFor(mine, rare);
    // leaderboard: most aircraft types collected
    const byPerson = {}; crew.forEach((c) => { const f = flights[c.flight_id], a = f && aircraft(f.aircraft_type); if (!a) return; (byPerson[c.profile_id] = byPerson[c.profile_id] || new Set()).add(a.code); });
    const names = {}; (peopleR.data || []).forEach((p) => { const full = (p.full_name || p.email || "").trim(); const parts = full.split(/\s+/); names[p.id] = parts.length > 1 ? parts[0] + " " + parts[parts.length - 1][0] + "." : parts[0]; });
    const board = Object.keys(byPerson).map((id) => ({ id, n: byPerson[id].size })).sort((a, b) => b.n - a.n).slice(0, 10);
    const dateShort = (ts) => ts ? new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

    // adding a flight you worked
    const search = h("input", { type: "search", id: "lb-search", placeholder: "Registration, e.g. TF-ABC or N296LN", autocomplete: "off" });
    const results = h("div", { class: "lb-results" });
    search.addEventListener("input", function () {
      const q = search.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (q.length < 3) { results.replaceChildren(); return; }
      const hits = Object.values(flights).filter((f) => (f.registration || f.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").indexOf(q) !== -1)
        .sort((a, b) => String(b.arrival || b.departure).localeCompare(String(a.arrival || a.departure))).slice(0, 8);
      results.replaceChildren(...(hits.length ? hits.map((f) => {
        const credit = myCredits.find((c) => c.flight_id === f.id);
        return h("div", { class: "lb-hit" }, h("span", null, h("b", null, f.registration || f.name), ` ${f.aircraft_type || ""} · ${f.station} · ${dateShort(f.arrival || f.departure)}`),
          credit ? h("span", { class: "chip chip-pass" }, "In your logbook")
            : h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: async function () {
                const { error } = await db.from("flight_crew").insert({ flight_id: f.id, profile_id: me });
                if (error) setStatus(addStatus, error.message, true); else render(main, ctx); } }, "I worked this"));
      }) : [h("p", { class: "fineprint" }, "No flights match – flights are copied from Notion from October 2026.")]));
    });
    const addStatus = h("p", { class: "status", role: "status" });
    const myAdded = myCredits.filter((c) => c.source === "self").map((c) => flights[c.flight_id]).filter(Boolean);

    fill(main,
      pageHead("Logbook", "The aircraft you’ve worked – collect every type. Flights you log services on are added automatically."),
      h("section", { class: "panel lb-stats" }, [["Flights", mine.length], ["Aircraft types", Object.keys(types).length], ["Registrations", Object.keys(regs).length], ["Operators", Object.keys(ops).length], ["Countries", Object.keys(countries).length]]
        .map(([k, v]) => h("div", { class: "lb-stat" }, h("b", null, String(v)), h("span", null, k)))),
      h("section", { class: "panel" },
        h("h2", null, "Type cards"),
        h("p", { class: "fineprint" }, `You’ve collected ${Object.keys(types).length} of the ${Object.keys(seen).length} types handled at IAA.`),
        Object.keys(types).length
          ? h("div", { class: "lb-cards" }, Object.values(types).sort((a, b) => (rare.has(b.code) - rare.has(a.code)) || b.n - a.n).map((t) => h("div", { class: "lb-card" + (rare.has(t.code) ? " is-rare" : "") },
              rare.has(t.code) ? h("span", { class: "lb-rare" }, "Rare") : null,
              h("span", { class: "lb-plane", "aria-hidden": "true" }, "✈"), h("b", null, t.name), h("span", { class: "sub" }, t.code),
              h("span", { class: "sub" }, `${t.n} ${t.n === 1 ? "flight" : "flights"} · first ${dateShort(t.first)}`))))
          : h("p", { class: "empty" }, "No cards yet. Log services on the Ramp page, or add a flight you worked below.")),
      h("section", { class: "panel" }, h("h2", null, "Badges"),
        h("div", { class: "lb-badges" }, badges.map(([icon, name, what, got]) => h("div", { class: "lb-badge" + (got ? " is-got" : ""), title: what },
          h("span", { class: "lb-badge-icon", "aria-hidden": "true" }, got ? icon : "🔒"), h("b", null, name), h("span", { class: "sub" }, what))))),
      h("div", { class: "lb-two" },
        h("section", { class: "panel" }, h("h2", null, "Countries"),
          Object.keys(countries).length ? h("p", { class: "lb-flags" }, Object.keys(countries).sort().map((c) => h("span", { title: c }, countries[c] + " " + c))) : h("p", { class: "empty" }, "None yet.")),
        h("section", { class: "panel" }, h("h2", null, "Operators"),
          Object.keys(ops).length ? h("ul", { class: "lb-list" }, Object.keys(ops).sort((a, b) => ops[b] - ops[a]).map((o) => h("li", null, h("span", null, o), h("b", null, String(ops[o]))))) : h("p", { class: "empty" }, "None yet."))),
      h("section", { class: "panel" }, h("h2", null, "Registrations"),
        Object.keys(regs).length ? h("p", { class: "lb-regs" }, Object.keys(regs).sort().map((r) => h("span", { class: "chip" }, r + (regs[r] > 1 ? " ×" + regs[r] : "")))) : h("p", { class: "empty" }, "None yet.")),
      h("section", { class: "panel" }, h("h2", null, "Add a flight you worked"),
        h("p", { class: "fineprint" }, "Missed one? Search by registration and add it to your logbook."),
        h("div", { class: "field" }, h("label", { for: "lb-search" }, "Registration"), search), results, addStatus,
        myAdded.length ? h("details", null, h("summary", null, `Flights you added yourself (${myAdded.length})`),
          h("ul", { class: "lb-list" }, myAdded.map((f) => h("li", null, h("span", null, `${f.registration || f.name} · ${f.station} · ${dateShort(f.arrival || f.departure)}`),
            h("button", { class: "linkish", type: "button", onclick: async function () { await db.from("flight_crew").delete().eq("flight_id", f.id).eq("profile_id", me); render(main, ctx); } }, "Remove"))))) : null),
      h("section", { class: "panel" }, h("h2", null, "Most types collected"),
        board.length ? h("ol", { class: "game-board" }, board.map((b) => h("li", { class: b.id === me ? "is-me" : null }, h("span", { class: "game-name" }, names[b.id] || "Staff"), h("span", { class: "game-score" }, String(b.n)))))
          : h("p", { class: "empty" }, "Nobody yet."),
        h("p", { class: "fineprint" }, "Variety counts, not the number of shifts.")),
      isMgmt ? adminPanel(ctx, main) : null);
  }

  // ------------------------------------------------------------------
  // Management: import flights from Notion, and credit October–November from the roster
  // ------------------------------------------------------------------
  function adminPanel(ctx, main) {
    const { h, db, setStatus } = ctx;
    const st = h("p", { class: "status", role: "status" });
    const importBtn = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "1. Import October–November flights from Notion");
    importBtn.addEventListener("click", async function () {
      importBtn.disabled = true; setStatus(st, "Importing from Notion – this can take a minute…");
      let total = 0;
      for (const [from, to] of [["2026-10-01", "2026-10-31"], ["2026-11-01", "2026-11-30"]]) {
        const r = await fetch("/api/ramp-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "import", from, to }) }).then((x) => x.json()).catch(() => ({ error: "No connection" }));
        if (r.error) { importBtn.disabled = false; setStatus(st, r.error, true); return; }
        total += r.flights || 0;
      }
      setStatus(st, `Imported ${total} flights. Now credit them from the roster.`);
      importBtn.disabled = false;
    });
    const rosterBtn = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "2. Credit October–November from the roster");
    rosterBtn.addEventListener("click", async function () {
      rosterBtn.disabled = true; setStatus(st, "Reading the roster…");
      try { const n = await creditFromRoster(ctx); setStatus(st, `Credited ${n} flight places from the roster.`); render(main, ctx); }
      catch (e) { setStatus(st, e.message, true); rosterBtn.disabled = false; }
    });
    return h("section", { class: "panel" }, h("h2", null, "Management"),
      h("p", { class: "fineprint" }, "Run these once to start the Logbook with October and November. BIRK flights are credited to everyone on a shift that day, BIKF flights to that day’s BIKF Resp and BIAR flights to the BIAR Resp. Staff can add or remove flights themselves afterwards."),
      h("div", { class: "row" }, importBtn, rosterBtn), st);
  }

  async function creditFromRoster(ctx) {
    const { db } = ctx;
    const P = window.IAARosterParse;
    if (!P) throw new Error("The roster files didn’t load – reload the page.");
    const [rr, fr, pr] = await Promise.all([
      db.from("rosters").select("sheets, uploaded_at").order("uploaded_at", { ascending: false }).limit(1),
      db.from("flights").select("id, station, arrival, departure").gte("arrival", "2026-10-01T00:00:00Z").lte("arrival", "2026-11-30T23:59:59Z").limit(5000),
      db.from("profiles").select("id, full_name, email, roster_names, active")
    ]);
    if (rr.error || !(rr.data || []).length) throw new Error("No published roster found.");
    const roster = rr.data[0], sheets = roster.sheets || roster.data || [];
    // names on the roster → people
    const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ð/g, "d").replace(/þ/g, "th").trim();
    const index = {};
    (pr.data || []).forEach((p) => {
      const keys = new Set([fold((p.full_name || "").split(/\s+/)[0])]);
      String(p.roster_names || "").split(",").forEach((n) => n.trim() && keys.add(fold(n)));
      keys.forEach((k) => { if (k) (index[k] = index[k] || []).push(p.id); });
    });
    const who = (cell) => String(cell || "").split(/\s*(?:[,/&+]|\bog\b|\band\b)\s*/i).map((x) => fold(x.replace(/\(.*?\)|-?\s*\d{3,4}.*$/g, ""))).filter(Boolean)
      .map((k) => (index[k] && index[k].length === 1 ? index[k][0] : null)).filter(Boolean);
    const rows = [];
    (fr.data || []).forEach((f) => {
      const date = String(f.arrival || f.departure).slice(0, 10);
      const entries = [].concat(...sheets.map((sh) => { try { return P.day(sh.blocks || sh, date) || []; } catch (e) { return []; } }));
      const ids = new Set();
      entries.forEach((e) => {
        const label = String(e.label || e.duty || ""), value = e.value || e.name || e.names || "";
        const isShift = /\d{3,4}\s*-\s*\d{3,4}/.test(label) && !/boss|manag/i.test(label);
        if ((f.station === "BIRK" && isShift) || (f.station === "BIKF" && /bikf/i.test(label)) || (f.station === "BIAR" && /biar/i.test(label))) who(value).forEach((id) => ids.add(id));
      });
      ids.forEach((id) => rows.push({ flight_id: f.id, profile_id: id, source: "roster" }));
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("flight_crew").upsert(rows.slice(i, i + 500), { onConflict: "flight_id,profile_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return rows.length;
  }

  window.IAALogbook = { render: render, aircraft: aircraft, country: country };
})();
