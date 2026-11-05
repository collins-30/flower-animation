import * as THREE from 'three';
import { PALETTES } from './palettes.js';
import { IntroParticles } from './IntroParticles.js';

/**
 * A single, close-up lily — six solid, shaded petals that open from a
 * bud, six stamens with dark anthers, a pistil, a second closed bud,
 * a stem and leaves. Everything is generated in code; no image assets.
 *
 * Public API matches the old Bouquet so scene.js barely changes:
 *   group, update(dt, time), setPalette(i, instant), setWind(x, y),
 *   setScale(s), setLayout(x, y, scale), fullyBloomed(time),
 *   restartIntro(), introDuration, dispose()
 */

const TAU = Math.PI * 2;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function easeInOutCubic(x) {
  x = clamp01(x);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
function easeOutCubic(x) {
  return 1 - Math.pow(1 - clamp01(x), 3);
}

/* Timeline, in seconds after the cinematic intro finishes. */
const TIMELINE = {
  stem: [0.0, 2.6],
  leaves: 0.8,
  swell: [1.2, 3.2],
  open: [2.8, 7.0],
  stamens: [4.4, 7.2],
  budStem: [1.4, 3.4],
  budSwell: [2.4, 4.4],
};
const BLOOM_END = 7.4;

/* ------------------------------------------------------------------ */
/*  Shared lighting (world space)                                      */
/* ------------------------------------------------------------------ */

const LIGHT_GLSL = /* glsl */ `
  // key light from the upper right, as in a studio close-up
  const vec3 KEY = normalize(vec3(0.55, 0.8, 0.5));
  // cool fill from the lower left
  const vec3 FILL = normalize(vec3(-0.7, -0.2, 0.4));

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

/* ------------------------------------------------------------------ */
/*  Petal shaders                                                      */
/* ------------------------------------------------------------------ */

const PETAL_VERT = /* glsl */ `
  attribute vec2  aUV;      // x: 0 base -> 1 tip, y: -1 edge -> 1 edge
  attribute vec2  aPetal;   // x: random seed, y: 1 inner petal / 0 outer
  attribute float aAcross;  // physical distance from the midrib
  varying vec2  vUV;
  varying vec2  vPetal;
  varying float vAcross;
  varying vec3  vN;
  varying vec3  vW;
  void main() {
    vUV = aUV;
    vPetal = aPetal;
    vAcross = aAcross;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const PETAL_FRAG = /* glsl */ `
  uniform vec3  uThroat;
  uniform vec3  uInner;
  uniform vec3  uMain;
  uniform vec3  uEdge;
  uniform vec3  uRib;
  uniform vec3  uSpeck;
  uniform float uBloom;
  uniform float uLength;
  uniform float uTime;
  uniform float uFade;
  varying vec2  vUV;
  varying vec2  vPetal;
  varying float vAcross;
  varying vec3  vN;
  varying vec3  vW;
  ${LIGHT_GLSL}

  void main() {
    float t = vUV.x;
    float a = abs(vUV.y);
    float inner = vPetal.y;
    float along = t * uLength;

    /* ---- colour ---- */
    // deep throat -> cool inner glow -> rich main colour
    vec3 col = mix(uThroat, uInner, smoothstep(0.02, 0.28, t));
    float toMain = clamp(smoothstep(0.2, 0.95, a) * 0.95 + smoothstep(0.35, 1.0, t) * 0.75, 0.0, 1.0);
    col = mix(col, uMain, toMain);
    // satin, lighter rim
    col = mix(col, uEdge, smoothstep(0.78, 1.0, a) * (0.45 + 0.5 * t));
    // pale midrib stripe (strongest on the three inner petals)
    float rib = exp(-pow(vUV.y * 7.0, 2.0)) * smoothstep(0.06, 0.25, t) * (1.0 - smoothstep(0.6, 0.95, t));
    col = mix(col, uRib, rib * mix(0.25, 0.75, inner));
    // fine veins running toward the tip, and a soft sugary grain
    col *= 0.93 + 0.07 * sin(vAcross * 140.0 + t * 4.0);
    float grain = hash12(floor(vec2(along, vAcross) * 320.0) + vPetal.x * 91.0);
    col *= 0.95 + 0.08 * grain;

    // dark speckles scattered near the throat
    vec2 sp = vec2(along, vAcross) * 30.0 + vPetal.x * 17.0;
    vec2 id = floor(sp);
    vec2 f = fract(sp) - 0.5;
    vec2 c = (vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5) * 0.6;
    float r = 0.11 + 0.13 * hash12(id + 1.3);
    float zone = smoothstep(0.08, 0.16, t) * (1.0 - smoothstep(0.38, 0.62, t)) * (1.0 - smoothstep(0.45, 0.8, a));
    float present = step(1.0 - zone * 0.75, hash12(id + 9.2));
    float speck = present * (1.0 - smoothstep(r * 0.55, r, length(f - c)));
    col = mix(col, uSpeck, speck * 0.85);

    // closed buds start green and blush into colour as they open
    vec3 green = vec3(0.12, 0.3, 0.12);
    float colourIn = smoothstep(0.02, 0.55, uBloom) * (0.45 + 0.55 * t) + smoothstep(0.4, 0.9, uBloom);
    col = mix(green, col, clamp(colourIn, 0.0, 1.0));

    /* ---- lighting ---- */
    vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 V = normalize(cameraPosition - vW);
    float ndl = dot(N, KEY);
    float wrap = max((ndl + 0.22) / 1.22, 0.0);
    float fill = max(dot(N, FILL), 0.0);
    float through = max(-ndl, 0.0);                 // light glowing through the petal
    vec3 H = normalize(KEY + V);
    float spec = pow(max(dot(N, H), 0.0), 36.0);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    // a few faint crystalline glints where the light catches the surface
    float glitter = pow(grain, 60.0) * (0.6 + 0.4 * sin(uTime * 3.0 + grain * 40.0));

    // the throat sits in shadow
    float occl = mix(0.25, 1.0, smoothstep(0.0, 0.32, t));

    vec3 lit = col * (0.035 + 1.25 * wrap) * occl
             + col * uInner * fill * 0.35
             + col * through * 0.45
             + vec3(1.0, 0.92, 1.0) * (spec * 0.2 + glitter * wrap * 0.45)
             + uEdge * rim * 0.28;

    gl_FragColor = vec4(lit * uFade, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/*  Solid parts (stamens, pistil)                                      */
/* ------------------------------------------------------------------ */

const SOLID_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const SOLID_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform vec3  uSheen;
  uniform float uGloss;
  uniform float uFade;
  varying vec3  vN;
  varying vec3  vW;
  ${LIGHT_GLSL}
  void main() {
    vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 V = normalize(cameraPosition - vW);
    float wrap = max((dot(N, KEY) + 0.3) / 1.3, 0.0);
    vec3 H = normalize(KEY + V);
    float spec = pow(max(dot(N, H), 0.0), uGloss);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    vec3 col = uColor * (0.1 + 1.1 * wrap) + uSheen * (spec * 0.9 + rim * 0.35);
    gl_FragColor = vec4(col * uFade, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/*  Stem / leaf / dust / halo shaders                                  */
/* ------------------------------------------------------------------ */

const STEM_VERT = /* glsl */ `
  attribute float aLen;
  uniform float uTime;
  uniform vec2  uWind;
  uniform float uPhase;
  varying float vLen;
  varying vec3  vN;
  varying vec3  vW;
  void main() {
    vLen = aLen;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const STEM_FRAG = /* glsl */ `
  uniform float uGrowth;
  uniform vec3  uColor;
  uniform float uTime;
  varying float vLen;
  varying vec3  vN;
  varying vec3  vW;
  ${LIGHT_GLSL}
  void main() {
    if (vLen > uGrowth) discard;
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float wrap = max((dot(N, KEY) + 0.4) / 1.4, 0.0);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 col = uColor * (0.08 + 0.95 * wrap) * mix(0.35, 1.0, vLen) + uColor * rim * 0.4;
    // a glowing growth tip while the stem is still climbing
    float tip = smoothstep(0.05, 0.0, uGrowth - vLen) * step(uGrowth, 0.995);
    col += vec3(0.45, 0.95, 0.5) * tip * (0.8 + 0.2 * sin(uTime * 5.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const LEAF_VERT = /* glsl */ `
  attribute vec3  aBase;
  attribute vec3  aAxis;
  attribute float aLen;
  attribute float aAcross;
  attribute float aGrow;
  uniform float uTime;
  uniform vec2  uWind;
  varying float vLen;
  varying float vAcross;
  varying float vG;
  varying vec3  vW;
  varying vec3  vN;

  vec3 rotAxis(vec3 p, vec3 axis, float ang) {
    float c = cos(ang);
    float s = sin(ang);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
  }

  void main() {
    float g = smoothstep(aGrow, aGrow + 1.8, uTime);
    vG = g;
    vLen = aLen;
    vAcross = aAcross;
    vec3 p = position * (0.15 + 0.85 * g);
    p = rotAxis(p, aAxis, (1.0 - g) * 0.8);
    vec3 local = aBase + p;
    local.x += (sin(uTime * 1.05 + aBase.y * 2.5) * 0.03 + uWind.x * 0.08) * aLen;
    local.z += (cos(uTime * 0.85 + aBase.y * 2.2) * 0.025 + uWind.y * 0.06) * aLen;
    vec4 w = modelMatrix * vec4(local, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * rotAxis(normal, aAxis, (1.0 - g) * 0.8));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const LEAF_FRAG = /* glsl */ `
  varying float vLen;
  varying float vAcross;
  varying float vG;
  varying vec3  vW;
  varying vec3  vN;
  uniform vec3  uColor;
  ${LIGHT_GLSL}
  void main() {
    if (vG < 0.02) discard;
    vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 V = normalize(cameraPosition - vW);
    float wrap = max((dot(N, KEY) + 0.35) / 1.35, 0.0);
    vec3 H = normalize(KEY + V);
    float spec = pow(max(dot(N, H), 0.0), 24.0);
    vec3 col = mix(uColor * 0.5, uColor * 1.15, pow(vLen, 0.8));
    col += vec3(0.08, 0.16, 0.07) * (1.0 - abs(vAcross));     // lighter midrib
    col = col * (0.06 + 0.95 * wrap) + vec3(0.6, 0.8, 0.6) * spec * 0.18;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const DUST_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform vec2  uWind;
  uniform float uScale;
  uniform vec3  uTint;
  varying float vA;
  varying vec3  vC;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + uTime * (0.04 + aSeed * 0.07), 6.4) - 3.0;
    p.x += sin(uTime * 0.25 + aSeed * 21.0) * 0.22 + uWind.x * 0.15;
    p.z += cos(uTime * 0.2  + aSeed * 17.0) * 0.18 + uWind.y * 0.10;
    float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + aSeed * 60.0);
    vA = tw * (0.18 + aSeed * 0.4);
    vC = uTint * (0.7 + aSeed * 0.7);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (0.012 + aSeed * 0.028) * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vA;
  varying vec3  vC;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vC, a);
  }
`;

const HALO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uStrength;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.4) * 0.16 * uStrength * (0.85 + 0.15 * sin(uTime * 0.6));
    gl_FragColor = vec4(uColor, a);
  }
`;

/* ------------------------------------------------------------------ */
/*  Petals: one mesh holding all six, re-shaped every frame            */
/* ------------------------------------------------------------------ */

const NU = 46; // rows along each petal
const NV = 17; // columns across each petal

class PetalRing {
  /**
   * @param {object} o
   * @param {number} o.length  petal length
   * @param {number} o.width   petal half-width
   */
  constructor({ length = 1.15, width = 0.34, roll = 0 } = {}) {
    this.length = length;
    this.petals = [];
    for (let i = 0; i < 6; i++) {
      const inner = i % 2 === 0;
      this.petals.push({
        inner,
        phi: roll + (i / 6) * TAU + rand(-0.07, 0.07),
        L: length * (inner ? 1.0 : 0.97) * rand(0.96, 1.04),
        W: width * (inner ? 1.06 : 0.8) * rand(0.95, 1.05),
        tilt: inner ? 0.98 : 1.1,
        recurve: (inner ? 1.15 : 1.4) * rand(0.9, 1.1),
        twist: rand(-0.35, 0.35),
        seed: Math.random(),
      });
    }

    const vPerPetal = NU * NV;
    const total = vPerPetal * 6;
    this.pos = new Float32Array(total * 3);
    this.across = new Float32Array(total);
    const uv = new Float32Array(total * 2);
    const petalAttr = new Float32Array(total * 2);
    const idx = [];

    for (let p = 0; p < 6; p++) {
      const base = p * vPerPetal;
      for (let i = 0; i < NU; i++) {
        for (let j = 0; j < NV; j++) {
          const k = base + i * NV + j;
          uv[k * 2] = i / (NU - 1);
          uv[k * 2 + 1] = (j / (NV - 1)) * 2 - 1;
          petalAttr[k * 2] = this.petals[p].seed;
          petalAttr[k * 2 + 1] = this.petals[p].inner ? 1 : 0;
        }
      }
      for (let i = 0; i < NU - 1; i++) {
        for (let j = 0; j < NV - 1; j++) {
          const a = base + i * NV + j;
          const b = a + 1;
          const c = a + NV;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.acrossAttr = new THREE.BufferAttribute(this.across, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aPetal', new THREE.BufferAttribute(petalAttr, 2));
    geo.setAttribute('aAcross', this.acrossAttr);
    geo.setIndex(idx);
    this.geometry = geo;

    this._spineR = new Float32Array(NU);
    this._spineY = new Float32Array(NU);
    this._spineA = new Float32Array(NU);
    this.shape(0, 0, 0, 0);
  }

  /**
   * Re-shape all petals.
   * @param {number} b     bloom 0 (closed bud) -> 1 (fully open)
   * @param {number} time  seconds, for a gentle breathing motion
   * @param {number} wx    wind x (-1..1)
   * @param {number} wy    wind y (-1..1)
   */
  shape(b, time, wx, wy) {
    const pos = this.pos;
    const across = this.across;
    const sR = this._spineR;
    const sY = this._spineY;
    const sA = this._spineA;

    const openA = smooth(0.0, 0.75, b);
    const closed = 1 - smooth(0.0, 0.5, b);
    const widthMul = lerp(0.62, 1.0, smooth(0.0, 0.55, b));
    const cupAmt = lerp(1.05, 0.34, smooth(0.0, 0.7, b));
    const ruffle = smooth(0.4, 1.0, b);

    for (let p = 0; p < 6; p++) {
      const P = this.petals[p];
      const cphi = Math.cos(P.phi);
      const sphi = Math.sin(P.phi);
      // wind leans petals on the side the cursor is on
      const lean = (wx * cphi + wy * sphi) * 0.06 * b;
      const breathe = Math.sin(time * 0.9 + P.seed * 6.0) * 0.025 * b;
      const tilt = lerp(0.12, P.tilt, openA) + breathe + lean;
      const recurve = P.recurve * Math.pow(b, 1.6);

      // integrate the curved spine of the petal in its (radial, axial) plane
      const ds = P.L / (NU - 1);
      let r = 0.045;
      let y = 0.0;
      for (let i = 0; i < NU; i++) {
        const u = i / (NU - 1);
        // closed: swell then curl back in (teardrop bud). open: recurve.
        const ang = tilt + recurve * Math.pow(u, 2.2) + closed * (0.32 - 0.95 * u);
        sR[i] = r;
        sY[i] = y;
        sA[i] = ang;
        r += Math.sin(ang) * ds;
        y += Math.cos(ang) * ds;
      }

      const base = p * NU * NV;
      for (let i = 0; i < NU; i++) {
        const u = i / (NU - 1);
        const ang = sA[i];
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        // radial R, side S, inner-face normal N (all in flower space, axis = +Y)
        const Rx = cphi, Rz = sphi;
        let Sx = -sphi, Sy = 0, Sz = cphi;
        let Nx = -ca * Rx, Ny = sa, Nz = -ca * Rz;
        // slight twist along the length
        const tw = P.twist * u * b;
        if (tw !== 0) {
          const ct = Math.cos(tw);
          const st = Math.sin(tw);
          const sx = Sx * ct + Nx * st, sy = Sy * ct + Ny * st, sz = Sz * ct + Nz * st;
          const nx = Nx * ct - Sx * st, ny = Ny * ct - Sy * st, nz = Nz * ct - Sz * st;
          Sx = sx; Sy = sy; Sz = sz;
          Nx = nx; Ny = ny; Nz = nz;
        }
        const cx = Rx * sR[i];
        const cy = sY[i];
        const cz = Rz * sR[i];

        // lanceolate outline: narrow claw, widest around a third, pointed tip
        const prof = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.6)), 0.9);
        const w = P.W * widthMul * Math.max(prof, 0.14 * (1 - u));

        for (let j = 0; j < NV; j++) {
          const v = (j / (NV - 1)) * 2 - 1;
          const av = Math.abs(v);
          const lat = v * w;
          // channelled cross-section with a creased midrib, plus a soft edge ruffle
          let off = cupAmt * w * (0.5 * av + 0.4 * v * v) * (P.inner ? 1.0 : 0.85);
          off += ruffle * 0.022 * Math.sin(u * 19.0 + P.seed * 12.0 + v * 2.0) * av * av * av * u;
          const k = (base + i * NV + j) * 3;
          pos[k] = cx + Sx * lat + Nx * off;
          pos[k + 1] = cy + Sy * lat + Ny * off;
          pos[k + 2] = cz + Sz * lat + Nz * off;
          across[base + i * NV + j] = lat;
        }
      }
    }
    this.posAttr.needsUpdate = true;
    this.acrossAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}

/** One leaf blade in local space (base at origin, extends +Y). */
function leafBlade(leafLen, leafWid) {
  const COLS = 5;
  const ROWS = 12;
  const verts = [];
  const aLen = [];
  const aAcross = [];
  const idx = [];
  for (let r = 0; r < ROWS; r++) {
    const al = r / (ROWS - 1);
    const prof = Math.sin(Math.PI * Math.pow(al, 0.7));
    for (let c = 0; c < COLS; c++) {
      const across = (c / (COLS - 1)) * 2 - 1;
      const lx = across * (leafWid * 0.5) * prof;
      const ly = al * leafLen;
      const lz = Math.abs(across) * 0.05 * prof - al * al * 0.18;
      verts.push(lx, ly, lz);
      aLen.push(al);
      aAcross.push(across);
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c;
      const b = a + 1;
      const d = a + COLS;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  return { verts, aLen, aAcross, idx };
}

/** Tube along a curve with an `aLen` attribute (0 base -> 1 tip). */
function growingTube(curve, segments, radius, radial = 8) {
  const geo = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  const count = geo.attributes.position.count;
  const aLen = new Float32Array(count);
  const ring = radial + 1;
  for (let v = 0; v < count; v++) aLen[v] = Math.floor(v / ring) / segments;
  geo.setAttribute('aLen', new THREE.BufferAttribute(aLen, 1));
  // taper toward the top so the stem doesn't look like a pipe
  const pos = geo.attributes.position;
  const pts = curve.getSpacedPoints(segments);
  for (let v = 0; v < count; v++) {
    const s = Math.floor(v / ring);
    const c = pts[s];
    const k = 1 - aLen[v] * 0.35;
    pos.setXYZ(
      v,
      c.x + (pos.getX(v) - c.x) * k,
      c.y + (pos.getY(v) - c.y) * k,
      c.z + (pos.getZ(v) - c.z) * k,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/*  Lily                                                               */
/* ------------------------------------------------------------------ */

const HEAD_DIR = new THREE.Vector3(0.42, 0.34, 0.84).normalize(); // faces the viewer, turned toward the text
const BUD_DIR = new THREE.Vector3(-0.35, 0.92, 0.15).normalize();

export class Lily {
  constructor(glowTexture, opts = {}) {
    this.mobile = !!opts.mobile;
    this.group = new THREE.Group();
    this.plant = new THREE.Group(); // positioned by setLayout()
    this.group.add(this.plant);
    this.disposables = new Set();

    this.shared = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 0) },
      uScale: { value: 1000 },
    };
    this.wind = new THREE.Vector2();

    // palette colours: current (bound to uniforms) -> target (lerped)
    const keys = ['throat', 'inner', 'main', 'edge', 'rib', 'speck', 'filament', 'anther', 'pistil'];
    this.cols = {};
    this.targets = {};
    for (const k of [...keys, 'stem', 'tint', 'halo']) {
      this.cols[k] = new THREE.Color();
      this.targets[k] = new THREE.Color();
    }

    this.introParticles = new IntroParticles(glowTexture, { mobile: this.mobile });
    this.plant.add(this.introParticles.group);

    this._buildHalo();
    this._buildStem();
    this._buildLeaves();
    this._buildHead();
    this._buildBud();
    this._buildAmbient(glowTexture);

    this.setPalette(0, true);
  }

  _track(obj) {
    this.disposables.add(obj);
    return obj;
  }

  _petalMaterial(length) {
    const c = this.cols;
    return this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uThroat: { value: c.throat },
          uInner: { value: c.inner },
          uMain: { value: c.main },
          uEdge: { value: c.edge },
          uRib: { value: c.rib },
          uSpeck: { value: c.speck },
          uBloom: { value: 0 },
          uLength: { value: length },
          uTime: this.shared.uTime,
          uFade: { value: 1 },
        },
        vertexShader: PETAL_VERT,
        fragmentShader: PETAL_FRAG,
        side: THREE.DoubleSide,
      }),
    );
  }

  _solidMaterial(color, sheen, gloss) {
    return this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: color },
          uSheen: { value: sheen },
          uGloss: { value: gloss },
          uFade: { value: 1 },
        },
        vertexShader: SOLID_VERT,
        fragmentShader: SOLID_FRAG,
      }),
    );
  }

  _stemMaterial() {
    return this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.shared.uTime,
          uWind: this.shared.uWind,
          uColor: { value: this.cols.stem },
          uPhase: { value: rand(TAU) },
          uGrowth: { value: 0 },
        },
        vertexShader: STEM_VERT,
        fragmentShader: STEM_FRAG,
      }),
    );
  }

  /* ---------------- stem & leaves ---------------- */

  _buildStem() {
    // the stem rises from below the frame into the back of the flower
    const tail = HEAD_DIR.clone().multiplyScalar(-1);
    this.stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.55, -5.2, -0.7),
      new THREE.Vector3(0.35, -3.4, -0.6),
      new THREE.Vector3(0.0, -1.9, -0.5),
      new THREE.Vector3(-0.22, -0.8, -0.45),
      tail.clone().multiplyScalar(0.42),
      tail.clone().multiplyScalar(0.06),
    ]);
    this.stemMat = this._stemMaterial();
    const stem = new THREE.Mesh(this._track(growingTube(this.stemCurve, 90, 0.05)), this.stemMat);
    this.plant.add(stem);

    // a short side stem carrying the closed bud, branching off to the left
    const from = this.stemCurve.getPointAt(0.52);
    this.budBase = new THREE.Vector3(-1.05, -0.55, -0.55);
    this.budStemCurve = new THREE.CatmullRomCurve3([
      from,
      from.clone().add(new THREE.Vector3(-0.25, 0.35, 0.0)),
      this.budBase.clone().add(new THREE.Vector3(0.1, -0.35, 0.0)),
      this.budBase.clone(),
    ]);
    this.budStemMat = this._stemMaterial();
    const budStem = new THREE.Mesh(this._track(growingTube(this.budStemCurve, 50, 0.03)), this.budStemMat);
    this.plant.add(budStem);
  }

  _buildLeaves() {
    const allPos = [];
    const allBase = [];
    const allAxis = [];
    const allLen = [];
    const allAcross = [];
    const allGrow = [];
    const allIdx = [];
    let vOffset = 0;

    // [position along stem, horizontal direction, length, width]
    const specs = [
      [0.16, -1.0, 1.25, 0.26],
      [0.26, 0.9, 1.15, 0.24],
      [0.38, -0.7, 1.0, 0.22],
      [0.47, 1.0, 0.85, 0.2],
    ];

    specs.forEach(([t, side, len, wid], j) => {
      const attach = this.stemCurve.getPointAt(t);
      const dir = new THREE.Vector3(side * 0.8, 0.75, rand(0.1, 0.35)).normalize();
      const yAxis = dir.clone();
      let xAxis = new THREE.Vector3().crossVectors(yAxis, new THREE.Vector3(0, 0, 1));
      if (xAxis.lengthSq() < 0.001) xAxis = new THREE.Vector3(1, 0, 0);
      xAxis.normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(yAxis, rand(-0.5, 0.5));
      xAxis.applyQuaternion(q);
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      const blade = leafBlade(len, wid);
      const v = new THREE.Vector3();

      for (let k = 0; k < blade.verts.length; k += 3) {
        v.set(blade.verts[k], blade.verts[k + 1], blade.verts[k + 2]).applyMatrix4(m);
        allPos.push(v.x, v.y, v.z);
        allBase.push(attach.x, attach.y, attach.z);
        allAxis.push(xAxis.x, xAxis.y, xAxis.z);
      }
      allLen.push(...blade.aLen);
      allAcross.push(...blade.aAcross);
      for (let k = 0; k < blade.aLen.length; k++) allGrow.push(TIMELINE.leaves + j * 0.45);
      for (const ix of blade.idx) allIdx.push(ix + vOffset);
      vOffset += blade.aLen.length;
    });

    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPos), 3));
    geo.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(allBase), 3));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(allAxis), 3));
    geo.setAttribute('aLen', new THREE.BufferAttribute(new Float32Array(allLen), 1));
    geo.setAttribute('aAcross', new THREE.BufferAttribute(new Float32Array(allAcross), 1));
    geo.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(allGrow), 1));
    geo.setIndex(allIdx);
    geo.computeVertexNormals();

    this.leafMat = this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.shared.uTime,
          uWind: this.shared.uWind,
          uColor: { value: this.cols.stem },
        },
        vertexShader: LEAF_VERT,
        fragmentShader: LEAF_FRAG,
        side: THREE.DoubleSide,
      }),
    );
    const leaves = new THREE.Mesh(geo, this.leafMat);
    leaves.frustumCulled = false;
    this.plant.add(leaves);
  }

  /* ---------------- flower head ---------------- */

  _buildHead() {
    // sway pivot sits at the top of the stem; the head is oriented inside it
    this.sway = new THREE.Group();
    this.plant.add(this.sway);
    this.head = new THREE.Group();
    this.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), HEAD_DIR);
    this.sway.add(this.head);

    this.ring = new PetalRing({ length: 1.18, width: 0.43, roll: 0.35 });
    this._track(this.ring.geometry);
    this.petalMat = this._petalMaterial(this.ring.length);
    const petals = new THREE.Mesh(this.ring.geometry, this.petalMat);
    petals.frustumCulled = false;
    this.head.add(petals);

    // stamens + pistil
    this.stamens = new THREE.Group();
    this.head.add(this.stamens);
    this.filamentMat = this._solidMaterial(this.cols.filament, new THREE.Color('#ffd0e0'), 30);
    this.antherMat = this._solidMaterial(this.cols.anther, new THREE.Color('#e0a050'), 18);
    this.pistilMat = this._solidMaterial(this.cols.pistil, new THREE.Color('#fff2e0'), 50);

    const antherGeo = this._track(new THREE.SphereGeometry(1, 14, 10));
    for (let i = 0; i < 6; i++) {
      const phi = 0.35 + (i / 6) * TAU + Math.PI / 6 + rand(-0.18, 0.18);
      const R = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
      const reach = rand(0.4, 0.5);
      const height = rand(0.7, 0.82);
      const pt = (r, y) => R.clone().multiplyScalar(r).setY(y);
      const curve = new THREE.CatmullRomCurve3([
        pt(0.02, 0.0),
        pt(0.08, height * 0.4),
        pt(reach * 0.62, height * 0.82),
        pt(reach, height),
      ]);
      const fil = new THREE.Mesh(this._track(new THREE.TubeGeometry(curve, 24, 0.009, 6, false)), this.filamentMat);
      this.stamens.add(fil);

      // versatile anther: balanced across the filament tip
      const tip = curve.getPointAt(1);
      const tan = curve.getTangentAt(1);
      const side = new THREE.Vector3().crossVectors(tan, R).normalize();
      const anther = new THREE.Mesh(antherGeo, this.antherMat);
      anther.position.copy(tip);
      anther.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        side.multiplyScalar(0.8).add(tan.clone().multiplyScalar(0.6)).normalize(),
      );
      anther.scale.set(0.028, 0.085, 0.028);
      this.stamens.add(anther);
    }

    const pistilCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.02, 0.4, 0.03),
      new THREE.Vector3(0.1, 0.78, 0.08),
      new THREE.Vector3(0.18, 0.95, 0.12),
    ]);
    const pistil = new THREE.Mesh(this._track(new THREE.TubeGeometry(pistilCurve, 30, 0.016, 8, false)), this.pistilMat);
    this.stamens.add(pistil);
    const stigma = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.042, 16, 12)), this.pistilMat);
    stigma.position.copy(pistilCurve.getPointAt(1));
    stigma.scale.set(1, 0.8, 1);
    this.stamens.add(stigma);

    // intro burst blooms out of the flower's heart
    this.introParticles.group.position.copy(HEAD_DIR).multiplyScalar(0.35);
  }

  _buildBud() {
    this.budPivot = new THREE.Group();
    this.budPivot.position.copy(this.budBase);
    this.plant.add(this.budPivot);
    this.budHead = new THREE.Group();
    this.budHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), BUD_DIR);
    this.budPivot.add(this.budHead);

    this.budRing = new PetalRing({ length: 0.95, width: 0.36, roll: 1.1 });
    this._track(this.budRing.geometry);
    this.budMat = this._petalMaterial(this.budRing.length);
    const bud = new THREE.Mesh(this.budRing.geometry, this.budMat);
    bud.frustumCulled = false;
    this.budHead.add(bud);
  }

  /* ---------------- atmosphere ---------------- */

  _buildAmbient(glowTexture) {
    const count = this.mobile ? 220 : 420;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([rand(-6, 6), rand(-3, 3.4), rand(-2.5, 1.2)], i * 3);
      seed[i] = Math.random();
    }
    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.ambientMat = this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.shared.uTime,
          uWind: this.shared.uWind,
          uScale: this.shared.uScale,
          uTint: { value: this.cols.tint },
          uMap: { value: glowTexture },
        },
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const dust = new THREE.Points(geo, this.ambientMat);
    dust.frustumCulled = false;
    this.group.add(dust);
  }

  _buildHalo() {
    const geo = this._track(new THREE.PlaneGeometry(6, 6));
    this.haloMat = this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.shared.uTime,
          uColor: { value: this.cols.halo },
          uStrength: { value: 0 },
        },
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const halo = new THREE.Mesh(geo, this.haloMat);
    halo.position.set(0.3, 0.2, -1.8);
    this.plant.add(halo);
  }

  /* ---------------- timeline ---------------- */

  get introDuration() {
    return this.introParticles.duration;
  }

  get lastBloomEnd() {
    return this.introDuration + BLOOM_END;
  }

  fullyBloomed(time) {
    return time >= this.lastBloomEnd;
  }

  restartIntro() {
    this.introParticles.restart();
  }

  /* ---------------- public API ---------------- */

  setPalette(index, instant = false) {
    this.introParticles.setPalette(index, instant);
    const p = PALETTES[index % PALETTES.length];
    const white = new THREE.Color('#ffffff');
    for (const [k, hex] of Object.entries(p.lily)) this.targets[k].set(hex);
    this.targets.stem.set(p.stem);
    this.targets.tint.set(p.centre).lerp(white, 0.5);
    this.targets.halo.set(p.lily.main);
    if (instant) for (const k in this.cols) this.cols[k].copy(this.targets[k]);
  }

  setWind(x, y) {
    this.shared.uWind.value.set(x, y);
    this.wind.set(x, y);
    this.introParticles.setWind(x, y);
  }

  setScale(s) {
    this.shared.uScale.value = s;
    this.introParticles.setScale(s);
  }

  /** Place the plant in world space (scene.js decides left vs. top). */
  setLayout(x, y, scale = 1) {
    this.plant.position.set(x, y, 0);
    this.plant.scale.setScalar(scale);
  }

  update(dt, time) {
    const bt = time - this.introDuration; // timeline after the intro
    this.shared.uTime.value = bt;
    this.introParticles.update(dt, time);
    const T = TIMELINE;
    const wx = this.wind.x;
    const wy = this.wind.y;

    // stems climb
    this.stemMat.uniforms.uGrowth.value = easeInOutCubic((bt - T.stem[0]) / (T.stem[1] - T.stem[0]));
    this.budStemMat.uniforms.uGrowth.value = easeInOutCubic((bt - T.budStem[0]) / (T.budStem[1] - T.budStem[0]));

    // main flower: bud swells at the stem tip, then opens
    const swell = easeOutCubic((bt - T.swell[0]) / (T.swell[1] - T.swell[0]));
    const open = easeInOutCubic((bt - T.open[0]) / (T.open[1] - T.open[0]));
    this.head.visible = swell > 0.001;
    this.head.scale.setScalar(lerp(0.2, 1, swell));
    this.petalMat.uniforms.uBloom.value = open;
    this.ring.shape(open, bt, wx, wy);

    const st = easeOutCubic((bt - T.stamens[0]) / (T.stamens[1] - T.stamens[0]));
    this.stamens.visible = st > 0.001;
    this.stamens.scale.set(lerp(0.4, 1, st), lerp(0.25, 1, st), lerp(0.4, 1, st));

    // the side bud stays closed, just swelling and blushing a little
    const bs = easeOutCubic((bt - T.budSwell[0]) / (T.budSwell[1] - T.budSwell[0]));
    this.budHead.visible = bs > 0.001;
    this.budHead.scale.setScalar(lerp(0.2, 0.8, bs));
    const budOpen = 0.06 * bs + 0.015 * Math.sin(bt * 0.8) * bs;
    this.budMat.uniforms.uBloom.value = 0.6 * bs;
    if (this.budHead.visible) this.budRing.shape(budOpen, bt, wx, wy);

    // breeze + cursor: the head leans gently, the bud bobs
    const s = Math.max(swell, 0.0001);
    this.sway.rotation.z = (-wx * 0.07 + Math.sin(bt * 0.55) * 0.025) * s;
    this.sway.rotation.x = (-wy * 0.05 + Math.cos(bt * 0.45) * 0.02) * s;
    this.budPivot.rotation.z = -wx * 0.1 + Math.sin(bt * 0.7 + 1.3) * 0.04;
    this.budPivot.rotation.x = -wy * 0.06;

    this.haloMat.uniforms.uStrength.value = 0.25 + 0.75 * open;

    // smooth palette transitions
    const k = 1 - Math.exp(-dt * 2.2);
    for (const key in this.cols) this.cols[key].lerp(this.targets[key], k);
  }

  dispose() {
    this.introParticles.dispose();
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    for (const d of this.disposables) d.dispose?.();
    this.disposables.clear();
  }
}
