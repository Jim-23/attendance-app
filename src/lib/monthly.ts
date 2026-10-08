import { formatInTimeZone } from 'date-fns-tz'
import { getCzechHolidays, getMonthDays } from './calendar'
import {
  calculateSessionWorkedMinutes,
  getDailyLunchDeductions,
} from './attendance'
import type { WorkDayForBalance, WorkSessionForBalance } from './attendance'
import { APP_TIMEZONE } from './time'

export interface MonthlySession {
  started_at: string
  ended_at: string | null
  lunch_started_at: string | null
  planned_departure_at?: string | null
}

export function getMonthlyCalendarCredits(
  leave: WorkDayForBalance[],
  month: string,
  dailyMinutes = 480,
) {
  const holidays = getCzechHolidays(Number(month.slice(0, 4)))
  const addedHolidays = new Set(
    leave.filter((day) => day.type === 'holiday').map((day) => day.date),
  )
  const days = getMonthDays(month).filter((day) => day.inMonth)
  return days.map((day) => {
    const isHoliday = !day.weekend && (holidays.has(day.date) || addedHolidays.has(day.date))
    const leaveMinutes = day.weekend || isHoliday ? 0 : Math.min(
      dailyMinutes,
      leave.filter((record) => record.date === day.date && record.type !== 'holiday')
        .reduce((total, record) => total + record.duration_minutes, 0),
    )
    return {
      ...day,
      requiredMinutes: day.weekend ? 0 : dailyMinutes,
      holidayMinutes: isHoliday ? dailyMinutes : 0,
      leaveMinutes,
      holidayName: holidays.get(day.date) ?? (addedHolidays.has(day.date) ? 'Svátek' : null),
    }
  })
}

export function getMonthlyStatistics(
  sessions: MonthlySession[],
  leave: WorkDayForBalance[],
  month: string,
  now: Date,
  dailyMinutes = 480,
) {
  const today = formatInTimeZone(now, APP_TIMEZONE, 'yyyy-MM-dd')
  const monthDays = getMonthlyCalendarCredits(leave, month, dailyMinutes)
  const workingDays = monthDays.filter(
    (day) => !day.weekend,
  )
  const monthlySessions = sessions.filter((session) =>
    formatInTimeZone(new Date(session.started_at), APP_TIMEZONE, 'yyyy-MM-dd').startsWith(month),
  )
  const completed: WorkSessionForBalance[] = []
  const planned: WorkSessionForBalance[] = []
  for (const session of monthlySessions) {
    if (session.ended_at && new Date(session.ended_at) <= now) {
      completed.push({ ...session, ended_at: session.ended_at })
    } else if (!session.ended_at && session.planned_departure_at) {
      planned.push({ ...session, ended_at: session.planned_departure_at })
    }
  }

  const completedLunches = getDailyLunchDeductions(completed)
  const projectedLunches = getDailyLunchDeductions([...completed, ...planned])
  const workedMinutes = completed.reduce(
    (total, session) => total + calculateSessionWorkedMinutes(
      session, completedLunches.get(session) ?? null,
      leave,
    ), 0,
  )
  const projectedWorkedMinutes = [...completed, ...planned].reduce(
    (total, session) => total + calculateSessionWorkedMinutes(
      session, projectedLunches.get(session) ?? null,
      leave,
    ), 0,
  )

  let creditedLeaveMinutes = 0
  let plannedLeaveMinutes = 0
  let creditedHolidayMinutes = 0
  let plannedHolidayMinutes = 0
  for (const day of monthDays) {
    if (day.date <= today) {
      creditedLeaveMinutes += day.leaveMinutes
      creditedHolidayMinutes += day.holidayMinutes
    } else {
      plannedLeaveMinutes += day.leaveMinutes
      plannedHolidayMinutes += day.holidayMinutes
    }
  }
  const fundMinutes = workingDays.length * dailyMinutes
  const fulfilledMinutes = workedMinutes + creditedLeaveMinutes + creditedHolidayMinutes
  const projectedMinutes = projectedWorkedMinutes + creditedLeaveMinutes + plannedLeaveMinutes +
    creditedHolidayMinutes + plannedHolidayMinutes
  return {
    workingDays: workingDays.length,
    holidayDays: monthDays.filter((day) => day.holidayMinutes > 0).length,
    fundMinutes,
    workedMinutes,
    creditedLeaveMinutes,
    creditedHolidayMinutes,
    plannedWorkMinutes: projectedWorkedMinutes - workedMinutes,
    plannedLeaveMinutes,
    plannedHolidayMinutes,
    fulfilledMinutes,
    projectedMinutes,
    remainingMinutes: Math.max(0, fundMinutes - fulfilledMinutes),
    projectedRemainingMinutes: Math.max(0, fundMinutes - projectedMinutes),
    balanceMinutes: fulfilledMinutes - fundMinutes,
  }
}

export type MonthlyStatistics = ReturnType<typeof getMonthlyStatistics>
