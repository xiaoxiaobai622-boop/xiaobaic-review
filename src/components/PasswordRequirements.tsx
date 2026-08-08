'use client'

interface PasswordRequirementsProps {
  password: string
  className?: string
}

export function PasswordRequirements({ className = '' }: PasswordRequirementsProps) {
  return (
    <div className={`text-xs text-muted-foreground ${className}`}>
      仅需 6 位数字
    </div>
  )
}
