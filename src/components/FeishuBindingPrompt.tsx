'use client'

import { useEffect, useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { Button } from './ui/button'
import { apiFetch } from '@/lib/api-client'

interface FeishuBindingPromptProps {
  onDismiss?: () => void
}

/**
 * Feishu binding prompt shown after video upload completion.
 * Checks if user has bound Feishu, shows prompt if not.
 */
export function FeishuBindingPrompt({ onDismiss }: FeishuBindingPromptProps) {
  const [bound, setBound] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check Feishu binding status
    apiFetch('/api/feishu/binding', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return
        const data = await response.json()
        setBound(data.bound || false)
      })
      .catch(() => setBound(false))
  }, [])

  function handleDismiss() {
    setDismissed(true)
    onDismiss?.()
  }

  // Don't show if already bound or dismissed or still loading
  if (bound === null || bound === true || dismissed) {
    return null
  }

  return (
    <div className="relative rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900/50 dark:bg-blue-950/30">
      <button
        onClick={handleDismiss}
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
        aria-label="关闭"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <MessageSquare className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="flex-1">
          <div className="font-medium text-blue-900 dark:text-blue-100">
            💬 绑定飞书，可以及时收到批注意见通知
          </div>
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-2 border-blue-300 bg-white hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:hover:bg-blue-900"
              onClick={() => window.location.href = '/profile'}
            >
              立即绑定飞书
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
