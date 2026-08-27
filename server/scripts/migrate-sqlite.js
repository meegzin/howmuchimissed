import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2); const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const defaultDatabase = fileURLToPath(new URL('../data/planner.db', import.meta.url));
const userId = value('--user'); const filename = resolve(value('--db') || defaultDatabase); const apply = args.includes('--apply');
if (!userId) throw new Error('Informe --user UUID. Sem --apply, o comando apenas simula.');
if (!existsSync(filename)) throw new Error(`Banco não encontrado: ${filename}`);
const db = new DatabaseSync(filename, { readOnly: true });
const source = { semester: db.prepare('select start_date from semester where id=1').get() || null, classes: db.prepare('select * from classes order by id').all(), schedules: db.prepare('select * from class_schedules order by id').all(), absences: db.prepare('select * from absences order by class_id,date').all(), exclusions: db.prepare('select * from exclusions order by class_id,date').all() }; db.close();
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', filename, userId, counts: { semester: Number(Boolean(source.semester)), classes: source.classes.length, schedules: source.schedules.length, absences: source.absences.length, exclusions: source.exclusions.length } }, null, 2));
if (!apply) process.exit(0);
const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY; if (!url || !key) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const existing = await client.from('classes').select('id', { count: 'exact', head: true }).eq('user_id', userId); if (existing.error) throw existing.error;
const semester = await client.from('semesters').select('user_id').eq('user_id', userId).maybeSingle(); if (semester.error) throw semester.error;
if (existing.count || semester.data) throw new Error('O usuário de destino já possui dados; a migração foi cancelada.');
const idMap = new Map();
try {
  if (source.semester) { const { error } = await client.from('semesters').insert({ user_id: userId, start_date: source.semester.start_date }); if (error) throw error; }
  for (const item of source.classes) { const { data, error } = await client.from('classes').insert({ user_id: userId, name: item.name, total_minutes: item.total_minutes, meeting_minutes: item.meeting_minutes, created_at: item.created_at }).select('id').single(); if (error) throw error; idMap.set(String(item.id), data.id); }
  for (const item of source.schedules) { const { error } = await client.from('class_schedules').insert({ user_id: userId, class_id: idMap.get(String(item.class_id)), weekday: item.weekday, start_time: item.start_time }); if (error) throw error; }
  for (const item of source.absences) { const { error } = await client.from('absences').insert({ user_id: userId, class_id: idMap.get(String(item.class_id)), date: item.date }); if (error) throw error; }
  for (const item of source.exclusions) { const { error } = await client.from('exclusions').insert({ user_id: userId, class_id: idMap.get(String(item.class_id)), date: item.date, reinstated: Boolean(item.reinstated) }); if (error) throw error; }
} catch (error) { await client.from('classes').delete().eq('user_id', userId); await client.from('semesters').delete().eq('user_id', userId); throw error; }
console.log('Migração concluída sem alterar o arquivo SQLite original.');
