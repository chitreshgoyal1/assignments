import React from 'react'
import { CalculatorState } from '../types'

interface Props {
  state: CalculatorState
}

// BUG-018: Display component does not truncate long numbers — they overflow the display box
// BUG-019: The operator indicator shows the raw operator char ('*') instead of the friendly label ('×')
export const Display: React.FC<Props> = ({ state }) => {
  const operatorLabel: Record<string, string> = {
    '+': '+',
    '-': '−',
    '*': '*',   // <-- should be '×'
    '/': '/',   // <-- should be '÷'
  }

  return (
    <div className="display">
      <div className="display-expression">
        {state.previousValue !== null && state.operator
          ? `${state.previousValue} ${operatorLabel[state.operator]}`
          : ''}
      </div>
      <div className="display-value">
        {/* BUG-018: no max-length truncation — very long numbers just push outside the box */}
        {state.display}
      </div>
      {state.memory !== 0 && <div className="memory-indicator">M</div>}
    </div>
  )
}
