export type ThemeChoice = 'light' | 'mint' | 'frame' | 'dark'

export const THEME_CHOICES: ThemeChoice[] = ['light', 'mint', 'frame', 'dark']

/** Light themes that paint themselves from a `data-theme` block in globals.css. */
const THEMES_WITH_ATTRIBUTE: ThemeChoice[] = ['mint', 'frame']

function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as string[]).includes(value)
}

export function readStoredTheme(): ThemeChoice | null {
  const saved = localStorage.getItem('theme')
  return isThemeChoice(saved) ? saved : null
}

/** Site-wide default chosen by the admin; 'auto' follows the OS. */
export function resolveDefaultTheme(defaultTheme: string | null | undefined): ThemeChoice {
  if (isThemeChoice(defaultTheme)) return defaultTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyThemeChoice(theme: ThemeChoice): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  if (THEMES_WITH_ATTRIBUTE.includes(theme)) {
    root.setAttribute('data-theme', theme)
  } else {
    root.removeAttribute('data-theme')
  }
}

/**
 * Runs before first paint so a saved theme never flashes the default one.
 * Deliberately mirrors resolveDefaultTheme + applyThemeChoice above: it cannot
 * import them, because it has to survive as a standalone inline script.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='mint'&&t!=='frame'&&t!=='dark'){var d=localStorage.getItem('adminDefaultTheme');t=(d==='light'||d==='dark')?d:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}document.documentElement.classList.toggle('dark',t==='dark');if(t==='mint'||t==='frame')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`
