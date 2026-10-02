import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatInTimeZone } from 'date-fns-tz'

import {
    formatTime,
    formatDate,
    getStartOfTodayUtc,
    getStartOfCurrentMonthUtc,
    APP_TIMEZONE,
    formatDateTimeLocal,
    parseDateTimeLocal,
} from '../lib/time'
import {
    calculateWorkedMinutes,
    calculateDailyBalances,
    calculateCurrentWorkedMinutes,
    calculateRunningOvertime,
    formatDuration,
    getAutomaticLunchStart,
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

interface WorkDay {
    id: number
    date: string
    type:
        | 'holiday'
        | 'vacation'
        | 'sick_day'
        | 'comp_time'
        | 'mandatory_vacation'
    duration_minutes: number
    note: string | null
}

interface DashboardProps {
    userId: string
    email: string
    onLogout: () => void
}

const PAGE_SIZE = 1000

function Dashboard({ userId, email, onLogout }: DashboardProps) {
    const [workSession, setWorkSession] = useState<WorkSession | null>(null)
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [history, setHistory] = useState<HistorySession[]>([])
    const [monthlyWorkedMinutes, setMonthlyWorkedMinutes] = useState(0)
    const [monthlyOvertimeMinutes, setMonthlyOvertimeMinutes] = useState(0)
    const [dailyBalances, setDailyBalances] = useState<
        ReturnType<typeof calculateDailyBalances>
    >([])
    const [dayType, setDayType] = useState<'vacation' | 'sick_day' | 'comp_time'>('vacation')
    const [dayDuration, setDayDuration] = useState(480)
    const [dayDateFrom, setDayDateFrom] = useState('')
    const [dayDateTo, setDayDateTo] = useState('')
    const [dayNote, setDayNote] = useState('')
    const [workDays, setWorkDays] = useState<WorkDay[]>([])
    const [workDaysLoading, setWorkDaysLoading] = useState(true)
    const [compHours, setCompHours] = useState(0)
    const [compMinutes, setCompMinutes] = useState(15)
    const [editingSessionId, setEditingSessionId] = useState<number | null>(null)
    const [editedArrival, setEditedArrival] = useState('')
    const [editedDeparture, setEditedDeparture] = useState('')


    const loadWorkDays = useCallback(async () => {
        const allWorkDays: WorkDay[] = []
        let offset = 0

        while (true) {
            const { data, error } = await supabase
                .from('work_days')
                .select('id, date, type, duration_minutes, note')
                .eq('user_id', userId)
                .order('date', { ascending: false })
                .order('id', { ascending: false })
                .range(offset, offset + PAGE_SIZE - 1)

            if (error) {
                console.error('Failed to load work days:', error)
                setMessage('Nepodařilo se načíst volno.')
                setWorkDaysLoading(false)
                return
            }

            const page = data ?? []
            allWorkDays.push(...page)

            if (page.length < PAGE_SIZE) {
                break
            }

            offset += PAGE_SIZE
        }

        setWorkDays(allWorkDays)
        setWorkDaysLoading(false)
    }, [userId])

    const loadTodaySession = useCallback(async () => {
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
    }, [userId])

    const loadHistory = useCallback(async () => {
        const allSessions: HistorySession[] = []
        let offset = 0

        while (true) {
            const { data, error } = await supabase
                .from('work_sessions')
                .select('id, started_at, ended_at, lunch_started_at')
                .eq('user_id', userId)
                .not('ended_at', 'is', null)
                .order('started_at', { ascending: false })
                .order('id', { ascending: false })
                .range(offset, offset + PAGE_SIZE - 1)

            if (error) {
                console.error('Failed to load history:', error)
                setMessage('Nepodařilo se načíst historii docházky.')
                return
            }

            const page = data ?? []
            allSessions.push(...page)

            if (page.length < PAGE_SIZE) {
                break
            }

            offset += PAGE_SIZE
        }

        setHistory(allSessions)

        const today = formatInTimeZone(
            new Date(),
            APP_TIMEZONE,
            'yyyy-MM-dd',
        )

        const allWorkDaysToDate: Pick<
            WorkDay,
            'date' | 'type' | 'duration_minutes'
        >[] = []
        offset = 0

        while (true) {
            const { data, error } = await supabase
                .from('work_days')
                .select('date, type, duration_minutes')
                .eq('user_id', userId)
                .lte('date', today)
                .order('date', { ascending: false })
                .order('id', { ascending: false })
                .range(offset, offset + PAGE_SIZE - 1)

            if (error) {
                console.error(
                    'Failed to load work days for balance:',
                    error,
                )
                setMessage(
                    'Nepodařilo se načíst volno pro výpočet bilance.',
                )
                return
            }

            const page = data ?? []
            allWorkDaysToDate.push(...page)

            if (page.length < PAGE_SIZE) {
                break
            }

            offset += PAGE_SIZE
        }

        const monthStart = new Date(
            getStartOfCurrentMonthUtc(),
        )

        const currentMonthSessions = allSessions.filter(
            (session) =>
                new Date(session.started_at) >= monthStart,
        )

        const totalWorkedMinutes =
            currentMonthSessions.reduce(
                (total, session) =>
                    total +
                    calculateWorkedMinutes(
                        new Date(session.started_at),
                        new Date(session.ended_at),
                        session.lunch_started_at !== null,
                    ),
                0,
            )

        // Future leave must not affect the overtime balance yet.
        const sessionsToDate = allSessions.filter((session) => {
            const sessionDate = formatInTimeZone(
                new Date(session.started_at),
                APP_TIMEZONE,
                'yyyy-MM-dd',
            )

            return sessionDate <= today
        })

        const dailyBalances = calculateDailyBalances(
            sessionsToDate,
            allWorkDaysToDate,
        )
        setDailyBalances(dailyBalances)
        setMonthlyWorkedMinutes(totalWorkedMinutes)
        setMonthlyOvertimeMinutes(
            calculateRunningOvertime(dailyBalances),
        )
    }, [userId])

    useEffect(() => {
        void Promise.resolve().then(() => {
            loadTodaySession()
            loadHistory()
            loadWorkDays()
        })
    }, [loadHistory, loadTodaySession, loadWorkDays])

async function handleAddDayRecord() {
    if (!dayDateFrom) {
        setMessage('Vyber datum od.')
        return
    }

    const dateTo = dayDateTo || dayDateFrom

    if (dateTo < dayDateFrom) {
        setMessage('Datum do nemůže být před datem od.')
        return
    }

    const duration =
        dayType === 'comp_time'
            ? compHours * 60 + compMinutes
            : dayDuration

    setActionLoading(true)
    setMessage(null)

    if (dayType === 'comp_time' && duration < 15) {
        setMessage(
            'Náhradní volno musí trvat alespoň 15 minut.',
        )
        setActionLoading(false)
        return
    }

    const dates: string[] = []

    const currentDate = new Date(`${dayDateFrom}T00:00:00Z`)
    const endDate = new Date(`${dateTo}T00:00:00Z`)

    while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getUTCDay()

        // 0 = neděle, 6 = sobota
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            dates.push(
                currentDate.toISOString().slice(0, 10),
            )
        }

        currentDate.setUTCDate(currentDate.getUTCDate() + 1)
    }

    if (dates.length === 0) {
        setMessage(
            'Vybraný rozsah neobsahuje žádný pracovní den.',
        )
        setActionLoading(false)
        return
    }

    // Náhradní volno se zadává pouze pro jeden konkrétní den.
    if (dayType === 'comp_time' && dates.length > 1) {
        setMessage(
            'Náhradní volno lze přidat pouze pro jeden den.',
        )
        setActionLoading(false)
        return
    }

    const existingWorkDays = workDays.filter(
        (day) => dates.includes(day.date),
    )

    // Ověření, že nepřekročíme 8 hodin volného času
    // v žádném jednotlivém dni.
    const invalidDate = dates.find((date) => {
        const existingMinutes = existingWorkDays
            .filter((day) => day.date === date)
            .reduce(
                (total, day) =>
                    total + day.duration_minutes,
                0,
            )

        return existingMinutes + duration > 480
    })

    if (invalidDate) {
        setMessage(
            `Pro ${invalidDate} už je evidováno příliš mnoho volna.`,
        )
        setActionLoading(false)
        return
    }

    // Kontrola ročních limitů.
    // Rozsah může překračovat hranici roku,
    // proto kontrolujeme každý rok samostatně.

    if (
        dayType === 'vacation' ||
        dayType === 'sick_day'
    ) {
        const requestedMinutesByYear =
            dates.reduce((result, date) => {
                const year = date.slice(0, 4)

                result[year] =
                    (result[year] ?? 0) + duration

                return result
            }, {} as Record<string, number>)

        for (const [year, requestedMinutes] of Object.entries(
            requestedMinutesByYear,
        )) {
            const alreadyUsedMinutes = workDays
                .filter(
                    (day) =>
                        day.date.startsWith(year) &&
                        day.type === dayType,
                )
                .reduce(
                    (total, day) =>
                        total + day.duration_minutes,
                    0,
                )

            const limitMinutes =
                dayType === 'vacation'
                    ? vacationLimitMinutes
                    : sickDayLimitMinutes

            if (
                alreadyUsedMinutes +
                    requestedMinutes >
                limitMinutes
            ) {
                const remainingMinutes = Math.max(
                    0,
                    limitMinutes -
                        alreadyUsedMinutes,
                )

                const label =
                    dayType === 'vacation'
                        ? 'dovolené'
                        : 'sick days'

                setMessage(
                    `Nelze přidat záznam pro rok ${year}. ` +
                    `Zbývá pouze ${formatDuration(
                        remainingMinutes,
                        false,
                    )} ${label}.`,
                )

                setActionLoading(false)
                return
            }
        }
    }

    const records = dates.map((date) => ({
        user_id: userId,
        date,
        type: dayType,
        duration_minutes: duration,
        note: dayNote || null,
    }))

    const { error } = await supabase
        .from('work_days')
        .insert(records)

    if (error) {
        console.error(
            'Failed to add work days:',
            error,
        )

        setMessage('Nepodařilo se uložit záznamy.')
    } else {
        setMessage(
            dates.length === 1
                ? 'Záznam uložen.'
                : `Uloženo ${dates.length} pracovních dnů.`,
        )

        setDayDateFrom('')
        setDayDateTo('')
        setDayNote('')
        setDayDuration(480)
        setCompHours(0)
        setCompMinutes(15)

        await loadWorkDays()
        await loadHistory()
    }

    setActionLoading(false)
}

