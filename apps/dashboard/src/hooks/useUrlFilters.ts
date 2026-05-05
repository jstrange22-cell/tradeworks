/**
 * Bind filter state to URL query params so explorer views are shareable.
 *
 * Generic over the filter shape — each value is serialised as a string
 * (numeric values round-trip through Number()). Empty / undefined values
 * are stripped from the URL.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Accepts string-literal unions (e.g. Verdict = 'approve' | 'veto' | 'escalate')
// in addition to plain string / number — those are still serialisable through
// String() and round-trip via the per-key `parsers`.
type Primitive = string | number | boolean | undefined;

export interface UseUrlFiltersOptions<T> {
  /** Map: param key → coercion fn (parses string back to T[key]) */
  parsers: { [K in keyof T]?: (raw: string) => T[K] };
}

// Constraint says "every property of T must be Primitive (or undefined)" — but
// without forcing an index signature on the caller's filter type. This lets
// `ExplorerListFilters` (typed object with literal keys + Verdict union) flow
// through cleanly while still rejecting filters whose values aren't
// serialisable.
export function useUrlFilters<T extends { [K in keyof T]: Primitive }>(
  options: UseUrlFiltersOptions<T>,
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<T>(() => {
    const out: Record<string, unknown> = {};
    for (const [key, parser] of Object.entries(options.parsers)) {
      const raw = searchParams.get(key);
      if (raw !== null && raw !== '') {
        const fn = parser as ((raw: string) => unknown) | undefined;
        out[key] = fn ? fn(raw) : raw;
      }
    }
    return out as T;
  }, [searchParams, options.parsers]);

  const setFilters = useCallback(
    (next: T) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '' || value === null) continue;
        if (typeof value === 'number' && Number.isNaN(value)) continue;
        params.set(key, String(value));
      }
      setSearchParams(params, { replace: false });
    },
    [setSearchParams],
  );

  return [filters, setFilters];
}
