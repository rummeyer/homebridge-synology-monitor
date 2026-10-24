/**
 * The HomeKit side, against HAP-NodeJS itself, so the values are the ones
 * HomeKit sees.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import * as hap from '@homebridge/hap-nodejs';
import type { API, PlatformAccessory } from 'homebridge';

import { NasAccessory } from '../src/accessory.ts';
import { DsmClient } from '../src/dsm.ts';
import { NasMonitor } from '../src/monitor.ts';
import { copy, fakeDsm, FIXTURE, nasConfig, testLog } from './helpers.ts';

const { Characteristic, Service } = hap;
const api = { hap } as unknown as API;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

function platformAccessory(): PlatformAccessory {
  const accessory = new hap.Accessory('Diskstation', hap.uuid.generate('diskstation')) as unknown as PlatformAccessory;
  (accessory as { context: object }).context = {};
  return accessory;
}

function setUp(overrides: Parameters<typeof nasConfig>[0] = {}, accessory = platformAccessory()) {
  const dsm = fakeDsm();
  const log = testLog();
  const net = { up: true, woken: 0 };
  const monitor = new NasMonitor(nasConfig(overrides), log, {
    dsm: new DsmClient(nasConfig(overrides), dsm),
    reachable: async () => net.up,
    wake: async () => void net.woken++,
  });
  const handle = new NasAccessory(api, log, accessory, monitor);
  return { dsm, log, net, monitor, accessory, handle };
}

const value = (accessory: PlatformAccessory, type: typeof Service.Switch, subtype: string, characteristic: typeof Characteristic.On) =>
  accessory.getServiceById(type, subtype)?.getCharacteristic(characteristic).value;

test('every accessory is there once DSM listed the drives and volumes', async () => {
  const { accessory, monitor } = setUp();
  await monitor.poll();
  const subtypes = accessory.services.filter((service) => service.subtype).map((service) => `${service.constructor.name}:${service.subtype}`);
  assert.deepEqual(subtypes, [
    'Switch:power',
    'TemperatureSensor:temperature',
    'Fanv2:cpu',
    'Fanv2:memory',
    'LeakSensor:storage',
    'OccupancySensor:update',
    'Switch:restart',
    'TemperatureSensor:disk:nvme1n1',
    'TemperatureSensor:disk:nvme0n1',
    'TemperatureSensor:disk:sata3',
    'TemperatureSensor:disk:sata4',
    'TemperatureSensor:disk:sata1',
    'TemperatureSensor:disk:sata2',
    'HumiditySensor:volume:volume_1',
  ]);
  const disk = accessory.getServiceById(Service.TemperatureSensor, 'disk:sata3')!;
  assert.equal(disk.getCharacteristic(Characteristic.ConfiguredName).value, 'Drive 1');
});

test('an accessory switched off in the settings is not there, and is removed from a cached one', async () => {
  const first = setUp();
  await first.monitor.poll();
  const { accessory } = setUp({ sensors: { ...nasConfig().sensors, cpu: false, disks: false, restart: false } }, first.accessory);
  assert.equal(accessory.getServiceById(Service.Fanv2, 'cpu'), undefined);
  assert.equal(accessory.getServiceById(Service.Switch, 'restart'), undefined);
  assert.equal(accessory.services.filter((service) => service.subtype?.startsWith('disk:')).length, 0);
  assert.ok(accessory.getServiceById(Service.Fanv2, 'memory'));
});

test('the readings reach their characteristics', async () => {
  const { accessory, monitor } = setUp();
  await monitor.poll();
  assert.equal(value(accessory, Service.Switch, 'power', Characteristic.On), true);
  assert.equal(value(accessory, Service.TemperatureSensor, 'temperature', Characteristic.CurrentTemperature), 42);
  assert.equal(value(accessory, Service.TemperatureSensor, 'temperature', Characteristic.StatusActive), true);
  assert.equal(value(accessory, Service.Fanv2, 'cpu', Characteristic.Active), 1);
  assert.equal(value(accessory, Service.Fanv2, 'cpu', Characteristic.RotationSpeed), 12);
  assert.equal(value(accessory, Service.Fanv2, 'memory', Characteristic.RotationSpeed), 14);
  assert.equal(value(accessory, Service.LeakSensor, 'storage', Characteristic.LeakDetected), 0);
  assert.equal(value(accessory, Service.OccupancySensor, 'update', Characteristic.OccupancyDetected), 0);
  assert.equal(value(accessory, Service.TemperatureSensor, 'disk:nvme1n1', Characteristic.CurrentTemperature), 38);
  assert.equal(value(accessory, Service.HumiditySensor, 'volume:volume_1', Characteristic.CurrentRelativeHumidity), 44);
  const info = accessory.getService(Service.AccessoryInformation)!;
  assert.equal(info.getCharacteristic(Characteristic.Model).value, 'DS920+');
  assert.equal(info.getCharacteristic(Characteristic.FirmwareRevision).value, '7.4.1');
});

test('a storage problem sets off the leak sensor, a waiting update the occupancy sensor', async () => {
  const { accessory, monitor, dsm } = setUp();
  const storage = copy(FIXTURE.storage);
  storage.volumes[0].status = 'degraded';
  dsm.data['SYNO.Storage.CGI.Storage.load_info'] = storage;
  dsm.data['SYNO.Core.Upgrade.Server.check'] = { available: true };
  await monitor.poll();
  assert.equal(value(accessory, Service.LeakSensor, 'storage', Characteristic.LeakDetected), 1);
  assert.equal(value(accessory, Service.OccupancySensor, 'update', Characteristic.OccupancyDetected), 1);
});

test('while it is off: the fans stop, the sensors are inactive and keep their values', async () => {
  const { accessory, monitor, net } = setUp();
  await monitor.poll();
  net.up = false;
  await monitor.poll();
  assert.equal(value(accessory, Service.Switch, 'power', Characteristic.On), false);
  assert.equal(value(accessory, Service.Fanv2, 'cpu', Characteristic.Active), 0);
  assert.equal(value(accessory, Service.TemperatureSensor, 'temperature', Characteristic.StatusActive), false);
  assert.equal(value(accessory, Service.TemperatureSensor, 'temperature', Characteristic.CurrentTemperature), 42);
  assert.equal(value(accessory, Service.HumiditySensor, 'volume:volume_1', Characteristic.StatusActive), false);
});

test('the drives and volumes are kept while it is off, after a restart of Homebridge too', async () => {
  const first = setUp();
  await first.monitor.poll();
  const { accessory, monitor, net } = setUp({}, first.accessory);
  net.up = false;
  await monitor.poll();
  assert.ok(accessory.getServiceById(Service.TemperatureSensor, 'disk:sata1'));
  assert.ok(accessory.getServiceById(Service.HumiditySensor, 'volume:volume_1'));
});

test('the Power switch wakes and shuts down', async () => {
  const { accessory, monitor, net, dsm } = setUp();
  net.up = false;
  await monitor.poll();
  const on = accessory.getServiceById(Service.Switch, 'power')!.getCharacteristic(Characteristic.On);
  await on.handleSetRequest(true);
  assert.equal(net.woken, 1);
  assert.equal(on.value, true);
  net.up = true;
  await monitor.poll();
  await on.handleSetRequest(false);
  assert.ok(dsm.calls.some((call) => call.method === 'shutdown'));
  assert.equal(on.value, false);
});

test('a Power switch that fails says so to HomeKit and goes back', async () => {
  const { accessory, monitor, net, log } = setUp({ mac: undefined });
  net.up = false;
  await monitor.poll();
  const on = accessory.getServiceById(Service.Switch, 'power')!.getCharacteristic(Characteristic.On);
  await assert.rejects(on.handleSetRequest(true));
  assert.match(log.lines.at(-1)!, /error: Diskstation: Diskstation has no MAC address/);
  await wait(1100);
  assert.equal(on.value, false);
});

test('Restart restarts and turns itself off again', async () => {
  const { accessory, monitor, dsm } = setUp();
  await monitor.poll();
  const restart = accessory.getServiceById(Service.Switch, 'restart')!.getCharacteristic(Characteristic.On);
  await restart.handleSetRequest(true);
  assert.ok(dsm.calls.some((call) => call.method === 'reboot'));
  await wait(1100);
  assert.equal(restart.value, false);
});

test('a fan someone tapped goes back to the load', async () => {
  const { accessory, monitor } = setUp();
  await monitor.poll();
  const speed = accessory.getServiceById(Service.Fanv2, 'cpu')!.getCharacteristic(Characteristic.RotationSpeed);
  await speed.handleSetRequest(100);
  await wait(1100);
  assert.equal(speed.value, 12);
});
