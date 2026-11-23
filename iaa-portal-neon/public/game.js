/* Iceland Aero Agents – Staff Portal
   Games: Flight, Crosswind Landing, Marshal Me In and Apron Tetris.
   Each game has its own staff leaderboard (this month and all time).
   For breaks only. Needs database updates 37 and 38. */
(function () {
  "use strict";

  const W = 480, H = 640;           // every game draws on a 480 × 640 area, scaled to fit
  const MAX_SCORE = 999;
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
  async function loadBoard(ctx, game) {
    const cols = "profile_id, player_name, score, played_at";
    const q = () => ctx.db.from("game_scores").select(cols).eq("game", game);
    const [all, month] = await Promise.all([
      q().order("score", { ascending: false }).limit(500),
      q().gte("played_at", monthStart()).order("score", { ascending: false }).limit(500)
    ]);
    if (all.error) return { error: all.error.message };
    return { all: bestPerPerson(all.data || []), month: bestPerPerson(month.data || []) };
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
          h("p", { class: "fineprint" }, "Your best score counts. For breaks only – never on the ramp or while on duty with aircraft."))));
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
    { id: "apron", icon: "🅿️", title: "Apron Tetris", blurb: "Park every arriving jet nose-in on a busy apron until it’s full.", play: apronGame }
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
          h("span", { class: "game-card-best" }, bests[d.id] ? `Your best: ${bests[d.id]}` : "Not played yet")),
        h("span", { class: "btn btn-small" }, "Play"))));
    }
    draw();
    fill(main, pageHead("Games", "Short aviation games for your break, each with a staff leaderboard."), cards,
      h("p", { class: "fineprint" }, "For breaks only – never on the ramp or while on duty with aircraft."));
    const r = await ctx.db.from("game_scores").select("game, score").eq("profile_id", me).order("score", { ascending: false }).limit(200);
    if (!r.error) { (r.data || []).forEach((x) => { const k = x.game || "flight"; if (!bests[k] || x.score > bests[k]) bests[k] = x.score; }); draw(); }
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
  // 4. Apron Tetris – park arriving jets nose-in on the taxi lanes
  // ==================================================================
  function apronGame(main, ctx, def) {
    const { h } = ctx;
    const COLS = 20, ROWS = 21, CELL = 24, TOP = 70;      // grid 20 × 21 cells of 5 m, starting 70 px down
    const LANES = [10, 20];                               // taxi lane rows
    // Types: length and span in 5 m cells (odd spans keep the fuselage centred). Points by size.
    const TYPES = [
      { name: "Phenom 300", L: 3, S: 3, pts: 10, w: 3 },
      { name: "Citation CJ3", L: 3, S: 3, pts: 10, w: 3 },
      { name: "Challenger 350", L: 4, S: 5, pts: 15, w: 3 },
      { name: "Falcon 7X", L: 5, S: 5, pts: 20, w: 2 },
      { name: "Gulfstream G650", L: 6, S: 7, pts: 25, w: 2 },
      { name: "Global 7500", L: 7, S: 7, pts: 30, w: 1 }
    ];
    const cv = makeCanvas(h, "Apron Tetris. Click or tap a spot next to a taxi lane to park the jet.");
    const { canvas, g } = cv;
    const flip = h("button", { class: "btn btn-quiet game-pad", type: "button" }, "↕ Face the other lane");
    const { board, status } = shell(main, ctx, def,
      "Park every arriving jet nose-in against a yellow taxi lane, so it can taxi out. Click or tap where you want it – it snaps to the nearest lane – and fit wings and tails together. When the next jet won’t fit anywhere, the apron is full.",
      canvas, h("div", { class: "game-pads" }, flip));
    cv.size(); window.addEventListener("resize", cv.size);

    let grid, parkedList, queue, score, mode = "ready", hover = null, t = 0, msgAt = 0;
    function pick() { const tot = TYPES.reduce((a, b) => a + b.w, 0); let r = Math.random() * tot; for (const ty of TYPES) { if ((r -= ty.w) < 0) return ty; } return TYPES[0]; }
    function reg() { const L = "ABCDEFGHIJKLMNOPRSTUVY"; return "TF-" + Array.from({ length: 3 }, () => L[Math.floor(Math.random() * L.length)]).join(""); }
    // Cells of a jet with its nose at (0,0), nose pointing up (dir −1) or down (dir +1).
    function shape(ty, dir) {
      const c = (ty.S - 1) / 2, cells = [], wingRow = Math.max(1, Math.floor(ty.L * 0.4));
      for (let r = 0; r < ty.L; r++) cells.push([0, r]);
      for (let k = 0; k < ty.S; k++) if (k !== c) cells.push([k - c, wingRow]);
      if (ty.S >= 5) for (let k = 1; k < ty.S - 1; k++) if (k !== c) cells.push([k - c, wingRow + 1]);
      if (ty.S >= 5) { cells.push([-1, ty.L - 1]); cells.push([1, ty.L - 1]); }
      return cells.map(([dx, r]) => [dx, dir < 0 ? r : -r]);
    }
    // Stand positions: nose row next to a lane – (row, dir). Nose up sits below a lane, nose down above it.
    const EDGES = [{ row: 9, dir: 1 }, { row: 11, dir: -1 }, { row: 19, dir: 1 }];
    function cellsAt(ty, col, edge) { return shape(ty, edge.dir).map(([dx, dr]) => [col + dx, edge.row + dr]); }
    function fits(cells) { return cells.every(([c, r]) => c >= 0 && c < COLS && r >= 0 && r < ROWS && LANES.indexOf(r) === -1 && !grid[r][c]); }
    function anyFit(ty) { return EDGES.some((e) => { for (let c = 0; c < COLS; c++) if (fits(cellsAt(ty, c, e))) return true; return false; }); }
    function start() {
      grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      parkedList = []; queue = [pick(), pick(), pick()]; score = 0; mode = "play"; ctx.setStatus(status, "");
    }
    function nearestEdge(p) {
      const row = (p.y - TOP) / CELL;
      let best = EDGES[0], d = 1e9;
      EDGES.forEach((e) => { const centre = e.row + (e.dir > 0 ? -1 : 1) * 2; const dd = Math.abs(row - centre); if (dd < d) { d = dd; best = e; } });
      if (flipped && best.row === 11) best = EDGES[2]; else if (flipped && best.row === 19) best = EDGES[1];
      return best;
    }
    let flipped = false;
    flip.addEventListener("click", () => { flipped = !flipped; });
    function place(p) {
      if (mode === "ready") { start(); return; }
      if (mode === "over") { if (t - msgAt > 0.8) mode = "ready"; return; }
      const ty = queue[0], col = Math.floor(p.x / CELL), edge = nearestEdge(p), cells = cellsAt(ty, col, edge);
      if (!fits(cells)) { ctx.setStatus(status, `The ${ty.name} doesn’t fit there.`, true); return; }
      const id = parkedList.length + 1;
      cells.forEach(([c, r]) => { grid[r][c] = id; });
      parkedList.push({ ty, col, edge, reg: reg() });
      score += ty.pts; queue.shift(); queue.push(pick()); flipped = false;
      ctx.setStatus(status, `${ty.name} parked (+${ty.pts}).`);
      if (!anyFit(queue[0])) { mode = "over"; msgAt = t; finish(ctx, def, board, status, score); }
    }
    canvas.addEventListener("pointermove", (e) => { hover = cv.point(e); });
    canvas.addEventListener("pointerleave", () => { hover = null; });
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus(); hover = cv.point(e); place(hover); });
    const unkeys = keys(canvas, (e) => {
      if (e.code === "KeyR" || e.code === "KeyF") { flipped = !flipped; return true; }
      if (e.code === "Space" && mode !== "play") { place({ x: W / 2, y: H / 2 }); return true; }
    });

    function jetCells(ty, col, edge, ghost, ok, regText) {
      // draw the aircraft over its cells as a smooth top-down silhouette
      const cx = col * CELL + CELL / 2, ny = TOP + edge.row * CELL + CELL / 2, len = ty.L * CELL, span = ty.S * CELL;
      g.save(); g.translate(cx, ny + (edge.dir < 0 ? len / 2 - CELL / 2 : -(len / 2 - CELL / 2))); if (edge.dir > 0) g.rotate(Math.PI);
      g.globalAlpha = ghost ? 0.6 : 1;
      const body = ghost ? (ok ? "#c9f2ea" : "#f6c1bc") : "#f4f7f9", wing = ghost ? (ok ? "#9fdcd2" : "#eaa29b") : "#dce3e8";
      const wr = -len / 2 + Math.max(1, Math.floor(ty.L * 0.4)) * CELL;
      g.fillStyle = wing;
      g.beginPath(); g.moveTo(-span / 2 + 2, wr + CELL * 0.9); g.lineTo(-CELL * 0.4, wr - CELL * 0.1); g.lineTo(CELL * 0.4, wr - CELL * 0.1); g.lineTo(span / 2 - 2, wr + CELL * 0.9); g.lineTo(span / 2 - 2, wr + CELL * 1.2); g.lineTo(-span / 2 + 2, wr + CELL * 1.2); g.closePath(); g.fill();
      const tw = ty.S >= 5 ? CELL * 1.4 : CELL * 0.9;
      g.beginPath(); g.moveTo(-tw, len / 2 - 4); g.lineTo(-CELL * 0.2, len / 2 - CELL * 0.7); g.lineTo(CELL * 0.2, len / 2 - CELL * 0.7); g.lineTo(tw, len / 2 - 4); g.closePath(); g.fill();
      g.fillStyle = body; g.beginPath(); g.ellipse(0, 0, CELL * 0.32, len / 2 - 1, 0, 0, Math.PI * 2); g.fill();
      if (!ghost) { g.fillStyle = "#088f83"; g.fillRect(-1.5, len / 2 - CELL * 0.8, 3, CELL * 0.7); g.fillStyle = "#1a222f"; g.fillRect(-3, -len / 2 + 6, 6, 3); }
      g.restore();
      if (regText && !ghost) { g.fillStyle = "#1a222f"; g.font = `600 9px ${FONT}`; g.textAlign = "center"; g.fillText(regText, cx, ny + (edge.dir < 0 ? len - CELL * 0.2 : -len + CELL * 1.2)); }
    }
    function draw() {
      g.fillStyle = "#263449"; g.fillRect(0, 0, W, H);
      // FBO building and header
      g.fillStyle = "#31415a"; g.fillRect(0, 0, W, TOP - 8);
      g.fillStyle = "#5fd0c3"; g.font = `700 18px ${FONT}`; g.textAlign = "left"; g.fillText("IAA FBO · apron", 14, 26);
      g.fillStyle = "#ffffff"; g.font = `600 14px ${FONT}`;
      g.fillText(mode === "play" ? `Now: ${queue[0].name} (+${queue[0].pts})` : "", 14, 50);
      g.textAlign = "right"; g.fillStyle = "#a9ddd5"; g.font = `500 13px ${FONT}`;
      g.fillText(mode === "play" ? `Next: ${queue[1].name}, ${queue[2].name}` : "", W - 14, 50);
      g.fillStyle = "#ffffff"; g.font = `700 22px ${FONT}`; g.fillText(String(score || 0), W - 14, 28);
      // apron concrete, lanes and stand lines
      g.fillStyle = "#9aa3ab"; g.fillRect(0, TOP, W, ROWS * CELL);
      g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1;
      for (let r = 0; r <= ROWS; r++) { g.beginPath(); g.moveTo(0, TOP + r * CELL); g.lineTo(W, TOP + r * CELL); g.stroke(); }
      for (let c = 0; c <= COLS; c++) { g.beginPath(); g.moveTo(c * CELL, TOP); g.lineTo(c * CELL, TOP + ROWS * CELL); g.stroke(); }
      LANES.forEach((r) => {
        g.fillStyle = "#3a4048"; g.fillRect(0, TOP + r * CELL, W, CELL);
        g.fillStyle = "#f2c200"; for (let x = 0; x < W; x += 28) g.fillRect(x, TOP + r * CELL + CELL / 2 - 1.5, 16, 3);
      });
      // parked jets
      if (parkedList) parkedList.forEach((p) => jetCells(p.ty, p.col, p.edge, false, true, p.reg));
      // ghost of the next jet under the pointer
      if (mode === "play" && hover && hover.y > TOP) {
        const ty = queue[0], col = Math.floor(hover.x / CELL), edge = nearestEdge(hover), cells = cellsAt(ty, col, edge), ok = fits(cells);
        jetCells(ty, col, edge, true, ok);
      }
      if (mode === "ready") overlay(g, "Apron Tetris", ["Park each jet nose-in against a taxi lane", "Click or tap where it should go", "Tap or press Space to open the apron"]);
      if (mode === "over") overlay(g, "Apron full!", [`The ${queue[0].name} has to divert to BIKF`, `${parkedList.length} jets parked · ${score} points`, "Tap or press Space to play again"]);
    }

    stopCurrent = startLoop(canvas, function (dt) { t += dt; draw(); }, () => { unkeys(); window.removeEventListener("resize", cv.size); });
  }

  window.IAAGame = { render: render };
})();
