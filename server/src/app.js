import express from 'express';
import multer from 'multer';
import { calculateSummary, generateScheduledDatesByCount, isIsoDate } from './domain.js';
import { inspectTimetablePdf } from './pdf-import.js';

const error = (res, status, code, message, fields) => res.status(status).json({ code, message, ...(fields && { fields }) });
const rowToClass = row => row && ({ id: row.id, name: row.name, totalMinutes: row.total_minutes, meetingMinutes: row.meeting_minutes, weekdays: JSON.parse(row.weekdays), startTime: row.start_time });
const semesterFrom = db => db.prepare('SELECT start_date AS startDate FROM semester WHERE id = 1').get() || null;
const schedulesFrom = (db, id) => db.prepare('SELECT weekday, start_time AS startTime FROM class_schedules WHERE class_id = ? ORDER BY weekday, start_time').all(id);
const withSchedules = (db, subject) => subject && ({ ...subject, schedules: schedulesFrom(db, subject.id) });
const classFrom = (db, id) => withSchedules(db, rowToClass(db.prepare('SELECT * FROM classes WHERE id = ?').get(id)));
const datesFrom = (db, table, id) => db.prepare(`SELECT date FROM ${table} WHERE class_id = ? ORDER BY date`).all(id).map(row => row.date);
const exclusionRowsFrom = (db, id) => db.prepare('SELECT date, reinstated FROM exclusions WHERE class_id = ? ORDER BY date').all(id).map(row => ({ date: row.date, reinstated: Boolean(row.reinstated) }));

function validateSemester(body) {
  const fields = {};
  if (!isIsoDate(body.startDate)) fields.startDate = 'Informe uma data inicial válida.';
  return fields;
}

function validateClass(body) {
  const fields = {};
  if (!body.name?.trim()) fields.name = 'Informe o nome da disciplina.';
  if (!Number.isInteger(body.totalMinutes) || body.totalMinutes <= 0) fields.totalMinutes = 'Informe uma carga horária positiva.';
  if (!Number.isInteger(body.meetingMinutes) || body.meetingMinutes <= 0) fields.meetingMinutes = 'Informe uma duração positiva.';
  if (body.meetingMinutes > body.totalMinutes) fields.meetingMinutes = 'A duração não pode superar a carga horária.';
  const schedules = body.schedules || (Array.isArray(body.weekdays) ? body.weekdays.map(weekday => ({ weekday, startTime: body.startTime })) : []);
  if (!Array.isArray(schedules) || !schedules.length || schedules.some(item => !Number.isInteger(item.weekday) || item.weekday < 0 || item.weekday > 6)) fields.weekdays = 'Informe ao menos um encontro semanal.';
  if (schedules.some(item => !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime || ''))) fields.startTime = 'Informe horários válidos.';
  if (new Set(schedules.map(item => `${item.weekday}-${item.startTime}`)).size !== schedules.length) fields.weekdays = 'Existem encontros duplicados.';
  if (new Set(schedules.map(item => item.weekday)).size !== schedules.length) fields.weekdays = 'Cadastre no máximo um encontro por dia da semana.';
  return fields;
}

function normalizedSchedules(body) {
  return body.schedules || body.weekdays.map(weekday => ({ weekday, startTime: body.startTime }));
}

