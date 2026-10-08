import type { WorkDayForBalance } from './attendance'

export type LeaveType = WorkDayForBalance['type']

export function formatLeaveDays(minutes: number): string {
  const days = minutes / 480
  const label = days === 1 ? 'den' : Number.isInteger(days) && days >= 2 && days <= 4 ? 'dny' : 'dní'
  return `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 }).format(days)} ${label}`
}

export const leaveLabels: Record<LeaveType, string> = {
  holiday: 'Svátek',
  vacation: 'Dovolená',
  sick_day: 'Sick day',
  comp_time: 'Náhradní volno',
  mandatory_vacation: 'Celozávodní dovolená',
  doctor: 'Lékař',
}

export function usesVacationAllowance(type: LeaveType): boolean {
  return type === 'vacation' || type === 'mandatory_vacation'
}

export function getVacationUsedMinutes(days: WorkDayForBalance[]): number {
  return days
    .filter((day) => usesVacationAllowance(day.type))
    .reduce((total, day) => total + day.duration_minutes, 0)
}

export type UserLeaveType = Exclude<LeaveType, 'holiday'>

export interface LeaveInput {
  type: UserLeaveType
  dateFrom: string
  // Empty string means a single day (dateFrom).
  dateTo: string
  durationMinutes: number
  note: string
  doctorFrom?: string
  doctorTo?: string
}
