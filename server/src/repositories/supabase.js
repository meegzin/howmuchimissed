const mapClass = row => ({
  id: row.id, name: row.name, totalMinutes: row.total_minutes, meetingMinutes: row.meeting_minutes,
  weekdays: row.class_schedules.map(item => item.weekday).sort(), startTime: row.class_schedules[0]?.start_time?.slice(0, 5),
  schedules: row.class_schedules.map(item => ({ weekday: item.weekday, startTime: item.start_time.slice(0, 5) })).sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
});

const unwrap = result => { if (result.error) throw result.error; return result.data; };

export function createSupabaseRepository(client, userId) {
  const classSelect = 'id,name,total_minutes,meeting_minutes,class_schedules(weekday,start_time)';
  const getClass = async id => mapClass(unwrap(await client.from('classes').select(classSelect).eq('user_id', userId).eq('id', id).maybeSingle()));
  return {
    async getSnapshot() {
      const [semesterResult, classesResult, absencesResult, exclusionsResult] = await Promise.all([
        client.from('semesters').select('start_date').eq('user_id', userId).maybeSingle(),
        client.from('classes').select(classSelect).eq('user_id', userId).order('name'),
        client.from('absences').select('class_id,date').eq('user_id', userId).order('date'),
        client.from('exclusions').select('class_id,date,reinstated').eq('user_id', userId).order('date')
      ]);
      const semester = unwrap(semesterResult); const absences = unwrap(absencesResult); const exclusions = unwrap(exclusionsResult);
      return {
        semester: semester ? { startDate: semester.start_date } : null,
        classes: unwrap(classesResult).map(mapClass),
        absencesByClass: Object.groupBy(absences, row => row.class_id),
        exclusionsByClass: Object.groupBy(exclusions, row => row.class_id)
      };
    },
    async getSemester() { const data = unwrap(await client.from('semesters').select('start_date').eq('user_id', userId).maybeSingle()); return data ? { startDate: data.start_date } : null; },
    async setSemester(startDate) { unwrap(await client.from('semesters').upsert({ user_id: userId, start_date: startDate })); return { startDate }; },
    async listClasses() { return unwrap(await client.from('classes').select(classSelect).eq('user_id', userId).order('name')).map(mapClass); },
    async getClass(id) { const data = unwrap(await client.from('classes').select(classSelect).eq('user_id', userId).eq('id', id).maybeSingle()); return data ? mapClass(data) : null; },
    async createClass(subject) { const id = unwrap(await client.rpc('save_class', { p_id: null, p_name: subject.name, p_total_minutes: subject.totalMinutes, p_meeting_minutes: subject.meetingMinutes, p_schedules: subject.schedules })); return getClass(id); },
    async updateClass(id, subject) { const saved = unwrap(await client.rpc('save_class', { p_id: id, p_name: subject.name, p_total_minutes: subject.totalMinutes, p_meeting_minutes: subject.meetingMinutes, p_schedules: subject.schedules })); return getClass(saved); },
    async deleteClass(id) { return (unwrap(await client.from('classes').delete().eq('user_id', userId).eq('id', id).select('id')) || []).length > 0; },
    async importClasses(subjects) { const ids = unwrap(await client.rpc('import_classes', { p_subjects: subjects })); return Promise.all(ids.map(getClass)); },
    async getAbsences(id) { return unwrap(await client.from('absences').select('date').eq('user_id', userId).eq('class_id', id).order('date')).map(row => row.date); },
    async getExclusions(id) { return unwrap(await client.from('exclusions').select('date,reinstated').eq('user_id', userId).eq('class_id', id).order('date')); },
    async addAbsence(id, date) { const { error } = await client.from('absences').insert({ user_id: userId, class_id: id, date }); if (error?.code === '23505') return false; if (error) throw error; return true; },
    async deleteAbsence(id, date) { return (unwrap(await client.from('absences').delete().eq('user_id', userId).eq('class_id', id).eq('date', date).select('date')) || []).length > 0; },
    async cancelSession(id, date) { unwrap(await client.from('exclusions').upsert({ user_id: userId, class_id: id, date, reinstated: false })); },
    async reinstateSession(id, date) { return (unwrap(await client.from('exclusions').update({ reinstated: true }).eq('user_id', userId).eq('class_id', id).eq('date', date).eq('reinstated', false).select('date')) || []).length > 0; },
    async deleteExclusion(id, date) { return (unwrap(await client.from('exclusions').delete().eq('user_id', userId).eq('class_id', id).eq('date', date).select('date')) || []).length > 0; },
    async exportData() {
      const [semester, classes, absences, exclusions] = await Promise.all([
        this.getSemester(), this.listClasses(), client.from('absences').select('class_id,date').eq('user_id', userId).order('date'), client.from('exclusions').select('class_id,date,reinstated').eq('user_id', userId).order('date')
      ]);
      return { semester, classes, absences: unwrap(absences).map(row => ({ classId: row.class_id, date: row.date })), exclusions: unwrap(exclusions).map(row => ({ classId: row.class_id, date: row.date, reinstated: row.reinstated })) };
    }
  };
}
