import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
    formatTime,
    formatDate,
    getStartOfTodayUtc,
    getStartOfCurrentMonthUtc,
} from '../lib/time'
import {
    calculateWorkedMinutes,
    calculateBalanceMinutes,
    formatDuration,
    roundArrival,
    roundDeparture,

} from '../lib/attendance'

interface WorkSession {
    id: number
    started_at: string
    ended_at: string | null
    lunch_started_at: string | null
}

interface HistorySession {
    id: number
    started_at: string
    ended_at: string
    lunch_started_at: string | null
}

interface DashboardProps {
    userId: string
    email: string
    onLogout: () => void
}

function Dashboard({ userId, email, onLogout }: DashboardProps) {
    const [workSession, setWorkSession] = useState<WorkSession | null>(null)
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [history, setHistory] = useState<HistorySession[]>([])
    const [monthlyWorkedMinutes, setMonthlyWorkedMinutes] = useState(0)
    const [monthlyOvertimeMinutes, setMonthlyOvertimeMinutes] = useState(0)

  useEffect(() => {
    loadTodaySession()
    loadHistory()
}, [userId])

  async function loadTodaySession() {
    setLoading(true)

    const { data, error } = await supabase
        .from('work_sessions')
        .select('id, started_at, ended_at, lunch_started_at')
        .eq('user_id', userId)
        .gte('started_at', getStartOfTodayUtc())
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (error) {
      console.error('Failed to load today session:', error)
      setMessage('Nepodařilo se načíst dnešní docházku.')
    } else {
      setWorkSession(data)
    }

    setLoading(false)
  }

  async function loadHistory() {
    const { data, error } = await supabase
        .from('work_sessions')
        .select('id, started_at, ended_at, lunch_started_at')
        .eq('user_id', userId)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })

    if (error) {
        console.error('Failed to load history:', error)
        setMessage('Nepodařilo se načíst historii docházky.')
        return
    }

    setHistory(data ?? [])
    const sessions = data ?? []

    const monthStart = new Date(getStartOfCurrentMonthUtc())

    const currentMonthSessions = sessions.filter(
    (session) =>
        new Date(session.started_at) >= monthStart,
    )

    const totalWorkedMinutes = currentMonthSessions.reduce(
    (total, session) => {
        return total + calculateWorkedMinutes(
        new Date(session.started_at),
        new Date(session.ended_at),
        session.lunch_started_at !== null,
        )
    },
    0,
    )

    const totalOvertimeMinutes = currentMonthSessions.reduce(
    (total, session) => {
        const workedMinutes = calculateWorkedMinutes(
        new Date(session.started_at),
        new Date(session.ended_at),
        session.lunch_started_at !== null,
        )

        return total + calculateBalanceMinutes(workedMinutes)
    },
    0,
    )

    setMonthlyWorkedMinutes(totalWorkedMinutes)
    setMonthlyOvertimeMinutes(totalOvertimeMinutes)
    }

  async function handleArrival() {
    setActionLoading(true)
    setMessage(null)

    const { data, error } = await supabase
      .from('work_sessions')
      .insert({
        user_id: userId,
        started_at: new Date().toISOString(),
      })
      .select('id, started_at, ended_at, lunch_started_at')
      .single()

    if (error) {
      console.error('Failed to record arrival:', error)
      setMessage('Nepodařilo se zaznamenat příchod.')
    } else {
      setWorkSession(data)
      setMessage('Příchod zaznamenán.')
    }

    setActionLoading(false)
  }

  async function handleLunch() {
    if (!workSession) {
      return
    }

    if (workSession.lunch_started_at) {
      return
    }

    setActionLoading(true)
    setMessage(null)

    const { data, error } = await supabase
      .from('work_sessions')
      .update({
        lunch_started_at: new Date().toISOString(),
      })
      .eq('id', workSession.id)
      .is('lunch_started_at', null)
      .select('id, started_at, ended_at, lunch_started_at')
      .single()

    if (error) {
      console.error('Failed to record lunch:', error)
      setMessage('Nepodařilo se zaznamenat oběd.')
    } else {
      setWorkSession(data)
      setMessage('Oběd zaznamenán na 30 minut.')
    }

    setActionLoading(false)
  }

  async function handleDeparture() {
    if (!workSession) {
      return
    }

    setActionLoading(true)
    setMessage(null)

    const { data, error } = await supabase
      .from('work_sessions')
      .update({
        ended_at: new Date().toISOString(),
      })
      .eq('id', workSession.id)
      .is('ended_at', null)
      .select('id, started_at, ended_at, lunch_started_at')
      .single()

    if (error) {
      console.error('Failed to record departure:', error)
      setMessage('Nepodařilo se zaznamenat odchod.')
    } else {
        setWorkSession(data)
        setMessage('Odchod zaznamenán.')
    }

    setActionLoading(false)
  }


