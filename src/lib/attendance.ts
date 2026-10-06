import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const APP_TIMEZONE = 'Europe/Prague'
const LUNCH_MINUTES = 30
const AUTOMATIC_LUNCH_AFTER_MINUTES = 5 * 60

export interface WorkSessionForBalance {
  started_at: string
  ended_at: string
  lunch_started_at: string | null
}

export interface WorkDayForBalance {
  date: string
  type:
    | 'holiday'
    | 'vacation'
    | 'sick_day'
    | 'comp_time'
    | 'mandatory_vacation'
  duration_minutes: number
}

export interface DailyBalance {
  date: string
  workedMinutes: number
  creditedMinutes: number
  compTimeMinutes: number
  balanceMinutes: number
  overtimeChangeMinutes: number
}

/**
 * Zaokrouhlí příchod nahoru na nejbližších 15 minut.
 */
export function roundArrival(date: Date): Date {
  const localTime = formatInTimeZone(
    date,
    APP_TIMEZONE,
    'yyyy-MM-dd HH:mm',
  )

  const [datePart, timePart] = localTime.split(' ')
  const [hours, minutes] = timePart.split(':').map(Number)

  const roundedMinutes = Math.ceil(minutes / 15) * 15

  let roundedHours = hours
  let finalMinutes = roundedMinutes

  if (roundedMinutes === 60) {
    roundedHours += 1
    finalMinutes = 0
  }

  const roundedLocalTime =
    `${datePart} ${String(roundedHours).padStart(2, '0')}:` +
    `${String(finalMinutes).padStart(2, '0')}:00`

  return fromZonedTime(
    roundedLocalTime,
    APP_TIMEZONE,
  )
}

/**
 * Zaokrouhlí odchod dolů na nejbližších 15 minut.
 */
export function roundDeparture(date: Date): Date {
  const localTime = formatInTimeZone(
    date,
    APP_TIMEZONE,
    'yyyy-MM-dd HH:mm',
  )

  const [datePart, timePart] = localTime.split(' ')
  const [hours, minutes] = timePart.split(':').map(Number)

  const roundedMinutes = Math.floor(minutes / 15) * 15

  const roundedLocalTime =
    `${datePart} ${String(hours).padStart(2, '0')}:` +
    `${String(roundedMinutes).padStart(2, '0')}:00`

  return fromZonedTime(
    roundedLocalTime,
    APP_TIMEZONE,
  )
}

export interface LunchSession {
  started_at: string
  ended_at: string | null
  lunch_started_at: string | null
}

export type LunchDeduction = 'recorded' | 'automatic' | null

function getPragueDate(timestamp: string): string {
  return formatInTimeZone(new Date(timestamp), APP_TIMEZONE, 'yyyy-MM-dd')
}

function exceedsAutomaticLunchThreshold(arrival: Date, departure: Date): boolean {
  const totalMinutes =
    (roundDeparture(departure).getTime() - roundArrival(arrival).getTime()) /
    (1000 * 60)

  return totalMinutes > AUTOMATIC_LUNCH_AFTER_MINUTES
}

/**
 * Každý den (podle data příchodu v Praze) má nejvýše jeden oběd.
 * Zaznamenaný oběd má přednost. Pokud v daný den žádný není,
 * automatický oběd dostane první dokončená session delší než 5 hodin.
 */
export function getDailyLunchDeductions<T extends LunchSession>(
  sessions: T[],
): Map<T, LunchDeduction> {
  const deductions = new Map<T, LunchDeduction>()
  const sessionsByDate = new Map<string, T[]>()

  for (const session of sessions) {
    deductions.set(session, null)
    const date = getPragueDate(session.started_at)
    const daySessions = sessionsByDate.get(date) ?? []
    daySessions.push(session)
    sessionsByDate.set(date, daySessions)
  }

  for (const daySessions of sessionsByDate.values()) {
    const ordered = [...daySessions].sort(
      (left, right) =>
        new Date(left.started_at).getTime() -
        new Date(right.started_at).getTime(),
    )

    const recorded = ordered.find(
      (session) => session.lunch_started_at !== null,
    )

    if (recorded) {
      deductions.set(recorded, 'recorded')
      continue
    }

    const automatic = ordered.find(
      (session) =>
        session.ended_at !== null &&
        exceedsAutomaticLunchThreshold(
          new Date(session.started_at),
          new Date(session.ended_at),
        ),
    )

    if (automatic) {
      deductions.set(automatic, 'automatic')
    }
  }

  return deductions
}

