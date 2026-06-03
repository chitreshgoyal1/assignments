import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// Poll fast while a message is loading so the in-chat activity feed feels
// alive (no SSE yet — Slice 2c will replace this with a stream). Idle polling
// is still relaxed.
const POLL_INTERVAL_ACTIVE = 1000;
const POLL_INTERVAL_IDLE   = 5000;

/**
 * Single source of truth for session activity events. Polls the API and
 * derives `latestInProgress` for callers that want a quick "now doing"
 * indicator without re-implementing the search.
 */
export default function useActivity(sessionId, isLoading) {
  const [events, setEvents] = useState([]);
  const [fetching, setFetching] = useState(false);
  const timerRef = useRef(null);

  const fetchActivity = useCallback(async () => {
    if (!sessionId) return;
    setFetching(true);
    try {
      const res = await fetch(`${API}/api/sessions/${sessionId}/activity`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {
      // silently ignore poll failures
    } finally {
      setFetching(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return undefined;

    fetchActivity();

    function schedule() {
      timerRef.current = setTimeout(async () => {
        await fetchActivity();
        schedule();
      }, isLoading ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE);
    }
    schedule();

    return () => clearTimeout(timerRef.current);
  }, [sessionId, isLoading, fetchActivity]);

  const latestInProgress = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i]?.status === "in_progress") return events[i];
    }
    return null;
  }, [events]);

  return { events, fetching, latestInProgress, refresh: fetchActivity };
}
