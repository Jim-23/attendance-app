import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import {
  getInvitationStatus, getUserStatistics, isAdminUser, isInvitation,
} from '../lib/admin'
import type { AdminUser, Invitation } from '../lib/admin'
import type { WorkDayForBalance, WorkSessionForBalance } from '../lib/attendance'
import { formatDuration } from '../lib/attendance'
import { formatDate, formatDateTimeLocal, formatTime } from '../lib/time'
import { leaveLabels } from '../lib/leave'
import { getMonthlyStatistics } from '../lib/monthly'
import type { MonthlySession } from '../lib/monthly'
import MonthlyStatisticsCards from './MonthlyStatisticsCards'
import MonthInput from './MonthInput'
import AttendanceExport from './AttendanceExport'

interface AdminDashboardProps {
  onBack: () => void
  onRoleChange: () => Promise<void>
}

async function loadAdminRows<T>(
  procedure: 'admin_list_users' | 'admin_list_invitations',
  validate: (value: unknown) => value is T,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; ) {
    const { data, error } = await supabase.rpc(procedure)
      .order('created_at').order('id').range(offset, offset + 999)
    if (error) throw error
    const page: unknown = data
    if (!Array.isArray(page) || !page.every(validate)) {
      throw new Error('Invalid administration response')
    }
    rows.push(...page)
    if (!page.length) return rows
    offset += page.length
  }
}

