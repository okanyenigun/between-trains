// Shared ambient-audio helpers for the Between Trains waiting room.
// Vanilla JS + Web Audio, loaded with a CSP nonce before the scene scripts.
//
// Sound is synthesized live — nothing is downloaded and the CSP needs no
// media-src. Browsers block autoplay, so audio only starts after the user
// clicks a sound toggle; it fades in/out and pauses with the panel, and the
// choice is remembered in localStorage.
//
// Exposes window.BTAudio = { noiseBuffer, ambientAudio, soundButton }.
(function () {
  "use strict";

  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  function noiseBuffer(ctx, seconds, brown) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.2;
      } else {
        d[i] = white;
      }
    }
    return buffer;
  }

  // Wraps a small synth graph with wanted/visible state and gentle fades. The
  // AudioContext is created lazily (first time sound is wanted) and closed on
  // dispose. Returns null when Web Audio is unavailable.
  function ambientAudio(target, buildGraph) {
    if (!AudioCtx) {
      return null;
    }
    let ctx = null;
    let master = null;
    let wanted = false;
    let visible = true;
    let disposed = false;

    function ensure() {
      if (ctx || disposed) {
        return;
      }
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      buildGraph(ctx, master);
    }

    function apply() {
      if (!ctx) {
        return;
      }
      const play = wanted && visible && !disposed;
      master.gain.setTargetAtTime(play ? target : 0.0001, ctx.currentTime, play ? 1.6 : 0.5);
      if (play) {
        ctx.resume();
      } else if (!visible) {
        ctx.suspend();
      }
    }

    return {
      setWanted(v) {
        wanted = v;
        if (v) {
          ensure();
        }
        apply();
      },
      setVisible(v) {
        visible = v;
        if (v && wanted) {
          ensure();
        }
        apply();
      },
      dispose() {
        disposed = true;
        if (ctx) {
          try {
            ctx.close();
          } catch (e) {
            /* ignore */
          }
          ctx = null;
        }
      },
    };
  }

  // A floating mute/unmute control layered over a scene. The click is the user
  // gesture the autoplay policy needs, so sound starts from here.
  function soundButton(host, audio, storageKey) {
    host.style.position = "relative";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bt-sound-btn";
    let on = false;
    try {
      on = localStorage.getItem(storageKey) === "on";
    } catch (e) {
      on = false;
    }
    function paint() {
      btn.textContent = on ? "🔊" : "🔈";
      const label = on ? "Mute sound" : "Play sound";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
    paint();
    btn.addEventListener("click", () => {
      on = !on;
      try {
        localStorage.setItem(storageKey, on ? "on" : "off");
      } catch (e) {
        /* ignore */
      }
      audio.setWanted(on);
      paint();
    });
    host.appendChild(btn);
    if (on) {
      // Try to resume a remembered choice; may need this click if still blocked.
      audio.setWanted(true);
    }
    return {
      destroy() {
        btn.remove();
      },
    };
  }

  window.BTAudio = { noiseBuffer, ambientAudio, soundButton };
})();
