'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Overview<T> {
  actor: string;
  data: T | null;
  error: number | null;
  loading: boolean;
}

export function useOverview<T>(url: string, actor: string | undefined) {
  const [overview, setOverview] = useState<Overview<T> | null>(null);
  const pending = useRef<AbortController | null>(null);
  const activeActor = useRef<string | undefined>(undefined);

  const fetchOverview = useCallback(() => {
    if (!actor || activeActor.current !== actor || pending.current) return;
    const request = new AbortController();
    pending.current = request;
    return fetch(url, { cache: 'no-store', signal: request.signal })
      .then(async res => {
        if (!res.ok) {
          if (!request.signal.aborted) {
            setOverview(prev => ({ actor, data: prev?.actor === actor ? prev.data : null, error: res.status, loading: false }));
          }
          return;
        }
        const data = (await res.json()) as T;
        if (!request.signal.aborted) setOverview({ actor, data, error: null, loading: false });
      })
      .catch(() => {
        if (!request.signal.aborted) {
          setOverview(prev => ({ actor, data: prev?.actor === actor ? prev.data : null, error: 0, loading: false }));
        }
      })
      .finally(() => {
        if (pending.current === request) pending.current = null;
      });
  }, [actor, url]);

  const load = () => {
    if (!actor || activeActor.current !== actor || pending.current) return;
    setOverview(prev => ({ actor, data: prev?.actor === actor ? prev.data : null, error: null, loading: true }));
    return fetchOverview();
  };

  useEffect(() => {
    activeActor.current = actor;
    void fetchOverview();
    return () => {
      activeActor.current = undefined;
      pending.current?.abort();
      pending.current = null;
    };
  }, [actor, fetchOverview]);

  const current = overview?.actor === actor ? overview : null;
  return { data: current?.data ?? null, loading: current?.loading ?? true, error: current?.error ?? null, load };
}
