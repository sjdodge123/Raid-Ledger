/**
 * Own-property lookup for plain-object tables keyed by untrusted strings
 * (addon imports, API payloads). A bare `TABLE[key]` resolves prototype
 * members, so `'constructor'` or `'toString'` would return a function.
 */
export function ownLookup<V>(
  table: Readonly<Record<string, V>>,
  key: string,
): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
