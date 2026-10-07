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

export function getMonthlyStatistics(
  sessions: MonthlySession[],
  leave: WorkDayForBalance[],
  month: string,
  now: Date,
  dailyMinutes = 480,
) {
  const today = formatInTimeZone(now, APP_TIMEZONE, 'yyyy-MM-dd')
  const holidays = getCzechHolidays(Number(month.slice(0, 4)))
  const monthDays = getMonthDays(month).filter((day) => day.inMonth)
  const addedHolidays = new Set(
    leave.filter((day) => day.type === 'holiday').map((day) => day.date),
  )
  const workingDays = monthDays.filter(
    (day) => !day.weekend,
  )
  const workingDates = new Set(workingDays.map((day) => day.date))
  const holidayDates = new Set(
    workingDays.filter((day) => holidays.has(day.date) || addedHolidays.has(day.date))
      .map((day) => day.date),
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
    ), 0,
  )
  const projectedWorkedMinutes = [...completed, ...planned].reduce(
    (total, session) => total + calculateSessionWorkedMinutes(
      session, projectedLunches.get(session) ?? null,
    ), 0,
  )

  const leaveByDate = new Map<string, number>()
  for (const day of leave) {
    if (day.type === 'holiday' || !workingDates.has(day.date) || holidayDates.has(day.date)) continue
    leaveByDate.set(
      day.date,
      Math.min(dailyMinutes, (leaveByDate.get(day.date) ?? 0) + day.duration_minutes),
    )
  }
  let creditedLeaveMinutes = 0
  let plannedLeaveMinutes = 0
  for (const [date, minutes] of leaveByDate) {
    if (date <= today) creditedLeaveMinutes += minutes
    else plannedLeaveMinutes += minutes
  }
  let creditedHolidayMinutes = 0
  let plannedHolidayMinutes = 0
  for (const date of holidayDates) {
    if (date <= today) creditedHolidayMinutes += dailyMinutes
    else plannedHolidayMinutes += dailyMinutes
  }
  const fundMinutes = workingDays.length * dailyMinutes
  const fulfilledMinutes = workedMinutes + creditedLeaveMinutes + creditedHolidayMinutes
  const projectedMinutes = projectedWorkedMinutes + creditedLeaveMinutes + plannedLeaveMinutes +
    creditedHolidayMinutes + plannedHolidayMinutes
  return {
    workingDays: workingDays.length,
    holidayDays: holidayDates.size,
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
