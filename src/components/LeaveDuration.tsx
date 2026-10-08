import { formatDuration } from '../lib/attendance'
import { formatLeaveDays } from '../lib/leave'

function LeaveDuration({ minutes }: { minutes: number }) {
  return (
    <span className="leave-duration">
      <span>{formatLeaveDays(minutes)}</span>
      <small>({formatDuration(minutes, false)})</small>
    </span>
  )
}

export default LeaveDuration
