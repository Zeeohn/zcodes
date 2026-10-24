// Hero: the ZCODES Z mark extruded in 3D with a glossy iridescent material.
// It floats, tilts toward the cursor and, as the hero scrolls away, shatters
// into particles that stream down toward the system section.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { reducedMotion, lowPower, motion, pixelRatio, clamp, lerp, renderLoop, onResize, webgl2, nextTask } from './util.js';

export async function initHero(root) {
  const canvas = root.querySelector('canvas');
  const track = root.closest('.hero-track');
  const stage = root.closest('.hero-stage');
  const svg = await (await fetch('assets/zcodes-mark.svg')).text();

  const renderer = new THREE.WebGLRenderer({ canvas, context: webgl2(canvas) });
  renderer.setPixelRatio(pixelRatio());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  // Setup is split across tasks so no single step blocks the main thread for long.
  await nextTask();
  scene.environment = brandEnvironment(renderer);
  await nextTask();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.z = 10;

  const group = new THREE.Group();
  scene.add(group);

  const mesh = new THREE.Mesh(
    markGeometry(svg.replace(/currentColor/g, '#fff')),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.16,
      envMapIntensity: 1.25,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      iridescence: 0.85,
      iridescenceIOR: 1.45,
      iridescenceThicknessRange: [180, 520],
      transparent: true,
    }),
  );
  group.add(mesh);
  await nextTask();

  const particles = reducedMotion ? null : shatterParticles(mesh, lowPower ? 5000 : 12000);
  if (particles) {
    group.add(particles);
    particles.visible = true; // compile its shader up front, not on the first scroll
  }
  // Compile shaders off the main thread where the browser supports it.
  if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
  else renderer.compile(scene, camera);
  if (particles) particles.visible = false;

  // Pointer anywhere on the page steers the tilt.
  const pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  if (!reducedMotion) {
    addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  const scrollProgress = () => {
    if (reducedMotion) return 0;
    const r = track.getBoundingClientRect();
    const range = r.height - innerHeight;
    return range > 0 ? clamp(-r.top / range) : 0;
  };

  // Entrance: the mark spins and scales in as the boot preloader wipes away.
  const bootEnd = document.documentElement.classList.contains('boot') ? 1150 : 0;
  const introStart = Math.max(performance.now(), bootEnd);
  const introProgress = () => {
    if (reducedMotion || motion.paused) return 1;
    const x = clamp((performance.now() - introStart) / 1700);
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); // easeOutExpo
  };
  let fitScale = 1;

  let lastP = -1;
  const frame = (t) => {
    const p = scrollProgress();
    if (p !== lastP) {
      stage.style.setProperty('--hp', p.toFixed(3));
      lastP = p;
    }

    if (reducedMotion) {
      group.rotation.set(0.12, -0.38, 0);
    } else {
      tilt.x = lerp(tilt.x, pointer.y * 0.28, 0.05);
      tilt.y = lerp(tilt.y, pointer.x * 0.42, 0.05);
      group.rotation.x = tilt.x + Math.sin(t * 0.6) * 0.05;
      group.rotation.y = tilt.y - 0.22 + Math.sin(t * 0.4) * 0.14;
      group.position.y = Math.sin(t * 0.9) * 0.08;
    }
    const intro = introProgress();
    group.rotation.y += (1 - intro) * -2.4;
    group.scale.setScalar(fitScale * (0.55 + 0.45 * intro));
    // Sweep the reflections: a slow orbit plus the cursor, so light glides across the face.
    scene.environmentRotation.set(tilt.x * 0.6, t * 0.32 + tilt.y * 1.4, 0);

    // Shatter: the solid fades out as the particle cloud takes over.
    const solid = 1 - THREE.MathUtils.smoothstep(p, 0.02, 0.16);
    mesh.material.opacity = solid * Math.min(1, intro * 3);
    mesh.visible = solid > 0.01;
    mesh.scale.setScalar(1 + (1 - solid) * 0.06);
    if (particles) {
      particles.visible = p > 0.005;
      particles.material.uniforms.uProgress.value = p;
      particles.material.uniforms.uTime.value = t;
    }

    renderer.render(scene, camera);
  };

  const loop = renderLoop(canvas, frame, { continuous: !reducedMotion });

  onResize(root, (w, h) => {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Fit the mark to ~62% of the smaller visible dimension.
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    fitScale = Math.min(vh, vh * camera.aspect) * 0.62;
    if (particles) particles.material.uniforms.uScale.value = h * pixelRatio();
    loop.invalidate();
  });
}

