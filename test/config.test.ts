import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SENSORS, DEFAULTS, parseMac, readConfig, readNas, wholeIn } from '../src/config.ts';

const minimal = { name: 'Diskstation', host: '192.168.1.20', username: 'monitor', password: 'secret' };

test('a NAS with only what is required gets every default', () => {
  const { nas, problems } = readNas(minimal, 0);
  assert.deepEqual(problems, []);
  assert.deepEqual(nas, {
    ...minimal,
    port: 5001,
    protocol: 'https',
    checkCertificate: false,
    mac: undefined,
    broadcast: '255.255.255.255',
    startupSeconds: DEFAULTS.startupSeconds,
    shutdownSeconds: DEFAULTS.shutdownSeconds,
    sensors: DEFAULT_SENSORS,
  });
});

test('every accessory is on unless switched off', () => {
  assert.ok(Object.values(DEFAULT_SENSORS).every(Boolean));
  const { nas } = readNas({ ...minimal, sensors: { restart: false, disks: 'no' } }, 0);
  assert.equal(nas!.sensors.restart, false);
  assert.equal(nas!.sensors.disks, true, 'a value that is not true or false is the default');
});

test('HTTP defaults to port 5000', () => {
  assert.equal(readNas({ ...minimal, protocol: 'http' }, 0).nas!.port, 5000);
  assert.equal(readNas({ ...minimal, protocol: 'http', port: 8080 }, 0).nas!.port, 8080);
  assert.equal(readNas({ ...minimal, protocol: 'ftp' }, 0).nas!.protocol, 'https');
});

test('a MAC address however it was typed', () => {
  for (const typed of ['00:11:32:AB:CD:EF', '00-11-32-ab-cd-ef', '001132abcdef', ' 00:11:32:ab:cd:ef ']) {
    assert.equal(parseMac(typed), '00:11:32:ab:cd:ef', typed);
  }
  assert.equal(parseMac('00:11:32:ab:cd'), undefined);
  assert.equal(parseMac(42), undefined);
});

test('what makes a NAS unusable is said, and it is left out', () => {
  assert.deepEqual(readNas({ name: 'NAS' }, 0).problems, ['NAS: no host', 'NAS: no username or password']);
  assert.deepEqual(readNas({ ...minimal, mac: 'nonsense' }, 0).problems, ['Diskstation: "nonsense" is not a MAC address']);
  assert.equal(readNas({ ...minimal, mac: 'nonsense' }, 0).nas, undefined);
  assert.equal(readNas({ host: 'x', username: 'u', password: 'p' }, 2).nas!.name, 'NAS 3', 'a NAS without a name gets one');
});

test('numbers out of range or not whole fall back to the default', () => {
  assert.equal(wholeIn(30, 10, 3600, 99), 30);
  assert.equal(wholeIn('45', 10, 3600, 99), 45);
  assert.equal(wholeIn(5, 10, 3600, 99), 99);
  assert.equal(wholeIn(30.5, 10, 3600, 99), 99);
  assert.equal(wholeIn('', 10, 3600, 99), 99);
  assert.equal(readNas({ ...minimal, port: 70000 }, 0).nas!.port, 5001);
});

test('the platform: defaults, and a second NAS of the same name left out', () => {
  const { config, problems } = readConfig({ platform: 'SynologyMonitor', nas: [minimal, { ...minimal, host: '10.0.1.202' }] });
  assert.equal(config.nas.length, 1);
  assert.deepEqual(problems, ['Diskstation: a second NAS by that name; names must differ']);
  assert.equal(config.pollSeconds, 30);
  assert.equal(config.dashboard, false);
  assert.equal(config.dashboardPort, 8583);
  assert.equal(config.dashboardControls, true);
  assert.equal(config.name, 'Synology Monitor');
});

test('a platform without NAS is no error, only empty', () => {
  assert.deepEqual(readConfig({ platform: 'SynologyMonitor' }), {
    problems: [],
    config: { name: 'Synology Monitor', nas: [], pollSeconds: 30, dashboard: false, dashboardPort: 8583, dashboardControls: true },
  });
});

test('a NAS row nobody filled in, as the settings form adds, is left out without a word', () => {
  const blank = { protocol: 'https', checkCertificate: false, password: '', sensors: { cpu: true } };
  const { config, problems } = readConfig({ platform: 'SynologyMonitor', nas: [minimal, blank, {}, null] });
  assert.equal(config.nas.length, 1);
  assert.deepEqual(problems, []);
  assert.deepEqual(readConfig({ nas: [{ host: '192.168.1.20' }] }).problems, ['NAS 1: no username or password'], 'half filled in is still said');
});
