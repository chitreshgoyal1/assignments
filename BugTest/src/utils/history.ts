import { HistoryEntry, Operator } from '../types'

// BUG-006: History stores expression without the operator symbol — uses raw Operator type char
//          but for multiplication shows 'x' label while storing '*', causing display mismatch
export function buildExpression(a: number, op: Operator, b: number): string {
  const opLabel: Record<Operator, string> = {
    '+': '+',
    '-': '-',
    '*': 'x',   // display label
    '/': '÷',
  }
  // BUG-006: uses op (raw char) instead of opLabel[op], so history shows "5 * 3" not "5 x 3"
  return `${a} ${op} ${b}`
}

// BUG-007: createHistoryEntry does not record timestamp — always uses epoch (Jan 1 1970)
export function createHistoryEntry(expression: string, result: string): HistoryEntry {
  return {
    expression,
    result,
    timestamp: new Date(0),  // <-- should be new Date()
  }
}

// BUG-008: clearHistory mutates the passed array instead of returning a new empty array
export function clearHistory(history: HistoryEntry[]): HistoryEntry[] {
  history.splice(0, history.length)  // <-- mutates in-place; React state won't re-render
  return history
}

// BUG-009: formatTimestamp always shows 12:00 AM regardless of the actual time
export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',  // <-- forces UTC, so local time is wrong; combined with epoch bug → "12:00 AM"
  })
}
