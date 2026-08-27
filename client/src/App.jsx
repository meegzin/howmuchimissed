import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { formatDate, formatMinutes, statusText, weekdays } from './utils.js';

const emptyClass = { name: '', workloadHours: '', meetingHours: '', weekdays: [], scheduleTimes: {} };
const toPayload = form => ({ name: form.name, totalMinutes: Math.round(Number(form.workloadHours) * 60), meetingMinutes: Math.round(Number(form.meetingHours) * 60), schedules: form.weekdays.map(weekday => ({ weekday, startTime: form.scheduleTimes[weekday] || '08:00' })) });
const fromClass = item => ({ name: item.name, workloadHours: item.totalMinutes / 60, meetingHours: item.meetingMinutes / 60, weekdays: item.schedules.map(value => value.weekday), scheduleTimes: Object.fromEntries(item.schedules.map(value => [value.weekday, value.startTime])) });
const durationBetween = (start, end) => { const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); return eh * 60 + em - sh * 60 - sm; };
const todayIso = () => new Date().toLocaleDateString('sv-SE');
const addIsoDays = (iso, amount) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
const weekStartFor = iso => { const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); return addIsoDays(iso, -(day === 0 ? 6 : day - 1)); };

function Modal({ title, children, onClose }) {
  return <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true"><button className="close" onClick={onClose} aria-label="Fechar">×</button><h2>{title}</h2>{children}</section></div>;
}

