import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import test from 'node:test';

import { ownAddress } from '../src/address.ts';

test("this machine's address is an IPv4 address other than loopback, or none", async () => {
  const address = await ownAddress();
  if (address !== null) {
    assert.equal(isIP(address), 4);
    assert.notEqual(address, '127.0.0.1');
    assert.notEqual(address, '0.0.0.0');
  }
});
