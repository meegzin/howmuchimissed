import { supabase } from './auth.js';

const apiError = (code, message) => Object.assign(new Error(message), { code });

export async function api(path, options = {}) {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(session && { Authorization: `Bearer ${session.access_token}` }), ...options.headers };
  const base = (import.meta.env || {}).VITE_API_URL || '';
  const response = await fetch(`${base}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const body = await response.text();
  if (!body.trim()) {
    throw apiError(
      'EMPTY_RESPONSE',
      response.ok
        ? 'O servidor não concluiu a resposta. Tente importar o PDF novamente.'
        : `O servidor não respondeu corretamente (HTTP ${response.status}).`
    );
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw apiError('INVALID_RESPONSE', 'O servidor retornou uma resposta inválida. Tente novamente.');
  }
  if (!response.ok) throw data;
  return data;
}
