'use client'

import { createContext, createElement, useContext, useState, type ReactNode } from 'react'
import { DEFAULT_TIME_FORMAT, type TimeFormat } from '@/lib/time-format'

const TimeFormatContext = createContext<{ format: TimeFormat; select: (format: TimeFormat) => void } | null>(null)

export function LabTimeFormatProvider({ children }: { children: ReactNode }) {
  const [format, select] = useState(DEFAULT_TIME_FORMAT)
  return createElement(TimeFormatContext.Provider, { value: { format, select } }, children)
}

export function useTimeFormat() {
  return useContext(TimeFormatContext)!.format
}

export function useSelectTimeFormat() {
  return useContext(TimeFormatContext)!.select
}
