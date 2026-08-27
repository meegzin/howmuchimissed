import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2); const outputIndex = args.indexOf('--output'); const output = outputIndex >= 0 ? resolve(args[outputIndex + 1]) : null;
if (!output) throw new Error('Uso: npm run backup -- --output caminho/backup.json');
if (existsSync(output)) throw new Error('O arquivo de destino já existe; escolha outro nome.');
const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY; if (!url || !key) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); const tables = ['semesters', 'classes', 'class_schedules', 'absences', 'exclusions']; const data = {};
for (const table of tables) { const result = await client.from(table).select('*'); if (result.error) throw result.error; data[table] = result.data; }
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...data }, null, 2), { flag: 'wx', mode: 0o600 }); console.log(`Backup salvo em ${output}. Guarde-o fora do repositório em local protegido.`);
