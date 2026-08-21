const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  if (!ISO_DATE.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function addDays(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function generateSessionDates(start, end, weekdays, exclusions = []) {
  const allowed = new Set(weekdays);
  const excluded = new Set(exclusions);
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (allowed.has(weekdayOf(date)) && !excluded.has(date)) dates.push(date);
  }
  return dates;
}

export function generateScheduledDates(start, end, schedules, exclusions = []) {
  return generateSessionDates(start, end, schedules.map(item => item.weekday), exclusions);
}

export function generateScheduledDatesByCount(start, schedules, count) {
  if (!count || !schedules.length) return [];
  const allowed = new Set(schedules.map(item => item.weekday));
  const dates = [];
  for (let date = start; dates.length < count; date = addDays(date, 1)) {
    if (allowed.has(weekdayOf(date))) dates.push(date);
  }
  return dates;
}

export function calculateSummary({ totalMinutes, meetingMinutes, absenceCount }) {
  const totalMeetings = Math.floor(totalMinutes / meetingMinutes);
  const maxAbsences = Math.floor(totalMeetings * 0.25);
  const missedMinutes = absenceCount * meetingMinutes;
  const remainingMeetings = Math.max(0, maxAbsences - absenceCount);
  const status = absenceCount > maxAbsences ? 'exceeded' : absenceCount === maxAbsences ? 'limit' : 'safe';
  return { totalMeetings, maxAbsences, missedMinutes, absenceCount, remainingMeetings, remainingMinutes: remainingMeetings * meetingMinutes, status };
}
