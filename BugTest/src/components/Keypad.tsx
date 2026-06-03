import React from 'react'
import { Button } from './Button'
import { Operator } from '../types'

interface Props {
  onDigit: (digit: string) => void
  onOperator: (op: Operator) => void
  onEquals: () => void
  onClear: () => void
  onClearEntry: () => void
  onBackspace: () => void
  onToggleSign: () => void
  onPercentage: () => void
  onSquareRoot: () => void
  onDecimal: () => void
  onMemoryAdd: () => void
  onMemorySubtract: () => void
  onMemoryRecall: () => void
  onMemoryClear: () => void
}

// BUG-024: The '0' digit button is not marked as wide=true, so it renders at normal width
//          (the wide class bug means it shows as wide anyway due to BUG-021, masking this)
// BUG-025: There is no keyboard shortcut handler attached to the window — keyboard entry is unsupported
export const Keypad: React.FC<Props> = ({
  onDigit,
  onOperator,
  onEquals,
  onClear,
  onClearEntry,
  onBackspace,
  onToggleSign,
  onPercentage,
  onSquareRoot,
  onDecimal,
  onMemoryAdd,
  onMemorySubtract,
  onMemoryRecall,
  onMemoryClear,
}) => {
  return (
    <div className="keypad">
      {/* Memory row */}
      <div className="keypad-row">
        <Button label="MC" onClick={onMemoryClear} variant="memory" />
        <Button label="MR" onClick={onMemoryRecall} variant="memory" />
        <Button label="M+" onClick={onMemoryAdd} variant="memory" />
        <Button label="M−" onClick={onMemorySubtract} variant="memory" />
      </div>

      {/* Function row */}
      <div className="keypad-row">
        <Button label="AC" onClick={onClear} variant="function" />
        <Button label="CE" onClick={onClearEntry} variant="function" />
        <Button label="⌫" onClick={onBackspace} variant="function" />
        <Button label="÷" onClick={() => onOperator('/')} variant="operator" />
      </div>

      {/* Number rows */}
      <div className="keypad-row">
        <Button label="7" onClick={() => onDigit('7')} />
        <Button label="8" onClick={() => onDigit('8')} />
        <Button label="9" onClick={() => onDigit('9')} />
        <Button label="×" onClick={() => onOperator('*')} variant="operator" />
      </div>

      <div className="keypad-row">
        <Button label="4" onClick={() => onDigit('4')} />
        <Button label="5" onClick={() => onDigit('5')} />
        <Button label="6" onClick={() => onDigit('6')} />
        <Button label="−" onClick={() => onOperator('-')} variant="operator" />
      </div>

      <div className="keypad-row">
        <Button label="1" onClick={() => onDigit('1')} />
        <Button label="2" onClick={() => onDigit('2')} />
        <Button label="3" onClick={() => onDigit('3')} />
        <Button label="+" onClick={() => onOperator('+')} variant="operator" />
      </div>

      <div className="keypad-row">
        <Button label="+/−" onClick={onToggleSign} variant="function" />
        {/* BUG-024: wide not passed for '0' */}
        <Button label="0" onClick={() => onDigit('0')} />
        <Button label="." onClick={onDecimal} />
        <Button label="=" onClick={onEquals} variant="equals" />
      </div>

      {/* Scientific row */}
      <div className="keypad-row">
        <Button label="%" onClick={onPercentage} variant="function" />
        <Button label="√" onClick={onSquareRoot} variant="function" />
      </div>
    </div>
  )
}
