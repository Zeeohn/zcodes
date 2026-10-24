// System (About): particles fall in and settle into a 3D microservice graph.
// Packets travel along the edges like event messages. Node data (name, where
// it was used, position, colour) comes from the HTML list in #system, so the
// no-JS page and the 3D graph share one source of truth.
import * as THREE from 'three';
import { reducedMotion, lowPower, pixelRatio, clamp, lerp, renderLoop, onResize, webgl2, trackPointer } from './util.js';

const EDGES = [
  ['gateway', 'auth'], ['gateway', 'graphql'], ['gateway', 'socketio'], ['gateway', 'kafka'],
  ['auth', 'redis'], ['auth', 'postgres'], ['graphql', 'postgres'], ['graphql', 'mongodb'],
  ['kafka', 'redis'], ['kafka', 'socketio'], ['kafka', 'mongodb'], ['kafka', 'postgres'],
  ['socketio', 'redis'], ['cicd', 'gateway'], ['cicd', 'aws'], ['aws', 'kafka'], ['aws', 'mongodb'], ['cicd', 'postgres'],
];

export function initNetwork(root) {
  const canvas = root.querySelector('canvas');
  const labelLayer = root.querySelector('.node-labels');
  const inspector = root.querySelector('.node-inspector');
  const hudMsgs = root.querySelector('.hud-msgs');
  const hudP99 = root.querySelector('.hud-p99');

  const nodes = [...root.querySelectorAll('.node-list li')].map((li) => ({
    id: li.dataset.node,
    name: li.querySelector('b').textContent,
    usage: li.querySelector('span').textContent,
    pos: new THREE.Vector3(...li.dataset.pos.split(',').map(Number)),
    color: new THREE.Color(li.dataset.color),
    css: li.dataset.color,
  }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = EDGES.map(([a, b]) => [byId[a], byId[b]]);

  const renderer = new THREE.WebGLRenderer({ canvas, context: webgl2(canvas) });
  renderer.setPixelRatio(pixelRatio());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.z = 7.6;
  const graph = new THREE.Group();
  scene.add(graph);

  const glowNodes = makeNodes(nodes);
  const edgeLines = makeEdges(edges);
  const packets = makePackets(edges, lowPower ? 40 : 90);
  const dust = makeDust(nodes, edges, lowPower ? 1200 : 3200);
  graph.add(edgeLines, glowNodes, packets, dust);
  const scaled = [glowNodes, packets, dust];

  // Focusable labels, positioned over the canvas every frame.
  let active = null;
  const setActive = (node) => {
    active = node;
    labels.forEach((l) => l.el.classList.toggle('is-active', l.node === node));
    glowNodes.geometry.attributes.aSize.array.forEach((_, i, arr) => (arr[i] = nodes[i] === node ? 1.9 : 1));
    glowNodes.geometry.attributes.aSize.needsUpdate = true;
    if (node) {
      const tag = Object.assign(document.createElement('span'), { className: 'mono', textContent: `${node.name} →` });
      inspector.replaceChildren(tag, node.usage);
    }
    loop.invalidate();
  };
  const labels = nodes.map((node) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'node-label';
    el.textContent = node.name;
    el.style.setProperty('--c', node.css);
    el.setAttribute('aria-describedby', 'node-inspector');
    ['pointerenter', 'focus', 'click'].forEach((ev) => el.addEventListener(ev, () => setActive(node)));
    labelLayer.append(el);
    return { el, node };
  });
  inspector.id = 'node-inspector';
  labelLayer.addEventListener('focusout', (e) => {
    if (!labelLayer.contains(e.relatedTarget)) paused = false;
  });
  labelLayer.addEventListener('focusin', () => (paused = true));

  // Hovering near a node on the canvas also activates it.
  const pointer = trackPointer(root);
  const projected = nodes.map(() => new THREE.Vector2());
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = null;
    let bestD = 36;
    projected.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) [best, bestD] = [nodes[i], d];
    });
    if (best && best !== active) setActive(best);
  });

  let width = 1;
  let height = 1;
  let paused = false;
  let swayTime = 0;
  let msgs = 1204553;
  let nextHud = 0;
  const tmp = new THREE.Vector3();

  const settleProgress = () => {
    if (reducedMotion) return 1;
    const r = root.getBoundingClientRect();
    return clamp((innerHeight - r.top) / (innerHeight * 0.55));
  };

  const frame = (t, dt) => {
    const settle = settleProgress();
    if (!reducedMotion) {
      if (!paused) swayTime += dt;
      graph.rotation.y = lerp(graph.rotation.y, Math.sin(swayTime * 0.18) * 0.38 + pointer.x * 0.22, 0.05);
      graph.rotation.x = lerp(graph.rotation.x, pointer.y * 0.12, 0.05);
    }
    dust.material.uniforms.uSettle.value = settle;
    dust.material.uniforms.uTime.value = t;
    packets.material.uniforms.uTime.value = reducedMotion ? 0.35 : t;
    packets.material.uniforms.uOn.value = clamp((settle - 0.85) / 0.15);
    glowNodes.material.uniforms.uOn.value = clamp((settle - 0.55) / 0.45);
    edgeLines.material.opacity = 0.3 * clamp((settle - 0.6) / 0.4);
    renderer.render(scene, camera);

    // Labels follow their nodes.
    graph.updateMatrixWorld();
    const labelAlpha = clamp((settle - 0.75) / 0.25);
    labels.forEach(({ el, node }, i) => {
      tmp.copy(node.pos).applyMatrix4(graph.matrixWorld).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (-tmp.y * 0.5 + 0.5) * height;
      projected[i].set(x, y);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -160%)`;
      el.style.opacity = labelAlpha;
      el.style.visibility = labelAlpha > 0.05 ? 'visible' : 'hidden';
    });

    // Playful, clearly-labelled simulated telemetry.
    if (!reducedMotion && t > nextHud && settle > 0.9) {
      msgs += 40 + Math.floor(Math.random() * 160);
      hudMsgs.textContent = msgs.toLocaleString('en-US');
      if (Math.random() < 0.15) hudP99.textContent = `${(0.7 + Math.random() * 0.2).toFixed(1)}s`;
      nextHud = t + 0.12;
    }
  };

  const loop = renderLoop(canvas, frame, { continuous: !reducedMotion, fps: lowPower ? 30 : 60 });
  onResize(root, (w, h) => {
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Keep the ~6-unit-wide graph inside narrow (portrait) viewports.
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    graph.scale.setScalar(Math.min(1, (vh * camera.aspect) / 6.4));
    scaled.forEach((o) => (o.material.uniforms.uScale.value = h * pixelRatio()));
    loop.invalidate();
  });
}

function makeNodes(nodes) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(nodes.flatMap((n) => n.pos.toArray()), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(nodes.flatMap((n) => n.color.toArray()), 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(nodes.map(() => 1), 1));
  return new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uScale: { value: 800 }, uOn: { value: 0 } },
    vertexShader: `
      uniform float uScale;
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * 0.32 * aSize / -mv.z;
      }`,
    fragmentShader: `
      uniform float uOn;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float glow = exp(-d * d * 30.0) * 0.9;
        float core = smoothstep(0.09, 0.05, d);
        gl_FragColor = vec4(vColor * glow + core, (glow + core) * uOn);
      }`,
  }));
}

function makeEdges(edges) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(edges.flatMap(([a, b]) => [...a.pos.toArray(), ...b.pos.toArray()]), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(edges.flatMap(([a, b]) => [...a.color.toArray(), ...b.color.toArray()]), 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

/** Event messages: each packet loops along one edge; motion is computed on the GPU. */
function makePackets(edges, count) {
  const from = [];
  const to = [];
  const offset = [];
  const speed = [];
  const color = [];
  for (let i = 0; i < count; i++) {
    let [a, b] = edges[i % edges.length];
    if (Math.random() < 0.5) [a, b] = [b, a];
    from.push(...a.pos.toArray());
    to.push(...b.pos.toArray());
    offset.push(Math.random());
    speed.push(0.25 + Math.random() * 0.45);
    color.push(...a.color.clone().lerp(new THREE.Color('#ffffff'), 0.4).toArray());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(from, 3));
  g.setAttribute('aTo', new THREE.Float32BufferAttribute(to, 3));
  g.setAttribute('aOffset', new THREE.Float32BufferAttribute(offset, 1));
  g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  const points = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uScale: { value: 800 } },
    vertexShader: `
      uniform float uTime, uScale;
      attribute vec3 aTo;
      attribute float aOffset, aSpeed;
      varying vec3 vColor;
      varying float vA;
      void main() {
        float t = fract(uTime * aSpeed + aOffset);
        vec4 mv = modelViewMatrix * vec4(mix(position, aTo, t), 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * 0.07 / -mv.z;
        vColor = color;
        vA = sin(t * 3.14159);
      }`,
    fragmentShader: `
      uniform float uOn;
      varying vec3 vColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.0, d) * vA * uOn);
      }`,
  }));
  points.frustumCulled = false;
  return points;
}

/** Dust that falls in from above (continuing the hero's shatter) and settles on nodes and edges. */
function makeDust(nodes, edges, count) {
  const target = new Float32Array(count * 3);
  const start = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    let c;
    if (Math.random() < 0.6) {
      const n = nodes[i % nodes.length];
      v.randomDirection().multiplyScalar(Math.cbrt(Math.random()) * 0.22).add(n.pos);
      c = n.color;
    } else {
      const [a, b] = edges[i % edges.length];
      const t = Math.random();
      v.lerpVectors(a.pos, b.pos, t).add(new THREE.Vector3().randomDirection().multiplyScalar(0.04));
      c = a.color.clone().lerp(b.color, t);
    }
    v.toArray(target, i * 3);
    start.set([v.x + (Math.random() - 0.5) * 4, v.y + 5 + Math.random() * 5, v.z + (Math.random() - 0.5) * 2], i * 3);
    c.toArray(color, i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(target, 3));
  g.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const points = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uSettle: { value: 0 }, uTime: { value: 0 }, uScale: { value: 800 } },
    vertexShader: `
      uniform float uSettle, uTime, uScale;
      attribute vec3 aStart;
      attribute float aSeed;
      varying vec3 vColor;
      varying float vA;
      void main() {
        float s = clamp((uSettle - aSeed * 0.35) / 0.65, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - s, 3.0);
        vec3 pos = mix(aStart, position, e);
        pos += vec3(sin(uTime * 0.7 + aSeed * 50.0), cos(uTime * 0.6 + aSeed * 31.0), sin(uTime * 0.5 + aSeed * 17.0)) * 0.02 * e;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.012 + aSeed * 0.016) / -mv.z;
        vColor = color;
        vA = 0.35 + 0.5 * (1.0 - e) * step(0.001, s);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.0, d) * vA);
      }`,
  }));
  points.frustumCulled = false;
  return points;
}
