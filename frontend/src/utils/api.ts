import type {
  Scenario,
  Satellite,
  PositionResponse,
  ComparisonResponse,
} from '../types';

const API_BASE = '/api';

// ============================================================================
// Performance-optimized API client
// ============================================================================

/**
 * Request cache to prevent duplicate API calls
 * Uses simple in-memory cache with TTL
 */
const requestCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 5000; // 5 second cache

async function cachedFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const cacheKey = `${url}-${JSON.stringify(options)}`;
  const cached = requestCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as T;
  }
  
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  requestCache.set(cacheKey, { data, timestamp: Date.now() });
  
  return data as T;
}

// ============================================================================
// API Functions
// ============================================================================

export async function fetchScenarios(): Promise<Scenario[]> {
  const response = await cachedFetch<{ scenarios: Scenario[] }>(
    `${API_BASE}/scenarios`
  );
  return response.scenarios;
}

export async function fetchScenario(scenarioId: string): Promise<Scenario> {
  return cachedFetch<Scenario>(`${API_BASE}/scenarios/${scenarioId}`);
}

export async function fetchSatellites(scenarioId: string): Promise<Satellite[]> {
  const response = await cachedFetch<{ satellites: Satellite[] }>(
    `${API_BASE}/scenarios/${scenarioId}/satellites`
  );
  return response.satellites;
}

export async function fetchPositions(
  scenarioId: string,
  timeOffset: number = 0,
  chunkSize?: number,
  chunkIndex?: number
): Promise<PositionResponse> {
  let url = `${API_BASE}/scenarios/${scenarioId}/positions?time_offset=${timeOffset}`;
  
  if (chunkSize !== undefined) {
    url += `&chunk_size=${chunkSize}&chunk_index=${chunkIndex ?? 0}`;
  }
  
  return cachedFetch<PositionResponse>(url);
}

/**
 * Fetch positions with chunked loading for large constellations
 * Returns an async generator for progressive loading
 */
export async function* fetchPositionsChunked(
  scenarioId: string,
  timeOffset: number,
  chunkSize: number = 100
): AsyncGenerator<PositionResponse, void, unknown> {
  // First request to get total chunks
  const firstChunk = await fetchPositions(scenarioId, timeOffset, chunkSize, 0);
  yield firstChunk;
  
  const totalChunks = firstChunk._meta.total_chunks ?? 1;
  
  // Fetch remaining chunks in parallel (batch of 3 for rate limiting)
  const batchSize = 3;
  for (let i = 1; i < totalChunks; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, totalChunks); j++) {
      batch.push(fetchPositions(scenarioId, timeOffset, chunkSize, j));
    }
    const results = await Promise.all(batch);
    for (const result of results) {
      yield result;
    }
  }
}

export async function compareScenarios(
  scenarioIds: string[],
  metric: 'coverage' | 'velocity' | 'altitude' = 'coverage',
  timeOffset: number = 0
): Promise<ComparisonResponse> {
  return cachedFetch<ComparisonResponse>(
    `${API_BASE}/compare?scenario_ids=${scenarioIds.join(',')}&metric=${metric}&time_offset=${timeOffset}`
  );
}

/**
 * Create a Server-Sent Events connection for streaming position data
 */
export function createPositionStream(
  scenarioId: string,
  duration: number = 3600,
  step: number = 60,
  onData: (data: { timestamp: number; positions: Array<{ id: string; longitude: number; latitude: number; altitude: number }> }) => void,
  onError?: (error: Error) => void
): () => void {
  const eventSource = new EventSource(
    `${API_BASE}/scenarios/${scenarioId}/stream?duration=${duration}&step=${step}`
  );
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onData(data);
    } catch {
      console.error('Failed to parse SSE data:');
    }
  };
  
  eventSource.onerror = () => {
    onError?.(new Error('SSE connection error'));
    eventSource.close();
  };
  
  // Return cleanup function
  return () => eventSource.close();
}

/**
 * Create a WebSocket connection for real-time bidirectional updates
 */
export function createWebSocketConnection(
  scenarioId: string,
  onData: (data: { timestamp: number; positions: Array<{ id: string; longitude: number; latitude: number; altitude: number }> }) => void,
  onError?: (error: Error) => void
): {
  send: (command: { time_offset?: number; command?: 'pause' | 'resume' }) => void;
  close: () => void;
} {
  const ws = new WebSocket(`ws://${window.location.host}/ws/positions/${scenarioId}`);
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onData(data);
    } catch (e) {
      console.error('Failed to parse WebSocket data:', e);
    }
  };
  
  ws.onerror = () => {
    onError?.(new Error('WebSocket connection error'));
  };
  
  return {
    send: (command) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(command));
      }
    },
    close: () => ws.close(),
  };
}

// ============================================================================
// Performance Utilities
// ============================================================================

/**
 * Measure API response time
 */
export async function measureApiLatency<T>(
  apiCall: () => Promise<T>
): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await apiCall();
  const latencyMs = performance.now() - start;
  return { result, latencyMs };
}

/**
 * Batch multiple API calls and track performance
 */
export async function batchApiCalls<T>(
  calls: Array<() => Promise<T>>
): Promise<{ results: T[]; totalLatencyMs: number; avgLatencyMs: number }> {
  const start = performance.now();
  const results = await Promise.all(calls.map((call) => call()));
  const totalLatencyMs = performance.now() - start;
  
  return {
    results,
    totalLatencyMs,
    avgLatencyMs: totalLatencyMs / calls.length,
  };
}
