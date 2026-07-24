import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBoilerIndicator,
  parseScalarTemperature,
  parseTemperature,
  parseUiStatus,
} from '../src/status.js';

test('parseTemperature coerces numeric strings and numbers', () => {
  assert.equal(parseTemperature('21.5'), 21.5);
  assert.equal(parseTemperature('0'), 0);
  assert.equal(parseTemperature(18), 18);
  assert.equal(parseTemperature(-7.5), -7.5);
});

test('parseTemperature rejects values Number() would turn into a bogus 0', () => {
  assert.equal(parseTemperature(''), null);
  assert.equal(parseTemperature(null), null);
  assert.equal(parseTemperature(undefined), null);
});

test('parseTemperature rejects non-numeric and non-finite values', () => {
  assert.equal(parseTemperature('n/a'), null);
  assert.equal(parseTemperature(NaN), null);
  assert.equal(parseTemperature(Infinity), null);
  assert.equal(parseTemperature({}), null);
});

test('parseBoilerIndicator maps the documented codes', () => {
  assert.equal(parseBoilerIndicator('CH'), 'central heating');
  assert.equal(parseBoilerIndicator('HW'), 'hot water');
  assert.equal(parseBoilerIndicator('No'), 'off');
});

test('parseBoilerIndicator returns null for unknown or non-string codes', () => {
  assert.equal(parseBoilerIndicator('XX'), null);
  assert.equal(parseBoilerIndicator(undefined), null);
  assert.equal(parseBoilerIndicator(42), null);
});

test('parseUiStatus reads the fields it needs from a full payload', () => {
  const status = parseUiStatus({
    value: { IHT: '19.5', TSP: '21', BAI: 'CH', UMD: 'clock' },
  });
  assert.deepEqual(status, {
    currentTemperature: 19.5,
    targetTemperature: 21,
    boilerIndicator: 'central heating',
  });
});

test('parseUiStatus degrades to nulls instead of inventing readings', () => {
  assert.deepEqual(parseUiStatus({ value: { IHT: '', TSP: 'n/a', BAI: '??' } }), {
    currentTemperature: null,
    targetTemperature: null,
    boilerIndicator: null,
  });
  assert.deepEqual(parseUiStatus({}), {
    currentTemperature: null,
    targetTemperature: null,
    boilerIndicator: null,
  });
  assert.deepEqual(parseUiStatus(null), {
    currentTemperature: null,
    targetTemperature: null,
    boilerIndicator: null,
  });
});

test('parseScalarTemperature reads the outdoor sensor shape', () => {
  assert.equal(parseScalarTemperature({ value: 8.5 }), 8.5);
  assert.equal(parseScalarTemperature({ value: '8.5' }), 8.5);
  assert.equal(parseScalarTemperature({}), null);
  assert.equal(parseScalarTemperature(undefined), null);
});
