// Ambient Zen visuals (+ optional sound) for the Between Trains waiting room.
// Vanilla JS + canvas + Web Audio, loaded with a CSP nonce before waiting-room.js.
//
// Design rules (product brief §11.3): no score, no task pressure, no forced
// meditation language, soft visuals, slow transitions, low CPU/GPU usage.
// Rendering is capped (~30fps, ~15fps under prefers-reduced-motion) and stops
// entirely while the panel is hidden.
//
// Sound is synthesized live with the Web Audio API — nothing is downloaded and
// the CSP needs no media-src. Browsers block autoplay, so audio only starts
// after the user clicks the sound toggle; it fades in/out and pauses with the
// panel. The choice is remembered per scene in localStorage.
//
// Registry contract mirrors games.js: window.BTAmbient.has(modeId) /
// .create(modeId, host, api) → { destroy(), setVisible(visible) }.
(function () {
  "use strict";

  const factories = {};

  const REDUCED =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FRAME_MS = REDUCED ? 66 : 33;

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  }

  function theme() {
    return {
      fg: cssVar("--vscode-foreground", "#cccccc"),
      dim: cssVar("--vscode-descriptionForeground", "#8f8f8f"),
      accent: cssVar("--vscode-progressBar-background", "#4a9eff"),
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
    canvas.className = "bt-canvas bt-canvas-ambient";
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { canvas, ctx, w: width, h: height };
  }

  function fillCircle(c, x, y, r) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  /** Shared throttled render loop with pause/resume. */
  function makeLoop(render) {
    let raf = 0;
    let running = true;
    let visible = true;
    let last = 0;

    function frame(now) {
      raf = 0;
      if (!running || !visible) {
        return;
      }
      if (now - last >= FRAME_MS) {
        const dt = Math.min(0.1, (now - last) / 1000 || 0);
        last = now;
        render(dt);
      }
      raf = requestAnimationFrame(frame);
    }

    function resume() {
      if (running && visible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }

    resume();

    return {
      destroy() {
        running = false;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
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
    };
  }

  // --- ambient audio (synthesized graphs; helpers live in audio.js) ---------

  const ambientAudio = (target, graph) =>
    window.BTAudio ? window.BTAudio.ambientAudio(target, graph) : null;
  const soundButton = (host, audio, key) =>
    window.BTAudio ? window.BTAudio.soundButton(host, audio, key) : { destroy() {} };
  const noise = (ctx, secs, brown) => window.BTAudio.noiseBuffer(ctx, secs, brown);

  function rainGraph(ctx, master) {
    // bright patter
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise(ctx, 3, false);
    hiss.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1100;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6200;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.45;
    hiss.connect(hp);
    hp.connect(lp);
    lp.connect(hissGain);
    hissGain.connect(master);
    hiss.start();

    // low body / rumble
    const rum = ctx.createBufferSource();
    rum.buffer = noise(ctx, 3, true);
    rum.loop = true;
    const rlp = ctx.createBiquadFilter();
    rlp.type = "lowpass";
    rlp.frequency.value = 440;
    const rumGain = ctx.createGain();
    rumGain.gain.value = 0.5;
    rum.connect(rlp);
    rlp.connect(rumGain);
    rumGain.connect(master);
    rum.start();

    // slow waves of intensity
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1400;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
  }

  function orbGraph(ctx, master) {
    const bus = ctx.createGain();
    bus.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 650;
    bus.connect(lp);
    lp.connect(master);

    const voices = [
      { f: 110, g: 0.5 },
      { f: 110.5, g: 0.5 },
      { f: 164.8, g: 0.18 },
    ];
    for (const v of voices) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = v.f;
      const g = ctx.createGain();
      g.gain.value = v.g;
      o.connect(g);
      g.connect(bus);
      o.start();
    }

    // slow swell, roughly in time with the breath
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.28;
    lfo.connect(lfoGain);
    lfoGain.connect(bus.gain);
    lfo.start();
  }

  // =========================================================================
  // Rain on Window — condensation on glass, drops sliding and clearing trails,
  // soft city lights beyond. Optional rain sound.
  // =========================================================================
  factories["ambient.rainWindow"] = function (host) {
    const dpr = window.devicePixelRatio || 1;
    const { ctx, w, h } = createCanvas(host, 460, 300);

    // Offscreen condensation layer we punch clear droplets out of.
    const fog = document.createElement("canvas");
    fog.width = Math.round(w * dpr);
    fog.height = Math.round(h * dpr);
    const fctx = fog.getContext("2d");
    fctx.scale(dpr, dpr);

    const lights = [];
    for (let i = 0; i < 6; i++) {
      lights.push({
        x: Math.random() * w,
        y: Math.random() * h * 0.8,
        r: 26 + Math.random() * 42,
        warm: Math.random() < 0.5,
        drift: (Math.random() - 0.5) * 3,
      });
    }

    // fine, mostly-static condensation
    const mist = [];
    for (let i = 0; i < 110; i++) {
      mist.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.8 + Math.random() * 2.2,
        a: 0.15 + Math.random() * 0.5,
      });
    }

    function newDrop(anywhere) {
      const r = 2.6 + Math.random() * 4.5;
      return {
        x: 8 + Math.random() * (w - 16),
        y: anywhere ? Math.random() * h : -r - Math.random() * 40,
        r,
        v: 0,
        hold: Math.random() * 3,
        wob: Math.random() * Math.PI * 2,
        trail: [],
      };
    }
    const drops = [];
    for (let i = 0; i < 7; i++) {
      drops.push(newDrop(true));
    }

    const loop = makeLoop(function (dt) {
      // background
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "rgba(12,16,22,1)");
      bg.addColorStop(1, "rgba(6,8,12,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // blurred lights beyond the glass
      for (const l of lights) {
        l.x += l.drift * dt;
        if (l.x < -l.r) {
          l.x = w + l.r;
        } else if (l.x > w + l.r) {
          l.x = -l.r;
        }
        const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        g.addColorStop(0, l.warm ? "rgba(255,196,120,0.5)" : "rgba(130,180,255,0.5)");
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        fillCircle(ctx, l.x, l.y, l.r);
      }

      // condensation veil
      fctx.clearRect(0, 0, w, h);
      fctx.fillStyle = "rgba(196,208,222,0.16)";
      fctx.fillRect(0, 0, w, h);

      // punch clear spots — destination-out erases the fog, revealing the lights
      fctx.globalCompositeOperation = "destination-out";
      fctx.fillStyle = "#000";
      for (const m of mist) {
        fctx.globalAlpha = m.a;
        fillCircle(fctx, m.x, m.y, m.r);
      }
      for (const d of drops) {
        d.hold -= dt;
        if (d.hold <= 0) {
          d.v = Math.min(d.v + 20 * dt, 26 + d.r * 7);
          d.y += d.v * dt;
          d.wob += dt * 2.2;
          d.x += Math.sin(d.wob) * 5 * dt;
        }
        d.trail.push({ x: d.x, y: d.y, r: d.r * 0.62 });
        if (d.trail.length > 46) {
          d.trail.shift();
        }
        fctx.globalAlpha = 0.5;
        for (const t of d.trail) {
          fillCircle(fctx, t.x, t.y, t.r);
        }
        fctx.globalAlpha = 0.95;
        fillCircle(fctx, d.x, d.y, d.r);
        if (d.y - d.r > h) {
          const nd = newDrop(false);
          d.x = nd.x;
          d.y = nd.y;
          d.r = nd.r;
          d.v = 0;
          d.hold = nd.hold;
          d.wob = nd.wob;
          d.trail = [];
        }
      }
      fctx.globalAlpha = 1;
      fctx.globalCompositeOperation = "source-over";

      ctx.drawImage(fog, 0, 0, w, h);

      // wet specular highlight on each sliding drop
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (const d of drops) {
        ctx.globalAlpha = 0.5;
        fillCircle(ctx, d.x - d.r * 0.3, d.y - d.r * 0.35, Math.max(0.6, d.r * 0.24));
      }
      ctx.globalAlpha = 1;
    });

    const audio = ambientAudio(0.12, rainGraph);
    const sound = audio ? soundButton(host, audio, "bt.ambient.sound.rain") : null;

    return {
      destroy() {
        loop.destroy();
        if (sound) {
          sound.destroy();
        }
        if (audio) {
          audio.dispose();
        }
      },
      setVisible(v) {
        loop.setVisible(v);
        if (audio) {
          audio.setVisible(v);
        }
      },
    };
  };

  // =========================================================================
  // Breathing Orb — a soft, shaded orb swelling and settling on a slow rhythm,
  // with a low drone that swells with it.
  // =========================================================================
  factories["ambient.breathingOrb"] = function (host) {
    const { ctx, w, h } = createCanvas(host, 460, 300);
    const colors = theme();

    const PERIOD = REDUCED ? 13 : 10; // seconds per full breath
    const cx = w / 2;
    const cy = h / 2 + 4;
    const minR = 32;
    const maxR = 66;

    const motes = [];
    for (let i = 0; i < 20; i++) {
      motes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        s: 0.6 + Math.random() * 1.3,
        v: 1.5 + Math.random() * 2.5,
        a: 0.05 + Math.random() * 0.08,
      });
    }

    let t = 0;

    const loop = makeLoop(function (dt) {
      t += dt;

      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "rgba(14,16,24,1)");
      bg.addColorStop(1, "rgba(8,9,14,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // drifting motes
      ctx.fillStyle = colors.dim;
      for (const m of motes) {
        m.y -= m.v * dt;
        if (m.y < -2) {
          m.y = h + 2;
          m.x = Math.random() * w;
        }
        ctx.globalAlpha = m.a;
        ctx.fillRect(m.x, m.y, m.s, m.s);
      }
      ctx.globalAlpha = 1;

      const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / PERIOD);
      const r = minR + (maxR - minR) * breath;

      // outer bloom, brighter on the in-breath
      const bloom = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.6);
      bloom.addColorStop(0, colors.accent);
      bloom.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.1 + 0.12 * breath;
      ctx.fillStyle = bloom;
      fillCircle(ctx, cx, cy, r * 2.6);
      ctx.globalAlpha = 1;

      // faint ring marking the swell's reach
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = colors.fg;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // orb body with soft shading and an offset highlight
      const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
      body.addColorStop(0, "rgba(255,255,255,0.9)");
      body.addColorStop(0.35, colors.accent);
      body.addColorStop(1, "rgba(40,70,130,0.35)");
      ctx.globalAlpha = 0.5 + 0.18 * breath;
      ctx.fillStyle = body;
      fillCircle(ctx, cx, cy, r);
      ctx.globalAlpha = 1;

      // cool rim light on the upper-left
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "rgba(180,210,255,0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 0.9);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    const audio = ambientAudio(0.1, orbGraph);
    const sound = audio ? soundButton(host, audio, "bt.ambient.sound.orb") : null;

    return {
      destroy() {
        loop.destroy();
        if (sound) {
          sound.destroy();
        }
        if (audio) {
          audio.dispose();
        }
      },
      setVisible(v) {
        loop.setVisible(v);
        if (audio) {
          audio.setVisible(v);
        }
      },
    };
  };

  window.BTAmbient = {
    has(id) {
      return Object.prototype.hasOwnProperty.call(factories, id);
    },
    create(id, host, api) {
      return factories[id](host, api);
    },
  };
})();
