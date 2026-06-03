export type Operator = '+' | '-' | '*' | '/'

export interface CalculatorState {
  display: string
  previousValue: number | null
  operator: Operator | null
  waitingForOperand: boolean
  history: HistoryEntry[]
  memory: number
}

export interface HistoryEntry {
  expression: string
  result: string
  timestamp: Date
}
