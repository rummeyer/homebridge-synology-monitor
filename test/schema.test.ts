/**
 * The settings form is shipped as data and never type-checked: its
 * defaults and limits have to match what the code falls back to.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DEFAULT_SENSORS, DEFAULTS, MIN_POLL_SECONDS } from '../src/config.ts';
import { PLATFORM_NAME } from '../src/settings.ts';

const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
const properties = schema.schema.properties;
const nas = properties.nas.items.properties;

test('the schema belongs to this platform', () => {
  assert.equal(schema.pluginAlias, PLATFORM_NAME);
  assert.equal(schema.pluginType, 'platform');
});

test('every accessory has a switch, with the default the code uses', () => {
  const sensors = nas.sensors.properties;
  assert.deepEqual(Object.keys(sensors), Object.keys(DEFAULT_SENSORS));
  for (const [key, fallback] of Object.entries(DEFAULT_SENSORS)) {
    assert.equal(sensors[key].default, fallback, key);
  }
});

test('placeholders and limits match the code', () => {
  assert.equal(nas.port.placeholder, DEFAULTS.port);
  assert.equal(nas.startupSeconds.placeholder, DEFAULTS.startupSeconds);
  assert.equal(nas.shutdownSeconds.placeholder, DEFAULTS.shutdownSeconds);
  assert.equal(nas.broadcast.placeholder, DEFAULTS.broadcast);
  assert.equal(properties.pollSeconds.placeholder, DEFAULTS.pollSeconds);
  assert.equal(properties.pollSeconds.minimum, MIN_POLL_SECONDS);
  assert.equal(properties.dashboardPort.placeholder, DEFAULTS.dashboardPort);
});

test('every field is in the layout', () => {
  const layout = JSON.stringify(schema.layout);
  for (const key of Object.keys(nas).filter((key) => key !== 'sensors')) {
    assert.ok(layout.includes(`"nas[].${key}"`), key);
  }
  for (const key of Object.keys(nas.sensors.properties)) {
    assert.ok(layout.includes(`"nas[].sensors.${key}"`), key);
  }
  for (const key of Object.keys(properties).filter((key) => key !== 'nas')) {
    assert.ok(layout.includes(`"${key}"`), key);
  }
});

test('the password field hides what is typed', () => {
  assert.equal(nas.password['x-schema-form'].type, 'password');
});
