"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
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

/**
 * One shared state for the Spaces of the user.
 *
 * The hook used to be instantiated in every panel that needs the workspace. Each instance kept
 * its own state and fetched GET /api/bff/spaces again, so a page fired the request several times
 * and two panels could show two different states of the same list: the navbar said "Workspaces
 * unavailable" while the page below still said "Loading projects…". The store below fetches once
 * and shares the result with every panel.
 */
type Store = {
  spaces: SpaceSummary[];
  storedId: string | null;
  loading: boolean;
  failed: boolean;
};

const initialState: Store = { spaces: [], storedId: null, loading: true, failed: false };

let state: Store = initialState;
let loaded = false;
let inFlight: Promise<void> | null = null;
let eventsBound = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function update(patch: Partial<Store>) {
  state = { ...state, ...patch };
  emit();
}

function readStoredSpaceId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_SPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function loadSpaces() {
  update({ loading: true });
  try {
    const response = await bffFetch("/api/bff/spaces", { cache: "no-store" });
    if (!response.ok) throw new Error("spaces unavailable");
    const body = await response.json() as SpaceListResponse;
    loaded = true;
    update({
      spaces: Array.isArray(body.spaces) ? body.spaces : [],
      failed: false,
      loading: false,
    });
  } catch {
    update({ failed: true, loading: false });
  }
}

// The first panel that mounts starts the request, the others join it.
function ensureLoaded(force = false) {
  if (loaded && !force) return;
  if (!inFlight) {
    inFlight = loadSpaces().finally(() => {
      inFlight = null;
    });
  }
}

function bindEvents() {
  if (eventsBound || typeof window === "undefined") return;
  eventsBound = true;
  // The user picked another Space in the switcher.
  window.addEventListener(ACTIVE_SPACE_EVENT, () => update({ storedId: readStoredSpaceId() }));
  // A Space was created or deleted: the list has to be read again.
  window.addEventListener(SPACES_CHANGED_EVENT, () => {
    update({ storedId: readStoredSpaceId() });
    loaded = false;
    ensureLoaded(true);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => initialState;

export function useActiveSpace(): ActiveSpaceState {
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    bindEvents();
    // The stored choice is read on the client only.
    update({ storedId: readStoredSpaceId() });
    ensureLoaded();
  }, []);

  const setActiveSpaceId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(ACTIVE_SPACE_STORAGE_KEY, id);
    } catch {
      // Storage may be unavailable (private mode); the in-memory choice still applies below.
    }
    update({ storedId: id });
    window.dispatchEvent(new Event(ACTIVE_SPACE_EVENT));
  }, []);

  // Retry after a failed load. Without this a failure would stay on screen until a full page reload.
  const reload = useCallback(() => {
    loaded = false;
    update({ loading: true, failed: false });
    ensureLoaded(true);
  }, []);

  return {
    spaces: store.spaces,
    activeSpace: chooseActiveSpace(store.spaces, store.storedId),
    loading: store.loading,
    failed: store.failed,
    setActiveSpaceId,
    reload,
  };
}
