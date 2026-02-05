import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Scenario,
  SatellitePosition,
  PerformanceMetrics,
  PlaybackState,
} from '../types';
import {
  fetchScenarios,
  fetchPositions,
  measureApiLatency,
} from '../utils/api';

// ============================================================================
// useScenarios - Fetch and manage scenario list
// ============================================================================

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const data = await fetchScenarios();
        if (mounted) {
          setScenarios(data);
          setLoading(false);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e : new Error('Failed to load scenarios'));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  return { scenarios, loading, error };
}

// ============================================================================
// usePositions - Fetch and manage satellite positions with performance tracking
// ============================================================================

export function usePositions(scenarioId: string | null) {
  const [positions, setPositions] = useState<SatellitePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [apiLatency, setApiLatency] = useState(0);

  const fetchPositionsForTime = useCallback(
    async (timeOffset: number) => {
      if (!scenarioId) return;

      setLoading(true);
      try {
        const { result, latencyMs } = await measureApiLatency(() =>
          fetchPositions(scenarioId, timeOffset)
        );
        setPositions(result.positions);
        setApiLatency(latencyMs);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Failed to fetch positions'));
      } finally {
        setLoading(false);
      }
    },
    [scenarioId]
  );

  // Initial fetch
  useEffect(() => {
    if (scenarioId) {
      fetchPositionsForTime(0);
    }
  }, [scenarioId, fetchPositionsForTime]);

  return {
    positions,
    loading,
    error,
    apiLatency,
    refetch: fetchPositionsForTime,
  };
}

// ============================================================================
// usePlayback - Simulation playback control
// ============================================================================

export function usePlayback(
  initialDuration: number = 86400 // 24 hours in seconds
): {
  state: PlaybackState;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  seek: (time: number) => void;
  reset: () => void;
} {
  const [state, setState] = useState<PlaybackState>({
    isPlaying: false,
    speed: 60, // 60x real-time (1 second = 1 minute)
    currentTime: 0,
    duration: initialDuration,
  });

  const animationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const tick = useCallback(() => {
    const now = performance.now();
    const delta = now - lastTickRef.current;
    lastTickRef.current = now;

    setState((prev) => {
      const newTime = prev.currentTime + (delta / 1000) * prev.speed;
      if (newTime >= prev.duration) {
        return { ...prev, currentTime: 0 }; // Loop
      }
      return { ...prev, currentTime: newTime };
    });

    animationRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(() => {
    if (!state.isPlaying) {
      lastTickRef.current = performance.now();
      animationRef.current = requestAnimationFrame(tick);
      setState((prev) => ({ ...prev, isPlaying: true }));
    }
  }, [state.isPlaying, tick]);

  const pause = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState((prev) => ({ ...prev, speed }));
  }, []);

  const seek = useCallback((time: number) => {
    setState((prev) => ({
      ...prev,
      currentTime: Math.max(0, Math.min(time, prev.duration)),
    }));
  }, []);

  const reset = useCallback(() => {
    pause();
    setState((prev) => ({ ...prev, currentTime: 0 }));
  }, [pause]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return { state, play, pause, setSpeed, seek, reset };
}

// ============================================================================
// usePerformanceMetrics - Track rendering performance
// ============================================================================

export function usePerformanceMetrics(): {
  metrics: PerformanceMetrics;
  recordFrame: () => void;
  updateApiLatency: (latency: number) => void;
  updateEntityCount: (count: number) => void;
} {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    frameTime: 0,
    fps: 0,
    apiLatency: 0,
    entityCount: 0,
  });

  const frameTimesRef = useRef<number[]>([]);
  const lastFrameRef = useRef<number>(performance.now());

  const recordFrame = useCallback(() => {
    const now = performance.now();
    const frameTime = now - lastFrameRef.current;
    lastFrameRef.current = now;

    frameTimesRef.current.push(frameTime);
    
    // Keep last 60 frames for averaging
    if (frameTimesRef.current.length > 60) {
      frameTimesRef.current.shift();
    }

    const avgFrameTime =
      frameTimesRef.current.reduce((a, b) => a + b, 0) /
      frameTimesRef.current.length;

    setMetrics((prev) => ({
      ...prev,
      frameTime: avgFrameTime,
      fps: 1000 / avgFrameTime,
    }));
  }, []);

  const updateApiLatency = useCallback((latency: number) => {
    setMetrics((prev) => ({ ...prev, apiLatency: latency }));
  }, []);

  const updateEntityCount = useCallback((count: number) => {
    setMetrics((prev) => ({ ...prev, entityCount: count }));
  }, []);

  return { metrics, recordFrame, updateApiLatency, updateEntityCount };
}

// ============================================================================
// useThrottle - Throttle value updates for performance
// ============================================================================

export function useThrottle<T>(value: T, intervalMs: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastUpdateRef.current >= intervalMs) {
      setThrottledValue(value);
      lastUpdateRef.current = now;
    } else {
      const timeout = setTimeout(() => {
        setThrottledValue(value);
        lastUpdateRef.current = Date.now();
      }, intervalMs - (now - lastUpdateRef.current));

      return () => clearTimeout(timeout);
    }
  }, [value, intervalMs]);

  return throttledValue;
}

// ============================================================================
// useDebounce - Debounce value updates
// ============================================================================

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(handler);
  }, [value, delayMs]);

  return debouncedValue;
}
