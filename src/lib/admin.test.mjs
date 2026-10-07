import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const modules = new Map()
function loadModule(path) {
  if (modules.has(path)) return modules.get(path)
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    (name) => name.startsWith('.') ? loadModule(resolve(dirname(path), `${name}.ts`)) : require(name),
    mod, mod.exports,
  )
  modules.set(path, mod.exports)
  return mod.exports
}

const { getVacationUsedMinutes, leaveLabels } = loadModule(resolve('src/lib/leave.ts'))
const { getUserStatistics, getInvitationStatus, isAdminUser } = loadModule(resolve('src/lib/admin.ts'))
const { calculateDailyBalances, getDailyLunchDeductions, hasLunchOnDate } = loadModule(resolve('src/lib/attendance.ts'))
const { calculateShiftEnd, calculateMinutesUntil, calculateWorkedMinutes } = loadModule(resolve('src/lib/attendance.ts'))
const { getMonthlyStatistics } = loadModule(resolve('src/lib/monthly.ts'))

test('monthly Fond includes weekday holidays and credits them as paid hours', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const stats = getMonthlyStatistics([], [], '2026-10', now)
  assert.equal(stats.workingDays, 22)
  assert.equal(stats.holidayDays, 1)
  assert.equal(stats.fundMinutes, 176 * 60)
  assert.equal(stats.remainingMinutes, 176 * 60)
  assert.equal(stats.creditedHolidayMinutes, 0)
  assert.equal(stats.plannedHolidayMinutes, 8 * 60)
  assert.equal(stats.projectedRemainingMinutes, 168 * 60)
  const april = getMonthlyStatistics([], [], '2026-04', now)
  assert.equal(april.fundMinutes, 176 * 60)
  assert.equal(april.creditedHolidayMinutes, 16 * 60)
  assert.equal(april.remainingMinutes, 160 * 60)
  // July 5 and December 26 are on weekends in 2026.
  const july = getMonthlyStatistics([], [], '2026-07', now)
  assert.equal(july.fundMinutes, 184 * 60)
  assert.equal(july.creditedHolidayMinutes, 8 * 60)
  const december = getMonthlyStatistics([], [], '2026-12', now)
  assert.equal(december.fundMinutes, 184 * 60)
  assert.equal(december.plannedHolidayMinutes, 16 * 60)
  assert.equal(getMonthlyStatistics([], [], '2024-02', now).fundMinutes, 168 * 60)
  const halfTime = getMonthlyStatistics([], [], '2026-10', now, 240)
  assert.equal(halfTime.fundMinutes, 88 * 60)
  assert.equal(halfTime.plannedHolidayMinutes, 240)
})

test('leave fulfils monthly Fond without lunch, while future leave remains planned', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const days = [
    { date: '2026-10-01', type: 'vacation', duration_minutes: 240 },
    { date: '2026-10-02', type: 'sick_day', duration_minutes: 480 },
    { date: '2026-10-05', type: 'mandatory_vacation', duration_minutes: 480 },
    { date: '2026-10-06', type: 'comp_time', duration_minutes: 120 },
    { date: '2026-10-20', type: 'vacation', duration_minutes: 480 },
    { date: '2026-10-28', type: 'vacation', duration_minutes: 480 },
    { date: '2026-10-03', type: 'sick_day', duration_minutes: 480 },
    { date: '2026-11-02', type: 'vacation', duration_minutes: 480 },
  ]
  const stats = getMonthlyStatistics([], days, '2026-10', now)
  assert.equal(stats.fundMinutes, 10560)
  assert.equal(stats.creditedLeaveMinutes, 1320)
  assert.equal(stats.fulfilledMinutes, 1320)
  assert.equal(stats.plannedLeaveMinutes, 480)
  assert.equal(stats.plannedHolidayMinutes, 480)
  assert.equal(stats.projectedMinutes, 2280)
  assert.equal(stats.remainingMinutes, 9240)
  assert.equal(stats.projectedRemainingMinutes, 8280)
  const afterDate = getMonthlyStatistics([], days, '2026-10', new Date('2026-10-20T06:00:00Z'))
  assert.equal(afterDate.creditedLeaveMinutes, 1800)
  assert.equal(afterDate.plannedLeaveMinutes, 0)
  assert.equal(afterDate.plannedHolidayMinutes, 480)
  const duplicate = getMonthlyStatistics([], [...days, days[1]], '2026-10', now)
  assert.equal(duplicate.creditedLeaveMinutes, stats.creditedLeaveMinutes)
})

