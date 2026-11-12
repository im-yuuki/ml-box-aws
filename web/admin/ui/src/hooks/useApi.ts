"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type State<T> = { data: T | null; error: string | null; loading: boolean };

/** Loads a console endpoint once on mount and again on `reload`. A newer request always wins over an older one. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: path !== null });
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const ticket = ++latest.current;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const data = await api<T>(path);
      if (ticket === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (ticket !== latest.current) return;
      setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "error" }));
    }
  }, [path]);

  useEffect(() => {
    const task = window.setTimeout(load, 0);
    return () => {
      window.clearTimeout(task);
      latest.current += 1;
    };
  }, [load]);

  return { ...state, reload: load };
}
