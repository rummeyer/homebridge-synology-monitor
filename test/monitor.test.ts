import assert from 'node:assert/strict';
import test from 'node:test';

import { DsmClient } from '../src/dsm.ts';
import { NasMonitor, UPDATE_CHECK_MS } from '../src/monitor.ts';
import { fakeDsm, nasConfig, testLog } from './helpers.ts';

/** A monitor on the fake DSM, with a clock and a network the test controls. */
function setUp(overrides: Parameters<typeof nasConfig>[0] = {}) {
  const dsm = fakeDsm();
  const log = testLog();
  const clock = { now: 1_000_000 };
  const net = { up: true, woken: [] as string[] };
  const monitor = new NasMonitor(nasConfig(overrides), log, {
    dsm: new DsmClient(nasConfig(overrides), dsm),
    reachable: async () => net.up,
    wake: async (mac, broadcast) => void net.woken.push(`${mac}@${broadcast}`),
    now: () => clock.now,
  });
  return { dsm, log, clock, net, monitor };
}

test('a poll of a NAS that is on reads everything and checks for an update', async () => {
  const { monitor, log, dsm } = setUp();
  let updates = 0;
  monitor.on('update', () => updates++);
  await monitor.poll();
  assert.equal(monitor.snapshot().power, 'on');
  assert.equal(monitor.readings!.temperature, 42);
  assert.equal(monitor.readings!.cpu, 12);
  assert.equal(monitor.readings!.volumes.length, 1);
  assert.equal(monitor.updateAvailable, false);
  assert.equal(updates, 1);
  assert.deepEqual(log.lines, ['info: Diskstation is on']);
  assert.deepEqual(
    dsm.calls.map((call) => `${call.api}.${call.method}`),
    [
      'SYNO.API.Auth.login',
      'SYNO.DSM.Info.getinfo',
      'SYNO.Core.System.Utilization.get',
      'SYNO.Storage.CGI.Storage.load_info',
      'SYNO.Core.System.Status.get',
      'SYNO.Core.Upgrade.Server.check',
    ],
  );
});

test('the update check runs only every few hours', async () => {
  const { monitor, dsm, clock } = setUp();
  await monitor.poll();
  clock.now += 60_000;
  await monitor.poll();
  assert.equal(dsm.calls.filter((call) => call.api === 'SYNO.Core.Upgrade.Server').length, 1);
  dsm.data['SYNO.Core.Upgrade.Server.check'] = { available: true };
  clock.now += UPDATE_CHECK_MS;
  await monitor.poll();
  assert.equal(monitor.updateAvailable, true);
});

test('a NAS that is off keeps its last readings, and the change is logged once', async () => {
  const { monitor, net, log } = setUp();
  await monitor.poll();
  net.up = false;
  await monitor.poll();
  await monitor.poll();
  assert.equal(monitor.snapshot().power, 'off');
  assert.equal(monitor.readings!.temperature, 42, 'the last known');
  assert.deepEqual(log.lines, ['info: Diskstation is on', 'info: Diskstation is off']);
});

test('a NAS that is off at start is not announced as going off', async () => {
  const { monitor, net, log } = setUp();
  net.up = false;
  await monitor.poll();
  assert.deepEqual(log.lines, []);
});

test('a reading that fails is logged once per reason, and its recovery once', async () => {
  const { monitor, dsm, log } = setUp();
  dsm.errors['SYNO.API.Auth.login'] = [400, 400];
  await monitor.poll();
  await monitor.poll();
  assert.equal(monitor.error, 'wrong username or password');
  await monitor.poll();
  assert.equal(monitor.error, undefined);
  assert.deepEqual(log.lines, [
    'info: Diskstation is on',
    'warn: Diskstation: could not read it: wrong username or password',
    'info: Diskstation: reading again',
  ]);
});

test('polls never overlap', async () => {
  const { monitor, dsm } = setUp();
  await Promise.all([monitor.poll(), monitor.poll(), monitor.poll()]);
  assert.equal(dsm.calls.filter((call) => call.method === 'getinfo').length, 1);
});

test('power on sends Wake-on-LAN and shows it starting', async () => {
  const { monitor, net, clock } = setUp();
  net.up = false;
  await monitor.poll();
  await monitor.powerOn();
  assert.deepEqual(net.woken, ['00:11:32:ab:cd:ef@255.255.255.255']);
  assert.equal(monitor.snapshot().power, 'starting');
  assert.equal(monitor.isOn(), true);
  await monitor.powerOn();
  assert.equal(net.woken.length, 1, 'not again while it is starting');
  clock.now += 60_000;
  net.up = true;
  await monitor.poll();
  assert.equal(monitor.snapshot().power, 'on');
});

test('without a MAC address it cannot be woken, and says so', async () => {
  const { monitor, net } = setUp({ mac: undefined });
  net.up = false;
  await monitor.poll();
  await assert.rejects(monitor.powerOn(), /no MAC address/);
  assert.equal(monitor.snapshot().canWake, false);
});

test('power off shuts it down through DSM and shows it stopping', async () => {
  const { monitor, dsm } = setUp();
  await monitor.poll();
  await monitor.powerOff();
  assert.ok(dsm.calls.some((call) => call.api === 'SYNO.Core.System' && call.method === 'shutdown' && call.version === 1));
  assert.equal(monitor.snapshot().power, 'stopping');
  await monitor.powerOff();
  assert.equal(dsm.calls.filter((call) => call.method === 'shutdown').length, 1, 'not again while it is stopping');
});

test('a shutdown DSM refuses is passed on, and the NAS stays on', async () => {
  const { monitor, dsm } = setUp();
  await monitor.poll();
  dsm.errors['SYNO.Core.System.shutdown'] = [105];
  await assert.rejects(monitor.powerOff(), /administrator/);
  assert.equal(monitor.snapshot().power, 'on');
});

test('power off of a NAS that is off does nothing', async () => {
  const { monitor, net, dsm } = setUp();
  net.up = false;
  await monitor.poll();
  await monitor.powerOff();
  assert.equal(dsm.calls.length, 0);
});

test('restart goes through DSM and shows it restarting until it is back', async () => {
  const { monitor, net, clock, dsm } = setUp();
  await monitor.poll();
  await monitor.restart();
  assert.ok(dsm.calls.some((call) => call.method === 'reboot'));
  assert.equal(monitor.snapshot().power, 'restarting');
  net.up = false;
  clock.now += 30_000;
  await monitor.poll();
  assert.equal(monitor.snapshot().power, 'restarting');
  net.up = true;
  clock.now += 90_000;
  await monitor.poll();
  assert.equal(monitor.snapshot().power, 'on');
});

test('a NAS that does not answer cannot be restarted', async () => {
  const { monitor, net } = setUp();
  net.up = false;
  await monitor.poll();
  await assert.rejects(monitor.restart(), /does not answer/);
});

test('stop logs out', async () => {
  const { monitor, dsm } = setUp();
  await monitor.poll();
  await monitor.stop();
  assert.equal(dsm.calls.at(-1)!.method, 'logout');
});
