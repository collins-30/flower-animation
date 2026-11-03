import * as THREE from 'three';
import { Bouquet } from './Bouquet.js';
import { makeGlowTexture } from './texture.js';
import { PALETTES } from './palettes.js';

/**
 * Creates the full-screen Three.js scene inside `container`.
 * Returns an API: { restart, nextPalette, dispose, paletteIndex }
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
  const bouquet = new Bouquet(glowTexture, { mobile });
  scene.add(bouquet.group);

  const clock = new THREE.Clock();
  let offset = 0;
  if (!motionOK) offset = -100; // pre-bloom for reduced motion

  let paletteIndex = 0;

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
      opts.onFirstInteract?.();
    }
  }
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
  }
  window.addEventListener('resize', resize);
  resize();

  let raf = 0;
  let disposed = false;
  const lookTarget = new THREE.Vector3(0, -0.15, 0);

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime - offset;

    // smooth the wind toward pointer
    wind.x += (pointer.x - wind.x) * Math.min(1, dt * 3.5);
    wind.y += (pointer.y - wind.y) * Math.min(1, dt * 3.5);
    bouquet.setWind(wind.x, wind.y);
    bouquet.update(dt, time);

    // cinematic camera parallax
    camera.position.x += (pointer.x * 0.45 - camera.position.x) * Math.min(1, dt * 2.5);
    camera.position.y += (0.15 + pointer.y * 0.3 - camera.position.y) * Math.min(1, dt * 2.5);
    camera.lookAt(lookTarget);

    renderer.render(scene, camera);
  }
  tick();

  return {
    get paletteIndex() { return paletteIndex; },
    get paletteCount() { return PALETTES.length; },
    get paletteName() { return PALETTES[paletteIndex % PALETTES.length].name; },
    restart() {
      // snap to the start of the timeline (negative offset trick keeps clock running)
      offset = clock.elapsedTime;
      if (!motionOK) offset = -100;
    },
    nextPalette() {
      paletteIndex = (paletteIndex + 1) % PALETTES.length;
      bouquet.setPalette(paletteIndex);
      return paletteIndex;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('touchmove', onPointer);
      window.removeEventListener('touchstart', onPointer);
      bouquet.dispose();
      glowTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
