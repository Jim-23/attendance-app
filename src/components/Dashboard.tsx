import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatInTimeZone } from 'date-fns-tz'
import AttendanceCalendar from './AttendanceCalendar'
import { DateTimeInput, TimeInput } from './TimeInput'
import { getVacationUsedMinutes, leaveLabels, usesVacationAllowance } from '../lib/leave'
import type { LeaveInput } from '../lib/leave'
import { validateSessionChange } from '../lib/sessions'
import type { SessionChange } from '../lib/sessions'
import CalendarDayPanel from './CalendarDayPanel'
import { getCzechHolidays } from '../lib/calendar'
import { getMonthlyStatistics } from '../lib/monthly'
import MonthlyStatisticsCards from './MonthlyStatisticsCards'
import MonthInput from './MonthInput'
import AttendanceExport from './AttendanceExport'

import {
    formatTime,
    formatDate,
    APP_TIMEZONE,
    formatDateTimeLocal,
    parseDateTimeLocal,
} from '../lib/time'
import {
    calculateWorkedMinutes,
    calculateDailyBalances,
    calculateCurrentWorkedMinutes,
    calculateShiftEnd,
    calculateMinutesUntil,
    calculateRunningOvertime,
    formatDuration,
    getAutomaticLunchStart,
    getDailyLunchDeductions,
    calculateSessionWorkedMinutes,
    hasLunchOnDate,
    roundArrival,
    roundDeparture,
} from '../lib/attendance'

type MessageTone = 'success' | 'info' | 'error'

interface DashboardMessage {
    text: string
    tone: MessageTone
}

interface WorkSession {
    id: number
    started_at: string
    ended_at: string | null
    lunch_started_at: string | null
    planned_departure_at: string | null
}

interface HistorySession {
    id: number
    started_at: string
    ended_at: string
    lunch_started_at: string | null
    planned_departure_at: string | null
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
    onOpenAdmin?: () => void
}

const PAGE_SIZE = 1000
const dashboardViews = [
    { id: 'dashboard', label: 'Přehled' },
    { id: 'leave', label: 'Volno' },
    { id: 'history', label: 'Historie' },
    { id: 'statistics', label: 'Statistiky' },
] as const
type DashboardView = typeof dashboardViews[number]['id']

function getDateRange(from: string, to: string): string[] {
    const dates: string[] = []
    const current = new Date(`${from}T00:00:00Z`)
    const end = new Date(`${to}T00:00:00Z`)

    while (current <= end) {
        dates.push(current.toISOString().slice(0, 10))
        current.setUTCDate(current.getUTCDate() + 1)
    }

    return dates
}