test('adding and removing a holiday or leave recalculates fulfilment without double credits or changing Fond', () => {
  const now = new Date('2026-10-31T12:00:00Z')
  const vacation = { date: '2026-10-06', type: 'vacation', duration_minutes: 480 }
  const extraHoliday = { date: '2026-10-06', type: 'holiday', duration_minutes: 480 }
  const nationalHoliday = { date: '2026-10-28', type: 'holiday', duration_minutes: 480 }
  const withVacation = getMonthlyStatistics([], [vacation], '2026-10', now)
  assert.equal(withVacation.fundMinutes, 10560)
  assert.equal(withVacation.fulfilledMinutes, 960)
  const withHoliday = getMonthlyStatistics([], [vacation, extraHoliday, extraHoliday, nationalHoliday], '2026-10', now)
  assert.equal(withHoliday.fundMinutes, 10560)
  assert.equal(withHoliday.fulfilledMinutes, 960)
  assert.equal(withHoliday.creditedLeaveMinutes, 0)
  assert.equal(withHoliday.creditedHolidayMinutes, 960)
  assert.equal(withHoliday.holidayDays, 2)
  assert.equal(getMonthlyStatistics([], [], '2026-10', now).fulfilledMinutes, 480)
})

test('monthly work and projections use rounding and one daily lunch, and plans never count as completed', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const completed = {
    started_at: '2026-10-06T06:07:00Z', ended_at: '2026-10-06T14:45:00Z',
    lunch_started_at: null,
  }
  const open = {
    started_at: '2026-10-07T06:00:00Z', ended_at: null,
    planned_departure_at: '2026-10-07T15:30:00Z', lunch_started_at: null,
  }
  const stats = getMonthlyStatistics([completed, open], [], '2026-10', now)
  assert.equal(stats.workedMinutes, 480)
  assert.equal(stats.plannedWorkMinutes, 540)
  assert.equal(stats.fulfilledMinutes, 480)
  assert.equal(stats.projectedMinutes, 1500)
  const finished = getMonthlyStatistics(
    [completed, { ...open, ended_at: open.planned_departure_at, planned_departure_at: null }],
    [], '2026-10', new Date('2026-10-07T16:00:00Z'),
  )
  assert.equal(finished.workedMinutes, 1020)
  assert.equal(finished.plannedWorkMinutes, 0)
  assert.equal(getMonthlyStatistics([completed, { ...open, planned_departure_at: null }], [], '2026-10', now).projectedMinutes, 960)

  const morning = { started_at: '2026-10-07T05:00:00Z', ended_at: '2026-10-07T07:00:00Z', lunch_started_at: '2026-10-07T06:00:00Z' }
  const afternoon = { ...open, started_at: '2026-10-07T08:00:00Z', planned_departure_at: '2026-10-07T14:00:00Z' }
  const split = getMonthlyStatistics([morning, afternoon], [], '2026-10', now)
  assert.equal(split.workedMinutes, 90)
  assert.equal(split.plannedWorkMinutes, 360)
  assert.equal(split.projectedMinutes, 930)
})

test('paid holidays move from planned to fulfilled on the Prague holiday date', () => {
  const before = getMonthlyStatistics([], [], '2026-10', new Date('2026-10-27T22:59:59Z'))
  const holiday = getMonthlyStatistics([], [
    { date: '2026-10-28', type: 'vacation', duration_minutes: 240 },
    { date: '2026-10-28', type: 'holiday', duration_minutes: 480 },
  ], '2026-10', new Date('2026-10-27T23:00:00Z'))
  assert.equal(before.plannedHolidayMinutes, 480)
  assert.equal(before.fulfilledMinutes, 0)
  assert.equal(holiday.plannedHolidayMinutes, 0)
  assert.equal(holiday.creditedHolidayMinutes, 480)
  assert.equal(holiday.creditedLeaveMinutes, 0)
  assert.equal(holiday.fulfilledMinutes, 480)
  assert.equal(holiday.projectedMinutes, before.projectedMinutes)
  assert.equal(holiday.fundMinutes, before.fundMinutes)
})

test('monthly assignment follows Prague arrival date and completed work can exceed Fond', () => {
  const now = new Date('2026-11-02T12:00:00Z')
  const atBoundary = { started_at: '2026-09-30T22:30:00Z', ended_at: '2026-10-01T00:30:00Z', lunch_started_at: null }
  assert.equal(getMonthlyStatistics([atBoundary], [], '2026-09', now).workedMinutes, 0)
  assert.equal(getMonthlyStatistics([atBoundary], [], '2026-10', now).workedMinutes, 120)
  const weekendWork = { started_at: '2026-10-03T06:00:00Z', ended_at: '2026-10-03T08:00:00Z', lunch_started_at: null }
  assert.equal(getMonthlyStatistics([weekendWork], [], '2026-10', now).workedMinutes, 120)
  const many = Array.from({ length: 22 }, (_, index) => ({
    started_at: `2026-10-${String(index + 1).padStart(2, '0')}T06:00:00Z`,
    ended_at: `2026-10-${String(index + 1).padStart(2, '0')}T14:30:00Z`,
    lunch_started_at: null,
  }))
  const stats = getMonthlyStatistics(many, [], '2026-10', now)
  assert.equal(stats.remainingMinutes, 0)
  assert.equal(stats.balanceMinutes, 480)
})

