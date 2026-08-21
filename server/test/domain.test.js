import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSummary, generateScheduledDatesByCount, generateSessionDates } from '../src/domain.js';

test('calcula limite exato de 25% com inteiros', () => {
  assert.deepEqual(calculateSummary({ totalMinutes: 400, meetingMinutes: 100, absenceCount: 1 }), { totalMeetings: 4, maxAbsences: 1, missedMinutes: 100, absenceCount: 1, remainingMeetings: 0, remainingMinutes: 0, status: 'limit' });
});
test('arredonda conservadoramente encontros completos e detecta excesso', () => {
  assert.equal(calculateSummary({ totalMinutes: 610, meetingMinutes: 60, absenceCount: 1 }).remainingMeetings, 1);
  assert.equal(calculateSummary({ totalMinutes: 400, meetingMinutes: 100, absenceCount: 2 }).status, 'exceeded');
});
test('calcula quantidade oficial e arredonda o limite para baixo', () => {
  const summary = calculateSummary({ totalMinutes: 1800, meetingMinutes: 120, absenceCount: 0 });
  assert.equal(summary.totalMeetings, 15);
  assert.equal(summary.maxAbsences, 3);
});
test('gera sessões inclusivas em vários dias e aplica exclusões sem fuso', () => assert.deepEqual(generateSessionDates('2026-08-03', '2026-08-12', [1, 3], ['2026-08-05']), ['2026-08-03', '2026-08-10', '2026-08-12']));
test('gera exatamente a quantidade oficial de aulas sem data final', () => {
  const dates = generateScheduledDatesByCount('2026-08-04', [{ weekday: 1 }, { weekday: 4 }], 5);
  assert.deepEqual(dates, ['2026-08-06', '2026-08-10', '2026-08-13', '2026-08-17', '2026-08-20']);
});
