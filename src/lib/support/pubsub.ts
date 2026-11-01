import type Redis from 'ioredis'
import { getRedis } from '@/lib/redis'
import { logError } from '@/lib/logging'

type SupportListener = (payload: string) => void

const globalForSupport = globalThis as unknown as {
  supportSubscriber?: Redis
  supportListeners?: Map<string, Set<SupportListener>>
  supportSubscriberHooked?: boolean
}

function getSubscriber(): Redis {
  if (!globalForSupport.supportSubscriber) {
    globalForSupport.supportSubscriber = getRedis().duplicate()
    globalForSupport.supportSubscriber.on('error', (error) => {
      logError('[SUPPORT] Redis subscriber error:', error.message)
    })
  }
  return globalForSupport.supportSubscriber
}

function getListeners() {
  if (!globalForSupport.supportListeners) globalForSupport.supportListeners = new Map()
  if (!globalForSupport.supportSubscriberHooked) {
    globalForSupport.supportSubscriberHooked = true
    getSubscriber().on('message', (channel, payload) => {
      const listeners = globalForSupport.supportListeners?.get(channel)
      if (!listeners) return
      for (const listener of listeners) {
        try {
          listener(payload)
        } catch (error) {
          logError('[SUPPORT] realtime listener failed:', error)
        }
      }
    })
  }
  return globalForSupport.supportListeners
}

export async function subscribeSupportChannel(channel: string, listener: SupportListener) {
  const listeners = getListeners()
  let set = listeners.get(channel)
  const first = !set
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
  }
  set.add(listener)

  if (first) {
    try {
      await getSubscriber().subscribe(channel)
    } catch (error) {
      logError('[SUPPORT] Redis subscribe failed:', error)
    }
  }

  return async () => {
    const current = listeners.get(channel)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      listeners.delete(channel)
      try {
        await getSubscriber().unsubscribe(channel)
      } catch (error) {
        logError('[SUPPORT] Redis unsubscribe failed:', error)
      }
    }
  }
}

export async function publishSupportEvent(channel: string, event: unknown) {
  try {
    await getRedis().publish(channel, JSON.stringify(event))
  } catch (error) {
    // A realtime signal is best-effort; Postgres remains the source of truth and
    // the client will backfill on reconnect.
    logError('[SUPPORT] Redis publish failed:', error)
  }
}