test('shift countdown includes lunch and rounds to a departure that fulfils the work requirement', () => {
  const arrival = new Date('2026-10-07T06:00:00Z')
  const end = calculateShiftEnd(arrival, 480, false)
  assert.equal(end.toISOString(), '2026-10-07T14:30:00.000Z')
  assert.equal(calculateMinutesUntil(end, arrival), 510)
  assert.equal(calculateMinutesUntil(end, new Date('2026-10-07T14:00:00Z')), 30)
  assert.equal(calculateMinutesUntil(end, new Date('2026-10-07T14:30:01Z')), 0)
  assert.equal(calculateShiftEnd(arrival, 480, true).getTime(), end.getTime())

  // A lunch deducted in an earlier session must not extend this session again.
  assert.equal(calculateShiftEnd(arrival, 480, false, false).toISOString(), '2026-10-07T14:00:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 240, false).toISOString(), '2026-10-07T10:00:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 300, false).toISOString(), '2026-10-07T11:00:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 301, false).toISOString(), '2026-10-07T11:45:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 240, true).toISOString(), '2026-10-07T10:30:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 0, true).getTime(), arrival.getTime())

  const lateArrival = new Date('2026-10-07T06:07:00Z')
  const lateEnd = calculateShiftEnd(lateArrival, 480, false)
  assert.equal(lateEnd.toISOString(), '2026-10-07T14:45:00.000Z')
  assert.equal(calculateWorkedMinutes(lateArrival, lateEnd, false), 480)
  assert.ok(calculateWorkedMinutes(lateArrival, new Date(lateEnd.getTime() - 60_000), false) < 480)
})

test('planned departure countdown uses wall-clock time independently of the shift requirement', () => {
  const now = new Date('2026-10-07T06:00:00Z')
  const planned = new Date('2026-10-07T15:30:00Z')
  assert.equal(calculateMinutesUntil(planned, now), 570)
  assert.equal(calculateMinutesUntil(planned, new Date('2026-10-07T15:29:30Z')), 1)
  assert.equal(calculateMinutesUntil(planned, new Date('2026-10-07T15:31:00Z')), 0)
})

test('company-wide leave shares vacation allowance and credits the day once', () => {
  const days = [
    { date: '2026-10-01', type: 'vacation', duration_minutes: 240 },
    { date: '2026-10-02', type: 'mandatory_vacation', duration_minutes: 480 },
    { date: '2026-10-05', type: 'sick_day', duration_minutes: 480 },
  ]
  assert.equal(getVacationUsedMinutes(days), 720)
  assert.equal(leaveLabels.mandatory_vacation, 'Celozávodní dovolená')
  const balance = calculateDailyBalances([], [days[1]])[0]
  assert.equal(balance.creditedMinutes, 480)
  assert.equal(balance.balanceMinutes, 0)
  assert.equal(balance.overtimeChangeMinutes, 0)
})

test('admin statistics separate monthly work, cumulative overtime and annual planned leave', () => {
  const stats = getUserStatistics([
    { started_at: '2026-09-30T06:00:00Z', ended_at: '2026-09-30T15:00:00Z', lunch_started_at: null },
    { started_at: '2026-10-01T06:00:00Z', ended_at: '2026-10-01T14:30:00Z', lunch_started_at: null },
  ], [
    { date: '2026-10-02', type: 'mandatory_vacation', duration_minutes: 480 },
    { date: '2026-10-20', type: 'vacation', duration_minutes: 480 },
    { date: '2027-01-01', type: 'vacation', duration_minutes: 480 },
  ], '2026-10', 480, new Date('2026-10-02T10:00:00Z'))
  assert.equal(stats.workedMinutes, 480)
  assert.equal(stats.overtimeMinutes, 30)
  assert.equal(stats.vacationMinutes, 960)
  assert.equal(stats.monthlySessions.length, 1)
  assert.equal(stats.monthlyDays.length, 2)
})

test('invitation states include expiration, revocation and consumption', () => {
  const invitation = {
    id: 'fixture', email: null, created_at: '2026-10-01T00:00:00Z',
    expires_at: '2026-10-03T00:00:00Z', used_at: null, revoked_at: null,
  }
  const now = new Date('2026-10-02T00:00:00Z')
  assert.equal(getInvitationStatus(invitation, now), 'Aktivní')
  assert.equal(getInvitationStatus(invitation, new Date(invitation.expires_at)), 'Vypršela')
  assert.equal(getInvitationStatus({ ...invitation, revoked_at: now.toISOString() }, now), 'Zrušena')
  assert.equal(getInvitationStatus({ ...invitation, used_at: now.toISOString() }, now), 'Použita')
})

