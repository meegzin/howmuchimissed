import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const [action, email] = process.argv.slice(2);
const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY.');
if (!['create', 'reset'].includes(action) || !/^\S+@\S+\.\S+$/.test(email || '')) throw new Error('Uso: npm run admin:user -- create|reset usuario@exemplo.com');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const temporaryPassword = `${randomBytes(12).toString('base64url')}aA1!`;
let result;
if (action === 'create') result = await client.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, app_metadata: { must_change_password: true } });
else {
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 }); if (error) throw error;
  const user = data.users.find(item => item.email?.toLowerCase() === email.toLowerCase()); if (!user) throw new Error('Usuário não encontrado.');
  result = await client.auth.admin.updateUserById(user.id, { password: temporaryPassword, app_metadata: { ...user.app_metadata, must_change_password: true } });
}
if (result.error) throw result.error;
console.log(`Usuário: ${result.data.user.email}`); console.log(`UUID: ${result.data.user.id}`); console.log(`Senha temporária (exibida uma vez): ${temporaryPassword}`);
