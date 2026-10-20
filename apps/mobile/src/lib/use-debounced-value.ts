import { useEffect, useState } from 'react';

/**
 * The value, but only after it stopped changing for `delayMs`. For search-as-you-type: typing
 * "Aarav" asks the server once (after the pause), not 5 times (A, Aa, Aar, ...).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    // Typed again before the pause ended: cancel, and wait again.
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
