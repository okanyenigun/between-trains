// Physical Break — gentle micro-break prompts for the Between Trains waiting room.
// Vanilla JS + DOM, loaded with a CSP nonce before waiting-room.js.
//
// Design rules (product brief — Physical Break Mode): show ONE small prompt at a
// time, tone must stay gentle, never use guilt-based productivity language, keep
// instructions short, and make it easy to dismiss. Each prompt carries a soft
// looping animation that quietly illustrates the motion, and an optional warm
// relaxing pad (Web Audio via window.BTAudio) that the person turns on with the
// floating sound toggle. There is no timer, no score, and no auto-advance.
// Animations pause while the panel is hidden and disable under
// prefers-reduced-motion (handled in CSS).
//
// Registry contract mirrors games.js / ambient.js:
// window.BTPhysical.has(modeId) / .create(modeId, host, api)
//   → { destroy(), setVisible(visible) }.
(function () {
  "use strict";

  // Each prompt is a single, optional suggestion with a matching animation.
  // Copy stays soft and short: no "should", no numbers to hit, nothing to finish.
  const PROMPTS = [
    {
      anim: "neck",
      title: "Neck stretch",
      text: "If it feels good, let one ear drift gently toward your shoulder, then the other.",
    },
    {
      anim: "wrist",
      title: "Wrist stretch",
      text: "Roll your wrists slowly a few times, whichever way feels nice.",
    },
    {
      anim: "breath",
      title: "Breathing",
      text: "Follow the circle — breathe in as it grows, out as it settles.",
      caption: "in … and out …",
    },
    {
      anim: "eyes",
      title: "Eye rest",
      text: "Look up and let your eyes rest on something far across the room.",
    },
    {
      anim: "posture",
      title: "Posture reset",
      text: "Roll your shoulders back once and let them settle. Nothing to fix.",
    },
  ];

  // A warm, slow major-chord pad — the relaxing bed under the break.
  function padGraph(ctx, master) {
    const bus = ctx.createGain();
    bus.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 720;
    bus.connect(lp);
    lp.connect(master);

    const notes = [130.81, 164.81, 196.0, 261.63]; // C3 · E3 · G3 · C4
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === notes.length - 1 ? "sine" : "triangle";
      o.frequency.value = f;
      const det = ctx.createOscillator();
      det.type = "sine";
      det.frequency.value = f * 1.004; // a second, slightly detuned layer for warmth
      const g = ctx.createGain();
      g.gain.value = 0.16 - i * 0.02;
      o.connect(g);
      det.connect(g);
      g.connect(bus);
      o.start();
      det.start();
    });

    // slow filter shimmer
    const shimmer = ctx.createOscillator();
    shimmer.frequency.value = 0.05;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 240;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(lp.frequency);
    shimmer.start();

    // gentle tremolo
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.12;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.12;
    trem.connect(tremGain);
    tremGain.connect(bus.gain);
    trem.start();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  function button(label, className, onClick) {
    const btn = el("button", className, label);
    btn.type = "button";
    btn.addEventListener("click", onClick);
    return btn;
  }

  // Build the animated visual for a prompt. Motion comes from CSS keyframes
  // keyed off the `bt-phys-<anim>` class on the box.
  function buildVisual(prompt) {
    const box = el("div", "bt-phys-visual bt-phys-" + prompt.anim);
    if (prompt.anim === "wrist") {
      box.appendChild(el("div", "bt-phys-hub"));
      const orbit = el("div", "bt-phys-orbit");
      orbit.appendChild(el("div", "bt-phys-dot"));
      box.appendChild(orbit);
    } else if (prompt.anim === "eyes") {
      box.appendChild(el("div", "bt-phys-orb"));
      box.appendChild(el("div", "bt-phys-ring"));
      box.appendChild(el("div", "bt-phys-ring"));
      box.appendChild(el("div", "bt-phys-ring"));
    } else {
      const orb = el("div", "bt-phys-orb");
      if (prompt.anim === "breath") {
        orb.classList.add("bt-phys-breath-orb");
      }
      box.appendChild(orb);
    }
    return box;
  }

  function create(_id, host, api) {
    const content = document.createElement("div");
    content.className = "bt-phys-stage";
    host.appendChild(content);

    const audio =
      api && window.BTAudio ? window.BTAudio.ambientAudio(0.08, padGraph) : null;
    const sound =
      audio && window.BTAudio
        ? window.BTAudio.soundButton(host, audio, "bt.physical.sound")
        : null;

    let current = null;

    function renderPrompt(prompt) {
      current = prompt;
      const card = el("div", "bt-phys");
      card.appendChild(buildVisual(prompt));
      card.appendChild(el("h2", "bt-phys-title", prompt.title));
      card.appendChild(el("p", "bt-phys-text", prompt.text));
      if (prompt.caption) {
        card.appendChild(el("p", "bt-phys-breath-label", prompt.caption));
      }
      const actions = el("div", "bt-phys-actions");
      actions.appendChild(button("Another", "bt-btn", pickAnother));
      actions.appendChild(button("I'm good", "bt-btn bt-btn-stop", renderRest));
      card.appendChild(actions);
      content.replaceChildren(card);
    }

    function renderRest() {
      current = null;
      const card = el("div", "bt-phys bt-phys-rest");
      card.appendChild(el("div", "bt-phys-emoji", "🌿"));
      card.appendChild(el("p", "bt-phys-text", "Whenever you're ready. No rush."));
      card.appendChild(button("Show a stretch", "bt-btn", pickAnother));
      content.replaceChildren(card);
    }

    function pickAnother() {
      const pool = PROMPTS.filter((p) => p !== current);
      renderPrompt(pool[Math.floor(Math.random() * pool.length)]);
    }

    // Open on a random prompt so it feels fresh each visit.
    renderPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);

    return {
      destroy() {
        if (sound) {
          sound.destroy();
        }
        if (audio) {
          audio.dispose();
        }
        host.replaceChildren();
      },
      setVisible(v) {
        // Pause the CSS animations (and sound) while the panel is hidden.
        host.classList.toggle("bt-phys-paused", !v);
        if (audio) {
          audio.setVisible(v);
        }
      },
    };
  }

  window.BTPhysical = {
    has(id) {
      return id === "physical.microBreak";
    },
    create(id, host, api) {
      return create(id, host, api);
    },
  };
})();
