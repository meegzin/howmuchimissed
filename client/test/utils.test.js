import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatMinutes, statusText } from '../src/utils.js';
test('formata valores para português sem deslocar a data', () => { assert.match(formatDate('2026-08-03'), /03/); assert.equal(formatMinutes(150), '2h 30min'); assert.equal(statusText.limit, 'No limite'); });
