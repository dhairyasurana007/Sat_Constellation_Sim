"""
Sedaro PoC - Satellite Constellation Simulation Backend
========================================================
Demonstrates:
- High-performance async API design
- Efficient data streaming for massive datasets
- Scenario comparison capabilities
- Performance-conscious data chunking
"""

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import json
import math
import asyncio
from datetime import datetime, timedelta
from typing import Optional, List, Generator
import random
from dataclasses import dataclass, asdict
from enum import Enum
import time

app = FastAPI(
    title="Sedaro Constellation Simulator PoC",
    description="High-performance satellite constellation visualization backend",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Domain Models
# ============================================================================

class OrbitType(str, Enum):
    LEO = "LEO"  # Low Earth Orbit (160-2000 km)
    MEO = "MEO"  # Medium Earth Orbit (2000-35786 km)
    GEO = "GEO"  # Geostationary (35786 km)
    HEO = "HEO"  # Highly Elliptical Orbit

@dataclass
class OrbitalElements:
    """Keplerian orbital elements for satellite positioning"""
    semi_major_axis: float  # km
    eccentricity: float
    inclination: float  # degrees
    raan: float  # Right Ascension of Ascending Node (degrees)
    arg_periapsis: float  # Argument of periapsis (degrees)
    true_anomaly: float  # degrees
    
@dataclass
class Satellite:
    id: str
    name: str
    orbit_type: OrbitType
    orbital_elements: OrbitalElements
    launch_date: str
    status: str
    
@dataclass 
class Scenario:
    id: str
    name: str
    description: str
    satellite_count: int
    duration_hours: int
    created_at: str

# ============================================================================
# Physics Engine (Simplified for PoC)
# ============================================================================

EARTH_RADIUS_KM = 6371.0
EARTH_MU = 398600.4418  # km³/s²

def compute_orbital_period(semi_major_axis: float) -> float:
    """Compute orbital period in seconds using Kepler's 3rd law"""
    return 2 * math.pi * math.sqrt(semi_major_axis**3 / EARTH_MU)

def propagate_position(orbital_elements: OrbitalElements, time_offset_seconds: float) -> dict:
    """
    Propagate satellite position using simplified two-body dynamics.
    Returns ECEF coordinates for Cesium rendering.
    """
    a = orbital_elements.semi_major_axis
    e = orbital_elements.eccentricity
    i = math.radians(orbital_elements.inclination)
    raan = math.radians(orbital_elements.raan)
    omega = math.radians(orbital_elements.arg_periapsis)
    
    # Compute mean motion and propagate mean anomaly
    n = math.sqrt(EARTH_MU / a**3)  # rad/s
    M0 = math.radians(orbital_elements.true_anomaly)  # Simplified: using true as mean
    M = M0 + n * time_offset_seconds
    
    # Solve Kepler's equation (simplified Newton-Raphson)
    E = M
    for _ in range(10):
        E = M + e * math.sin(E)
    
    # True anomaly
    nu = 2 * math.atan2(
        math.sqrt(1 + e) * math.sin(E / 2),
        math.sqrt(1 - e) * math.cos(E / 2)
    )
    
    # Distance from Earth center
    r = a * (1 - e * math.cos(E))
    
    # Position in orbital plane
    x_orb = r * math.cos(nu)
    y_orb = r * math.sin(nu)
    
    # Rotation matrices to ECEF
    cos_raan, sin_raan = math.cos(raan), math.sin(raan)
    cos_i, sin_i = math.cos(i), math.sin(i)
    cos_omega, sin_omega = math.cos(omega), math.sin(omega)
    
    # Transform to ECEF (simplified, ignoring Earth rotation for PoC)
    x = (cos_raan * cos_omega - sin_raan * sin_omega * cos_i) * x_orb + \
        (-cos_raan * sin_omega - sin_raan * cos_omega * cos_i) * y_orb
    y = (sin_raan * cos_omega + cos_raan * sin_omega * cos_i) * x_orb + \
        (-sin_raan * sin_omega + cos_raan * cos_omega * cos_i) * y_orb
    z = (sin_omega * sin_i) * x_orb + (cos_omega * sin_i) * y_orb
    
    # Convert to lat/lon/alt for Cesium
    lon = math.degrees(math.atan2(y, x))
    lat = math.degrees(math.asin(z / r))
    alt = (r - EARTH_RADIUS_KM) * 1000  # Convert to meters
    
    return {
        "longitude": lon,
        "latitude": lat,
        "altitude": alt,
        "velocity": math.sqrt(EARTH_MU * (2/r - 1/a))  # vis-viva equation
    }

# ============================================================================
# Scenario Generation
# ============================================================================

def generate_constellation(
    name: str,
    num_planes: int,
    sats_per_plane: int,
    altitude_km: float,
    inclination: float,
    orbit_type: OrbitType = OrbitType.LEO
) -> List[Satellite]:
    """Generate a Walker constellation pattern"""
    satellites = []
    total_sats = num_planes * sats_per_plane
    
    for plane in range(num_planes):
        raan = (360.0 / num_planes) * plane
        
        for sat in range(sats_per_plane):
            phase_offset = (360.0 / sats_per_plane) * sat
            # Walker phasing
            phase_offset += (360.0 / total_sats) * plane
            
            orbital_elements = OrbitalElements(
                semi_major_axis=EARTH_RADIUS_KM + altitude_km,
                eccentricity=0.001 + random.uniform(0, 0.005),  # Near-circular
                inclination=inclination + random.uniform(-0.5, 0.5),
                raan=raan,
                arg_periapsis=random.uniform(0, 360),
                true_anomaly=phase_offset % 360
            )
            
            sat_id = f"{name}-P{plane+1:02d}-S{sat+1:02d}"
            satellites.append(Satellite(
                id=sat_id,
                name=sat_id,
                orbit_type=orbit_type,
                orbital_elements=orbital_elements,
                launch_date=datetime.now().isoformat(),
                status="operational"
            ))
    
    return satellites

# Pre-generated scenarios for demo
SCENARIOS = {
    "starlink-subset": Scenario(
        id="starlink-subset",
        name="Starlink Subset (550km Shell)",
        description="Simulated subset of Starlink constellation at 550km altitude",
        satellite_count=72,
        duration_hours=24,
        created_at=datetime.now().isoformat()
    ),
    "gps-constellation": Scenario(
        id="gps-constellation", 
        name="GPS Constellation",
        description="24-satellite MEO navigation constellation",
        satellite_count=24,
        duration_hours=48,
        created_at=datetime.now().isoformat()
    ),
    "iridium-next": Scenario(
        id="iridium-next",
        name="Iridium NEXT",
        description="66-satellite polar LEO constellation",
        satellite_count=66,
        duration_hours=24,
        created_at=datetime.now().isoformat()
    ),
    "custom-mega": Scenario(
        id="custom-mega",
        name="Mega Constellation Test",
        description="Large-scale stress test with 500+ satellites",
        satellite_count=540,
        duration_hours=12,
        created_at=datetime.now().isoformat()
    )
}

def get_constellation_for_scenario(scenario_id: str) -> List[Satellite]:
    """Generate satellite constellation based on scenario"""
    if scenario_id == "starlink-subset":
        return generate_constellation("STRLK", 6, 12, 550, 53.0, OrbitType.LEO)
    elif scenario_id == "gps-constellation":
        return generate_constellation("GPS", 6, 4, 20200, 55.0, OrbitType.MEO)
    elif scenario_id == "iridium-next":
        return generate_constellation("IRID", 6, 11, 780, 86.4, OrbitType.LEO)
    elif scenario_id == "custom-mega":
        return generate_constellation("MEGA", 18, 30, 1200, 70.0, OrbitType.LEO)
    return []

# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/")
async def root():
    return {
        "service": "Sedaro Constellation Simulator PoC",
        "version": "0.1.0",
        "endpoints": {
            "scenarios": "/api/scenarios",
            "satellites": "/api/scenarios/{id}/satellites",
            "positions": "/api/scenarios/{id}/positions",
            "stream": "/api/scenarios/{id}/stream",
            "compare": "/api/compare",
            "metrics": "/api/metrics"
        }
    }

@app.get("/api/scenarios")
async def list_scenarios():
    """List all available simulation scenarios"""
    return {"scenarios": [asdict(s) for s in SCENARIOS.values()]}

@app.get("/api/scenarios/{scenario_id}")
async def get_scenario(scenario_id: str):
    """Get scenario details"""
    if scenario_id not in SCENARIOS:
        return {"error": "Scenario not found"}, 404
    return asdict(SCENARIOS[scenario_id])

@app.get("/api/scenarios/{scenario_id}/satellites")
async def get_satellites(scenario_id: str):
    """Get all satellites in a scenario (initial state)"""
    start = time.perf_counter()
    satellites = get_constellation_for_scenario(scenario_id)
    
    result = []
    for sat in satellites:
        sat_dict = asdict(sat)
        sat_dict["orbital_elements"] = asdict(sat.orbital_elements)
        result.append(sat_dict)
    
    elapsed = time.perf_counter() - start
    
    return {
        "scenario_id": scenario_id,
        "count": len(result),
        "satellites": result,
        "_meta": {
            "generation_time_ms": round(elapsed * 1000, 2)
        }
    }

@app.get("/api/scenarios/{scenario_id}/positions")
async def get_positions(
    scenario_id: str,
    time_offset: float = Query(0, description="Time offset in seconds from epoch"),
    chunk_size: Optional[int] = Query(None, description="Number of satellites per chunk for pagination"),
    chunk_index: Optional[int] = Query(0, description="Chunk index for pagination")
):
    """
    Get current positions for all satellites at a given time offset.
    Supports chunked responses for large constellations.
    """
    start = time.perf_counter()
    satellites = get_constellation_for_scenario(scenario_id)
    
    # Apply chunking if requested
    if chunk_size:
        start_idx = chunk_index * chunk_size
        end_idx = start_idx + chunk_size
        satellites = satellites[start_idx:end_idx]
        total_chunks = math.ceil(len(get_constellation_for_scenario(scenario_id)) / chunk_size)
    else:
        total_chunks = 1
    
    positions = []
    for sat in satellites:
        pos = propagate_position(sat.orbital_elements, time_offset)
        positions.append({
            "id": sat.id,
            "name": sat.name,
            "orbit_type": sat.orbit_type.value,
            **pos
        })
    
    elapsed = time.perf_counter() - start
    
    return {
        "scenario_id": scenario_id,
        "time_offset_seconds": time_offset,
        "count": len(positions),
        "positions": positions,
        "_meta": {
            "computation_time_ms": round(elapsed * 1000, 2),
            "chunk_index": chunk_index if chunk_size else 0,
            "total_chunks": total_chunks,
            "chunk_size": chunk_size
        }
    }

async def generate_position_stream(
    scenario_id: str,
    duration_seconds: int,
    time_step: float
) -> Generator[str, None, None]:
    """Generator for streaming position data"""
    satellites = get_constellation_for_scenario(scenario_id)
    
    for t in range(0, duration_seconds, int(time_step)):
        frame_data = {
            "timestamp": t,
            "positions": []
        }
        
        for sat in satellites:
            pos = propagate_position(sat.orbital_elements, float(t))
            frame_data["positions"].append({
                "id": sat.id,
                **pos
            })
        
        yield f"data: {json.dumps(frame_data)}\n\n"
        await asyncio.sleep(0.01)  # Prevent blocking

@app.get("/api/scenarios/{scenario_id}/stream")
async def stream_positions(
    scenario_id: str,
    duration: int = Query(3600, description="Duration in seconds"),
    step: float = Query(60, description="Time step in seconds")
):
    """
    Stream position data using Server-Sent Events.
    Efficient for real-time visualization of orbital propagation.
    """
    return StreamingResponse(
        generate_position_stream(scenario_id, duration, step),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )

@app.get("/api/compare")
async def compare_scenarios(
    scenario_ids: str = Query(..., description="Comma-separated scenario IDs"),
    time_offset: float = Query(0, description="Time offset in seconds"),
    metric: str = Query("coverage", description="Comparison metric: coverage, velocity, altitude")
):
    """
    Compare multiple scenarios side-by-side.
    Useful for what-if analysis across constellation designs.
    """
    start = time.perf_counter()
    ids = scenario_ids.split(",")
    
    comparison = {}
    for scenario_id in ids:
        scenario_id = scenario_id.strip()
        if scenario_id not in SCENARIOS:
            continue
            
        satellites = get_constellation_for_scenario(scenario_id)
        positions = [propagate_position(s.orbital_elements, time_offset) for s in satellites]
        
        if metric == "altitude":
            values = [p["altitude"] / 1000 for p in positions]  # km
            comparison[scenario_id] = {
                "min": min(values),
                "max": max(values),
                "mean": sum(values) / len(values),
                "unit": "km"
            }
        elif metric == "velocity":
            values = [p["velocity"] for p in positions]
            comparison[scenario_id] = {
                "min": min(values),
                "max": max(values),
                "mean": sum(values) / len(values),
                "unit": "km/s"
            }
        else:  # coverage (simplified - latitude spread)
            lats = [p["latitude"] for p in positions]
            comparison[scenario_id] = {
                "lat_coverage": max(lats) - min(lats),
                "satellite_count": len(satellites),
                "unit": "degrees"
            }
    
    elapsed = time.perf_counter() - start
    
    return {
        "metric": metric,
        "time_offset_seconds": time_offset,
        "comparison": comparison,
        "_meta": {
            "computation_time_ms": round(elapsed * 1000, 2)
        }
    }

@app.get("/api/metrics")
async def get_performance_metrics():
    """
    Return API performance metrics.
    Useful for performance monitoring and optimization decisions.
    """
    # In production, this would pull from actual metrics collection
    return {
        "endpoints": {
            "/api/scenarios/{id}/positions": {
                "avg_response_time_ms": 12.5,
                "p95_response_time_ms": 45.2,
                "requests_per_minute": 150
            },
            "/api/scenarios/{id}/stream": {
                "active_connections": 3,
                "avg_throughput_events_per_sec": 60
            }
        },
        "system": {
            "memory_usage_mb": 128,
            "cpu_percent": 15.2
        }
    }

# WebSocket endpoint for real-time updates
@app.websocket("/ws/positions/{scenario_id}")
async def websocket_positions(websocket: WebSocket, scenario_id: str):
    """
    WebSocket endpoint for real-time position streaming.
    More efficient than SSE for bidirectional communication.
    """
    await websocket.accept()
    
    satellites = get_constellation_for_scenario(scenario_id)
    time_offset = 0.0
    
    try:
        while True:
            # Check for client messages (playback control)
            try:
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=0.1
                )
                if "time_offset" in data:
                    time_offset = data["time_offset"]
                if "command" in data:
                    if data["command"] == "pause":
                        continue
            except asyncio.TimeoutError:
                pass
            
            # Send position update
            positions = []
            for sat in satellites:
                pos = propagate_position(sat.orbital_elements, time_offset)
                positions.append({"id": sat.id, **pos})
            
            await websocket.send_json({
                "timestamp": time_offset,
                "positions": positions
            })
            
            time_offset += 60  # Advance 60 seconds per frame
            await asyncio.sleep(0.1)  # 10 FPS
            
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
