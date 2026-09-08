import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionsFor } from '../src/sessions.js';

test('calendario reflete faltas, reposicoes, limites e alteracoes do semestre', () => {
  const subject = { id: 'a', name: 'A', totalMeetings: 4, meetingMinutes: 100, schedules: [{ weekday: 1, startTime: '08:00' }, { weekday: 4, startTime: '10:00' }], absences: ['2026-08-03'], exclusions: ['2026-08-06'], reinstated: ['2026-08-10'], absenceCount: 1, maxAbsences: 1, status: 'limit' };
  const sessions = sessionsFor(subject, { startDate: '2026-08-01' });
  assert.deepEqual(sessions.map(item => item.date), ['2026-08-03', '2026-08-06', '2026-08-10', '2026-08-13']);
  assert.equal(sessions[0].missed, true);
  assert.equal(sessions[1].excluded, true);
  assert.equal(sessions[1].startTime, '10:00');
  assert.equal(sessions[2].reinstated, true);
  assert.ok(sessions.every(item => item.absenceCount === 1 && item.status === 'limit'));
  assert.ok(sessionsFor({ ...subject, absences: [], absenceCount: 0, status: 'safe' }, { startDate: '2026-08-01' }).every(item => !item.missed && item.absenceCount === 0));
  assert.equal(sessionsFor(subject, { startDate: '2026-08-08' })[0].date, '2026-08-10');
  assert.deepEqual(sessionsFor(subject, null), []);
});
