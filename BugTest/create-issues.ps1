# Run this script from the repo root after authenticating with: gh auth login
# Usage: .\create-issues.ps1

$issues = @(
  @{
    title = "[BUG-001] Division returns wrong result (operands swapped)"
    body  = "## Description`nThe ``calculate()`` function divides ``b / a`` instead of ``a / b``, so division always returns the inverse of the correct answer.`n`n## Steps to Reproduce`n1. Enter ``10``\n2. Press ``÷``\n3. Enter ``2``\n4. Press ``=``\n`n## Expected`n``5``\n`n## Actual`n``0.2``\n`n**File:** ``src/utils/math.ts``"
    labels = "bug,critical"
  },
  @{
    title = "[BUG-002] Percentage divides by 10 instead of 100"
    body  = "## Description`n``toPercentage()`` divides by ``10`` instead of ``100``.`n`n## Steps to Reproduce`n1. Enter ``50``\n2. Press ``%``\n`n## Expected`n``0.5``\n`n## Actual`n``5``\n`n**File:** ``src/utils/math.ts``"
    labels = "bug,medium"
  },
  @{
    title = "[BUG-003] Square root of negative number silently shows NaN"
    body  = "## Description`n``squareRoot()`` calls ``Math.sqrt()`` on negative numbers without validation, silently displaying ``NaN`` instead of an error message.`n`n## Steps to Reproduce`n1. Enter ``-9``\n2. Press ``√``\n`n## Expected`n``Error`` or informative message`n`n## Actual`n``NaN``\n`n**File:** ``src/utils/math.ts``"
    labels = "bug,medium"
  },
  @{
    title = "[BUG-004] +/- on zero produces -0 instead of 0"
    body  = "## Description`n``toggleSign(0)`` returns ``-0`` which displays as ``-0`` on screen, confusing users.`n`n## Steps to Reproduce`n1. Press ``AC`` to reset\n2. Press ``+/−``\n`n## Expected`n``0``\n`n## Actual`n``-0``\n`n**File:** ``src/utils/math.ts``"
    labels = "bug,low"
  },
  @{
    title = "[BUG-005] Integer results display 20 trailing decimal zeros"
    body  = "## Description`n``formatResult()`` calls ``.toFixed(20)`` on integer values, so every whole-number result shows 20 unnecessary decimal places.`n`n## Steps to Reproduce`n1. Enter ``2``\n2. Press ``+``\n3. Enter ``3``\n4. Press ``=``\n`n## Expected`n``5``\n`n## Actual`n``5.00000000000000000000``\n`n**File:** ``src/utils/math.ts``"
    labels = "bug,high"
  },
  @{
    title = "[BUG-006] History expressions show raw operator chars (* and /) instead of symbols"
    body  = "## Description`n``buildExpression()`` uses the raw ``Operator`` character (``*``) instead of the display-friendly label (``×``). History reads ``5 * 3`` instead of ``5 × 3``.`n`n**File:** ``src/utils/history.ts``"
    labels = "bug,low,ui"
  },
  @{
    title = "[BUG-007] History timestamps always show Jan 1, 1970 (Unix epoch)"
    body  = "## Description`n``createHistoryEntry()`` passes ``new Date(0)`` (Unix epoch) as the timestamp instead of ``new Date()``. Every history entry shows the wrong date/time.`n`n**File:** ``src/utils/history.ts``"
    labels = "bug,medium"
  },
  @{
    title = "[BUG-008] Clear History button does not update the UI"
    body  = "## Description`n``clearHistory()`` mutates the existing array using ``splice()``. Because the array reference does not change, React does not detect the state update and the history list remains visible.`n`n## Steps to Reproduce`n1. Perform several calculations\n2. Press ``Clear`` in the History panel\n`n## Expected`nHistory list is empty`n`n## Actual`nHistory list unchanged`n`n**File:** ``src/utils/history.ts``"
    labels = "bug,high"
  },
  @{
    title = "[BUG-009] History timestamps show wrong local time (forced UTC)"
    body  = "## Description`n``formatTimestamp()`` forces ``timeZone: 'UTC'``, so users in non-UTC timezones see incorrect times. Combined with BUG-007 (epoch timestamp), all entries display ``12:00 AM``.`n`n**File:** ``src/utils/history.ts``"
    labels = "bug,medium"
  },
  @{
    title = "[BUG-010] Memory Add (M+) concatenates strings instead of adding numbers"
    body  = "## Description`n``memoryAdd()`` does not parse the display string to a number before adding. JavaScript coerces the addition into string concatenation.`n`n## Steps to Reproduce`n1. Enter ``3`` → press ``M+`` (memory = 3)\n2. Enter ``5`` → press ``M+``\n3. Press ``MR``\n`n## Expected`n``8``\n`n## Actual`n``35``\n`n**File:** ``src/utils/memory.ts``"
    labels = "bug,critical"
  },
  @{
    title = "[BUG-011] Memory Subtract (M-) result is reversed"
    body  = "## Description`n``memorySubtract()`` computes ``value - memory`` instead of ``memory - value``.`n`n## Steps to Reproduce`n1. Enter ``10`` → press ``M+`` (memory = 10)\n2. Enter ``3`` → press ``M−``\n`n## Expected`nMemory = ``7``\n`n## Actual`nMemory = ``-7``\n`n**File:** ``src/utils/memory.ts``"
    labels = "bug,high"
  },
  @{
    title = "[BUG-012] Memory Recall returns null for negative stored values"
    body  = "## Description`n``memoryRecall()`` returns ``null`` for any memory value ``<= 0``, making it impossible to recall a legitimately stored negative number.`n`n## Steps to Reproduce`n1. Enter ``-5`` → press ``M+``\n2. Press ``MR``\n`n## Expected`n``-5`` is recalled`n`n## Actual`nDisplay set to ``null``\n`n**File:** ``src/utils/memory.ts``"
    labels = "bug,medium"
  },
  @{
    title = "[BUG-013] No digit limit — long numbers overflow the display"
    body  = "## Description`nThere is no cap on how many digits can be entered. Typing 20+ digits causes the number to overflow outside the display box.`n`n**File:** ``src/hooks/useCalculator.ts``"
    labels = "bug,medium,ui"
  },
  @{
    title = "[BUG-014] Multiple decimal points can be entered (e.g. 3.1.4)"
    body  = "## Description`nThe ``DECIMAL`` action appends ``.`` without checking whether the current display already contains one, allowing invalid numbers like ``3.1.4``.`n`n## Steps to Reproduce`n1. Enter ``3``\n2. Press ``.`` twice\n3. Enter ``1``\n`n## Expected`nSecond ``.`` press is ignored`n`n## Actual`n Display shows ``3..1``\n`n**File:** ``src/hooks/useCalculator.ts``"
    labels = "bug,high"
  },
  @{
    title = "[BUG-015] History shows oldest entries first instead of newest first"
    body  = "## Description`nNew history entries are appended to the end of the array. The most recent calculation should appear at the top of the list.`n`n**File:** ``src/hooks/useCalculator.ts``"
    labels = "bug,low,ux"
  },
  @{
    title = "[BUG-016] Display goes blank after Backspace on last digit"
    body  = "## Description`nWhen only one digit remains and the user presses ``⌫``, the display is set to ``''`` (empty string) instead of ``'0'``, leaving the display completely blank.`n`n## Steps to Reproduce`n1. Enter a single digit (e.g. ``5``)\n2. Press ``⌫``\n`n## Expected`n``0``\n`n## Actual`n_(blank display)_`n`n**File:** ``src/hooks/useCalculator.ts``"
    labels = "bug,high"
  },
  @{
    title = "[BUG-017] Memory Recall when empty sets display to string literal 'null'"
    body  = "## Description`nWhen memory is empty (``0``) and ``MR`` is pressed, ``memoryRecall()`` returns ``null`` and ``String(null)`` produces the text ``'null'`` on the display instead of leaving the current value unchanged.`n`n**File:** ``src/hooks/useCalculator.ts``"
    labels = "bug,medium"
  },
  @{
    title = "[BUG-018] Long numbers overflow the display container"
    body  = "## Description`nThe display CSS sets ``overflow: visible``. Numbers with many digits spill outside the rounded display box. The display should truncate or auto-scale the font size.`n`n**File:** ``src/App.css``"
    labels = "bug,medium,ui"
  },
  @{
    title = "[BUG-019] Operator indicator shows * and / instead of × and ÷"
    body  = "## Description`nThe expression preview above the main display uses the raw operator map values ``'*'`` and ``'/'`` instead of ``'×'`` and ``'÷'``.`n`n**File:** ``src/components/Display.tsx``"
    labels = "bug,low,ui"
  },
  @{
    title = "[BUG-020] Buttons do not respond to keyboard Enter or Space"
    body  = "## Description`nCalculator buttons are plain ``<button>`` elements with only ``onClick`` wired up. Users navigating by keyboard receive no activation on ``Enter`` or ``Space`` because there is no ``onKeyDown`` handler and no visible focus ring.`n`n**File:** ``src/components/Button.tsx``"
    labels = "bug,high,accessibility"
  },
  @{
    title = "[BUG-021] Every button renders with the wide CSS class"
    body  = "## Description`nThe ternary expression for the ``wide`` prop in ``Button.tsx`` returns ``'wide'`` on both the true and false branches. Every button gets double flex width, breaking the keypad layout.`n`n**File:** ``src/components/Button.tsx``"
    labels = "bug,high,ui"
  },
  @{
    title = "[BUG-022] Array index used as React key in History list"
    body  = "## Description`nHistory entries use ``index`` as the ``key`` prop. After clearing history and adding new entries the indices reuse previous values, causing React reconciliation bugs and potential rendering artifacts.`n`n**File:** ``src/components/History.tsx``"
    labels = "bug,medium"
  },
  @{
    title = "[BUG-023] Clear History has no confirmation — accidental data loss possible"
    body  = "## Description`nClicking ``Clear`` immediately wipes all history entries with no confirmation dialog. A single misclick permanently destroys all recorded calculations.`n`n**File:** ``src/components/History.tsx``"
    labels = "bug,medium,ux"
  },
  @{
    title = "[BUG-024] Zero (0) button missing wide prop — should span two columns"
    body  = "## Description`nThe ``0`` button is not given ``wide={true}``, so it renders at the same width as other digit buttons instead of spanning two columns as on a standard calculator. Currently masked by BUG-021 but will regress once that is fixed.`n`n**File:** ``src/components/Keypad.tsx``"
    labels = "bug,low,ui"
  },
  @{
    title = "[BUG-025] No keyboard input support — window keydown listener missing"
    body  = "## Description`nThere is no ``window`` ``keydown`` event listener anywhere in the app. Users cannot enter digits, operators, or trigger equals/backspace from their physical keyboard.`n`n**File:** ``src/components/Keypad.tsx``"
    labels = "bug,high,accessibility"
  },
  @{
    title = "[BUG-026] No Error Boundary — runtime error crashes the entire app"
    body  = "## Description`n``App.tsx`` has no ``<ErrorBoundary>`` wrapper. An unhandled runtime error in any child component (e.g. ``NaN`` propagation, memory bugs) unmounts the entire UI, leaving a blank white screen with no recovery option.`n`n**File:** ``src/App.tsx``"
    labels = "bug,high"
  },
  @{
    title = "[BUG-027] History panel always visible — no toggle for mobile viewports"
    body  = "## Description`nThe History panel is permanently rendered beside the calculator with no show/hide toggle. On narrow screens this forces horizontal scrolling or breaks the layout entirely.`n`n**File:** ``src/App.tsx``"
    labels = "bug,medium,ux"
  }
)

Write-Host "Creating $($issues.Count) GitHub issues..." -ForegroundColor Cyan

foreach ($issue in $issues) {
  Write-Host "  Creating: $($issue.title)" -ForegroundColor Yellow
  gh issue create --title $issue.title --body $issue.body --label $issue.labels
  Start-Sleep -Milliseconds 500   # avoid hitting API rate limits
}

Write-Host "`nDone! All $($issues.Count) issues created." -ForegroundColor Green
