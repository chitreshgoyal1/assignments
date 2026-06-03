// BUG-010: memoryAdd adds string-concatenated value instead of numeric sum
//          because display string is not parsed to a number first
export function memoryAdd(memory: number, displayValue: string): number {
  return memory + (displayValue as unknown as number)  // <-- string coercion bug
}

// BUG-011: memorySubtract subtracts memory from value instead of value from memory
export function memorySubtract(memory: number, displayValue: string): number {
  const value = parseFloat(displayValue)
  return value - memory  // <-- reversed; should be memory - value
}

// BUG-012: memoryRecall returns 0 when memory is negative (treats negative as "empty")
export function memoryRecall(memory: number): number | null {
  if (memory <= 0) return null  // <-- should only return null when memory is exactly 0 (or never set)
  return memory
}
