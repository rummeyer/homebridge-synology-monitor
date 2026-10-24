/**
 * The dashboard's script: asks the plugin for every NAS every few seconds
 * and draws a section per NAS — tiles for power, temperature, CPU, memory,
 * storage, each volume, the DSM update and each drive, and the buttons.
 *
 * Everything the plugin sends is put in as text, never as HTML.
 */
(function () {
  'use strict';

  const POLL_MS = 5000;
  /** How long a pressed button waits for the second press that confirms it. */
  const ARM_MS = 4000;

  const T = {
    home: 'Home', power: 'Power', on: 'On', off: 'Off', starting: 'Starting…', stopping: 'Shutting down…', restarting: 'Restarting…',
    temperature: 'Temperature', cpu: 'CPU', memory: 'Memory', storage: 'Storage', healthy: 'Healthy', trouble: 'Needs attention',
    update: 'DSM Update', available: 'Available', upToDate: 'Up to date', used: 'used', of: 'of', warm: 'Too warm', fine: 'Normal',
    load: 'Load', inUse: 'In use', wake: 'Power on', shutdown: 'Shut down', restart: 'Restart',
    confirmWake: 'Really power on?', confirmShutdown: 'Really shut down?', confirmRestart: 'Really restart?',
    sentWake: 'Wake-on-LAN sent.', sentShutdown: 'Shutting down.', sentRestart: 'Restarting.',
    up: 'up', noMac: 'No MAC address set, so it cannot be woken.', unreachable: 'The plugin cannot be reached.',
    updated: 'Updated', lastKnown: 'Last known', noReadings: 'No readings yet', unknown: '–', noNas: 'No NAS set up yet.',
    days: 'd', hours: 'h', minutes: 'min',
  };

  const ICONS = {
    power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    temperature: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    memory: '<rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M6 7v10M10 7v10M14 7v10M18 7v10"/>',
    storage: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    volume: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    update: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/>',
    disk: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3.5"/><path d="M8 17.5h.01M12 17.5h4"/>',
  };

  const root = document.getElementById('nas');
  /** Buttons pressed once, waiting for the second press: "index/action" → when they disarm. */
  const armed = new Map();
  /** What the last press of each NAS's buttons answered: index → { text, error }. */
  const messages = new Map();
  let last = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function icon(name) {
    const span = el('span', 'icon');
    span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    return span;
  }

  /** A tile: icon, name, a big value with its unit, a line of state, maybe a bar and a detail. */
  function tile({ iconName, name, value, unit, state, kind, bar, detail }) {
    const node = el('div', `card tile ${kind || ''}`);
    node.append(icon(iconName), el('div', 'name', name));
    const big = el('div', 'value', value);
    if (unit) {
      big.append(el('small', '', unit));
    }
    node.append(big, el('div', 'state', state));
    if (bar !== undefined) {
      const track = el('div', 'bar');
      const fill = el('span');
      fill.style.width = `${Math.max(0, Math.min(100, bar))}%`;
      track.append(fill);
      node.append(track);
    }
    if (detail) {
      node.append(el('div', 'detail', detail));
    }
    return node;
  }

  function terabytes(bytes) {
    const tb = bytes / 1e12;
    return tb >= 1 ? `${tb.toFixed(1)} TB` : `${(bytes / 1e9).toFixed(0)} GB`;
  }

  function uptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days ? `${days} ${T.days} ${hours} ${T.hours}` : hours ? `${hours} ${T.hours} ${minutes} ${T.minutes}` : `${minutes} ${T.minutes}`;
  }

  function number(value) {
    return value === undefined || value === null ? T.unknown : String(value);
  }

  function section(nas, index, controls) {
    const box = el('section');
    const on = nas.power === 'on';
    const r = nas.readings;
    // Values count while the NAS answers; otherwise they are the last known, greyed.
    const live = on && r && !nas.error;
    const stale = live ? '' : 'stale';

    const heading = el('h2', '', nas.name);
    const about = [r && r.model, r && r.version, on && r && r.uptimeSeconds !== undefined ? `${T.up} ${uptime(r.uptimeSeconds)}` : null].filter(Boolean).join(' · ');
    if (about) {
      heading.append(el('span', 'about', about));
    }
    box.append(heading);

    const tiles = el('div', 'tiles');
    const busy = nas.power === 'starting' || nas.power === 'stopping' || nas.power === 'restarting';
    tiles.append(tile({
      iconName: 'power', name: T.power, value: T[nas.power], state: nas.host,
      kind: on ? 'running' : busy ? 'busy' : 'idle',
    }));
    if (r) {
      tiles.append(tile({
        iconName: 'temperature', name: T.temperature, value: number(r.temperature), unit: '°C',
        state: live ? (r.temperatureWarning ? T.warm : T.fine) : T.lastKnown, kind: r.temperatureWarning ? 'trouble' : stale,
      }));
      tiles.append(tile({ iconName: 'cpu', name: T.cpu, value: number(r.cpu), unit: '%', state: live ? T.load : T.lastKnown, kind: stale, bar: r.cpu }));
      tiles.append(tile({ iconName: 'memory', name: T.memory, value: number(r.memory), unit: '%', state: live ? T.inUse : T.lastKnown, kind: stale, bar: r.memory }));
      const trouble = r.problems.length > 0;
      tiles.append(tile({
        iconName: 'storage', name: T.storage, value: trouble ? '!' : '✓', state: trouble ? T.trouble : T.healthy,
        kind: trouble ? 'trouble' : stale, detail: `${r.disks.length} drive${r.disks.length === 1 ? '' : 's'}`,
      }));
      for (const volume of r.volumes) {
        tiles.append(tile({
          iconName: 'volume', name: volume.name, value: String(volume.usedPercent), unit: `% ${T.used}`,
          state: `${terabytes(volume.usedBytes)} ${T.of} ${terabytes(volume.totalBytes)}`, kind: volume.status === 'normal' ? stale : 'trouble', bar: volume.usedPercent,
        }));
      }
      if (nas.updateAvailable !== undefined && nas.updateAvailable !== null) {
        tiles.append(tile({
          iconName: 'update', name: T.update, value: nas.updateAvailable ? T.available : T.upToDate, state: r.version || '',
          kind: nas.updateAvailable ? 'running' : stale,
        }));
      }
      for (const disk of r.disks) {
        tiles.append(tile({
          iconName: 'disk', name: disk.name, value: number(disk.temperature), unit: '°C',
          state: disk.model, kind: disk.status === 'normal' ? stale : 'trouble',
        }));
      }
    } else {
      tiles.append(tile({ iconName: 'temperature', name: T.temperature, value: T.unknown, state: T.noReadings, kind: 'stale' }));
    }
    box.append(tiles);

    if (r && r.problems.length) {
      const list = el('ul', 'card problems');
      for (const problem of r.problems) {
        list.append(el('li', '', problem));
      }
      box.append(list);
    }

    if (controls) {
      const actions = el('div', 'actions');
      const can = { wake: nas.canWake && (nas.power === 'off' || nas.power === 'stopping'), shutdown: on, restart: on };
      for (const action of ['wake', 'shutdown', 'restart']) {
        const key = `${index}/${action}`;
        const isArmed = (armed.get(key) || 0) > Date.now();
        const confirm = { wake: T.confirmWake, shutdown: T.confirmShutdown, restart: T.confirmRestart }[action];
        const button = el('button', isArmed ? 'armed' : '', isArmed ? confirm : T[action]);
        button.type = 'button';
        button.disabled = !can[action];
        if (action === 'wake' && !nas.canWake) {
          button.title = T.noMac;
        }
        button.addEventListener('click', () => press(index, action));
        actions.append(button);
      }
      box.append(actions);
      const message = messages.get(index);
      box.append(el('div', `message${message && message.error ? ' error' : ''}`, message ? message.text : ''));
    }
    return box;
  }

  function draw() {
    if (!last) {
      return;
    }
    document.getElementById('version').textContent = last.version ? `Version ${last.version}` : '';
    root.replaceChildren(...(last.nas.length ? last.nas.map((nas, index) => section(nas, index, last.controls)) : [el('p', 'muted', T.noNas)]));
  }

  /** First press arms the button; a second within a few seconds does it. */
  async function press(index, action) {
    const key = `${index}/${action}`;
    if ((armed.get(key) || 0) <= Date.now()) {
      armed.clear();
      armed.set(key, Date.now() + ARM_MS);
      draw();
      setTimeout(draw, ARM_MS + 50);
      return;
    }
    armed.delete(key);
    try {
      const response = await fetch(`nas/${index}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(answer.error || `HTTP ${response.status}`);
      }
      messages.set(index, { text: { wake: T.sentWake, shutdown: T.sentShutdown, restart: T.sentRestart }[action] });
    } catch (error) {
      messages.set(index, { text: error.message, error: true });
    }
    await refresh();
  }

  async function refresh() {
    try {
      const response = await fetch('state', { cache: 'no-store' });
      last = await response.json();
      document.getElementById('updated').textContent = `${T.updated} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch {
      document.getElementById('updated').textContent = T.unreachable;
    }
    draw();
  }

  document.querySelector('[data-text="home"]').textContent = T.home;
  refresh();
  setInterval(refresh, POLL_MS);
})();