function AdminDashboard({ onBack, onRoleChange }: AdminDashboardProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [attendanceRequest, setAttendanceRequest] = useState(0)
  const [attendanceFailedFor, setAttendanceFailedFor] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [inviteEmail, setInviteEmail] = useState('')
  const [validDays, setValidDays] = useState(7)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [month, setMonth] = useState(() => formatDateTimeLocal(new Date().toISOString()).slice(0, 7))
  const [attendance, setAttendance] = useState<{
    userId: string
    sessions: WorkSessionForBalance[]
    allSessions: MonthlySession[]
    days: WorkDayForBalance[]
    openSession: string | null
  } | null>(null)

  const loadAdminData = useCallback(async () => {
    try {
      const [userData, invitationData] = await Promise.all([
        loadAdminRows('admin_list_users', isAdminUser),
        loadAdminRows('admin_list_invitations', isInvitation),
      ])
      setUsers(userData)
      setInvitations(invitationData)
    } catch (error) {
      console.error('Failed to load administration:', error)
      setError('Administraci se nepodařilo načíst. Ověř oprávnění a instalaci migrace.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadAdminData)
  }, [loadAdminData])

  useEffect(() => {
    let active = true
    if (!selectedId) return
    async function loadAttendance() {
      const sessions: WorkSessionForBalance[] = []
      const allSessions: MonthlySession[] = []
      const days: WorkDayForBalance[] = []
      let openSession: string | null = null
      for (let offset = 0; ; ) {
        const { data, error } = await supabase.from('work_sessions')
          .select('started_at, ended_at, lunch_started_at, planned_departure_at')
          .eq('user_id', selectedId).order('started_at').order('id')
          .range(offset, offset + 999)
        if (!active) return
        if (error) {
          console.error('Failed to load user attendance:', error)
          setError('Nepodařilo se načíst docházku uživatele.')
          setAttendanceFailedFor(selectedId)
          return
        }
        for (const session of data ?? []) {
          allSessions.push(session)
          if (session.ended_at) sessions.push(session)
          else openSession = session.started_at
        }
        if (!data?.length) break
        offset += data.length
      }
      for (let offset = 0; ; ) {
        const { data, error } = await supabase.from('work_days')
          .select('date, type, duration_minutes, note').eq('user_id', selectedId)
          .order('date').order('id').range(offset, offset + 999)
        if (!active) return
        if (error) {
          console.error('Failed to load user leave:', error)
          setError('Nepodařilo se načíst volno uživatele.')
          setAttendanceFailedFor(selectedId)
          return
        }
        days.push(...(data ?? []).map((day) => ({
          ...day, duration_minutes: day.duration_minutes ?? 480,
        })))
        if (!data?.length) break
        offset += data.length
      }
      if (active) setAttendance({ userId: selectedId, sessions, allSessions, days, openSession })
    }
    void loadAttendance()
    return () => { active = false }
  }, [selectedId, attendanceRequest])

  function selectUser(user: AdminUser) {
    setSelectedId(user.id)
    setAttendance(null)
    setAttendanceFailedFor(null)
    setAttendanceRequest((request) => request + 1)
    setName(user.full_name ?? '')
    setRole(user.role)
    setError(null)
    setMessage(null)
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const { error } = await supabase.rpc('admin_update_user', {
      target_id: selectedId, new_full_name: name, new_role: role,
    })
    if (error) {
      console.error('Failed to update user:', error)
      setError('Uložení uživatele selhalo. Posledního administrátora nelze odebrat.')
    } else {
      setMessage('Uživatel byl upraven.')
      await loadAdminData()
      await onRoleChange()
    }
    setBusy(false)
  }

  async function createInvitation(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNewKey(null)
    const { data, error } = await supabase.rpc('admin_create_invitation', {
      invited_email: inviteEmail.trim() || null, valid_days: validDays,
    })
    if (error || typeof data !== 'string') {
      console.error('Failed to create invitation:', error)
      setError('Pozvánku se nepodařilo vytvořit.')
    } else {
      setNewKey(data)
      await loadAdminData()
    }
    setBusy(false)
  }

  async function revokeInvitation(id: string) {
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('admin_revoke_invitation', { invitation_id: id })
    if (error) {
      console.error('Failed to revoke invitation:', error)
      setError('Pozvánku se nepodařilo zrušit.')
    } else {
      setNewKey(null)
      await loadAdminData()
    }
    setBusy(false)
  }

  const selectedUser = users.find((user) => user.id === selectedId)
  const stats = attendance?.userId === selectedId && selectedUser
    ? getUserStatistics(attendance.sessions, attendance.days, month, selectedUser.daily_work_minutes)
    : null
  const monthlyStats = attendance?.userId === selectedId && selectedUser
    ? getMonthlyStatistics(
        attendance.allSessions, attendance.days, month, new Date(), selectedUser.daily_work_minutes,
      )
    : null

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div><p className="dashboard-eyebrow">ADMINISTRACE</p><h1>Správa uživatelů</h1></div>
        <button className="button button-secondary" onClick={onBack} disabled={busy}>Zpět na docházku</button>
      </header>
      <main className="dashboard-content">
        {error && <p className="message message-error" role="alert">{error}</p>}
        {message && <p className="message message-success" role="status">{message}</p>}
        {loading ? <p>Načítám administraci...</p> : (
          <>
            <section className="dashboard-section">
              <div className="section-heading"><h2>Uživatelé</h2></div>
              <div className="table-wrapper"><table>
                <thead><tr><th>Jméno</th><th>E-mail</th><th>Role</th><th>Akce</th></tr></thead>
                <tbody>{users.map((user) => (
                  <tr key={user.id}><td>{user.full_name ?? '—'}</td><td>{user.email ?? '—'}</td>
                    <td>{user.role === 'admin' ? 'Administrátor' : 'Uživatel'}</td>
                    <td><button className="button button-secondary button-small" disabled={busy}
                      onClick={() => selectUser(user)}>Spravovat</button></td></tr>
                ))}</tbody>
              </table></div>
            </section>
            {selectedUser && (
              <section className="dashboard-section">
                <div className="section-heading"><h2>{selectedUser.email ?? selectedUser.full_name}</h2></div>
                <form className="form-card" onSubmit={saveUser}>
                  <div className="form-grid">
                    <div className="form-field"><label htmlFor="admin-name">Jméno</label>
                      <input id="admin-name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
                    <div className="form-field"><label htmlFor="admin-role">Role</label>
                      <select id="admin-role" value={role} disabled={busy} onChange={(event) => {
                        if (event.target.value === 'user' || event.target.value === 'admin') setRole(event.target.value)
                      }}><option value="user">Uživatel</option><option value="admin">Administrátor</option></select></div>
                  </div>
                  <button className="button button-primary" disabled={busy}>Uložit uživatele</button>
                </form>
                <div className="form-field admin-month">
                  <label htmlFor="admin-month">Měsíc statistik</label>
                  <MonthInput id="admin-month" value={month} onChange={setMonth} />
                </div>
                {!stats ? (
                  <p>{attendanceFailedFor === selectedId
                    ? 'Statistiky nejsou dostupné. Vyber uživatele znovu pro opakování.'
                    : 'Načítám statistiky...'}</p>
                ) : (
                  <>
                    {attendance && (
                      <AttendanceExport
                        sessions={attendance.allSessions}
                        leave={attendance.days}
                        month={month}
                        dailyMinutes={selectedUser.daily_work_minutes}
                        disabled={busy || attendanceFailedFor === selectedId}
                        onError={setError}
                      />
                    )}
                    {monthlyStats && <MonthlyStatisticsCards statistics={monthlyStats} />}
                    <div className="stats-grid">
                      <div className="stat-card"><span className="stat-label">Přesčasový účet k dnešku</span>
                        <strong className="stat-value">{formatDuration(stats.overtimeMinutes)}</strong></div>
                      <div className="stat-card"><span className="stat-label">Dovolená v roce {month.slice(0, 4)} (včetně celozávodní)</span>
                        <strong className="stat-value">{formatDuration(stats.vacationMinutes, false)}</strong></div>
                      <div className="stat-card"><span className="stat-label">Sick days v roce {month.slice(0, 4)}</span>
                        <strong className="stat-value">{formatDuration(stats.sickMinutes, false)}</strong></div>
                    </div>
                    {attendance?.openSession && <p>Otevřená docházka od {formatDate(attendance.openSession)} {formatTime(attendance.openSession)}.</p>}
                    <p className="calendar-note">
                      Fond zahrnuje všední dny včetně svátků. Splněno zahrnuje dokončenou práci, volno a placené svátky
                      do dneška; budoucí plány jsou zvlášť. Roční volno zahrnuje i plánované záznamy.
                    </p>
                    <h3>Docházka v měsíci</h3>
                    <div className="table-wrapper"><table>
                      <thead><tr><th>Datum</th><th>Příchod</th><th>Odchod</th></tr></thead>
                      <tbody>{stats.monthlySessions.map((session, index) => (
                        <tr key={index}><td>{formatDate(session.started_at)}</td>
                          <td>{formatTime(session.started_at)}</td><td>{formatTime(session.ended_at)}</td></tr>
                      ))}</tbody>
                    </table></div>
                    <h3>Volno v měsíci</h3>
                    <div className="table-wrapper"><table>
                      <thead><tr><th>Datum</th><th>Typ</th><th>Délka</th></tr></thead>
                      <tbody>{stats.monthlyDays.map((day, index) => (
                        <tr key={index}><td>{day.date}</td><td>{leaveLabels[day.type]}</td>
                          <td>{formatDuration(day.duration_minutes, false)}</td></tr>
                      ))}</tbody>
                    </table></div>
                  </>
                )}
              </section>
            )}
            <section className="dashboard-section">
              <div className="section-heading"><h2>Registrační pozvánky</h2></div>
              <form className="form-card" onSubmit={createInvitation}>
                <div className="form-grid">
                  <div className="form-field"><label htmlFor="invite-email">E-mail (volitelný)</label>
                    <input id="invite-email" type="email" value={inviteEmail} disabled={busy}
                      onChange={(event) => setInviteEmail(event.target.value)} /></div>
                  <div className="form-field"><label htmlFor="invite-days">Platnost ve dnech</label>
                    <input id="invite-days" type="number" min={1} max={30} required value={validDays} disabled={busy}
                      onChange={(event) => setValidDays(Number(event.target.value))} /></div>
                </div>
                <button className="button button-primary" disabled={busy}>Vytvořit jednorázový klíč</button>
              </form>
              {newKey && (
                <div className="message message-info message-block" role="status">
                  <p>Klíč zkopíruj a předej uživateli bezpečně. Zobrazí se pouze nyní.</p>
                  <div className="form-field"><label htmlFor="new-invitation">Registrační klíč</label>
                    <input id="new-invitation" value={newKey} readOnly autoComplete="off" /></div>
                </div>
              )}
              <div className="table-wrapper admin-invitations"><table>
                <thead><tr><th>E-mail</th><th>Platnost do</th><th>Stav</th><th>Akce</th></tr></thead>
                <tbody>{invitations.map((invitation) => (
                  <tr key={invitation.id}><td>{invitation.email ?? 'Libovolný e-mail'}</td>
                    <td>{formatDate(invitation.expires_at)} {formatTime(invitation.expires_at)}</td>
                    <td>{getInvitationStatus(invitation)}</td><td>
                      <button className="button button-danger button-small"
                        disabled={busy || getInvitationStatus(invitation) !== 'Aktivní'}
                        onClick={() => revokeInvitation(invitation.id)}>Zrušit</button>
                    </td></tr>
                ))}</tbody>
              </table></div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default AdminDashboard
