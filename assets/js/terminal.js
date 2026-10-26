// Terminal easter egg: press ` (or the nav icon) to open. Content is read from
// the page itself (cards, event log, skill list) so it never drifts from it.

const EMAIL = 'successzion21@gmail.com';
const COMMANDS = ['help', 'whoami', 'ls projects', 'cat experience', 'skills', 'contact', 'cv', 'hire', 'sudo hire-zion', 'open', 'shortcut on', 'shortcut off', 'clear', 'exit'];
const SHORTCUT_KEY = 'zs-shortcut';

export function initTerminal({ openCase }) {
  const dialog = document.querySelector('#terminal');
  const out = dialog.querySelector('.term-out');
  const form = dialog.querySelector('.term-form');
  const input = dialog.querySelector('#term-in');
  const history = [];
  let cursor = 0;
  let opener = null;
  let greeted = false;

  const print = (text, cls = '') => {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    if (text instanceof Node) p.append(text);
    else p.textContent = text;
    out.append(p);
    out.scrollTop = out.scrollHeight;
  };
  const link = (href, text) => Object.assign(document.createElement('a'), { href, textContent: text });

  const projects = () => [...document.querySelectorAll('#work .card')].map((c) => ({
    slug: c.dataset.slug,
    kind: c.dataset.category,
    title: c.querySelector('h3').textContent,
    status: c.querySelector('.card-body .status')?.textContent,
  }));

  const run = (raw) => {
    const cmd = raw.trim().replace(/\s+/g, ' ');
    print(cmd, 't-cmd');
    if (!cmd) return;
    const [head, ...rest] = cmd.split(' ');
    switch (cmd.toLowerCase()) {
      case 'help':
        print([
          'help              this list',
          'whoami            who is on the other end',
          'ls projects       products, client work and lab builds',
          'open <project>    open a case study (Tab completes the name)',
          'cat experience    the career event log',
          'skills            the toolkit, grouped',
          'contact           how to reach me',
          'cv                download my CV for your role',
          'hire              jump to the request form',
          'sudo hire-zion    you know you want to',
          'shortcut on|off   enable or disable the ` key shortcut',
          'clear · exit      tidy up · close (or press Esc)',
        ].join('\n'), 't-dim');
        return;
      case 'whoami':
        print('Zion Success', 't-hl');
        print('Senior Full-Stack Software Engineer · Founder, ZCODES\nAbuja, Nigeria · remote in any timezone · open to relocation · English, French\n6+ years of Node.js, TypeScript, React, microservices and real-time systems that stay up.\nFast learner, always up for new technologies.');
        return;
      case 'ls projects':
      case 'ls':
        projects().forEach((p) => print(`${p.kind.padEnd(9)} ${p.slug.padEnd(26)} ${p.title}${p.status ? `  [${p.status}]` : ''}`));
        print("Type 'open <name>' to read one.", 't-dim');
        return;
      case 'cat experience':
        document.querySelectorAll('#career .event').forEach((ev) => {
          const [offset, dates] = [...ev.querySelectorAll('.event-head span')].map((s) => s.textContent);
          const company = ev.querySelector('h3').firstChild.textContent.trim();
          const role = ev.querySelector('.event-role').firstChild.textContent.trim();
          const site = ev.querySelector('.event-site a');
          const line = document.createElement('span');
          line.append(`${offset}  ${dates.padEnd(20)} ${company} · ${role}`);
          if (site) line.append('  ', link(site.href, new URL(site.href).hostname.replace(/^www\./, '')));
          print(line);
        });
        return;
      case 'skills':
        document.querySelectorAll('.skill-group').forEach((g) => {
          print(`${g.querySelector('h3').textContent.toLowerCase().padEnd(10)} ${[...g.querySelectorAll('li')].map((li) => li.textContent).join(', ')}`);
        });
        return;
      case 'contact': {
        const lines = document.createElement('span');
        lines.append('email     ', link(`mailto:${EMAIL}`, EMAIL), '\ngithub    ', link('https://github.com/Zeeohn', 'github.com/Zeeohn'), '\nlinkedin  ', link('https://linkedin.com/in/zcodes', 'linkedin.com/in/zcodes'));
        print(lines);
        return;
      }
      case 'cv':
      case 'cat cv':
        print('ls /cv/  →  full-stack · backend · frontend · integrations (PDF, 2 pages each)', 't-ok');
        setTimeout(() => {
          close({ restoreFocus: false });
          document.dispatchEvent(new CustomEvent('nav:goto', { detail: { selector: '#cv', focus: '.cv-file' } }));
        }, 450);
        return;
      case 'hire':
        print('→ routing you to POST /v1/hire-zion …', 't-ok');
        setTimeout(() => {
          close();
          document.dispatchEvent(new CustomEvent('nav:goto', { detail: { selector: '#contact', focus: '#f-name' } }));
        }, 450);
        return;
      case 'sudo hire-zion':
        print('[sudo] password for recruiter: ********', 't-dim');
        print('✔ permission granted. Provisioning senior engineer…\n✔ kafka topic "your-team" created\n✔ zion joined consumer group "your-team"\n201 Created. One last step: run `hire` (or email ' + EMAIL + ') so it reaches a real inbox.', 't-ok');
        return;
      case 'shortcut on':
      case 'shortcut off':
        setShortcut(cmd.endsWith('on'));
        print(`backtick shortcut ${shortcutOn ? 'enabled' : 'disabled'}.`, 't-ok');
        return;
      case 'clear':
        out.replaceChildren();
        return;
      case 'exit':
        close();
        return;
      default:
        if (head.toLowerCase() === 'open') {
          if (!rest.length) {
            print("usage: open <project>. Try 'ls projects'.", 't-dim');
            return;
          }
          const slug = rest.join('-').toLowerCase();
          const match = projects().find((p) => p.slug === slug || p.slug.startsWith(slug));
          if (match) {
            print(`opening ${match.slug} …`, 't-ok');
            setTimeout(() => {
              close({ restoreFocus: false });
              openCase(match.slug);
            }, 250);
          } else {
            print(`open: no project named '${rest.join(' ')}'. Try 'ls projects'.`, 't-err');
          }
          return;
        }
        print(`command not found: ${cmd}. Type 'help'.`, 't-err');
    }
  };

  const complete = () => {
    const v = input.value.replace(/^\s+/, '').toLowerCase();
    if (!v) return;
    const pool = v.startsWith('open ') ? projects().map((p) => `open ${p.slug}`) : COMMANDS;
    const hits = pool.filter((c) => c.startsWith(v));
    if (hits.length === 1) input.value = hits[0] + (hits[0] === 'open' ? ' ' : '');
    else if (hits.length > 1) {
      print(hits.join('   '), 't-dim');
      // Extend to the longest common prefix.
      let prefix = hits[0];
      hits.forEach((h) => { while (!h.startsWith(prefix)) prefix = prefix.slice(0, -1); });
      input.value = prefix;
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    if (v.trim()) history.push(v);
    cursor = history.length;
    input.value = '';
    run(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      cursor = Math.max(0, cursor - 1);
      input.value = history[cursor];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor = Math.min(history.length, cursor + 1);
      input.value = history[cursor] ?? '';
    }
  });

  const open = () => {
    if (dialog.open) return;
    opener = document.activeElement;
    input.value = '';
    dialog.showModal();
    document.dispatchEvent(new Event('overlay:open'));
    if (!greeted) {
      print('ZCODES shell v6.0 · connected to zion-success (latency < 1s)', 't-hl');
      print("Type 'help' to list commands.", 't-dim');
      greeted = true;
    }
    input.focus();
  };
  function close({ restoreFocus = true } = {}) {
    if (!dialog.open) return;
    dialog.close();
    document.dispatchEvent(new Event('overlay:close'));
    if (restoreFocus) opener?.focus?.({ preventScroll: true });
  }

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.querySelector('.term-close').addEventListener('click', () => close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  document.querySelectorAll('.term-open').forEach((b) => b.addEventListener('click', () => {
    document.querySelector('#menu')?.close();
    open();
  }));
  // Single-key shortcuts must be switchable off (WCAG 2.1.4): footer toggle or `shortcut off`.
  const toggle = document.querySelector('.shortcut-toggle');
  let shortcutOn = true;
  try {
    shortcutOn = localStorage.getItem(SHORTCUT_KEY) !== 'off';
  } catch {
    /* storage blocked: default on */
  }
  function setShortcut(on) {
    shortcutOn = on;
    toggle.setAttribute('aria-pressed', String(on));
    try {
      localStorage.setItem(SHORTCUT_KEY, on ? 'on' : 'off');
    } catch {
      /* private mode: applies to this visit only */
    }
  }
  toggle.setAttribute('aria-pressed', String(shortcutOn));
  toggle.addEventListener('click', () => setShortcut(!shortcutOn));

  // Backtick opens it from anywhere except while typing or inside another dialog.
  document.addEventListener('keydown', (e) => {
    if (!shortcutOn || e.key !== '`' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.closest?.('input, textarea, [contenteditable], dialog[open]')) return;
    e.preventDefault();
    open();
  });
}
