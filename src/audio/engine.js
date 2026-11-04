/**
 * Procedural cinematic audio engine (Web Audio, no audio assets).
 *
 * A soft detuned pad + gentle music-box sparkle that swells during
 * the introduction, lifts when the bouquet fully blooms, and can be
 * replayed from the top on every Restart Bloom.
 *
 * The AudioContext is created lazily on the first user gesture
 * (`unlock()`), because browsers refuse to start audio before one.
 */

const CHORDS = [
  [220.0, 261.63, 329.63, 493.88], // Am add9
  [174.61, 220.0, 261.63, 329.63], // F add9
  [196.0, 246.94, 293.66, 392.0], // G
  [261.63, 329.63, 392.0, 587.33], // C add9
];

const MELODY = [
  523.25, 659.25, 783.99, 659.25, 587.33, 783.99, 880.0, 783.99,
  659.25, 587.33, 523.25, 587.33, 659.25, 523.25, 440.0, 523.25,
];

const MASTER_LEVEL = 0.16;
const STEP_SECONDS = 0.45;

export function createAudioEngine() {
  let ctx = null;
  let master = null;
  let padGain = null;
  let padFilter = null;
  let sparkleGain = null;
  let padOsc = []; // [{ osc, voice }] — two detuned oscillators per voice
  let timer = null;
  let step = 0;
  let nextNoteTime = 0;
  let muted = false;
  let disposed = false;

  function ensure() {
    if (ctx || disposed) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      // --- pad bus ---
      padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 750;
      padFilter.Q.value = 0.7;

      padGain = ctx.createGain();
      padGain.gain.value = 0.5;
      padFilter.connect(padGain);
      padGain.connect(master);

      CHORDS[0].forEach((freq, voice) => {
        for (const detune of [-4, 4]) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          osc.detune.value = detune;
          osc.connect(padFilter);
          osc.start();
          padOsc.push({ osc, voice });
        }
      });

      // --- sparkle (music box) bus ---
      sparkleGain = ctx.createGain();
      sparkleGain.gain.value = 0.35;
      sparkleGain.connect(master);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function rampMaster(target, seconds) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.exponentialRampToValueAtTime(Math.max(target, 0.0001), now + seconds);
  }

  function playSparkle(freq, when) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.4);
    osc.connect(g);
    g.connect(sparkleGain);
    osc.start(when);
    osc.stop(when + 1.5);
  }

  function playChord(index, when) {
    const chord = CHORDS[index % CHORDS.length];
    for (const { osc, voice } of padOsc) {
      osc.frequency.setValueAtTime(osc.frequency.value, when);
      osc.frequency.exponentialRampToValueAtTime(chord[voice], when + 1.2);
    }
  }

  function schedulerTick() {
    if (!ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.6) {
      // music-box sparkle on alternate steps
      if (step % 2 === 0) {
        playSparkle(MELODY[(step / 2) % MELODY.length], nextNoteTime);
      }
      // chord change every 8 steps (~3.6 s)
      if (step % 8 === 0 && step > 0) {
        playChord(Math.floor(step / 8), nextNoteTime);
      }
      step += 1;
      nextNoteTime += STEP_SECONDS;
    }
  }

  function startScheduler() {
    if (!ctx || timer) return;
    nextNoteTime = ctx.currentTime + 0.1;
    timer = setInterval(schedulerTick, 250);
  }

  function unlock() {
    if (!ensure()) return;
    ctx.resume?.();
    startScheduler();
    rampMaster(muted ? 0 : MASTER_LEVEL, 2.5); // slow cinematic fade-in
  }

  function swell() {
    if (!ctx || !padFilter) return;
    const now = ctx.currentTime;
    padFilter.frequency.cancelScheduledValues(now);
    padFilter.frequency.setValueAtTime(padFilter.frequency.value, now);
    padFilter.frequency.linearRampToValueAtTime(1500, now + 1.2);
    padFilter.frequency.linearRampToValueAtTime(750, now + 4.5);
  }

  return {
    get muted() { return muted; },
    get started() { return !!ctx; },

    /** Call from any user gesture (click / first pointer interaction). */
    unlock,

    /** Full replay: reset progression + scheduler, re-run the intro fade-in. */
    restart() {
      if (!ensure()) return;
      ctx.resume?.();
      step = 0;
      nextNoteTime = ctx.currentTime + 0.15;
      playChord(0, nextNoteTime);
      if (padFilter) padFilter.frequency.value = 750;
      startScheduler();
      // quick dip then the full intro fade-in again
      rampMaster(0.0001, 0.15);
      setTimeout(() => {
        if (!disposed) rampMaster(muted ? 0 : MASTER_LEVEL, 2.5);
      }, 180);
    },

    /** Gentle lift when the last flower opens / the finale appears. */
    bloom() {
      swell();
    },
    finale() {
      swell();
    },

    setMuted(m) {
      muted = !!m;
      if (ctx) rampMaster(muted ? 0 : MASTER_LEVEL, 0.6);
    },

    toggleMute() {
      this.setMuted(!muted);
      return muted;
    },

    dispose() {
      disposed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (ctx) {
        ctx.close?.().catch?.(() => {});
        ctx = null;
        master = padGain = padFilter = sparkleGain = null;
        padOsc = [];
      }
    },
  };
}
