// Polls the Python backend's /health endpoint so the UI can show a connection
// status and an "offline" banner with instructions.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../api/client';

export interface BackendStatus {
  online: boolean;
  checking: boolean;
  version: string | null;
  lastChecked: number | null;
  apiBase: string;
  recheck: () => void;
}

const POLL_MS = 5000;

export function useBackend(): BackendStatus {
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(true);
  const [version, setVersion] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await api.health(controller.signal);
      setOnline(res.status === 'ok' || Boolean(res.status));
      setVersion(res.version ?? null);
    } catch {
      setOnline(false);
      setVersion(null);
    } finally {
      clearTimeout(timer);
      setChecking(false);
      setLastChecked(Date.now());
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, [check]);

  return { online, checking, version, lastChecked, apiBase: API_BASE, recheck: check };
}
