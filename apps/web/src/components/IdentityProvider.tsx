'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PublicIdentity } from '@/lib/types';

interface IdentityContextValue {
  actor: PublicIdentity | null;
  identities: PublicIdentity[];
  loading: boolean;
  switching: boolean;
  switchActor: (actorName: string) => Promise<void>;
}

const IdentityContext = createContext<IdentityContextValue>({
  actor: null,
  identities: [],
  loading: true,
  switching: false,
  switchActor: async () => {},
});

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<PublicIdentity | null>(null);
  const [identities, setIdentities] = useState<PublicIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bff/session', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { actor: PublicIdentity; identities: PublicIdentity[] };
        setActor(data.actor);
        setIdentities(data.identities);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchActor = useCallback(async (actorName: string) => {
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
      }
    } finally {
      setSwitching(false);
    }
  }, []);

  return (
    <IdentityContext.Provider value={{ actor, identities, loading, switching, switchActor }}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity() {
  return useContext(IdentityContext);
}
