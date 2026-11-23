/* Iceland Aero Agents – Staff Portal
   Flight game: fly the jet through the gaps between storm clouds and
   mountains. Tap, click or press Space to climb. Scores go on a staff
   leaderboard (this month and all time). Needs database update 37. */
(function () {
  "use strict";

  const W = 480, H = 640;            // game area in game units (scaled to fit)
  const GROUND = 40;                  // height of the runway strip at the bottom
  const GRAVITY = 1500, FLAP = -430;  // units per second² / per second
  const MAX_SCORE = 999;

  let stopLoop = null;

  function today() { return new Date(); }
  function monthStart() { const d = today(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }

  // ------------------------------------------------------------------
  // Leaderboard
  // ------------------------------------------------------------------
  function best(rows) {
    const by = {};
    rows.forEach((r) => { if (!by[r.profile_id] || r.score > by[r.profile_id].score) by[r.profile_id] = r; });
    return Object.values(by).sort((a, b) => b.score - a.score || String(a.played_at).localeCompare(String(b.played_at)));
  }
  async function loadBoard(ctx) {
    const [all, month] = await Promise.all([
      ctx.db.from("game_scores").select("profile_id, player_name, score, played_at").order("score", { ascending: false }).limit(500),
      ctx.db.from("game_scores").select("profile_id, player_name, score, played_at").gte("played_at", monthStart()).order("score", { ascending: false }).limit(500)
    ]);
    if (all.error) return { error: all.error.message };
    return { all: best(all.data || []), month: best(month.data || []) };
  }
  function boardTable(h, rows, me, title) {
    const top = rows.slice(0, 10);
    const mineIdx = rows.findIndex((r) => r.profile_id === me);
    return h("div", { class: "game-board-col" },
      h("h3", null, title),
      top.length
        ? h("ol", { class: "game-board" }, top.map((r) => h("li", { class: r.profile_id === me ? "is-me" : null },
            h("span", { class: "game-name" }, r.player_name || "Player"), h("span", { class: "game-score" }, String(r.score)))))
        : h("p", { class: "fineprint" }, "No scores yet. Be the first!"),
      mineIdx >= 10 ? h("p", { class: "fineprint" }, `You: ${mineIdx + 1}. place with ${rows[mineIdx].score}`) : null);
  }

  // ------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------
  function drawSky(g, t, dark) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    if (dark) { sky.addColorStop(0, "#0b1424"); sky.addColorStop(0.6, "#1a2a44"); sky.addColorStop(1, "#2d4060"); }
    else { sky.addColorStop(0, "#1d3550"); sky.addColorStop(0.55, "#3e6d8c"); sky.addColorStop(1, "#e7b78a"); }
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // northern lights
    g.save(); g.globalAlpha = dark ? 0.55 : 0.35;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const y = 90 + i * 26 + Math.sin(x / 70 + t * 0.4 + i) * 18 + Math.sin(x / 31 + t * 0.7) * 6;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.lineTo(W, 0); g.lineTo(0, 0); g.closePath();
      const a = g.createLinearGradient(0, 40, 0, 170);
      a.addColorStop(0, "rgba(95,208,195,0)"); a.addColorStop(1, i === 1 ? "rgba(120,230,160,0.55)" : "rgba(95,208,195,0.45)");
      g.fillStyle = a; g.fill();
    }
    g.restore();
  }
  function drawHills(g, offset, dark) {
    // distant mountains, moving slowly
    g.fillStyle = dark ? "#16243a" : "#2b4458";
    g.beginPath(); g.moveTo(0, H - GROUND);
    for (let x = 0; x <= W + 40; x += 40) {
      const k = (x + offset * 0.25) / 40;
      g.lineTo(x, H - GROUND - 70 - Math.abs(Math.sin(k * 1.3)) * 60 - Math.abs(Math.sin(k * 0.37)) * 40);
    }
    g.lineTo(W, H - GROUND); g.closePath(); g.fill();
  }
  function drawGround(g, offset, dark) {
    g.fillStyle = dark ? "#1b2330" : "#2a3240"; g.fillRect(0, H - GROUND, W, GROUND);
    g.fillStyle = "#f1f6f8";
    for (let x = -((offset * 1) % 48); x < W; x += 48) g.fillRect(x, H - GROUND / 2 - 2, 26, 4);   // runway centre line
    g.fillStyle = "#5fd0c3"; g.fillRect(0, H - GROUND, W, 3);
  }
  function cloudColumn(g, x, w, h) {
    g.fillStyle = "#c9d3dc"; g.fillRect(x, 0, w, h - 18);
    g.fillStyle = "#e9eef2";
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x + 10 + i * (w - 20) / 3, h - 18, 16, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "rgba(60,80,100,0.25)"; g.fillRect(x, 0, 6, h - 18);
  }
  function mountainColumn(g, x, w, top) {
    g.fillStyle = "#3b3f46";
    g.beginPath(); g.moveTo(x - 6, H - GROUND); g.lineTo(x + w * 0.2, top + 10); g.lineTo(x + w * 0.5, top); g.lineTo(x + w * 0.8, top + 12); g.lineTo(x + w + 6, H - GROUND); g.closePath(); g.fill();
    g.fillStyle = "#f4f7f9";   // snow cap
    g.beginPath(); g.moveTo(x + w * 0.2, top + 10); g.lineTo(x + w * 0.5, top); g.lineTo(x + w * 0.8, top + 12); g.lineTo(x + w * 0.66, top + 24); g.lineTo(x + w * 0.5, top + 16); g.lineTo(x + w * 0.34, top + 26); g.closePath(); g.fill();
  }
  function drawJet(g, y, vy) {
    g.save(); g.translate(110, y); g.rotate(Math.max(-0.45, Math.min(0.7, vy / 700)));
    g.fillStyle = "#f4f7f9";                                   // fuselage
    g.beginPath(); g.ellipse(0, 0, 30, 8, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(26, -6); g.quadraticCurveTo(40, 0, 26, 6); g.fill();   // nose
    g.fillStyle = "#088f83";                                   // tail
    g.beginPath(); g.moveTo(-22, -4); g.lineTo(-34, -22); g.lineTo(-26, -22); g.lineTo(-14, -5); g.closePath(); g.fill();
    g.fillStyle = "#cfd8df";                                   // wing
    g.beginPath(); g.moveTo(-4, 2); g.lineTo(-16, 16); g.lineTo(-8, 16); g.lineTo(8, 3); g.closePath(); g.fill();
    g.fillStyle = "#1a222f";                                   // windows
    g.fillRect(18, -4, 6, 3);
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-8 + i * 7, -2, 1.6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "#088f83"; g.fillRect(-26, 1, 44, 2);        // cheatline
    g.restore();
  }

  // ------------------------------------------------------------------
  // Page
  // ------------------------------------------------------------------
  async function render(main, ctx) {
    const { h, fill, pageHead, state, setStatus } = ctx;
    if (stopLoop) stopLoop();
    const me = state.profile.id;
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

    const canvas = h("canvas", { class: "game-canvas", tabindex: "0", "aria-label": "Flight game. Press Space or tap to climb." });
    const boardBox = h("div", { class: "game-boards" }, h("p", { class: "fineprint" }, "Loading the leaderboard…"));
    const status = h("p", { class: "status", role: "status" });
    let myBest = 0;

    async function drawBoard() {
      const b = await loadBoard(ctx);
      if (b.error) { boardBox.replaceChildren(h("p", { class: "fineprint" }, "The leaderboard isn’t set up yet (database update 37).")); return; }
      const mine = b.all.find((r) => r.profile_id === me);
      myBest = Math.max(myBest, mine ? mine.score : 0);
      boardBox.replaceChildren(boardTable(h, b.month, me, "This month"), boardTable(h, b.all, me, "All time"));
    }

    fill(main,
      pageHead("Flight game", "Fly through the gaps between the storm clouds and the mountains. Tap, click or press Space to climb."),
      h("div", { class: "game-layout" },
        h("section", { class: "panel game-panel" }, canvas, status),
        h("section", { class: "panel" }, h("h2", null, "Leaderboard"), boardBox,
          h("p", { class: "fineprint" }, "Your best score counts. For breaks only – never on the ramp or while on duty with aircraft."))));
    drawBoard();

    // --- canvas sizing (sharp on retina screens)
    const g = canvas.getContext("2d");
    function size() {
      const dpr = window.devicePixelRatio || 1;
      const box = canvas.parentElement, cs = getComputedStyle(box);
      const inner = box.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      const cssW = Math.max(200, Math.min(inner - 2, W));
      canvas.style.width = cssW + "px"; canvas.style.height = (cssW * H / W) + "px";
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssW * H / W * dpr);
      g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    }
    size();
    window.addEventListener("resize", size);

    // --- game state
    let mode = "ready", y = H / 2, vy = 0, obs = [], score = 0, dist = 0, t = 0, spawnIn = 0, last = null, saved = false;
    function reset() { mode = "ready"; y = H / 2; vy = 0; obs = []; score = 0; dist = 0; spawnIn = 0.6; saved = false; setStatus(status, ""); }
    function speed() { return 170 + Math.min(score, 60) * 3.2; }
    function gap() { return Math.max(140, 205 - score * 1.6); }
    function flap() {
      if (mode === "over") { if (t - overAt > 0.6) reset(); return; }
      if (mode === "ready") mode = "play";
      vy = FLAP;
    }
    let overAt = 0;
    async function crash() {
      mode = "over"; overAt = t;
      if (score > 0 && !saved) {
        saved = true;
        const s = Math.min(score, MAX_SCORE);
        const { error } = await ctx.db.from("game_scores").insert({ score: s });
        if (error) setStatus(status, "Your score couldn’t be saved: " + error.message, true);
        else { const nb = s > myBest; myBest = Math.max(myBest, s); setStatus(status, nb ? `New personal best: ${s}!` : `Score ${s}. Your best is ${myBest}.`); drawBoard(); }
      }
    }

    // --- controls
    const onKey = (e) => {
      if (!canvas.isConnected) return;
      if ((e.code === "Space" || e.code === "ArrowUp") && !/^(input|textarea|select|button)$/i.test(e.target.tagName)) { e.preventDefault(); flap(); }
    };
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.focus(); flap(); });

    // --- loop
    let raf = 0, alive = true;
    function frame(now) {
      if (!alive) return;
      if (!canvas.isConnected) { stop(); return; }
      if (last === null) last = now;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;

      if (mode === "play") {
        vy += GRAVITY * dt; y += vy * dt;
        const v = speed(); dist += v * dt;
        spawnIn -= dt;
        if (spawnIn <= 0) {
          const gp = gap(), margin = 70;
          const centre = margin + gp / 2 + Math.random() * (H - GROUND - 2 * margin - gp);
          obs.push({ x: W + 10, w: 64, top: centre - gp / 2, bottom: centre + gp / 2, passed: false });
          spawnIn = 1.55 - Math.min(score, 40) * 0.008;
        }
        obs.forEach((o) => { o.x -= v * dt; if (!o.passed && o.x + o.w < 110 - 20) { o.passed = true; score++; } });
        obs = obs.filter((o) => o.x + o.w > -20);
        // collisions: a slightly forgiving box around the jet
        const hit = y + 9 > H - GROUND || y - 9 < 0 || obs.some((o) => 110 + 26 > o.x + 4 && 110 - 26 < o.x + o.w - 4 && (y - 7 < o.top || y + 7 > o.bottom));
        if (hit) { y = Math.min(y, H - GROUND - 9); crash(); }
      } else if (mode === "ready") {
        y = H / 2 + Math.sin(t * 3) * 8; dist += 60 * dt;
      } else if (mode === "over") {
        if (y < H - GROUND - 9) { vy += GRAVITY * dt; y = Math.min(H - GROUND - 9, y + vy * dt); }
      }

      // --- draw
      drawSky(g, t, dark); drawHills(g, dist, dark);
      obs.forEach((o) => { cloudColumn(g, o.x, o.w, o.top); mountainColumn(g, o.x, o.w, o.bottom); });
      drawGround(g, dist, dark);
      drawJet(g, y, mode === "ready" ? 0 : vy);
      g.fillStyle = "#ffffff"; g.textAlign = "center";
      g.save(); g.shadowColor = "rgba(10,16,26,0.75)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
      g.font = "700 44px Barlow, 'Segoe UI', sans-serif"; g.fillText(String(score), W / 2, 70); g.restore();
      if (mode !== "play") {
        g.fillStyle = "rgba(10,16,26,0.55)"; g.fillRect(60, H / 2 - 96, W - 120, 150);
        g.fillStyle = "#ffffff";
        g.font = "700 26px Barlow, 'Segoe UI', sans-serif";
        g.fillText(mode === "ready" ? "Ready for departure" : "Go-around!", W / 2, H / 2 - 52);
        g.font = "500 17px Barlow, 'Segoe UI', sans-serif";
        g.fillText(mode === "ready" ? "Tap, click or press Space to climb" : `Score ${score} · best ${Math.max(myBest, score)}`, W / 2, H / 2 - 18);
        if (mode === "over") g.fillText("Tap or press Space to fly again", W / 2, H / 2 + 16);
      }
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      alive = false; cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey); window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", onVis);
    }
    stopLoop = stop;
    // Pause cleanly when the tab is hidden (no huge jump when coming back).
    const onVis = () => { last = null; };
    document.addEventListener("visibilitychange", onVis);
    reset(); raf = requestAnimationFrame(frame);
  }

  window.IAAGame = { render: render };
})();
