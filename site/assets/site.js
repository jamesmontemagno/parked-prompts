// Everything here is progressive: without JavaScript, the page still reads in full.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* The hero demo: a scripted walkthrough. Each step's look is CSS, driven by .at-N classes. */
function setupDemo(root) {
  const win = root.querySelector('.win');
  const typed = root.querySelector('[data-typed]');
  const sideChips = root.querySelector('.side-chips');
  const status = root.querySelector('[data-status]');
  const parkButton = root.querySelector('[data-park]');
  const restoreButton = root.querySelector('[data-restore]');
  const stepButtons = [...root.querySelectorAll('[data-go]')];
  const toggle = root.querySelector('[data-toggle]');
  const TEXT = typed?.dataset.text ?? '';
  const STEPS = [2600, 3600, 2200, 2400, 5200];
  let step = 0;
  let playing = !reducedMotion;
  let timer;
  let typing;
  let inView = true;

  const press = button => {
    button?.classList.add('press');
    setTimeout(() => button?.classList.remove('press'), 320);
  };

  function show(next, { animate = false } = {}) {
    step = next;
    clearInterval(typing);
    for (let i = 1; i < STEPS.length; i += 1) win.classList.toggle(`at-${i}`, i <= next);
    stepButtons.forEach((button, i) => {
      if (i === next) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    sideChips.classList.toggle('show', next === 1 && !animate);
    status.textContent = next === 2 || next === 3 ? 'Parked' : '';
    if (next === 1) {
      if (animate) {
        let shown = 0;
        typed.textContent = '';
        typing = setInterval(() => {
          shown += 2;
          typed.textContent = TEXT.slice(0, shown);
          if (shown >= TEXT.length) {
            clearInterval(typing);
            sideChips.classList.add('show');
            status.textContent = 'Draft saved';
          }
        }, 34);
      } else {
        typed.textContent = TEXT;
        status.textContent = 'Draft saved';
      }
    } else {
      typed.textContent = '';
    }
    if (animate && next === 2) press(parkButton);
    if (animate && next === 4) press(restoreButton);
  }

  function schedule() {
    clearTimeout(timer);
    if (!playing || !inView) return;
    timer = setTimeout(() => {
      show((step + 1) % STEPS.length, { animate: true });
      schedule();
    }, STEPS[step]);
  }

  function setPlaying(value) {
    playing = value;
    toggle.textContent = playing ? 'Pause' : 'Play';
    toggle.setAttribute('aria-pressed', String(!playing));
    schedule();
  }

  stepButtons.forEach((button, i) => button.addEventListener('click', () => {
    setPlaying(false);
    show(i);
  }));
  toggle.addEventListener('click', () => setPlaying(!playing));
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    schedule();
  }).observe(win);

  // Without motion, start on the step that shows the point: restored, and not sent.
  show(reducedMotion ? STEPS.length - 1 : 0);
  setPlaying(playing);
}

/* Tabs, with the keyboard behaviour people expect from them. */
function setupTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      select(tabs[(moves[event.key] + tabs.length) % tabs.length], true);
    });
  });
  // A link such as #canvas opens that tab, whether the page is loading or already open.
  const follow = () => {
    const wanted = tabs.find(tab => tab.dataset.tab === location.hash.slice(1));
    if (wanted) {
      select(wanted);
      root.scrollIntoView();
    }
    return wanted;
  };
  window.addEventListener('hashchange', follow);
  if (!follow()) select(tabs[0]);
}

/* Send when idle, simulated. The rules match the real canvas: one prompt per idle, and it waits for that turn. */
function setupIdle(root) {
  const pill = root.querySelector('[data-pill]');
  const finish = root.querySelector('[data-finish]');
  const log = root.querySelector('[data-log]');
  const rows = [...root.querySelectorAll('[data-prompt]')];
  const ADD = (text, system = false) => {
    const item = document.createElement('li');
    item.textContent = text;
    if (system) item.className = 'sys';
    log.append(item);
  };
  let busy = true;
  let queue = [];
  let timers = [];
  const later = (run, ms) => timers.push(setTimeout(run, reducedMotion ? 0 : ms));

  const render = () => {
    pill.textContent = busy ? 'Agent busy' : 'Agent idle';
    pill.classList.toggle('idle-now', !busy);
    finish.disabled = !busy;
    for (const row of rows) {
      const armed = queue.includes(row);
      const sent = row.classList.contains('sent');
      row.querySelector('[data-badge]').hidden = !armed;
      const arm = row.querySelector('[data-arm]');
      arm.textContent = armed ? 'Cancel wait' : 'When idle';
      arm.disabled = sent;
    }
  };

  const sendNext = () => {
    const [row] = queue;
    if (busy || !row) return;
    queue = queue.slice(1);
    row.classList.add('sent');
    ADD(row.querySelector('b').textContent);
    ADD('The agent started on it.', true);
    busy = true;
    render();
  };

  const becomeIdle = () => {
    busy = false;
    ADD(queue.length > 0 ? 'The agent went idle. Sending the next prompt.' : 'The agent went idle.', true);
    render();
    later(sendNext, 1100);
  };

  finish.addEventListener('click', () => {
    finish.disabled = true;
    ADD('The agent is finishing its turn…', true);
    later(becomeIdle, 900);
  });
  for (const row of rows) {
    row.querySelector('[data-arm]').addEventListener('click', () => {
      queue = queue.includes(row) ? queue.filter(other => other !== row) : [...queue, row];
      render();
      if (!busy) later(sendNext, 500);
    });
  }
  root.querySelector('[data-reset]').addEventListener('click', () => {
    timers.forEach(clearTimeout);
    timers = [];
    busy = true;
    queue = [];
    log.replaceChildren();
    rows.forEach(row => row.classList.remove('sent'));
    ADD('The agent is refactoring the checkout flow.', true);
    render();
  });
  ADD('The agent is refactoring the checkout flow.', true);
  render();
}

/* Copy buttons */
function setupCopy(button) {
  const label = button.textContent;
  button.addEventListener('click', async () => {
    const text = button.closest('.copy').querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Press Ctrl+C';
      const range = document.createRange();
      range.selectNodeContents(button.closest('.copy').querySelector('code'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
    setTimeout(() => { button.textContent = label; }, 1800);
  });
}

document.querySelectorAll('[data-demo]').forEach(setupDemo);
document.querySelectorAll('[data-tabs]').forEach(setupTabs);
document.querySelectorAll('[data-idle]').forEach(setupIdle);
document.querySelectorAll('.copy button').forEach(setupCopy);
