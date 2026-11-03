import * as THREE from 'three';
import { PALETTES, FLOWER_ORDER } from './palettes.js';

const TAU = Math.PI * 2;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function easeInOutCubic(x) {
  x = clamp01(x);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/* ------------------------------------------------------------------ */
/*  Shaders                                                            */
/* ------------------------------------------------------------------ */

const STEM_VERT = /* glsl */ `
  attribute float aLen;
  uniform float uTime;
  uniform vec2  uWind;
  uniform float uPhase;
  varying float vLen;
  varying float vLight;
  void main() {
    vLen = aLen;
    vec3 pos = position;
    float bend = aLen * aLen;
    pos.x += (sin(uTime * 0.9 + uPhase) * 0.05 + uWind.x * 0.16) * bend;
    pos.z += (cos(uTime * 0.75 + uPhase * 1.4) * 0.045 + uWind.y * 0.11) * bend;
    vLight = 0.6 + 0.4 * max(normal.y, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const STEM_FRAG = /* glsl */ `
  varying float vLen;
  varying float vLight;
  uniform float uGrowth;
  uniform vec3  uColor;
  uniform float uTime;
  void main() {
    if (vLen > uGrowth) discard;
    vec3 col = mix(uColor * 0.45, uColor * 1.3, pow(vLen, 0.7)) * vLight;
    float tipGlow = smoothstep(0.05, 0.0, uGrowth - vLen);
    col += vec3(0.45, 0.95, 0.5) * tipGlow * (0.8 + 0.2 * sin(uTime * 5.0));
    gl_FragColor = vec4(col, 1.0);
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
    vec3 world = aBase + p;
    world.x += (sin(uTime * 1.05 + aBase.x * 2.5 + aBase.z * 3.1) * 0.035 + uWind.x * 0.09) * aLen;
    world.z += (cos(uTime * 0.85 + aBase.z * 2.2) * 0.03 + uWind.y * 0.07) * aLen;
    world.y += sin(uTime * 1.3 + aBase.y * 4.0) * 0.012 * aLen;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

const LEAF_FRAG = /* glsl */ `
  varying float vLen;
  varying float vAcross;
  varying float vG;
  uniform vec3  uColor;
  uniform float uTime;
  void main() {
    if (vG < 0.02) discard;
    vec3 col = mix(uColor * 0.35, uColor * 1.4, pow(vLen, 0.8));
    col += vec3(0.16, 0.28, 0.13) * (1.0 - abs(vAcross)) * (0.4 + 0.6 * vLen);
    col *= 0.9 + 0.1 * sin(uTime * 1.2 + vLen * 6.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FLOWER_VERT = /* glsl */ `
  attribute vec3  aBud;
  attribute float aT;
  attribute float aKind;   // 0 = petal, 1 = stamen
  attribute float aSeed;
  uniform float uTime;
  uniform vec2  uWind;
  uniform float uBloom;
  uniform float uPhase;
  uniform float uScale;
  uniform vec3  uInner;
  uniform vec3  uOuter;
  uniform vec3  uCentre;
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    float b = uBloom;
    vec3 pos = mix(aBud, position, b);

    if (aKind > 0.5) {
      pos.y *= (0.3 + 0.7 * b);
      pos.xz *= (0.25 + 0.75 * b);
    }

    // gentle breeze — sway grows with distance from the flower core
    float swayAmt = length(pos.xz) + pos.y * 0.5;
    float sw  = sin(uTime * 1.1 + uPhase + aSeed * 6.2831);
    float sw2 = cos(uTime * 0.8 + uPhase * 1.7 + aSeed * 4.0);
    pos.x += sw  * 0.035 * swayAmt + uWind.x * 0.06 * swayAmt;
    pos.z += sw2 * 0.035 * swayAmt + uWind.y * 0.05 * swayAmt;
    pos.y += sin(uTime * 1.3 + aSeed * 9.0) * 0.008;

    vec3 petalCol = mix(uInner, uOuter, pow(aT, 0.75));
    vec3 col = aKind > 0.5 ? uCentre : petalCol;

    // while still a bud, tint green — fading into petal colour as it opens
    vec3 green = vec3(0.22, 0.52, 0.26);
    col = mix(green * 0.9, col, smoothstep(0.05, 0.45, b) * (0.55 + 0.45 * aT));

    float tw = 0.85 + 0.3 * sin(uTime * 2.0 + aSeed * 43.0);
    if (aSeed > 0.92) tw *= 1.4 + 0.7 * sin(uTime * 5.0 + aSeed * 90.0);

    vColor = col * tw;
    vAlpha = (0.5 + 0.5 * aT) * smoothstep(0.0, 0.2, b + aSeed * 0.08);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float size = 0.02 + 0.028 * aT + aSeed * 0.014;
    size *= 1.0 + aKind * 0.45;
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FLOWER_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * 1.3, a);
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
    p.y = mod(p.y + uTime * (0.04 + aSeed * 0.07), 5.2) - 2.1;
    p.x += sin(uTime * 0.25 + aSeed * 21.0) * 0.22 + uWind.x * 0.15;
    p.z += cos(uTime * 0.2  + aSeed * 17.0) * 0.18 + uWind.y * 0.10;
    float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + aSeed * 60.0);
    vA = tw * (0.22 + aSeed * 0.45);
    vC = uTint * (0.7 + aSeed * 0.7);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (0.012 + aSeed * 0.03) * uScale / max(0.1, -mv.z);
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
  void main() {
    float d = length((vUv - 0.5) * vec2(1.0, 1.25)) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.2) * 0.13 * (0.85 + 0.15 * sin(uTime * 0.6));
    gl_FragColor = vec4(uColor, a);
  }
