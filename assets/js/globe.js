// Remote-work globe: a dot-matrix Earth (land sampled from world-atlas) with
// arcs flying from Abuja to every place Zion shipped for. Draggable, slowly
// auto-rotating, pauses on interaction. Pins are real, focusable buttons.
import * as THREE from 'three';
import { feature } from 'topojson-client';
import { reducedMotion, lowPower, pixelRatio, clamp, lerp, renderLoop, onResize, webgl2 } from './util.js';

const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
const RAD = Math.PI / 180;

/** Unit-sphere position for a lat/lon; lon 0 faces +z (the camera) when unrotated. */
const toVec = (lat, lon, r = 1) => new THREE.Vector3(
  Math.cos(lat * RAD) * Math.sin(lon * RAD) * r,
  Math.sin(lat * RAD) * r,
  Math.cos(lat * RAD) * Math.cos(lon * RAD) * r,
);

export async function initGlobe(root) {
  const canvas = root.querySelector('canvas');
  const pinLayer = root.querySelector('.globe-pins');
  const card = root.querySelector('.globe-card');
  const places = [...document.querySelectorAll('.places li')].map((li) => ({
    lat: +li.dataset.lat,
    lon: +li.dataset.lon,
    home: li.hasAttribute('data-home'),
    city: li.querySelector('b').textContent,
    org: li.querySelector('span').textContent,
  }));
  const home = places.find((p) => p.home);

  const topology = await (await fetch(LAND_URL)).json();
  const dots = landDots(feature(topology, topology.objects.land), lowPower ? 1.5 : 1.05);

  const renderer = new THREE.WebGLRenderer({ canvas, context: webgl2(canvas) });
  renderer.setPixelRatio(pixelRatio());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.z = 4.6;
  const globe = new THREE.Group();
  scene.add(globe);

  // Ocean body hides the far side; a fresnel shell gives the atmosphere glow.
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.99, 64, 32), new THREE.MeshBasicMaterial({ color: 0x0c1428 })));
  scene.add(atmosphere());
  const dotPoints = makeDots(dots);
  globe.add(dotPoints);

  const arcs = places.filter((p) => !p.home).map((p, i) => makeArc(home, p, i / places.length));
  arcs.forEach((a) => globe.add(a));
  const markers = makeMarkers(places);
  globe.add(markers);

  // Rotation state: auto-rotate, drag, or ease toward a focused pin.
  const rot = { x: 0.32, y: 0.55 };
  let target = null;
  let dragging = false;
  let idleUntil = 0;
  let last = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    target = null;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    loop.invalidate();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rot.y += (e.clientX - last.x) * 0.006;
    rot.x = clamp(rot.x + (e.clientY - last.y) * 0.004, -0.9, 0.9);
    last = { x: e.clientX, y: e.clientY };
    loop.invalidate();
  });
  const release = () => {
    dragging = false;
    idleUntil = performance.now() / 1000 + 3.5;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Pins
  const select = (pin) => {
    pins.forEach((p) => p.el.classList.toggle('is-active', p === pin));
    card.replaceChildren(Object.assign(document.createElement('b'), { textContent: pin.place.city }), pin.place.org);
    card.classList.add('is-on');
    // Turn the shortest way round so the pin faces the viewer.
    let ty = -pin.place.lon * RAD;
    ty += Math.round((rot.y - ty) / (2 * Math.PI)) * 2 * Math.PI;
    target = { x: clamp(pin.place.lat * RAD, -0.9, 0.9), y: ty };
    idleUntil = performance.now() / 1000 + 6;
    loop.invalidate();
  };
  const pins = places.map((place) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `pin${place.home ? ' is-home' : ''}`;
    el.setAttribute('aria-label', `${place.city}: ${place.org}`);
    el.addEventListener('click', () => select(pin));
    el.addEventListener('focus', () => select(pin));
    pinLayer.append(el);
    const pin = { el, place, pos: toVec(place.lat, place.lon, 1.01) };
    return pin;
  });
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget)) card.classList.remove('is-on');
  });

  let size = 1;
  const v = new THREE.Vector3();
  const frame = (t, dt) => {
    if (target) {
      rot.x = lerp(rot.x, target.x, 0.08);
      rot.y = lerp(rot.y, target.y, 0.08);
      if (Math.abs(rot.y - target.y) < 0.002 && Math.abs(rot.x - target.x) < 0.002) target = null;
    } else if (!dragging && !reducedMotion && t > idleUntil) {
      rot.y += dt * 0.09;
    }
    globe.rotation.set(rot.x, rot.y, 0);
    arcs.forEach((a) => (a.material.uniforms.uTime.value = reducedMotion ? 0.6 : t));
    markers.material.uniforms.uTime.value = reducedMotion ? 0 : t;
    renderer.render(scene, camera);

    globe.updateMatrixWorld();
    pins.forEach(({ el, pos }) => {
      v.copy(pos).applyMatrix4(globe.matrixWorld);
      const front = v.z > 0.12;
      v.project(camera);
      el.style.transform = `translate(${((v.x * 0.5 + 0.5) * size).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * size).toFixed(1)}px)`;
      el.classList.toggle('is-back', !front);
    });
    // Static scenes still need frames while easing toward a pin or dragging.
    if (reducedMotion && (target || dragging)) requestAnimationFrame(() => loop.invalidate());
  };

  const loop = renderLoop(canvas, frame, { continuous: !reducedMotion });
  onResize(root, (w) => {
    size = w;
    renderer.setSize(w, w, false);
    dotPoints.material.uniforms.uScale.value = w * pixelRatio();
    markers.material.uniforms.uScale.value = w * pixelRatio();
    loop.invalidate();
  });
}

