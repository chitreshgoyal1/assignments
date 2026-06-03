import React from 'react'
import { HistoryEntry } from '../types'
import { formatTimestamp } from '../utils/history'

interface Props {
  history: HistoryEntry[]
  onClear: () => void
}

// BUG-022: History panel uses array index as key — causes React reconciliation issues
//          when entries are cleared and new ones added (keys reuse same indices)
// BUG-023: "Clear History" button is missing a confirmation step — one click wipes all history
export const History: React.FC<Props> = ({ history, onClear }) => {
  return (
    <div className="history-panel">
      <div className="history-header">
        <h3>History</h3>
        <button className="history-clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>
      <ul className="history-list">
        {history.length === 0 && (
          <li className="history-empty">No calculations yet</li>
        )}
        {history.map((entry, index) => (
          // BUG-022: index as key
          <li key={index} className="history-entry">
            <span className="history-expression">{entry.expression} =</span>
            <span className="history-result">{entry.result}</span>
            <span className="history-time">{formatTimestamp(entry.timestamp)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
