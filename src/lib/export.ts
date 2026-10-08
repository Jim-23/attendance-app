import { formatInTimeZone } from 'date-fns-tz'
import { calculateSessionWorkedMinutes, getDailyLunchDeductions } from './attendance'
import type { WorkDayForBalance, WorkSessionForBalance } from './attendance'
import { getMonthlyCalendarCredits } from './monthly'
import type { MonthlySession } from './monthly'
import { leaveLabels } from './leave'
import { APP_TIMEZONE } from './time'
import { splitDoctorVisit } from './doctor'

const WEEKDAYS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So']
export const EXPORT_HEADERS = [
  'Den', 'Datum', 'Plán', 'Započteno', 'Oběd', 'Bilance (+/−)', 'Počátek', 'Konec', 'Poznámka',
  'Stav',
]

export interface ExportLeave extends WorkDayForBalance {
  note?: string | null
}

function duration(minutes: number, signed = false): string {
  const absolute = Math.abs(minutes)
  const prefix = minutes < 0 ? '-' : signed && minutes > 0 ? '+' : ''
  return `${prefix}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`
}

function localDate(timestamp: string): string {
  return formatInTimeZone(new Date(timestamp), APP_TIMEZONE, 'yyyy-MM-dd')
}

function time(timestamp: string, date: string): string {
  return formatInTimeZone(
    new Date(timestamp), APP_TIMEZONE,
    localDate(timestamp) === date ? 'HH:mm' : 'dd.MM.yyyy HH:mm',
  )
}

export function getAttendanceExportRows(
  sessions: MonthlySession[],
  leave: ExportLeave[],
  period: string,
  now: Date,
  dailyMinutes = 480,
): string[][] {
  if (!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period) || Number(period.slice(0, 4)) < 100) {
    throw new Error('Neplatný měsíc nebo rok exportu.')
  }
  const months = period.length === 4
    ? Array.from({ length: 12 }, (_, index) => `${period}-${String(index + 1).padStart(2, '0')}`)
    : [period]
  const today = localDate(now.toISOString())
  const completed: WorkSessionForBalance[] = sessions
    .filter((session): session is MonthlySession & { ended_at: string } =>
      session.ended_at !== null && new Date(session.ended_at) <= now,
    )
  const deductions = getDailyLunchDeductions(completed, leave)

  return months.flatMap((month) => getMonthlyCalendarCredits(leave, month, dailyMinutes).map((day) => {
    const daySessions = completed.filter((session) => localDate(session.started_at) === day.date)
      .sort((left, right) => new Date(left.started_at).getTime() - new Date(right.started_at).getTime())
    const worked = daySessions.reduce(
      (total, session) => total + calculateSessionWorkedMinutes(session, deductions.get(session) ?? null, leave), 0,
    )
    const credited = worked + (day.date <= today ? day.leaveMinutes + day.holidayMinutes : 0)
    const lunch = daySessions.some((session) => deductions.get(session) != null) ? 30 : 0
    const notes: string[] = []
    const statuses: string[] = []
    if (day.weekend) statuses.push('Víkend')
    if (day.holidayName) statuses.push('Svátek')
    if (day.holidayName) notes.push(day.holidayName)
    for (const record of leave.filter((record) => record.date === day.date && record.type !== 'holiday')) {
      if (!statuses.includes(leaveLabels[record.type])) statuses.push(leaveLabels[record.type])
      notes.push(`${leaveLabels[record.type]} ${duration(record.duration_minutes)}${record.note ? `: ${record.note}` : ''}`)
      if (record.type === 'doctor' && record.doctor_from && record.doctor_to) {
        const split = splitDoctorVisit(record.doctor_from.slice(0, 5), record.doctor_to.slice(0, 5))
        notes.push(`${record.doctor_from.slice(0, 5)}–${record.doctor_to.slice(0, 5)}; placeno ${duration(split.paidMinutes)}; z přesčasů ${duration(split.overtimeMinutes)}`)
      }
    }
    if (day.date > today && (day.leaveMinutes > 0 || day.holidayMinutes > 0)) {
      notes.push('Plánované volno / svátek – dosud nezapočteno')
    }
    const openSessions = sessions.filter(
      (record) => record.ended_at === null && localDate(record.started_at) === day.date,
    )
    if (openSessions.length) statuses.push('Neukončená docházka')
    if (day.date > today) statuses.push('Budoucí den')
    else if (credited > day.requiredMinutes) statuses.push('Nad denní plán')
    else if (credited < day.requiredMinutes) {
      statuses.push(day.date === today ? 'Probíhající den' : 'Chybí hodiny')
    } else if (!statuses.length) statuses.push('Splněno')
    for (const session of sessions.filter(
      (record) => record.ended_at === null && localDate(record.started_at) === day.date,
    )) {
      notes.push(`Neukončená docházka od ${time(session.started_at, day.date)}`)
      if (session.planned_departure_at) {
        notes.push(`Plánovaný odchod ${time(session.planned_departure_at, day.date)}`)
      }
    }
    if (daySessions.length > 1) notes.push(`Pracovní záznamy: ${daySessions.length}`)
    const end = daySessions.reduce<string | null>(
      (latest, session) => !latest || new Date(session.ended_at) > new Date(latest)
        ? session.ended_at : latest, null,
    )
    return [
      WEEKDAYS[new Date(`${day.date}T00:00:00Z`).getUTCDay()],
      day.date.split('-').reverse().join('.'),
      duration(day.requiredMinutes),
      duration(credited),
      duration(lunch),
      day.date <= today ? duration(credited - day.requiredMinutes, true) : '',
      daySessions[0] ? time(daySessions[0].started_at, day.date) : '',
      end ? time(end, day.date) : '',
      notes.join(' · '),
      statuses.join(' · '),
    ]
  }))
}
