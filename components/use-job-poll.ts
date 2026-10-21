"use client";

import { useEffect, useRef, useState } from "react";
import { portalRequest } from "../lib/portal-client";

export type PolledJob = { id?: string | null; state?: string | null; phase?: string | null; reason?: string | null; [key: string]: unknown };

const SETTLED = ["succeeded", "failed", "cancelled", "awaiting_approval"];

type PollState = { path: string | null; job: PolledJob | null; error: unknown; done: boolean; stopped: boolean };

/**
 * Polls a job until it settles. Requests never overlap (the next one is scheduled only after the
 * previous one finishes), each request can be aborted, and unmounting stops everything. A failed
 * request is reported but polling continues; after maxPolls the hook stops and says so.
 */
export function useJobPoll(
  path: string | null,
  { intervalMs = 5000, maxPolls = 120, onSettled }: { intervalMs?: number; maxPolls?: number; onSettled?: (job: PolledJob) => void } = {},
) {
  const [state, setState] = useState<PollState>({ path: null, job: null, error: null, done: false, stopped: false });
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let polls = 0;
    let latest: PolledJob | null = null;
    let lastError: unknown = null;
    const schedule = () => {
      timer = setTimeout(tick, intervalMs);
    };
    async function tick() {
      if (cancelled) return;
      polls += 1;
      controller = new AbortController();
      try {
        latest = await portalRequest<PolledJob>(path as string, { signal: controller.signal });
        lastError = null;
      } catch (reason: unknown) {
        if (cancelled) return;
        lastError = reason;
      }
      if (cancelled) return;
      const done = typeof latest?.state === "string" && SETTLED.includes(latest.state);
      const stopped = !done && polls >= maxPolls;
      setState({ path, job: latest, error: lastError, done, stopped });
      if (done && latest) settledRef.current?.(latest);
      else if (!stopped) schedule();
    }
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      controller?.abort();
    };
  }, [path, intervalMs, maxPolls]);
  const current = state.path === path ? state : { path, job: null, error: null, done: false, stopped: false };
  return { job: current.job, error: current.error, done: current.done, stopped: current.stopped };
}