function SemesterForm({ semester, onSaved, compact = false }) {
  const [form, setForm] = useState(semester || { startDate: '' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async e => { e.preventDefault(); setBusy(true); setError(null); try { onSaved(await api('/api/semester', { method: 'PUT', body: JSON.stringify(form) })); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <form onSubmit={submit} className="start-form"><label>Início do semestre<input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}/><small>{error?.fields?.startDate}</small></label>{error && <p className="form-error">{error.message}</p>}<button disabled={busy}>{busy ? 'Salvando…' : compact ? 'Salvar início' : 'Começar planejamento'}</button></form>;
}

function ClassForm({ initial = emptyClass, onSave, onCancel }) {
  const [form, setForm] = useState(initial); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const toggle = day => setForm({ ...form, weekdays: form.weekdays.includes(day) ? form.weekdays.filter(v => v !== day) : [...form.weekdays, day], scheduleTimes: { ...form.scheduleTimes, [day]: form.scheduleTimes[day] || '08:00' } });
  const submit = async e => { e.preventDefault(); setError(null); setBusy(true); try { await onSave(toPayload(form)); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <form onSubmit={submit} className="class-form"><label>Nome da disciplina<input autoFocus value={form.name} placeholder="Ex.: Cálculo II" onChange={e => setForm({ ...form, name: e.target.value })}/><small>{error?.fields?.name}</small></label><div className="form-grid"><label>Carga horária total (horas-aula)<input type="number" min="0.01" step="0.01" value={form.workloadHours} onChange={e => setForm({ ...form, workloadHours: e.target.value })}/><small>{error?.fields?.totalMinutes}</small></label><label>Duração de cada encontro (horas-aula)<input type="number" min="0.01" step="0.01" value={form.meetingHours} onChange={e => setForm({ ...form, meetingHours: e.target.value })}/><small>{error?.fields?.meetingMinutes}</small></label></div><fieldset><legend>Dias de aula</legend><div className="day-picker">{weekdays.map(day => <button type="button" className={form.weekdays.includes(day.value) ? 'selected' : ''} onClick={() => toggle(day.value)} key={day.value}>{day.short}</button>)}</div><small>{error?.fields?.weekdays}</small></fieldset>{form.weekdays.length > 0 && <div className="schedule-times">{[...form.weekdays].sort((a,b) => a-b).map(value => <label key={value}>{weekdays.find(day => day.value === value)?.label}<input type="time" value={form.scheduleTimes[value] || '08:00'} onChange={e => setForm({ ...form, scheduleTimes: { ...form.scheduleTimes, [value]: e.target.value } })}/></label>)}</div>}<small>{error?.fields?.startTime}</small>{error && <p className="form-error">{error.message}</p>}<div className="actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button disabled={busy}>{busy ? 'Salvando…' : 'Salvar disciplina'}</button></div></form>;
}

function Sessions({ subject, onChanged }) {
  const [sessions, setSessions] = useState([]); const [error, setError] = useState('');
  useEffect(() => { api(`/api/classes/${subject.id}/sessions`).then(setSessions).catch(e => setError(e.message)); }, [subject.id]);
  const act = async (session, kind) => {
    setError('');
    if (kind === 'absence' && !session.missed) {
      if (subject.absenceCount + 1 > subject.maxAbsences && !confirm('Esta falta ultrapassará o limite de 25%. Deseja registrá-la mesmo assim?')) return;
    }
    const segment = kind === 'absence' ? 'absences' : 'exclusions';
    const method = kind === 'absence' ? (session.missed ? 'DELETE' : 'POST') : (session.excluded ? 'PATCH' : 'POST');
    const withDateInPath = method === 'DELETE' || method === 'PATCH';
    try {
      const updated = await api(`/api/classes/${subject.id}/${segment}${withDateInPath ? `/${session.date}` : ''}`, { method, ...(!withDateInPath && { body: JSON.stringify({ date: session.date }) }) });
      onChanged(updated);
      setSessions(current => current.map(item => item.date !== session.date ? item : kind === 'absence' ? { ...item, missed: !session.missed } : session.excluded ? { ...item, excluded: false, reinstated: true } : { ...item, excluded: true, reinstated: false }));
    } catch (e) { setError(e.message); }
  };
  return <div className="sessions"><div className="session-legend"><span><i className="dot missed"/> Falta</span><span><i className="dot excluded"/> Aula cancelada</span><span><i className="dot reinstated"/> Reposta</span></div>{error && <p className="form-error">{error}</p>}<div className="session-list">{sessions.map(s => <article className={`session ${s.missed ? 'is-missed' : ''} ${s.excluded ? 'is-excluded' : ''} ${s.reinstated ? 'is-reinstated' : ''}`} key={s.date}><div><strong>{formatDate(s.date)}</strong><small>{subject.schedules.find(item => item.weekday === new Date(`${s.date}T00:00:00Z`).getUTCDay())?.startTime}{s.excluded ? ' · Cancelada' : s.reinstated ? ' · Reposta' : ''}</small></div><div className="session-actions"><button disabled={s.excluded} className={s.missed ? 'danger' : 'secondary'} onClick={() => act(s, 'absence')}>{s.missed ? 'Desfazer falta' : 'Registrar falta'}</button><button disabled={s.missed} className="text-button" onClick={() => act(s, 'exclusion')}>{s.excluded ? 'Marcar como reposta' : s.reinstated ? 'Cancelar novamente' : 'Cancelar aula'}</button></div></article>)}</div></div>;
}

function WeekTimeline({ refreshToken, onChanged }) {
  const today = todayIso();
  const [weekStart, setWeekStart] = useState(weekStartFor(today)); const [sessions, setSessions] = useState([]); const [selectedDate, setSelectedDate] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const dates = Array.from({ length: 7 }, (_, index) => addIsoDays(weekStart, index));
  const loadWeek = useCallback(async () => { setLoading(true); setError(''); try { setSessions(await api(`/api/sessions?from=${weekStart}&to=${addIsoDays(weekStart, 6)}`)); } catch (cause) { setError(cause.message); } finally { setLoading(false); } }, [weekStart]);
  useEffect(() => { loadWeek(); }, [loadWeek, refreshToken]);
  const selectedSessions = sessions.filter(item => item.date === selectedDate);
  const act = async session => {
    if (!session.missed && session.absenceCount + 1 > session.maxAbsences && !confirm('Esta falta ultrapassará o limite de 25%. Deseja registrá-la mesmo assim?')) return;
    try {
      const updated = await api(`/api/classes/${session.classId}/absences${session.missed ? `/${session.date}` : ''}`, { method: session.missed ? 'DELETE' : 'POST', ...(!session.missed && { body: JSON.stringify({ date: session.date }) }) });
      onChanged(updated);
      setSessions(current => current.map(item => item.classId === session.classId && item.date === session.date ? { ...item, missed: !session.missed, absenceCount: updated.absenceCount, maxAbsences: updated.maxAbsences, status: updated.status } : item));
    } catch (cause) { setError(cause.message); }
  };
  const moveWeek = amount => { setSelectedDate(null); setWeekStart(addIsoDays(weekStart, amount * 7)); };
  return <section className="timeline-section"><div className="timeline-heading"><div><p className="eyebrow">Sua semana</p><h2>{formatDate(weekStart)} — {formatDate(addIsoDays(weekStart, 6))}</h2></div><div className="timeline-nav"><button className="icon-button" onClick={() => moveWeek(-1)} aria-label="Semana anterior">←</button><button className="today-button" onClick={() => { setSelectedDate(null); setWeekStart(weekStartFor(today)); }}>Hoje</button><button className="icon-button" onClick={() => moveWeek(1)} aria-label="Próxima semana">→</button></div></div>{error && <p className="form-error">{error}</p>}<div className={`timeline ${loading ? 'is-loading' : ''}`}>{dates.map(date => { const daySessions = sessions.filter(item => item.date === date); const dateValue = new Date(`${date}T00:00:00Z`); return <button className={`timeline-day ${date === today ? 'is-today' : ''} ${daySessions.length ? 'has-classes' : ''}`} key={date} onClick={() => setSelectedDate(date)}><span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(dateValue).replace('.', '')}</span><strong>{dateValue.getUTCDate()}</strong><small>{daySessions.length ? `${daySessions.length} ${daySessions.length === 1 ? 'aula' : 'aulas'}` : 'Livre'}</small></button>; })}</div>{selectedDate && <Modal title={formatDate(selectedDate)} onClose={() => setSelectedDate(null)}>{selectedSessions.length ? <div className="daily-classes">{selectedSessions.map(session => <article className={`daily-class ${session.excluded ? 'is-cancelled' : ''}`} key={`${session.classId}-${session.date}`}><div className="daily-time"><strong>{session.startTime}</strong><span>{formatMinutes(session.meetingMinutes)}</span></div><div className="daily-info"><h3>{session.name}</h3><p>{session.excluded ? 'Aula cancelada' : session.reinstated ? 'Aula reposta' : session.missed ? 'Falta registrada' : 'Aula programada'}</p></div><button disabled={session.excluded} className={session.missed ? 'danger' : 'secondary'} onClick={() => act(session)}>{session.missed ? 'Desfazer falta' : 'Registrar falta'}</button></article>)}</div> : <div className="daily-empty"><span>☼</span><h3>Nenhuma aula neste dia</h3><p>Aproveite o dia livre.</p></div>}</Modal>}</section>;
}

function ImportPdf({ existingClasses, onImported, onCancel }) {
  const [stage, setStage] = useState('upload'); const [result, setResult] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const inspect = async file => {
    if (!file) return;
    setError(''); setBusy(true); setStage('reading');
    const body = new FormData(); body.append('file', file);
    try {
      let data;
      try {
        data = await api('/api/imports/pdf', { method: 'POST', body });
      } catch (cause) {
        if (!['EMPTY_RESPONSE', 'INVALID_RESPONSE'].includes(cause.code)) throw cause;
        data = await api('/api/imports/pdf', { method: 'POST', body });
      }
      const existing = new Set(existingClasses.map(item => item.name.toLocaleLowerCase('pt-BR')));
      setResult({ ...data, subjects: data.subjects.map(item => ({ ...item, selected: !existing.has(item.name.toLocaleLowerCase('pt-BR')), totalHours: item.totalMinutes / 60, alreadyExists: existing.has(item.name.toLocaleLowerCase('pt-BR')) })) });
      setStage('review');
    } catch (cause) { setError(cause.message); setStage('upload'); } finally { setBusy(false); }
  };
  const changeSubject = (index, change) => setResult({ ...result, subjects: result.subjects.map((item, current) => current === index ? { ...item, ...change } : item) });
  const changeSchedule = (subjectIndex, scheduleIndex, change) => changeSubject(subjectIndex, { schedules: result.subjects[subjectIndex].schedules.map((item, current) => current === scheduleIndex ? { ...item, ...change } : item) });
  const submit = async () => {
    const selected = result.subjects.filter(item => item.selected);
    if (!selected.length) return setError('Selecione ao menos uma disciplina para importar.');
    setBusy(true); setError('');
    try {
      await api('/api/classes/import', { method: 'POST', body: JSON.stringify({ subjects: selected.map(item => ({ name: item.name, totalMinutes: Math.round(Number(item.totalHours) * 60), meetingMinutes: durationBetween(item.schedules[0].startTime, item.schedules[0].endTime), schedules: item.schedules.map(({ weekday, startTime }) => ({ weekday, startTime })) })) }) });
      await onImported(selected.length);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };
  if (stage !== 'review') return <div className="pdf-upload"><div className={`dropzone ${busy ? 'is-reading' : ''}`}><span className="pdf-icon">PDF</span><h3>{busy ? 'Lendo sua grade…' : 'Selecione a grade semanal'}</h3><p>{busy ? 'Identificando dias, horários e disciplinas. Isso pode levar alguns segundos.' : 'Use o PDF exportado pelo aSc TimeTables. Limite de 10 MB.'}</p>{!busy && <label className="file-button">Escolher PDF<input type="file" accept="application/pdf,.pdf" onChange={event => inspect(event.target.files?.[0])}/></label>}</div>{error && <p className="form-error">{error}</p>}<div className="actions"><button className="secondary" onClick={onCancel}>Cancelar</button></div></div>;
  return <div className="import-review"><div className="import-summary"><div><span>GRADE IDENTIFICADA</span><strong>{result.sourceName}</strong></div><div><strong>{result.subjects.length}</strong><span>disciplinas encontradas</span></div></div><p className="review-help">Revise os dados antes de importar. A carga sugerida é de 40h por encontro semanal.</p>{error && <p className="form-error">{error}</p>}<div className="import-subjects">{result.subjects.map((subject, index) => <article className={`import-subject ${!subject.selected ? 'not-selected' : ''}`} key={`${subject.name}-${index}`}><label className="subject-check"><input type="checkbox" checked={subject.selected} onChange={event => changeSubject(index, { selected: event.target.checked })}/><span/></label><div className="import-fields"><label>Disciplina<input value={subject.name} onChange={event => changeSubject(index, { name: event.target.value })}/></label><div className="import-meta">{subject.teacher} · {subject.location}{subject.alreadyExists && <em>Já cadastrada</em>}</div><div className="import-schedules">{subject.schedules.map((schedule, scheduleIndex) => <div key={`${schedule.weekday}-${scheduleIndex}`}><strong>{weekdays.find(day => day.value === schedule.weekday)?.label}</strong><input type="time" value={schedule.startTime} onChange={event => changeSchedule(index, scheduleIndex, { startTime: event.target.value })}/><span>até</span><input type="time" value={schedule.endTime} onChange={event => changeSchedule(index, scheduleIndex, { endTime: event.target.value })}/></div>)}</div></div><label className="hours-field">Carga total<input type="number" min="1" step="1" value={subject.totalHours} onChange={event => changeSubject(index, { totalHours: event.target.value })}/><span>horas-aula</span></label></article>)}</div><div className="actions sticky-actions"><button className="secondary" onClick={onCancel}>Cancelar</button><button disabled={busy} onClick={submit}>{busy ? 'Importando…' : `Importar ${result.subjects.filter(item => item.selected).length} disciplinas`}</button></div></div>;
}

const absencePercent = subject => subject.maxAbsences === 0 ? 100 : Math.min(100, subject.absenceCount * 100 / subject.maxAbsences);

function ClassCard({ subject, reload, onEdit, onOpen }) {
  const percent = absencePercent(subject);
  const remove = async event => { event.stopPropagation(); if (confirm(`Excluir ${subject.name}? Todas as faltas e aulas canceladas também serão removidas.`)) { await api(`/api/classes/${subject.id}`, { method: 'DELETE' }); reload(); } };
  const edit = event => { event.stopPropagation(); onEdit(subject); };
  return <article className={`class-card compact-card status-${subject.status}`} role="button" tabIndex="0" onClick={() => onOpen(subject)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) onOpen(subject); }}><header><div><span className="status">{statusText[subject.status]}</span><h2>{subject.name}</h2><p>{subject.schedules.map(item => `${weekdays.find(day => day.value === item.weekday)?.short} ${item.startTime}`).join(' · ')}</p></div><div className="menu"><button className="icon-button" onClick={edit} aria-label="Editar">✎</button><button className="icon-button danger-text" onClick={remove} aria-label="Excluir">⌫</button></div></header><div className="compact-summary"><div><strong>{subject.remainingMeetings}</strong><span>aulas que ainda pode faltar</span></div><div><strong>{subject.absenceCount}/{subject.maxAbsences}</strong><span>faltas usadas</span></div></div><div className="progress-copy"><span>Uso do limite</span><strong>{Math.round(percent)}%</strong></div><div className="progress"><i style={{ width: `${percent}%` }}/></div><span className="card-cta">Ver detalhes e aulas →</span></article>;
}

function ClassDetails({ subject, onChanged }) {
  const percent = absencePercent(subject);
  return <div className={`class-details status-${subject.status}`}><div className="detail-heading"><div><span className="status">{statusText[subject.status]}</span><p>{subject.schedules.map(item => `${weekdays.find(day => day.value === item.weekday)?.label} às ${item.startTime}`).join(' · ')}</p></div><strong>{subject.totalMeetings} aulas no total</strong></div><div className="metrics"><div><strong>{subject.remainingMeetings}</strong><span>encontros que ainda pode faltar</span></div><div><strong>{formatMinutes(subject.remainingMinutes)}</strong><span>margem disponível</span></div><div><strong>{subject.absenceCount}</strong><span>faltas registradas</span></div></div><div className="progress-copy"><span>Uso do limite de 25%</span><strong>{Math.round(percent)}%</strong></div><div className="progress"><i style={{ width: `${percent}%` }}/></div><Sessions subject={subject} onChanged={onChanged}/></div>;
}

export default function App() {
  const [semester, setSemester] = useState(undefined); const [classes, setClasses] = useState([]); const [modal, setModal] = useState(null); const [notice, setNotice] = useState('');
  const load = async () => { const [s, c] = await Promise.all([api('/api/semester'), api('/api/classes')]); setSemester(s); setClasses(c); };
  const applyClass = updated => setClasses(current => current.map(item => item.id === updated.id ? updated : item));
  useEffect(() => { load().catch(() => setNotice('Não foi possível conectar à API.')); }, []);
  const saveClass = async payload => { const editing = modal?.item; await api(editing ? `/api/classes/${editing.id}` : '/api/classes', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); setModal(null); await load(); };
  if (semester === undefined) return <main className="loading">Carregando planejamento…</main>;
  if (!semester) return <main className="setup"><div className="brand"><span>25</span><i>%</i></div><section><p className="eyebrow">Planejador acadêmico</p><h1>Falte com consciência.<br/>Planeje com clareza.</h1><p className="lead">Informe quando as aulas começam. A quantidade e as datas serão calculadas automaticamente pela grade.</p><SemesterForm onSaved={s => { setSemester(s); load(); }}/><p className="fine-print">Não é necessário informar uma data final de semestre.</p></section></main>;
  const timelineToken = classes.map(item => `${item.id}:${item.name}:${JSON.stringify(item.schedules)}:${item.exclusions.join(',')}:${item.reinstated.join(',')}`).join('|');
  return <><header className="topbar"><div className="wordmark"><b>25%</b><span>Planejador<br/>de Faltas</span></div><div><span className="semester-label">INÍCIO DAS AULAS</span><button className="semester-button" onClick={() => setModal({ type: 'semester' })}>{formatDate(semester.startDate)} ✎</button></div></header><main className="dashboard"><WeekTimeline refreshToken={timelineToken} onChanged={applyClass}/><section className="hero"><div><p className="eyebrow">Visão geral</p><h1>Suas disciplinas</h1><p>Selecione uma matéria para consultar todas as aulas.</p></div><div className="hero-actions"><button className="import-button" onClick={() => setModal({ type: 'import' })}>⇧ Importar PDF</button><button className="add" onClick={() => setModal({ type: 'class' })}>＋ Nova disciplina</button></div></section>{notice && <p className="form-error">{notice}</p>}{classes.length ? <div className="cards">{classes.map(item => <ClassCard key={item.id} subject={item} reload={load} onOpen={subject => setModal({ type: 'details', id: subject.id })} onEdit={subject => setModal({ type: 'class', item: subject })}/>)}</div> : <section className="empty"><div>＋</div><h2>Nenhuma disciplina ainda</h2><p>Importe sua grade do aSc TimeTables ou cadastre a primeira matéria manualmente.</p><div className="empty-actions"><button className="import-button" onClick={() => setModal({ type: 'import' })}>Importar grade em PDF</button><button onClick={() => setModal({ type: 'class' })}>Adicionar manualmente</button></div></section>}<footer>Este planejador é uma ferramenta de apoio. Confirme sempre as regras de frequência e a unidade de horas-aula da sua instituição.</footer></main>{modal?.type === 'semester' && <Modal title="Editar início das aulas" onClose={() => setModal(null)}><SemesterForm compact semester={semester} onSaved={() => { setModal(null); load(); }}/></Modal>}{modal?.type === 'class' && <Modal title={modal.item ? 'Editar disciplina' : 'Nova disciplina'} onClose={() => setModal(null)}><ClassForm initial={modal.item ? fromClass(modal.item) : emptyClass} onSave={saveClass} onCancel={() => setModal(null)}/></Modal>}{modal?.type === 'details' && classes.find(item => item.id === modal.id) && <Modal title={classes.find(item => item.id === modal.id).name} onClose={() => setModal(null)}><ClassDetails subject={classes.find(item => item.id === modal.id)} onChanged={applyClass}/></Modal>}{modal?.type === 'import' && <Modal title="Importar grade do aSc" onClose={() => setModal(null)}><ImportPdf existingClasses={classes} onCancel={() => setModal(null)} onImported={async count => { setModal(null); setNotice(`${count} ${count === 1 ? 'disciplina importada' : 'disciplinas importadas'} com sucesso.`); await load(); }}/></Modal>}</>;
}
