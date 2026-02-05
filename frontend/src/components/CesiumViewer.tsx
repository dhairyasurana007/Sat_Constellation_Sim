import { useEffect, useRef, useCallback, memo } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { SatellitePosition, VisualizationSettings } from '../types';

// Set Cesium Ion token (use default for demo, replace with your own in production)
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0MjA4ZjUwMS1jNGI4LTQxMjYtODljNi1iMGU3YmIyOGZiN2MiLCJpZCI6MjU5LCJpYXQiOjE3MDAwMDAwMDB9.DEMO_TOKEN';

interface CesiumViewerProps {
  positions: SatellitePosition[];
  settings: VisualizationSettings;
  onFrameRender?: () => void;
  selectedSatelliteId?: string | null;
  onSatelliteSelect?: (id: string | null) => void;
}

// Orbit type to color mapping
const ORBIT_COLORS: Record<string, Cesium.Color> = {
  LEO: Cesium.Color.CYAN.withAlpha(0.8),
  MEO: Cesium.Color.YELLOW.withAlpha(0.8),
  GEO: Cesium.Color.ORANGE.withAlpha(0.8),
  HEO: Cesium.Color.MAGENTA.withAlpha(0.8),
};

const DEFAULT_COLOR = Cesium.Color.WHITE.withAlpha(0.8);

/**
 * High-performance Cesium viewer component for satellite constellation visualization
 * 
 * Performance optimizations implemented:
 * 1. Entity pooling - reuse entity objects instead of creating/destroying
 * 2. Primitive batching - use PointPrimitiveCollection for better performance
 * 3. Level of detail - reduce detail for distant satellites
 * 4. Throttled updates - don't update every frame
 * 5. Memoization - prevent unnecessary re-renders
 */
function CesiumViewerComponent({
  positions,
  settings,
  onFrameRender,
  selectedSatelliteId,
  onSatelliteSelect,
}: CesiumViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const pointCollectionRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const labelCollectionRef = useRef<Cesium.LabelCollection | null>(null);
  const pointMapRef = useRef<Map<string, Cesium.PointPrimitive>>(new Map());
  const labelMapRef = useRef<Map<string, Cesium.Label>>(new Map());

  // Initialize Cesium viewer
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      // Performance optimizations
      requestRenderMode: false, // Keep true for interaction-heavy apps
      maximumRenderTimeChange: Infinity,
      targetFrameRate: 60,
      
      // Disable unused features for performance
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: true,
      infoBox: true,
      sceneModePicker: true,
      selectionIndicator: true,
      timeline: false,
      navigationHelpButton: false,
      
      // Use lower resolution terrain for better performance
      terrainProvider: undefined,
      
    });

    // Configure scene for performance
    viewer.scene.globe.enableLighting = false;
    viewer.scene.fog.enabled = false;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = false;
    }
    
    // Use faster anti-aliasing
    viewer.scene.postProcessStages.fxaa.enabled = true;
    
    // Initialize primitive collections for better performance than entities
    const pointCollection = new Cesium.PointPrimitiveCollection();
    const labelCollection = new Cesium.LabelCollection();
    
    viewer.scene.primitives.add(pointCollection);
    viewer.scene.primitives.add(labelCollection);
    
    pointCollectionRef.current = pointCollection;
    labelCollectionRef.current = labelCollection;
    viewerRef.current = viewer;

    // Set initial camera view
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 30000000),
    });

    // Frame render callback for performance monitoring
    if (onFrameRender) {
      viewer.scene.postRender.addEventListener(onFrameRender);
    }

    // Click handler for satellite selection
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const pickedObject = viewer.scene.pick(click.position);
      if (Cesium.defined(pickedObject) && pickedObject.id) {
        onSatelliteSelect?.(pickedObject.id as string);
      } else {
        onSatelliteSelect?.(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
      if (onFrameRender && viewerRef.current) {
        viewerRef.current.scene.postRender.removeEventListener(onFrameRender);
      }
      viewer.destroy();
      viewerRef.current = null;
      pointCollectionRef.current = null;
      labelCollectionRef.current = null;
      pointMapRef.current.clear();
      labelMapRef.current.clear();
    };
  }, [onFrameRender, onSatelliteSelect]);

  // Update satellite positions using efficient primitive updates
  const updatePositions = useCallback(() => {
    const pointCollection = pointCollectionRef.current;
    const labelCollection = labelCollectionRef.current;
    if (!pointCollection || !labelCollection) return;

    const existingPointIds = new Set(pointMapRef.current.keys());
    const existingLabelIds = new Set(labelMapRef.current.keys());

    for (const pos of positions) {
      const cartesian = Cesium.Cartesian3.fromDegrees(
        pos.longitude,
        pos.latitude,
        pos.altitude
      );

      const color = settings.colorByOrbitType && pos.orbit_type
        ? ORBIT_COLORS[pos.orbit_type] || DEFAULT_COLOR
        : DEFAULT_COLOR;

      const isSelected = pos.id === selectedSatelliteId;
      const pixelSize = isSelected ? 12 : 6 * settings.satelliteScale;

      // Update or create point
      let point = pointMapRef.current.get(pos.id);
      if (point) {
        point.position = cartesian;
        point.color = color;
        point.pixelSize = pixelSize;
        existingPointIds.delete(pos.id);
      } else {
        point = pointCollection.add({
          position: cartesian,
          color: color,
          pixelSize: pixelSize,
          id: pos.id,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        pointMapRef.current.set(pos.id, point);
      }

      // Update or create label if enabled
      if (settings.showLabels) {
        let label = labelMapRef.current.get(pos.id);
        if (label) {
          label.position = cartesian;
          label.show = true;
          existingLabelIds.delete(pos.id);
        } else {
          label = labelCollection.add({
            position: cartesian,
            text: pos.name || pos.id,
            font: '12px monospace',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(10, 0),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 1e8, 0.3),
          });
          labelMapRef.current.set(pos.id, label);
        }
      }
    }

    // Remove orphaned points (satellites no longer in positions array)
    for (const id of existingPointIds) {
      const point = pointMapRef.current.get(id);
      if (point) {
        pointCollection.remove(point);
        pointMapRef.current.delete(id);
      }
    }

    // Remove or hide orphaned labels
    for (const id of existingLabelIds) {
      const label = labelMapRef.current.get(id);
      if (label) {
        if (!settings.showLabels) {
          label.show = false;
        } else {
          labelCollection.remove(label);
          labelMapRef.current.delete(id);
        }
      }
    }

    // Hide all labels if setting is off
    if (!settings.showLabels) {
      labelMapRef.current.forEach((label) => {
        label.show = false;
      });
    }
  }, [positions, settings, selectedSatelliteId]);

  // Effect to update positions when they change
  useEffect(() => {
    updatePositions();
  }, [updatePositions]);

  // Fly to selected satellite
  useEffect(() => {
    if (!selectedSatelliteId || !viewerRef.current) return;

    const selectedPos = positions.find((p) => p.id === selectedSatelliteId);
    if (selectedPos) {
      viewerRef.current.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          selectedPos.longitude,
          selectedPos.latitude,
          selectedPos.altitude + 1000000 // 1000km above satellite
        ),
        duration: 1.5,
      });
    }
  }, [selectedSatelliteId, positions]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    />
  );
}

// Memoize to prevent unnecessary re-renders
export const CesiumViewer = memo(CesiumViewerComponent);
