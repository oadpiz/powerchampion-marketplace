"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PortalError } from "../lib/portal-client";
import { opIsActive, studioApi, type StudioProject } from "../lib/studio-client";

export const FAST_POLL_MS = 3_000;
export const SLOW_POLL_MS = 10_000;
export const SLOW_AFTER_MS = 120_000;

/** Poll interval while an op is active: 3 s, then 10 s once it has been running for 2 minutes. */
export function pollDelay(activeForMs: number): number {
  return activeForMs >= SLOW_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS;
}

/** Whether the project document still needs polling: an unresolved active op (spec 7, "Polling"). */
export function needsPoll(project: StudioProject | null): boolean {
  return !!project && opIsActive(project.active_op);
}

/**
 * The studio's project poll (not useJobPoll: there is no hard cap, and "settled" is when active_op is null
 * or terminal). Non-overlapping; pauses while the tab is hidden and reloads when it is shown or focused.
 * Stops on 401/404, keeps the last document on other errors and retries at the slow rate.
 */
export function useStudioProject(projectId: string, now: () => number = Date.now) {
  const [project, setProjectState] = useState<StudioProject | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  // A refresh asked for while a load is in flight: that load's (older) answer must not end the polling.
  const again = useRef(false);
  const activeSince = useRef<number | null>(null);
  const stopped = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const current = useRef<StudioProject | null>(null);

  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // resumes on visibility
      void loadRef.current();
    }, delay);
  }, []);

  const settle = useCallback(
    (doc: StudioProject | null, failed: boolean) => {
      if (stopped.current) return;
      if (doc && needsPoll(doc)) {
        if (activeSince.current === null) activeSince.current = now();
        schedule(failed ? SLOW_POLL_MS : pollDelay(now() - activeSince.current));
      } else {
        activeSince.current = null;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      }
    },
    [now, schedule],
  );

  const load = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    let latest: StudioProject | null = null;
    let failed = false;
    try {
      latest = await studioApi.project(projectId, abort.signal);
      if (abort.signal.aborted) return;
      current.current = latest;
      setProjectState(latest);
      setError(null);
    } catch (cause) {
      if (abort.signal.aborted) return;
      failed = true;
      setError(cause);
      if (cause instanceof PortalError && (cause.status === 401 || cause.status === 404 || cause.status === 403)) {
        stopped.current = true;
      }
      latest = current.current;
    } finally {
      if (controller.current === abort) inFlight.current = false;
      if (!abort.signal.aborted) setLoading(false);
    }
    if (again.current && !abort.signal.aborted) {
      again.current = false;
      void loadRef.current();
      return;
    }
    settle(latest, failed);
  }, [projectId, settle]);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  /** Reload now (after an edit or an op submission) and resume polling if an op is active. */
  const refresh = useCallback(() => {
    stopped.current = false;
    void loadRef.current();
  }, []);

  /** Replace the document with one an edit returned; polling follows its active_op. */
  const setProject = useCallback(
    (doc: StudioProject) => {
      current.current = doc;
      setProjectState(doc);
      setError(null);
      settle(doc, false);
    },
    [settle],
  );

  useEffect(() => {
    stopped.current = false;
    void loadRef.current();
    const wake = () => {
      if (document.visibilityState === "visible" && !stopped.current && !inFlight.current) void loadRef.current();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped.current = true;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      controller.current?.abort();
      // A remount must be able to load at once, not wait for the aborted request to unwind.
      inFlight.current = false;
      again.current = false;
    };
  }, [projectId]);

  return { project, error, loading, refresh, setProject };
}