/**
 * Rasterises the land polygons to an equirectangular canvas, then keeps the
 * points of an equal-area lat/lon grid that land on a filled pixel.
 */
function landDots(land, step) {
  const W = 1440;
  const H = 720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const f of land.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) {
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => ctx[i ? 'lineTo' : 'moveTo'](((lon + 180) / 360) * W, ((90 - lat) / 180) * H));
        ctx.closePath();
      }
    }
  }
  ctx.fill('evenodd');
  const pixels = ctx.getImageData(0, 0, W, H).data;

  const out = [];
  for (let lat = -84; lat <= 84; lat += step) {
    const n = Math.max(1, Math.round((360 * Math.cos(lat * RAD)) / step));
    for (let i = 0; i < n; i++) {
      const lon = -180 + (i / n) * 360;
      const x = Math.floor(((lon + 180) / 360) * (W - 1));
      const y = Math.floor(((90 - lat) / 180) * (H - 1));
      if (pixels[(y * W + x) * 4 + 3] > 128) out.push(toVec(lat, lon));
    }
  }
  return out;
}

function makeDots(dots) {
  const g = new THREE.BufferGeometry().setFromPoints(dots);
  return new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uScale: { value: 600 } },
    vertexShader: `
      uniform float uScale;
      varying float vLight, vLat;
      void main() {
        vec3 n = normalize(normalMatrix * position);
        vLight = smoothstep(-0.1, 0.8, n.z);
        vLat = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * 0.02 / -mv.z;
      }`,
    fragmentShader: `
      varying float vLight, vLat;
      void main() {
        if (length(gl_PointCoord - 0.5) > 0.5) discard;
        vec3 c = mix(vec3(0.05, 0.65, 0.64), vec3(0.36, 0.36, 0.84), smoothstep(-0.6, 0.8, vLat));
        gl_FragColor = vec4(c * (0.45 + 0.75 * vLight), 0.95);
      }`,
  }));
}

function atmosphere() {
  return new THREE.Mesh(new THREE.SphereGeometry(1.14, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec3 vN;
      void main() {
        float a = pow(clamp(0.78 + vN.z, 0.0, 1.0), 4.0);
        gl_FragColor = vec4(mix(vec3(0.36, 0.36, 0.84), vec3(0.05, 0.65, 0.64), 0.4), a * 0.9);
      }`,
  }));
}

/** Great-circle arc lifted off the surface; a glowing head travels along it. */
function makeArc(from, to, offset) {
  const a = toVec(from.lat, from.lon);
  const b = toVec(to.lat, to.lon);
  const angle = a.angleTo(b);
  const lift = 0.04 + angle * 0.22;
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const p = new THREE.Vector3().copy(a).lerp(b, t).normalize(); // slerp-equivalent direction for < 180°
    pts.push(p.multiplyScalar(1 + Math.sin(Math.PI * t) * lift));
  }
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.0045, 5, false);
  return new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOffset: { value: offset } },
    vertexShader: 'varying float vT; void main(){ vT = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime, uOffset;
      varying float vT;
      void main() {
        float head = fract(uTime * 0.28 + uOffset) * 1.4 - 0.2;
        float d = head - vT;
        float trail = d > 0.0 ? smoothstep(0.3, 0.0, d) : smoothstep(-0.015, 0.0, d);
        vec3 c = mix(vec3(0.95, 0.33, 0.35), vec3(0.49, 0.23, 0.93), vT);
        c = mix(c, vec3(0.05, 0.65, 0.64), smoothstep(0.6, 1.0, vT));
        gl_FragColor = vec4(c * 1.4, 0.16 + trail * 0.9);
      }`,
  }));
}

/** Pulsing rings at every place (home is coral and larger). */
function makeMarkers(places) {
  const g = new THREE.BufferGeometry().setFromPoints(places.map((p) => toVec(p.lat, p.lon, 1.012)));
  g.setAttribute('aHome', new THREE.Float32BufferAttribute(places.map((p) => (p.home ? 1 : 0)), 1));
  return new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
    vertexShader: `
      uniform float uScale;
      attribute float aHome;
      varying float vHome, vFront;
      void main() {
        vHome = aHome;
        vFront = step(0.1, normalize(normalMatrix * position).z);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (aHome > 0.5 ? 0.2 : 0.14) / -mv.z;
      }`,
    fragmentShader: `
      uniform float uTime;
      varying float vHome, vFront;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float ring = smoothstep(0.08, 0.0, abs(d - fract(uTime * 0.6))) * (1.0 - fract(uTime * 0.6));
        vec3 c = vHome > 0.5 ? vec3(0.95, 0.33, 0.35) : vec3(0.37, 0.92, 0.83);
        gl_FragColor = vec4(c, ring * vFront);
      }`,
  }));
}
