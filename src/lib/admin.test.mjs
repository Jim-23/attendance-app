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
const { calculateDailyBalances } = loadModule(resolve('src/lib/attendance.ts'))

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