export function hasLunchOnDate(
  sessions: LunchSession[],
  date: string,
): boolean {
  const daySessions = sessions.filter(
    (session) => getPragueDate(session.started_at) === date,
  )
  const deductions = getDailyLunchDeductions(daySessions)

  return [...deductions.values()].some((deduction) => deduction !== null)
}

export function getAutomaticLunchStart(
  arrival: Date,
  departure: Date,
  hasLunch: boolean,
  allowAutomaticLunch = true,
): Date | null {
  if (hasLunch || !allowAutomaticLunch) {
    return null
  }

  const roundedArrival = roundArrival(arrival)
  const roundedDeparture = roundDeparture(departure)
  const totalMinutes =
    (roundedDeparture.getTime() - roundedArrival.getTime()) /
    (1000 * 60)

  return totalMinutes > AUTOMATIC_LUNCH_AFTER_MINUTES
    ? new Date(
        roundedArrival.getTime() +
          AUTOMATIC_LUNCH_AFTER_MINUTES * 60 * 1000,
      )
    : null
}

/**
 * Spočítá čistý odpracovaný čas.
 * Oběd má vždy 30 minut.
 */


export function calculateWorkedMinutes(
  arrival: Date,
  departure: Date,
  hasLunch: boolean,
  allowAutomaticLunch = true,
): number {
  const roundedArrival = roundArrival(arrival)
  const roundedDeparture = roundDeparture(departure)

  const totalMinutes =
    (roundedDeparture.getTime() -
      roundedArrival.getTime()) /
    (1000 * 60)

  const lunchMinutes =
    hasLunch ||
    (allowAutomaticLunch &&
      totalMinutes > AUTOMATIC_LUNCH_AFTER_MINUTES)
      ? LUNCH_MINUTES
      : 0

  return Math.max(0, totalMinutes - lunchMinutes)
}


export function calculateSessionWorkedMinutes(
  session: WorkSessionForBalance,
  deduction: LunchDeduction,
): number {
  return calculateWorkedMinutes(
    new Date(session.started_at),
    new Date(session.ended_at),
    deduction === 'recorded',
    deduction === 'automatic',
  )
}

export function calculateCurrentWorkedMinutes(
  arrival: Date,
  now: Date,
  hasLunch: boolean,
): number {
  const roundedArrival = roundArrival(arrival)
  const roundedNow = roundDeparture(now)

  const totalMinutes =
    (roundedNow.getTime() -
      roundedArrival.getTime()) /
    (1000 * 60)

  const lunchMinutes = hasLunch ? LUNCH_MINUTES : 0

  return Math.max(
    0,
    totalMinutes - lunchMinutes,
  )
}

/**
 * Spočítá bilanci jednoho dne.
 *
 * workedMinutes:
 *   skutečně odpracovaný čas
 *
 * creditedMinutes:
 *   uznané volno, například dovolená nebo sick day
 *
 * compTimeMinutes:
 *   náhradní volno
 *
 * Náhradní volno se započítává do pokrytí
 * denní pracovní povinnosti, ale zároveň se
 * eviduje samostatně, protože později odečítá
 * čas z průběžného přesčasového účtu.
 */
export function calculateDailyBalance(
  workedMinutes: number,
  creditedMinutes: number,
  compTimeMinutes: number,
  requiredMinutes = 480,
): number {
  return (
    workedMinutes +
    creditedMinutes +
    compTimeMinutes -
    requiredMinutes
  )
}

export function calculateOvertimeChange(
  workedMinutes: number,
  creditedMinutes: number,
  compTimeMinutes: number,
  requiredMinutes = 480,
): number {
  const baseBalance =
    workedMinutes +
    creditedMinutes -
    requiredMinutes

  const deficit = Math.max(0, -baseBalance)

  const compUsedForDeficit = Math.min(
    compTimeMinutes,
    deficit,
  )

  const extraCompTime =
    compTimeMinutes - compUsedForDeficit

  return baseBalance - extraCompTime
}

