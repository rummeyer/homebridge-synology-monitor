import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { isLocalAddress, magicPacket, reachable } from '../src/network.ts';

test('a magic packet is six 0xFF and the MAC sixteen times', () => {
  const packet = magicPacket('00:11:32:ab:cd:ef');
  assert.equal(packet.length, 102);
  assert.deepEqual([...packet.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  for (let i = 0; i < 16; i++) {
    assert.deepEqual([...packet.subarray(6 + i * 6, 12 + i * 6)], [0x00, 0x11, 0x32, 0xab, 0xcd, 0xef]);
  }
  assert.throws(() => magicPacket('00:11:32'), /not a MAC/);
});

test('the magic packet goes out over UDP', async () => {
  // To a listener on this machine, standing in for the broadcast.
  const listener = createSocket('udp4');
  await new Promise<void>((resolve) => listener.bind(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  const received = new Promise<Buffer>((resolve) => listener.once('message', resolve));
  const sender = createSocket('udp4');
  await new Promise<void>((resolve, reject) => sender.send(magicPacket('00:11:32:ab:cd:ef'), port, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
  sender.close();
  assert.equal((await received).length, 102);
  listener.close();
});

test('reachable while something accepts connections on the port, not otherwise', async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  assert.equal(await reachable('127.0.0.1', port), true);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(await reachable('127.0.0.1', port), false);
});

test('only the home network may press the buttons, as with nas-control', () => {
  for (const address of ['10.0.1.66', '192.168.178.20', '172.16.0.1', '172.31.255.255', '127.0.0.1', '169.254.1.2', '::1', '::ffff:10.0.1.66', 'fd12:3456::1', 'fe80::1']) {
    assert.equal(isLocalAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '2001:4860::8888', '::ffff:8.8.8.8', '', undefined]) {
    assert.equal(isLocalAddress(address), false, String(address));
  }
});
