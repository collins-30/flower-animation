/**
 * Audio engine — plays the song in `public/audio/` on a loop.
 *
 * To use a different song: put the file in `public/audio/` and change
 * SONG_SOURCES below (the first format the browser can play is used).
 *
 * Behaviour:
 *   - starts on the first user gesture (`unlock()`), because browsers
 *     refuse to play sound before one, and fades in slowly
 *   - lifts slightly when the lily fully blooms (`bloom()`)
 *   - starts again from the top on every Restart Bloom (`restart()`)
 *   - the mute button fades it out / back in
 */

const SONG_SOURCES = [
  { src: '/audio/song.m4a', type: 'audio/mp4' },
  { src: '/audio/song.mp3', type: 'audio/mpeg' },
];

const VOLUME = 0.75; // overall level, 0 – 1
const FADE_IN = 3.0; // seconds
const BLOOM_LIFT = 1.25; // how much louder at the bloom (1 = no change)

export function createAudioEngine() {
  let audio = null;
  let ctx = null;
  let gain = null;
  let muted = false;
  let disposed = false;
  let started = false;

  function pickSource() {
    const probe = document.createElement('audio');
    const ok = SONG_SOURCES.find((s) => probe.canPlayType(s.type) !== '');
    return (ok ?? SONG_SOURCES[SONG_SOURCES.length - 1]).src;
  }

  function ensure() {
    if (audio || disposed) return audio;
    audio = new Audio(pickSource());
    audio.loop = true;
    audio.preload = 'auto';

    // Route through Web Audio for smooth fades (iOS ignores audio.volume).
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        ctx = new AC();
        gain = ctx.createGain();
        gain.gain.value = 0.0001;
        ctx.createMediaElementSource(audio).connect(gain);
        gain.connect(ctx.destination);
      }
    } catch {
      ctx = null;
      gain = null;
    }
    if (!gain) audio.volume = 0;
    return audio;
  }

  function fadeTo(target, seconds) {
    if (!audio) return;
    if (gain && ctx) {
      const now = ctx.currentTime;
      const g = gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, 0.0001), now);
      g.exponentialRampToValueAtTime(Math.max(target, 0.0001), now + seconds);
      return;
    }
    // fallback: step the element volume
    const from = audio.volume;
    const start = performance.now();
    const step = () => {
      if (disposed || !audio) return;
      const t = Math.min(1, (performance.now() - start) / (seconds * 1000));
      audio.volume = Math.min(1, Math.max(0, from + (target - from) * t));
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }

  function play() {
    ctx?.resume?.();
    audio.play().catch(() => {
      // blocked until a real gesture — the next pointer/touch will retry
      started = false;
    });
  }

  function unlock() {
    if (!ensure()) return;
    if (started) return;
    started = true;
    play();
    fadeTo(muted ? 0 : VOLUME, FADE_IN);
  }

  return {
    get muted() { return muted; },
    get started() { return started; },

    /** Call from any user gesture (click / first pointer interaction). */
    unlock,

    /** Restart Bloom: dip, jump back to the start of the song, fade in again. */
    restart() {
      if (!ensure()) return;
      started = true;
      fadeTo(0, 0.2);
      setTimeout(() => {
        if (disposed || !audio) return;
        audio.currentTime = 0;
        play();
        fadeTo(muted ? 0 : VOLUME, FADE_IN);
      }, 220);
    },

    /** Gentle lift when the lily finishes opening, then settle back. */
    bloom() {
      if (!audio || muted) return;
      fadeTo(Math.min(1, VOLUME * BLOOM_LIFT), 1.5);
      setTimeout(() => {
        if (!disposed && !muted) fadeTo(VOLUME, 4);
      }, 1600);
    },
    finale() {
      this.bloom();
    },

    setMuted(m) {
      muted = !!m;
      if (audio) fadeTo(muted ? 0 : VOLUME, 0.6);
    },

    toggleMute() {
      this.setMuted(!muted);
      return muted;
    },

    dispose() {
      disposed = true;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio = null;
      }
      ctx?.close?.().catch?.(() => {});
      ctx = null;
      gain = null;
    },
  };
}
