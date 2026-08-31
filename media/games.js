// Micro-game engine for the Between Trains waiting room.
// Vanilla JS + canvas, loaded with a CSP nonce before waiting-room.js.
//
// Design rules (product brief §11.3): one simple mechanic, playable in 20–60s,
// pause-less and disposable, no long progression, no penalty for interruption,
// no login, no remote dependency.
//
// Registry contract: window.BTGames.has(modeId) / window.BTGames.create(modeId,
// host, api) → { destroy(), setVisible(visible) }. `api.started(gameId)` and
// `api.completed(gameId, score)` report runs for local metadata only.
(function () {
  "use strict";

  const factories = {};

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  }

  function theme() {
    return {
      fg: cssVar("--vscode-foreground", "#cccccc"),
      dim: cssVar("--vscode-descriptionForeground", "#8f8f8f"),
      accent: cssVar("--vscode-progressBar-background", "#4a9eff"),
      danger: cssVar("--vscode-errorForeground", "#f14c4c"),
      warn: cssVar("--vscode-editorWarning-foreground", "#cca700"),
      line: cssVar("--vscode-panel-border", "rgba(128,128,128,0.35)"),
    };
  }

  function createCanvas(host, maxW, height) {
    const width = Math.max(280, Math.min(host.clientWidth || maxW, maxW));
    const canvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.className = "bt-canvas";
    canvas.tabIndex = 0;
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { canvas, ctx, w: width, h: height };
  }

  // =========================================================================
  // Meteor Dodge — move left/right, survive the meteor shower.
  // =========================================================================
  factories["microgame.meteorDodge"] = function (host, api) {
    // This game runs at 1.5× the base size, so it needs a wider host than the
    // shared 460px cap. Widen it before measuring, then build a 690×450 canvas.
    host.style.maxWidth = "720px";
    const { canvas, ctx, w, h } = createCanvas(host, 690, 450);
    const colors = theme();
    const GAME_ID = "microgame.meteorDodge";

    // Everything scales off the base 460px design width so sprites and speeds
    // grow with the canvas instead of leaving empty space.
    const S = w / 460;
    const SHIP_W = 26 * S;
    const SHIP_H = 18 * S;
    const SHIP_Y = h - 34 * S;
    const BULLET_R = 2.6 * S;
    const BULLET_SPEED = 440 * S;
    const FIRE_COOLDOWN = 0.16; // seconds between shots

    // Score combines survival and marksmanship: points tick up over time and
    // each shattered meteor is worth a fixed bonus.
    const TIME_POINTS_PER_SEC = 10;
    const HIT_POINTS = 25;
    const scoreNow = () => Math.floor(elapsed * TIME_POINTS_PER_SEC) + broken * HIT_POINTS;

    let ship = { x: w / 2, target: w / 2 };
    let meteors = [];
    let bullets = [];
    let particles = [];
    let stars = [];
    let elapsed = 0;
    let spawnIn = 0.4;
    let broken = 0;
    let fireCooldown = 0;
    let best = api.initialStats && typeof api.initialStats.best === "number" ? api.initialStats.best : null;
    let over = false;
    let running = true;
    let visible = true;
    let raf = 0;
    let last = 0;
    const keys = {};

    for (let i = 0; i < 40; i++) {
      stars.push({ x: Math.random() * w, y: Math.random() * h, s: Math.random() * 1.4 + 0.4 });
    }

    function reset() {
      ship = { x: w / 2, target: w / 2 };
      meteors = [];
      bullets = [];
      particles = [];
      elapsed = 0;
      spawnIn = 0.4;
      broken = 0;
      fireCooldown = 0;
      keys.fire = false;
      over = false;
      api.started(GAME_ID);
    }

    function spawn() {
      const r = (7 + Math.random() * 11) * S;
      meteors.push({
        x: r + Math.random() * (w - 2 * r),
        y: -r,
        r,
        vy: (70 + Math.random() * 90 + Math.min(90, elapsed * 4)) * S,
        vx: (Math.random() - 0.5) * 40 * S,
        spin: Math.random() * Math.PI * 2,
      });
    }

    function fire() {
      if (over || fireCooldown > 0) {
        return;
      }
      bullets.push({ x: ship.x, y: SHIP_Y - 2 });
      fireCooldown = FIRE_COOLDOWN;
    }

    function burst(x, y) {
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (40 + Math.random() * 90) * S;
        particles.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 0.35 + Math.random() * 0.3,
        });
      }
    }

    function step(dt) {
      elapsed += dt;
      spawnIn -= dt;
      fireCooldown -= dt;
      const interval = Math.max(0.3, 0.85 - elapsed * 0.012);
      if (spawnIn <= 0) {
        spawn();
        spawnIn = interval;
      }

      if (keys.fire) {
        fire();
      }

      const speed = 260 * S;
      if (keys.left) {
        ship.target = ship.x - speed * dt * 1.6;
      }
      if (keys.right) {
        ship.target = ship.x + speed * dt * 1.6;
      }
      ship.x += Math.max(-speed * dt, Math.min(speed * dt, ship.target - ship.x));
      ship.x = Math.max(SHIP_W / 2, Math.min(w - SHIP_W / 2, ship.x));

      for (const m of meteors) {
        m.y += m.vy * dt;
        m.x += m.vx * dt;
        m.spin += dt * 2;
        if (m.x < m.r || m.x > w - m.r) {
          m.vx = -m.vx;
        }
      }

      // bullets travel up; a hit shatters the meteor.
      for (const b of bullets) {
        b.y -= BULLET_SPEED * dt;
      }
      for (const b of bullets) {
        for (const m of meteors) {
          if (m.hit) {
            continue;
          }
          const dx = b.x - m.x;
          const dy = b.y - m.y;
          const rr = m.r + BULLET_R;
          if (dx * dx + dy * dy <= rr * rr) {
            m.hit = true;
            b.dead = true;
            broken += 1;
            burst(m.x, m.y);
            break;
          }
        }
      }
      bullets = bullets.filter((b) => !b.dead && b.y > -10);
      meteors = meteors.filter((m) => !m.hit && m.y < h + 30);

      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      }
      particles = particles.filter((p) => p.life > 0);

      for (const m of meteors) {
        const dx = Math.max(Math.abs(m.x - ship.x) - SHIP_W / 2, 0);
        const dy = Math.max(Math.abs(m.y - (SHIP_Y + SHIP_H / 2)) - SHIP_H / 2, 0);
        if (dx * dx + dy * dy < m.r * m.r * 0.72) {
          over = true;
          const finalScore = scoreNow();
          if (best === null || finalScore > best) {
            best = finalScore;
          }
          api.completed(GAME_ID, finalScore);
          break;
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = colors.dim;
      ctx.globalAlpha = 0.5;
      for (const s of stars) {
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
      ctx.globalAlpha = 1;

      // meteors
      for (const m of meteors) {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.spin);
        ctx.fillStyle = colors.warn;
        ctx.beginPath();
        ctx.arc(0, 0, m.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.arc(m.r * 0.3, -m.r * 0.2, m.r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // bullets
      ctx.fillStyle = colors.accent;
      for (const b of bullets) {
        ctx.fillRect(b.x - BULLET_R, b.y - BULLET_R * 2.2, BULLET_R * 2, BULLET_R * 4.4);
      }

      // shatter particles
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.4));
        ctx.fillStyle = colors.warn;
        ctx.fillRect(p.x, p.y, 2.2 * S, 2.2 * S);
      }
      ctx.globalAlpha = 1;

      // ship (tiny spaceship theme)
      if (!over) {
        ctx.save();
        ctx.translate(ship.x, SHIP_Y);
        ctx.fillStyle = colors.accent;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-SHIP_W / 2, SHIP_H);
        ctx.lineTo(0, SHIP_H * 0.72);
        ctx.lineTo(SHIP_W / 2, SHIP_H);
        ctx.closePath();
        ctx.fill();
        // flame
        ctx.fillStyle = colors.danger;
        ctx.globalAlpha = 0.6 + Math.random() * 0.4;
        ctx.beginPath();
        ctx.moveTo(-4 * S, SHIP_H * 0.86);
        ctx.lineTo(0, SHIP_H + (7 + Math.random() * 4) * S);
        ctx.lineTo(4 * S, SHIP_H * 0.86);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // HUD
      ctx.fillStyle = colors.fg;
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("score " + scoreNow(), 10, 20);
      if (best !== null) {
        ctx.font = "12px sans-serif";
        ctx.fillStyle = colors.dim;
        ctx.fillText("best " + best, 10, 37);
      }
      ctx.font = "12px sans-serif";
      ctx.fillStyle = colors.dim;
      ctx.textAlign = "right";
      ctx.fillText("broken " + broken, w - 10, 20);

      if (over) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = "center";
        ctx.fillStyle = colors.fg;
        ctx.font = "bold 20px sans-serif";
        ctx.fillText("Score " + scoreNow(), w / 2, h / 2 - 16);
        ctx.font = "13px sans-serif";
        ctx.fillStyle = colors.dim;
        ctx.fillText(
          elapsed.toFixed(1) + "s survived · " + broken + " broken",
          w / 2,
          h / 2 + 8
        );
        ctx.fillText("Click or press Space to fly again", w / 2, h / 2 + 30);
      }
    }

    function frame(now) {
      raf = 0;
      if (!running || !visible) {
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      if (!over) {
        step(dt);
      }
      draw();
      raf = requestAnimationFrame(frame);
    }

    function resume() {
      if (running && visible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }

    function onKeyDown(e) {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        keys.left = true;
        e.preventDefault();
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        keys.right = true;
        e.preventDefault();
      } else if (e.key === " ") {
        // Space fires while flying, or restarts once the run is over.
        if (over) {
          reset();
        } else {
          keys.fire = true;
        }
        e.preventDefault();
      } else if (over && e.key === "Enter") {
        reset();
        e.preventDefault();
      }
    }

    function onKeyUp(e) {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        keys.left = false;
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        keys.right = false;
      } else if (e.key === " ") {
        keys.fire = false;
      }
    }

    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect();
      ship.target = e.clientX - rect.left;
    }

    function onClick() {
      canvas.focus();
      if (over) {
        reset();
      } else {
        fire();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("click", onClick);

    api.started(GAME_ID);
    resume();

    return {
      destroy() {
        running = false;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("click", onClick);
      },
      setVisible(v) {
        visible = v;
        if (v) {
          resume();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      setStats(stats) {
        if (stats && typeof stats.best === "number") {
          best = stats.best;
        }
      },
    };
  };

  // =========================================================================
  // Tiny Basketball — drag back from the ball, release to shoot.
  // =========================================================================
  factories["microgame.tinyBasketball"] = function (host, api) {
    // Runs at 1.5× the base size, like Meteor Dodge — widen the host past the
    // shared 460px cap before measuring, then build a 690×450 canvas.
    host.style.maxWidth = "720px";
    const { canvas, ctx, w, h } = createCanvas(host, 690, 450);
    const colors = theme();
    const GAME_ID = "microgame.tinyBasketball";

    // Scale every pixel distance (and gravity) off the base width so the court,
    // ball, and shot physics grow with the canvas instead of drifting apart.
    const S = w / 460;
    const GRAVITY = 900 * S;
    const FLOOR = h - 16 * S;
    // The ball and hoop get an extra bump beyond the plain court scale so they
    // stay chunky and readable on the larger canvas (rim widens with the ball,
    // keeping the ~2:1 opening-to-ball ratio and the same difficulty).
    const BALL_R = 16 * S;
    const START = { x: w * 0.22, y: FLOOR - BALL_R };
    const RIM_Y = h * 0.34;
    const RIM_L = w * 0.68;
    const RIM_R = w * 0.68 + 62 * S;
    const BOARD_X = RIM_R + 8 * S;

    let ball = { x: START.x, y: START.y, vx: 0, vy: 0, flying: false };
    let drag = null;
    let makes = 0;
    let attempts = 0;
    let best = api.initialStats && typeof api.initialStats.best === "number" ? api.initialStats.best : null;
    let flash = 0;
    let wasAboveRim = false;
    let startedReported = false;
    let bounces = 0;
    let running = true;
    let visible = true;
    let raf = 0;
    let last = 0;

    function resetBall() {
      ball = { x: START.x, y: START.y, vx: 0, vy: 0, flying: false };
      bounces = 0;
      wasAboveRim = false;
    }

    function shoot(dx, dy) {
      const power = Math.min(Math.hypot(dx, dy), 130 * S);
      if (power < 10 * S) {
        return;
      }
      const k = 5.6;
      ball.vx = dx * k;
      ball.vy = dy * k;
      ball.flying = true;
      attempts += 1;
      if (!startedReported) {
        startedReported = true;
        api.started(GAME_ID);
      }
    }

    function step(dt) {
      if (flash > 0) {
        flash -= dt;
      }
      if (!ball.flying) {
        return;
      }

      ball.vy += GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // rim endpoints behave like pegs
      for (const px of [RIM_L, RIM_R]) {
        const dx = ball.x - px;
        const dy = ball.y - RIM_Y;
        const dist = Math.hypot(dx, dy);
        if (dist < BALL_R + 3 * S && dist > 0.01) {
          const nx = dx / dist;
          const ny = dy / dist;
          const dot = ball.vx * nx + ball.vy * ny;
          if (dot < 0) {
            ball.vx -= 1.6 * dot * nx;
            ball.vy -= 1.6 * dot * ny;
            ball.vx *= 0.75;
            ball.vy *= 0.75;
          }
        }
      }

      // backboard
      if (ball.x + BALL_R > BOARD_X && ball.y > RIM_Y - 76 * S && ball.y < RIM_Y + 8 * S && ball.vx > 0) {
        ball.x = BOARD_X - BALL_R;
        ball.vx = -Math.abs(ball.vx) * 0.55;
      }

      // scored? falling through the rim opening
      const above = ball.y < RIM_Y;
      if (wasAboveRim && !above && ball.vy > 0 && ball.x > RIM_L + BALL_R * 0.4 && ball.x < RIM_R - BALL_R * 0.4) {
        makes += 1;
        flash = 1.1;
        if (best === null || makes > best) {
          best = makes;
        }
        api.completed(GAME_ID, makes);
        resetBall();
        return;
      }
      wasAboveRim = above;

      // floor bounce, then settle
      if (ball.y + BALL_R > FLOOR) {
        ball.y = FLOOR - BALL_R;
        ball.vy = -Math.abs(ball.vy) * 0.5;
        ball.vx *= 0.7;
        bounces += 1;
        if (bounces > 2 || Math.hypot(ball.vx, ball.vy) < 60 * S) {
          resetBall();
          return;
        }
      }

      // out of bounds
      if (ball.x < -40 * S || ball.x > w + 40 * S || ball.y > h + 60 * S) {
        resetBall();
      }
    }

    function drawCourt() {
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.moveTo(0, FLOOR + BALL_R + 2 * S);
      ctx.lineTo(w, FLOOR + BALL_R + 2 * S);
      ctx.stroke();

      // backboard
      ctx.strokeStyle = colors.fg;
      ctx.lineWidth = 3.5 * S;
      ctx.beginPath();
      ctx.moveTo(BOARD_X, RIM_Y - 76 * S);
      ctx.lineTo(BOARD_X, RIM_Y + 8 * S);
      ctx.stroke();

      // rim
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = 4 * S;
      ctx.beginPath();
      ctx.moveTo(RIM_L, RIM_Y);
      ctx.lineTo(RIM_R, RIM_Y);
      ctx.stroke();

      // net
      ctx.strokeStyle = colors.dim;
      ctx.lineWidth = 1 * S;
      for (let i = 0; i <= 4; i++) {
        const x = RIM_L + ((RIM_R - RIM_L) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, RIM_Y);
        ctx.lineTo(RIM_L + (RIM_R - RIM_L) / 2 + (x - RIM_L - (RIM_R - RIM_L) / 2) * 0.4, RIM_Y + 34 * S);
        ctx.stroke();
      }
    }

    function drawBall() {
      ctx.fillStyle = colors.warn;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1 * S;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.moveTo(ball.x - BALL_R, ball.y);
      ctx.lineTo(ball.x + BALL_R, ball.y);
      ctx.moveTo(ball.x, ball.y - BALL_R);
      ctx.quadraticCurveTo(ball.x + 6 * S, ball.y, ball.x, ball.y + BALL_R);
      ctx.stroke();
    }

    function drawAim() {
      if (!drag || ball.flying) {
        return;
      }
      const dx = drag.sx - drag.cx;
      const dy = drag.sy - drag.cy;
      const power = Math.min(Math.hypot(dx, dy), 130 * S);
      if (power < 10 * S) {
        return;
      }
      const k = 5.6;
      let px = ball.x;
      let py = ball.y;
      let vx = dx * k;
      let vy = dy * k;
      ctx.fillStyle = colors.dim;
      for (let i = 0; i < 14; i++) {
        const t = 0.028;
        vy += GRAVITY * t;
        px += vx * t;
        py += vy * t;
        ctx.globalAlpha = 1 - i / 16;
        ctx.beginPath();
        ctx.arc(px, py, 2.4 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      drawCourt();
      drawAim();
      drawBall();

      ctx.fillStyle = colors.fg;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(makes + " / " + attempts, 10, 18);
      if (best !== null) {
        ctx.fillStyle = colors.dim;
        ctx.fillText("best " + best, 10, 34);
      }

      if (flash > 0) {
        ctx.textAlign = "center";
        ctx.globalAlpha = Math.min(1, flash);
        ctx.fillStyle = colors.accent;
        ctx.font = "bold 20px sans-serif";
        ctx.fillText("Swish!", w / 2, h * 0.22);
        ctx.globalAlpha = 1;
      }
    }

    function frame(now) {
      raf = 0;
      if (!running || !visible) {
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    }

    function resume() {
      if (running && visible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }

    function point(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerDown(e) {
      canvas.focus();
      if (ball.flying) {
        return;
      }
      const p = point(e);
      if (Math.hypot(p.x - ball.x, p.y - ball.y) < 70 * S) {
        drag = { sx: ball.x, sy: ball.y, cx: p.x, cy: p.y };
        canvas.setPointerCapture(e.pointerId);
      }
    }

    function onPointerMove(e) {
      if (drag) {
        const p = point(e);
        drag.cx = p.x;
        drag.cy = p.y;
      }
    }

    function onPointerUp() {
      if (drag) {
        shoot(drag.sx - drag.cx, drag.sy - drag.cy);
        drag = null;
      }
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    resume();

    return {
      destroy() {
        running = false;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
      },
      setVisible(v) {
        visible = v;
        if (v) {
          resume();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      setStats(stats) {
        if (stats && typeof stats.best === "number") {
          best = stats.best;
        }
      },
    };
  };

  window.BTGames = {
    has(id) {
      return Object.prototype.hasOwnProperty.call(factories, id);
    },
    create(id, host, api) {
      return factories[id](host, api);
    },
  };
})();