`;

/* ------------------------------------------------------------------ */
/*  Geometry builders                                                  */
/* ------------------------------------------------------------------ */

const BASE_Y = -1.95;
const TUBULAR = 56;
const RADIAL = 7;

/** Generate one lily: puckered 6-petal open pose + closed bud pose. */
function genFlowerGeometry(count) {
  const stamenCount = Math.floor(count * 0.16);
  const pos = new Float32Array(count * 3);
  const bud = new Float32Array(count * 3);
  const aT = new Float32Array(count);
  const aKind = new Float32Array(count);
  const aSeed = new Float32Array(count);

  const PETAL_LEN = 0.6;
  const PETAL_WID = 0.24;

  for (let i = 0; i < count; i++) {
    aSeed[i] = Math.random();
    if (i >= count - stamenCount) {
      aKind[i] = 1;
      const a = Math.random() * TAU;
      const rr = Math.sqrt(Math.random()) * 0.09;
      const h = 0.12 + Math.random() * 0.3;
      pos.set([Math.cos(a) * rr, h, Math.sin(a) * rr], i * 3);
      bud.set([Math.cos(a) * rr * 0.3, 0.04 + Math.random() * 0.1, Math.sin(a) * rr * 0.3], i * 3);
      aT[i] = 0.05;
      continue;
    }
    aKind[i] = 0;
    const petal = i % 6;
    const t = Math.pow(Math.random(), 0.7);
    const s = Math.random() * 2 - 1;
    const ang = (petal / 6) * TAU + (Math.random() - 0.5) * 0.16;

    const w = Math.sin(Math.PI * Math.pow(t, 0.8));
    const lat = s * w * PETAL_WID;
    const fwd = t * PETAL_LEN;
    const y =
      0.3 * Math.sin(t * Math.PI * 0.55) -
      0.2 * Math.pow(t, 3) -
      0.09 * Math.abs(s) * w;

    const dx = Math.sin(ang);
    const dz = Math.cos(ang);
    const sx = dz;
    const sz = -dx;

    pos.set(
      [
        dx * fwd + sx * lat + (Math.random() - 0.5) * 0.02,
        y + (Math.random() - 0.5) * 0.02,
        dz * fwd + sz * lat + (Math.random() - 0.5) * 0.02,
      ],
      i * 3,
    );

    const by = 0.02 + t * 0.42;
    const br = 0.025 + (1 - t) * 0.05;
    const ba = (petal / 6) * TAU + s * 0.4;
    bud.set([Math.cos(ba) * br, by, Math.sin(ba) * br], i * 3);
    aT[i] = t;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aBud', new THREE.BufferAttribute(bud, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  return geo;
}

/** One leaf blade in local space (base at origin, extends +Y). */
function leafBlade(leafLen, leafWid) {
  const COLS = 3;
  const ROWS = 8;
  const verts = [];
  const aLen = [];
  const aAcross = [];
  const idx = [];

  for (let r = 0; r < ROWS; r++) {
    const al = r / (ROWS - 1);
    const prof = Math.sin(Math.PI * Math.pow(al, 0.75));
    for (let c = 0; c < COLS; c++) {
      const across = (c / (COLS - 1)) * 2 - 1;
      const lx = across * (leafWid * 0.5) * prof;
      const ly = al * leafLen;
      const lz = (1 - Math.abs(across)) * 0.06 * prof - al * al * 0.08;
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
  return { verts, aLen, aAcross, idx, COLS, ROWS };
}

/* ------------------------------------------------------------------ */
/*  Bouquet                                                            */
/* ------------------------------------------------------------------ */

export class Bouquet {
  constructor(glowTexture, opts = {}) {
    this.mobile = !!opts.mobile;
    this.group = new THREE.Group();
    this.disposables = new Set();

    // shared uniforms — one update drives every material
    this.shared = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0, 0) },
      uScale: { value: 1000 },
    };

    // palette colours: current (uniforms) -> target (lerped)
    this.stemCol = new THREE.Color();
    this.stemTarget = new THREE.Color();
    this.tintCol = new THREE.Color();
    this.tintTarget = new THREE.Color();
    this.haloCol = new THREE.Color();
    this.haloTarget = new THREE.Color();
    this.flowerCols = FLOWER_ORDER.map(() => ({
      inner: new THREE.Color(),
      outer: new THREE.Color(),
      centre: new THREE.Color(),
    }));
    this.flowerTargets = FLOWER_ORDER.map(() => ({
      inner: new THREE.Color(),
      outer: new THREE.Color(),
      centre: new THREE.Color(),
    }));

    this.stems = []; // { mat, growthStart, growthDur }
    this.flowers = []; // { mat, bloomStart, bloomDur }
    this.leafMat = null;
    this.ambientMat = null;
    this.haloMat = null;

    this._buildStems();
    this._buildLeaves();
    this._buildFlowers(glowTexture);
    this._buildAmbient(glowTexture);
    this._buildHalo();
    this._buildTie(glowTexture);

    this.setPalette(0, true);
  }

  /* ---------------- build helpers ---------------- */

  _track(obj) {
    this.disposables.add(obj);
    return obj;
  }

  _buildStems() {
    const mat = (phase) =>
      this._track(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: this.shared.uTime,
            uWind: this.shared.uWind,
            uColor: { value: this.stemCol },
            uPhase: { value: phase },
            uGrowth: { value: 0 },
          },
          vertexShader: STEM_VERT,
          fragmentShader: STEM_FRAG,
          side: THREE.DoubleSide,
        }),
      );

    this._stemData = [];

    for (let i = 0; i < FLOWER_ORDER.length; i++) {
      const isCenter = i === 0;
      const ang = (i / FLOWER_ORDER.length) * TAU + rand(-0.3, 0.3);
      const r = isCenter ? 0 : rand(0.35, 1.2);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r * 0.55;
      const headY = 1.25 - r * 0.5 + rand(-0.08, 0.22) + (isCenter ? 0.12 : 0);

      const base = new THREE.Vector3(rand(-0.12, 0.12), BASE_Y + rand(0, 0.1), rand(-0.12, 0.12));
      const tie = new THREE.Vector3(x * 0.15, -1.45, z * 0.15);
      const p1 = new THREE.Vector3(x * 0.4, -0.7 + rand(-0.1, 0.1), z * 0.4);
      const p2 = new THREE.Vector3(x * 0.75, 0.35, z * 0.75);
      const head = new THREE.Vector3(x, headY, z);

      const curve = new THREE.CatmullRomCurve3([base, tie, p1, p2, head]);
      const geo = this._track(new THREE.TubeGeometry(curve, TUBULAR, 0.032, RADIAL, false));

      // aLen along the tube (vertex rings are generated in order)
      const count = geo.attributes.position.count;
      const aLen = new Float32Array(count);
      const ringSize = RADIAL + 1;
      for (let v = 0; v < count; v++) aLen[v] = Math.floor(v / ringSize) / TUBULAR;
      geo.setAttribute('aLen', new THREE.BufferAttribute(aLen, 1));

      const material = mat(rand(TAU));
      const mesh = new THREE.Mesh(geo, material);
      this.group.add(mesh);

      const growthStart = (i % 4) * 0.4 + rand(0, 0.25);
      const growthDur = rand(3.4, 3.8);

      this.stems.push({ mat: material, growthStart, growthDur });
      this._stemData.push({
        curve,
        head,
        headPos: { x, z, y: headY },
        scale: isCenter ? 1.18 : rand(0.8, 1.05),
        growthStart,
        growthDur,
        index: i,
      });
    }
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

    for (const sd of this._stemData) {
      const ts = [0.34, 0.52, 0.7];
      for (let j = 0; j < ts.length; j++) {
        const t = ts[j] + rand(-0.05, 0.05);
        const attach = sd.curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1));

        let hd = new THREE.Vector3(attach.x, 0, attach.z);
        if (hd.lengthSq() < 0.01) hd = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1));
        const dir = hd.multiplyScalar(0.9).add(new THREE.Vector3(0, 0.55, 0)).normalize();

        const yAxis = dir.clone();
        let xAxis = new THREE.Vector3().crossVectors(yAxis, new THREE.Vector3(0, 0, 1));
        if (xAxis.lengthSq() < 0.001) xAxis = new THREE.Vector3(1, 0, 0);
        xAxis.normalize();
        // random roll around the leaf axis
        const roll = rand(TAU);
        const q = new THREE.Quaternion().setFromAxisAngle(yAxis, roll);
        xAxis.applyQuaternion(q);
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

        const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const blade = leafBlade(rand(0.4, 0.55), rand(0.16, 0.2));
        const v = new THREE.Vector3();

        for (let k = 0; k < blade.verts.length; k += 3) {
          v.set(blade.verts[k], blade.verts[k + 1], blade.verts[k + 2]).applyMatrix4(m);
          allPos.push(v.x, v.y, v.z);
          allBase.push(attach.x, attach.y, attach.z);
          allAxis.push(xAxis.x, xAxis.y, xAxis.z);
        }
        allLen.push(...blade.aLen);
        allAcross.push(...blade.aAcross);
        for (let k = 0; k < blade.aLen.length; k++) {
          allGrow.push(sd.growthStart + 1.6 + j * 0.7 + rand(0, 0.5));
        }
        for (const ix of blade.idx) allIdx.push(ix + vOffset);
        vOffset += blade.aLen.length;
      }
    }

    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPos), 3));
    geo.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(allBase), 3));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(allAxis), 3));
    geo.setAttribute('aLen', new THREE.BufferAttribute(new Float32Array(allLen), 1));
    geo.setAttribute('aAcross', new THREE.BufferAttribute(new Float32Array(allAcross), 1));
    geo.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(allGrow), 1));
    geo.setIndex(allIdx);

    this.leafMat = this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.shared.uTime,
          uWind: this.shared.uWind,
          uColor: { value: this.stemCol },
        },
        vertexShader: LEAF_VERT,
        fragmentShader: LEAF_FRAG,
        side: THREE.DoubleSide,
      }),
    );
    this.group.add(new THREE.Mesh(geo, this.leafMat));
  }

  _buildFlowers(glowTexture) {
    const perFlower = this.mobile ? 1250 : 2550;

    for (let i = 0; i < this._stemData.length; i++) {
      const sd = this._stemData[i];
      const cols = this.flowerCols[i];

      const mat = this._track(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: this.shared.uTime,
            uWind: this.shared.uWind,
            uScale: this.shared.uScale,
            uMap: { value: glowTexture },
            uBloom: { value: 0 },
            uPhase: { value: rand(TAU) },
            uInner: { value: cols.inner },
            uOuter: { value: cols.outer },
            uCentre: { value: cols.centre },
          },
          vertexShader: FLOWER_VERT,
          fragmentShader: FLOWER_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );

      const geo = this._track(genFlowerGeometry(perFlower));
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.position.copy(sd.head);

      const outward = new THREE.Vector3(sd.headPos.x * 0.6, 1, sd.headPos.z * 0.6).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(TAU)));
      points.quaternion.copy(q);
      points.scale.setScalar(sd.scale);

      this.group.add(points);
      this.flowers.push({
        mat,
        bloomStart: sd.growthStart + sd.growthDur - 0.4 + i * 0.55 + rand(0, 0.3),
        bloomDur: rand(3.2, 3.8),
      });
    }
  }

  _buildAmbient(glowTexture) {
    const count = this.mobile ? 250 : 500;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([rand(-4, 4), rand(-2, 3), rand(-2, 1.2)], i * 3);
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
          uTint: { value: this.tintCol },
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
    const geo = this._track(new THREE.PlaneGeometry(6.5, 5));
    this.haloMat = this._track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.shared.uTime,
          uColor: { value: this.haloCol },
        },
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const halo = new THREE.Mesh(geo, this.haloMat);
    halo.position.set(0, 0.7, -1.6);
    this.group.add(halo);
  }

  _buildTie(glowTexture) {
    const mat = this._track(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: this.tintCol,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const tie = new THREE.Sprite(mat);
    tie.position.set(0, -1.5, 0);
    tie.scale.set(0.55, 0.55, 1);
    this.group.add(tie);
  }

  /* ---------------- public API ---------------- */

  setPalette(index, instant = false) {
    const p = PALETTES[index % PALETTES.length];
    const white = new THREE.Color('#ffffff');
    const black = new THREE.Color('#000000');

    FLOWER_ORDER.forEach((fi, k) => {
      const c = new THREE.Color(p.petals[fi]);
      const tgt = this.flowerTargets[k];
      tgt.inner.copy(c).lerp(white, 0.5);
      tgt.outer.copy(c).lerp(black, 0.15);
      tgt.centre.set(p.centre);
    });
    this.stemTarget.set(p.stem);
    this.tintTarget.set(p.centre).lerp(white, 0.6);
    this.haloTarget.set(p.petals[2]);

    if (instant) this._snapColors();
  }

  _snapColors() {
    this.stemCol.copy(this.stemTarget);
    this.tintCol.copy(this.tintTarget);
    this.haloCol.copy(this.haloTarget);
    this.flowerCols.forEach((c, k) => {
      c.inner.copy(this.flowerTargets[k].inner);
      c.outer.copy(this.flowerTargets[k].outer);
      c.centre.copy(this.flowerTargets[k].centre);
    });
  }

  setWind(x, y) {
    this.shared.uWind.value.set(x, y);
  }

  setScale(s) {
    this.shared.uScale.value = s;
  }

  update(dt, time) {
    this.shared.uTime.value = time;

    for (const s of this.stems) {
      s.mat.uniforms.uGrowth.value = easeInOutCubic((time - s.growthStart) / s.growthDur);
    }
    for (const f of this.flowers) {
      f.mat.uniforms.uBloom.value = easeInOutCubic((time - f.bloomStart) / f.bloomDur);
    }

    // smooth palette transitions
    const k = 1 - Math.exp(-dt * 2.2);
    this.stemCol.lerp(this.stemTarget, k);
    this.tintCol.lerp(this.tintTarget, k);
    this.haloCol.lerp(this.haloTarget, k);
    this.flowerCols.forEach((c, i) => {
      c.inner.lerp(this.flowerTargets[i].inner, k);
      c.outer.lerp(this.flowerTargets[i].outer, k);
      c.centre.lerp(this.flowerTargets[i].centre, k);
    });
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
