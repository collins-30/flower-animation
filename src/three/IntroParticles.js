import * as THREE from 'three';
import { PALETTES } from './palettes.js';
import { INTRO_DURATION } from '../config/message.js';

/**
 * Cinematic introduction particles.
 *
 * A burst of soft glow points that cluster at the centre, swirl, then
 * expand outward and fade away over `INTRO_DURATION` seconds — the
 * opening beat of the experience before / while the stems grow.
 *
 * The particle field is driven entirely by the scene timeline
 * (`update(dt, time)`), so resetting the scene clock replays it.
 * `restart()` additionally re-seeds the particles, so every replay
 * has a fresh swirl rather than an identical copy.
 */

const INTRO_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform vec2  uWind;
  uniform float uScale;
  uniform float uDuration;
  varying float vA;
  varying float vSeed;

  float easeOutCubic(float x) {
    float t = clamp(x, 0.0, 1.0);
    return 1.0 - pow(1.0 - t, 3.0);
  }

  void main() {
    vSeed = aSeed;

    float birth = aSeed * 1.4;
    float local = clamp((uTime - birth) / (uDuration - 2.0), 0.0, 1.0);
    float e = easeOutCubic(local);

    // start as a tight cluster, expand into a burst
    vec3 p = position * e * 2.2;

    // swirl around the centre while the burst is still tight
    float ang = (1.0 - e) * (2.0 + aSeed * 3.0) + uTime * 0.12;
    float cs = cos(ang);
    float sn = sin(ang);
    float rx = p.x * cs - p.z * sn;
    float rz = p.x * sn + p.z * cs;
    p.x = rx;
    p.z = rz;

    // rise gently as the burst opens
    p.y += e * (0.4 + aSeed * 0.9) - 0.15;

    // idle shimmer + pointer wind
    p.x += sin(uTime * 0.5 + aSeed * 40.0) * 0.08 * (1.0 - e) + uWind.x * 0.2 * e;
    p.z += cos(uTime * 0.4 + aSeed * 31.0) * 0.08 * (1.0 - e) + uWind.y * 0.15 * e;

    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + aSeed) + aSeed * 80.0);
    vA = tw * smoothstep(0.0, 0.15, local) * (1.0 - smoothstep(0.62, 1.0, local)) * (0.35 + 0.65 * aSeed);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = (0.015 + aSeed * 0.045) * (0.6 + e * 1.1);
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const INTRO_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3  uTint;
  varying float vA;
  varying float vSeed;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uTint * (0.8 + vSeed * 0.6), a);
  }
`;

export class IntroParticles {
  constructor(glowTexture, opts = {}) {
    this.mobile = !!opts.mobile;
    this.duration = INTRO_DURATION;
    this.group = new THREE.Group();
    this.disposables = new Set();

    // palette colours: current -> target (lerped in update)
    this.tintCol = new THREE.Color();
    this.tintTarget = new THREE.Color();

    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 0) },
      uScale: { value: 1000 },
      uDuration: { value: this.duration },
      uTint: { value: this.tintCol },
      uMap: { value: glowTexture },
    };

    this._build(glowTexture);
    this.setPalette(0, true);
  }

  _track(obj) {
    this.disposables.add(obj);
    return obj;
  }

  _build(glowTexture) {
    const count = this.mobile ? 400 : 900;
    this._count = count;

    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // random direction, radius biased toward the shell
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.pow(Math.random(), 0.6) * 0.7;
      const s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(th) * r, u * r * 0.85, s * Math.sin(th) * r], i * 3);
      seed[i] = Math.random();
    }

    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this._geo = geo;

    const mat = this._track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: INTRO_VERT,
        fragmentShader: INTRO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this._mat = mat;

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
  }

  /** Re-seed the field so the next timeline pass looks fresh. */
  restart() {
    const posAttr = this._geo.attributes.position;
    const seedAttr = this._geo.attributes.aSeed;
    const pos = posAttr.array;
    const seed = seedAttr.array;
    for (let i = 0; i < this._count; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.pow(Math.random(), 0.6) * 0.7;
      const s = Math.sqrt(1 - u * u);
      pos.set([s * Math.cos(th) * r, u * r * 0.85, s * Math.sin(th) * r], i * 3);
      seed[i] = Math.random();
    }
    posAttr.needsUpdate = true;
    seedAttr.needsUpdate = true;
    this.uniforms.uTime.value = 0;
  }

  setPalette(index, instant = false) {
    const p = PALETTES[index % PALETTES.length];
    const white = new THREE.Color('#ffffff');
    this.tintTarget.set(p.centre).lerp(white, 0.6);
    if (instant) this.tintCol.copy(this.tintTarget);
  }

  setWind(x, y) {
    this.uniforms.uWind.value.set(x, y);
  }

  setScale(s) {
    this.uniforms.uScale.value = s;
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    const k = 1 - Math.exp(-dt * 2.2);
    this.tintCol.lerp(this.tintTarget, k);
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.disposables.clear();
  }
}
