/** Light, dark or system (SPEC §17, D-103).
 *
 * The household default lives in Settings; a browser may override it. The choice is kept in
 * localStorage (a per-browser convenience) along with the last household default seen, so
 * index.html can set the class before the first paint and nothing flashes.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'

export const OVERRIDE_KEY = 'pb.theme'
export const HOUSEHOLD_KEY = 'pb.theme.household'

export function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** The browser's choice wins, then the household's; "system" follows the OS. */
export function resolveTheme(
  override: ThemeChoice | null,
  household: ThemeChoice | null,
  systemDark: boolean,
): 'light' | 'dark' {
  const choice = override ?? household ?? 'system'
  if (choice === 'system') return systemDark ? 'dark' : 'light'
  return choice
}

function read(key: string): ThemeChoice | null {
  try {
    const value = window.localStorage.getItem(key)
    return isChoice(value) ? value : null
  } catch {
    return null
  }
}

function write(key: string, value: ThemeChoice | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private windows: the theme still applies, it is just not remembered.
  }
}

export const readOverride = () => read(OVERRIDE_KEY)
export const writeOverride = (value: ThemeChoice | null) => write(OVERRIDE_KEY, value)
export const readHousehold = () => read(HOUSEHOLD_KEY)
export const writeHousehold = (value: ThemeChoice) => write(HOUSEHOLD_KEY, value)

export function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function applyTheme(
  mode: 'light' | 'dark',
  root: HTMLElement = document.documentElement,
): void {
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
}
