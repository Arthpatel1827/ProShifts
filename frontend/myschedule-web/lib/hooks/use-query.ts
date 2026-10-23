"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type QueryState<T> = {
    data: T | undefined;
    error: Error | null;
    /** True only while there is no data yet. */
    loading: boolean;
    /** True during any in-flight request, including background refreshes. */
    fetching: boolean;
    refetch: () => Promise<void>;
    setData: (updater: T | ((prev: T | undefined) => T)) => void;
};

/**
 * Minimal data-fetching hook. Re-runs when `key` changes, ignores responses from
 * stale requests, and keeps previous data visible during refreshes so pages don't flash.
 * Pass `enabled: false` (or a null key) to wait for prerequisites such as a location id.
 */
export function useQuery<T>(
    key: readonly unknown[] | null,
    fn: () => Promise<T>,
    options: { enabled?: boolean; refreshMs?: number } = {}
): QueryState<T> {
    const { enabled = true, refreshMs } = options;
    const [data, setDataState] = useState<T | undefined>(undefined);
    const [error, setError] = useState<Error | null>(null);
    const [fetching, setFetching] = useState(false);
    const requestId = useRef(0);
    // Always call the latest fn without re-running the query when its identity changes.
    const fnRef = useRef(fn);
    useLayoutEffect(() => {
        fnRef.current = fn;
    });

    const active = enabled && key !== null;
    const keyString = JSON.stringify(key);

    const run = useCallback(async () => {
        if (!active) return;
        const id = ++requestId.current;
        setFetching(true);
        try {
            const result = await fnRef.current();
            if (id === requestId.current) {
                setDataState(result);
                setError(null);
            }
        } catch (err) {
            if (id === requestId.current) setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            if (id === requestId.current) setFetching(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, keyString]);

    useEffect(() => {
        // Fetching when the key changes is synchronising with the server — the intended use of an effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void run();
    }, [run]);

    useEffect(() => {
        if (!active || !refreshMs) return;
        const handle = setInterval(() => {
            if (document.visibilityState === "visible") void run();
        }, refreshMs);
        return () => clearInterval(handle);
    }, [active, refreshMs, run]);

    const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
        setDataState((prev) =>
            typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater
        );
    }, []);

    return {
        data,
        error,
        loading: active && data === undefined && error === null,
        fetching,
        refetch: run,
        setData,
    };
}
