import assert from 'node:assert/strict';
import test from 'node:test';

import { firmwareRevision, number, readInfo, readStatus, readStorage, readUpdate, readUtilization } from '../src/readings.ts';
import { copy, FIXTURE } from './helpers.ts';

test('the model, DSM version, system temperature and uptime', () => {
  assert.deepEqual(readInfo(FIXTURE.info), {
    model: 'DS920+',
    serial: '0000TEST0001',
    version: 'DSM 7.4.1-90080 Update 1',
    temperature: 42,
    temperatureWarning: false,
    uptimeSeconds: 131,
  });
});

test('the CPU load is user, system and other together, as the Resource Monitor shows it', () => {
  // user 3 + system 1 + other 8
  assert.deepEqual(readUtilization(FIXTURE.utilization), { cpu: 12, memory: 14 });
});

test('loads beyond 100 % or missing are kept in range or left unknown', () => {
  assert.deepEqual(readUtilization({ cpu: { user_load: 90, system_load: 30 }, memory: { real_usage: 101 } }), { cpu: 100, memory: 100 });
  assert.deepEqual(readUtilization({}), { cpu: undefined, memory: undefined });
});

test('a volume is named after its description, else its number, and knows how full it is', () => {
  const { volumes } = readStorage(FIXTURE.storage);
  assert.deepEqual(volumes, [
    { id: 'volume_1', name: 'Volume 1', status: 'normal', usedBytes: 13408377262080, totalBytes: 30712206524416, usedPercent: 44 },
  ]);
  const described = copy(FIXTURE.storage);
  described.volumes[0].vol_desc = 'Media';
  assert.equal(readStorage(described).volumes[0].name, 'Media');
});

test('drives come in Storage Manager order, each with its temperature and state', () => {
  const { disks } = readStorage(FIXTURE.storage);
  assert.deepEqual(
    disks.map((disk) => [disk.name, disk.temperature, disk.status]),
    [
      ['Cache device 1', 38, 'normal'],
      ['Cache device 2', 36, 'normal'],
      ['Drive 1', 28, 'normal'],
      ['Drive 2', 28, 'normal'],
      ['Drive 3', 29, 'normal'],
      ['Drive 4', 28, 'normal'],
    ],
  );
  assert.equal(disks.find((disk) => disk.name === 'Drive 1')!.model, 'ST16000VN001-2RV103');
});

test('a healthy NAS has no problems', () => {
  assert.deepEqual(readStorage(FIXTURE.storage).problems, []);
  assert.deepEqual(readStatus(FIXTURE.status), []);
});

test('a degraded volume, a crashed pool, a failing or worn drive and a crashed system are problems', () => {
  const storage = copy(FIXTURE.storage);
  storage.volumes[0].status = 'degraded';
  storage.storagePools[0].status = 'crashed';
  storage.disks[0].overview_status = 'failing';
  storage.disks[1].smart_status = 'warning';
  storage.disks[2].below_remain_life_thr = true;
  storage.disks[3].exceed_bad_sector_thr = true;
  assert.deepEqual(readStorage(storage).problems, [
    'Volume 1 is degraded',
    'Storage pool 1 is crashed',
    'Drive 3 is failing',
    'Drive 4 is warning',
    'Drive 1 is near the end of its life',
    'Drive 2 has too many bad sectors',
  ]);
  assert.deepEqual(readStatus({ is_system_crashed: true }), ['The system has crashed']);
});

test('a volume being repaired or expanded is no problem', () => {
  const storage = copy(FIXTURE.storage);
  storage.volumes[0].status = 'repairing';
  assert.deepEqual(readStorage(storage).problems, []);
});

test('a drive without a temperature has none rather than 0 °C', () => {
  const storage = copy(FIXTURE.storage);
  storage.disks[0].temp = 0;
  delete storage.disks[1].temp;
  const disks = readStorage(storage).disks;
  assert.equal(disks.find((disk) => disk.id === 'sata1')!.temperature, undefined);
  assert.equal(disks.find((disk) => disk.id === 'sata2')!.temperature, undefined);
});

test('an update is read from either version of the answer', () => {
  assert.equal(readUpdate(FIXTURE.upgrade), false);
  assert.equal(readUpdate(FIXTURE.upgradeV2), false);
  assert.equal(readUpdate({ available: true }), true);
  assert.equal(readUpdate({ update: { available: true } }), true);
  assert.equal(readUpdate(undefined), false);
});

test("HomeKit's firmware revision from DSM's version", () => {
  assert.equal(firmwareRevision('DSM 7.4.1-90080 Update 1'), '7.4.1');
  assert.equal(firmwareRevision('DSM 6.2-25556'), '6.2.0');
  assert.equal(firmwareRevision(undefined), undefined);
});

test('numbers also from the strings DSM gives sizes as', () => {
  assert.equal(number('30712206524416'), 30712206524416);
  assert.equal(number(''), undefined);
  assert.equal(number('x'), undefined);
  assert.equal(number(null), undefined);
});

test('an empty or odd answer reads as nothing rather than failing', () => {
  assert.deepEqual(readStorage(null), { volumes: [], disks: [], problems: [] });
  assert.deepEqual(readStorage({ volumes: 'x', disks: [null] }).disks.length, 1);
  assert.equal(readInfo('nonsense').model, undefined);
});