/**
 * Spočítá bilanci všech dnů, pro které existuje
 * pracovní session.
 *
 * Jeden den může mít více work_days záznamů.
 */
export function calculateDailyBalances(
  sessions: WorkSessionForBalance[],
  workDays: WorkDayForBalance[],
  requiredMinutes = 480,
): DailyBalance[] {
  const balances: DailyBalance[] = []
  const lunchDeductions = getDailyLunchDeductions(sessions)

  /*
   * Sesbíráme všechny datumy, které mají buď pracovní session,
   * nebo nějaký záznam volna.
   */
  const dates = new Set<string>()

  for (const session of sessions) {
    const date = formatInTimeZone(
      new Date(session.started_at),
      APP_TIMEZONE,
      'yyyy-MM-dd',
    )

    dates.add(date)
  }

  for (const workDay of workDays) {
    dates.add(workDay.date)
  }

  /*
   * Každý den zpracujeme pouze jednou.
   */
  for (const date of dates) {
    const daySessions = sessions.filter((session) => {
      const sessionDate = formatInTimeZone(
        new Date(session.started_at),
        APP_TIMEZONE,
        'yyyy-MM-dd',
      )

      return sessionDate === date
    })

    const dayWorkDays = workDays.filter(
      (day) => day.date === date,
    )

    /*
     * Pokud je v jednom dni více pracovních sessions,
     * jejich odpracovaný čas se sečte.
     */
    const workedMinutes = daySessions.reduce(
      (total, session) => {
        return (
          total +
          calculateSessionWorkedMinutes(
            session,
            lunchDeductions.get(session) ?? null,
          )
        )
      },
      0,
    )

    /*
     * Dovolená, sick day a další uznané volno.
     */
    const creditedMinutes = dayWorkDays
      .filter((day) => day.type !== 'comp_time')
      .reduce(
        (total, day) =>
          total + day.duration_minutes,
        0,
      )

    /*
     * Náhradní volno.
     */
    const compTimeMinutes = dayWorkDays
      .filter((day) => day.type === 'comp_time')
      .reduce(
        (total, day) =>
          total + day.duration_minutes,
        0,
      )

    const balanceMinutes = calculateDailyBalance(
      workedMinutes,
      creditedMinutes,
      compTimeMinutes,
      requiredMinutes,
    )

    const overtimeChangeMinutes =
      calculateOvertimeChange(
        workedMinutes,
        creditedMinutes,
        compTimeMinutes,
        requiredMinutes,
      )

    balances.push({
      date,
      workedMinutes,
      creditedMinutes,
      compTimeMinutes,
      balanceMinutes,
      overtimeChangeMinutes,
    })
  }

  return balances
}

export function calculateRunningOvertime(
  dailyBalances: DailyBalance[],
): number {
  const sortedBalances = [...dailyBalances].sort(
    (a, b) => a.date.localeCompare(b.date),
  )

  return sortedBalances.reduce(
    (total, day) =>
      total + day.overtimeChangeMinutes,
    0,
  )
}

/**
 * Naformátuje počet minut jako délku.
 *
 * addSign = true:
 *   30  -> +30 min
 *   -30 -> -30 min
 *
 * addSign = false:
 *   30  -> 30 min
 */
export function formatDuration(
  minutes: number,
  addSign = true,
): string {
  const sign = addSign
    ? minutes > 0
      ? '+'
      : minutes < 0
        ? '-'
        : ''
    : ''

  const absoluteMinutes = Math.abs(minutes)

  const hours = Math.floor(
    absoluteMinutes / 60,
  )

  const remainingMinutes =
    absoluteMinutes % 60

  if (hours === 0) {
    return `${sign}${remainingMinutes} min`
  }

  if (remainingMinutes === 0) {
    return `${sign}${hours} h`
  }

  return `${sign}${hours} h ${remainingMinutes} min`
}