test('role response validation rejects unexpected or client-supplied roles', () => {
  const user = {
    id: 'fixture', email: null, full_name: 'Test', role: 'user',
    daily_work_minutes: 480, created_at: '2026-10-01T00:00:00Z',
  }
  assert.equal(isAdminUser(user), true)
  assert.equal(isAdminUser({ ...user, role: 'owner' }), false)
  assert.equal(isAdminUser({ role: 'admin' }), false)
})

test('only one lunch is deducted per Prague day', () => {
  // Prague is UTC+2 on these dates.
  const morning = { started_at: '2026-10-06T05:00:00Z', ended_at: '2026-10-06T11:00:00Z', lunch_started_at: null }
  const afternoon = { started_at: '2026-10-06T12:00:00Z', ended_at: '2026-10-06T18:00:00Z', lunch_started_at: null }
  const automatic = getDailyLunchDeductions([afternoon, morning])
  assert.equal(automatic.get(morning), 'automatic')
  assert.equal(automatic.get(afternoon), null)
  // 6 h + 6 h with a single 30-minute lunch.
  assert.equal(calculateDailyBalances([morning, afternoon], [])[0].workedMinutes, 690)

  const recordedLater = { ...afternoon, lunch_started_at: '2026-10-06T13:00:00Z' }
  const withRecorded = getDailyLunchDeductions([morning, recordedLater])
  assert.equal(withRecorded.get(morning), null)
  assert.equal(withRecorded.get(recordedLater), 'recorded')

  const first = { started_at: '2026-10-06T05:00:00Z', ended_at: '2026-10-06T07:00:00Z', lunch_started_at: '2026-10-06T06:00:00Z' }
  const second = { started_at: '2026-10-06T08:00:00Z', ended_at: '2026-10-06T10:00:00Z', lunch_started_at: '2026-10-06T09:00:00Z' }
  const duplicates = getDailyLunchDeductions([second, first])
  assert.equal(duplicates.get(first), 'recorded')
  assert.equal(duplicates.get(second), null)
  assert.equal(calculateDailyBalances([first, second], [])[0].workedMinutes, 210)

  const open = { started_at: '2026-10-06T12:00:00Z', ended_at: null, lunch_started_at: null }
  assert.equal(hasLunchOnDate([open], '2026-10-06'), false)
  assert.equal(hasLunchOnDate([morning, open], '2026-10-06'), true)
  assert.equal(hasLunchOnDate([morning, open], '2026-10-07'), false)
})

const { validateSessionChange } = loadModule(resolve('src/lib/sessions.ts'))

test('session changes reject overlaps, future times and a second lunch', () => {
  const now = new Date('2030-04-01T16:00:00Z')
  const sessions = [
    { id: 1, started_at: '2030-04-01T06:00:00Z', ended_at: '2030-04-01T10:00:00Z', lunch_started_at: '2030-04-01T09:00:00Z' },
    { id: 2, started_at: '2030-04-01T13:00:00Z', ended_at: null, lunch_started_at: null },
  ]
  const change = (id, arrival, departure, lunchStartedAt = null) => validateSessionChange(
    { id, arrival: new Date(arrival), departure: departure && new Date(departure), lunchStartedAt },
    sessions, now,
  )

  assert.equal(change(null, '2030-04-01T10:00:00Z', '2030-04-01T12:00:00Z'), null)
  assert.match(change(null, '2030-04-01T09:00:00Z', '2030-04-01T11:00:00Z'), /překrývá/)
  assert.match(change(null, '2030-04-01T14:00:00Z', '2030-04-01T15:00:00Z'), /probíhá/)
  assert.match(change(null, '2030-04-01T11:00:00Z', '2030-04-01T10:00:00Z'), /později/)
  assert.match(change(null, '2030-04-01T15:00:00Z', '2030-04-01T17:00:00Z'), /budoucnosti/)
  assert.match(change(2, '2030-04-01T09:30:00Z', null), /překrývá/)
  assert.equal(change(2, '2030-04-01T12:00:00Z', null), null)
  assert.match(change(1, '2030-04-01T09:30:00Z', '2030-04-01T10:00:00Z', sessions[0].lunch_started_at), /oběda/)
  sessions[1].lunch_started_at = '2030-04-01T14:00:00Z'
  assert.match(change(2, '2030-04-01T13:00:00Z', null, sessions[1].lunch_started_at), /oběd/)
  assert.match(change(null, new Date('invalid'), null), /platný/)
})
