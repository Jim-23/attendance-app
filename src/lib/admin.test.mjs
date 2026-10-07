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
