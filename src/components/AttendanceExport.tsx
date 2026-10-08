import { useState } from 'react'
import type { MonthlySession } from '../lib/monthly'
import type { WorkDayForBalance } from '../lib/attendance'

interface AttendanceExportProps {
  sessions: MonthlySession[]
  leave: WorkDayForBalance[]
  month: string
  dailyMinutes?: number
  disabled?: boolean
  onError: (message: string) => void
}

function AttendanceExport({
  sessions, leave, month, dailyMinutes = 480, disabled, onError,
}: AttendanceExportProps) {
  const [exporting, setExporting] = useState(false)
  async function download(period: string) {
    setExporting(true)
    let url: string | null = null
    const link = document.createElement('a')
    try {
      const { createAttendanceExcel } = await import('../lib/excelExport')
      const bytes = await createAttendanceExcel(sessions, leave, period, new Date(), dailyMinutes)
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }))
      link.href = url
      link.download = `dochazka-${period}.xlsx`
      document.body.append(link)
      link.click()
    } catch (error) {
      console.error('Failed to export attendance:', error)
      onError('Nepodařilo se exportovat docházku do Excelu.')
    } finally {
      link.remove()
      setExporting(false)
      if (url) {
        const downloadUrl = url
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      }
    }
  }

  return (
    <div className="attendance-export" role="group" aria-label="Export docházky do Excelu" aria-busy={exporting}>
      <button type="button" className="button button-secondary button-small"
        disabled={disabled || exporting} onClick={() => void download(month)}>
        Export měsíce (Excel)
      </button>
      <button type="button" className="button button-secondary button-small"
        disabled={disabled || exporting} onClick={() => void download(month.slice(0, 4))}>
        Export roku {month.slice(0, 4)} (Excel)
      </button>
      {exporting && <span role="status">Připravuji Excel...</span>}
    </div>
  )
}

export default AttendanceExport
