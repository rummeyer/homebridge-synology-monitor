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

test('placeholders match the code', () => {
  assert.equal(nas.port.placeholder, String(DEFAULTS.port));
  assert.equal(nas.startupSeconds.placeholder, String(DEFAULTS.startupSeconds));
  assert.equal(nas.shutdownSeconds.placeholder, String(DEFAULTS.shutdownSeconds));
  assert.equal(nas.broadcast.placeholder, DEFAULTS.broadcast);
  assert.equal(properties.pollSeconds.placeholder, String(DEFAULTS.pollSeconds));
  assert.match(properties.pollSeconds.description, new RegExp(`at least ${MIN_POLL_SECONDS}`));
  assert.equal(properties.dashboardPort.placeholder, String(DEFAULTS.dashboardPort));
});

test('no number field is a slider: none has both a minimum and a maximum', () => {
  const numbers = [...Object.entries(properties), ...Object.entries(nas)].filter(([, field]: [string, any]) => field.type === 'integer');
  assert.ok(numbers.length >= 5);
  for (const [key, field] of numbers as [string, any][]) {
    assert.ok(!('minimum' in field && 'maximum' in field), key);
  }
});

test('the dashboard settings are always shown, the port beside the switch, as in appliance-monitor', () => {
  for (const key of ['dashboard', 'dashboardPort', 'dashboardControls']) {
    assert.equal(properties[key].condition, undefined, key);
  }
  assert.ok(JSON.stringify(schema.layout).includes('"items":["dashboard","dashboardPort"]'));
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
