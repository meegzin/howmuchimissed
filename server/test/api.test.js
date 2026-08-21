import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

async function setup() {
  const db = createDatabase(':memory:'); const server = createApp(db, () => '2026-08-01').listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, options = {}) => { const res = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...options }); return { status: res.status, data: res.status === 204 ? null : await res.json() }; };
  await call('/api/semester', { method: 'PUT', body: JSON.stringify({ startDate: '2026-08-01' }) });
  return { db, server, call };
}
test('CRUD, duplicidade, conflito e cascata', async t => {
  const { db, server, call } = await setup(); t.after(() => { server.close(); db.close(); });
  const created = await call('/api/classes', { method: 'POST', body: JSON.stringify({ name: 'Cálculo', totalMinutes: 1200, meetingMinutes: 100, weekdays: [1], startTime: '08:00' }) });
  assert.equal(created.status, 201); const id = created.data.id;
  assert.equal((await call(`/api/classes/${id}/absences`, { method: 'POST', body: JSON.stringify({ date: '2026-08-03' }) })).status, 201);
  assert.equal((await call(`/api/classes/${id}/absences`, { method: 'POST', body: JSON.stringify({ date: '2026-08-03' }) })).data.code, 'DUPLICATE_ABSENCE');
  assert.equal((await call(`/api/classes/${id}`, { method: 'PATCH', body: JSON.stringify({ weekdays: [2] }) })).data.code, 'SESSION_CONFLICT');
  assert.equal((await call(`/api/classes/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal(db.prepare('SELECT count(*) count FROM absences').get().count, 0);
});
test('aceita falta verdadeira mesmo acima do limite e rejeita data sem aula', async t => {
  const { db, server, call } = await setup(); t.after(() => { server.close(); db.close(); });
  const item = (await call('/api/classes', { method: 'POST', body: JSON.stringify({ name: 'Lab', totalMinutes: 300, meetingMinutes: 100, weekdays: [1], startTime: '10:00' }) })).data;
  assert.equal((await call(`/api/classes/${item.id}/absences`, { method: 'POST', body: JSON.stringify({ date: '2026-08-03' }) })).data.status, 'exceeded');
  assert.equal((await call(`/api/classes/${item.id}/absences`, { method: 'POST', body: JSON.stringify({ date: '2026-08-04' }) })).data.code, 'INVALID_SESSION');
});
test('importa matérias em lote com horários diferentes por dia', async t => {
  const { db, server, call } = await setup(); t.after(() => { server.close(); db.close(); });
  const response = await call('/api/classes/import', { method: 'POST', body: JSON.stringify({ subjects: [{
    name: 'Coding', totalMinutes: 4800, meetingMinutes: 120,
    schedules: [{ weekday: 1, startTime: '15:10' }, { weekday: 4, startTime: '13:00' }]
  }] }) });
  assert.equal(response.status, 201);
  assert.deepEqual(response.data[0].schedules, [{ weekday: 1, startTime: '15:10' }, { weekday: 4, startTime: '13:00' }]);
  const sessions = await call(`/api/classes/${response.data[0].id}/sessions?from=2026-08-03&to=2026-08-06`);
  assert.deepEqual(sessions.data.map(item => item.date), ['2026-08-03', '2026-08-06']);
});
test('mantém aula cancelada no grid e permite marcá-la como reposta', async t => {
  const { db, server, call } = await setup(); t.after(() => { server.close(); db.close(); });
  const subject = (await call('/api/classes', { method: 'POST', body: JSON.stringify({ name: 'UX', totalMinutes: 2400, meetingMinutes: 120, weekdays: [1], startTime: '13:00' }) })).data;
  assert.equal(subject.totalMeetings, 20);
  assert.equal(subject.maxAbsences, 5);
  const date = '2026-08-03';
  assert.equal((await call(`/api/classes/${subject.id}/exclusions`, { method: 'POST', body: JSON.stringify({ date }) })).status, 201);
  let sessions = await call(`/api/classes/${subject.id}/sessions`);
  assert.equal(sessions.data.length, 20);
  assert.equal(sessions.data.find(item => item.date === date).excluded, true);
  assert.equal((await call(`/api/classes/${subject.id}/absences`, { method: 'POST', body: JSON.stringify({ date }) })).data.code, 'EXCLUDED_SESSION');
  assert.equal((await call(`/api/classes/${subject.id}/exclusions/${date}`, { method: 'PATCH' })).status, 200);
  assert.equal((await call(`/api/classes/${subject.id}/absences`, { method: 'POST', body: JSON.stringify({ date }) })).status, 201);
  sessions = await call(`/api/classes/${subject.id}/sessions`);
  assert.equal(sessions.data.find(item => item.date === date).reinstated, true);
});
test('lista aulas agregadas para a timeline semanal', async t => {
  const { db, server, call } = await setup(); t.after(() => { server.close(); db.close(); });
  await call('/api/classes', { method: 'POST', body: JSON.stringify({ name: 'UX', totalMinutes: 2400, meetingMinutes: 120, weekdays: [1], startTime: '13:00' }) });
  await call('/api/classes', { method: 'POST', body: JSON.stringify({ name: 'Dados', totalMinutes: 2400, meetingMinutes: 120, weekdays: [4], startTime: '15:10' }) });
  const response = await call('/api/sessions?from=2026-08-03&to=2026-08-09');
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.map(item => [item.date, item.name, item.startTime]), [
    ['2026-08-03', 'UX', '13:00'], ['2026-08-06', 'Dados', '15:10']
  ]);
});
