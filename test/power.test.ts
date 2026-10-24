import assert from 'node:assert/strict';
import test from 'node:test';

import { PowerTracker } from '../src/power.ts';

test('on while DSM answers, off while it does not', () => {
  const power = new PowerTracker();
  assert.equal(power.state(0), 'off');
  power.seen(true, 0);
  assert.equal(power.state(0), 'on');
  assert.equal(power.isOn(0), true);
  power.seen(false, 1000);
  assert.equal(power.state(1000), 'off');
});

test('after a wake it stays on, starting, until DSM answers', () => {
  const power = new PowerTracker();
  power.seen(false, 0);
  power.expect('starting', 180, 0);
  power.seen(false, 60_000);
  assert.equal(power.state(60_000), 'starting');
  assert.equal(power.isOn(60_000), true);
  power.seen(true, 90_000);
  assert.equal(power.state(90_000), 'on');
});

test('a wake that never arrives ends after the startup time', () => {
  const power = new PowerTracker();
  power.expect('starting', 180, 0);
  power.seen(false, 179_000);
  assert.equal(power.state(179_000), 'starting');
  power.seen(false, 181_000);
  assert.equal(power.state(181_000), 'off');
});

test('after a shutdown it stays off, stopping, while DSM still answers', () => {
  const power = new PowerTracker();
  power.seen(true, 0);
  power.expect('stopping', 120, 0);
  power.seen(true, 30_000);
  assert.equal(power.state(30_000), 'stopping');
  assert.equal(power.isOn(30_000), false);
  power.seen(false, 60_000);
  assert.equal(power.state(60_000), 'off');
});

test('a restart stays on until the NAS went away and came back', () => {
  const power = new PowerTracker();
  power.seen(true, 0);
  power.expect('restarting', 300, 0);
  power.seen(true, 5_000);
  assert.equal(power.state(5_000), 'restarting', 'still answering just after the restart is not back yet');
  power.seen(false, 30_000);
  assert.equal(power.state(30_000), 'restarting');
  assert.equal(power.isOn(30_000), true);
  power.seen(true, 120_000);
  assert.equal(power.state(120_000), 'on');
});

test('no grace time means straight to what DSM says', () => {
  const power = new PowerTracker();
  power.seen(true, 0);
  power.expect('stopping', 0, 0);
  assert.equal(power.state(0), 'on');
});
