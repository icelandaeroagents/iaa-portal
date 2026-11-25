/* Iceland Aero Agents – Staff Portal
   Games: Flight, Crosswind Landing, Marshal Me In and Apron Tetris.
   Each game has its own staff leaderboard (this month and all time).
   For breaks only. Needs database updates 37 and 38. */
(function () {
  "use strict";

  const W = 480, H = 640;           // every game draws on a 480 × 640 area, scaled to fit
  const MAX_SCORE = 99999;
  const FONT = "Barlow, 'Segoe UI', sans-serif";

  let stopCurrent = null;            // stops the running game when the page changes

  // ==================================================================
  // Shared: leaderboard, saving, canvas, loop
  // ==================================================================
  function monthStart() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }
  function bestPerPerson(rows) {
    const by = {};
    rows.forEach((r) => { if (!by[r.profile_id] || r.score > by[r.profile_id].score) by[r.profile_id] = r; });
    return Object.values(by).sort((a, b) => b.score - a.score || String(a.played_at).localeCompare(String(b.played_at)));
  }
  const DAILY = ["word", "riddle"];
  // Daily games: points add up. Other games: each person's best score.
  function totalPerPerson(rows) {
    const by = {};
    rows.forEach((r) => { const b = by[r.profile_id] || (by[r.profile_id] = { profile_id: r.profile_id, player_name: r.player_name, score: 0, days: 0, played_at: r.played_at }); b.score += r.score; b.days++; });
    return Object.values(by).sort((a, b) => b.score - a.score || b.days - a.days);
  }
  async function loadBoard(ctx, game) {
    const cols = "profile_id, player_name, score, played_at";
    const rank = DAILY.indexOf(game) !== -1 ? totalPerPerson : bestPerPerson;
    const q = () => ctx.db.from("game_scores").select(cols).eq("game", game);
    const [all, month] = await Promise.all([
      q().order("score", { ascending: false }).limit(5000),
      q().gte("played_at", monthStart()).order("score", { ascending: false }).limit(2000)
    ]);
    if (all.error) return { error: all.error.message };
    return { all: rank(all.data || []), month: rank(month.data || []) };
  }
  async function saveScore(ctx, game, score) {
    const s = Math.max(1, Math.min(MAX_SCORE, Math.round(score)));
    return ctx.db.from("game_scores").insert({ score: s, game: game });
  }
  function boardList(h, rows, me, title) {
    const top = rows.slice(0, 10), mine = rows.findIndex((r) => r.profile_id === me);
    return h("div", { class: "game-board-col" },
      h("h3", null, title),
      top.length
        ? h("ol", { class: "game-board" }, top.map((r) => h("li", { class: r.profile_id === me ? "is-me" : null },
            h("span", { class: "game-name" }, r.player_name || "Player"), h("span", { class: "game-score" }, String(r.score)))))
        : h("p", { class: "fineprint" }, "No scores yet. Be the first!"),
      mine >= 10 ? h("p", { class: "fineprint" }, `You: ${mine + 1}. place with ${rows[mine].score}`) : null);
  }
  function leaderboard(ctx, game) {
    const { h } = ctx, me = ctx.state.profile.id;
    const box = h("div", { class: "game-boards" }, h("p", { class: "fineprint" }, "Loading the leaderboard…"));
    const api = { el: box, best: 0 };
    api.refresh = async function () {
      const b = await loadBoard(ctx, game);
      if (b.error) { box.replaceChildren(h("p", { class: "fineprint" }, "The leaderboard isn’t set up yet (database updates 37 and 38).")); return; }
      const mine = b.all.find((r) => r.profile_id === me);
      api.best = Math.max(api.best, mine ? mine.score : 0);
      box.replaceChildren(boardList(h, b.month, me, "This month"), boardList(h, b.all, me, "All time"));
    };
    return api;
  }
  // Save a finished game's score and say how it went.
  async function finish(ctx, def, board, status, score) {
    if (score <= 0) { ctx.setStatus(status, "No score this time – have another go."); return; }
    const { error } = await saveScore(ctx, def.id, score);
    if (error) { ctx.setStatus(status, "Your score couldn’t be saved: " + error.message, true); return; }
    const nb = score > board.best; board.best = Math.max(board.best, score);
    ctx.setStatus(status, nb ? `New personal best: ${Math.min(score, MAX_SCORE)}!` : `Score ${Math.min(score, MAX_SCORE)}. Your best is ${board.best}.`);
    board.refresh();
  }

  // Canvas scaled to fit its panel, sharp on high-resolution screens.
  function makeCanvas(h, label) {
    const canvas = h("canvas", { class: "game-canvas", tabindex: "0", "aria-label": label });
    const g = canvas.getContext("2d");
    function size() {
      const box = canvas.parentElement;
      if (!box) return;
      const cs = getComputedStyle(box);
      const inner = box.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      const cssW = Math.max(200, Math.min(inner - 2, W)), dpr = window.devicePixelRatio || 1;
      canvas.style.width = cssW + "px"; canvas.style.height = (cssW * H / W) + "px";
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssW * H / W * dpr);
      g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    }
    // pointer position in game units
    function point(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
    return { canvas, g, size, point };
  }

  // The game loop: calls frame(dt) about 60 times a second, stops when the
  // page changes, and does not jump forward after the tab was hidden.
  function startLoop(canvas, frame, extraCleanup) {
    let raf = 0, last = null, alive = true;
    const onVis = () => { last = null; };
    document.addEventListener("visibilitychange", onVis);
    function tick(now) {
      if (!alive) return;
      if (!canvas.isConnected) { stop(); return; }
      if (last === null) last = now;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      frame(dt);
      raf = requestAnimationFrame(tick);
    }
    function stop() {
      alive = false; cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      if (extraCleanup) extraCleanup();
    }
    raf = requestAnimationFrame(tick);
    return stop;
  }

  // Keyboard handling that only applies while the game is on screen.
  function keys(canvas, onDown, onUp) {
    const down = (e) => { if (!canvas.isConnected || /^(input|textarea|select)$/i.test(e.target.tagName)) return; if (onDown(e) === true) e.preventDefault(); };
    const up = (e) => { if (!canvas.isConnected) return; if (onUp && onUp(e) === true) e.preventDefault(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }

  // The page around a game: back link, title, canvas, controls and leaderboard.
  function shell(main, ctx, def, intro, canvas, controls) {
    const { h, fill, pageHead } = ctx;
    const board = leaderboard(ctx, def.id);
    const status = h("p", { class: "status", role: "status" });
    fill(main,
      h("a", { class: "back-link", href: "#/game" }, "Games"),
      pageHead(def.title, intro),
      h("div", { class: "game-layout" },
        h("section", { class: "panel game-panel" }, canvas, controls || null, status),
        h("section", { class: "panel" }, h("h2", null, "Leaderboard"), board.el,
          h("p", { class: "fineprint" }, (DAILY.indexOf(def.id) !== -1 ? "Points add up over the month – play every day. " : "Your best score counts. ") + "For breaks only – never on the ramp or while on duty with aircraft."))));
    board.refresh();
    return { board, status };
  }

  function overlay(g, title, lines) {
    g.fillStyle = "rgba(10,16,26,0.62)"; g.fillRect(50, H / 2 - 110, W - 100, 60 + lines.length * 30);
    g.fillStyle = "#ffffff"; g.textAlign = "center";
    g.font = `700 26px ${FONT}`; g.fillText(title, W / 2, H / 2 - 68);
    g.font = `500 16px ${FONT}`;
    lines.forEach((l, i) => g.fillText(l, W / 2, H / 2 - 34 + i * 28));
  }
  function bigScore(g, text, y) {
    g.save(); g.fillStyle = "#ffffff"; g.textAlign = "center";
    g.shadowColor = "rgba(10,16,26,0.75)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
    g.font = `700 40px ${FONT}`; g.fillText(text, W / 2, y || 64); g.restore();
  }

  // A small business jet seen from above, nose pointing up (−y), scaled.
  function jetTop(g, x, y, angle, scale, tail) {
    g.save(); g.translate(x, y); g.rotate(angle || 0); g.scale(scale || 1, scale || 1);
    g.fillStyle = "#e6ecf0";
    g.beginPath(); g.moveTo(-26, 6); g.lineTo(-4, -4); g.lineTo(4, -4); g.lineTo(26, 6); g.lineTo(26, 10); g.lineTo(3, 6); g.lineTo(-3, 6); g.lineTo(-26, 10); g.closePath(); g.fill(); // wings
    g.beginPath(); g.moveTo(-11, 26); g.lineTo(-2, 21); g.lineTo(2, 21); g.lineTo(11, 26); g.lineTo(11, 29); g.lineTo(-11, 29); g.closePath(); g.fill();                         // tailplane
    g.fillStyle = "#f7fafc";
    g.beginPath(); g.ellipse(0, 3, 5, 27, 0, 0, Math.PI * 2); g.fill();                                                                                                         // fuselage
    g.fillStyle = tail || "#088f83"; g.fillRect(-1.5, 18, 3, 12);                                                                                                               // fin
    g.fillStyle = "#1a222f"; g.fillRect(-3, -19, 6, 3);                                                                                                                       // cockpit
    g.fillStyle = "#b9c4cc"; g.fillRect(-9, 12, 4, 7); g.fillRect(5, 12, 4, 7);                                                                                               // engines
    g.restore();
  }

  // ==================================================================
  // Hub
  // ==================================================================
  const GAMES = [
    { id: "flight", icon: "✈️", title: "Flight", blurb: "Fly through the gaps between the storm clouds and the mountains.", play: flightGame },
    { id: "crosswind", icon: "🌬️", title: "Crosswind Landing", blurb: "Five approaches to runway 13 at BIRK – the wind gets stronger each time.", play: crosswindGame },
    { id: "marshal", icon: "🦺", title: "Marshal Me In", blurb: "Give the right signals to park each jet on the stop line.", play: marshalGame },
    { id: "apron", icon: "🅿️", title: "Apron Tetris", blurb: "Jets keep arriving and leaving – park them nose-in before three divert to BIKF.", play: apronGame },
    { id: "phonetic", icon: "📻", title: "Phonetic Rush", blurb: "Registrations and callsigns in the phonetic alphabet – 60 seconds, as many as you can.", play: phoneticGame },
    { id: "world", icon: "🌍", title: "Where in the World?", blurb: "ICAO codes and the airports behind them – 60 seconds against the clock.", play: worldGame },
    { id: "word", icon: "🔤", title: "Daily Word", blurb: "Guess today’s five-letter aviation word in six tries. One go a day.", play: wordGame, daily: true },
    { id: "riddle", icon: "🧩", title: "Daily Riddle", blurb: "One aviation riddle a day – type the answer, three tries.", play: riddleGame, daily: true },
    { id: "airside", icon: "🚐", title: "Airside Driver", blurb: "Deliver around the apron: 30 km/h, stop at hold lines, give way to aircraft.", play: airsideGame },
    { id: "pushback", icon: "🚜", title: "Pushback Pro", blurb: "Push five jets back onto the taxiway – line up, and mind the wingtips.", play: pushbackGame }
  ];

  async function render(main, ctx) {
    if (stopCurrent) { stopCurrent(); stopCurrent = null; }
    const m = location.hash.match(/^#\/game\/([a-z]+)/);
    const def = m && GAMES.find((x) => x.id === m[1]);
    if (def) return def.play(main, ctx, def);
    return hub(main, ctx);
  }

  async function hub(main, ctx) {
    const { h, fill, pageHead } = ctx;
    const me = ctx.state.profile.id;
    const bests = {};
    const cards = h("div", { class: "game-hub" });
    function draw() {
      cards.replaceChildren(...GAMES.map((d) => h("a", { class: "panel game-card", href: "#/game/" + d.id },
        h("span", { class: "game-card-icon", "aria-hidden": "true" }, d.icon),
        h("span", { class: "game-card-text" },
          h("b", null, d.title), h("span", { class: "sub" }, d.blurb),
          h("span", { class: "game-card-best" }, d.daily ? "New every day" : bests[d.id] ? `Your best: ${bests[d.id]}` : "Not played yet")),
        h("span", { class: "btn btn-small" }, "Play"))));
    }
    draw();
    const champ = h("div");
    fill(main, pageHead("Games", "Short aviation games for your break, each with a staff leaderboard."), champ, cards,
      h("p", { class: "fineprint" }, "For breaks only – never on the ramp or while on duty with aircraft."));
    const r = await ctx.db.from("game_scores").select("game, score").eq("profile_id", me).order("score", { ascending: false }).limit(500);
    if (!r.error) {
      (r.data || []).forEach((x) => { const k = x.game || "flight"; if (DAILY.indexOf(k) !== -1) return; if (!bests[k] || x.score > bests[k]) bests[k] = x.score; });
      draw();
    }
    // Monthly champion: the leader of each game this month, and whoever leads the most games.
    const m = await ctx.db.from("game_scores").select("game, profile_id, player_name, score, played_at").gte("played_at", monthStart()).order("score", { ascending: false }).limit(5000);
    if (m.error || !(m.data || []).length) return;
    const leaders = [];
    GAMES.forEach((d) => {
      const rows = (m.data || []).filter((x) => (x.game || "flight") === d.id);
      if (!rows.length) return;
      const top = (DAILY.indexOf(d.id) !== -1 ? totalPerPerson : bestPerPerson)(rows)[0];
      leaders.push({ d: d, top: top });
    });
    const wins = {};
    leaders.forEach((l) => { const w = wins[l.top.profile_id] || (wins[l.top.profile_id] = { name: l.top.player_name, n: 0 }); w.n++; });
    const best = Object.values(wins).sort((a, b) => b.n - a.n)[0];
    const monthName = new Date().toLocaleDateString("en-GB", { month: "long" });
    champ.replaceChildren(h("section", { class: "panel game-champion" },
      h("div", { class: "game-champion-head" },
        h("span", { class: "game-trophy", "aria-hidden": "true" }, "🏆"),
        h("div", null,
          h("p", { class: "briefing-kicker" }, `Champion of ${monthName}`),
          h("h2", null, best.name || "Player"),
          h("p", { class: "fineprint" }, `Leads ${best.n} of ${leaders.length} ${leaders.length === 1 ? "game" : "games"} played this month`))),
      h("ul", { class: "game-leaders" }, leaders.map((l) => h("li", null,
        h("span", null, l.d.icon + " " + l.d.title), h("b", null, l.top.player_name || "Player"), h("span", { class: "game-score" }, String(l.top.score)))))));
  }

  // ==================================================================
  // 1. Flight
  // ==================================================================
  function flightGame(main, ctx, def) {
    const GROUND = 40, GRAVITY = 1500, FLAP = -430;
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const cv = makeCanvas(ctx.h, "Flight game. Press Space or tap to climb.");
    const { canvas, g } = cv;
    const { board, status } = shell(main, ctx, def, "Fly through the gaps between the storm clouds and the mountains. Tap, click or press Space to climb.", canvas, null);
    cv.size(); window.addEventListener("resize", cv.size);

    let mode = "ready", y = H / 2, vy = 0, obs = [], score = 0, dist = 0, t = 0, spawnIn = 0, overAt = 0, saved = false;
    function reset() { mode = "ready"; y = H / 2; vy = 0; obs = []; score = 0; dist = 0; spawnIn = 0.6; saved = false; ctx.setStatus(status, ""); }
    const speed = () => 170 + Math.min(score, 60) * 3.2;
    const gap = () => Math.max(140, 205 - score * 1.6);
    function flap() {
      if (mode === "over") { if (t - overAt > 0.6) reset(); return; }
      if (mode === "ready") mode = "play";
      vy = FLAP;
    }
    function crash() { mode = "over"; overAt = t; if (!saved) { saved = true; finish(ctx, def, board, status, score); } }

    const unkeys = keys(canvas, (e) => { if (e.code === "Space" || e.code === "ArrowUp") { flap(); return true; } });
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus(); flap(); });

    function sky() {
      const s = g.createLinearGradient(0, 0, 0, H);
      if (dark) { s.addColorStop(0, "#0b1424"); s.addColorStop(0.6, "#1a2a44"); s.addColorStop(1, "#2d4060"); }
      else { s.addColorStop(0, "#1d3550"); s.addColorStop(0.55, "#3e6d8c"); s.addColorStop(1, "#e7b78a"); }
      g.fillStyle = s; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = dark ? 0.55 : 0.35;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        for (let x = 0; x <= W; x += 12) { const yy = 90 + i * 26 + Math.sin(x / 70 + t * 0.4 + i) * 18 + Math.sin(x / 31 + t * 0.7) * 6; x === 0 ? g.moveTo(x, yy) : g.lineTo(x, yy); }
        g.lineTo(W, 0); g.lineTo(0, 0); g.closePath();
        const a = g.createLinearGradient(0, 40, 0, 170);
        a.addColorStop(0, "rgba(95,208,195,0)"); a.addColorStop(1, i === 1 ? "rgba(120,230,160,0.55)" : "rgba(95,208,195,0.45)");
        g.fillStyle = a; g.fill();
      }
      g.restore();
      g.fillStyle = dark ? "#16243a" : "#2b4458";
      g.beginPath(); g.moveTo(0, H - GROUND);
      for (let x = 0; x <= W + 40; x += 40) { const k = (x + dist * 0.25) / 40; g.lineTo(x, H - GROUND - 70 - Math.abs(Math.sin(k * 1.3)) * 60 - Math.abs(Math.sin(k * 0.37)) * 40); }
      g.lineTo(W, H - GROUND); g.closePath(); g.fill();
    }
    function cloud(x, w, hgt) {
      g.fillStyle = "#c9d3dc"; g.fillRect(x, 0, w, hgt - 18);
      g.fillStyle = "#e9eef2"; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x + 10 + i * (w - 20) / 3, hgt - 18, 16, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "rgba(60,80,100,0.25)"; g.fillRect(x, 0, 6, hgt - 18);
    }
    function mountain(x, w, top) {
      g.fillStyle = "#3b3f46";
      g.beginPath(); g.moveTo(x - 6, H - GROUND); g.lineTo(x + w * 0.2, top + 10); g.lineTo(x + w * 0.5, top); g.lineTo(x + w * 0.8, top + 12); g.lineTo(x + w + 6, H - GROUND); g.closePath(); g.fill();
      g.fillStyle = "#f4f7f9";
      g.beginPath(); g.moveTo(x + w * 0.2, top + 10); g.lineTo(x + w * 0.5, top); g.lineTo(x + w * 0.8, top + 12); g.lineTo(x + w * 0.66, top + 24); g.lineTo(x + w * 0.5, top + 16); g.lineTo(x + w * 0.34, top + 26); g.closePath(); g.fill();
    }
    function ground() {
      g.fillStyle = dark ? "#1b2330" : "#2a3240"; g.fillRect(0, H - GROUND, W, GROUND);
      g.fillStyle = "#f1f6f8"; for (let x = -(dist % 48); x < W; x += 48) g.fillRect(x, H - GROUND / 2 - 2, 26, 4);
      g.fillStyle = "#5fd0c3"; g.fillRect(0, H - GROUND, W, 3);
    }
    function jetSide() {
      g.save(); g.translate(110, y); g.rotate(mode === "ready" ? 0 : Math.max(-0.45, Math.min(0.7, vy / 700)));
      g.fillStyle = "#f4f7f9"; g.beginPath(); g.ellipse(0, 0, 30, 8, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(26, -6); g.quadraticCurveTo(40, 0, 26, 6); g.fill();
      g.fillStyle = "#088f83"; g.beginPath(); g.moveTo(-22, -4); g.lineTo(-34, -22); g.lineTo(-26, -22); g.lineTo(-14, -5); g.closePath(); g.fill();
      g.fillStyle = "#cfd8df"; g.beginPath(); g.moveTo(-4, 2); g.lineTo(-16, 16); g.lineTo(-8, 16); g.lineTo(8, 3); g.closePath(); g.fill();
      g.fillStyle = "#1a222f"; g.fillRect(18, -4, 6, 3); for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-8 + i * 7, -2, 1.6, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#088f83"; g.fillRect(-26, 1, 44, 2);
      g.restore();
    }

    reset();
    stopCurrent = startLoop(canvas, function (dt) {
      t += dt;
      if (mode === "play") {
        vy += GRAVITY * dt; y += vy * dt;
        const v = speed(); dist += v * dt; spawnIn -= dt;
        if (spawnIn <= 0) {
          const gp = gap(), margin = 70, centre = margin + gp / 2 + Math.random() * (H - GROUND - 2 * margin - gp);
          obs.push({ x: W + 10, w: 64, top: centre - gp / 2, bottom: centre + gp / 2, passed: false });
          spawnIn = 1.55 - Math.min(score, 40) * 0.008;
        }
        obs.forEach((o) => { o.x -= v * dt; if (!o.passed && o.x + o.w < 90) { o.passed = true; score++; } });
        obs = obs.filter((o) => o.x + o.w > -20);
        const hit = y + 9 > H - GROUND || y - 9 < 0 || obs.some((o) => 136 > o.x + 4 && 84 < o.x + o.w - 4 && (y - 7 < o.top || y + 7 > o.bottom));
        if (hit) { y = Math.min(y, H - GROUND - 9); crash(); }
      } else if (mode === "ready") { y = H / 2 + Math.sin(t * 3) * 8; dist += 60 * dt; }
      else if (y < H - GROUND - 9) { vy += GRAVITY * dt; y = Math.min(H - GROUND - 9, y + vy * dt); }
      sky(); obs.forEach((o) => { cloud(o.x, o.w, o.top); mountain(o.x, o.w, o.bottom); }); ground(); jetSide();
      bigScore(g, String(score), 70);
      if (mode === "ready") overlay(g, "Ready for departure", ["Tap, click or press Space to climb"]);
      if (mode === "over") overlay(g, "Go-around!", [`Score ${score} · best ${Math.max(board.best, score)}`, "Tap or press Space to fly again"]);
    }, () => { unkeys(); window.removeEventListener("resize", cv.size); });
  }

  // ==================================================================
  // 2. Crosswind Landing – top-down approach to runway 13 at BIRK
  // ==================================================================
  function crosswindGame(main, ctx, def) {
    const { h } = ctx;
    const APPROACHES = 5;
    const PX_PER_M = 2.2, RW_W = 45 * PX_PER_M;      // 45 m runway
    const CX = W / 2, PLANE_Y = 470;
    const cv = makeCanvas(h, "Crosswind landing. Use the left and right arrow keys, or hold the left or right side, to steer.");
    const { canvas, g } = cv;
    const left = h("button", { class: "btn btn-quiet game-pad", type: "button", "aria-label": "Steer left" }, "◀ Left");
    const right = h("button", { class: "btn btn-quiet game-pad", type: "button", "aria-label": "Steer right" }, "Right ▶");
    const pads = h("div", { class: "game-pads" }, left, right);
    const { board, status } = shell(main, ctx, def,
      "Land on the centreline of runway 13 in a gusty crosswind. Steer into the wind with ← and → (or the buttons), and touch down with little drift. Five approaches, each windier than the last.",
      canvas, pads);
    cv.size(); window.addEventListener("resize", cv.size);

    let mode = "ready", n = 0, total = 0, results = [], t = 0, msgAt = 0;
    let x = 0, crab = 0, vx = 0, dist = 0, input = 0, windBase = 0, gustA = 0, seed = 0, last = null;
    const held = { l: false, r: false, pl: false, pr: false };
    const START = 430, SPEED = 40, LAT = 100;      // px to touchdown, px per second (≈ 11 s approach), sideways authority
    function wind(tt) { return windBase + gustA * (0.6 * Math.sin(tt * 0.9 + seed) + 0.4 * Math.sin(tt * 2.3 + seed * 2)); }
    function setup() {
      const side = Math.random() < 0.5 ? -1 : 1;
      windBase = side * (6 + n * 5);              // px/s sideways – positive blows from the left
      gustA = 3 + n * 3; seed = Math.random() * 10;
      x = -side * (10 + Math.random() * 25); crab = 0; vx = 0; dist = START;
    }
    function kt(px) { return Math.round(Math.abs(px) / PX_PER_M * 1.94); }
    function startRound() { n = 0; total = 0; results = []; setup(); mode = "fly"; ctx.setStatus(status, ""); }
    function next() {
      if (mode === "ready") { startRound(); return; }
      if (mode === "result" && t - msgAt > 0.5) { n++; if (n >= APPROACHES) { mode = "done"; msgAt = t; finish(ctx, def, board, status, total); } else { setup(); mode = "fly"; } return; }
      if (mode === "done" && t - msgAt > 0.8) { mode = "ready"; }
    }
    function touchdown() {
      const offM = x / PX_PER_M, driftM = vx / PX_PER_M;
      let pts, word;
      if (Math.abs(x) > RW_W / 2 - 6) { pts = 0; word = "Off the runway – go-around!"; }
      else {
        pts = Math.round(Math.max(0, 100 - Math.abs(offM) * 4.5 - Math.abs(driftM) * 7 - Math.abs(crab) * 15));
        word = pts >= 90 ? "Butter!" : pts >= 70 ? "Nice landing" : pts >= 45 ? "Firm" : "Ouch – check the gear";
      }
      total += pts; results.push(pts);
      mode = "result"; msgAt = t;
      lastResult = { pts, word, offM, driftM };
    }
    let lastResult = null;

    const unkeys = keys(canvas,
      (e) => {
        if (e.code === "ArrowLeft" || e.code === "KeyA") { held.l = true; return true; }
        if (e.code === "ArrowRight" || e.code === "KeyD") { held.r = true; return true; }
        if (e.code === "Space" || e.code === "Enter") { next(); return true; }
      },
      (e) => {
        if (e.code === "ArrowLeft" || e.code === "KeyA") { held.l = false; return true; }
        if (e.code === "ArrowRight" || e.code === "KeyD") { held.r = false; return true; }
      });
    const press = (side, on) => (e) => { e.preventDefault(); if (on && mode !== "fly") { next(); return; } held[side] = on; };
    left.addEventListener("pointerdown", press("pl", true)); left.addEventListener("pointerup", press("pl", false)); left.addEventListener("pointerleave", press("pl", false));
    right.addEventListener("pointerdown", press("pr", true)); right.addEventListener("pointerup", press("pr", false)); right.addEventListener("pointerleave", press("pr", false));
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault(); canvas.focus();
      if (mode !== "fly") { next(); return; }
      const p = cv.point(e); if (p.x < W / 2) held.pl = true; else held.pr = true;
    });
    const release = () => { held.pl = false; held.pr = false; };
    canvas.addEventListener("pointerup", release); canvas.addEventListener("pointerleave", release);

    function scene() {
      // terrain: moss and lava either side, sea at the top-left
      g.fillStyle = "#4c5a45"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#56664d";
      for (let i = 0; i < 18; i++) { const yy = ((i * 97 + (START - dist) * 1) % (H + 80)) - 40; g.fillRect((i * 53) % W, yy, 60, 22); }
      // runway: threshold at screen y = PLANE_Y - dist + 60 (touchdown zone 60 px past threshold)
      const thr = PLANE_Y - dist + 60;
      g.fillStyle = "#2f3238"; g.fillRect(CX - RW_W / 2, -40, RW_W, Math.max(0, thr + 40));
      // approach lights before the threshold
      for (let i = 1; i <= 8; i++) {
        const ly = thr + i * 28; if (ly < -10 || ly > H + 10) continue;
        g.fillStyle = "#fff6cc"; for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(CX + k * 6, ly, 1.8, 0, Math.PI * 2); g.fill(); }
      }
      g.fillStyle = "#f2f4f6";
      // threshold "piano keys", runway number, edge lines, centreline, touchdown zone
      for (let k = 0; k < 8; k++) g.fillRect(CX - RW_W / 2 + 6 + k * (RW_W - 12) / 8, thr - 34, (RW_W - 12) / 8 - 4, 30);
      g.save(); g.font = `700 30px ${FONT}`; g.textAlign = "center"; g.fillText("13", CX, thr - 48); g.restore();
      g.fillRect(CX - RW_W / 2 + 2, -40, 2, Math.max(0, thr + 40)); g.fillRect(CX + RW_W / 2 - 4, -40, 2, Math.max(0, thr + 40));
      for (let yy = thr - 90; yy > -40; yy -= 38) g.fillRect(CX - 1.5, yy - 20, 3, 20);
      for (let k = 1; k <= 3; k++) { const yy = thr - 60 - k * 70; g.fillRect(CX - 26, yy, 10, 26); g.fillRect(CX + 16, yy, 10, 26); }
      // aiming point
      g.fillRect(CX - 30, thr - 120, 14, 40); g.fillRect(CX + 16, thr - 120, 14, 40);
    }
    function windsock(w) {
      const sx = 60, sy = 90, dir = Math.sign(w) || 1, f = Math.min(1, Math.abs(w) / 40);
      g.fillStyle = "#cfd8df"; g.fillRect(sx - 2, sy, 4, 60);
      g.save(); g.translate(sx, sy + 4);
      for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? "#ffffff" : "#e8590c"; const len = 9, sag = (1 - f) * 7; g.beginPath(); g.moveTo(dir * i * len, i * sag * 0.6); g.lineTo(dir * (i + 1) * len, (i + 1) * sag * 0.6); g.lineTo(dir * (i + 1) * len, (i + 1) * sag * 0.6 + 12 - i * 1.4); g.lineTo(dir * i * len, i * sag * 0.6 + 12 - (i - 1) * 1.4); g.closePath(); g.fill(); }
      g.restore();
    }
    function hud(w) {
      g.fillStyle = "rgba(10,16,26,0.55)"; g.fillRect(W - 190, 14, 176, 70);
      g.fillStyle = "#ffffff"; g.textAlign = "left"; g.font = `600 15px ${FONT}`;
      g.fillText(`Approach ${Math.min(n + 1, APPROACHES)} of ${APPROACHES}`, W - 178, 36);
      g.font = `500 14px ${FONT}`;
      g.fillText(`Wind from the ${windBase > 0 ? "left" : "right"} ${kt(windBase)} kt`, W - 178, 56);
      g.fillText(`Gusts ${kt(Math.abs(windBase) + gustA)} kt · Score ${total}`, W - 178, 75);
      windsock(w);
    }

    setup(); mode = "ready";
    stopCurrent = startLoop(canvas, function (dt) {
      t += dt;
      const w = wind(t);
      if (mode === "fly") {
        input = (held.l || held.pl ? -1 : 0) + (held.r || held.pr ? 1 : 0);
        crab += (input * 0.75 - crab * (input ? 0 : 0.9)) * dt;      // turn into the wind, eases back when released
        crab = Math.max(-0.5, Math.min(0.5, crab));
        vx = w + Math.sin(crab) * LAT;                                 // wind from the left pushes the jet right
        x += vx * dt; dist -= SPEED * dt;
        if (Math.abs(x) > W / 2 - 20) { x = Math.sign(x) * (W / 2 - 20); lastResult = { pts: 0, word: "Lost the runway – go-around!", offM: x / PX_PER_M, driftM: 0 }; results.push(0); mode = "result"; msgAt = t; }
        else if (dist <= 0) touchdown();
      }
      scene(); hud(mode === "fly" ? w : windBase);
      jetTop(g, CX + x, PLANE_Y, crab, 1.25 + Math.max(0, dist) / START * 0.5);
      if (mode === "ready") overlay(g, "Crosswind Landing", ["Runway 13 at BIRK – five approaches", "Steer with ← → or hold either side", "Tap or press Space to begin"]);
      if (mode === "result" && lastResult) overlay(g, lastResult.word, [`${lastResult.pts} points`, `Off centreline ${Math.abs(lastResult.offM).toFixed(1)} m · drift ${Math.abs(lastResult.driftM).toFixed(1)} m/s`, n + 1 >= APPROACHES ? "Tap for your total" : "Tap for the next approach"]);
      if (mode === "done") overlay(g, `Total ${total}`, [results.join(" · "), `Best ${Math.max(board.best, total)}`, "Tap to fly again"]);
    }, () => { unkeys(); window.removeEventListener("resize", cv.size); });
  }

  // ==================================================================
  // 3. Marshal Me In – signal each jet onto the stand
  // ==================================================================
  function marshalGame(main, ctx, def) {
    const { h } = ctx;
    const STOP_Y = 400, LINE_X = W / 2, M_PER_PX = 0.08;
    const cv = makeCanvas(h, "Marshal Me In. Use the signal buttons or keys to bring each jet to the stop line.");
    const { canvas, g } = cv;
    // You face the aircraft, so the pilot's left is your right – the keys move the jet the way it looks on screen.
    const SIGNALS = [
      { id: "right", label: "◀ Turn right", key: "ArrowLeft", hint: "pilot’s right = your left" },
      { id: "slow", label: "Slow down ▼", key: "ArrowDown" },
      { id: "stop", label: "STOP", key: "Space" },
      { id: "ahead", label: "Come ahead ▲", key: "ArrowUp" },
      { id: "left", label: "Turn left ▶", key: "ArrowRight", hint: "pilot’s left = your right" }
    ];
    const btns = {};
    const pad = h("div", { class: "game-pads game-pads-5" }, SIGNALS.map((s) => (btns[s.id] = h("button", { class: "btn " + (s.id === "stop" ? "btn-danger" : "btn-quiet") + " game-pad", type: "button" }, s.label))));
    const { board, status } = shell(main, ctx, def,
      "Bring each jet onto the stop line, nose on the lead-in line. You face the aircraft, so the pilot’s left is your right: ← signals “Turn right”, → “Turn left”. Slow down before you signal Stop – a fast jet won’t stop in time.",
      canvas, pad);
    cv.size(); window.addEventListener("resize", cv.size);

    let mode = "ready", t = 0, msgAt = 0, score = 0, count = 0, sig = "idle", sigAt = 0, lastResult = null;
    let ax, ay, head, speed, target, drift, braking;
    function newJet() {
      ax = LINE_X + (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 40);
      ay = -60; head = (Math.random() - 0.5) * 0.25;
      speed = target = 70 + Math.min(count, 8) * 9;    // px per second, faster each jet
      drift = (Math.random() - 0.5) * 0.18; braking = false; sig = "ahead"; sigAt = t;
    }
    function start() { score = 0; count = 0; newJet(); mode = "taxi"; ctx.setStatus(status, ""); }
    function signal(id) {
      if (mode === "ready") { start(); return; }
      if (mode === "result") { if (t - msgAt > 0.5) { newJet(); mode = "taxi"; } return; }
      if (mode === "over") { if (t - msgAt > 0.8) mode = "ready"; return; }
      sig = id; sigAt = t;
      if (id === "slow") target = Math.max(18, target * 0.5);
      if (id === "ahead") target = 70 + Math.min(count, 8) * 9;
      if (id === "stop") braking = true;
    }
    Object.keys(btns).forEach((id) => btns[id].addEventListener("pointerdown", (e) => { e.preventDefault(); signal(id); }));
    const unkeys = keys(canvas, (e) => { const s = SIGNALS.find((x) => x.key === e.code); if (s) { signal(s.id); return true; } });
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus(); if (mode !== "taxi") signal("ahead"); });

    function parked() {
      const dy = (ay - STOP_Y) * M_PER_PX, dx = (ax - LINE_X) * M_PER_PX;
      const pts = Math.round(Math.max(0, 100 - Math.abs(dy) * 22 - Math.abs(dx) * 30));
      score += pts; count++;
      lastResult = { pts, dy, dx, word: pts >= 90 ? "Spot on!" : pts >= 70 ? "Well parked" : pts >= 40 ? "Acceptable" : "The crew will need a tow" };
      mode = "result"; msgAt = t;
    }
    function incident(text) { mode = "over"; msgAt = t; lastResult = { word: text }; finish(ctx, def, board, status, score); }

    function apron() {
      g.fillStyle = "#8f979e"; g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1;
      for (let yy = 0; yy < H; yy += 40) { g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); }
      for (let xx = 0; xx < W; xx += 60) { g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx, 470); g.stroke(); }
      // lead-in line and stop bar
      g.fillStyle = "#f2c200"; g.fillRect(LINE_X - 2, 0, 4, STOP_Y + 40);
      g.fillRect(LINE_X - 30, STOP_Y - 2, 60, 5);
      g.font = `700 11px ${FONT}`; g.textAlign = "center"; g.fillText("STOP", LINE_X, STOP_Y + 18);
      // equipment either side of the stand (wingtip clearance)
      g.fillStyle = "#e8590c"; [[LINE_X - 150, 360], [LINE_X + 150, 360], [LINE_X - 150, 300], [LINE_X + 150, 300]].forEach(([cx, cy]) => { g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 6, cy + 6); g.lineTo(cx - 6, cy + 6); g.closePath(); g.fill(); });
      g.fillStyle = "#3a4b66"; g.fillRect(LINE_X + 120, STOP_Y + 22, 46, 24); g.fillStyle = "#ffffff"; g.font = `700 10px ${FONT}`; g.fillText("GPU", LINE_X + 143, STOP_Y + 38);
      // FBO building at the bottom
      g.fillStyle = "#263449"; g.fillRect(0, 470, W, H - 470);
    }
    // The marshaller, seen from the cockpit, with orange wands.
    function marshaller() {
      const mx = W / 2, my = 560, k = Math.sin((t - sigAt) * 7);
      g.fillStyle = "#e8590c"; g.fillRect(mx - 14, my - 22, 28, 40);           // hi-vis vest
      g.fillStyle = "#c8a27c"; g.beginPath(); g.arc(mx, my - 34, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#1a222f"; g.fillRect(mx - 12, my + 18, 9, 30); g.fillRect(mx + 3, my + 18, 9, 30);
      g.fillStyle = "#ffcc00"; g.fillRect(mx - 14, my - 10, 28, 3);           // reflective stripe
      function arm(sx, ang, wand) {
        const ex = sx + Math.cos(ang) * 30, ey = my - 16 + Math.sin(ang) * 30;
        g.strokeStyle = "#e8590c"; g.lineWidth = 7; g.lineCap = "round";
        g.beginPath(); g.moveTo(sx, my - 16); g.lineTo(ex, ey); g.stroke();
        g.strokeStyle = "#ff7a1a"; g.lineWidth = 5; g.shadowColor = "#ffb066"; g.shadowBlur = 10;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + Math.cos(wand) * 26, ey + Math.sin(wand) * 26); g.stroke(); g.shadowBlur = 0;
      }
      const L = mx - 14, R = mx + 14, up = -Math.PI / 2;
      if (sig === "stop") { arm(L, -1.2, -0.3); arm(R, -1.94, -2.84); }                       // wands crossed above the head
      else if (sig === "ahead") { arm(L, up - 0.9 + k * 0.3, up + k * 0.6); arm(R, up + 0.9 - k * 0.3, up - k * 0.6); }  // beckon towards the face
      else if (sig === "slow") { arm(L, Math.PI - 0.6 + k * 0.25, Math.PI - 0.3); arm(R, 0.6 - k * 0.25, 0.3); }       // pat down
      // Seen from the cockpit, the marshaller's right arm is on the left of the picture.
      // Turn left: right arm extended towards the pilot's left, left hand beckons. Turn right: the mirror image.
      else if (sig === "left") { arm(L, Math.PI - 0.25, Math.PI - 0.25); arm(R, up + 0.5 - k * 0.4, up - k * 0.8); }
      else if (sig === "right") { arm(R, 0.25, 0.25); arm(L, up - 0.5 + k * 0.4, up + k * 0.8); }
      else { arm(L, Math.PI / 2 + 0.3, Math.PI / 2 + 0.3); arm(R, Math.PI / 2 - 0.3, Math.PI / 2 - 0.3); }
      const names = { stop: "STOP", ahead: "Come ahead", slow: "Slow down", left: "Turn left (pilot’s left)", right: "Turn right (pilot’s right)", idle: "" };
      g.fillStyle = "#ffffff"; g.textAlign = "left"; g.font = `600 15px ${FONT}`; g.fillText(names[sig] || "", 20, 500);
      g.font = `500 13px ${FONT}`; g.fillStyle = "#a9ddd5"; g.fillText(`Jets parked ${count} · Score ${score}`, 20, 522);
      g.textAlign = "right"; g.font = `500 12px ${FONT}`; g.fillStyle = "#8fa3b8"; g.fillText("Marshaller, seen from the cockpit", W - 16, 500);
    }

    newJet(); mode = "ready";
    stopCurrent = startLoop(canvas, function (dt) {
      t += dt;
      if (mode === "taxi") {
        // the pilot follows your signals; the aircraft drifts a little on its own
        const turn = sig === "left" ? 0.55 : sig === "right" ? -0.55 : 0;
        head += (turn + drift - head * (turn ? 0 : 1.2)) * dt;
        head = Math.max(-0.5, Math.min(0.5, head));
        if (braking) speed = Math.max(0, speed - 55 * dt);
        else speed += (target - speed) * Math.min(1, dt * 1.5);
        ax += Math.sin(head) * speed * dt; ay += Math.cos(head) * speed * dt;
        if (Math.abs(ax - LINE_X) > 100) incident("Wingtip strike!");
        else if (ay > STOP_Y + 34) incident("Overran the stop bar!");
        else if (braking && speed <= 0.5) parked();
      }
      apron();
      jetTop(g, ax - Math.sin(head) * 46, ay - Math.cos(head) * 46, -head + Math.PI, 1.9);   // nose wheel at (ax, ay), nose towards the marshaller
      marshaller();
      bigScore(g, String(score), 52);
      if (mode === "ready") overlay(g, "Marshal Me In", ["Bring each jet to the stop line", "← → turn · ▼ slow down · Space stop", "Tap or press ▲ to begin"]);
      if (mode === "result" && lastResult) overlay(g, lastResult.word, [`${lastResult.pts} points`, `${Math.abs(lastResult.dy).toFixed(1)} m ${lastResult.dy > 0 ? "past" : "short of"} the line · ${Math.abs(lastResult.dx).toFixed(1)} m off centre`, "Tap or press ▲ for the next jet"]);
      if (mode === "over" && lastResult) overlay(g, lastResult.word, [`Final score ${score} · ${count} jets parked`, "File a report… just kidding.", "Tap or press ▲ to try again"]);
    }, () => { unkeys(); window.removeEventListener("resize", cv.size); });
  }

  // ==================================================================
  // 4. Apron Tetris – an endless, busy apron
  //    Jets arrive on a timer and wait in holding (up to 3). Park each one
  //    nose-in against a taxi lane. Parked jets leave when their stay runs
  //    out. A fourth jet in holding diverts to BIKF – three diversions end it.
  // ==================================================================
  function apronGame(main, ctx, def) {
    const { h } = ctx;
    const COLS = 20, ROWS = 21, CELL = 24, TOP = 70;      // grid 20 × 21 cells of 5 m, starting 70 px down
    const LANES = [10, 20];                               // taxi lane rows
    const HOLD_MAX = 3, DIVERT_MAX = 3;
    // Length and span in 5 m cells (odd spans keep the fuselage centred), points, how common, stay in seconds.
    const TYPES = [
      { name: "Phenom 300", L: 3, S: 3, pts: 10, w: 3, stay: [16, 26] },
      { name: "Citation CJ3", L: 3, S: 3, pts: 10, w: 3, stay: [16, 26] },
      { name: "Challenger 350", L: 4, S: 5, pts: 15, w: 3, stay: [20, 32] },
      { name: "Falcon 7X", L: 5, S: 5, pts: 20, w: 2, stay: [24, 38] },
      { name: "Gulfstream G650", L: 6, S: 7, pts: 25, w: 2, stay: [28, 44] },
      { name: "Global 7500", L: 7, S: 7, pts: 30, w: 1, stay: [32, 50] }
    ];
    const cv = makeCanvas(h, "Apron Tetris. Click or tap a spot next to a taxi lane to park the first jet in holding.");
    const { canvas, g } = cv;
    const flip = h("button", { class: "btn btn-quiet game-pad", type: "button" }, "↕ Face the other lane");
    const { board, status } = shell(main, ctx, def,
      "Jets keep arriving. Park each one nose-in against a yellow taxi lane – click or tap, it snaps to the nearest lane. Parked jets leave when their timer runs out. Up to three can hold; a fourth diverts to BIKF, and three diversions end your shift. +5 for parking tight against another jet, +10 for clearing a queue.",
      canvas, h("div", { class: "game-pads" }, flip));
    cv.size(); window.addEventListener("resize", cv.size);

    let grid, parked, holding, score, diverted, mode = "ready", hover = null, t = 0, msgAt = 0, nextIn = 0, arrivals = 0, flash = null;
    let flipped = false;
    function pick() { const tot = TYPES.reduce((a, b) => a + b.w, 0); let r = Math.random() * tot; for (const ty of TYPES) { if ((r -= ty.w) < 0) return ty; } return TYPES[0]; }
    function reg() { const L = "ABCDEFGHIJKLMNOPRSTUVY"; return "TF-" + Array.from({ length: 3 }, () => L[Math.floor(Math.random() * L.length)]).join(""); }
    // Arrivals speed up from one every 6 s to one every 3 s (after about 50 jets).
    const interval = () => Math.max(3, 6 - arrivals * 0.06);
    function shape(ty, dir) {
      const c = (ty.S - 1) / 2, cells = [], wingRow = Math.max(1, Math.floor(ty.L * 0.4));
      for (let r = 0; r < ty.L; r++) cells.push([0, r]);
      for (let k = 0; k < ty.S; k++) if (k !== c) cells.push([k - c, wingRow]);
      if (ty.S >= 5) for (let k = 1; k < ty.S - 1; k++) if (k !== c) cells.push([k - c, wingRow + 1]);
      if (ty.S >= 5) { cells.push([-1, ty.L - 1]); cells.push([1, ty.L - 1]); }
      return cells.map(([dx, r]) => [dx, dir < 0 ? r : -r]);
    }
    const EDGES = [{ row: 9, dir: 1 }, { row: 11, dir: -1 }, { row: 19, dir: 1 }];
    function cellsAt(ty, col, edge) { return shape(ty, edge.dir).map(([dx, dr]) => [col + dx, edge.row + dr]); }
    function fits(cells) { return cells.every(([c, r]) => c >= 0 && c < COLS && r >= 0 && r < ROWS && LANES.indexOf(r) === -1 && !grid[r][c]); }
    function tight(cells, id) {
      return cells.some(([c, r]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
        const cc = c + dc, rr = r + dr; return rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] && grid[rr][cc] !== id; }));
    }
    function nearestEdge(p) {
      const row = (p.y - TOP) / CELL;
      let best = EDGES[0], d = 1e9;
      EDGES.forEach((e) => { const centre = e.row + (e.dir > 0 ? -1 : 1) * 2; const dd = Math.abs(row - centre); if (dd < d) { d = dd; best = e; } });
      if (flipped && best.row === 11) best = EDGES[2]; else if (flipped && best.row === 19) best = EDGES[1];
      return best;
    }
    flip.addEventListener("click", () => { flipped = !flipped; });
    function start() {
      grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      parked = []; holding = [pick()]; score = 0; diverted = 0; arrivals = 1; nextIn = interval(); flash = null;
      mode = "play"; ctx.setStatus(status, "");
    }
    function arrive() {
      arrivals++;
      holding.push(pick());
      if (holding.length > HOLD_MAX) {
        const gone = holding.pop(); diverted++;
        flash = { text: `${gone.name} diverted to BIKF (${diverted}/${DIVERT_MAX})`, at: t, bad: true };
        if (diverted >= DIVERT_MAX) { mode = "over"; msgAt = t; finish(ctx, def, board, status, score); }
      }
    }
    let nextId = 1;
    function place(p) {
      if (mode === "ready") { start(); return; }
      if (mode === "over") { if (t - msgAt > 0.8) mode = "ready"; return; }
      if (!holding.length) return;
      const ty = holding[0], col = Math.floor(p.x / CELL), edge = nearestEdge(p), cells = cellsAt(ty, col, edge);
      if (!fits(cells)) { flash = { text: `The ${ty.name} doesn’t fit there`, at: t, bad: true }; return; }
      const id = nextId++, waiting = holding.length;
      const isTight = tight(cells, id);
      cells.forEach(([c, r]) => { grid[r][c] = id; });
      const stay = ty.stay[0] + Math.random() * (ty.stay[1] - ty.stay[0]);
      parked.push({ id, ty, col, edge, cells, reg: reg(), left: stay, stay, leaving: 0 });
      holding.shift(); flipped = false;
      let gain = ty.pts, extra = [];
      if (isTight) { gain += 5; extra.push("tight +5"); }
      if (waiting >= 2 && holding.length === 0) { gain += 10; extra.push("queue cleared +10"); }
      score += gain;
      flash = { text: `${ty.name} parked +${gain}` + (extra.length ? ` (${extra.join(", ")})` : ""), at: t, bad: false };
      if (!holding.length) nextIn = Math.min(nextIn, 1.2);   // nothing waiting: the next one comes soon
    }
    canvas.addEventListener("pointermove", (e) => { hover = cv.point(e); });
    canvas.addEventListener("pointerleave", () => { hover = null; });
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus(); hover = cv.point(e); place(hover); });
    const unkeys = keys(canvas, (e) => {
      if (e.code === "KeyR" || e.code === "KeyF") { flipped = !flipped; return true; }
      if (e.code === "Space" && mode !== "play") { place({ x: W / 2, y: H / 2 }); return true; }
    });

    function jetShape(ty, col, edge, ghost, ok, alpha) {
      const cx = col * CELL + CELL / 2, ny = TOP + edge.row * CELL + CELL / 2, len = ty.L * CELL, span = ty.S * CELL;
      const midY = ny + (edge.dir < 0 ? len / 2 - CELL / 2 : -(len / 2 - CELL / 2));
      g.save(); g.translate(cx, midY); if (edge.dir > 0) g.rotate(Math.PI);
      g.globalAlpha = ghost ? 0.6 : (alpha == null ? 1 : alpha);
      const body = ghost ? (ok ? "#c9f2ea" : "#f6c1bc") : "#f4f7f9", wing = ghost ? (ok ? "#9fdcd2" : "#eaa29b") : "#dce3e8";
      const wr = -len / 2 + Math.max(1, Math.floor(ty.L * 0.4)) * CELL;
      g.fillStyle = wing;
      g.beginPath(); g.moveTo(-span / 2 + 2, wr + CELL * 0.9); g.lineTo(-CELL * 0.4, wr - CELL * 0.1); g.lineTo(CELL * 0.4, wr - CELL * 0.1); g.lineTo(span / 2 - 2, wr + CELL * 0.9); g.lineTo(span / 2 - 2, wr + CELL * 1.2); g.lineTo(-span / 2 + 2, wr + CELL * 1.2); g.closePath(); g.fill();
      const tw = ty.S >= 5 ? CELL * 1.4 : CELL * 0.9;
      g.beginPath(); g.moveTo(-tw, len / 2 - 4); g.lineTo(-CELL * 0.2, len / 2 - CELL * 0.7); g.lineTo(CELL * 0.2, len / 2 - CELL * 0.7); g.lineTo(tw, len / 2 - 4); g.closePath(); g.fill();
      g.fillStyle = body; g.beginPath(); g.ellipse(0, 0, CELL * 0.32, len / 2 - 1, 0, 0, Math.PI * 2); g.fill();
      if (!ghost) { g.fillStyle = "#088f83"; g.fillRect(-1.5, len / 2 - CELL * 0.8, 3, CELL * 0.7); g.fillStyle = "#1a222f"; g.fillRect(-3, -len / 2 + 6, 6, 3); }
      g.restore();
      return { cx, midY };
    }
    // Stay timer on a parked jet: a ring that empties, amber in the last 5 seconds.
    function timer(cx, cy, left, stay) {
      const r = 11, soon = left <= 5;
      g.fillStyle = "rgba(26,34,47,0.85)"; g.beginPath(); g.arc(cx, cy, r + 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = soon ? "#f2a33a" : "#5fd0c3"; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, left / stay)); g.stroke();
      g.fillStyle = "#ffffff"; g.font = `700 10px ${FONT}`; g.textAlign = "center"; g.fillText(String(Math.ceil(left)), cx, cy + 3.5);
    }
    function draw() {
      g.fillStyle = "#263449"; g.fillRect(0, 0, W, H);
      // header: score, diversions, next arrival
      g.fillStyle = "#31415a"; g.fillRect(0, 0, W, TOP - 8);
      g.textAlign = "left"; g.fillStyle = "#5fd0c3"; g.font = `700 17px ${FONT}`; g.fillText("IAA FBO · apron", 14, 24);
      g.textAlign = "right"; g.fillStyle = "#ffffff"; g.font = `700 22px ${FONT}`; g.fillText(String(score || 0), W - 14, 26);
      if (mode === "play" || mode === "over") {
        g.textAlign = "left"; g.font = `500 13px ${FONT}`; g.fillStyle = "#a9ddd5"; g.fillText("Next arrival", 14, 48);
        g.fillStyle = "#1a222f"; g.fillRect(92, 39, 150, 10);
        g.fillStyle = "#5fd0c3"; g.fillRect(92, 39, 150 * Math.max(0, 1 - nextIn / interval()), 10);
        g.textAlign = "right"; g.fillStyle = "#ffffff"; g.font = `600 13px ${FONT}`; g.fillText("Diverted", W - 76, 48);
        for (let i = 0; i < DIVERT_MAX; i++) { g.fillStyle = i < diverted ? "#e5484d" : "#3a4b66"; g.beginPath(); g.arc(W - 60 + i * 18, 44, 6, 0, Math.PI * 2); g.fill(); }
      }
      // apron, lanes
      g.fillStyle = "#9aa3ab"; g.fillRect(0, TOP, W, ROWS * CELL);
      g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1;
      for (let r = 0; r <= ROWS; r++) { g.beginPath(); g.moveTo(0, TOP + r * CELL); g.lineTo(W, TOP + r * CELL); g.stroke(); }
      for (let c = 0; c <= COLS; c++) { g.beginPath(); g.moveTo(c * CELL, TOP); g.lineTo(c * CELL, TOP + ROWS * CELL); g.stroke(); }
      LANES.forEach((r) => {
        g.fillStyle = "#3a4048"; g.fillRect(0, TOP + r * CELL, W, CELL);
        g.fillStyle = "#f2c200"; for (let x = 0; x < W; x += 28) g.fillRect(x, TOP + r * CELL + CELL / 2 - 1.5, 16, 3);
      });
      // parked jets with their stay timers (departing jets fade out)
      if (parked) parked.forEach((p) => {
        const pos = jetShape(p.ty, p.col, p.edge, false, true, p.leaving ? Math.max(0, 1 - p.leaving / 0.8) : 1);
        if (!p.leaving) {
          timer(pos.cx, pos.midY, p.left, p.stay);
          g.fillStyle = "#1a222f"; g.font = `600 9px ${FONT}`; g.textAlign = "center";
          g.fillText(p.reg, pos.cx, p.edge.dir < 0 ? pos.midY + p.ty.L * CELL / 2 + 2 : pos.midY - p.ty.L * CELL / 2 + 8);
        }
      });
      // ghost of the first jet in holding under the pointer
      if (mode === "play" && hover && hover.y > TOP && hover.y < TOP + ROWS * CELL && holding.length) {
        const ty = holding[0], col = Math.floor(hover.x / CELL), edge = nearestEdge(hover);
        jetShape(ty, col, edge, true, fits(cellsAt(ty, col, edge)));
      }
      // holding queue along the bottom
      const by = TOP + ROWS * CELL + 8;
      g.textAlign = "left"; g.fillStyle = "#a9ddd5"; g.font = `600 13px ${FONT}`; g.fillText("Holding", 14, by + 20);
      for (let i = 0; i < HOLD_MAX; i++) {
        const x = 76 + i * 134, ty = holding && holding[i];
        g.fillStyle = i === 0 && ty ? "#088f83" : "#31415a"; g.fillRect(x, by + 4, 126, 26);
        g.fillStyle = ty ? "#ffffff" : "#6b7c92"; g.font = `${i === 0 ? 700 : 500} 12px ${FONT}`;
        g.fillText(ty ? `${i === 0 ? "▶ " : ""}${ty.name}` : "—", x + 8, by + 21);
      }
      if (flash && t - flash.at < 2.2) {
        g.globalAlpha = Math.min(1, 2.2 - (t - flash.at));
        g.fillStyle = flash.bad ? "rgba(229,72,77,0.92)" : "rgba(8,143,131,0.92)";
        g.font = `600 14px ${FONT}`; const tw = g.measureText(flash.text).width + 24;
        g.fillRect(W / 2 - tw / 2, TOP + 10 * CELL - 4, tw, 32);
        g.fillStyle = "#ffffff"; g.textAlign = "center"; g.fillText(flash.text, W / 2, TOP + 10 * CELL + 17);
        g.globalAlpha = 1;
      }
      if (mode === "ready") overlay(g, "Apron Tetris", ["Jets keep arriving – park them nose-in", "Parked jets leave when their timer runs out", "3 diversions to BIKF end your shift", "Tap or press Space to open the apron"]);
      if (mode === "over") overlay(g, "Shift over!", [`Three jets diverted to BIKF`, `${nextId - 1} jets parked · ${score} points`, "Tap or press Space to play again"]);
    }

    stopCurrent = startLoop(canvas, function (dt) {
      t += dt;
      if (mode === "play") {
        nextIn -= dt;
        if (nextIn <= 0) { arrive(); nextIn = interval(); }
        parked.forEach((p) => {
          if (p.leaving) { p.leaving += dt; return; }
          p.left -= dt;
          if (p.left <= 0) { p.leaving = 0.001; p.cells.forEach(([c, r]) => { if (grid[r][c] === p.id) grid[r][c] = null; }); }
        });
        parked = parked.filter((p) => !p.leaving || p.leaving < 0.8);
      }
      draw();
    }, () => { unkeys(); window.removeEventListener("resize", cv.size); });
  }

  // Like replaceChildren, but skips empty slots and expands lists.
  function put(el) { el.replaceChildren(...Array.prototype.slice.call(arguments, 1).flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false)); }

  // ==================================================================
  // Shared: a 60-second multiple-choice round (Phonetic Rush, Where in the World?)
  // ==================================================================
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }

  // next() returns { prompt, sub, options: [4 strings], answer: index }
  function quizRound(main, ctx, def, intro, next, seconds) {
    const { h } = ctx;
    const area = h("div", { class: "quiz-game" });
    const { board, status } = shell(main, ctx, def, intro, area, null);
    let score = 0, streak = 0, right = 0, wrong = 0, left = seconds, timer = null, q = null, locked = false;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } window.removeEventListener("keydown", onKey); };
    stopCurrent = stop;
    function onKey(e) {
      if (!area.isConnected) { stop(); return; }
      if (/^(input|textarea|select)$/i.test(e.target.tagName)) return;
      const n = parseInt(e.key, 10);
      if (q && n >= 1 && n <= 4) { e.preventDefault(); answer(n - 1); }
      else if (!q && (e.code === "Space" || e.code === "Enter")) { e.preventDefault(); start(); }
    }
    window.addEventListener("keydown", onKey);
    function startScreen(title, lines, label) {
      put(area, h("div", { class: "quiz-start" }, h("h2", null, title), lines.map((l) => h("p", null, l)),
        h("button", { class: "btn", type: "button", onclick: start }, label)));
    }
    function start() {
      score = 0; streak = 0; right = 0; wrong = 0; left = seconds; locked = false; ctx.setStatus(status, "");
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (!area.isConnected) { stop(); return; }
        left -= 0.1;
        const bar = area.querySelector(".quiz-time i"); if (bar) bar.style.width = Math.max(0, left / seconds * 100) + "%";
        const tx = area.querySelector(".quiz-time-left"); if (tx) tx.textContent = Math.ceil(Math.max(0, left)) + " s";
        if (left <= 0) end();
      }, 100);
      ask();
    }
    function end() {
      clearInterval(timer); timer = null; q = null;
      startScreen(`Score ${score}`, [`${right} right · ${wrong} wrong`, `Your best: ${Math.max(board.best, score)}`], "Play again");
      finish(ctx, def, board, status, score);
    }
    function ask() {
      q = next(); locked = false;
      put(area, 
        h("div", { class: "quiz-top" },
          h("div", { class: "quiz-time" }, h("i", { style: null })), h("span", { class: "quiz-time-left" }, Math.ceil(left) + " s"),
          h("span", { class: "quiz-score" }, `${score}`), streak > 1 ? h("span", { class: "quiz-streak" }, `🔥 ${streak}`) : null),
        h("p", { class: "quiz-prompt" }, q.prompt), q.sub ? h("p", { class: "quiz-sub" }, q.sub) : null,
        h("div", { class: "quiz-opts" }, q.options.map((o, i) => h("button", { class: "opt quiz-opt", type: "button", onclick: () => answer(i) },
          h("span", { class: "opt-key" }, String(i + 1)), h("span", null, o)))));
      const bar = area.querySelector(".quiz-time i"); if (bar) bar.style.width = Math.max(0, left / seconds * 100) + "%";
    }
    function answer(i) {
      if (locked || !q) return; locked = true;
      const btns = area.querySelectorAll(".quiz-opt");
      if (i === q.answer) { streak++; right++; score += 10 + Math.min(10, (streak - 1) * 2); btns[i].classList.add("is-right"); setTimeout(() => { if (timer) ask(); }, 250); }
      else { streak = 0; wrong++; btns[i].classList.add("is-wrong"); btns[q.answer].classList.add("is-right"); setTimeout(() => { if (timer) ask(); }, 900); }
    }
    startScreen(def.title, [intro, `${seconds} seconds. Answer with the buttons or the keys 1–4.`], "Start");
  }

  // ==================================================================
  // 5. Phonetic Rush
  // ==================================================================
  const NATO = { A: "Alfa", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot", G: "Golf", H: "Hotel", I: "India", J: "Juliett", K: "Kilo", L: "Lima", M: "Mike",
    N: "November", O: "Oscar", P: "Papa", Q: "Quebec", R: "Romeo", S: "Sierra", T: "Tango", U: "Uniform", V: "Victor", W: "Whiskey", X: "X-ray", Y: "Yankee", Z: "Zulu",
    "0": "Zero", "1": "One", "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six", "7": "Seven", "8": "Eight", "9": "Niner" };
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", DIGITS = "0123456789";
  function rnd(set, n) { let s = ""; for (let i = 0; i < n; i++) s += set[Math.floor(Math.random() * set.length)]; return s; }
  function makeReg() {
    return pickOne([
      () => "TF-" + rnd(LETTERS, 3), () => "TF-" + rnd(LETTERS, 3), () => "N" + rnd("123456789", 1) + rnd(DIGITS, 2) + rnd(LETTERS, 2),
      () => "G-" + rnd(LETTERS, 4), () => "9H-" + rnd(LETTERS, 3), () => "HB-" + rnd(LETTERS, 3), () => "OE-" + rnd(LETTERS, 3),
      () => "M-" + rnd(LETTERS, 4), () => "D-" + rnd(LETTERS, 4), () => "VP-C" + rnd(LETTERS, 2)
    ])();
  }
  const spell = (reg) => reg.replace(/-/g, "").split("").map((c) => NATO[c]).join(" ");
  function nearMiss(reg) {
    // change one or two characters (never the hyphen) to a similar-looking alternative
    const chars = reg.split(""); const spots = chars.map((c, i) => (c === "-" ? -1 : i)).filter((i) => i >= 0);
    const k = 1 + (Math.random() < 0.35 ? 1 : 0);
    shuffle(spots).slice(0, k).forEach((i) => { const pool = /\d/.test(chars[i]) ? DIGITS : LETTERS; let c; do { c = pool[Math.floor(Math.random() * pool.length)]; } while (c === chars[i]); chars[i] = c; });
    return chars.join("");
  }
  function phoneticGame(main, ctx, def) {
    quizRound(main, ctx, def, "Pick the right phonetic version of each registration – or the registration for the phonetic version.", function () {
      const reg = makeReg(); const opts = new Set([reg]);
      while (opts.size < 4) opts.add(nearMiss(reg));
      const list = shuffle(Array.from(opts));
      const reverse = Math.random() < 0.3;
      return reverse
        ? { prompt: spell(reg), sub: "Which registration is this?", options: list, answer: list.indexOf(reg) }
        : { prompt: reg, sub: "How do you say it on the radio?", options: list.map(spell), answer: list.indexOf(reg) };
    }, 60);
  }

  // ==================================================================
  // 6. Where in the World?
  // ==================================================================
  const AIRPORTS = [
    ["BIKF", "Keflavík"], ["BIRK", "Reykjavík"], ["BIAR", "Akureyri"], ["BIEG", "Egilsstaðir"], ["BIIS", "Ísafjörður"], ["BIVM", "Vestmannaeyjar"],
    ["BGBW", "Narsarsuaq"], ["BGSF", "Kangerlussuaq"], ["BGGH", "Nuuk"], ["EKVG", "Vágar, Faroe Islands"],
    ["EGLL", "London Heathrow"], ["EGGW", "London Luton"], ["EGLF", "Farnborough"], ["EGKB", "Biggin Hill"], ["EGSS", "London Stansted"], ["EGLC", "London City"],
    ["EGPH", "Edinburgh"], ["EGPF", "Glasgow"], ["EGJJ", "Jersey"], ["EIDW", "Dublin"], ["EINN", "Shannon"],
    ["LFPB", "Paris Le Bourget"], ["LFPG", "Paris Charles de Gaulle"], ["LFMN", "Nice"], ["LFMD", "Cannes Mandelieu"], ["LFLB", "Chambéry"], ["LFKJ", "Ajaccio"],
    ["LSGG", "Geneva"], ["LSZH", "Zurich"], ["LSGS", "Sion"], ["LSZS", "Samedan (St. Moritz)"],
    ["LIML", "Milan Linate"], ["LIRA", "Rome Ciampino"], ["LIPZ", "Venice"], ["LIEO", "Olbia"],
    ["LEMD", "Madrid"], ["LEBL", "Barcelona"], ["LEIB", "Ibiza"], ["LEPA", "Palma de Mallorca"], ["LPPT", "Lisbon"], ["LPFR", "Faro"],
    ["EDDM", "Munich"], ["EDDF", "Frankfurt"], ["EDDB", "Berlin"], ["EHAM", "Amsterdam"], ["EBBR", "Brussels"], ["LOWW", "Vienna"], ["LKPR", "Prague"],
    ["EKCH", "Copenhagen"], ["ENGM", "Oslo"], ["ENSB", "Svalbard Longyearbyen"], ["ESSA", "Stockholm Arlanda"], ["EFHK", "Helsinki"],
    ["LMML", "Malta"], ["LGAV", "Athens"], ["LTFM", "Istanbul"], ["OMDB", "Dubai"], ["OMDW", "Dubai World Central"], ["OTHH", "Doha"],
    ["CYQX", "Gander"], ["CYYT", "St. John’s"], ["CYUL", "Montréal"], ["CYYZ", "Toronto"],
    ["KTEB", "Teterboro"], ["KJFK", "New York JFK"], ["KHPN", "White Plains"], ["KBED", "Bedford (Boston)"], ["KBOS", "Boston"], ["KIAD", "Washington Dulles"],
    ["KPBI", "Palm Beach"], ["KMIA", "Miami"], ["KVNY", "Van Nuys"], ["KLAS", "Las Vegas"], ["KSFO", "San Francisco"], ["KORD", "Chicago O’Hare"], ["KASE", "Aspen"],
    ["TNCM", "St Maarten"], ["MYNN", "Nassau"], ["VHHH", "Hong Kong"], ["RJTT", "Tokyo Haneda"], ["WSSS", "Singapore"], ["FAOR", "Johannesburg"], ["SBGR", "São Paulo"]
  ];
  function worldGame(main, ctx, def) {
    quizRound(main, ctx, def, "Match ICAO codes to their airports – and airports to their codes.", function () {
      const pick = pickOne(AIRPORTS);
      // wrong answers from the same region where possible (same first letter of the code)
      const same = shuffle(AIRPORTS.filter((a) => a !== pick && a[0][0] === pick[0][0]));
      const others = shuffle(AIRPORTS.filter((a) => a !== pick && a[0][0] !== pick[0][0]));
      const pool = same.slice(0, 3).concat(others).slice(0, 3);
      const list = shuffle([pick].concat(pool));
      return Math.random() < 0.6
        ? { prompt: pick[0], sub: "Which airport is this?", options: list.map((a) => a[1]), answer: list.indexOf(pick) }
        : { prompt: pick[1], sub: "What is its ICAO code?", options: list.map((a) => a[0]), answer: list.indexOf(pick) };
    }, 60);
  }

  // ==================================================================
  // Shared: daily games – the same for everyone, once a day
  // ==================================================================
  function todayIceland() { return new Date().toLocaleDateString("en-CA", { timeZone: "Atlantic/Reykjavik" }); }
  function dayNumber() { return Math.round((Date.parse(todayIceland() + "T12:00:00Z") - Date.parse("2026-01-01T12:00:00Z")) / 86400000); }
  async function playedToday(ctx, game) {
    const r = await ctx.db.from("game_scores").select("score").eq("profile_id", ctx.state.profile.id).eq("game", game).eq("played_on", todayIceland());
    return !r.error && (r.data || []).length ? r.data[0].score : null;
  }
  function untilTomorrow() {
    const now = new Date(), next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const m = Math.round((next - now) / 60000); return `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null"); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }

  // ==================================================================
  // 7. Daily Word – the aviation word of the day, six tries
  // ==================================================================
  const WORDS = ["APRON", "FLAPS", "PITOT", "NOTAM", "METAR", "RADAR", "PILOT", "CABIN", "WINGS", "SLATS", "FLARE", "ROUTE", "CHOCK", "STAND", "PITCH", "CLIMB", "GLIDE", "STALL", "TOWER", "GATES", "ICING", "SLUSH", "GUSTS", "HOLDS", "CARGO", "STRUT", "PYLON", "AVGAS", "ORBIT", "LEVEL", "ROTOR", "BLADE", "WHEEL", "BRAKE", "TRIMS", "CREWS", "RAMPS", "TAXIS", "NORTH", "VISAS", "AISLE", "FIXES", "SPEED", "FUELS", "CHART", "ALOFT", "PLANE", "FERRY", "STACK", "ROGER", "WILCO", "HOVER", "DELAY", "SLOTS", "STEPS", "NOSES", "LIGHT", "SPINS", "JUMPS", "CLEAR"];
  function wordGame(main, ctx, def) {
    const { h } = ctx;
    const word = WORDS[dayNumber() % WORDS.length], key = "iaa-word-" + todayIceland();
    const area = h("div", { class: "word-game" });
    const { board, status } = shell(main, ctx, def, "Guess today’s five-letter aviation word in six tries. Teal: right letter, right place. Amber: in the word, wrong place. Grey: not in the word.", area, null);
    let guesses = store(key) || [], cur = "", over = false;
    const stop = () => window.removeEventListener("keydown", onKey); stopCurrent = stop;
    function marks(g) {
      const res = Array(5).fill("absent"), pool = word.split("");
      g.split("").forEach((c, i) => { if (c === word[i]) { res[i] = "correct"; pool[i] = null; } });
      g.split("").forEach((c, i) => { if (res[i] !== "correct") { const j = pool.indexOf(c); if (j !== -1) { res[i] = "present"; pool[j] = null; } } });
      return res;
    }
    function keyState() { const st = {}; guesses.forEach((g) => marks(g).forEach((m, i) => { const c = g[i], rank = { correct: 3, present: 2, absent: 1 }; if (!st[c] || rank[m] > rank[st[c]]) st[c] = m; })); return st; }
    function draw(msg) {
      const rows = [];
      for (let r = 0; r < 6; r++) {
        const g = guesses[r] || (r === guesses.length && !over ? cur.padEnd(5) : "     ");
        const m = guesses[r] ? marks(guesses[r]) : null;
        rows.push(h("div", { class: "word-row" }, g.split("").map((c, i) => h("span", { class: "word-cell" + (m ? " is-" + m[i] : c.trim() ? " is-typed" : "") }, c.trim()))));
      }
      const ks = keyState();
      const kb = ["QWERTYUIOP", "ASDFGHJKL", "ENTER ZXCVBNM ⌫"].map((row) => h("div", { class: "word-keys" },
        (row.indexOf(" ") !== -1 ? row.split(" ").flatMap((part) => part === "ENTER" || part === "⌫" ? [part] : part.split("")) : row.split("")).map((k) =>
          h("button", { class: "word-key" + (ks[k] ? " is-" + ks[k] : "") + (k.length > 1 ? " is-wide" : ""), type: "button", onclick: () => press(k) }, k))));
      put(area, h("div", { class: "word-grid" }, rows), msg ? h("p", { class: "word-msg" }, msg) : null, over ? null : kb);
    }
    function press(k) {
      if (over) return;
      if (k === "⌫" || k === "Backspace") cur = cur.slice(0, -1);
      else if (k === "ENTER" || k === "Enter") { if (cur.length === 5) submit(); else draw("Five letters, please."); return; }
      else if (/^[A-Z]$/.test(k) && cur.length < 5) cur += k;
      draw();
    }
    function onKey(e) {
      if (!area.isConnected) { stop(); return; }
      if (e.ctrlKey || e.metaKey || /^(input|textarea|select)$/i.test(e.target.tagName)) return;
      if (e.key === "Enter" || e.key === "Backspace") { e.preventDefault(); press(e.key); }
      else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toUpperCase());
    }
    window.addEventListener("keydown", onKey);
    function submit() {
      guesses.push(cur); cur = ""; store(key, guesses);
      if (guesses[guesses.length - 1] === word || guesses.length >= 6) done();
      else draw();
    }
    function done() {
      over = true;
      const solved = guesses[guesses.length - 1] === word;
      const pts = solved ? (7 - guesses.length) * 10 : 1;
      draw(solved ? `Solved in ${guesses.length}! +${pts} points. A new word in ${untilTomorrow()}.` : `Today’s word was ${word}. +1 point for playing. A new word in ${untilTomorrow()}.`);
      finish(ctx, def, board, status, pts);
    }
    (async function () {
      const prev = await playedToday(ctx, def.id);
      if (prev !== null) { over = true; draw(`You’ve played today (${prev} ${prev === 1 ? "point" : "points"}). A new word in ${untilTomorrow()}.`); return; }
      if (guesses.length && (guesses[guesses.length - 1] === word || guesses.length >= 6)) { done(); return; }
      draw();
    })();
  }

  // ==================================================================
  // 8. Daily Riddle – one a day, one answer
  // ==================================================================
  const RIDDLES = [
    { q: "I’m full of air but never fly, and I’m all tail with no body.", a: ["windsock", "wind sock", "wind cone"], e: "A windsock – its tail points downwind." },
    { q: "The more of me you take, the more you leave behind.", a: ["footsteps", "footprints", "steps"], e: "Footsteps." },
    { q: "I’m a dance, and I lead every Icelandic tail.", a: ["tango"], e: "Tango – the T in TF." },
    { q: "On the radio I carry one syllable more than I need, all so a German won’t hear “no”.", a: ["niner"], e: "Niner – so it isn’t heard as “nein”." },
    { q: "Every hour I tell you how it is – never how it will be.", a: ["metar"], e: "A METAR: current weather. A TAF is the forecast." },
    { q: "The airport’s small print: what’s closed, broken or moved. Skip me at your peril.", a: ["notam", "notams"], e: "A NOTAM." },
    { q: "Heavy but invisible, I fall as you rise, and pilots dial me in before they go.", a: ["air pressure", "pressure", "atmospheric pressure", "barometric pressure", "qnh"], e: "Air pressure – set on the altimeter as QNH." },
    { q: "Turned by the captain’s hand, I only work while the wheels are on the ground.", a: ["tiller", "steering tiller", "nose wheel steering", "nosewheel steering", "nose wheel tiller"], e: "The nose wheel steering tiller." },
    { q: "First on, last off, and never seen in flight.", a: ["chocks", "chock", "wheel chocks"], e: "Chocks." },
    { q: "Orange sentries at the wingtips, nose and tail.", a: ["cone", "cones", "safety cone", "safety cones", "traffic cone"], e: "Safety cones." },
    { q: "Bravo India Kilo Foxtrot. Where am I?", a: ["keflavik", "bikf", "keflavik airport", "keflavik international"], e: "Keflavík." },
    { q: "I’m painted 13 at one end. Which way am I facing?", a: ["south east", "southeast", "se", "130", "130 degrees", "sse"], e: "South-east – runway numbers are the heading divided by ten." },
    { q: "The clock that starts when the spraying stops.", a: ["holdover time", "holdover", "hot"], e: "Holdover time – how long de-icing fluid protects the aircraft." },
    { q: "I start when the chocks come away and stop when they go back in.", a: ["block time", "blocks time", "block"], e: "Block time." },
    { q: "One word on the radio that means “I heard you” – and promises nothing more.", a: ["roger"], e: "Roger – received. “Wilco” adds “and will comply”." },
    { q: "Two syllables: heard it, and I’ll do it.", a: ["wilco"], e: "Wilco – will comply." },
    { q: "Four digits that turn every controller’s head – a mayday without a word.", a: ["7700"], e: "7700, the emergency squawk." },
    { q: "Four digits for when nobody can hear you.", a: ["7600"], e: "7600 – radio failure." },
    { q: "A yellow path that ends where the nose wheel should stop.", a: ["lead in line", "leadin line", "lead in", "lead-in line", "taxi line", "guidance line", "stand line"], e: "The lead-in line." },
    { q: "A small jet engine that never pushes anything, hiding in the tail.", a: ["apu", "auxiliary power unit"], e: "The APU – auxiliary power unit." },
    { q: "The smallest thing on the apron that can cost the most.", a: ["fod", "foreign object debris", "foreign object damage", "debris"], e: "FOD – one bolt can wreck an engine." },
    { q: "When I start blinking red, everyone steps back.", a: ["beacon", "anti collision beacon", "anti collision light", "anticollision beacon", "anticollision light", "beacon light", "red beacon"], e: "The anti-collision beacon – engines starting or running." },
    { q: "Port is red. What am I on the other side?", a: ["green"], e: "Green – the starboard (right) navigation light." },
    { q: "I line the taxiways at night. What colour am I?", a: ["blue"], e: "Blue edge lights. The centreline is green." },
    { q: "Two letters on every Icelandic tail.", a: ["tf"], e: "TF – as in TF-ABC." },
    { q: "A fjord, a runway and a fuel truck at the bottom of Greenland.", a: ["narsarsuaq", "bgbw"], e: "Narsarsuaq (BGBW) – a classic transatlantic fuel stop." },
    { q: "Paraffin by another name – every business jet in Iceland drinks me.", a: ["jet a1", "jet a 1", "jeta1", "jet a", "jet fuel", "kerosene", "jet-a1", "jet-a", "paraffin"], e: "Jet A-1 (kerosene). Avgas is for piston engines." },
    { q: "Ten passengers, three golf bags and a dog. Whose call is where it all goes?", a: ["crew", "flight crew", "pilot", "pilots", "captain", "commander", "pic", "the pilot"], e: "The crew – they’re responsible for mass and balance." },
    { q: "I speak only in gestures, glow at night, and always come in pairs.", a: ["wands", "wand", "marshalling wands", "marshaling wands", "batons", "paddles"], e: "Marshalling wands." },
    { q: "Between Lima and November on the radio.", a: ["mike"], e: "Mike." },
    { q: "Every airport code starting BI is in which country?", a: ["iceland"], e: "Iceland – BIKF, BIRK, BIAR, BIEG." },
    { q: "Above the transition altitude, every altimeter in the sky agrees on me.", a: ["1013", "1013.25", "1013 hpa", "29.92", "2992"], e: "1013 hPa (29.92 inches) – standard pressure." },
    { q: "Frost on the wings. Whose call is it?", a: ["crew", "flight crew", "pilot", "pilots", "captain", "commander", "pic", "the pilot"], e: "The crew’s – we request de-icing when they ask." },
    { q: "I push without a bar, lifting the nose to do it.", a: ["tug", "towbarless tug", "tractor", "towbarless tractor", "pushback tug", "tow tractor", "pushback tractor"], e: "A towbarless tug." },
    { q: "Sofas and coffee for tired crews. What do we call it?", a: ["vip lounge", "lounge"], e: "Our VIP Lounge." },
    { q: "I say the same thing over and over, until my letter changes.", a: ["atis"], e: "ATIS – updated with a new information letter." },
    { q: "A thousand grams, or the letter after Juliett.", a: ["kilo"], e: "Kilo." },
    { q: "I plug in when the engines stop, so the lights stay on.", a: ["gpu", "ground power unit", "ground power"], e: "A GPU – ground power unit." },
    { q: "The last lap before the door closes.", a: ["walk around", "walkaround", "walk-around", "walkround", "walk round", "pre flight inspection", "preflight inspection", "departure walk around"], e: "The departure walk-around." },
    { q: "A tiny tube that knows how fast you’re going. Cover me, and the pilots are blind.", a: ["pitot", "pitot tube", "pitot probe", "pitot head"], e: "The pitot tube – always remove its cover before departure." },
    { q: "I rise from the wing to ruin the lift – on purpose.", a: ["spoiler", "spoilers", "ground spoilers", "speed brake", "speed brakes", "speedbrake", "speedbrakes", "lift dumpers"], e: "Spoilers (lift dumpers)." },
    { q: "A Canadian province, and a letter on the radio.", a: ["quebec"], e: "Quebec." }
  ];
  // Answers are checked forgivingly: case, accents, punctuation and "the/a/our" are
  // ignored, and a small typo is accepted (one letter in words of 6–8 letters, two in longer answers).
  function norm(t) {
    return String(t || "").toLowerCase().replace(/ð/g, "d").replace(/þ/g, "th").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9.]+/g, " ").trim().replace(/^(the|a|an|our) /, "").trim();
  }
  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function matches(guess, answers) {
    const g = norm(guess); if (!g) return false;
    return answers.some((ans) => { const a = norm(ans); if (g === a) return true;
      // Typos: none for short answers (so "nine" isn't "niner"), one for 6–8 letters, two for longer.
      const allow = /^\d+$/.test(a) ? 0 : a.length >= 9 ? 2 : a.length >= 6 ? 1 : 0;
      return allow > 0 && distance(g, a) <= allow; });
  }
  function riddleGame(main, ctx, def) {
    const { h } = ctx;
    // A chosen riddle for a particular day, otherwise the next in the list.
    const CHOSEN = { "2026-11-25": 0 };
    const pickIdx = CHOSEN[todayIceland()] !== undefined ? CHOSEN[todayIceland()] : dayNumber() % RIDDLES.length;
    const r = RIDDLES[pickIdx], key = "iaa-riddle3-" + todayIceland();
    const POINTS = [30, 20, 10], TRIES = 3;
    const area = h("div", { class: "quiz-game riddle-game" });
    const { board, status } = shell(main, ctx, def, "Type your answer. Three tries: 30 points first time, 20 second, 10 third – with a hint after the first miss. 1 point for playing.", area, null);
    stopCurrent = null;
    let tries = store(key) || [], over = false;
    const first = r.a[0];
    // Hint: the shape of the answer, with its first letter – e.g. "V _ _   _ _ _ _ _ _"
    const hint = () => { const words = first.split(" ");
      return "Hint:  " + words.map((w, wi) => w.split("").map((c, i) => (wi === 0 && i === 0 ? c.toUpperCase() : /[a-z0-9]/i.test(c) ? "_" : c)).join(" ")).join("     ") +
        (words.length > 1 ? `   (${words.length} words)` : ""); };
    function draw(note) {
      const solved = tries.length && matches(tries[tries.length - 1], r.a);
      const input = h("input", { type: "text", id: "riddle-answer", maxlength: 60, autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "Your answer", "aria-label": "Your answer" });
      const btn = h("button", { class: "btn", type: "submit" }, "Answer");
      const form = h("form", { class: "riddle-form", onsubmit: (e) => { e.preventDefault(); guess(input.value); } }, input, btn);
      put(area,
        h("p", { class: "quiz-prompt riddle-q" }, r.q),
        tries.length ? h("ul", { class: "riddle-tries" }, tries.map((t, i) => h("li", { class: matches(t, r.a) ? "is-right" : "is-wrong" }, `${i + 1}. ${t}`))) : null,
        !over && tries.length ? h("p", { class: "fineprint riddle-hint" }, hint()) : null,
        over ? h("p", { class: "word-msg" }, (solved ? "Correct! " : `The answer: ${first.charAt(0).toUpperCase() + first.slice(1)}. `) + r.e) : form,
        !over ? h("p", { class: "fineprint" }, `${TRIES - tries.length} ${TRIES - tries.length === 1 ? "try" : "tries"} left · worth ${POINTS[tries.length]} points`) : null,
        note ? h("p", { class: "fineprint" }, note) : null);
      if (!over) setTimeout(() => { const i = area.querySelector("#riddle-answer"); if (i) i.focus(); }, 0);
    }
    function guess(text) {
      if (over || !norm(text)) return;
      tries.push(String(text).trim().slice(0, 60)); store(key, tries);
      const right = matches(text, r.a);
      if (right || tries.length >= TRIES) {
        over = true;
        const pts = right ? POINTS[tries.length - 1] : 1;
        draw(`+${pts} ${pts === 1 ? "point" : "points"}. A new riddle in ${untilTomorrow()}.`);
        finish(ctx, def, board, status, pts);
      } else draw("Not quite – try again.");
    }
    (async function () {
      const prev = await playedToday(ctx, def.id);
      if (prev !== null) { over = true; draw(`You’ve answered today’s riddle (${prev} ${prev === 1 ? "point" : "points"}). A new one in ${untilTomorrow()}.`); return; }
      if (tries.length && (matches(tries[tries.length - 1], r.a) || tries.length >= TRIES)) {   // finished but not saved (e.g. offline): save now
        over = true; const right = matches(tries[tries.length - 1], r.a); const pts = right ? POINTS[tries.length - 1] : 1;
        draw(`+${pts} ${pts === 1 ? "point" : "points"}.`); finish(ctx, def, board, status, pts); return;
      }
      draw();
    })();
  }

  // ==================================================================
  // Shared: on-screen buttons that act while held (for steering)
  // ==================================================================
  function holdButton(h, label, onChange, cls) {
    const b = h("button", { class: "btn btn-quiet game-pad" + (cls ? " " + cls : ""), type: "button" }, label);
    const on = (e) => { e.preventDefault(); b.classList.add("is-held"); onChange(true); };
    const off = (e) => { if (e) e.preventDefault(); b.classList.remove("is-held"); onChange(false); };
    b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }
  function vanTop(g, x, y, ang, col) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(-7, -11, 16, 26);
    g.fillStyle = col || "#f2c200"; g.fillRect(-8, -13, 16, 26);
    g.fillStyle = "#1a222f"; g.fillRect(-6, -10, 12, 6);            // windscreen (front = up)
    g.fillStyle = "#ff8a00"; g.fillRect(-2, -2, 4, 3);              // roof beacon
    g.restore();
  }

  // ==================================================================
  // 9. Airside Driver
  // ==================================================================
  function airsideGame(main, ctx, def) {
    const { h } = ctx;
    const KMH = 0.4, LIMIT = 30, MAXV = 125;                 // display km/h = px/s × 0.4
    const ROADS = [[40, 90, 40, 510], [400, 90, 40, 510], [40, 90, 400, 40], [40, 560, 400, 40]];  // x, y, w, h
    const TAXI = { y: 290, h: 60 };                         // the taxiway the road crosses
    const HOLD = [{ y: 278 }, { y: 362 }];                  // hold lines either side of the taxiway
    // Stand boxes open straight off the road (each overlaps it slightly), so you can drive in.
    const BAYS = [
      { name: "Stand 1", x: 76, y: 158, w: 40, h: 40 }, { name: "Stand 2", x: 76, y: 438, w: 40, h: 40 },
      { name: "Stand 3", x: 208, y: 126, w: 44, h: 38 }, { name: "Stand 4", x: 364, y: 178, w: 40, h: 40 },
      { name: "Stand 5", x: 364, y: 468, w: 40, h: 40 }, { name: "Stand 6", x: 248, y: 522, w: 44, h: 42 }
    ];
    const LOADS = ["the GPU", "potable water", "the catering", "the lav truck", "the crew’s bags", "the air stairs"];
    const inRect = (x, y, r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
    const onRoad = (x, y) => ROADS.some((r) => inRect(x, y, r)) || BAYS.some((b) => inRect(x, y, [b.x, b.y, b.w, b.h]));
    const inTaxi = (y) => y >= TAXI.y && y <= TAXI.y + TAXI.h;

    const cv = makeCanvas(h, "Airside Driver. Arrow keys or the buttons to drive.");
    const { canvas, g } = cv;
    const ctl = { l: false, r: false, u: false, d: false };
    const pads = h("div", { class: "game-pads game-pads-drive" },
      holdButton(h, "◀", (v) => { ctl.l = v; }), holdButton(h, "▲ Go", (v) => { ctl.u = v; }), holdButton(h, "▼ Brake", (v) => { ctl.d = v; }), holdButton(h, "▶", (v) => { ctl.r = v; }));
    const { board, status } = shell(main, ctx, def,
      "Deliver to each stand and stop inside its box. Keep to the service road, under 30 km/h, and stop at the hold line before crossing the taxiway. Flashing amber lights and a red stop bar mean an aircraft is coming – wait until they go dark. Three violations end your shift – crossing in front of a taxiing aircraft ends it at once. Hold Brake after stopping to reverse.",
      canvas, pads);
    cv.size(); window.addEventListener("resize", cv.size);

    let mode = "ready", t = 0, msgAt = 0, score = 0, strikes = 0, x, y, ang, v, last, task, taskLeft, overSpeed = 0, cool = 0, stoppedAtHold = false, wasInTaxi = false, planes = [], spawnIn = 2, flash = null, why = "", brakeHeld = 0;
    function newTask() {
      let b; do { b = pickOne(BAYS); } while (task && b === task.bay);
      task = { bay: b, load: pickOne(LOADS) }; taskLeft = 32;
    }
    function start() { x = 60; y = 520; ang = 0; v = 0; last = { x, y }; score = 0; strikes = 0; planes = []; spawnIn = 2; overSpeed = 0; cool = 0; stoppedAtHold = false; wasInTaxi = false; task = null; newTask(); mode = "drive"; ctx.setStatus(status, ""); }
    function violation(text) {
      if (cool > 0) return;
      strikes++; cool = 2.5; flash = { text: `${text} (${strikes}/3)`, at: t, bad: true };
      if (strikes >= 3) end("Three violations – shift over");
    }
    function end(text) { mode = "over"; why = text; msgAt = t; v = 0; finish(ctx, def, board, status, score); }
    const unkeys = keys(canvas,
      (e) => { const k = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }[e.code];
        if (k) { ctl[k] = true; return true; }
        if (e.code === "Space" || e.code === "Enter") { if (mode === "ready" || (mode === "over" && t - msgAt > 0.8)) start(); return true; } },
      (e) => { const k = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }[e.code]; if (k) { ctl[k] = false; return true; } });
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus(); if (mode === "ready" || (mode === "over" && t - msgAt > 0.8)) start(); });

    function drawMap() {
      g.fillStyle = "#9aa3ab"; g.fillRect(0, 0, W, H);                          // apron concrete
      g.fillStyle = "#566a4a"; g.fillRect(0, 0, W, 70); g.fillRect(0, 620, W, 20); // grass
      // parked aircraft on the inner apron (keep off!)
      jetTop(g, 175, 220, 0, 1.25); jetTop(g, 300, 225, 0, 1.25); jetTop(g, 240, 455, Math.PI, 1.25);
      // taxiway
      g.fillStyle = "#3a4048"; g.fillRect(0, TAXI.y, W, TAXI.h);
      g.fillStyle = "#f2c200"; for (let xx = 0; xx < W; xx += 26) g.fillRect(xx, TAXI.y + TAXI.h / 2 - 1.5, 14, 3);
      g.fillStyle = "#2f7de1"; for (let xx = 10; xx < W; xx += 60) { g.beginPath(); g.arc(xx, TAXI.y + 3, 2.5, 0, 7); g.arc(xx, TAXI.y + TAXI.h - 3, 2.5, 0, 7); g.fill(); }
      // service roads
      ROADS.forEach((r) => { g.fillStyle = "#5b636c"; g.fillRect(r[0], r[1], r[2], r[3]); });
      g.fillStyle = "#f4f7f9";
      ROADS.forEach((r) => { if (r[2] > r[3]) { g.fillRect(r[0], r[1], r[2], 2); g.fillRect(r[0], r[1] + r[3] - 2, r[2], 2); } else { g.fillRect(r[0], r[1], 2, r[3]); g.fillRect(r[0] + r[2] - 2, r[1], 2, r[3]); } });
      // the road crossing the taxiway, and its hold lines
      [40, 400].forEach((rx) => { g.fillStyle = "#4a5058"; g.fillRect(rx, TAXI.y, 40, TAXI.h);
        HOLD.forEach((hl) => { for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? "#ffffff" : "#d62f2f"; g.fillRect(rx + k * 10, hl.y - 3, 10, 6); } }); });
      g.fillStyle = "#ffffff"; g.font = `700 9px ${FONT}`; g.textAlign = "center";
      [40, 400].forEach((rx) => { g.fillText("STOP", rx + 20, HOLD[0].y - 6); g.fillText("STOP", rx + 20, HOLD[1].y + 14); });
      // stand boxes
      BAYS.forEach((b) => {
        const target = task && task.bay === b;
        g.strokeStyle = target ? "#5fd0c3" : "rgba(255,255,255,0.7)"; g.lineWidth = target ? 3 : 1.5; g.setLineDash(target ? [] : [4, 3]);
        g.strokeRect(b.x, b.y, b.w, b.h); g.setLineDash([]);
        if (target) {
          g.fillStyle = `rgba(95,208,195,${0.25 + 0.15 * Math.sin(t * 5)})`; g.fillRect(b.x, b.y, b.w, b.h);
          const cx = b.x + b.w / 2, top = b.y - 8 + Math.sin(t * 5) * 2;
          g.fillStyle = "#5fd0c3"; g.beginPath(); g.moveTo(cx, top); g.lineTo(cx - 8, top - 12); g.lineTo(cx + 8, top - 12); g.closePath(); g.fill();
        }
        g.fillStyle = target ? "#0b5f57" : "#1a222f"; g.font = `700 9px ${FONT}`; g.fillText(b.name.replace("Stand ", "S"), b.x + b.w / 2, b.y + b.h / 2 + 3);
      });
    }
    // An aircraft is inbound to a crossing if it is heading for it and within about 4 seconds,
    // or still over it (wingspan included).
    function inbound(cx) {
      return planes.some((p) => { const d = (cx - p.x) * p.dir; return (d > -100 && d < p.sp * 4 + 100); });
    }
    // Runway-guard style lights: flashing amber either side of the hold line, and a red stop bar.
    function warningLights() {
      [40, 400].forEach((rx) => {
        const on = inbound(rx + 20), phase = Math.floor(t * 4) % 2;
        HOLD.forEach((hl) => {
          if (on) { g.save(); g.shadowColor = "#ff2a2a"; g.shadowBlur = 10; g.fillStyle = "#ff3b3b"; g.fillRect(rx + 2, hl.y - 2, 36, 4); g.restore(); }
          [[rx - 7, 0], [rx + 47, 1]].forEach(([lx, side]) => {
            const lit = on && phase === side;
            g.fillStyle = "#1a222f"; g.fillRect(lx - 5, hl.y - 6, 10, 12);
            g.save();
            if (lit) { g.shadowColor = "#ffb300"; g.shadowBlur = 16; }
            g.fillStyle = lit ? "#ffc21a" : on ? "#6b5a20" : "#3d434b";
            g.beginPath(); g.arc(lx, hl.y, 4, 0, 7); g.fill(); g.restore();
          });
        });
      });
    }
    function hud() {
      g.fillStyle = "rgba(26,34,47,0.88)"; g.fillRect(0, 0, W, 64);
      g.textAlign = "left"; g.fillStyle = "#ffffff"; g.font = `600 14px ${FONT}`;
      g.fillText(task && mode === "drive" ? `Take ${task.load} to ${task.bay.name} – stop in the teal box` : "Airside Driver", 12, 22);
      g.font = `500 12px ${FONT}`; g.fillStyle = "#a9ddd5";
      g.fillText(mode === "drive" ? `Time ${Math.ceil(Math.max(0, taskLeft))} s · Score ${score}` : `Score ${score}`, 12, 42);
      const kmh = Math.round(Math.abs(v) * KMH);
      g.textAlign = "right"; g.font = `700 22px ${FONT}`; g.fillStyle = kmh > LIMIT ? "#ff6b6b" : "#ffffff"; g.fillText(`${kmh}`, W - 80, 30);
      g.font = `500 11px ${FONT}`; g.fillStyle = "#a9ddd5"; g.fillText("km/h · limit 30", W - 80, 46);
      for (let i = 0; i < 3; i++) { g.fillStyle = i < strikes ? "#e5484d" : "#3a4b66"; g.beginPath(); g.arc(W - 54 + i * 18, 30, 6, 0, 7); g.fill(); }
    }

    stopCurrent = startLoop(canvas, function (dt) {
      t += dt; cool = Math.max(0, cool - dt);
      // aircraft taxiing along the taxiway
      if (mode !== "ready") {
        spawnIn -= dt;
        if (spawnIn <= 0 && planes.length < 2) { const dir = Math.random() < 0.5 ? 1 : -1; planes.push({ x: dir > 0 ? -140 : W + 140, dir, sp: 70 + Math.random() * 40 }); spawnIn = 5 + Math.random() * 5; }
        planes.forEach((p) => { p.x += p.dir * p.sp * dt; }); planes = planes.filter((p) => p.x > -200 && p.x < W + 200);
      }
      if (mode === "drive") {
        // Brake stops the van and holds it. Keep holding Brake for nearly a second once stopped to reverse.
        if (ctl.d && v <= 0.5) brakeHeld += dt; else brakeHeld = 0;
        if (ctl.u) v = Math.min(MAXV, v + 90 * dt);
        else if (ctl.d) v = v > 0.5 ? Math.max(0, v - 200 * dt) : brakeHeld > 0.8 ? Math.max(-30, v - 40 * dt) : Math.min(0, v + 200 * dt);
        else v = v > 0 ? Math.max(0, v - 35 * dt) : Math.min(0, v + 35 * dt);
        const turn = (ctl.r ? 1 : 0) - (ctl.l ? 1 : 0);
        ang += turn * 2.6 * Math.min(1, Math.abs(v) / 40) * Math.sign(v || 1) * dt;
        const nx = x + Math.sin(ang) * v * dt, ny = y - Math.cos(ang) * v * dt;
        x = nx; y = ny;
        // rules
        if (Math.abs(v) * KMH > LIMIT + 0.5) { overSpeed += dt; if (overSpeed > 1) { violation("Speeding – the limit is 30 km/h"); overSpeed = 0; } } else overSpeed = Math.max(0, overSpeed - dt);
        if (!onRoad(x, y)) { violation("Off the service road – keep to the grey road and stand boxes"); x = last.x; y = last.y; v = 0; } else last = { x, y };
        const nearHold = (y > HOLD[0].y - 34 && y < TAXI.y) || (y > TAXI.y + TAXI.h && y < HOLD[1].y + 34);
        if (nearHold && Math.abs(v) < 4) stoppedAtHold = true;
        const nowInTaxi = inTaxi(y);
        if (nowInTaxi && !wasInTaxi && !stoppedAtHold) violation("Didn’t stop at the hold line");
        if (!nowInTaxi && wasInTaxi) stoppedAtHold = false;
        if (!nowInTaxi && !nearHold) stoppedAtHold = false;
        wasInTaxi = nowInTaxi;
        if (nowInTaxi && planes.some((p) => Math.abs(p.x - x) < 95)) end("Taxiway incursion – aircraft have right of way");
        // the task
        taskLeft -= dt;
        const b = task.bay;
        if (mode === "drive" && inRect(x, y, [b.x, b.y, b.w, b.h]) && Math.abs(v) < 6) {
          const bonus = Math.round(Math.max(0, taskLeft)); score += 50 + bonus;
          flash = { text: `Delivered ${task.load} to ${b.name} +${50 + bonus}`, at: t, bad: false }; newTask();
        } else if (mode === "drive" && taskLeft <= 0) { flash = { text: `Too slow – ${task.load} went with someone else`, at: t, bad: true }; newTask(); }
      }
      drawMap();
      warningLights();
      planes.forEach((p) => jetTop(g, p.x, TAXI.y + TAXI.h / 2, p.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 1.35));
      if (x !== undefined) vanTop(g, x, y, ang);
      hud();
      if (flash && t - flash.at < 2.2) {
        g.globalAlpha = Math.min(1, 2.2 - (t - flash.at)); g.font = `600 14px ${FONT}`;
        const tw = g.measureText(flash.text).width + 24; g.fillStyle = flash.bad ? "rgba(229,72,77,0.92)" : "rgba(8,143,131,0.92)";
        g.fillRect(W / 2 - tw / 2, 76, tw, 30); g.fillStyle = "#ffffff"; g.textAlign = "center"; g.fillText(flash.text, W / 2, 96); g.globalAlpha = 1;
      }
      if (mode === "ready") overlay(g, "Airside Driver", ["Deliver to the stands – stop inside the box", "30 km/h · stop at hold lines · give way to aircraft", "Arrows or buttons to drive · tap to start"]);
      if (mode === "over") overlay(g, why.indexOf("incursion") !== -1 ? "Incursion!" : "Shift over", [why, `Score ${score}`, "Tap or press Space to drive again"]);
    }, () => { unkeys(); window.removeEventListener("resize", cv.size); });
  }

  // ==================================================================
  // 10. Pushback Pro
  // ==================================================================
  function pushbackGame(main, ctx, def) {
    const { h } = ctx;
    const ROUNDS = 5, S = 1.8, L = 32 * S, MAXD = 1.05, MAXV = 24, TY = 470;   // jet scale, wheelbase, max steering, max speed, taxiway centreline
    const cv = makeCanvas(h, "Pushback Pro. Arrow keys or the buttons to steer and push; Space when parked.");
    const { canvas, g } = cv;
    const ctl = { l: false, r: false, u: false, d: false };
    const done = h("button", { class: "btn game-pad", type: "button" }, "✓ Set brakes");
    const pads = h("div", { class: "game-pads game-pads-drive" },
      holdButton(h, "◀ Steer", (v) => { ctl.l = v; }), holdButton(h, "▲ Push", (v) => { ctl.u = v; }), holdButton(h, "▼ Slow", (v) => { ctl.d = v; }), holdButton(h, "Steer ▶", (v) => { ctl.r = v; }), done);
    const { board, status } = shell(main, ctx, def,
      "Push each jet back off its stand and onto the taxiway, finishing on the yellow centreline facing the way shown. You steer the nose, so the tail swings the other way. Stop, then set the brakes. Don’t hit the parked jets. Up to 100 points for accuracy, plus up to 30 for speed – the quicker and cleaner, the better.",
      canvas, pads);
    cv.size(); window.addEventListener("resize", cv.size);

    let mode = "ready", t = 0, msgAt = 0, n = 0, total = 0, results = [], mx, my, th, del, v, sx, face, neighbours, elapsed, res = null;
    // world point from a point on the jet (lx right, ly towards the tail), relative to the fuselage centre
    function centre() { return { x: mx + Math.sin(th) * 10 * S, y: my - Math.cos(th) * 10 * S }; }   // the fuselage centre is 10·S ahead of the main gear
    function pt(lx, ly) { const c = centre(), cs = Math.cos(th), sn = Math.sin(th); return { x: c.x + lx * cs - ly * sn, y: c.y + lx * sn + ly * cs }; }
    function setup() {
      sx = pickOne([170, 240, 310]); face = Math.random() < 0.5 ? 1 : -1;      // 1 = face east (right), −1 = west
      th = 0; mx = sx; my = 250; del = 0; v = 0; elapsed = 0;
      const gap = 128 - n * 3;
      neighbours = [{ x: sx - gap, y: 230 }, { x: sx + gap, y: 230 }].filter((nb) => nb.x > 20 && nb.x < W - 20);
    }
    function boxes() { // parked jets as rectangles: wings and fuselage
      const out = [];
      neighbours.forEach((nb) => { out.push([nb.x - 26 * S, nb.y - 4 * S, 52 * S, 14 * S]); out.push([nb.x - 6 * S, nb.y - 27 * S, 12 * S, 56 * S]); });
      out.push([0, 0, W, 34]);   // terminal building
      return out;
    }
    function hits() {
      const pts = [pt(-26 * S, 8 * S), pt(26 * S, 8 * S), pt(0, -28 * S), pt(0, 30 * S), pt(-11 * S, 27 * S), pt(11 * S, 27 * S)];
      if (pts.some((p) => p.x < 0 || p.x > W || p.y > H)) return "Off the apron";
      return boxes().some((r) => pts.some((p) => p.x > r[0] && p.x < r[0] + r[2] && p.y > r[1] && p.y < r[1] + r[3])) ? "Wingtip strike!" : null;
    }
    function score() {
      const target = face > 0 ? Math.PI / 2 : -Math.PI / 2;
      let err = Math.abs(((th - target + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI;
      const off = Math.abs(my - TY) / S * 0.5;                    // metres-ish off the centreline
      // Accuracy: up to 100. Time bonus: up to 30 (15 s or faster) down to 0 at 40 s,
      // scaled by accuracy so a rushed, sloppy finish doesn't pay.
      const acc = Math.round(Math.max(0, 100 - Math.max(0, off - 0.5) * 6 - err * 1.5));
      const bonus = Math.round(Math.max(0, Math.min(1, (40 - elapsed) / 25)) * 30 * acc / 100);
      return { pts: acc + bonus, acc, bonus, secs: elapsed, off, err };
    }
    function next() {
      if (mode === "ready") { n = 0; total = 0; results = []; setup(); mode = "push"; ctx.setStatus(status, ""); return; }
      if (mode === "result" && t - msgAt > 0.5) { n++; if (n >= ROUNDS) { mode = "done"; msgAt = t; finish(ctx, def, board, status, total); } else { setup(); mode = "push"; } return; }
      if (mode === "done" && t - msgAt > 0.8) mode = "ready";
    }
    function park() {
      if (mode !== "push") { next(); return; }
      if (Math.abs(v) > 0.5) { ctx.setStatus(status, "Stop first – then set the brakes.", true); return; }
      res = score(); total += res.pts; results.push(res.pts); res.word = res.acc >= 90 ? "Perfect pushback!" : res.acc >= 70 ? "Nicely done" : res.acc >= 40 ? "Acceptable" : "The crew are not impressed";
      mode = "result"; msgAt = t; ctx.setStatus(status, "");
    }
    done.addEventListener("click", park);
    const unkeys = keys(canvas,
      (e) => { const k = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }[e.code];
        if (k) { ctl[k] = true; return true; }
        if (e.code === "Space" || e.code === "Enter") { park(); return true; } },
      (e) => { const k = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" }[e.code]; if (k) { ctl[k] = false; return true; } });
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus(); if (mode !== "push") next(); });

    function scene() {
      g.fillStyle = "#9aa3ab"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#31415a"; g.fillRect(0, 0, W, 34); g.fillStyle = "#5fd0c3"; g.font = `700 13px ${FONT}`; g.textAlign = "center"; g.fillText("IAA FBO", W / 2, 22);
      // stands and lead-in lines
      [170, 240, 310].forEach((x) => { g.fillStyle = "#f2c200"; g.fillRect(x - 1.5, 60, 3, 300); g.fillRect(x - 14, 156, 28, 3); });
      // taxiway
      g.fillStyle = "#3a4048"; g.fillRect(0, TY - 50, W, 100);
      g.fillStyle = "#f2c200"; g.fillRect(0, TY - 2, W, 4);
      g.fillStyle = "#2f7de1"; for (let x = 10; x < W; x += 50) { g.beginPath(); g.arc(x, TY - 47, 2.5, 0, 7); g.arc(x, TY + 47, 2.5, 0, 7); g.fill(); }
      // which way to face
      if (mode === "push" || mode === "result") {
        g.fillStyle = "rgba(95,208,195,0.9)"; const ax = face > 0 ? W - 60 : 60;
        g.beginPath(); g.moveTo(ax + face * 26, TY); g.lineTo(ax - face * 6, TY - 16); g.lineTo(ax - face * 6, TY + 16); g.closePath(); g.fill();
        g.fillStyle = "#ffffff"; g.font = `700 12px ${FONT}`; g.fillText(face > 0 ? "FACE EAST" : "FACE WEST", ax - face * 8, TY - 24);
      }
      neighbours && neighbours.forEach((nb) => jetTop(g, nb.x, nb.y + 3 * S, 0, S, "#3a4b66"));
    }
    function tug() {
      const nose = pt(0, -30 * S);
      g.save(); g.translate(nose.x, nose.y); g.rotate(th + del);
      g.fillStyle = "#1a222f"; g.fillRect(-9, -26, 18, 24); g.fillStyle = "#f2c200"; g.fillRect(-9, -26, 18, 4);
      g.restore();
    }
    function hud() {
      g.fillStyle = "rgba(10,16,26,0.6)"; g.fillRect(10, H - 74, W - 20, 62);
      g.fillStyle = "#ffffff"; g.textAlign = "left"; g.font = `600 14px ${FONT}`;
      g.fillText(`Pushback ${Math.min(n + 1, ROUNDS)} of ${ROUNDS} · Score ${total}`, 22, H - 50);
      if (mode === "push") { g.textAlign = "right"; g.fillStyle = elapsed <= 15 ? "#5fd0c3" : elapsed < 40 ? "#ffffff" : "#ff9b9b"; g.fillText(`⏱ ${elapsed.toFixed(1)} s`, W - 22, H - 50); g.textAlign = "left"; }
      g.font = `500 12px ${FONT}`; g.fillStyle = "#a9ddd5";
      g.fillText(`Speed ${(v * 0.25).toFixed(1)} km/h · Steering ${Math.round(del * 57)}° · Off centreline ${(Math.abs(my - TY) / S * 0.5).toFixed(1)} m`, 22, H - 30);
    }

    setup(); mode = "ready";
    stopCurrent = startLoop(canvas, function (dt) {
      t += dt;
      if (mode === "push") {
        elapsed += dt;
        const steer = (ctl.r ? 1 : 0) - (ctl.l ? 1 : 0);
        del += steer ? steer * 1.4 * dt : -del * Math.min(1, 1.6 * dt);
        del = Math.max(-MAXD, Math.min(MAXD, del));
        if (ctl.u) v = Math.min(MAXV, v + 14 * dt); else if (ctl.d) v = Math.max(0, v - 30 * dt); else v = Math.max(0, v - 4 * dt);
        // pushed backwards: the main gear moves tail-first; the nose wheel angle turns the aircraft
        mx -= Math.sin(th) * v * dt; my += Math.cos(th) * v * dt;
        th -= (v / L) * Math.tan(del) * dt;
        const hit = hits();
        if (hit) { res = { pts: 0, word: hit, off: 0, err: 0, crash: true }; results.push(0); mode = "result"; msgAt = t; v = 0; }
      }
      scene();
      jetTop(g, centre().x, centre().y, th, S);
      if (mode !== "ready") tug();
      hud();
      if (mode === "ready") overlay(g, "Pushback Pro", ["Five pushbacks onto the taxiway", "◀ ▶ steer the nose · ▲ push · ▼ slow", "Stop on the centreline, then set the brakes", "Tap or press Space to begin"]);
      if (mode === "result" && res) overlay(g, res.word, res.crash ? ["0 points for this pushback", n + 1 >= ROUNDS ? "Tap for your total" : "Tap for the next aircraft"]
        : [`${res.pts} points: ${res.acc} accuracy + ${res.bonus} time bonus`, `${res.off.toFixed(1)} m off the centreline · ${Math.round(res.err)}° off heading · ${Math.round(res.secs)} s`, n + 1 >= ROUNDS ? "Tap for your total" : "Tap for the next aircraft"]);
      if (mode === "done") overlay(g, `Total ${total}`, [results.join(" · "), `Best ${Math.max(board.best, total)}`, "Tap to push again"]);
    }, () => { unkeys(); window.removeEventListener("resize", cv.size); });
  }

  window.IAAGame = { render: render };
})();
