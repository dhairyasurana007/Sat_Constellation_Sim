import { memo } from 'react';
import type {
  Scenario,
  PlaybackState,
  PerformanceMetrics,
  VisualizationSettings,
} from '../types';

interface ControlPanelProps {
  scenarios: Scenario[];
  selectedScenario: string | null;
  onScenarioSelect: (id: string) => void;
  playbackState: PlaybackState;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (time: number) => void;
  onReset: () => void;
  settings: VisualizationSettings;
  onSettingsChange: (settings: Partial<VisualizationSettings>) => void;
  metrics: PerformanceMetrics;
  loading: boolean;
}

const SPEED_OPTIONS = [1, 10, 60, 300, 600, 1800, 3600];

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatSpeed(speed: number): string {
  if (speed < 60) return `${speed}x`;
  if (speed < 3600) return `${speed / 60}min/s`;
  return `${speed / 3600}hr/s`;
}

function ControlPanelComponent({
  scenarios,
  selectedScenario,
  onScenarioSelect,
  playbackState,
  onPlay,
  onPause,
  onSpeedChange,
  onSeek,
  onReset,
  settings,
  onSettingsChange,
  metrics,
  loading,
}: ControlPanelProps) {
  return (
    <div className="control-panel">
      {/* Scenario Selection */}
      <section className="panel-section">
        <h3>Scenario</h3>
        <select
          value={selectedScenario || ''}
          onChange={(e) => onScenarioSelect(e.target.value)}
          disabled={loading}
        >
          <option value="">Select a scenario...</option>
          {scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name} ({scenario.satellite_count} sats)
            </option>
          ))}
        </select>
        {selectedScenario && (
          <p className="scenario-description">
            {scenarios.find((s) => s.id === selectedScenario)?.description}
          </p>
        )}
      </section>

      {/* Playback Controls */}
      <section className="panel-section">
        <h3>Playback</h3>
        <div className="playback-controls">
          <button
            onClick={playbackState.isPlaying ? onPause : onPlay}
            disabled={!selectedScenario}
            className="play-button"
          >
            {playbackState.isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button onClick={onReset} disabled={!selectedScenario}>
            ⏮ Reset
          </button>
        </div>

        <div className="time-display">
          <span className="current-time">{formatTime(playbackState.currentTime)}</span>
          <span className="duration"> / {formatTime(playbackState.duration)}</span>
        </div>

        <input
          type="range"
          min={0}
          max={playbackState.duration}
          value={playbackState.currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="time-slider"
          disabled={!selectedScenario}
        />

        <div className="speed-controls">
          <label>Speed:</label>
          <select
            value={playbackState.speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
          >
            {SPEED_OPTIONS.map((speed) => (
              <option key={speed} value={speed}>
                {formatSpeed(speed)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Visualization Settings */}
      <section className="panel-section">
        <h3>Visualization</h3>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.showLabels}
            onChange={(e) => onSettingsChange({ showLabels: e.target.checked })}
          />
          Show Labels
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.colorByOrbitType}
            onChange={(e) => onSettingsChange({ colorByOrbitType: e.target.checked })}
          />
          Color by Orbit Type
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.showOrbits}
            onChange={(e) => onSettingsChange({ showOrbits: e.target.checked })}
          />
          Show Orbit Paths
        </label>

        <div className="slider-control">
          <label>Satellite Scale: {settings.satelliteScale.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={settings.satelliteScale}
            onChange={(e) =>
              onSettingsChange({ satelliteScale: Number(e.target.value) })
            }
          />
        </div>
      </section>

      {/* Performance Metrics */}
      <section className="panel-section metrics">
        <h3>Performance</h3>
        <div className="metric">
          <span className="metric-label">FPS:</span>
          <span
            className={`metric-value ${
              metrics.fps < 30 ? 'warning' : metrics.fps < 50 ? 'caution' : 'good'
            }`}
          >
            {metrics.fps.toFixed(1)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Frame Time:</span>
          <span className="metric-value">{metrics.frameTime.toFixed(1)}ms</span>
        </div>
        <div className="metric">
          <span className="metric-label">API Latency:</span>
          <span
            className={`metric-value ${
              metrics.apiLatency > 100 ? 'warning' : 'good'
            }`}
          >
            {metrics.apiLatency.toFixed(0)}ms
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Entities:</span>
          <span className="metric-value">{metrics.entityCount}</span>
        </div>
      </section>

      {/* Legend */}
      {settings.colorByOrbitType && (
        <section className="panel-section legend">
          <h3>Orbit Types</h3>
          <div className="legend-item">
            <span className="legend-color leo"></span>
            <span>LEO (Low Earth)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color meo"></span>
            <span>MEO (Medium Earth)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color geo"></span>
            <span>GEO (Geostationary)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color heo"></span>
            <span>HEO (Highly Elliptical)</span>
          </div>
        </section>
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <span>Loading constellation data...</span>
        </div>
      )}
    </div>
  );
}

export const ControlPanel = memo(ControlPanelComponent);
