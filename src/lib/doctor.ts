import { fromZonedTime } from 'date-fns-tz'

export function splitDoctorVisit(from: string, to: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(to)) {
    throw new Error('Zadej platný čas návštěvy lékaře.')
  }
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  const start = minutes(from)
  const end = minutes(to)
  if (end <= start) throw new Error('Konec návštěvy musí být později než začátek.')
  const durationMinutes = end - start
  const paidMinutes = Math.max(0, Math.min(end, 14 * 60) - Math.max(start, 8 * 60 + 30))
  return { durationMinutes, paidMinutes, overtimeMinutes: durationMinutes - paidMinutes }
}

export interface DoctorInterval {
  date: string
  type: string
  doctor_from?: string | null
  doctor_to?: string | null
}

export function doctorOverlapMinutes(
  arrival: Date,
  departure: Date,
  records: DoctorInterval[],
  lunchStart: Date | null,
): number {
  const intervals = records.filter((day) => day.type === 'doctor' && day.doctor_from && day.doctor_to)
    .map((day) => [
      Math.max(arrival.getTime(), fromZonedTime(`${day.date}T${day.doctor_from}`, 'Europe/Prague').getTime()),
      Math.min(departure.getTime(), fromZonedTime(`${day.date}T${day.doctor_to}`, 'Europe/Prague').getTime()),
    ])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  const merged: number[][] = []
  for (const interval of intervals) {
    const last = merged.at(-1)
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
    else merged.push([...interval])
  }
  return merged.reduce((total, [start, end]) => {
    const lunchOverlap = lunchStart ? Math.max(
      0, Math.min(end, lunchStart.getTime() + 30 * 60_000) - Math.max(start, lunchStart.getTime()),
    ) : 0
    return total + (end - start - lunchOverlap) / 60_000
  }, 0)
}
