import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { createSqliteRepository } from './repositories/sqlite.js';
import { createSupabaseRepository } from './repositories/supabase.js';

const port = process.env.PORT || 3001;
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean);
let options;

if (supabaseUrl && publishableKey && secretKey) {
  const authClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  options = {
    allowedOrigins,
    authenticate: async token => {
      if (!token) return null;
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) return null;
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      return { user: data.user, issuedAt: payload.iat };
    },
    repositoryFor: (token, user) => createSupabaseRepository(createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false }
    }), user.id),
    accountAdmin: {
      async health() { const { error } = await admin.from('semesters').select('user_id', { head: true, count: 'exact' }).limit(1); if (error) throw error; },
      async markPasswordChanged(id) { const { data } = await admin.auth.admin.getUserById(id); const metadata = { ...(data.user?.app_metadata || {}), must_change_password: false }; const { error } = await admin.auth.admin.updateUserById(id, { app_metadata: metadata }); if (error) throw error; },
      async deleteUser(id) { const { error } = await admin.auth.admin.deleteUser(id); if (error) throw error; }
    }
  };
} else {
  if (process.env.NODE_ENV === 'production') throw new Error('As três variáveis do Supabase são obrigatórias em produção.');
  const here = dirname(fileURLToPath(import.meta.url)); const preferredPath = join(here, '..', 'data', 'planner.db'); const legacyPath = join(here, '..', 'server', 'data', 'planner.db');
  const db = createDatabase(process.env.DB_PATH || (existsSync(preferredPath) || !existsSync(legacyPath) ? preferredPath : legacyPath)); const repository = createSqliteRepository(db);
  options = { localMode: true, allowedOrigins, authenticate: async () => ({ user: { id: 'local-user', email: 'local@localhost', app_metadata: {} }, issuedAt: Math.floor(Date.now() / 1000) }), repositoryFor: () => repository };
}

createApp(options).listen(port, '0.0.0.0', () => console.log(`API disponível na porta ${port}`));