async function handleDeleteDayRecord(id: number) {
    const confirmed = window.confirm(
        'Opravdu chceš tento záznam smazat?',
    )

    if (!confirmed) {
        return
    }

    setActionLoading(true)
    setMessage(null)

    const { error } = await supabase
        .from('work_days')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)

    if (error) {
        console.error('Failed to delete work day:', error)
        setMessage('Nepodařilo se smazat záznam.')
    } else {
        setMessage('Záznam byl smazán.')
        await loadWorkDays()
        await loadHistory()
    }

    setActionLoading(false)
}

  async function handleArrival() {
    if (todayFullyCovered) {
        setMessage('Dnes nemáš žádnou pracovní povinnost.')
        return
    }

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

    const { error } = await supabase
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
        setWorkSession(null)
        setMessage('Odchod zaznamenán.')
        await loadHistory()
    }

    setActionLoading(false)
  }

  function handleEditSession(session: HistorySession) {
    setEditingSessionId(session.id)
    setEditedArrival(formatDateTimeLocal(session.started_at))
    setEditedDeparture(formatDateTimeLocal(session.ended_at))
    setMessage(null)
  }

  async function handleSaveSession(session: HistorySession) {
    const arrival = parseDateTimeLocal(editedArrival)
    const departure = parseDateTimeLocal(editedDeparture)

    if (
      !Number.isFinite(arrival.getTime()) ||
      !Number.isFinite(departure.getTime())
    ) {
      setMessage('Zadej platný čas příchodu a odchodu.')
      return
    }

    if (arrival >= departure) {
      setMessage('Odchod musí být později než příchod.')
      return
    }

    if (session.lunch_started_at) {
      const lunchStartedAt = new Date(session.lunch_started_at)
      if (
        lunchStartedAt < arrival ||
        lunchStartedAt >= departure
      ) {
        setMessage(
          'Upravený čas musí zahrnovat již zaznamenaný začátek oběda.',
        )
        return
      }
    }

    setActionLoading(true)
    setMessage(null)

    const { error } = await supabase
      .from('work_sessions')
      .update({
        started_at: arrival.toISOString(),
        ended_at: departure.toISOString(),
      })
      .eq('id', session.id)
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .select('id')
      .single()

    if (error) {
      console.error('Failed to update work session:', error)
      setMessage('Nepodařilo se upravit docházku.')
    } else {
      setEditingSessionId(null)
      setMessage('Příchod a odchod byly upraveny.')
      await loadHistory()
    }

    setActionLoading(false)
  }

  function handleCancelEdit() {
    setEditingSessionId(null)
    setEditedArrival('')
    setEditedDeparture('')
    setMessage(null)
  }