if (loading) {
        return <p>Načítám docházku...</p>
    }

        console.log('Dashboard state:', {
        loading,
        workSession,
        actionLoading,
        message,
        history,
    })

return (
    <div>
      <h1>Attendance Dashboard</h1>

      <p>Přihlášen jako: {email}</p>

      <h2>Tento měsíc</h2>

        <p>
        Odpracováno: {formatDuration(monthlyWorkedMinutes)}
        </p>

        <p>
        Přesčas: {formatDuration(monthlyOvertimeMinutes)}
        </p>

      {workSession ? (
        <>
          <p>
            Příchod: {formatTime(workSession.started_at)}
          </p>

            {workSession.lunch_started_at && (
            <p>
                Oběd: {formatTime(workSession.lunch_started_at)} –{' '}
                {formatTime(
                    new Date(
                    new Date(workSession.lunch_started_at).getTime() +
                        30 * 60 * 1000,
                    ).toISOString(),
                )}
            </p>
          )}

          {!workSession.ended_at && (
            <>
              {!workSession.lunch_started_at && (
                <button
                  onClick={handleLunch}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Ukládám...' : 'Oběd'}
                </button>
              )}

              <button
                onClick={handleDeparture}
                disabled={actionLoading}
              >
                {actionLoading ? 'Ukládám...' : 'Odchod'}
              </button>
            </>
          )}

          {workSession.ended_at && (
            <>
                <p>
                Odchod: {formatTime(workSession.ended_at)}
                </p>

                <p>
                Odpracováno:{' '}
                {formatDuration(
                    calculateWorkedMinutes(
                    new Date(workSession.started_at),
                    new Date(workSession.ended_at),
                    workSession.lunch_started_at !== null,
                    ),
                )}
                </p>

                <p>
                Přesčas:{' '}
                {formatDuration(
                    calculateBalanceMinutes(
                    calculateWorkedMinutes(
                        new Date(workSession.started_at),
                        new Date(workSession.ended_at),
                        workSession.lunch_started_at !== null,
                    ),
                    ),
                )}
                </p>
            </>
            )}
        </>
      ) : (
        <button
          onClick={handleArrival}
          disabled={actionLoading}
        >
          {actionLoading ? 'Ukládám...' : 'Příchod'}
        </button>
    )}

      {message && <p>{message}</p>}
      <h2>Historie</h2>

        {history.length === 0 ? (
        <p>Zatím žádná historie.</p>
        ) : (
        <table>
            <thead>
            <tr>
                <th>Datum</th>
                <th>Příchod</th>
                <th>Oběd</th>
                <th>Odchod</th>
                <th>Odpracováno</th>
                <th>Přesčas</th>
            </tr>
            </thead>

            <tbody>
            {history.map((session) => {
                const workedMinutes = calculateWorkedMinutes(
                new Date(session.started_at),
                new Date(session.ended_at),
                session.lunch_started_at !== null,
                )

                const overtimeMinutes =
                calculateBalanceMinutes(workedMinutes)

                return (
                <tr key={session.id}>
                    <td>
                    {formatDate(session.started_at)}
                    </td>

                    <td>
                    {formatTime(
                        roundArrival(
                        new Date(session.started_at),
                        ).toISOString(),
                    )}
                    </td>

                    <td>
                    {session.lunch_started_at
                        ? `${formatTime(session.lunch_started_at)} – ${formatTime(
                            new Date(
                            new Date(session.lunch_started_at).getTime() +
                                30 * 60 * 1000,
                            ).toISOString(),
                        )}`
                        : '-'}
                    </td>

                    <td>
                    {formatTime(
                        roundDeparture(
                        new Date(session.ended_at),
                        ).toISOString(),
                    )}
                    </td>

                    <td>
                    {formatDuration(workedMinutes)}
                    </td>

                    <td>
                    {formatDuration(overtimeMinutes)}
                    </td>
                </tr>
                )
            })}
            </tbody>
        </table>
        )}


      <button onClick={onLogout}>
        Odhlásit
      </button>
    </div>
  )
}

export default Dashboard