import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { calculateSummary, generateScheduledDatesByCount, isIsoDate } from './domain.js';
import { inspectTimetablePdf } from './pdf-import.js';

const error = (res, status, code, message, fields) => res.status(status).json({ code, message, ...(fields && { fields }) });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
function validateSemester(body) { const fields = {}; if (!isIsoDate(body.startDate)) fields.startDate = 'Informe uma data inicial válida.'; return fields; }
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
const normalizedSchedules = body => body.schedules || body.weekdays.map(weekday => ({ weekday, startTime: body.startTime }));
const normalizedClass = body => ({ name: body.name.trim(), totalMinutes: body.totalMinutes, meetingMinutes: body.meetingMinutes, schedules: normalizedSchedules(body) });

export function createApp({ repositoryFor, authenticate, accountAdmin, allowedOrigins = [], localMode = false }) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  let ocrBusy = false;
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin(origin, callback) { callback(null, !origin || localMode || allowedOrigins.includes(origin)); } }));
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.setHeader('X-Request-Id', req.requestId); next(); });
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/health', asyncRoute(async (_req, res) => { if (accountAdmin?.health) await accountAdmin.health(); res.json({ status: 'ok' }); }));
  app.use('/api', asyncRoute(async (req, res, next) => {
    const header = req.get('authorization') || ''; const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const auth = await authenticate(token);
    if (!auth) return error(res, 401, 'AUTH_REQUIRED', 'Entre na sua conta para continuar.');
    req.auth = { ...auth, token }; req.repository = repositoryFor(token, auth.user);
    if (auth.user.app_metadata?.must_change_password && req.path !== '/account/password-changed') return error(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'Troque a senha temporária antes de continuar.');
    next();
  }));

  const detailsFrom = (snapshot, subject) => {
    const semester = snapshot.semester;
    const exclusionRows = snapshot.exclusionsByClass[String(subject.id)] || [];
    const absences = (snapshot.absencesByClass[String(subject.id)] || []).map(item => item.date);
    const exclusions = exclusionRows.filter(item => !item.reinstated).map(item => item.date);
    const reinstated = exclusionRows.filter(item => item.reinstated).map(item => item.date);
    const totalMeetings = Math.floor(subject.totalMinutes / subject.meetingMinutes);
    const dates = semester ? generateScheduledDatesByCount(semester.startDate, subject.schedules, totalMeetings) : [];
    return { ...subject, exclusions, reinstated, absences, sessionCount: dates.length, ...calculateSummary({ totalMinutes: subject.totalMinutes, meetingMinutes: subject.meetingMinutes, absenceCount: absences.length }) };
  };
  const details = async (repository, subject) => detailsFrom(await repository.getSnapshot(), subject);

  app.post('/api/account/password-changed', asyncRoute(async (req, res) => { await accountAdmin?.markPasswordChanged(req.auth.user.id); res.status(204).end(); }));
  app.get('/api/account/export', asyncRoute(async (req, res) => res.json({ schemaVersion: 1, exportedAt: new Date().toISOString(), account: { id: req.auth.user.id, email: req.auth.user.email }, ...(await req.repository.exportData()) })));
  app.delete('/api/account', asyncRoute(async (req, res) => {
    if (req.body?.confirmation !== 'EXCLUIR') return error(res, 400, 'CONFIRMATION_REQUIRED', 'Digite EXCLUIR para confirmar.');
    if (!req.auth.issuedAt || Date.now() / 1000 - req.auth.issuedAt > 300) return error(res, 403, 'RECENT_LOGIN_REQUIRED', 'Entre novamente antes de excluir a conta.');
    if (!accountAdmin?.deleteUser) return error(res, 501, 'NOT_AVAILABLE', 'Exclusão de conta indisponível neste ambiente.');
    if (accountAdmin.verifyUser && !await accountAdmin.verifyUser(req.auth.token)) return error(res, 401, 'AUTH_REQUIRED', 'Entre novamente antes de excluir a conta.');
    await accountAdmin.deleteUser(req.auth.user.id); res.status(204).end();
  }));

  app.get('/api/semester', asyncRoute(async (req, res) => res.json(await req.repository.getSemester())));
  app.put('/api/semester', asyncRoute(async (req, res) => {
    const fields = validateSemester(req.body); if (Object.keys(fields).length) return error(res, 400, 'VALIDATION_ERROR', 'Revise as datas do semestre.', fields);
    for (const subject of await req.repository.listClasses()) {
      const valid = new Set(generateScheduledDatesByCount(req.body.startDate, subject.schedules, Math.floor(subject.totalMinutes / subject.meetingMinutes)));
      const history = [...await req.repository.getAbsences(subject.id), ...(await req.repository.getExclusions(subject.id)).map(item => item.date)];
      if (history.some(date => !valid.has(date))) return error(res, 409, 'SESSION_CONFLICT', 'A alteração invalidaria uma aula com histórico. Remova o registro antes de alterar o início.');
    }
    res.json(await req.repository.setSemester(req.body.startDate));
  }));
  app.get('/api/sessions', asyncRoute(async (req, res) => {
    const { from, to } = req.query; if (!isIsoDate(from) || !isIsoDate(to) || from > to) return error(res, 400, 'INVALID_RANGE', 'Informe um intervalo de datas válido.');
    const snapshot = await req.repository.getSnapshot(); const semester = snapshot.semester; if (!semester) return res.json([]); const sessions = [];
    for (const subject of snapshot.classes) {
      const summary = detailsFrom(snapshot, subject); const exclusions = new Map((snapshot.exclusionsByClass[String(subject.id)] || []).map(item => [item.date, item])); const absences = new Set(summary.absences);
      for (const date of generateScheduledDatesByCount(semester.startDate, subject.schedules, summary.totalMeetings).filter(date => date >= from && date <= to)) {
        const exclusion = exclusions.get(date); const schedule = subject.schedules.find(item => item.weekday === new Date(`${date}T00:00:00Z`).getUTCDay());
        sessions.push({ date, classId: subject.id, name: subject.name, startTime: schedule?.startTime, meetingMinutes: subject.meetingMinutes, missed: absences.has(date), excluded: Boolean(exclusion && !exclusion.reinstated), reinstated: Boolean(exclusion?.reinstated), absenceCount: summary.absenceCount, maxAbsences: summary.maxAbsences, status: summary.status });
      }
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name)); res.json(sessions);
  }));
  app.get('/api/classes', asyncRoute(async (req, res) => { const snapshot = await req.repository.getSnapshot(); res.json(snapshot.classes.map(subject => detailsFrom(snapshot, subject))); }));
  app.get('/api/classes/:id', asyncRoute(async (req, res) => { const item = await req.repository.getClass(req.params.id); return item ? res.json(await details(req.repository, item)) : error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.'); }));
  app.post('/api/classes', asyncRoute(async (req, res) => {
    if (!await req.repository.getSemester()) return error(res, 409, 'SEMESTER_REQUIRED', 'Configure o semestre antes de criar disciplinas.');
    const fields = validateClass(req.body); if (Object.keys(fields).length) return error(res, 400, 'VALIDATION_ERROR', 'Revise os dados da disciplina.', fields);
    res.status(201).json(await details(req.repository, await req.repository.createClass(normalizedClass(req.body))));
  }));
  app.patch('/api/classes/:id', asyncRoute(async (req, res) => {
    const current = await req.repository.getClass(req.params.id); if (!current) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.'); const next = { ...current, ...req.body, id: current.id };
    if (!req.body.schedules && (req.body.weekdays || req.body.startTime)) next.schedules = (req.body.weekdays || current.weekdays).map(weekday => ({ weekday, startTime: req.body.startTime || current.startTime }));
    const fields = validateClass(next); if (Object.keys(fields).length) return error(res, 400, 'VALIDATION_ERROR', 'Revise os dados da disciplina.', fields);
    const semester = await req.repository.getSemester(); const schedules = normalizedSchedules(next); const valid = new Set(generateScheduledDatesByCount(semester.startDate, schedules, Math.floor(next.totalMinutes / next.meetingMinutes)));
    const history = [...await req.repository.getAbsences(current.id), ...(await req.repository.getExclusions(current.id)).map(item => item.date)];
    if (history.some(date => !valid.has(date))) return error(res, 409, 'SESSION_CONFLICT', 'A alteração invalidaria uma aula com histórico. Remova o registro antes de editar a disciplina.');
    res.json(await details(req.repository, await req.repository.updateClass(current.id, normalizedClass(next))));
  }));
  app.delete('/api/classes/:id', asyncRoute(async (req, res) => await req.repository.deleteClass(req.params.id) ? res.status(204).end() : error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.')));

  const ocrLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, keyGenerator: req => req.auth.user.id, standardHeaders: 'draft-8', legacyHeaders: false });
  app.post('/api/imports/pdf', ocrLimit, upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) return error(res, 400, 'FILE_REQUIRED', 'Selecione um arquivo PDF.');
    if (!req.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return error(res, 400, 'INVALID_FILE', 'Envie um arquivo PDF válido.');
    if (ocrBusy) { res.setHeader('Retry-After', '30'); return error(res, 429, 'OCR_BUSY', 'Outro PDF está sendo processado. Tente novamente em instantes.'); }
    ocrBusy = true; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 90_000);
    try { res.json(await inspectTimetablePdf(req.file.buffer, { signal: controller.signal })); }
    catch (cause) { return error(res, cause.name === 'AbortError' ? 408 : 422, cause.name === 'AbortError' ? 'OCR_TIMEOUT' : 'PDF_NOT_RECOGNIZED', cause.name === 'AbortError' ? 'O processamento excedeu 90 segundos.' : cause.message || 'Não foi possível interpretar esta grade.'); }
    finally { clearTimeout(timeout); ocrBusy = false; }
  }));
  app.post('/api/classes/import', asyncRoute(async (req, res) => {
    if (!await req.repository.getSemester()) return error(res, 409, 'SEMESTER_REQUIRED', 'Configure o semestre antes de importar disciplinas.');
    if (!Array.isArray(req.body.subjects) || !req.body.subjects.length) return error(res, 400, 'VALIDATION_ERROR', 'Selecione ao menos uma disciplina.');
    const invalid = req.body.subjects.map((subject, index) => ({ index, fields: validateClass(subject) })).filter(item => Object.keys(item.fields).length);
    if (invalid.length) return error(res, 400, 'VALIDATION_ERROR', 'Revise os dados das disciplinas antes de importar.', { subjects: invalid });
    const created = await req.repository.importClasses(req.body.subjects.map(normalizedClass)); const snapshot = await req.repository.getSnapshot(); res.status(201).json(created.map(item => detailsFrom(snapshot, item)));
  }));

  app.get('/api/classes/:id/sessions', asyncRoute(async (req, res) => {
    const subject = await req.repository.getClass(req.params.id); const semester = await req.repository.getSemester(); if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    const exclusions = new Map((await req.repository.getExclusions(subject.id)).map(item => [item.date, item])); const absences = new Set(await req.repository.getAbsences(subject.id));
    let dates = generateScheduledDatesByCount(semester.startDate, subject.schedules, Math.floor(subject.totalMinutes / subject.meetingMinutes));
    if (req.query.from) { if (!isIsoDate(req.query.from)) return error(res, 400, 'INVALID_RANGE', 'Informe uma data inicial válida.'); dates = dates.filter(date => date >= req.query.from); }
    if (req.query.to) { if (!isIsoDate(req.query.to)) return error(res, 400, 'INVALID_RANGE', 'Informe uma data final válida.'); dates = dates.filter(date => date <= req.query.to); }
    res.json(dates.map(date => ({ date, missed: absences.has(date), excluded: exclusions.has(date) && !exclusions.get(date).reinstated, reinstated: Boolean(exclusions.get(date)?.reinstated) })));
  }));
  const ensureScheduled = async (repository, subject, date) => { const semester = await repository.getSemester(); return Boolean(semester && isIsoDate(date) && generateScheduledDatesByCount(semester.startDate, subject.schedules, Math.floor(subject.totalMinutes / subject.meetingMinutes)).includes(date)); };
  app.post('/api/classes/:id/absences', asyncRoute(async (req, res) => {
    const subject = await req.repository.getClass(req.params.id); if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    if (!await ensureScheduled(req.repository, subject, req.body.date)) return error(res, 400, 'INVALID_SESSION', 'A data não corresponde a uma aula desta disciplina.', { date: 'Escolha uma aula válida.' });
    if ((await req.repository.getExclusions(subject.id)).some(item => item.date === req.body.date && !item.reinstated)) return error(res, 409, 'EXCLUDED_SESSION', 'Esta aula está marcada como cancelada. Marque-a como reposta antes de registrar falta.');
    if (!await req.repository.addAbsence(subject.id, req.body.date)) return error(res, 409, 'DUPLICATE_ABSENCE', 'Esta falta já foi registrada.'); res.status(201).json(await details(req.repository, subject));
  }));
  app.delete('/api/classes/:id/absences/:date', asyncRoute(async (req, res) => {
    const subject = await req.repository.getClass(req.params.id); if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    if (!await req.repository.deleteAbsence(subject.id, req.params.date)) return error(res, 404, 'NOT_FOUND', 'Falta não encontrada.');
    res.json(await details(req.repository, subject));
  }));
  app.post('/api/classes/:id/exclusions', asyncRoute(async (req, res) => {
    const subject = await req.repository.getClass(req.params.id); if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    if (!await ensureScheduled(req.repository, subject, req.body.date)) return error(res, 400, 'INVALID_SESSION', 'A data não corresponde a uma aula desta disciplina.');
    if ((await req.repository.getAbsences(subject.id)).includes(req.body.date)) return error(res, 409, 'ABSENCE_CONFLICT', 'Remova a falta desta data antes de cancelar a aula.');
    await req.repository.cancelSession(subject.id, req.body.date); res.status(201).json(await details(req.repository, subject));
  }));
  app.patch('/api/classes/:id/exclusions/:date', asyncRoute(async (req, res) => {
    const subject = await req.repository.getClass(req.params.id); if (!subject) return error(res, 404, 'NOT_FOUND', 'Disciplina não encontrada.');
    if (!await req.repository.reinstateSession(subject.id, req.params.date)) return error(res, 404, 'NOT_FOUND', 'Cancelamento não encontrado.'); res.json(await details(req.repository, subject));
  }));
  app.delete('/api/classes/:id/exclusions/:date', asyncRoute(async (req, res) => await req.repository.deleteExclusion(req.params.id, req.params.date) ? res.status(204).end() : error(res, 404, 'NOT_FOUND', 'Cancelamento não encontrado.')));
  app.use((err, req, res, _next) => {
    const status = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
    console.error(JSON.stringify({ requestId: req.requestId, method: req.method, path: req.path, status, error: err.code || err.name || 'Error' }));
    error(res, status, status === 413 ? 'FILE_TOO_LARGE' : 'INTERNAL_ERROR', status === 413 ? 'O PDF deve ter no máximo 10 MB.' : 'Ocorreu um erro inesperado.');
  });
  return app;
}
