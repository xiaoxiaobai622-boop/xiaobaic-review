'use client'

import { passwordRuleHint } from '@/lib/password-policy'

interface PasswordRequirementsProps {
  password: string
  className?: string
}

export function PasswordRequirements({ className = '' }: PasswordRequirementsProps) {
  return (
    <div className={`text-xs text-muted-foreground ${className}`}>
      {passwordRuleHint}
    </div>
  )
}
