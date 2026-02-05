// ============================================================================
// Domain Types for Satellite Constellation Visualization
// ============================================================================

export type OrbitType = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export interface OrbitalElements {
  semi_major_axis: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  arg_periapsis: number;
  true_anomaly: number;
}

export interface Satellite {
  id: string;
  name: string;
  orbit_type: OrbitType;
  orbital_elements: OrbitalElements;
  launch_date: string;
  status: string;
}

export interface SatellitePosition {
  id: string;
  name?: string;
  orbit_type?: OrbitType;
  longitude: number;
  latitude: number;
  altitude: number;
  velocity: number;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  satellite_count: number;
  duration_hours: number;
  created_at: string;
}

export interface PositionResponse {
  scenario_id: string;
  time_offset_seconds: number;
  count: number;
  positions: SatellitePosition[];
  _meta: {
    computation_time_ms: number;
    chunk_index?: number;
    total_chunks?: number;
    chunk_size?: number;
  };
}

export interface ScenarioComparison {
  [scenarioId: string]: {
    min?: number;
    max?: number;
    mean?: number;
    unit: string;
    lat_coverage?: number;
    satellite_count?: number;
  };
}

export interface ComparisonResponse {
  metric: string;
  time_offset_seconds: number;
  comparison: ScenarioComparison;
  _meta: {
    computation_time_ms: number;
  };
}

// Performance metrics
export interface PerformanceMetrics {
  frameTime: number;
  fps: number;
  apiLatency: number;
  entityCount: number;
}

// Playback state
export interface PlaybackState {
  isPlaying: boolean;
  speed: number;
  currentTime: number;
  duration: number;
}

// Visualization settings
export interface VisualizationSettings {
  showOrbits: boolean;
  showLabels: boolean;
  showGroundTracks: boolean;
  colorByOrbitType: boolean;
  satelliteScale: number;
}
