import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.js';

test('retorna JSON normalmente', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await api('/api/test'), { ok: true });
});

test('explica resposta vazia sem expor erro de JSON', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('', { status: 502 });
  await assert.rejects(() => api('/api/test'), error => error.code === 'EMPTY_RESPONSE' && error.message.includes('HTTP 502'));
});

test('explica resposta malformada', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('<html>erro</html>', { status: 502 });
  await assert.rejects(() => api('/api/test'), error => error.code === 'INVALID_RESPONSE');
});
