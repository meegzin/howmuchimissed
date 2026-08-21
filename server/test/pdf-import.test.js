import test from 'node:test';
import assert from 'node:assert/strict';
import { inferTotalMinutes } from '../src/pdf-import.js';

test('sugere 40h por encontro semanal reconhecido', () => {
  assert.equal(inferTotalMinutes(1), 2400);
  assert.equal(inferTotalMinutes(2), 4800);
});
