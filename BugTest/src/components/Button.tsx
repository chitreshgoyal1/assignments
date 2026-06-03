import React from 'react'

interface Props {
  label: string
  onClick: () => void
  variant?: 'default' | 'operator' | 'equals' | 'function' | 'memory'
  wide?: boolean
}

// BUG-020: Button does not respond to keyboard events — only mouse click is wired up
// BUG-021: `wide` prop is accepted but the className is applied incorrectly (always adds 'wide' class)
export const Button: React.FC<Props> = ({ label, onClick, variant = 'default', wide }) => {
  return (
    <button
      className={`calc-btn calc-btn--${variant} ${wide ? 'wide' : 'wide'}`}  // BUG-021: always 'wide'
      onClick={onClick}
    >
      {label}
    </button>
  )
}
