const rowToClass = row => row && ({
  id: String(row.id),
  name: row.name,
  totalMinutes: row.total_minutes,
  meetingMinutes: row.meeting_minutes,
  weekdays: JSON.parse(row.weekdays),
  startTime: row.start_time
});

export function createSqliteRepository(db) {
  const schedules = id => db.prepare('SELECT weekday, start_time AS startTime FROM class_schedules WHERE class_id = ? ORDER BY weekday, start_time').all(id);
  const hydrate = row => row && ({ ...rowToClass(row), schedules: schedules(row.id) });
  const getClass = id => hydrate(db.prepare('SELECT * FROM classes WHERE id = ?').get(id));
  const dates = (table, id) => db.prepare(`SELECT date FROM ${table} WHERE class_id = ? ORDER BY date`).all(id).map(row => row.date);
  const exclusions = id => db.prepare('SELECT date, reinstated FROM exclusions WHERE class_id = ? ORDER BY date').all(id).map(row => ({ date: row.date, reinstated: Boolean(row.reinstated) }));

  return {
    async getSnapshot() {
      const classes = db.prepare('SELECT * FROM classes ORDER BY name').all().map(hydrate);
      const absenceRows = db.prepare('SELECT CAST(class_id AS TEXT) classId,date FROM absences ORDER BY class_id,date').all();
      const exclusionRows = db.prepare('SELECT CAST(class_id AS TEXT) classId,date,reinstated FROM exclusions ORDER BY class_id,date').all();
      return {
        semester: db.prepare('SELECT start_date AS startDate FROM semester WHERE id = 1').get() || null,
        classes,
        absencesByClass: Object.groupBy(absenceRows, row => row.classId),
        exclusionsByClass: Object.groupBy(exclusionRows.map(row => ({ ...row, reinstated: Boolean(row.reinstated) })), row => row.classId)
      };
    },
    async getSemester() { return db.prepare('SELECT start_date AS startDate FROM semester WHERE id = 1').get() || null; },
    async setSemester(startDate) { db.prepare('INSERT INTO semester (id,start_date) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET start_date=excluded.start_date').run(startDate); return { startDate }; },
    async listClasses() { return db.prepare('SELECT * FROM classes ORDER BY name').all().map(hydrate); },
    async getClass(id) { return getClass(id); },
    async createClass(subject) {
      const weekdays = [...new Set(subject.schedules.map(item => item.weekday))].sort();
      const result = db.prepare('INSERT INTO classes (name,total_minutes,meeting_minutes,weekdays,start_time) VALUES (?,?,?,?,?)').run(subject.name, subject.totalMinutes, subject.meetingMinutes, JSON.stringify(weekdays), subject.schedules[0].startTime);
      const insert = db.prepare('INSERT INTO class_schedules (class_id,weekday,start_time) VALUES (?,?,?)');
      for (const item of subject.schedules) insert.run(result.lastInsertRowid, item.weekday, item.startTime);
      return getClass(result.lastInsertRowid);
    },
    async updateClass(id, subject) {
      const weekdays = [...new Set(subject.schedules.map(item => item.weekday))].sort();
      db.prepare('UPDATE classes SET name=?,total_minutes=?,meeting_minutes=?,weekdays=?,start_time=? WHERE id=?').run(subject.name, subject.totalMinutes, subject.meetingMinutes, JSON.stringify(weekdays), subject.schedules[0].startTime, id);
      db.prepare('DELETE FROM class_schedules WHERE class_id=?').run(id);
      const insert = db.prepare('INSERT INTO class_schedules (class_id,weekday,start_time) VALUES (?,?,?)');
      for (const item of subject.schedules) insert.run(id, item.weekday, item.startTime);
      return getClass(id);
    },
    async deleteClass(id) { return Boolean(db.prepare('DELETE FROM classes WHERE id=?').run(id).changes); },
    async importClasses(subjects) {
      const created = [];
      db.exec('BEGIN');
      try {
        for (const subject of subjects) created.push(await this.createClass(subject));
        db.exec('COMMIT');
        return created;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async getAbsences(id) { return dates('absences', id); },
    async getExclusions(id) { return exclusions(id); },
    async addAbsence(id, date) { try { db.prepare('INSERT INTO absences (class_id,date) VALUES (?,?)').run(id, date); return true; } catch { return false; } },
    async deleteAbsence(id, date) { return Boolean(db.prepare('DELETE FROM absences WHERE class_id=? AND date=?').run(id, date).changes); },
    async cancelSession(id, date) { db.prepare('INSERT INTO exclusions (class_id,date,reinstated) VALUES (?,?,0) ON CONFLICT(class_id,date) DO UPDATE SET reinstated=0').run(id, date); },
    async reinstateSession(id, date) { return Boolean(db.prepare('UPDATE exclusions SET reinstated=1 WHERE class_id=? AND date=? AND reinstated=0').run(id, date).changes); },
    async deleteExclusion(id, date) { return Boolean(db.prepare('DELETE FROM exclusions WHERE class_id=? AND date=?').run(id, date).changes); },
    async exportData() {
      return {
        semester: await this.getSemester(), classes: await this.listClasses(),
        absences: db.prepare('SELECT CAST(class_id AS TEXT) classId,date FROM absences ORDER BY class_id,date').all(),
        exclusions: db.prepare('SELECT CAST(class_id AS TEXT) classId,date,reinstated FROM exclusions ORDER BY class_id,date').all().map(row => ({ ...row, reinstated: Boolean(row.reinstated) }))
      };
    }
  };
}
