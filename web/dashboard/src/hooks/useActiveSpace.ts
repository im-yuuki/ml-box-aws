"use client";

import { useCallback, useEffect, useState } from "react";
import { bffFetch } from "@/lib/bffFetch";
import {
  ACTIVE_SPACE_EVENT,
  ACTIVE_SPACE_STORAGE_KEY,
  SPACES_CHANGED_EVENT,
  chooseActiveSpace,
  type SpaceListResponse,
  type SpaceSummary,
} from "@/lib/spaces";

export type ActiveSpaceState = {
  spaces: SpaceSummary[];
  activeSpace: SpaceSummary | null;
  loading: boolean;
  failed: boolean;
  setActiveSpaceId: (id: string) => void;
  reload: () => void;
};

function readStoredSpaceId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_SPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useActiveSpace(): ActiveSpaceState {
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [storedId, setStoredId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await bffFetch("/api/bff/spaces", { cache: "no-store" });
        if (!response.ok) throw new Error("spaces unavailable");
        const body = await response.json() as SpaceListResponse;
        if (!cancelled) {
          setSpaces(Array.isArray(body.spaces) ? body.spaces : []);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const task = window.setTimeout(() => {
      setStoredId(readStoredSpaceId());
      void load();
    }, 0);
    const onChange = () => setStoredId(readStoredSpaceId());
    window.addEventListener(ACTIVE_SPACE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.clearTimeout(task);
      window.removeEventListener(ACTIVE_SPACE_EVENT, onChange);
    };
  }, [attempt]);

  // Retry after a failed load. Without this a failure would stay on screen until a full page reload.
  const reload = useCallback(() => {
    setLoading(true);
    setAttempt((value) => value + 1);
  }, []);

  // Another component created or deleted a Space: refresh the list without showing the loading state.
  useEffect(() => {
    const onChanged = () => setAttempt((value) => value + 1);
    window.addEventListener(SPACES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SPACES_CHANGED_EVENT, onChanged);
  }, []);

  const setActiveSpaceId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(ACTIVE_SPACE_STORAGE_KEY, id);
    } catch {
      // Storage may be unavailable (private mode); the in-memory choice still applies below.
    }
    setStoredId(id);
    window.dispatchEvent(new Event(ACTIVE_SPACE_EVENT));
  }, []);

  return {
    spaces,
    activeSpace: chooseActiveSpace(spaces, storedId),
    loading,
    failed,
    setActiveSpaceId,
    reload,
  };
}