/** Extrudes the SVG mark into a bevelled solid, flipped to y-up, centred, unit-sized. */
function markGeometry(svgText) {
  const { paths } = new SVGLoader().parse(svgText);
  // The mark is two solid strokes with no holes, so each sub-path becomes a shape
  // directly. (SVGLoader.createShapes tests every segment pair for even-odd holes,
  // which takes seconds on slower devices.)
  const shapes = paths.flatMap((path) => path.subPaths.map((sub) => {
    const shape = new THREE.Shape();
    shape.curves.push(...sub.curves);
    return shape;
  }));
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: 70,
    bevelEnabled: true,
    bevelThickness: 18,
    bevelSize: 9,
    bevelSegments: 6,
    curveSegments: 18,
  });
  geometry.rotateX(Math.PI); // SVG's y axis points down; a 180° turn flips y without mirroring
  geometry.center();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  geometry.scale(...Array(3).fill(1 / Math.max(size.x, size.y)));
  return geometry;
}

/**
 * Builds an HDR environment in brand colours (ink dome, indigo/violet/coral
 * glows, white softboxes) so the metal reflects ZCODES colours, not a grey room.
 */
function brandEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec3 vP;
        void main() {
          float y = vP.y * 0.5 + 0.5;
          vec3 c = mix(vec3(0.02, 0.03, 0.07), vec3(0.49, 0.23, 0.93) * 1.3, smoothstep(0.45, 1.0, y));
          c += vec3(0.36, 0.36, 0.84) * 2.2 * pow(max(0.0, dot(vP, normalize(vec3(-1.0, 0.25, 0.7)))), 3.0);
          c += vec3(0.95, 0.33, 0.35) * 1.6 * pow(max(0.0, dot(vP, normalize(vec3(1.0, -0.35, 0.5)))), 5.0);
          c += vec3(0.05, 0.65, 0.64) * 0.8 * pow(max(0.0, dot(vP, normalize(vec3(0.2, -1.0, 0.4)))), 4.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  ));
  const softbox = (color, intensity, position, w, h) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...position);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  softbox('#ffffff', 5, [0, 6, 5], 9, 1.1);
  softbox('#a5a6f6', 3.5, [-6, 0.5, 4], 1.2, 7);
  softbox('#c4a7ff', 2.5, [6, -1, 3], 1, 5);
  // A diagonal strip almost behind the camera: its reflection is the glossy streak
  // that sweeps across the Z's face as it tilts.
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(2.2), side: THREE.DoubleSide }));
  strip.position.set(1.6, 0.8, 6);
  strip.lookAt(0, 0, 0);
  strip.rotateZ(-0.7);
  env.add(strip);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  env.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return texture;
}

/** Points sampled on the mark's surface; uProgress (0..1) bursts them out and down. */
function shatterParticles(mesh, count) {
  const sampler = new MeshSurfaceSampler(mesh).build();
  const position = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(p, n);
    p.toArray(position, i * 3);
    // Outward burst biased along the surface normal, with some sideways spray.
    n.multiplyScalar(0.5).add(new THREE.Vector3().randomDirection().multiplyScalar(0.6));
    n.toArray(dir, i * 3);
    seed[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uProgress: { value: 0 }, uTime: { value: 0 }, uScale: { value: 800 } },
    vertexShader: `
      uniform float uProgress, uTime, uScale;
      attribute vec3 aDir;
      attribute float aSeed;
      varying float vSeed, vAlpha;
      void main() {
        float p = clamp((uProgress - aSeed * 0.18) / 0.82, 0.0, 1.0);
        float burst = 1.0 - pow(1.0 - p, 3.0);
        vec3 pos = position + aDir * burst * 0.9;
        pos.y -= p * p * (1.3 + aSeed * 2.4);          // stream down toward the next section
        pos.x += sin(uTime * 0.9 + aSeed * 40.0) * 0.04 * p;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.02 + aSeed * 0.03) / -mv.z;
        vSeed = aSeed;
        vAlpha = smoothstep(0.0, 0.06, uProgress) * (1.0 - smoothstep(0.88, 1.0, p) * 0.6);
      }`,
    fragmentShader: `
      varying float vSeed, vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        vec3 indigo = vec3(0.36, 0.36, 0.84), violet = vec3(0.49, 0.23, 0.93), coral = vec3(0.95, 0.33, 0.35);
        vec3 c = mix(indigo, violet, smoothstep(0.0, 0.7, vSeed));
        c = mix(c, coral, step(0.9, vSeed));
        c = mix(c, vec3(1.0), step(0.97, vSeed) * 0.7);
        gl_FragColor = vec4(c * 1.9, a);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return points;
}