const todayDate = formatInTimeZone(
    new Date(),
    APP_TIMEZONE,
    'yyyy-MM-dd',
)

const todayWorkDays = workDays.filter(
    (day) => day.date === todayDate,
)

const todayCreditedMinutes = todayWorkDays
    .filter((day) => day.type !== 'comp_time')
    .reduce(
        (total, day) =>
            total + day.duration_minutes,
        0,
    )

const todayCompTimeMinutes = todayWorkDays
    .filter((day) => day.type === 'comp_time')
    .reduce(
        (total, day) =>
            total + day.duration_minutes,
        0,
    )

const todayCompletedSessions = history.filter(
    (session) =>
        formatInTimeZone(
            new Date(session.started_at),
            APP_TIMEZONE,
            'yyyy-MM-dd',
        ) === todayDate,
)

const todayCompletedWorkedMinutes =
    todayCompletedSessions.reduce(
        (total, session) =>
            total +
            calculateWorkedMinutes(
                new Date(session.started_at),
                new Date(session.ended_at),
                session.lunch_started_at !== null,
            ),
        0,
    )

const todayCurrentWorkedMinutes =
    workSession && !workSession.ended_at
        ? calculateCurrentWorkedMinutes(
              new Date(workSession.started_at),
              new Date(),
              workSession.lunch_started_at !== null,
          )
        : 0

