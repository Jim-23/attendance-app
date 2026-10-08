import { TimeInput } from './TimeInput'
import { splitDoctorVisit } from '../lib/doctor'
import { formatDuration } from '../lib/attendance'

interface Props {
  id: string
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
  disabled?: boolean
}

export function DoctorVisitDetails({ from, to }: { from: string; to: string }) {
  const split = splitDoctorVisit(from.slice(0, 5), to.slice(0, 5))
  return (
    <span className="day-panel-meta">
      {from.slice(0, 5)}–{to.slice(0, 5)}
      {' · '}placeno {formatDuration(split.paidMinutes, false)}
      {' · '}z přesčasů {formatDuration(split.overtimeMinutes, false)}
    </span>
  )
}

function DoctorTimeInput({ id, from, to, onFrom, onTo, disabled }: Props) {
  const valid = from < to
  const split = valid ? splitDoctorVisit(from, to) : null
  return (
    <>
      <div className="form-field">
        <label htmlFor={`${id}-from`}>Lékař od</label>
        <TimeInput id={`${id}-from`} value={from} onChange={onFrom} disabled={disabled} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-to`}>Lékař do</label>
        <TimeInput id={`${id}-to`} value={to} onChange={onTo} disabled={disabled} />
      </div>
      <p className="calendar-note form-field-wide day-panel-wide">
        {split
          ? `Celkem ${formatDuration(split.durationMinutes, false)}; placeno ${formatDuration(split.paidMinutes, false)}; z přesčasů ${formatDuration(split.overtimeMinutes, false)}.`
          : 'Konec návštěvy musí být později než začátek.'}
        {' '}Placené okno je 08:30–14:00. Potvrzení odevzdej HR mimo aplikaci.
      </p>
    </>
  )
}

export default DoctorTimeInput
