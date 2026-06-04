/**
 * Shared, defensive helpers for building frozen Record projections.
 *
 * Threat model: any helper that takes a `key: string` from user input
 * could be passed `'__proto__'`, `'constructor'`, etc. If the helper
 * uses spread (`{ ...map }`) or bracket assignment (`obj[key] = val`)
 * on those keys, an attacker could mutate the prototype chain.
 *
 * `assertId` already rejects those keys at the validation boundary
 * (see `validation.ts#FORBIDDEN_ID_KEYS`). These helpers are the
 * defense-in-depth layer: every set/delete uses `Object.defineProperty`
 * with explicit data-descriptor flags so even a bypassed key lands as
 * an own property, never invoking the `__proto__` setter or any other
 * accessor on `Object.prototype`.
 */

function copyAsOwnProperties<T>(map: Readonly<Record<string, T>>): Record<string, T> {
  // Iterate own enumerable string keys via Object.keys (does not
  // include inherited or symbol keys) and define each as a fresh data
  // property. Using a plain `{}` source rather than `Object.create(null)`
  // so existing test code that inspects `Object.prototype.hasOwnProperty`
  // continues to work.
  const next: Record<string, T> = {};
  for (const k of Object.keys(map)) {
    Object.defineProperty(next, k, {
      value: map[k]!,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return next;
}

export function withFrozenRecordSet<T>(
  map: Readonly<Record<string, T>>,
  key: string,
  value: T
): Readonly<Record<string, T>> {
  const next = copyAsOwnProperties(map);
  Object.defineProperty(next, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
  return Object.freeze(next);
}

export function withFrozenRecordDelete<T>(
  map: Readonly<Record<string, T>>,
  key: string
): Readonly<Record<string, T>> {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return map;
  const next = copyAsOwnProperties(map);
  // Use `delete` only after the property is known to be an own
  // property — the source-side `hasOwnProperty.call` guard already
  // checked this.
  delete next[key];
  return Object.freeze(next);
}

/**
 * Append to an array-valued bucket index. Idempotent: appending an
 * already-present value is a no-op.
 */
export function withFrozenBucketAppend(
  map: Readonly<Record<string, ReadonlyArray<string>>>,
  key: string,
  value: string
): Readonly<Record<string, ReadonlyArray<string>>> {
  const existing = map[key] ?? [];
  if (existing.includes(value)) return map;
  return withFrozenRecordSet(map, key, Object.freeze([...existing, value]));
}

export function withFrozenAppliedEventId(
  ids: ReadonlySet<string>,
  eventId: string
): ReadonlySet<string> {
  if (ids.has(eventId)) return ids;
  const next = new Set(ids);
  next.add(eventId);
  // Freeze the Set marker. Note: `Object.freeze(set)` does not block
  // `.add()` / `.delete()` calls on the Set's internal slots — those
  // mutate internal storage, not enumerable properties — but it does
  // mark the value as intentionally immutable at the type-system /
  // structural level, and the deep-freeze walk
  // (Phase 3.2 local-first integrity test) requires this. Consumers
  // who genuinely need to extend a set MUST build a fresh one rather
  // than mutate in place.
  return Object.freeze(next);
}
