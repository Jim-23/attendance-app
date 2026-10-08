import {
  calculateDailyBalances,
  calculateAnnualOvertime,
  calculateSessionWorkedMinutes,
  getDailyLunchDeductions,
} from './attendance'
import type { WorkDayForBalance, WorkSessionForBalance } from './attendance'
import { getVacationUsedMinutes } from './leave'
import { APP_TIMEZONE } from './time'
import { formatInTimeZone } from 'date-fns-tz'

export interface AdminUser {
  id: string
  email: string | null
  full_name: string | null
  role: 'user' | 'admin'
  daily_work_minutes: number
  created_at: string
}

export interface Invitation {
  id: string
  email: string | null
  created_at: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

export function isAdminUser(value: unknown): value is AdminUser {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'email' in value && (typeof value.email === 'string' || value.email === null) &&
    'full_name' in value && (typeof value.full_name === 'string' || value.full_name === null) &&
    'role' in value && (value.role === 'user' || value.role === 'admin') &&
    'daily_work_minutes' in value && typeof value.daily_work_minutes === 'number' &&
    'created_at' in value && typeof value.created_at === 'string'
}

export function isInvitation(value: unknown): value is Invitation {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'email' in value && (typeof value.email === 'string' || value.email === null) &&
    'created_at' in value && typeof value.created_at === 'string' &&
    'expires_at' in value && typeof value.expires_at === 'string' &&
    'used_at' in value && (typeof value.used_at === 'string' || value.used_at === null) &&
    'revoked_at' in value && (typeof value.revoked_at === 'string' || value.revoked_at === null)
}

export function getInvitationStatus(invitation: Invitation, now = new Date()): string {
  if (invitation.used_at) return 'Použita'
  if (invitation.revoked_at) return 'Zrušena'
  if (new Date(invitation.expires_at) <= now) return 'Vypršela'
  return 'Aktivní'
}

export function getUserStatistics(
  sessions: WorkSessionForBalance[],
  days: WorkDayForBalance[],
  month: string,
  requiredMinutes: number,
  now = new Date(),
) {
  const today = formatInTimeZone(now, APP_TIMEZONE, 'yyyy-MM-dd')
  const datedSessions = sessions.map((session) => ({
    ...session,
    date: formatInTimeZone(new Date(session.started_at), APP_TIMEZONE, 'yyyy-MM-dd'),
  }))
  const monthlySessions = datedSessions.filter((session) => session.date.startsWith(month))
  const balances = calculateDailyBalances(
    datedSessions.filter((session) => session.date <= today),
    days.filter((day) => day.date <= today),
    requiredMinutes,
  )
  const monthlyLunchDeductions = getDailyLunchDeductions(monthlySessions)
  const annualDays = days.filter((day) => day.date.startsWith(month.slice(0, 4)))
  return {
    workedMinutes: monthlySessions.reduce((total, session) => total + calculateSessionWorkedMinutes(
      session, monthlyLunchDeductions.get(session) ?? null,
      days,
    ), 0),
    overtimeMinutes: calculateAnnualOvertime(balances, now, month.slice(0, 4)),
    vacationMinutes: getVacationUsedMinutes(annualDays),
    sickMinutes: annualDays.filter((day) => day.type === 'sick_day')
      .reduce((total, day) => total + day.duration_minutes, 0),
    monthlySessions,
    monthlyDays: days.filter((day) => day.date.startsWith(month)),
  }
}
