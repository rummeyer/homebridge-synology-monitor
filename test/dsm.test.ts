import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { describe, DsmClient, DsmError, httpTransport, unwrap } from '../src/dsm.ts';
import { fakeDsm, FIXTURE, nasConfig } from './helpers.ts';

test('logs in once and keeps the session for every call', async () => {
  const dsm = fakeDsm();
  const client = new DsmClient(nasConfig(), dsm);
  assert.deepEqual(await client.call('SYNO.DSM.Info', 2, 'getinfo'), FIXTURE.info);
  await client.call('SYNO.Core.System.Utilization', 1, 'get');
  assert.equal(dsm.logins, 1);
  const login = dsm.calls[0];
  assert.deepEqual(login, {
    api: 'SYNO.API.Auth',
    version: 6,
    method: 'login',
    account: 'monitor',
    passwd: 'secret',
    session: 'SynologyMonitor',
    format: 'sid',
  });
  assert.equal(dsm.calls[2]._sid, 'sid-1');
});

test('a session DSM ended is renewed once, and the call made again', async () => {
  const dsm = fakeDsm();
  const client = new DsmClient(nasConfig(), dsm);
  await client.call('SYNO.DSM.Info', 2, 'getinfo');
  dsm.errors['SYNO.DSM.Info.getinfo'] = [119];
  assert.deepEqual(await client.call('SYNO.DSM.Info', 2, 'getinfo'), FIXTURE.info);
  assert.equal(dsm.logins, 2);
  assert.equal(dsm.calls.at(-1)!._sid, 'sid-2');
});

test('other errors are passed on with their meaning, without a new login', async () => {
  const dsm = fakeDsm();
  const client = new DsmClient(nasConfig(), dsm);
  dsm.errors['SYNO.Core.System.shutdown'] = [105];
  await assert.rejects(client.call('SYNO.Core.System', 1, 'shutdown'), (error: DsmError) => {
    assert.equal(error.code, 105);
    assert.match(error.message, /administrator/);
    return true;
  });
  assert.equal(dsm.logins, 1);
});

test('a refused login says why, and the next call tries again', async () => {
  const dsm = fakeDsm();
  const client = new DsmClient(nasConfig(), dsm);
  dsm.errors['SYNO.API.Auth.login'] = [403];
  await assert.rejects(client.call('SYNO.DSM.Info', 2, 'getinfo'), /2-step verification/);
  assert.equal(client.loggedIn, false);
  await client.call('SYNO.DSM.Info', 2, 'getinfo');
  assert.equal(client.loggedIn, true);
});

test('calls made together share one login', async () => {
  const dsm = fakeDsm();
  const client = new DsmClient(nasConfig(), dsm);
  await Promise.all([client.call('SYNO.DSM.Info', 2, 'getinfo'), client.call('SYNO.Core.System.Status', 1, 'get')]);
  assert.equal(dsm.logins, 1);
});

test('logout ends the session, and forget only drops it', async () => {
  const dsm = fakeDsm();
  const client = new DsmClient(nasConfig(), dsm);
  await client.logout();
  assert.equal(dsm.calls.length, 0, 'nothing to end without a session');
  await client.call('SYNO.DSM.Info', 2, 'getinfo');
  await client.logout();
  assert.deepEqual(dsm.calls.at(-1), { api: 'SYNO.API.Auth', version: 6, method: 'logout', session: 'SynologyMonitor', _sid: 'sid-1' });
  await client.call('SYNO.DSM.Info', 2, 'getinfo');
  client.forget();
  assert.equal(client.loggedIn, false);
  assert.equal(dsm.calls.at(-1)!.method, 'getinfo', 'forget sends nothing');
});

test('unwrap: data on success, a DsmError on failure', () => {
  assert.deepEqual(unwrap({ success: true, data: { a: 1 } }), { a: 1 });
  assert.deepEqual(unwrap({ success: true }), {});
  assert.throws(() => unwrap({ success: false, error: { code: 400 } }), /wrong username or password/);
  assert.throws(() => unwrap('nonsense'), /unknown error/);
  assert.equal(describe(999), 'error 999');
});

test('the real transport POSTs a form to entry.cgi, so the password is never in the URL', async () => {
  let seen: { url?: string; method?: string; type?: string; body: string } = { body: '' };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      seen = { url: request.url, method: request.method, type: request.headers['content-type'], body };
      response.end(JSON.stringify({ success: true, data: { sid: 'x' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const transport = httpTransport(nasConfig({ protocol: 'http', host: '127.0.0.1', port }));
    assert.deepEqual(await transport({ api: 'SYNO.API.Auth', method: 'login', passwd: 'p&ss word' }), { success: true, data: { sid: 'x' } });
    assert.equal(seen.url, '/webapi/entry.cgi');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.type, 'application/x-www-form-urlencoded');
    assert.equal(new URLSearchParams(seen.body).get('passwd'), 'p&ss word');
  } finally {
    server.close();
  }
});

test('an answer that is not JSON, or none at all, is an error', async () => {
  const server = createServer((_request, response) => response.end('<html>'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(httpTransport(nasConfig({ protocol: 'http', host: '127.0.0.1', port }))({}), /without JSON/);
  } finally {
    server.close();
  }
  await assert.rejects(httpTransport(nasConfig({ protocol: 'http', host: '127.0.0.1', port }), 500)({}));
});
