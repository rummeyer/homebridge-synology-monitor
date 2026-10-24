/**
 * The settings page's form, as Appliance Monitor's: one NAS at a time, picked
 * from a list, and below it the General settings with the link to the
 * dashboard under its switch.
 *
 * Drawn here from the config as Homebridge has it, rather than with
 * Homebridge's generated form, which is kept hidden. Changes go to Homebridge
 * as they are made (`updatePluginConfig`) and are saved with the Save button
 * of the settings window. Only what differs from the default is written, so
 * the config stays as short as a hand-written one.
 */
(function (root) {
  'use strict';

  const PLATFORM = 'SynologyMonitor';
  const NEW_NAME = 'Diskstation';
  /** As DEFAULTS and DEFAULT_SENSORS in src/config.ts; a test keeps them the same. */
  const DEFAULTS = { port: 5001, httpPort: 5000, broadcast: '255.255.255.255', startupSeconds: 180, shutdownSeconds: 120, pollSeconds: 30, dashboardPort: 8583 };
  const MIN_POLL_SECONDS = 10;
  const SENSORS = [
    ['temperature', 'Temperature', 'The system temperature'],
    ['cpu', 'CPU', 'A fan whose speed is the CPU load'],
    ['memory', 'Memory', 'A fan whose speed is the memory in use'],
    ['storage', 'Storage', 'A leak sensor that goes off when a volume, pool or drive is in trouble'],
    ['update', 'DSM Update', 'An occupancy sensor, occupied while an update is waiting'],
    ['restart', 'Restart', 'A switch that restarts the NAS'],
    ['disks', 'Drives', 'A temperature sensor per drive'],
    ['volumes', 'Volumes', 'A humidity sensor per volume: how full it is'],
  ];
  const MAC = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;

  const css = `
  .sm-bar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
  .sm-bar select { width: 14rem; max-width: 100%; }
  .sm-section { margin-bottom: 1.25rem; }
  .sm-section > h6 { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; margin-bottom: .5rem; }
  .sm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .75rem 1rem; }
  .sm-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: .35rem 1rem; }
  .sm-help { font-size: .78rem; opacity: .65; margin-top: .2rem; }
  .sm-error { font-size: .78rem; color: #d64545; margin-top: .2rem; }
  .sm-more input::placeholder, .sm-section input::placeholder { font-style: italic; opacity: .45; }
  details.sm-more > summary { cursor: pointer; font-size: .85rem; opacity: .8; margin-bottom: .75rem; }
  `;

  /** A tiny element builder: el('div', { class: 'x' }, child, 'text'). */
  function el(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      if (key.startsWith('on')) {
        element.addEventListener(key.slice(2), value);
      } else if (key === 'class') {
        element.className = value;
      } else if (value === true) {
        element.setAttribute(key, '');
      } else {
        element.setAttribute(key, String(value));
      }
    }
    for (const child of children.flat()) {
      if (child !== undefined && child !== null && child !== false) {
        element.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    }
    return element;
  }

  /** Sets a key, or removes it when the value is the default or empty. */
  function setOrDrop(object, key, value, fallback) {
    if (value === undefined || value === null || value === '' || value === fallback) {
      delete object[key];
    } else {
      object[key] = value;
    }
  }

  /** A whole number from a field, or undefined for an empty one or anything else. */
  const wholeOrUndefined = (text) => {
    const trimmed = String(text).trim();
    const value = Number(trimmed);
    return trimmed !== '' && Number.isInteger(value) ? value : undefined;
  };

  /** A NAS row nobody filled in, as Homebridge's own form used to save: no name, host or username. */
  const blank = (nas) => !nas || !['name', 'host', 'username'].some((key) => typeof nas[key] === 'string' && nas[key].trim());

  /**
   * Makes `button` ask "SURE?" on the first click and run `onSure` on a second
   * one within five seconds — on the button rather than with confirm(), which
   * the settings window's frame may not be allowed to show.
   */
  function askTwice(button, onSure) {
    const label = button.textContent;
    let armed = null;
    button.addEventListener('click', () => {
      if (!armed) {
        button.textContent = 'SURE?';
        button.classList.replace('btn-outline-danger', 'btn-danger');
        armed = setTimeout(() => {
          armed = null;
          button.textContent = label;
          button.classList.replace('btn-danger', 'btn-outline-danger');
        }, 5000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      onSure();
    });
    return button;
  }

  /** Mounts the form in `container`; `address` is this machine's, for the dashboard link. */
  async function mount(container, { homebridge, address }) {
    const configs = await homebridge.getPluginConfig();
    if (!configs.length) {
      configs.push({ platform: PLATFORM, name: 'Synology Monitor', nas: [] });
    }
    const config = configs[0];
    config.nas = Array.isArray(config.nas) ? config.nas.filter((nas) => nas && typeof nas === 'object' && !blank(nas)) : [];
    let selected = config.nas.length ? 0 : -1;
    let pending;

    /** Hands the config to Homebridge, a moment after the last change. */
    function changed() {
      clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        void homebridge.updatePluginConfig(configs);
      }, 250);
    }

    // ---- Building blocks ----------------------------------------------------

    function field(label, input, help, error) {
      return el('div', {}, el('label', { class: 'form-label mb-1' }, label), input,
        help ? el('div', { class: 'sm-help' }, help) : null,
        el('div', { class: 'sm-error', hidden: !error }, error ?? ''));
    }

    /** Shows `error` under the field of `input`, or hides it when there is none. */
    function showError(input, error) {
      const line = input.parentElement.querySelector('.sm-error');
      line.textContent = error;
      line.hidden = !error;
    }

    function text(value, placeholder, onInput, type = 'text') {
      return el('input', {
        class: 'form-control form-control-sm', type, value: value ?? '', placeholder,
        autocomplete: type === 'password' ? 'new-password' : 'off', oninput: (e) => onInput(e.target.value, e.target),
      });
    }

    function number(value, placeholder, onInput) {
      return el('input', {
        class: 'form-control form-control-sm', type: 'number', min: 0, step: 1, inputmode: 'numeric',
        value: value ?? '', placeholder, oninput: (e) => onInput(e.target.value, e.target),
      });
    }

    function check(id, label, checked, onChange) {
      return el('div', { class: 'form-check' },
        el('input', { class: 'form-check-input', type: 'checkbox', id, checked, onchange: (e) => onChange(e.target.checked) }),
        el('label', { class: 'form-check-label', for: id }, label));
    }

    function choice(value, options, onChange) {
      return el('select', { class: 'form-select form-select-sm', onchange: (e) => onChange(e.target.value) },
        options.map(([key, label]) => el('option', { value: key, selected: key === value }, label)));
    }

    function uniqueName(base) {
      const names = new Set(config.nas.map((nas) => nas.name));
      if (!names.has(base)) {
        return base;
      }
      for (let n = 2; ; n++) {
        if (!names.has(`${base} ${n}`)) {
          return `${base} ${n}`;
        }
      }
    }

    // ---- The page -----------------------------------------------------------

    function render() {
      container.replaceChildren(bar(), selected >= 0 ? nasForm(config.nas[selected]) : empty(), general());
    }

    function bar() {
      const list = el('select', {
        class: 'form-select', 'aria-label': 'NAS',
        onchange: (e) => { selected = Number(e.target.value); render(); },
      }, config.nas.map((nas, index) => el('option', { value: index, selected: index === selected }, nas.name || '(no name)')));
      const add = el('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          config.nas.push({ name: uniqueName(NEW_NAME) });
          selected = config.nas.length - 1;
          changed();
          render();
          container.querySelector('#sm-host')?.focus();
        },
      }, '+ Add');
      const remove = askTwice(el('button', {
        type: 'button', class: 'btn btn-outline-danger', disabled: selected < 0,
        title: selected < 0 ? '' : `Delete ${config.nas[selected]?.name}`,
      }, 'Delete'), () => {
        config.nas.splice(selected, 1);
        selected = config.nas.length ? 0 : -1;
        changed();
        render();
      });
      return el('div', { class: 'sm-bar' }, config.nas.length ? list : null, add, remove);
    }

    function empty() {
      return el('p', { class: 'text-muted' }, 'No NAS yet. Add one with its address and a DSM administrator account.');
    }

    function nasForm(nas) {
      const others = new Set(config.nas.filter((other) => other !== nas).map((other) => other.name));
      const nameError = (value) => (!value.trim() ? 'A name is needed.' : others.has(value.trim()) ? 'Another NAS has this name.' : '');
      const hostError = (value) => (!value.trim() ? 'The NAS cannot be reached without its address.' : '');
      const macError = (value) => (value.trim() && !MAC.test(value.trim()) ? 'Not a MAC address: six pairs of hex digits, such as 00:11:32:aa:bb:cc.' : '');
      const accountError = () => (!String(nas.username ?? '').trim() || !nas.password ? 'A DSM account is needed to read the NAS and shut it down.' : '');
      const defaultPort = () => (nas.protocol === 'http' ? DEFAULTS.httpPort : DEFAULTS.port);

      const name = text(nas.name, NEW_NAME, (value, input) => {
        nas.name = value;
        showError(input, nameError(value));
        const option = container.querySelector(`.sm-bar option[value="${selected}"]`);
        if (option) {
          option.textContent = value || '(no name)';
        }
        changed();
      });
      const host = text(nas.host, '192.168.1.20', (value, input) => {
        setOrDrop(nas, 'host', value.trim() || undefined, undefined);
        showError(input, hostError(value));
        changed();
      });
      host.id = 'sm-host';
      const port = number(nas.port, String(defaultPort()), (value) => {
        setOrDrop(nas, 'port', wholeOrUndefined(value), defaultPort());
        changed();
      });
      const protocol = choice(nas.protocol === 'http' ? 'http' : 'https', [['https', 'HTTPS'], ['http', 'HTTP']], (value) => {
        setOrDrop(nas, 'protocol', value, 'https');
        port.placeholder = String(defaultPort());
        changed();
      });
      const username = text(nas.username, 'homebridge', (value, input) => {
        setOrDrop(nas, 'username', value.trim() || undefined, undefined);
        showError(input, accountError());
        changed();
      });
      const password = text(nas.password, '', (value) => {
        setOrDrop(nas, 'password', value || undefined, undefined);
        showError(username, accountError());
        changed();
      }, 'password');
      const mac = text(nas.mac, '00:11:32:aa:bb:cc', (value, input) => {
        setOrDrop(nas, 'mac', value.trim() || undefined, undefined);
        showError(input, macError(value));
        changed();
      });

      const sensors = nas.sensors && typeof nas.sensors === 'object' ? nas.sensors : {};
      const checks = SENSORS.map(([key, label, help]) => el('div', {},
        check(`sm-sensor-${key}`, label, sensors[key] !== false, (on) => {
          nas.sensors = { ...(nas.sensors ?? {}) };
          setOrDrop(nas.sensors, key, on, true);
          if (!Object.keys(nas.sensors).length) {
            delete nas.sensors;
          }
          changed();
        }),
        el('div', { class: 'sm-help' }, help)));

      return el('div', {},
        el('div', { class: 'sm-section' },
          el('div', { class: 'sm-grid' },
            field('Name', name, 'In HomeKit. The NAS is remembered by it: renaming adds it anew.', nameError(String(nas.name ?? ''))),
            field('Host', host, 'Its IP address or name on the home network.', hostError(String(nas.host ?? ''))),
            field('Protocol', protocol),
            field('Port', port, "DSM's port, as under Control Panel → Login Portal."))),
        el('div', { class: 'sm-section' },
          el('h6', {}, 'DSM account'),
          el('div', { class: 'sm-grid' },
            field('Username', username, 'An administrator without 2-step verification: shutting down needs one.', accountError()),
            field('Password', password),
            el('div', {},
              el('div', { class: 'form-label mb-1' }, ' '),
              check('sm-certificate', 'Check the certificate', nas.checkCertificate === true, (on) => {
                setOrDrop(nas, 'checkCertificate', on, false);
                changed();
              }),
              el('div', { class: 'sm-help' }, "Only with one valid for this host; DSM's own is self-signed.")))),
        el('div', { class: 'sm-section' },
          el('h6', {}, 'Power'),
          el('div', { class: 'sm-grid' },
            field('MAC address', mac, 'For Wake-on-LAN. Without it the NAS can be shut down but not woken.', macError(String(nas.mac ?? ''))),
            field('Startup time (s)', number(nas.startupSeconds, String(DEFAULTS.startupSeconds), (value) => {
              setOrDrop(nas, 'startupSeconds', wholeOrUndefined(value), DEFAULTS.startupSeconds);
              changed();
            }), 'How long Power stays on after a wake before DSM must answer.'),
            field('Shutdown time (s)', number(nas.shutdownSeconds, String(DEFAULTS.shutdownSeconds), (value) => {
              setOrDrop(nas, 'shutdownSeconds', wholeOrUndefined(value), DEFAULTS.shutdownSeconds);
              changed();
            }), 'How long Power stays off after a shutdown while DSM still answers.'),
            field('Broadcast address', text(nas.broadcast, DEFAULTS.broadcast, (value) => {
              setOrDrop(nas, 'broadcast', value.trim() || undefined, DEFAULTS.broadcast);
              changed();
            }), "Where the Wake-on-LAN packet goes; the network's own if the default does not reach the NAS."))),
        el('div', { class: 'sm-section' },
          el('h6', {}, 'Accessories'),
          el('div', { class: 'sm-checks' }, checks)));
    }

    /** The dashboard's address while it is switched on: this machine's, or the one the Homebridge UI was opened with. */
    const dashboardLink = el('div', { class: 'sm-help' });
    function showDashboardLink() {
      const port = Number.isInteger(config.dashboardPort) && config.dashboardPort >= 1 && config.dashboardPort <= 65535
        ? config.dashboardPort
        : DEFAULTS.dashboardPort;
      const host = address || window.location.hostname;
      const url = host && `http://${host}:${port}/`;
      dashboardLink.replaceChildren(...(config.dashboard === true && url ? [el('a', { href: url, target: '_blank', rel: 'noopener' }, url)] : []));
    }

    function general() {
      showDashboardLink();
      const poll = config.pollSeconds;
      const pollError = (seconds) => (seconds !== undefined && seconds < MIN_POLL_SECONDS ? `At least ${MIN_POLL_SECONDS} s.` : '');
      return el('details', { class: 'sm-more sm-section mt-4', open: true },
        el('summary', {}, 'General'),
        el('div', { class: 'sm-grid' },
          el('div', {},
            check('sm-dashboard', 'Dashboard', config.dashboard === true, (on) => {
              setOrDrop(config, 'dashboard', on, false);
              changed();
              showDashboardLink();
            }),
            el('div', { class: 'sm-help' }, 'A page with each NAS and its buttons, without login.'),
            dashboardLink),
          field('Dashboard port', number(config.dashboardPort, String(DEFAULTS.dashboardPort), (value) => {
            setOrDrop(config, 'dashboardPort', wholeOrUndefined(value), DEFAULTS.dashboardPort);
            changed();
            showDashboardLink();
          }))),
        el('div', { class: 'sm-grid mt-3' },
          el('div', {},
            check('sm-controls', 'Buttons on the dashboard', config.dashboardControls !== false, (on) => {
              setOrDrop(config, 'dashboardControls', on, true);
              changed();
            }),
            el('div', { class: 'sm-help' }, 'Power on, Shut down and Restart; only for devices on the home network.')),
          field('Poll every (s)', number(poll, String(DEFAULTS.pollSeconds), (value, input) => {
            const seconds = wholeOrUndefined(value);
            setOrDrop(config, 'pollSeconds', seconds, DEFAULTS.pollSeconds);
            showError(input, pollError(seconds));
            changed();
          }), 'How often each NAS is asked.', pollError(poll))));
    }

    render();
    // Blank rows an earlier version saved are dropped as the page opens.
    changed();
  }

  root.SynologySettings = { css, mount, DEFAULTS, SENSORS };
})(window);
