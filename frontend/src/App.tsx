import { useState, useCallback, useEffect } from 'react';
import { CesiumViewer } from './components/CesiumViewer';
import { ControlPanel } from './components/ControlPanel';
import { ScenarioComparison } from './components/ScenarioComparison';
import {
  useScenarios,
  usePositions,
  usePlayback,
  usePerformanceMetrics,
  useThrottle,
} from './hooks';
import type { VisualizationSettings } from './types';
import './App.css';

type ViewMode = 'visualization' | 'comparison';

const DEFAULT_SETTINGS: VisualizationSettings = {
  showOrbits: false,
  showLabels: false,
  showGroundTracks: false,
  colorByOrbitType: true,
  satelliteScale: 1.0,
};

export default function App() {
  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>('visualization');

  // Data hooks
  const { scenarios, loading: scenariosLoading } = useScenarios();
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const { positions, loading: positionsLoading, apiLatency, refetch } = usePositions(selectedScenario);

  // Playback state
  const playback = usePlayback(86400); // 24 hours
  const throttledTime = useThrottle(playback.state.currentTime, 100); // Update positions at most every 100ms

  // Performance metrics
  const { metrics, recordFrame, updateApiLatency, updateEntityCount } = usePerformanceMetrics();

  // Visualization settings
  const [settings, setSettings] = useState<VisualizationSettings>(DEFAULT_SETTINGS);

  // Selected satellite for detail view
  const [selectedSatellite, setSelectedSatellite] = useState<string | null>(null);

  // Comparison mode state
  const [comparisonScenarios, setComparisonScenarios] = useState<string[]>([]);

  // Update positions when playback time changes
  useEffect(() => {
    if (selectedScenario && !positionsLoading) {
      refetch(throttledTime);
    }
  }, [throttledTime, selectedScenario, refetch, positionsLoading]);

  // Update metrics
  useEffect(() => {
    updateApiLatency(apiLatency);
  }, [apiLatency, updateApiLatency]);

  useEffect(() => {
    updateEntityCount(positions.length);
  }, [positions.length, updateEntityCount]);

  // Handlers
  const handleScenarioSelect = useCallback((id: string) => {
    setSelectedScenario(id);
    setSelectedSatellite(null);
    playback.reset();
  }, [playback]);

  const handleSettingsChange = useCallback((newSettings: Partial<VisualizationSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  const handleToggleComparisonScenario = useCallback((id: string) => {
    setComparisonScenarios((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id].slice(-4) // Max 4 scenarios
    );
  }, []);

  const isLoading = scenariosLoading || positionsLoading;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1>Sedaro Constellation Visualizer</h1>
          <span className="subtitle">High-Performance Satellite Simulation PoC</span>
        </div>
        <div className="header-right">
          <nav className="view-toggle">
            <button
              className={viewMode === 'visualization' ? 'active' : ''}
              onClick={() => setViewMode('visualization')}
            >
              🌍 3D View
            </button>
            <button
              className={viewMode === 'comparison' ? 'active' : ''}
              onClick={() => setViewMode('comparison')}
            >
              📊 Compare
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {viewMode === 'visualization' ? (
          <>
            {/* Cesium Viewer */}
            <div className="viewer-container">
              <CesiumViewer
                positions={positions}
                settings={settings}
                onFrameRender={recordFrame}
                selectedSatelliteId={selectedSatellite}
                onSatelliteSelect={setSelectedSatellite}
              />

              {/* Selected Satellite Info Overlay */}
              {selectedSatellite && (
                <div className="satellite-info-overlay">
                  <button
                    className="close-button"
                    onClick={() => setSelectedSatellite(null)}
                  >
                    ×
                  </button>
                  <h3>{selectedSatellite}</h3>
                  {(() => {
                    const sat = positions.find((p) => p.id === selectedSatellite);
                    if (!sat) return null;
                    return (
                      <div className="satellite-details">
                        <div className="detail-row">
                          <span className="label">Orbit Type:</span>
                          <span className="value">{sat.orbit_type}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Altitude:</span>
                          <span className="value">{(sat.altitude / 1000).toFixed(1)} km</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Velocity:</span>
                          <span className="value">{sat.velocity.toFixed(2)} km/s</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Latitude:</span>
                          <span className="value">{sat.latitude.toFixed(4)}°</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Longitude:</span>
                          <span className="value">{sat.longitude.toFixed(4)}°</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Control Panel */}
            <aside className="control-panel-container">
              <ControlPanel
                scenarios={scenarios}
                selectedScenario={selectedScenario}
                onScenarioSelect={handleScenarioSelect}
                playbackState={playback.state}
                onPlay={playback.play}
                onPause={playback.pause}
                onSpeedChange={playback.setSpeed}
                onSeek={playback.seek}
                onReset={playback.reset}
                settings={settings}
                onSettingsChange={handleSettingsChange}
                metrics={metrics}
                loading={isLoading}
              />
            </aside>
          </>
        ) : (
          /* Comparison View */
          <div className="comparison-container">
            <ScenarioComparison
              scenarios={scenarios}
              selectedScenarios={comparisonScenarios}
              onToggleScenario={handleToggleComparisonScenario}
              timeOffset={throttledTime}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <span>PoC for Sedaro Lead Software Engineer Position</span>
        <span className="separator">|</span>
        <span>Tech: React + TypeScript + Cesium + Python FastAPI</span>
        <span className="separator">|</span>
        <span>
          {positions.length} satellites @ {metrics.fps.toFixed(0)} FPS
        </span>
      </footer>
    </div>
  );
}
