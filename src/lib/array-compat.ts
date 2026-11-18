export function toSorted<T>(items: readonly T[], compareFn?: (a: T, b: T) => number): T[] {
  if (typeof Array.prototype.toSorted === 'function') {
    return items.toSorted(compareFn)
  }
  const copy = Array.from(items)
  copy.sort(compareFn)
  return copy
}

export function groupBy<T, K extends PropertyKey>(
  items: Iterable<T>,
  keySelector: (item: T, index: number) => K,
): Partial<Record<K, T[]>> {
  if (typeof Object.groupBy === 'function') {
    return Object.groupBy(items, keySelector)
  }
  const buckets = new Map<K, T[]>()
  let index = 0
  for (const item of items) {
    const key = keySelector(item, index++)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  return Object.fromEntries(buckets) as Partial<Record<K, T[]>>
}
