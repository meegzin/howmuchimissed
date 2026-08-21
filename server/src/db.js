import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS semester (id INTEGER PRIMARY KEY CHECK (id = 1), start_date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, total_minutes INTEGER NOT NULL,
      meeting_minutes INTEGER NOT NULL, weekdays TEXT NOT NULL, start_time TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS class_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      UNIQUE (class_id, weekday, start_time)
    );
    CREATE TABLE IF NOT EXISTS exclusions (
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, date TEXT NOT NULL,
      reinstated INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (class_id, date)
    );
    CREATE TABLE IF NOT EXISTS absences (
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, date TEXT NOT NULL,
      PRIMARY KEY (class_id, date)
    );
  `);
  const withoutSchedules = db.prepare(`
    SELECT id, weekdays, start_time FROM classes
    WHERE NOT EXISTS (SELECT 1 FROM class_schedules WHERE class_id = classes.id)
  `).all();
  const insertSchedule = db.prepare('INSERT OR IGNORE INTO class_schedules (class_id, weekday, start_time) VALUES (?, ?, ?)');
  for (const subject of withoutSchedules) {
    for (const weekday of JSON.parse(subject.weekdays)) insertSchedule.run(subject.id, weekday, subject.start_time);
  }
  return db;
}