function formatDayLabel(date: string): string {
    return new Intl.DateTimeFormat('cs-CZ', {
        weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`))
}

function Dashboard({ userId, email, onLogout, onOpenAdmin }: DashboardProps) {
    const [view, setView] = useState<DashboardView>('dashboard')
    const [menuOpen, setMenuOpen] = useState(false)
    const [now, setNow] = useState(() => new Date())
    const [workSession, setWorkSession] = useState<WorkSession | null>(null)
    const [openSessionLoaded, setOpenSessionLoaded] = useState(false)
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState(false)
    const [message, setMessageState] = useState<DashboardMessage | null>(null)
    const setMessage = useCallback(
        (text: string | null, tone: MessageTone = 'error') => {
            setMessageState(text === null ? null : { text, tone })
        },
        [],
    )
    const [history, setHistory] = useState<HistorySession[]>([])
    const [historyLoaded, setHistoryLoaded] = useState(false)
    const [workDaysLoaded, setWorkDaysLoaded] = useState(false)
    const [statisticsMonth, setStatisticsMonth] = useState(
        () => formatInTimeZone(new Date(), APP_TIMEZONE, 'yyyy-MM'),
    )
    const [monthlyOvertimeMinutes, setMonthlyOvertimeMinutes] = useState(0)
    const [dailyBalances, setDailyBalances] = useState<
        ReturnType<typeof calculateDailyBalances>
    >([])
    const [dayType, setDayType] = useState<'vacation' | 'sick_day' | 'comp_time' | 'mandatory_vacation'>('vacation')
    const [dayDuration, setDayDuration] = useState(480)
    const [dayDateFrom, setDayDateFrom] = useState('')
    const [dayDateTo, setDayDateTo] = useState('')
    const [dayNote, setDayNote] = useState('')
    const [workDays, setWorkDays] = useState<WorkDay[]>([])
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const [workDaysLoading, setWorkDaysLoading] = useState(true)
    const [compHours, setCompHours] = useState(0)
    const [compMinutes, setCompMinutes] = useState(15)
    const [editingSessionId, setEditingSessionId] = useState<number | null>(null)
    const [editedArrival, setEditedArrival] = useState('')
    const [editedDeparture, setEditedDeparture] = useState('')
    const [pendingAction, setPendingAction] = useState<'arrival' | 'departure' | null>(null)
    const [pendingTime, setPendingTime] = useState('')
    const [pendingDate, setPendingDate] = useState('')
    const [planDeparture, setPlanDeparture] = useState(false)
    const [plannedDepartureTime, setPlannedDepartureTime] = useState('16:30')


    const loadWorkDays = useCallback(async () => {
        setWorkDaysLoaded(false)
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
            allWorkDays.push(...page.map((day) => ({
                ...day, duration_minutes: day.duration_minutes ?? 480,
            })))

            if (page.length === 0) {
                break
            }

            offset += page.length
        }

        setWorkDays(allWorkDays)
        setWorkDaysLoaded(true)
        setWorkDaysLoading(false)
    }, [setMessage, userId])

    const loadOpenSession = useCallback(async () => {
        setOpenSessionLoaded(false)
        const { error: finishError } = await supabase.rpc('finish_my_planned_departure')
        if (finishError) {
            console.error('Failed to finish planned departure:', finishError)
            setMessage('Nepodařilo se ověřit plánovaný odchod.')
            setLoading(false)
            return null
        }
        const { data, error } = await supabase
            .from('work_sessions')
            .select('id, started_at, ended_at, lunch_started_at, planned_departure_at')
            .eq('user_id', userId)
            .is('ended_at', null)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (error) {
            console.error('Failed to load open session:', error)
            setMessage('Nepodařilo se načíst otevřenou docházku.')
            setLoading(false)
            return null
        }

        setWorkSession(data)
        setOpenSessionLoaded(true)
        setLoading(false)
        return data
    }, [setMessage, userId])

    const loadHistory = useCallback(async () => {
        setHistoryLoaded(false)
        const allSessions: HistorySession[] = []
        let offset = 0

        while (true) {
            const { data, error } = await supabase
                .from('work_sessions')
                .select('id, started_at, ended_at, lunch_started_at, planned_departure_at')
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

            if (page.length === 0) {
                break
            }

            offset += page.length
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
            allWorkDaysToDate.push(...page.map((day) => ({
                ...day, duration_minutes: day.duration_minutes ?? 480,
            })))

            if (page.length === 0) {
                break
            }

            offset += page.length
        }

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
        setMonthlyOvertimeMinutes(
            calculateRunningOvertime(dailyBalances),
        )
        setHistoryLoaded(true)
    }, [setMessage, userId])

    useEffect(() => {
        void Promise.resolve().then(async () => {
            await loadOpenSession()
            await Promise.all([loadHistory(), loadWorkDays()])
        })
    }, [loadHistory, loadOpenSession, loadWorkDays])

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 30_000)
        return () => window.clearInterval(timer)
    }, [])

    useEffect(() => {
        if (!workSession?.planned_departure_at) return
        let refreshing = false
        const refresh = async () => {
            if (refreshing) return
            refreshing = true
            try {
                await loadOpenSession()
                await loadHistory()
            } finally {
                refreshing = false
            }
        }
        const timer = window.setInterval(() => void refresh(), 30_000)
        window.addEventListener('focus', refresh)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener('focus', refresh)
        }
    }, [workSession?.planned_departure_at, loadOpenSession, loadHistory])

async function addLeaveRecords(input: LeaveInput): Promise<boolean> {
    const { type: dayType, dateFrom: dayDateFrom, note: dayNote } = input

    if (!dayDateFrom) {
        setMessage('Vyber datum od.')
        return false
    }

    const dateTo = input.dateTo || dayDateFrom

    if (dayType === 'mandatory_vacation' && dateTo !== dayDateFrom) {
        setMessage('Celozávodní dovolenou zadej pro jeden konkrétní den.')
        return false
    }

    if (dateTo < dayDateFrom) {
        setMessage('Datum do nemůže být před datem od.')
        return false
    }

    const duration =
        dayType === 'mandatory_vacation' || dayType === 'sick_day'
            ? 480
            : input.durationMinutes

    setActionLoading(true)
    setMessage(null)

    if (dayType === 'comp_time' && duration < 15) {
        setMessage(
            'Náhradní volno musí trvat alespoň 15 minut.',
        )
        setActionLoading(false)
        return false
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
        return false
    }

    // Náhradní volno se zadává pouze pro jeden konkrétní den.
    if (dayType === 'comp_time' && dates.length > 1) {
        setMessage(
            'Náhradní volno lze přidat pouze pro jeden den.',
        )
        setActionLoading(false)
        return false
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
        return false
    }

    // Kontrola ročních limitů.
    // Rozsah může překračovat hranici roku,
    // proto kontrolujeme každý rok samostatně.

    if (
        usesVacationAllowance(dayType) ||
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
                        (dayType === 'sick_day'
                            ? day.type === 'sick_day'
                            : usesVacationAllowance(day.type)),
                )
                .reduce(
                    (total, day) =>
                        total + day.duration_minutes,
                    0,
                )

            const limitMinutes =
                usesVacationAllowance(dayType)
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
                    usesVacationAllowance(dayType)
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
                return false
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
        setActionLoading(false)
        return false
    } else {
        setMessage(
            dates.length === 1
                ? 'Záznam uložen.'
                : `Uloženo ${dates.length} pracovních dnů.`,
            'success',
        )

        await loadWorkDays()
        await loadHistory()
    }

    setActionLoading(false)
    return true
}

async function handleAddDayRecord() {
    const saved = await addLeaveRecords({
        type: dayType,
        dateFrom: dayDateFrom,
        dateTo: dayDateTo,
        durationMinutes:
            dayType === 'comp_time'
                ? compHours * 60 + compMinutes
                : dayDuration,
        note: dayNote,
    })

    if (saved) {
        setDayDateFrom('')
        setDayDateTo('')
        setDayNote('')
        setDayDuration(480)
        setCompHours(0)
        setCompMinutes(15)
    }
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
        setMessage('Záznam byl smazán.', 'success')
        await loadWorkDays()
        await loadHistory()
    }

    setActionLoading(false)
}

  function openTimePicker(action: 'arrival' | 'departure') {
    const current = new Date()
    const today = formatInTimeZone(current, APP_TIMEZONE, 'yyyy-MM-dd')
    setPendingAction(action)
    setPendingDate(today)
    setPendingTime(formatInTimeZone(current, APP_TIMEZONE, 'HH:mm'))
    setMessage(null)
    setPlanDeparture(false)

    // A session left open from an earlier day is most likely finished on its
    // arrival day: suggest arrival + 8 h 30 min, at the latest 23:45 that day.
    if (action === 'departure' && workSession) {
      const startDate = formatInTimeZone(
        new Date(workSession.started_at), APP_TIMEZONE, 'yyyy-MM-dd',
      )

      if (startDate < today) {
        const suggested = new Date(
          new Date(workSession.started_at).getTime() + 510 * 60 * 1000,
        )
        const suggestedTime =
          formatInTimeZone(suggested, APP_TIMEZONE, 'yyyy-MM-dd') === startDate
            ? formatInTimeZone(suggested, APP_TIMEZONE, 'HH:mm')
            : '23:45'
        setPendingDate(startDate)
        setPendingTime(suggestedTime)
      }
    }
  }

  function closeTimePicker() {
    setPendingAction(null)
    setPendingTime('')
    setPendingDate('')
    setPlanDeparture(false)
  }

  function parsePendingTime(date?: string): Date | null {
    const day = date || formatInTimeZone(new Date(), APP_TIMEZONE, 'yyyy-MM-dd')
    const value = parseDateTimeLocal(`${day}T${pendingTime}`)

    if (!/^\d{2}:\d{2}$/.test(pendingTime) || !Number.isFinite(value.getTime())) {
      setMessage('Zadej platný čas.')
      return null
    }

    // The time input has minute precision, so allow the current minute.
    if (value.getTime() > new Date().getTime() + 60_000) {
      setMessage('Čas nemůže být v budoucnosti.')
      return null
    }

    return value
  }

  async function handleArrival() {
    if (todayFullyCovered) {
        setMessage('Dnes nemáš žádnou pracovní povinnost.', 'info')
        return
    }

    const arrival = parsePendingTime()
    if (!arrival) {
      return
    }

    const plannedDeparture = planDeparture
      ? parseDateTimeLocal(`${formatInTimeZone(arrival, APP_TIMEZONE, 'yyyy-MM-dd')}T${plannedDepartureTime}`)
      : null
    if (plannedDeparture && (
      !Number.isFinite(plannedDeparture.getTime()) ||
      plannedDeparture <= arrival || plannedDeparture <= new Date()
    )) {
      setMessage('Plánovaný odchod musí být později než příchod a v budoucnosti.')
      return
    }

    setActionLoading(true)
    setMessage(null)

    const { data: overlapping, error: overlapError } = await supabase
      .from('work_sessions')
      .select('id')
      .eq('user_id', userId)
      .gt('ended_at', arrival.toISOString())
      .limit(1)

    if (overlapError) {
      console.error('Failed to check overlapping sessions:', overlapError)
      setMessage('Nepodařilo se ověřit předchozí docházku.')
      setActionLoading(false)
      return
    }

    if (overlapping.length > 0) {
      setMessage('Zvolený příchod spadá do již zaznamenané docházky.')
      setActionLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('work_sessions')
      .insert({
        user_id: userId,
        started_at: arrival.toISOString(),
        planned_departure_at: plannedDeparture?.toISOString() ?? null,
      })
      .select('id, started_at, ended_at, lunch_started_at, planned_departure_at')
      .single()

    if (error) {
      console.error('Failed to record arrival:', error)
      if (error.code === '23505') {
        const openSession = await loadOpenSession()
        closeTimePicker()
        if (openSession) {
          setMessage('Načtena otevřená docházka z jiného zařízení.', 'info')
        } else {
          setMessage(
            'Příchod již existuje, ale nepodařilo se načíst otevřenou docházku.',
          )
        }
      } else {
        setMessage('Nepodařilo se zaznamenat příchod.')
      }
    } else {
      setWorkSession(data)
      closeTimePicker()
      setMessage('Příchod zaznamenán.', 'success')
    }

    setActionLoading(false)
  }

  async function handleLunch() {
    if (!workSession) {
      return
    }

    if (lunchAlreadyTaken) {
      setMessage('Oběd už byl dnes započítán.')
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
      .is('ended_at', null)
      .is('lunch_started_at', null)
      .select('id, started_at, ended_at, lunch_started_at, planned_departure_at')
      .single()

    if (error) {
      console.error('Failed to record lunch:', error)
      setMessage(
        error.code === '23514'
          ? 'Oběd už byl dnes započítán.'
          : 'Nepodařilo se zaznamenat oběd.',
      )
      await loadOpenSession()
      await loadHistory()
    } else {
      setWorkSession(data)
      setMessage('Oběd zaznamenán na 30 minut.', 'success')
    }

    setActionLoading(false)
  }

  async function handleDeparture() {
    if (!workSession) {
      return
    }

    const departure = parsePendingTime(pendingDate)
    if (!departure) {
      return
    }

    if (departure <= new Date(workSession.started_at)) {
      setMessage('Odchod musí být později než příchod.')
      return
    }

    if (
      workSession.lunch_started_at &&
      departure <= new Date(workSession.lunch_started_at)
    ) {
      setMessage('Odchod musí být později než začátek oběda.')
      return
    }

    setActionLoading(true)
    setMessage(null)

    const { error } = await supabase
      .from('work_sessions')
      .update({
        ended_at: departure.toISOString(),
      })
      .eq('id', workSession.id)
      .is('ended_at', null)
      .select('id, started_at, ended_at, lunch_started_at')
      .single()

    if (error) {
      console.error('Failed to record departure:', error)
      setMessage(
        error.code === 'PGRST116'
          ? 'Docházka již byla ukončena. Načítám aktuální záznam.'
          : 'Nepodařilo se zaznamenat odchod.',
      )
      await loadOpenSession()
      await loadHistory()
    } else {
        setWorkSession(null)
        closeTimePicker()
        setMessage('Odchod zaznamenán.', 'success')
        await loadHistory()
    }

    setActionLoading(false)
  }

  function renderTimePicker(action: 'arrival' | 'departure') {
    const label = action === 'arrival' ? 'Čas příchodu' : 'Čas odchodu'
    const departureDates =
      action === 'departure' && openSessionStartDate && openSessionStartDate < todayDate
        ? getDateRange(openSessionStartDate, todayDate)
        : []

    return (
      <form
        className="time-picker"
        onSubmit={(event) => {
          event.preventDefault()
          void (action === 'arrival' ? handleArrival() : handleDeparture())
        }}
      >
        {departureDates.length > 0 && (
          <div className="form-field time-picker-field">
            <label htmlFor="departure-date">Den odchodu</label>
            <select
              id="departure-date"
              value={pendingDate}
              onChange={(event) => setPendingDate(event.target.value)}
              disabled={actionLoading}
            >
              {departureDates.map((date) => (
                <option key={date} value={date}>
                  {formatDayLabel(date)}
                  {date === todayDate ? ' (dnes)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="form-field time-picker-field">
          <label htmlFor={`${action}-time`}>{label}</label>
          <TimeInput
            id={`${action}-time`}
            value={pendingTime}
            onChange={setPendingTime}
            disabled={actionLoading}
            autoFocus
          />
        </div>
        {action === 'arrival' && (
          <>
            <label>
              <input
                type="checkbox"
                checked={planDeparture}
                onChange={(event) => setPlanDeparture(event.target.checked)}
                disabled={actionLoading}
              />{' '}
              Naplánovat automatický odchod (volitelné)
            </label>
            {planDeparture && (
              <div className="form-field time-picker-field">
                <label htmlFor="planned-departure-time">Plánovaný čas odchodu</label>
                <TimeInput
                  id="planned-departure-time"
                  value={plannedDepartureTime}
                  onChange={setPlannedDepartureTime}
                  disabled={actionLoading}
                />
                <p className="calendar-note">
                  Docházka se dnes automaticky ukončí v tomto čase, i když aplikaci zavřeš.
                  Dřívější odchod můžeš zaznamenat tlačítkem Odchod.
                </p>
              </div>
            )}
          </>
        )}
        <div className="time-picker-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={actionLoading}
          >
            {actionLoading ? 'Ukládám...' : 'Potvrdit'}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={closeTimePicker}
            disabled={actionLoading}
          >
            Zrušit
          </button>
        </div>
      </form>
    )
  }

  function handleEditSession(session: HistorySession) {
    setEditingSessionId(session.id)
    setEditedArrival(formatDateTimeLocal(session.started_at))
    setEditedDeparture(formatDateTimeLocal(session.ended_at))
    setMessage(null)
  }

  async function saveSession(change: SessionChange): Promise<boolean> {
    const validationError = validateSessionChange(
      change,
      workSession ? [...history, workSession] : history,
    )

    if (validationError) {
      setMessage(validationError)
      return false
    }

    setActionLoading(true)
    setMessage(null)

    const values = {
      started_at: change.arrival.toISOString(),
      ...(change.departure
        ? { ended_at: change.departure.toISOString() }
        : {}),
    }

    const { error } =
      change.id === null
        ? await supabase
            .from('work_sessions')
            .insert({ user_id: userId, ...values })
            .select('id')
            .single()
        : await supabase
            .from('work_sessions')
            .update(values)
            .eq('id', change.id)
            .eq('user_id', userId)
            .select('id')
            .single()

    if (error) {
      console.error('Failed to save work session:', error)
      setMessage(
        error.code === '23P01'
          ? 'Docházka se překrývá s jiným záznamem.'
          : error.code === '23514'
            ? 'Časy neodpovídají zaznamenanému obědu nebo plánovanému odchodu.'
            : 'Nepodařilo se uložit docházku.',
      )
      setActionLoading(false)
      return false
    }

    setMessage(
      change.id === null ? 'Docházka přidána.' : 'Docházka upravena.',
      'success',
    )
    await Promise.all([loadHistory(), loadOpenSession()])
    setActionLoading(false)
    return true
  }

  async function deleteSession(id: number) {
    if (!window.confirm('Opravdu chceš tento pracovní záznam smazat?')) {
      return
    }

    setActionLoading(true)
    setMessage(null)

    const { error } = await supabase
      .from('work_sessions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id')
      .single()

    if (error) {
      console.error('Failed to delete work session:', error)
      // PGRST116: no row was deleted (missing delete policy or record already gone).
      setMessage(
        error.code === 'PGRST116'
          ? 'Záznam nelze smazat – chybí oprávnění v databázi, nebo byl záznam už smazán.'
          : 'Nepodařilo se smazat docházku.',
      )
      await Promise.all([loadHistory(), loadOpenSession()])
    } else {
      if (workSession?.id === id) {
        closeTimePicker()
      }
      setMessage('Docházka smazána.', 'success')
      await Promise.all([loadHistory(), loadOpenSession()])
    }

    setActionLoading(false)
  }

  async function handleSaveSession(session: HistorySession) {
    const saved = await saveSession({
      id: session.id,
      arrival: parseDateTimeLocal(editedArrival),
      departure: parseDateTimeLocal(editedDeparture),
      lunchStartedAt: session.lunch_started_at,
    })

    if (saved) {
      setEditingSessionId(null)
    }
  }

  function handleCancelEdit() {
    setEditingSessionId(null)
    setEditedArrival('')
    setEditedDeparture('')
    setMessage(null)
  }

function renderMessage() {
    if (!message) {
        return null
    }

    return (

                <div
                    className={`message message-${message.tone}`}
                    role={message.tone === 'error' ? 'alert' : 'status'}
                >
                    <span className="message-icon" aria-hidden="true">
                        {message.tone === 'error' ? '!' : message.tone === 'success' ? '✓' : 'i'}
                    </span>
                    <span className="message-text">{message.text}</span>
                    <button
                        type="button"
                        className="message-close"
                        aria-label="Zavřít zprávu"
                        onClick={() => setMessage(null)}
                    >
                        ×
                    </button>
                </div>
    )
}

const todayDate = formatInTimeZone(
    now,
    APP_TIMEZONE,
    'yyyy-MM-dd',
)
const monthlyStatistics = getMonthlyStatistics(
    workSession ? [...history, workSession] : history,
    workDays,
    statisticsMonth,
    now,
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

const historyLunchDeductions = getDailyLunchDeductions(history)

const todayCompletedSessions = history.filter(
    (session) =>
        formatInTimeZone(
            new Date(session.started_at),
            APP_TIMEZONE,
            'yyyy-MM-dd',
        ) === todayDate,
)

const openSessionStartDate =
    workSession && !workSession.ended_at
        ? formatInTimeZone(new Date(workSession.started_at), APP_TIMEZONE, 'yyyy-MM-dd')
        : null

const openSessionToday =
    workSession && !workSession.ended_at &&
    formatInTimeZone(new Date(workSession.started_at), APP_TIMEZONE, 'yyyy-MM-dd') === todayDate
        ? workSession
        : null

const todayLunchDeductions = getDailyLunchDeductions<WorkSession>([
    ...todayCompletedSessions,
    ...(openSessionToday ? [openSessionToday] : []),
])

const todayCompletedWorkedMinutes =
    todayCompletedSessions.reduce(
        (total, session) =>
            total +
            calculateSessionWorkedMinutes(
                session,
                todayLunchDeductions.get(session) ?? null,
            ),
        0,
    )

const todayCurrentWorkedMinutes =
    openSessionToday
        ? calculateCurrentWorkedMinutes(
              new Date(openSessionToday.started_at),
              now,
              todayLunchDeductions.get(openSessionToday) === 'recorded',
          )
        : 0

// One lunch per day, counted by the Prague date of the open session's arrival.
const lunchAlreadyTaken =
    workSession !== null &&
    hasLunchOnDate(
        [...history, workSession],
        formatInTimeZone(new Date(workSession.started_at), APP_TIMEZONE, 'yyyy-MM-dd'),
    )

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

const requiredFromOpenSession = Math.max(
    0,
    480 - todayCreditedMinutes - todayCompTimeMinutes - todayCompletedWorkedMinutes,
)
const shiftEnd = openSessionToday
    ? calculateShiftEnd(
          new Date(openSessionToday.started_at),
          requiredFromOpenSession,
          todayLunchDeductions.get(openSessionToday) === 'recorded',
          !todayCompletedSessions.some(
              (session) => todayLunchDeductions.get(session) !== null,
          ),
      )
    : null
const shiftRemainingMinutes = shiftEnd ? calculateMinutesUntil(shiftEnd, now) : 0
const plannedDepartureRemainingMinutes = workSession?.planned_departure_at
    ? calculateMinutesUntil(new Date(workSession.planned_departure_at), now)
    : null

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

const vacationUsedMinutes = getVacationUsedMinutes(currentYearWorkDays)

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
                <h1>{dashboardViews.find((item) => item.id === view)?.label}</h1>
                <p className="dashboard-user">
                    Přihlášen jako {email}
                </p>
            </div>

            <div className="dashboard-header-actions">
                <div className="dashboard-navigation">
                    <button
                        id="navigation-toggle"
                        className="button button-secondary menu-toggle"
                        aria-label={menuOpen ? 'Zavřít navigaci' : 'Otevřít navigaci'}
                        aria-expanded={menuOpen}
                        aria-controls="dashboard-navigation"
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <span className="hamburger-icon" aria-hidden="true">
                            <span /><span /><span />
                        </span>
                        Menu
                    </button>
                    {menuOpen && (
                        <nav id="dashboard-navigation" className="dashboard-menu" aria-label="Hlavní navigace"
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    setMenuOpen(false)
                                    document.getElementById('navigation-toggle')?.focus()
                                }
                            }}>
                            {dashboardViews.map((item) => (
                                <button key={item.id} className="dashboard-menu-item"
                                    aria-current={view === item.id ? 'page' : undefined}
                                    onClick={() => {
                                        setView(item.id)
                                        setMenuOpen(false)
                                        document.getElementById('navigation-toggle')?.focus()
                                    }}>
                                    {item.label}
                                </button>
                            ))}
                            {onOpenAdmin && (
                                <button className="dashboard-menu-item" onClick={onOpenAdmin}>
                                    Administrace
                                </button>
                            )}
                            <hr className="dashboard-menu-separator" />
                            <button className="dashboard-menu-item dashboard-menu-logout" onClick={onLogout}>
                                Odhlásit
                            </button>
                        </nav>
                    )}
                </div>
            </div>
        </header>

        <main className="dashboard-content">
          {/* ==================== MESSAGE ==================== */}
            {!selectedDate && renderMessage()}

            {/* ==================== TODAY ==================== */}

            {view === 'dashboard' && (
            <>
            <section className="dashboard-section">
                <div className="section-heading">
                    <div>
                        <p className="section-eyebrow">DNES</p>
                        <h2>Pracovní den</h2>
                        <p className="today-date">
                            <time dateTime={todayDate}>
                                {new Intl.DateTimeFormat('cs-CZ', {
                                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                                    timeZone: APP_TIMEZONE,
                                }).format(now)}
                            </time>
                        </p>
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

                            {openSessionStartDate && openSessionStartDate < todayDate && (
                                <p className="message message-info message-block" role="status">
                                    Docházka z {formatDayLabel(openSessionStartDate)} nebyla ukončena.
                                    Zadej odchod – den odchodu můžeš vybrat.
                                </p>
                            )}

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
                                    <span className="stat-description">
                                        {formatDate(workSession.started_at)}
                                    </span>
                                    {workSession.planned_departure_at && (
                                        <span className="stat-description">
                                            Automatický odchod: {formatTime(workSession.planned_departure_at)}
                                        </span>
                                    )}
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
                                    {!lunchAlreadyTaken && openSessionStartDate === todayDate && (
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

                                    {pendingAction === 'departure' ? (
                                        renderTimePicker('departure')
                                    ) : (
                                        <button
                                            className="button button-primary"
                                            onClick={() => openTimePicker('departure')}
                                            disabled={actionLoading}
                                        >
                                            Odchod
                                        </button>
                                    )}
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

                            <p>Dnešní pracovní povinnost je splněna prací nebo volnem.</p>
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

                            {pendingAction === 'arrival' ? (
                                renderTimePicker('arrival')
                            ) : (
                                <button
                                    className="button button-primary button-large"
                                    onClick={() => openTimePicker('arrival')}
                                    disabled={actionLoading}
                                >
                                    Příchod
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div className="stats-grid today-summary">
                    <div className="stat-card">
                        <span className="stat-label">Odpracováno dnes</span>
                        <strong className="stat-value">{formatDuration(todayWorkedMinutes, false)}</strong>
                    </div>
                    <div className="stat-card">
                        <span className="stat-label">
                            {shiftEnd ? 'Do konce směny' : 'Zbývá odpracovat'}
                        </span>
                        <strong className="stat-value">
                            {formatDuration(shiftEnd ? shiftRemainingMinutes : todayRemainingMinutes, false)}
                        </strong>
                        <span className="stat-description">
                            {shiftEnd
                                ? `Do splnění denní povinnosti (${formatTime(shiftEnd.toISOString())}), včetně oběda.`
                                : 'Čistý pracovní čas, bez přestávky na oběd.'}
                        </span>
                    </div>
                    {plannedDepartureRemainingMinutes !== null && workSession?.planned_departure_at && (
                        <div className="stat-card">
                            <span className="stat-label">Do plánovaného odchodu</span>
                            <strong className="stat-value">
                                {formatDuration(plannedDepartureRemainingMinutes, false)}
                            </strong>
                            <span className="stat-description">
                                Automatický odchod v {formatTime(workSession.planned_departure_at)}.
                                Nezávisí na splnění denní povinnosti.
                            </span>
                        </div>
                    )}
                </div>
            </section>
            <AttendanceCalendar
                today={todayDate}
                sessions={workSession ? [...history, workSession] : history}
                workDays={workDays}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
            />
            {selectedDate && (
                <CalendarDayPanel
                    key={selectedDate}
                    date={selectedDate}
                    today={todayDate}
                    holiday={getCzechHolidays(Number(selectedDate.slice(0, 4))).get(selectedDate)}
                    sessions={(workSession ? [...history, workSession] : history).filter(
                        (session) =>
                            formatInTimeZone(new Date(session.started_at), APP_TIMEZONE, 'yyyy-MM-dd') === selectedDate,
                    )}
                    leave={workDays.filter((day) => day.date === selectedDate)}
                    busy={actionLoading}
                    message={renderMessage()}
                    onClose={() => {
                        setSelectedDate(null)
                        setMessage(null)
                    }}
                    onSaveSession={saveSession}
                    onDeleteSession={deleteSession}
                    onAddLeave={addLeaveRecords}
                    onDeleteLeave={handleDeleteDayRecord}
                />
            )}
            </>
            )}

            {/* ==================== STATISTICS ==================== */}

            {view === 'statistics' && (
            <section className="dashboard-section">
                <div className="form-field">
                    <label htmlFor="statistics-month">Měsíc</label>
                    <MonthInput
                        id="statistics-month"
                        value={statisticsMonth}
                        onChange={setStatisticsMonth}
                    />
                </div>
                <AttendanceExport
                    sessions={workSession ? [...history, workSession] : history}
                    leave={workDays}
                    month={statisticsMonth}
                    disabled={actionLoading || !historyLoaded || !workDaysLoaded || !openSessionLoaded}
                    onError={setMessage}
                />
                <MonthlyStatisticsCards statistics={monthlyStatistics} />
                <div className="stats-grid">
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
            )}

  
            {/* ==================== HISTORY ==================== */}

            {view === 'history' && (
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
                                    const lunchDeduction =
                                        historyLunchDeductions.get(session) ?? null
                                    const workedMinutes =
                                        calculateSessionWorkedMinutes(
                                            session,
                                            lunchDeduction,
                                        )
                                    const automaticLunchStart =
                                        getAutomaticLunchStart(
                                            new Date(session.started_at),
                                            new Date(session.ended_at),
                                            false,
                                            lunchDeduction === 'automatic',
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
                                                      )}${
                                                          lunchDeduction === 'recorded'
                                                              ? ''
                                                              : ' (nezapočteno, oběd už byl tento den)'
                                                      }`
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
                                                                <DateTimeInput
                                                                    id={`arrival-${session.id}`}
                                                                    value={editedArrival}
                                                                    onChange={setEditedArrival}
                                                                    disabled={actionLoading}
                                                                />
                                                            </div>
                                                            <div className="form-field">
                                                                <label
                                                                    htmlFor={`departure-${session.id}`}
                                                                >
                                                                    Odchod
                                                                </label>
                                                                <DateTimeInput
                                                                    id={`departure-${session.id}`}
                                                                    value={editedDeparture}
                                                                    onChange={setEditedDeparture}
                                                                    disabled={actionLoading}
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
            )}

            {/* ==================== TIME OFF ==================== */}

                

            {/* ==================== SAVED TIME OFF ==================== */}
            {view === 'leave' && (
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
                                disabled={dayType === 'mandatory_vacation'}
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
                                onChange={(event) => {
                                    if (event.target.value === 'mandatory_vacation') {
                                        setDayDateTo('')
                                    }
                                    setDayType(
                                        event.target.value as
                                            | 'vacation'
                                            | 'sick_day'
                                            | 'comp_time'
                                            | 'mandatory_vacation',
                                    )
                                }}
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
                                <option value="mandatory_vacation">
                                    Celozávodní dovolená
                                </option>
                            </select>
                        </div>
                        <p className="calendar-note form-field-wide">
                            Celozávodní dovolená: 8 hodin pro jeden pracovní den.
                            Odečítá se ze společného ročního limitu dovolené.
                        </p>

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
                                            {leaveLabels[day.type]}
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
            )}
        </main>
    </div>
)
}

export default Dashboard