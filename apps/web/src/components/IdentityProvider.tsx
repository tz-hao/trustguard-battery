'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PublicIdentity } from '@/lib/types';
import { getCapabilities, type RoleCapabilities } from '@/lib/permissions';

const ROLE_SCOPED_KEY = 'tg_role_scoped_mode';
const PRESENTATION_KEY = 'tg_presentation_mode';
const PREF_EVENT = 'tg-workspace-pref-change';

function subscribePrefs(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PREF_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(PREF_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

function readBoolPref(key: string): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeBoolPref(key: string, next: boolean) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, next ? '1' : '0');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(PREF_EVENT));
    }
  } catch {
    // ignore storage unavailability
  }
}

interface IdentityContextValue {
  actor: PublicIdentity | null;
  identities: PublicIdentity[];
  capabilities: RoleCapabilities;
  authenticated: boolean;
  loading: boolean;
  switching: boolean;
  roleScoped: boolean;
  setRoleScoped: (next: boolean) => void;
  presentationMode: boolean;
  setPresentationMode: (next: boolean) => void;
  switchActor: (actorName: string, options?: { enableRoleScope?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
}

const IdentityContext = createContext<IdentityContextValue>({
  actor: null,
  identities: [],
  capabilities: getCapabilities(null),
  authenticated: false,
  loading: true,
  switching: false,
  roleScoped: false,
  setRoleScoped: () => {},
  presentationMode: false,
  setPresentationMode: () => {},
  switchActor: async () => {},
  logout: async () => {},
});

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<PublicIdentity | null>(null);
  const [identities, setIdentities] = useState<PublicIdentity[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const roleScoped = useSyncExternalStore(
    subscribePrefs,
    () => readBoolPref(ROLE_SCOPED_KEY),
    () => false,
  );
  const presentationMode = useSyncExternalStore(
    subscribePrefs,
    () => readBoolPref(PRESENTATION_KEY),
    () => false,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('presentation-mode', presentationMode);
  }, [presentationMode]);

  const setRoleScoped = useCallback((next: boolean) => {
    writeBoolPref(ROLE_SCOPED_KEY, next);
  }, []);

  const setPresentationMode = useCallback((next: boolean) => {
    writeBoolPref(PRESENTATION_KEY, next);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bff/session', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as {
          actor: PublicIdentity;
          identities: PublicIdentity[];
          authenticated?: boolean;
        };
        setActor(data.actor);
        setIdentities(data.identities);
        setAuthenticated(typeof data.authenticated === 'boolean' ? data.authenticated : true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchActor = useCallback(
    async (actorName: string, options?: { enableRoleScope?: boolean }) => {
      setSwitching(true);
      try {
        const res = await fetch('/api/bff/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actorName }),
        });
        if (res.ok) {
          const data = (await res.json()) as { actor: PublicIdentity };
          setActor(data.actor);
          setAuthenticated(true);
          if (typeof options?.enableRoleScope === 'boolean') {
            setRoleScoped(options.enableRoleScope);
          }
        }
      } finally {
        setSwitching(false);
      }
    },
    [setRoleScoped],
  );

  const logout = useCallback(async () => {
    setSwitching(true);
    try {
      await fetch('/api/bff/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logout: true }),
      });
      setAuthenticated(false);
      setRoleScoped(false);
    } finally {
      setSwitching(false);
    }
  }, [setRoleScoped]);

  const capabilities = useMemo(() => getCapabilities(actor), [actor]);

  return (
    <IdentityContext.Provider
      value={{
        actor,
        identities,
        capabilities,
        authenticated,
        loading,
        switching,
        roleScoped,
        setRoleScoped,
        presentationMode,
        setPresentationMode,
        switchActor,
        logout,
      }}
    >
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity() {
  return useContext(IdentityContext);
}