const todayWorkedMinutes =
    todayCompletedWorkedMinutes +
    todayCurrentWorkedMinutes

const todayCoveredMinutes = Math.min(
    todayWorkedMinutes +
        todayCreditedMinutes +
        todayCompTimeMinutes,
    480,
)

const todayRemainingMinutes = Math.max(
    0,
    480 - todayCoveredMinutes,
)

const todayFullyCovered =
    todayRemainingMinutes === 0

const todaySessionDate =
    workSession?.ended_at
        ? formatInTimeZone(
              new Date(workSession.started_at),
              APP_TIMEZONE,
              'yyyy-MM-dd',
          )
        : null

const todayDailyBalance =
    todaySessionDate
        ? dailyBalances.find(
              (balance) =>
                  balance.date === todaySessionDate,
          )
        : undefined

const todayBalanceMinutes =
    todayDailyBalance?.balanceMinutes ??
    (
        workSession?.ended_at
            ? calculateWorkedMinutes(
                  new Date(workSession.started_at),
                  new Date(workSession.ended_at),
                  workSession.lunch_started_at !== null,
              ) - 480
            : 0
    )

const currentYear = formatInTimeZone(
    new Date(),
    APP_TIMEZONE,
    'yyyy',
)

const currentYearWorkDays = workDays.filter(
    (day) => day.date.startsWith(currentYear),
)

const vacationUsedMinutes = currentYearWorkDays
    .filter((day) => day.type === 'vacation')
    .reduce(
        (total, day) => total + day.duration_minutes,
        0,
    )

const sickDayUsedMinutes = currentYearWorkDays
    .filter((day) => day.type === 'sick_day')
    .reduce(
        (total, day) => total + day.duration_minutes,
        0,
    )

const vacationLimitMinutes = 20 * 480
const sickDayLimitMinutes = 5 * 480

const vacationRemainingMinutes = Math.max(
    0,
    vacationLimitMinutes - vacationUsedMinutes,
)

const sickDayRemainingMinutes = Math.max(
    0,
    sickDayLimitMinutes - sickDayUsedMinutes,
)

const latestSessionIdByDate = new Map<string, number>()

for (const session of history) {
    const sessionDate = formatInTimeZone(
        new Date(session.started_at),
        APP_TIMEZONE,
        'yyyy-MM-dd',
    )

    if (!latestSessionIdByDate.has(sessionDate)) {
        latestSessionIdByDate.set(sessionDate, session.id)
    }
}

if (loading) {
  return <p>Načítám docházku...</p>
    }
