'use client'

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_TIME_FORMAT,
  TIME_FORMAT_EVENT,
  TIME_FORMAT_STORAGE_KEY,
  normalizeStoredTimeFormat,
  type TimeFormat,
} from '@/lib/time-format'

/**
 * 这台设备选过的「时间格式」，以及选它的那只手。
 *
 * 播放器读数、时间轴悬停气泡、批注列表与输入框、对比播放器都读这一份：选一次整页跟着变，
 * 不出现「播放器是帧、批注是时间码」。同页多处实例靠一枚自定义事件同步，另一台标签页由
 * `storage` 事件接住。
 */
function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  const handler = () => onChange()
  window.addEventListener(TIME_FORMAT_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(TIME_FORMAT_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

function readSnapshot(): TimeFormat {
  if (typeof window === 'undefined') return DEFAULT_TIME_FORMAT
  try {
    return normalizeStoredTimeFormat(window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY))
  } catch {
    // 隐私模式／存储被禁：读不到就按默认档，不许把整页时间读数弄没。
    return DEFAULT_TIME_FORMAT
  }
}

export function useTimeFormat(): TimeFormat {
  return useSyncExternalStore(subscribe, readSnapshot, () => DEFAULT_TIME_FORMAT)
}

export function selectTimeFormat(format: TimeFormat): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format)
  } catch {
    // 存不下也先把这一页切过去：选择当场要看得见，下次开页回到默认档而已。
  }
  window.dispatchEvent(new Event(TIME_FORMAT_EVENT))
}
