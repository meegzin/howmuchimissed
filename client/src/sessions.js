import { generateScheduledDatesByCount } from '../../shared/domain.js';

export function sessionsFor(subject, semester) {
  if (!semester) return [];
  const absences = new Set(subject.absences), exclusions = new Set(subject.exclusions), reinstated = new Set(subject.reinstated);
  return generateScheduledDatesByCount(semester.startDate, subject.schedules, subject.totalMeetings).map(date => ({
    date, classId: subject.id, name: subject.name,
    startTime: subject.schedules.find(item => item.weekday === new Date(date + 'T00:00:00Z').getUTCDay())?.startTime,
    meetingMinutes: subject.meetingMinutes, missed: absences.has(date), excluded: exclusions.has(date), reinstated: reinstated.has(date),
    absenceCount: subject.absenceCount, maxAbsences: subject.maxAbsences, status: subject.status
  }));
}
