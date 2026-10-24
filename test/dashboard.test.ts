import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, test } from 'node:test';

import { Dashboard } from '../src/dashboard.ts';
import { DsmClient } from '../src/dsm.ts';
import { NasMonitor } from '../src/monitor.ts';
import { fakeDsm, nasConfig, testLog } from './helpers.ts';

const dsm = fakeDsm();
const net = { up: true, woken: 0 };
const monitor = new NasMonitor(nasConfig(), testLog(), {
  dsm: new DsmClient(nasConfig(), dsm),
  reachable: async () => net.up,
  wake: async () => void net.woken++,
});
const source = { monitors: () => [monitor], controls: true };
const dashboard = new Dashboard(source);

before(async () => {
  await monitor.poll();
  await dashboard.listen(0);
});
after(() => dashboard.close());

/** A request to the dashboard from this machine, which counts as the home network. */
function ask(method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: dashboard.port, method, path, headers }, (response) => {
      let text = '';
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => resolve({ status: response.statusCode!, type: String(response.headers['content-type']), body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const post = (path: string) => ask('POST', path, '{}', { 'Content-Type': 'application/json' });

test('the page and its files', async () => {
  const page = await ask('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>Synology Monitor<\/title>/);
  for (const file of ['/dashboard.js', '/theme.js', '/icon.png', '/home.svg']) {
    assert.equal((await ask('GET', file)).status, 200, file);
  }
  assert.equal((await ask('GET', '/nothing')).status, 404);
});

test('the state: every NAS with what it reads, and whether there are buttons', async () => {
  const state = JSON.parse((await ask('GET', '/state')).body);
  assert.equal(state.controls, true);
  assert.match(state.version, /^\d+\.\d+\.\d+$/);
  assert.equal(state.nas.length, 1);
  assert.equal(state.nas[0].name, 'Diskstation');
  assert.equal(state.nas[0].power, 'on');
  assert.equal(state.nas[0].readings.temperature, 42);
  assert.equal(JSON.stringify(state).includes('secret'), false, 'the password is never sent');
});

test('a button press wants JSON, so a form on another site cannot press it', async () => {
  const form = await ask('POST', '/nas/0/shutdown', 'x=1', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  assert.equal(dsm.calls.some((call) => call.method === 'shutdown'), false);
});

test('an unknown NAS or action is not found', async () => {
  assert.equal((await post('/nas/5/shutdown')).status, 404);
  assert.equal((await post('/nas/0/format')).status, 404);
});

test('restart, then shut down, through the buttons', async () => {
  const restarted = await post('/nas/0/restart');
  assert.equal(restarted.status, 200);
  assert.equal(JSON.parse(restarted.body).nas.power, 'restarting');
  const shut = await post('/nas/0/shutdown');
  assert.equal(shut.status, 200);
  assert.ok(dsm.calls.some((call) => call.method === 'shutdown'));
});

test('a press that fails answers with why', async () => {
  net.up = false;
  await monitor.poll();
  const failed = await post('/nas/0/restart');
  assert.equal(failed.status, 502);
  assert.match(JSON.parse(failed.body).error, /does not answer/);
  const woken = await post('/nas/0/wake');
  assert.equal(woken.status, 200);
  assert.equal(net.woken, 1);
});

test('with the buttons switched off, the page is read only', async () => {
  source.controls = false;
  try {
    assert.equal((await post('/nas/0/wake')).status, 403);
    assert.equal(JSON.parse((await ask('GET', '/state')).body).controls, false);
  } finally {
    source.controls = true;
  }
});

test('other methods are refused', async () => {
  assert.equal((await ask('DELETE', '/state')).status, 405);
});
