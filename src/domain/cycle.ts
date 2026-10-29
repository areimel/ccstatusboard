/**
 * Next (step 1) or previous (step -1) item of `list`, wrapping at both ends.
 * If `current` is not in the list, step 1 returns the first item and step -1 the last.
 */
export function cycle<T>(list: readonly T[], current: T, step: 1 | -1): T {
  const i = list.indexOf(current);
  const next = i === -1 ? (step === 1 ? 0 : list.length - 1) : (i + step + list.length) % list.length;
  return list[next] as T;
}
