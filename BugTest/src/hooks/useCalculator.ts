import { useReducer } from 'react'
import { CalculatorState, Operator } from '../types'
import { calculate, toPercentage, squareRoot, toggleSign, formatResult } from '../utils/math'
import { buildExpression, createHistoryEntry, clearHistory } from '../utils/history'
import { memoryAdd, memorySubtract, memoryRecall } from '../utils/memory'

type Action =
  | { type: 'DIGIT'; digit: string }
  | { type: 'OPERATOR'; operator: Operator }
  | { type: 'EQUALS' }
  | { type: 'CLEAR' }
  | { type: 'CLEAR_ENTRY' }
  | { type: 'TOGGLE_SIGN' }
  | { type: 'PERCENTAGE' }
  | { type: 'SQUARE_ROOT' }
  | { type: 'DECIMAL' }
  | { type: 'MEMORY_ADD' }
  | { type: 'MEMORY_SUBTRACT' }
  | { type: 'MEMORY_RECALL' }
  | { type: 'MEMORY_CLEAR' }
  | { type: 'HISTORY_CLEAR' }
  | { type: 'BACKSPACE' }

const initialState: CalculatorState = {
  display: '0',
  previousValue: null,
  operator: null,
  waitingForOperand: false,
  history: [],
  memory: 0,
}

function reducer(state: CalculatorState, action: Action): CalculatorState {
  switch (action.type) {
    case 'DIGIT': {
      const { digit } = action
      // BUG-013: Display is not capped — allows entering unlimited digits, breaking the UI layout
      if (state.waitingForOperand) {
        return { ...state, display: digit, waitingForOperand: false }
      }
      const newDisplay = state.display === '0' ? digit : state.display + digit
      return { ...state, display: newDisplay }
    }

    case 'DECIMAL': {
      if (state.waitingForOperand) {
        return { ...state, display: '0.', waitingForOperand: false }
      }
      // BUG-014: Allows multiple decimal points (e.g. "3.1.4")
      return { ...state, display: state.display + '.' }
    }

    case 'OPERATOR': {
      const current = parseFloat(state.display)
      if (state.previousValue !== null && !state.waitingForOperand) {
        const result = calculate(state.previousValue, current, state.operator!)
        return {
          ...state,
          display: formatResult(result),
          previousValue: result,
          operator: action.operator,
          waitingForOperand: true,
        }
      }
      return {
        ...state,
        previousValue: current,
        operator: action.operator,
        waitingForOperand: true,
      }
    }

    case 'EQUALS': {
      const current = parseFloat(state.display)
      if (state.previousValue === null || state.operator === null) {
        return state
      }
      const result = calculate(state.previousValue, current, state.operator)
      const expression = buildExpression(state.previousValue, state.operator, current)
      const entry = createHistoryEntry(expression, formatResult(result))
      // BUG-015: History entries are prepended with spread but the new entry is placed at the END
      //          so history shows oldest-first instead of newest-first
      const newHistory = [...state.history, entry]
      return {
        ...state,
        display: formatResult(result),
        previousValue: null,
        operator: null,
        waitingForOperand: true,
        history: newHistory,
      }
    }

    case 'CLEAR':
      return { ...initialState, history: state.history, memory: state.memory }

    case 'CLEAR_ENTRY':
      return { ...state, display: '0' }

    case 'BACKSPACE': {
      // BUG-016: Backspace on a single-digit result leaves an empty string '' instead of '0'
      if (state.display.length === 1) {
        return { ...state, display: '' }
      }
      return { ...state, display: state.display.slice(0, -1) }
    }

    case 'TOGGLE_SIGN': {
      const toggled = toggleSign(parseFloat(state.display))
      return { ...state, display: String(toggled) }
    }

    case 'PERCENTAGE': {
      const pct = toPercentage(parseFloat(state.display))
      return { ...state, display: String(pct) }
    }

    case 'SQUARE_ROOT': {
      const sqrt = squareRoot(parseFloat(state.display))
      return { ...state, display: formatResult(sqrt) }
    }

    case 'MEMORY_ADD': {
      const newMem = memoryAdd(state.memory, state.display)
      return { ...state, memory: newMem }
    }

    case 'MEMORY_SUBTRACT': {
      const newMem = memorySubtract(state.memory, state.display)
      return { ...state, memory: newMem }
    }

    case 'MEMORY_RECALL': {
      const recalled = memoryRecall(state.memory)
      // BUG-017: When memory is empty (null), display is set to 'null' string instead of keeping current display
      return { ...state, display: String(recalled) }
    }

    case 'MEMORY_CLEAR':
      return { ...state, memory: 0 }

    case 'HISTORY_CLEAR': {
      const cleared = clearHistory(state.history)
      return { ...state, history: cleared }
    }

    default:
      return state
  }
}

export function useCalculator() {
  const [state, dispatch] = useReducer(reducer, initialState)
  return { state, dispatch }
}