export function createApp(db) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  app.use(express.json());

  const details = subject => {
    const semester = semesterFrom(db);
    const exclusionRows = exclusionRowsFrom(db, subject.id);
    const exclusions = exclusionRows.filter(item => !item.reinstated).map(item => item.date);
    const reinstated = exclusionRows.filter(item => item.reinstated).map(item => item.date);
    const absences = datesFrom(db, 'absences', subject.id);
    const totalMeetings = Math.floor(subject.totalMinutes / subject.meetingMinutes);
    const dates = semester ? generateScheduledDatesByCount(semester.startDate, subject.schedules, totalMeetings) : [];
    return { ...subject, exclusions, reinstated, absences, sessionCount: dates.length, ...calculateSummary({ totalMinutes: subject.totalMinutes, meetingMinutes: subject.meetingMinutes, absenceCount: absences.length }) };
  };

  app.get('/api/semester', (_req, res) => res.json(semesterFrom(db)));
  app.put('/api/semester', (req, res) => {
    const fields = validateSemester(req.body);
    if (Object.keys(fields).length) return error(res, 400, 'VALIDATION_ERROR', 'Revise as datas do semestre.', fields);
    const classes = db.prepare('SELECT * FROM classes').all().map(rowToClass).map(subject => withSchedules(db, subject));
    for (const subject of classes) {
      const count = Math.floor(subject.totalMinutes / subject.meetingMinutes);
      const valid = new Set(generateScheduledDatesByCount(req.body.startDate, subject.schedules, count));
      const history = [...datesFrom(db, 'absences', subject.id), ...datesFrom(db, 'exclusions', subject.id)];
      if (history.some(date => !valid.has(date))) return error(res, 409, 'SESSION_CONFLICT', 'A alteração invalidaria uma aula com histórico. Remova o registro antes de alterar o início.');
    }
    db.prepare('INSERT INTO semester (id,start_date) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET start_date=excluded.start_date').run(req.body.startDate);
    res.json(semesterFrom(db));
  });

  app.get('/api/sessions', (req, res) => {
    const { from, to } = req.query;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) return error(res, 400, 'INVALID_RANGE', 'Informe um intervalo de datas válido.');
    const semester = semesterFrom(db);
    if (!semester) return res.json([]);
    const subjects = db.prepare('SELECT * FROM classes ORDER BY name').all().map(rowToClass).map(subject => withSchedules(db, subject));
    const sessions = [];
    for (const subject of subjects) {
      const summary = details(subject);
      const exclusions = new Map(exclusionRowsFrom(db, subject.id).map(item => [item.date, item]));
      const absences = new Set(summary.absences);
      const dates = generateScheduledDatesByCount(semester.startDate, subject.schedules, summary.totalMeetings).filter(date => date >= from && date <= to);
      for (const date of dates) {
        const exclusion = exclusions.get(date);
        const schedule = subject.schedules.find(item => item.weekday === new Date(`${date}T00:00:00Z`).getUTCDay());
        sessions.push({
          date, classId: subject.id, name: subject.name, startTime: schedule?.startTime,
          meetingMinutes: subject.meetingMinutes, missed: absences.has(date),
          excluded: Boolean(exclusion && !exclusion.reinstated), reinstated: Boolean(exclusion?.reinstated),
          absenceCount: summary.absenceCount, maxAbsences: summary.maxAbsences, status: summary.status
        });
      }
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name));
    res.json(sessions);
  });

  app.get('/api/classes', (_req, res) => res.json(db.prepare('SELECT * FROM classes ORDER BY name').all().map(rowToClass).map(subject => withSchedules(db, subject)).map(details)));
  app.get('/api/classes/:id', (req, res) => { const item = classFrom(db, req.params.id); return item ? res.json(details(item)) : error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.'); });
  app.post('/api/classes', (req, res) => {
    if (!semesterFrom(db)) return error(res, 409, 'SEMESTER_REQUIRED', 'Configure o semestre antes de criar disciplinas.');
    const fields = validateClass(req.body);
    if (Object.keys(fields).length) return error(res, 400, 'VALIDATION_ERROR', 'Revise os dados da disciplina.', fields);
    const schedules = normalizedSchedules(req.body);
    const weekdays = [...new Set(schedules.map(item => item.weekday))].sort();
    const result = db.prepare('INSERT INTO classes (name,total_minutes,meeting_minutes,weekdays,start_time) VALUES (?,?,?,?,?)').run(req.body.name.trim(), req.body.totalMinutes, req.body.meetingMinutes, JSON.stringify(weekdays), schedules[0].startTime);
    const insertSchedule = db.prepare('INSERT INTO class_schedules (class_id,weekday,start_time) VALUES (?,?,?)');
    for (const item of schedules) insertSchedule.run(result.lastInsertRowid, item.weekday, item.startTime);
    res.status(201).json(details(classFrom(db, result.lastInsertRowid)));
  });
  app.patch('/api/classes/:id', (req, res) => {
    const current = classFrom(db, req.params.id);
    if (!current) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    const next = { ...current, ...req.body, id: current.id };
    if (!req.body.schedules && (req.body.weekdays || req.body.startTime)) {
      next.schedules = (req.body.weekdays || current.weekdays).map(weekday => ({ weekday, startTime: req.body.startTime || current.startTime }));
    }
    const fields = validateClass(next);
    if (Object.keys(fields).length) return error(res, 400, 'VALIDATION_ERROR', 'Revise os dados da disciplina.', fields);
    const semester = semesterFrom(db);
    const schedules = normalizedSchedules(next);
    const count = Math.floor(next.totalMinutes / next.meetingMinutes);
    const valid = new Set(generateScheduledDatesByCount(semester.startDate, schedules, count));
    const history = [...datesFrom(db, 'absences', current.id), ...datesFrom(db, 'exclusions', current.id)];
    if (history.some(date => !valid.has(date))) return error(res, 409, 'SESSION_CONFLICT', 'A alteração invalidaria uma aula com histórico. Remova o registro antes de editar a disciplina.');
    const weekdays = [...new Set(schedules.map(item => item.weekday))].sort();
    db.prepare('UPDATE classes SET name=?,total_minutes=?,meeting_minutes=?,weekdays=?,start_time=? WHERE id=?').run(next.name.trim(), next.totalMinutes, next.meetingMinutes, JSON.stringify(weekdays), schedules[0].startTime, current.id);
    db.prepare('DELETE FROM class_schedules WHERE class_id=?').run(current.id);
    const insertSchedule = db.prepare('INSERT INTO class_schedules (class_id,weekday,start_time) VALUES (?,?,?)');
    for (const item of schedules) insertSchedule.run(current.id, item.weekday, item.startTime);
    res.json(details(classFrom(db, current.id)));
  });
  app.delete('/api/classes/:id', (req, res) => { const result = db.prepare('DELETE FROM classes WHERE id=?').run(req.params.id); return result.changes ? res.status(204).end() : error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.'); });

  app.post('/api/imports/pdf', upload.single('file'), async (req, res) => {
    if (!req.file) return error(res, 400, 'FILE_REQUIRED', 'Selecione um arquivo PDF.');
    if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) return error(res, 400, 'INVALID_FILE', 'Envie um arquivo no formato PDF.');
    try { res.json(await inspectTimetablePdf(req.file.buffer)); }
    catch (cause) { return error(res, 422, 'PDF_NOT_RECOGNIZED', cause.message || 'Não foi possível interpretar esta grade.'); }
  });

  app.post('/api/classes/import', (req, res) => {
    if (!semesterFrom(db)) return error(res, 409, 'SEMESTER_REQUIRED', 'Configure o semestre antes de importar disciplinas.');
    if (!Array.isArray(req.body.subjects) || !req.body.subjects.length) return error(res, 400, 'VALIDATION_ERROR', 'Selecione ao menos uma disciplina.');
    const invalid = req.body.subjects.map((subject, index) => ({ index, fields: validateClass(subject) })).filter(item => Object.keys(item.fields).length);
    if (invalid.length) return error(res, 400, 'VALIDATION_ERROR', 'Revise os dados das disciplinas antes de importar.', { subjects: invalid });
    const insertClass = db.prepare('INSERT INTO classes (name,total_minutes,meeting_minutes,weekdays,start_time) VALUES (?,?,?,?,?)');
    const insertSchedule = db.prepare('INSERT INTO class_schedules (class_id,weekday,start_time) VALUES (?,?,?)');
    const created = [];
    db.exec('BEGIN');
    try {
      for (const subject of req.body.subjects) {
        const schedules = normalizedSchedules(subject);
        const weekdays = [...new Set(schedules.map(item => item.weekday))].sort();
        const result = insertClass.run(subject.name.trim(), subject.totalMinutes, subject.meetingMinutes, JSON.stringify(weekdays), schedules[0].startTime);
        for (const item of schedules) insertSchedule.run(result.lastInsertRowid, item.weekday, item.startTime);
        created.push(details(classFrom(db, result.lastInsertRowid)));
      }
      db.exec('COMMIT');
      res.status(201).json(created);
    } catch (cause) {
      db.exec('ROLLBACK');
      throw cause;
    }
  });

  app.get('/api/classes/:id/sessions', (req, res) => {
    const subject = classFrom(db, req.params.id); const semester = semesterFrom(db);
    if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    const exclusions = new Map(exclusionRowsFrom(db, subject.id).map(item => [item.date, item])); const absences = new Set(datesFrom(db, 'absences', subject.id));
    const count = Math.floor(subject.totalMinutes / subject.meetingMinutes);
    let dates = generateScheduledDatesByCount(semester.startDate, subject.schedules, count);
    if (req.query.from) { if (!isIsoDate(req.query.from)) return error(res, 400, 'INVALID_RANGE', 'Informe uma data inicial válida.'); dates = dates.filter(date => date >= req.query.from); }
    if (req.query.to) { if (!isIsoDate(req.query.to)) return error(res, 400, 'INVALID_RANGE', 'Informe uma data final válida.'); dates = dates.filter(date => date <= req.query.to); }
    res.json(dates.map(date => ({ date, missed: absences.has(date), excluded: exclusions.has(date) && !exclusions.get(date).reinstated, reinstated: Boolean(exclusions.get(date)?.reinstated) })));
  });

  const ensureScheduled = (subject, date) => { const semester = semesterFrom(db); const count = Math.floor(subject.totalMinutes / subject.meetingMinutes); return isIsoDate(date) && generateScheduledDatesByCount(semester.startDate, subject.schedules, count).includes(date); };
  app.post('/api/classes/:id/absences', (req, res) => {
    const subject = classFrom(db, req.params.id);
    if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    if (!ensureScheduled(subject, req.body.date)) return error(res, 400, 'INVALID_SESSION', 'A data não corresponde a uma aula desta disciplina.', { date: 'Escolha uma aula válida.' });
    if (exclusionRowsFrom(db, subject.id).some(item => item.date === req.body.date && !item.reinstated)) return error(res, 409, 'EXCLUDED_SESSION', 'Esta aula está marcada como cancelada. Marque-a como reposta antes de registrar falta.');
    try { db.prepare('INSERT INTO absences (class_id,date) VALUES (?,?)').run(subject.id, req.body.date); } catch { return error(res, 409, 'DUPLICATE_ABSENCE', 'Esta falta já foi registrada.'); }
    res.status(201).json(details(subject));
  });
  app.delete('/api/classes/:id/absences/:date', (req, res) => { const result = db.prepare('DELETE FROM absences WHERE class_id=? AND date=?').run(req.params.id, req.params.date); return result.changes ? res.status(204).end() : error(res, 404, 'NOT_FOUND', 'Falta não encontrada.'); });
  app.post('/api/classes/:id/exclusions', (req, res) => {
    const subject = classFrom(db, req.params.id);
    if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    if (!ensureScheduled(subject, req.body.date)) return error(res, 400, 'INVALID_SESSION', 'A data não corresponde a uma aula desta disciplina.');
    if (datesFrom(db, 'absences', subject.id).includes(req.body.date)) return error(res, 409, 'ABSENCE_CONFLICT', 'Remova a falta desta data antes de cancelar a aula.');
    const existing = exclusionRowsFrom(db, subject.id).find(item => item.date === req.body.date);
    if (existing && !existing.reinstated) return error(res, 409, 'DUPLICATE_EXCLUSION', 'Esta aula já está cancelada.');
    db.prepare('INSERT INTO exclusions (class_id,date,reinstated) VALUES (?,?,0) ON CONFLICT(class_id,date) DO UPDATE SET reinstated=0').run(subject.id, req.body.date);
    res.status(201).json(details(subject));
  });
  app.patch('/api/classes/:id/exclusions/:date', (req, res) => {
    const subject = classFrom(db, req.params.id);
    if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    const result = db.prepare('UPDATE exclusions SET reinstated=1 WHERE class_id=? AND date=? AND reinstated=0').run(subject.id, req.params.date);
    return result.changes ? res.json(details(subject)) : error(res, 404, 'NOT_FOUND', 'Aula cancelada não encontrada.');
  });
  app.delete('/api/classes/:id/exclusions/:date', (req, res) => { const result = db.prepare('DELETE FROM exclusions WHERE class_id=? AND date=?').run(req.params.id, req.params.date); return result.changes ? res.status(204).end() : error(res, 404, 'NOT_FOUND', 'Cancelamento não encontrado.'); });

  app.use((err, _req, res, _next) => { console.error(err); error(res, 500, 'INTERNAL_ERROR', 'Ocorreu um erro inesperado.'); });
  return app;
}
