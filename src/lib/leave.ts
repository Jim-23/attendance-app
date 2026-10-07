import type { WorkDayForBalance } from './attendance'

export type LeaveType = WorkDayForBalance['type']

export const leaveLabels: Record<LeaveType, string> = {
  holiday: 'Svátek',
  vacation: 'Dovolená',
  sick_day: 'Sick day',
  comp_time: 'Náhradní volno',
  mandatory_vacation: 'Celozávodní dovolená',
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
}