return (
    <div className="dashboard">
        <header className="dashboard-header">
            <div>
                <p className="dashboard-eyebrow">ATTENDANCE</p>
                <h1>Docházka</h1>
                <p className="dashboard-user">
                    Přihlášen jako {email}
                </p>
            </div>

            <button
                className="button button-secondary"
                onClick={onLogout}
            >
                Odhlásit
            </button>
        </header>

        <main className="dashboard-content">
          {/* ==================== MESSAGE ==================== */}
            {message && (
                <div className="message">
                    {message}
                </div>
            )}

            {/* ==================== TODAY ==================== */}

            <section className="dashboard-section">
                <div className="section-heading">
                    <div>
                        <p className="section-eyebrow">DNES</p>
                        <h2>Pracovní den</h2>
                    </div>
                </div>

                <div className="today-card">
                    {workSession ? (
                        <>
                            <div className="today-status">
                                <span className="status-dot status-active" />
                                <span>
                                    {workSession.ended_at
                                        ? 'Práce ukončena'
                                        : 'Právě pracuješ'}
                                </span>
                            </div>

                            <div className="today-grid">
                                <div className="info-card">
                                    <span className="info-label">
                                        Příchod
                                    </span>

                                    <strong className="info-value">
                                        {formatTime(
                                            workSession.started_at,
                                        )}
                                    </strong>
                                </div>

                                {workSession.lunch_started_at && (
                                    <div className="info-card">
                                        <span className="info-label">
                                            Oběd
                                        </span>

                                        <strong className="info-value">
                                            {formatTime(
                                                workSession.lunch_started_at,
                                            )}
                                            {' – '}
                                            {formatTime(
                                                new Date(
                                                    new Date(
                                                        workSession.lunch_started_at,
                                                    ).getTime() +
                                                        30 * 60 * 1000,
                                                ).toISOString(),
                                            )}
                                        </strong>
                                    </div>
                                )}

                                {workSession.ended_at && (
                                    <>
                                        <div className="info-card">
                                            <span className="info-label">
                                                Odchod
                                            </span>

                                            <strong className="info-value">
                                                {formatTime(
                                                    workSession.ended_at,
                                                )}
                                            </strong>
                                        </div>

                                        <div className="info-card">
                                            <span className="info-label">
                                                Odpracováno
                                            </span>

                                            <strong className="info-value">
                                                {formatDuration(
                                                    calculateWorkedMinutes(
                                                        new Date(
                                                            workSession.started_at,
                                                        ),
                                                        new Date(
                                                            workSession.ended_at,
                                                        ),
                                                        workSession.lunch_started_at !==
                                                            null,
                                                    ),
                                                )}
                                            </strong>
                                        </div>

                                        <div className="info-card">
                                            <span className="info-label">
                                                Denní bilance
                                            </span>

                                            <strong
                                                className={`info-value ${
                                                    todayBalanceMinutes > 0
                                                        ? 'positive'
                                                        : todayBalanceMinutes <
                                                            0
                                                          ? 'negative'
                                                          : ''
                                                }`}
                                            >
                                                {formatDuration(
                                                    todayBalanceMinutes,
                                                )}
                                            </strong>
                                        </div>
                                    </>
                                )}
                            </div>

                            {!workSession.ended_at && (
                                <div className="action-row">
                                    {!workSession.lunch_started_at && (
                                        <button
                                            className="button button-secondary"
                                            onClick={handleLunch}
                                            disabled={actionLoading}
                                        >
                                            {actionLoading
                                                ? 'Ukládám...'
                                                : 'Začít oběd'}
                                        </button>
                                    )}

                                    <button
                                        className="button button-primary"
                                        onClick={handleDeparture}
                                        disabled={actionLoading}
                                    >
                                        {actionLoading
                                            ? 'Ukládám...'
                                            : 'Odchod'}
                                    </button>
                                </div>
                            )}
                        </>
                    ) : workDaysLoading ? (
                        <div className="empty-state">
                            <p>Načítám dnešní volno...</p>
                        </div>
                    ) : todayFullyCovered ? (
                        <div className="empty-state">
                            <div className="success-icon">✓</div>

                            <h3>Dnes nemáš pracovní povinnost</h3>

                            <p>
                                Dnešní pracovní čas je pokryt volnem.
                            </p>
                        </div>
                    ) : (
                        <div className="arrival-state">
                            <div>
                                <span className="info-label">
                                    Zbývá odpracovat
                                </span>

                                <strong className="large-value">
                                    {formatDuration(
                                        todayRemainingMinutes,
                                        false,
                                    )}
                                </strong>
                            </div>

                            <button
                                className="button button-primary button-large"
                                onClick={handleArrival}
                                disabled={actionLoading}
                            >
                                {actionLoading
                                    ? 'Ukládám...'
                                    : 'Příchod'}
                            </button>
                        </div>
                    )}
                </div>
            </section>

            {/* ==================== STATISTICS ==================== */}

            <section className="dashboard-section">
                <div className="section-heading">
                    <div>
                        <p className="section-eyebrow">STATISTIKY</p>
                        <h2>Statistiky</h2>
                    </div>
                </div>

                <div className="stats-grid">
                    <div className="stat-card">
                        <span className="stat-label">
                            Odpracováno tento měsíc
                        </span>

                        <strong className="stat-value">
                            {formatDuration(monthlyWorkedMinutes)}
                        </strong>
                    </div>

                    <div className="stat-card">
                        <span className="stat-label">
                            Přesčasový účet k dnešnímu dni
                        </span>

                        <strong
                            className={`stat-value ${
                                monthlyOvertimeMinutes > 0
                                    ? 'positive'
                                    : monthlyOvertimeMinutes < 0
                                      ? 'negative'
                                      : ''
                            }`}
                        >
                            {formatDuration(monthlyOvertimeMinutes)}
                        </strong>
                    </div>
                </div>
            </section>

  
            {/* ==================== HISTORY ==================== */}

            <section className="dashboard-section">
                <div className="section-heading">
                    <div>
                        <p className="section-eyebrow">PŘEHLED ZÁZNAMŮ</p>
                        <h2>Historie</h2>
                    </div>
                </div>

                {history.length === 0 ? (
                    <div className="empty-state card">
                        <p>Zatím žádná historie.</p>
                    </div>
                ) : (
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Datum</th>
                                    <th>Příchod</th>
                                    <th>Oběd</th>
                                    <th>Odchod</th>
                                    <th>Odpracováno</th>
                                    <th>Denní bilance</th>
                                    <th>Akce</th>
                                </tr>
                            </thead>

                            <tbody>
                                {history.map((session) => {
                                    const workedMinutes =
                                        calculateWorkedMinutes(
                                            new Date(
                                                session.started_at,
                                            ),
                                            new Date(
                                                session.ended_at,
                                            ),
                                            session.lunch_started_at !==
                                                null,
                                        )
                                    const automaticLunchStart =
                                        getAutomaticLunchStart(
                                            new Date(session.started_at),
                                            new Date(session.ended_at),
                                            session.lunch_started_at !==
                                                null,
                                        )

                                    const sessionDate =
                                        formatInTimeZone(
                                            new Date(
                                                session.started_at,
                                            ),
                                            APP_TIMEZONE,
                                            'yyyy-MM-dd',
                                        )

                                    const dailyBalance =
                                        dailyBalances.find(
                                            (balance) =>
                                                balance.date ===
                                                sessionDate,
                                        )

                                    const showDailyBalance =
                                        latestSessionIdByDate.get(
                                            sessionDate,
                                        ) === session.id
                                    const overtimeMinutes =
                                        dailyBalance?.balanceMinutes

                                    return (
                                        <Fragment key={session.id}>
                                        <tr>
                                            <td>
                                                {formatDate(
                                                    session.started_at,
                                                )}
                                            </td>

                                            <td>
                                                {formatTime(
                                                    roundArrival(
                                                        new Date(
                                                            session.started_at,
                                                        ),
                                                    ).toISOString(),
                                                )}
                                            </td>

                                            <td>
                                                {session.lunch_started_at
                                                    ? `${formatTime(
                                                          session.lunch_started_at,
                                                      )} – ${formatTime(
                                                          new Date(
                                                              new Date(
                                                                  session.lunch_started_at,
                                                              ).getTime() +
                                                                  30 *
                                                                      60 *
                                                                      1000,
                                                          ).toISOString(),
                                                      )}`
                                                    : automaticLunchStart
                                                      ? `Automaticky od ${formatTime(
                                                            automaticLunchStart.toISOString(),
                                                        )} (30 min)`
                                                      : '-'}
                                            </td>

                                            <td>
                                                {formatTime(
                                                    roundDeparture(
                                                        new Date(
                                                            session.ended_at,
                                                        ),
                                                    ).toISOString(),
                                                )}
                                            </td>

                                            <td>
                                                {formatDuration(
                                                    workedMinutes,
                                                )}
                                            </td>

                                            <td
                                                className={
                                                    overtimeMinutes !==
                                                        undefined &&
                                                    overtimeMinutes > 0
                                                        ? 'positive'
                                                        : overtimeMinutes !==
                                                              undefined &&
                                                          overtimeMinutes < 0
                                                          ? 'negative'
                                                          : ''
                                                }
                                            >
                                                {showDailyBalance &&
                                                overtimeMinutes !== undefined
                                                    ? formatDuration(
                                                          overtimeMinutes,
                                                      )
                                                    : '-'}
                                            </td>
                                            <td>
                                                    <button
                                                        className="button button-secondary button-small"
                                                        onClick={() =>
                                                            handleEditSession(
                                                                session,
                                                            )
                                                        }
                                                        disabled={actionLoading}
                                                    >
                                                        Upravit
                                                    </button>
                                            </td>
                                        </tr>
                                        {editingSessionId === session.id && (
                                            <tr>
                                                    <td colSpan={7}>
                                                        <div className="session-edit-form">
                                                            <div className="form-field">
                                                                <label
                                                                    htmlFor={`arrival-${session.id}`}
                                                                >
                                                                    Příchod
                                                                </label>
                                                                <input
                                                                    id={`arrival-${session.id}`}
                                                                    type="datetime-local"
                                                                    value={editedArrival}
                                                                    onChange={(event) =>
                                                                        setEditedArrival(
                                                                            event.target.value,
                                                                        )
                                                                    }
                                                                    required
                                                                />
                                                            </div>
                                                            <div className="form-field">
                                                                <label
                                                                    htmlFor={`departure-${session.id}`}
                                                                >
                                                                    Odchod
                                                                </label>
                                                                <input
                                                                    id={`departure-${session.id}`}
                                                                    type="datetime-local"
                                                                    value={editedDeparture}
                                                                    onChange={(event) =>
                                                                        setEditedDeparture(
                                                                            event.target.value,
                                                                        )
                                                                    }
                                                                    required
                                                                />
                                                            </div>
                                                            <div className="session-edit-actions">
                                                                <button
                                                                    className="button button-primary button-small"
                                                                    onClick={() =>
                                                                        handleSaveSession(
                                                                            session,
                                                                        )
                                                                    }
                                                                    disabled={actionLoading}
                                                                >
                                                                    {actionLoading
                                                                        ? 'Ukládám...'
                                                                        : 'Uložit'}
                                                                </button>
                                                                <button
                                                                    className="button button-secondary button-small"
                                                                    onClick={handleCancelEdit}
                                                                    disabled={actionLoading}
                                                                >
                                                                    Zrušit
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </td>
                                            </tr>
                                        )}
                                        </Fragment>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ==================== TIME OFF ==================== */}

                

            {/* ==================== SAVED TIME OFF ==================== */}
            <section className="dashboard-section">
                <div className="section-heading">
                    <div>
                        <p className="section-eyebrow">
                            PŘEHLED
                        </p>
                        <h2>Volno</h2>
                    </div>
                </div>
                <p className="section-label">
                  Volno tento rok
                </p>
                <div className="stats-grid">
                        <div className="stat-card">
                            <span className="stat-label">
                                Dovolená
                            </span>

                            <strong className="stat-value">
                                {formatDuration(
                                    vacationUsedMinutes,
                                    false,
                                )}
                            </strong>

                            <span className="stat-description">
                                zbývá{' '}
                                {formatDuration(
                                    vacationRemainingMinutes,
                                    false,
                                )}
                            </span>
                        </div>

                        <div className="stat-card">
                            <span className="stat-label">
                                Sick days
                            </span>

                            <strong className="stat-value">
                                {formatDuration(
                                    sickDayUsedMinutes,
                                    false,
                                )}
                            </strong>

                            <span className="stat-description">
                                zbývá{' '}
                                {formatDuration(
                                    sickDayRemainingMinutes,
                                    false,
                                )}
                            </span>
                        </div>
                </div>
                <p className="section-label">
                  Přidat volno
                </p>
                <div className="form-card">
                    <div className="form-grid">
                        <div className="form-field">
                            <label htmlFor="day-date-from">
                                Od
                            </label>

                            <input
                                id="day-date-from"
                                type="date"
                                value={dayDateFrom}
                                onChange={(event) =>
                                    setDayDateFrom(
                                        event.target.value,
                                    )
                                }
                            />
                        </div>

                        <div className="form-field">
                            <label htmlFor="day-date-to">
                                Do
                            </label>

                            <input
                                id="day-date-to"
                                type="date"
                                value={dayDateTo}
                                min={dayDateFrom}
                                onChange={(event) =>
                                    setDayDateTo(
                                        event.target.value,
                                    )
                                }
                            />
                        </div>

                        <div className="form-field">
                            <label htmlFor="day-type">
                                Typ
                            </label>

                            <select
                                id="day-type"
                                value={dayType}
                                onChange={(event) =>
                                    setDayType(
                                        event.target.value as
                                            | 'vacation'
                                            | 'sick_day'
                                            | 'comp_time',
                                    )
                                }
                            >
                                <option value="vacation">
                                    Dovolená
                                </option>

                                <option value="sick_day">
                                    Sick day
                                </option>

                                <option value="comp_time">
                                    Náhradní volno
                                </option>
                            </select>
                        </div>

                        {dayType === 'vacation' && (
                            <div className="form-field">
                                <label htmlFor="day-duration">
                                    Délka
                                </label>

                                <select
                                    id="day-duration"
                                    value={dayDuration}
                                    onChange={(event) =>
                                        setDayDuration(
                                            Number(
                                                event.target.value,
                                            ),
                                        )
                                    }
                                >
                                    <option value={480}>
                                        Celý den (8 h)
                                    </option>

                                    <option value={240}>
                                        Půl dne (4 h)
                                    </option>
                                </select>
                            </div>
                        )}

                        {dayType === 'sick_day' && (
                            <div className="form-field">
                                <label htmlFor="day-duration">
                                    Délka
                                </label>

                                <select
                                    id="day-duration"
                                    value={dayDuration}
                                    onChange={(event) =>
                                        setDayDuration(
                                            Number(
                                                event.target.value,
                                            ),
                                        )
                                    }
                                >
                                    <option value={480}>
                                        Celý den (8 h)
                                    </option>
                                </select>
                            </div>
                        )}

                        {dayType === 'comp_time' && (
                            <>
                                <div className="form-field">
                                    <label htmlFor="comp-hours">
                                        Hodiny
                                    </label>

                                    <input
                                        id="comp-hours"
                                        type="number"
                                        min="0"
                                        max="23"
                                        value={compHours}
                                        onChange={(event) =>
                                            setCompHours(
                                                Number(
                                                    event.target.value,
                                                ),
                                            )
                                        }
                                    />
                                </div>

                                <div className="form-field">
                                    <label htmlFor="comp-minutes">
                                        Minuty
                                    </label>

                                    <select
                                        id="comp-minutes"
                                        value={compMinutes}
                                        onChange={(event) =>
                                            setCompMinutes(
                                                Number(
                                                    event.target.value,
                                                ),
                                            )
                                        }
                                    >
                                        <option value={0}>
                                            00
                                        </option>
                                        <option value={15}>
                                            15
                                        </option>
                                        <option value={30}>
                                            30
                                        </option>
                                        <option value={45}>
                                            45
                                        </option>
                                    </select>
                                </div>
                            </>
                        )}

                        <div className="form-field form-field-wide">
                            <label htmlFor="day-note">
                                Poznámka
                            </label>

                            <input
                                id="day-note"
                                type="text"
                                value={dayNote}
                                placeholder="Volitelná poznámka"
                                onChange={(event) =>
                                    setDayNote(
                                        event.target.value,
                                    )
                                }
                            />
                        </div>
                    </div>

                    <button
                        className="button button-primary"
                        onClick={handleAddDayRecord}
                        disabled={actionLoading}
                    >
                        {actionLoading
                            ? 'Ukládám...'
                            : 'Přidat volno'}
                    </button>
                </div>
                
                <p className="section-label">
                  Přehled volna
                </p>
                {workDays.length === 0 ? (
                    <div className="empty-state card">
                        <p>Žádné záznamy.</p>
                    </div>
                ) : (
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Datum</th>
                                    <th>Typ</th>
                                    <th>Délka</th>
                                    <th>Poznámka</th>
                                    <th>Akce</th>
                                </tr>
                            </thead>

                            <tbody>
                                {workDays.map((day) => (
                                    <tr key={day.id}>
                                        <td>{day.date}</td>

                                        <td>
                                            {day.type === 'vacation'
                                                ? 'Dovolená'
                                                : day.type ===
                                                    'sick_day'
                                                  ? 'Sick day'
                                                  : day.type ===
                                                      'comp_time'
                                                    ? 'Náhradní volno'
                                                    : day.type}
                                        </td>

                                        <td>
                                            {formatDuration(
                                                day.duration_minutes,
                                                false,
                                            )}
                                        </td>

                                        <td>
                                            {day.note ?? '-'}
                                        </td>

                                        <td>
                                            <button
                                                className="button button-danger button-small"
                                                onClick={() =>
                                                    handleDeleteDayRecord(
                                                        day.id,
                                                    )
                                                }
                                                disabled={
                                                    actionLoading
                                                }
                                            >
                                                Smazat
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </main>
    </div>
)
}

export default Dashboard