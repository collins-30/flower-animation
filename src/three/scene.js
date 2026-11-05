import * as THREE from 'three';
import { Lily } from './Lily.js';
import { makeGlowTexture } from './texture.js';
import { PALETTES } from './palettes.js';
import { INTRO_DURATION } from '../config/message.js';
import { createAudioEngine } from '../audio/engine.js';

/**
 * Creates the full-screen Three.js scene inside `container`.
 * Returns an API: { restart, nextPalette, dispose, paletteIndex, toggleMute, muted }
 *
 * Owns the cinematic timeline: intro particles -> stem growth ->
 * bloom -> finale. Restarting rewinds the clock, re-seeds the intro
 * burst, eases the camera back to centre, and replays the audio.
 */
export function createFlowerScene(container, opts = {}) {
  const motionOK = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const mobile = !!(opts.mobile || coarse || Math.min(window.innerWidth, window.innerHeight) < 500);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.set(0, 0.15, 6.4);

  const glowTexture = makeGlowTexture();
  const bouquet = new Lily(glowTexture, { mobile });
  scene.add(bouquet.group);

  const audio = createAudioEngine();

  const clock = new THREE.Clock();
  let offset = 0;
  if (!motionOK) offset = -100; // pre-bloom for reduced motion

  let paletteIndex = 0;
  let bloomedFired = false;
  let introFired = false;

  // --- pointer / wind (smoothed) ---
  const pointer = { x: 0, y: 0 };
  const wind = { x: 0, y: 0 };
  let interacted = false;

  function onPointer(e) {
    const cx = e.clientX ?? (e.touches?.[0]?.clientX ?? 0);
    const cy = e.clientY ?? (e.touches?.[0]?.clientY ?? 0);
    pointer.x = (cx / window.innerWidth) * 2 - 1;
    pointer.y = -((cy / window.innerHeight) * 2 - 1);
    if (!interacted) {
      interacted = true;
      audio.unlock(); // browsers require a gesture before audio starts
      opts.onFirstInteract?.();
    }
  }
  // Browsers only allow sound after a click / tap / key press, so try
  // again on each of those until the song is playing.
  function onGesture() {
    audio.unlock();
  }
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
  window.addEventListener('touchend', onGesture, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('touchmove', onPointer, { passive: true });
  window.addEventListener('touchstart', onPointer, { passive: true });

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const aspect = w / h;
    renderer.setSize(w, h);
    camera.aspect = aspect;
    camera.fov = aspect < 0.65 ? 68 : 52; // widen portrait/mobile framing
    camera.position.z = aspect < 0.65 ? 8.2 : 6.4;
    camera.updateProjectionMatrix();
    bouquet.setScale(Math.max(w, h) * 1.8);

    // Flower on the left, text column on the right. On tall/portrait
    // screens the flower sits in the upper half and the text below it.
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * aspect;
    if (aspect < 0.9) {
      const s = Math.min(1.25, (halfW * 2) / 3.4);
      bouquet.setLayout(-0.25 * s, halfH * 0.36, s);
    } else {
      const s = Math.min(1.6, Math.max(0.75, halfW / 3.2));
      bouquet.setLayout(-halfW * 0.43, 0.2, s);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  let raf = 0;
  let disposed = false;
  const lookTarget = new THREE.Vector3(0, -0.15, 0);

  function clamp01(x) {
    return Math.min(1, Math.max(0, x));
  }
  function easeOutCubic(x) {
    return 1 - Math.pow(1 - clamp01(x), 3);
  }

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime - offset;

    // --- cinematic intro phase (first INTRO_DURATION seconds) ---
    const introT = clamp01(time / INTRO_DURATION);
    opts.onIntroProgress?.(introT);
    if (!introFired && time >= INTRO_DURATION) {
      introFired = true;
      opts.onIntroDone?.();
    }

    // --- dolly + rise: pull back from a close-up, settle into the frame ---
    const dolly = easeOutCubic(introT);
    const baseZ = camera.aspect < 0.65 ? 8.2 : 6.4;
    const baseY = 1.35 - dolly * 1.2; // starts high, lands at 0.15
    const baseZPos = baseZ + (1 - dolly) * 2.4; // starts ~2.4 further back

    // --- pointer parallax (suppressed while the intro still owns the camera) ---
    const parallaxStrength = motionOK ? dolly : 0;
    const targetX = pointer.x * 0.45 * parallaxStrength;
    const targetY = baseY + pointer.y * 0.3 * parallaxStrength;

    // smooth the wind toward pointer
    wind.x += (pointer.x - wind.x) * Math.min(1, dt * 3.5);
    wind.y += (pointer.y - wind.y) * Math.min(1, dt * 3.5);
    bouquet.setWind(wind.x, wind.y);
    bouquet.update(dt, time);

    // fire once, a beat after the last flower fully opens
    if (!bloomedFired && bouquet.fullyBloomed(time + 1.2)) {
      bloomedFired = true;
      audio.bloom();
      opts.onFullyBloomed?.();
    }

    camera.position.x += (targetX - camera.position.x) * Math.min(1, dt * 2.5);
    camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 2.5);
    camera.position.z += (baseZPos - camera.position.z) * Math.min(1, dt * 2.5);
    camera.lookAt(lookTarget);

    renderer.render(scene, camera);
  }
  tick();

  return {
    get paletteIndex() { return paletteIndex; },
    get paletteCount() { return PALETTES.length; },
    get paletteName() { return PALETTES[paletteIndex % PALETTES.length].name; },
    get muted() { return audio.muted; },
    restart() {
      // rewind the cinematic timeline (negative offset trick keeps clock running)
      offset = clock.elapsedTime;
      if (!motionOK) offset = -100;
      bloomedFired = false;
      introFired = false;
      // fresh intro burst + fresh camera framing + replayed audio
      bouquet.restartIntro();
      pointer.x = 0;
      pointer.y = 0;
      camera.position.set(0, 1.35, (camera.aspect < 0.65 ? 8.2 : 6.4) + 2.4);
      audio.restart();
      opts.onRestart?.();
    },
    nextPalette() {
      paletteIndex = (paletteIndex + 1) % PALETTES.length;
      bouquet.setPalette(paletteIndex);
      return paletteIndex;
    },
    toggleMute() {
      return audio.toggleMute();
    },
    setMuted(m) {
      audio.setMuted(m);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('touchmove', onPointer);
      window.removeEventListener('touchstart', onPointer);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      window.removeEventListener('touchend', onGesture);
      audio.dispose();
      bouquet.dispose();
      glowTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
