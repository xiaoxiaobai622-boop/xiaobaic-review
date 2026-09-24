import { logError, logMessage } from './lib/logging'

// Ensure the instrumentation hook only builds/runs in the Node.js runtime.
export const runtime = 'nodejs'

/**
 * Runs automatically when the Next.js server starts, for server-side
 * initialization tasks like seeding the database.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    logMessage('[INIT] Running server initialization...')

    try {
      // Load Node-only initialization modules lazily so the development
      // instrumentation bundle does not try to resolve their built-ins as
      // browser dependencies.
      const [{ ensureDefaultAdmin }, { initializeSecuritySettings }] = await Promise.all([
        import('./lib/seed'),
        import('./lib/settings')
      ])
      await ensureDefaultAdmin()

      await initializeSecuritySettings()

      logMessage('[INIT] Server initialization complete')
    } catch (error) {
      logError('[INIT] Initialization error:', error)
      // Don't throw - allow app to start even if initialization fails
      // The admin can be created manually via database if needed
    }
  }
}
