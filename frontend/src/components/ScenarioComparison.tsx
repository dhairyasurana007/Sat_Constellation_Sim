import { useState, useEffect, memo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import type { Scenario, ComparisonResponse } from '../types';
import { compareScenarios } from '../utils/api';

interface ScenarioComparisonProps {
  scenarios: Scenario[];
  selectedScenarios: string[];
  onToggleScenario: (id: string) => void;
  timeOffset: number;
}

type ComparisonMetric = 'coverage' | 'velocity' | 'altitude';

const METRIC_LABELS: Record<ComparisonMetric, string> = {
  coverage: 'Latitude Coverage',
  velocity: 'Orbital Velocity',
  altitude: 'Altitude Distribution',
};

const COLORS = ['#00d4ff', '#ffaa00', '#ff00aa', '#00ff88'];

function ScenarioComparisonComponent({
  scenarios,
  selectedScenarios,
  onToggleScenario,
  timeOffset,
}: ScenarioComparisonProps) {
  const [metric, setMetric] = useState<ComparisonMetric>('altitude');
  const [comparisonData, setComparisonData] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedScenarios.length < 2) {
      setComparisonData(null);
      return;
    }

    let mounted = true;
    setLoading(true);

    compareScenarios(selectedScenarios, metric, timeOffset)
      .then((data) => {
        if (mounted) {
          setComparisonData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Comparison failed:', err);
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedScenarios, metric, timeOffset]);

  // Transform data for charts
  const chartData = comparisonData
    ? Object.entries(comparisonData.comparison).map(([id, data]) => ({
        name: scenarios.find((s) => s.id === id)?.name || id,
        id,
        min: data.min ?? 0,
        max: data.max ?? 0,
        mean: data.mean ?? 0,
        coverage: data.lat_coverage ?? 0,
        satellites: data.satellite_count ?? 0,
      }))
    : [];

  // Radar chart data for multi-metric comparison
  const radarData = selectedScenarios.length >= 2 && comparisonData
    ? [
        { metric: 'Coverage', fullMark: 180 },
        { metric: 'Satellites', fullMark: 600 },
        { metric: metric === 'altitude' ? 'Alt (km)' : metric === 'velocity' ? 'Vel (km/s)' : 'Coverage', fullMark: metric === 'altitude' ? 2000 : metric === 'velocity' ? 10 : 180 },
      ].map((item) => {
        const entry: Record<string, string | number> = { metric: item.metric };
        Object.entries(comparisonData.comparison).forEach(([id, data]) => {
          const scenarioName = scenarios.find((s) => s.id === id)?.name || id;
          if (item.metric === 'Coverage') {
            entry[scenarioName] = data.lat_coverage ?? 0;
          } else if (item.metric === 'Satellites') {
            entry[scenarioName] = data.satellite_count ?? 0;
          } else {
            entry[scenarioName] = data.mean ?? 0;
          }
        });
        return entry;
      })
    : [];

  return (
    <div className="scenario-comparison">
      <div className="comparison-header">
        <h2>Scenario Comparison</h2>
        <p className="comparison-subtitle">
          Select 2+ scenarios to compare performance metrics
        </p>
      </div>

      {/* Scenario Selection */}
      <div className="scenario-selector">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            className={`scenario-chip ${
              selectedScenarios.includes(scenario.id) ? 'selected' : ''
            }`}
            onClick={() => onToggleScenario(scenario.id)}
            style={{
              borderColor: selectedScenarios.includes(scenario.id)
                ? COLORS[selectedScenarios.indexOf(scenario.id) % COLORS.length]
                : undefined,
            }}
          >
            <span className="chip-name">{scenario.name}</span>
            <span className="chip-count">{scenario.satellite_count}</span>
          </button>
        ))}
      </div>

      {selectedScenarios.length < 2 && (
        <div className="comparison-placeholder">
          <p>Select at least 2 scenarios to see comparison charts</p>
        </div>
      )}

      {selectedScenarios.length >= 2 && (
        <>
          {/* Metric Selector */}
          <div className="metric-selector">
            {(Object.keys(METRIC_LABELS) as ComparisonMetric[]).map((m) => (
              <button
                key={m}
                className={`metric-button ${metric === m ? 'active' : ''}`}
                onClick={() => setMetric(m)}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>

          {loading && (
            <div className="chart-loading">
              <div className="loading-spinner"></div>
              <span>Computing comparison...</span>
            </div>
          )}

          {!loading && comparisonData && (
            <div className="charts-container">
              {/* Bar Chart */}
              <div className="chart-wrapper">
                <h3>{METRIC_LABELS[metric]} Comparison</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis type="number" stroke="#888" />
                    <YAxis dataKey="name" type="category" width={120} stroke="#888" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a2e',
                        border: '1px solid #333',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="min" fill="#00d4ff" name="Min" />
                    <Bar dataKey="mean" fill="#ffaa00" name="Mean" />
                    <Bar dataKey="max" fill="#ff00aa" name="Max" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Radar Chart */}
              <div className="chart-wrapper">
                <h3>Multi-Metric Overview</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#333" />
                    <PolarAngleAxis dataKey="metric" stroke="#888" />
                    <PolarRadiusAxis stroke="#888" />
                    {selectedScenarios.map((id, index) => {
                      const scenario = scenarios.find((s) => s.id === id);
                      return (
                        <Radar
                          key={id}
                          name={scenario?.name || id}
                          dataKey={scenario?.name || id}
                          stroke={COLORS[index % COLORS.length]}
                          fill={COLORS[index % COLORS.length]}
                          fillOpacity={0.2}
                        />
                      );
                    })}
                    <Legend />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a2e',
                        border: '1px solid #333',
                        borderRadius: '8px',
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Stats Table */}
              <div className="stats-table">
                <h3>Detailed Statistics</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Satellites</th>
                      <th>Min</th>
                      <th>Mean</th>
                      <th>Max</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(comparisonData.comparison).map(([id, data]) => (
                      <tr key={id}>
                        <td>{scenarios.find((s) => s.id === id)?.name || id}</td>
                        <td>{data.satellite_count ?? '-'}</td>
                        <td>{data.min?.toFixed(2) ?? '-'}</td>
                        <td>{data.mean?.toFixed(2) ?? '-'}</td>
                        <td>{data.max?.toFixed(2) ?? '-'}</td>
                        <td>{data.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="computation-time">
                  Computed in {comparisonData._meta.computation_time_ms.toFixed(1)}ms
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const ScenarioComparison = memo(ScenarioComparisonComponent);
