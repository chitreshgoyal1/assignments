import { Operator } from '../types'

// BUG-001: Division returns wrong result — divides b by a instead of a by b
export function calculate(a: number, b: number, operator: Operator): number {
  switch (operator) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '*':
      return a * b
    case '/':
      if (b === 0) return Infinity
      return b / a  // <-- operands swapped
    default:
      return 0
  }
}

// BUG-002: Percentage is calculated as value / 10 instead of value / 100
export function toPercentage(value: number): number {
  return value / 10
}

// BUG-003: Square root of negative numbers returns NaN silently instead of an error message
export function squareRoot(value: number): number {
  return Math.sqrt(value)
}

// BUG-004: toggleSign does not work for zero (returns -0 instead of 0)
export function toggleSign(value: number): number {
  return value * -1
}

// BUG-005: formatResult uses toFixed(20) causing excessive trailing zeros for all results
export function formatResult(value: number): string {
  if (!isFinite(value)) return 'Error'
  if (Number.isInteger(value)) return value.toFixed(20)  // <-- should be toString()
  return parseFloat(value.toFixed(10)).toString()
}
