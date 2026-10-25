// Skills constellation: the grouped skill list (the accessible source of truth)
// is mirrored onto a draggable 3D sphere of tags joined by constellation lines.
// Hovering or focusing a skill highlights the work cards that used it.
import { reducedMotion, lowPower, pixelRatio, renderLoop, onResize } from './util.js';

// Shorter labels for the sphere only; the list (and screen readers) keep the full names.
const SHORT = {
  'System Design & Architecture': 'System Design',
  'Redux Toolkit & Context API': 'Redux Toolkit',
  'AI-Driven Development': 'AI-Driven Dev',
};

export function initSkills(section, work) {
  const sphere = section.querySelector('.sphere');
  const canvas = sphere.querySelector('canvas');
  const tagLayer = sphere.querySelector('.sphere-tags');
  const readout = section.querySelector('.skill-readout');
  const cardGrid = document.querySelector('#work .cards');

  // Upgrade list items to buttons so they work with keyboard as well as hover.
  const skills = [...section.querySelectorAll('.skill-group li[data-skill]')].map((li) => {
    const group = li.closest('.skill-group');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skill-btn';
    btn.textContent = li.textContent;
    li.replaceChildren(btn);
    return { id: li.dataset.skill, name: btn.textContent, learning: li.classList.contains('is-learning'), group: group.dataset.group, color: getComputedStyle(group).getPropertyValue('--c').trim(), btn };
  });

  // ---- Highlighting
  let hot = null;
  const highlight = (skill) => {
    if (skill === hot) return;
    hot = skill;
    skills.forEach((s) => {
      s.btn.classList.toggle('is-hot', s === skill);
      s.tag?.classList.toggle('is-hot', s === skill);
    });
    const used = skill ? Object.values(work.cards).filter((c) => c.dataset.skills.split(' ').includes(skill.id)) : [];
    Object.values(work.cards).forEach((c) => c.classList.toggle('is-lit', used.includes(c)));
    cardGrid.classList.toggle('is-dimming', used.length > 0);
    if (!skill) return;
    readout.replaceChildren(`${skill.name} → `);
    if (!used.length) {
      readout.append(skill.learning ? 'currently learning it; nothing shipped with it yet.' : 'everyday toolkit; no featured case study tagged with it yet.');
      return;
    }
    readout.append('used in ');
    used.forEach((c, i) => {
      const a = document.createElement('a');
      a.href = `#work/${c.dataset.slug}`;
      a.textContent = c.querySelector('h3').textContent;
      readout.append(...(i ? [' · ', a] : [a]));
    });
  };
  skills.forEach((s) => {
    s.btn.addEventListener('pointerenter', () => highlight(s));
    s.btn.addEventListener('focus', () => highlight(s));
  });
  section.querySelector('.skills-grid').addEventListener('pointerleave', () => highlight(null));
  section.addEventListener('focusout', (e) => {
    if (!section.contains(e.relatedTarget)) highlight(null);
  });

  // ---- Sphere: Fibonacci-distributed tags, drag to rotate with inertia
  const n = skills.length;
  skills.forEach((s, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    s.p = [Math.cos(phi) * r, y, Math.sin(phi) * r];
    s.tag = Object.assign(document.createElement('span'), { className: 'sphere-tag', textContent: SHORT[s.name] || s.name });
    s.tag.style.setProperty('--c', s.color);
    s.tag.addEventListener('pointerenter', () => highlight(s));
    tagLayer.append(s.tag);
  });

  const ctx = canvas.getContext('2d');
  const rot = { x: -0.25, y: 0 };
  const vel = { x: 0, y: reducedMotion ? 0 : 0.12 };
  let size = 1;
  let radius = 0.36;
  let dragging = null;

  sphere.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY };
    sphere.setPointerCapture(e.pointerId);
    loop.invalidate();
  });
  sphere.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - dragging.x) / size;
    const dy = (e.clientY - dragging.y) / size;
    rot.y += dx * 3;
    rot.x += dy * 3;
    vel.y = dx * 180;
    vel.x = dy * 180;
    dragging = { x: e.clientX, y: e.clientY };
    loop.invalidate();
  });
  const release = () => (dragging = null);
  sphere.addEventListener('pointerup', release);
  sphere.addEventListener('pointercancel', release);

  const project = ([x, y, z]) => {
    // Rotate around Y then X, then a gentle perspective.
    const cy = Math.cos(rot.y), sy = Math.sin(rot.y), cx = Math.cos(rot.x), sx = Math.sin(rot.x);
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y1 = y * cx - z1 * sx;
    const z2 = y * sx + z1 * cx;
    const k = 2.6 / (2.6 - z2);
    const R = radius;
    return { x: size / 2 + x1 * R * k, y: size / 2 + y1 * R * k, z: z2, k };
  };

  const frame = (t, dt) => {
    if (!dragging) {
      rot.y += vel.y * dt;
      rot.x += vel.x * dt;
      // Ease back to a slow idle spin (or to rest with reduced motion).
      const idle = reducedMotion ? 0 : 0.12;
      vel.y += (idle - vel.y) * Math.min(1, dt * 1.5);
      vel.x += (0 - vel.x) * Math.min(1, dt * 1.5);
      rot.x += (-0.25 - rot.x) * Math.min(1, dt * 0.5);
    }
    const pts = skills.map((s) => project(s.p));
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 1;
    // Constellation: chain each group's skills in order.
    for (let i = 1; i < n; i++) {
      if (skills[i].group !== skills[i - 1].group) continue;
      const a = pts[i - 1], b = pts[i];
      ctx.strokeStyle = skills[i].color;
      ctx.globalAlpha = 0.08 + 0.3 * ((a.z + b.z) / 2 + 1) / 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    skills.forEach((s, i) => {
      const p = pts[i];
      const depth = (p.z + 1) / 2;
      s.tag.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${(0.7 + depth * 0.4).toFixed(3)})`;
      s.tag.style.opacity = (0.25 + depth * 0.75).toFixed(2);
      s.tag.style.zIndex = Math.round(depth * 100);
    });
    // With reduced motion, keep drawing only while momentum remains.
    if (reducedMotion && !dragging && Math.abs(vel.y) + Math.abs(vel.x) > 0.01) requestAnimationFrame(() => loop.invalidate());
  };

  const loop = renderLoop(sphere, frame, { continuous: !reducedMotion, fps: lowPower ? 30 : 60 });
  onResize(sphere, (w) => {
    size = w;
    // Keep the widest tag (scaled up to 1.1 at the front) inside the sphere's box on narrow screens.
    const halfTag = Math.max(...skills.map((s) => s.tag.offsetWidth)) * 0.55;
    radius = Math.max(w * 0.22, Math.min(w * 0.36, w / 2 - halfTag));
    canvas.width = w * pixelRatio();
    canvas.height = w * pixelRatio();
    ctx.setTransform(pixelRatio(), 0, 0, pixelRatio(), 0, 0);
    loop.invalidate();
  });
}
