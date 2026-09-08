import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';

async function setup() {
  const db = createDatabase(':memory:'); const repository = createSqliteRepository(db);
  const server = createApp({ repositoryFor: () => repository, authenticate: async token => token === 'test-token' ? { user: { id: 'test-user', email: 'test@example.com', app_metadata: {} }, issuedAt: Math.floor(Date.now() / 1000) } : null, localMode: true }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, options = {}) => { const res = await fetch(base + path, { headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' }, ...options }); return { status: res.status, data: res.status === 204 ? null : await res.json() }; };
  await call('/api/semester', { method: 'PUT', body: JSON.stringify({ startDate: '2026-08-01' }) });
  return { db, server, call };
}
test('protege endpoints acadêmicos e mantém health check público', async t => {
  const db = createDatabase(':memory:'); const repository = createSqliteRepository(db);
  const server = createApp({ repositoryFor: () => repository, authenticate: async () => null, localMode: true }).listen(0);
  t.after(() => { server.close(); db.close(); }); const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const response = await fetch(`${base}/api/classes`); assert.equal(response.status, 401); assert.equal((await response.json()).code, 'AUTH_REQUIRED');
});
test('exige troca da senha temporária antes de liberar os dados', async t => {
  const db = createDatabase(':memory:'); const repository = createSqliteRepository(db); let changed = false;
  const server = createApp({ repositoryFor: () => repository, authenticate: async () => ({ user: { id: 'new-user', email: 'new@example.com', app_metadata: { must_change_password: true } }, issuedAt: Math.floor(Date.now() / 1000) }), accountAdmin: { async markPasswordChanged() { changed = true; } }, localMode: true }).listen(0);
  t.after(() => { server.close(); db.close(); }); const base = `http://127.0.0.1:${server.address().port}`; const headers = { authorization: 'Bearer temporary' };
  const blocked = await fetch(`${base}/api/classes`, { headers }); assert.equal(blocked.status, 403); assert.equal((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await fetch(`${base}/api/account/password-changed`, { method: 'POST', headers })).status, 204); assert.equal(changed, true);
});
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
test('carrega timeline com um snapshot, sem consultas por disciplina', async t => {
  const db = createDatabase(':memory:'); const baseRepository = createSqliteRepository(db); const calls = {};
  const repository = new Proxy(baseRepository, { get(target, property) { const value = target[property]; return typeof value !== 'function' ? value : async (...args) => { calls[property] = (calls[property] || 0) + 1; return value.apply(target, args); }; } });
  const server = createApp({ repositoryFor: () => repository, authenticate: async () => ({ user: { id: 'test-user', app_metadata: {} }, issuedAt: Math.floor(Date.now() / 1000) }), localMode: true }).listen(0);
  t.after(() => { server.close(); db.close(); }); const base = `http://127.0.0.1:${server.address().port}`; const headers = { 'content-type': 'application/json', authorization: 'Bearer test' };
  const call = (path, options = {}) => fetch(base + path, { headers, ...options });
  await call('/api/semester', { method: 'PUT', body: JSON.stringify({ startDate: '2026-08-01' }) });
  for (const name of ['A', 'B', 'C']) await call('/api/classes', { method: 'POST', body: JSON.stringify({ name, totalMinutes: 1200, meetingMinutes: 100, weekdays: [1], startTime: '08:00' }) });
  for (const key of Object.keys(calls)) delete calls[key];
  assert.equal((await call('/api/sessions?from=2026-08-03&to=2026-08-09')).status, 200);
  assert.deepEqual(calls, { getSnapshot: 1 });
});


test('planner e faltas usam leituras limitadas e retornam o estado persistido', async t => {
  const db = createDatabase(':memory:'); const repository = createSqliteRepository(db);
  await repository.setSemester('2026-08-01');
  const subject = await repository.createClass({ name: 'A', totalMinutes: 1200, meetingMinutes: 100, schedules: [{ weekday: 1, startTime: '08:00' }] });
  const server = createApp({ repositoryFor: () => repository, authenticate: async () => ({ user: { id: 'test-user' } }), localMode: true }).listen(0);
  t.after(() => { server.close(); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const planner = await (await fetch(base + '/api/planner')).json();
  assert.equal(planner.semester.startDate, '2026-08-01');
  assert.equal(planner.classes[0].sessionCount, 12);
  repository.getSnapshot = async () => { throw new Error('Full snapshot forbidden during mutations'); };
  const response = await fetch(base + '/api/classes/' + subject.id + '/absences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-08-03' }) });
  assert.equal(response.status, 201);
  const updated = await response.json();
  assert.deepEqual(updated.absences, await repository.getAbsences(subject.id));
  assert.equal(updated.absenceCount, 1);
  const removed = await fetch(base + '/api/classes/' + subject.id + '/absences/2026-08-03', { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).absenceCount, 0);
});
