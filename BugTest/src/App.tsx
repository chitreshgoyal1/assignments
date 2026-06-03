import React from 'react'
import { useCalculator } from './hooks/useCalculator'
import { Display } from './components/Display'
import { Keypad } from './components/Keypad'
import { History } from './components/History'
import './App.css'

// BUG-026: App has no error boundary — an unhandled error in any child crashes the entire app
// BUG-027: The history panel is always visible with no toggle, taking up permanent space on mobile
function App() {
  const { state, dispatch } = useCalculator()

  return (
    <div className="app">
      <div className="calculator">
        <h1 className="calculator-title">Calculator</h1>
        <Display state={state} />
        <Keypad
          onDigit={(d) => dispatch({ type: 'DIGIT', digit: d })}
          onOperator={(op) => dispatch({ type: 'OPERATOR', operator: op })}
          onEquals={() => dispatch({ type: 'EQUALS' })}
          onClear={() => dispatch({ type: 'CLEAR' })}
          onClearEntry={() => dispatch({ type: 'CLEAR_ENTRY' })}
          onBackspace={() => dispatch({ type: 'BACKSPACE' })}
          onToggleSign={() => dispatch({ type: 'TOGGLE_SIGN' })}
          onPercentage={() => dispatch({ type: 'PERCENTAGE' })}
          onSquareRoot={() => dispatch({ type: 'SQUARE_ROOT' })}
          onDecimal={() => dispatch({ type: 'DECIMAL' })}
          onMemoryAdd={() => dispatch({ type: 'MEMORY_ADD' })}
          onMemorySubtract={() => dispatch({ type: 'MEMORY_SUBTRACT' })}
          onMemoryRecall={() => dispatch({ type: 'MEMORY_RECALL' })}
          onMemoryClear={() => dispatch({ type: 'MEMORY_CLEAR' })}
        />
      </div>

      {/* BUG-027: always visible — no show/hide toggle */}
      <History
        history={state.history}
        onClear={() => dispatch({ type: 'HISTORY_CLEAR' })}
      />
    </div>
  )
}

export default App
