import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const APP_TIMEZONE = 'Europe/Prague'

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

/**
 * Spočítá čistý odpracovaný čas.
 * Oběd má vždy 30 minut.
 */
export function calculateWorkedMinutes(
  arrival: Date,
  departure: Date,
  hasLunch: boolean,
): number {
  const roundedArrival = roundArrival(arrival)
  const roundedDeparture = roundDeparture(departure)

  const totalMinutes =
    (roundedDeparture.getTime() -
      roundedArrival.getTime()) /
    (1000 * 60)

  const lunchMinutes = hasLunch ? 30 : 0

  return totalMinutes - lunchMinutes
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

  // Nejprve zpracujeme všechny dny, ve kterých existuje práce.
  for (const session of sessions) {
    const date = formatInTimeZone(
      new Date(session.started_at),
      APP_TIMEZONE,
      'yyyy-MM-dd',
    )

    const workedMinutes = calculateWorkedMinutes(
      new Date(session.started_at),
      new Date(session.ended_at),
      session.lunch_started_at !== null,
    )

    const dayWorkDays = workDays.filter(
      (day) => day.date === date,
    )

    const creditedMinutes = dayWorkDays
      .filter((day) => day.type !== 'comp_time')
      .reduce(
        (total, day) =>
          total + day.duration_minutes,
        0,
      )

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
    const overtimeChangeMinutes = calculateOvertimeChange(
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

  // Potom přidáme work_days, které nemají žádnou pracovní session.
  for (const workDay of workDays) {
    const alreadyExists = balances.some(
      (balance) => balance.date === workDay.date,
    )

    if (alreadyExists) {
      continue
    }

    const dayWorkDays = workDays.filter(
      (day) => day.date === workDay.date,
    )

    const creditedMinutes = dayWorkDays
      .filter((day) => day.type !== 'comp_time')
      .reduce(
        (total, day) =>
          total + day.duration_minutes,
        0,
      )

    const compTimeMinutes = dayWorkDays
      .filter((day) => day.type === 'comp_time')
      .reduce(
        (total, day) =>
          total + day.duration_minutes,
        0,
      )

    const balanceMinutes = calculateDailyBalance(
      0,
      creditedMinutes,
      compTimeMinutes,
      requiredMinutes,
    )

    const overtimeChangeMinutes =
      calculateOvertimeChange(
        0,
        creditedMinutes,
        compTimeMinutes,
        requiredMinutes,
    )

    balances.push({
      date: workDay.date,
      workedMinutes: 0,
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