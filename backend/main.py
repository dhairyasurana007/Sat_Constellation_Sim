"""
Satellite Constellation Simulator Backend
==========================================
Features:
- Real satellite data from CelesTrak
- TLE parsing and orbital propagation using SGP4
- High-performance async API design
- Efficient data streaming for massive datasets
- Scenario comparison capabilities
"""

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import json
import math
import asyncio
import httpx
from datetime import datetime, timezone
from typing import Optional, List
from dataclasses import dataclass, asdict
from enum import Enum
import time

# SGP4 for accurate orbital propagation
from sgp4.api import Satrec, jday
from sgp4 import exporter

app = FastAPI(
    title="Satellite Constellation Simulator",
    description="Real-time satellite tracking with CelesTrak data",
    version="1.0.0"
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
class Satellite:
    id: str
    name: str
    orbit_type: OrbitType
    tle_line1: str
    tle_line2: str
    
@dataclass 
class Scenario:
    id: str
    name: str
    description: str
    satellite_count: int
    tle_url: str
    created_at: str

# ============================================================================
# CelesTrak TLE Sources
# ============================================================================

CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php"

SCENARIOS = {
    "starlink": Scenario(
        id="starlink",
        name="Starlink Constellation",
        description="SpaceX Starlink broadband satellites",
        satellite_count=0,  # Updated on fetch
        tle_url=f"{CELESTRAK_BASE}?GROUP=starlink&FORMAT=tle",
        created_at=datetime.now(timezone.utc).isoformat()
    ),
    "gps": Scenario(
        id="gps",
        name="GPS Constellation",
        description="US Global Positioning System satellites",
        satellite_count=0,
        tle_url=f"{CELESTRAK_BASE}?GROUP=gps-ops&FORMAT=tle",
        created_at=datetime.now(timezone.utc).isoformat()
    ),
    "iridium": Scenario(
        id="iridium",
        name="Iridium NEXT",
        description="Iridium satellite phone constellation",
        satellite_count=0,
        tle_url=f"{CELESTRAK_BASE}?GROUP=iridium-NEXT&FORMAT=tle",
        created_at=datetime.now(timezone.utc).isoformat()
    ),
    "space-stations": Scenario(
        id="space-stations",
        name="Space Stations",
        description="ISS and other crewed stations",
        satellite_count=0,
        tle_url=f"{CELESTRAK_BASE}?GROUP=stations&FORMAT=tle",
        created_at=datetime.now(timezone.utc).isoformat()
    ),
    "oneweb": Scenario(
        id="oneweb",
        name="OneWeb Constellation",
        description="OneWeb broadband satellites",
        satellite_count=0,
        tle_url=f"{CELESTRAK_BASE}?GROUP=oneweb&FORMAT=tle",
        created_at=datetime.now(timezone.utc).isoformat()
    ),
    "active": Scenario(
        id="active",
        name="All Active Satellites",
        description="All currently active satellites (large dataset)",
        satellite_count=0,
        tle_url=f"{CELESTRAK_BASE}?GROUP=active&FORMAT=tle",
        created_at=datetime.now(timezone.utc).isoformat()
    ),
}

# ============================================================================
# TLE Cache
# ============================================================================

class TLECache:
    """Simple in-memory cache for TLE data"""
    def __init__(self, ttl_seconds: int = 3600):  # 1 hour default
        self.cache: dict[str, tuple[List[Satellite], float]] = {}
        self.ttl = ttl_seconds
    
    def get(self, scenario_id: str) -> Optional[List[Satellite]]:
        if scenario_id in self.cache:
            satellites, timestamp = self.cache[scenario_id]
            if time.time() - timestamp < self.ttl:
                return satellites
        return None
    
    def set(self, scenario_id: str, satellites: List[Satellite]):
        self.cache[scenario_id] = (satellites, time.time())

tle_cache = TLECache()

# ============================================================================
# TLE Parsing & Orbital Propagation
# ============================================================================

def classify_orbit(mean_motion: float, eccentricity: float) -> OrbitType:
    """Classify orbit type based on orbital elements"""
    # Mean motion is in revolutions per day
    # Convert to approximate altitude
    # n = sqrt(mu/a^3), solving for a, then altitude = a - Earth_radius
    
    period_minutes = 1440 / mean_motion  # minutes per orbit
    
    if period_minutes < 128:  # Less than ~2000km
        return OrbitType.LEO
    elif period_minutes < 720:  # Less than ~35786km  
        return OrbitType.MEO
    elif 1430 < period_minutes < 1450 and eccentricity < 0.01:  # ~24 hour, circular
        return OrbitType.GEO
    else:
        return OrbitType.HEO

def parse_tle(tle_text: str) -> List[Satellite]:
    """Parse TLE format text into Satellite objects"""
    lines = tle_text.strip().split('\n')
    satellites = []
    
    i = 0
    while i < len(lines) - 2:
        name = lines[i].strip()
        line1 = lines[i + 1].strip()
        line2 = lines[i + 2].strip()
        
        # Validate TLE lines
        if not line1.startswith('1 ') or not line2.startswith('2 '):
            i += 1
            continue
        
        try:
            # Extract NORAD catalog number as ID
            norad_id = line1[2:7].strip()
            
            # Extract mean motion and eccentricity for orbit classification
            mean_motion = float(line2[52:63])
            eccentricity = float(f"0.{line2[26:33]}")
            
            orbit_type = classify_orbit(mean_motion, eccentricity)
            
            satellites.append(Satellite(
                id=norad_id,
                name=name,
                orbit_type=orbit_type,
                tle_line1=line1,
                tle_line2=line2
            ))
        except (ValueError, IndexError) as e:
            print(f"Error parsing TLE for {name}: {e}")
        
        i += 3
    
    return satellites

async def fetch_tle_data(scenario_id: str) -> List[Satellite]:
    """Fetch TLE data from CelesTrak"""
    # Check cache first
    cached = tle_cache.get(scenario_id)
    if cached:
        return cached
    
    if scenario_id not in SCENARIOS:
        return []
    
    scenario = SCENARIOS[scenario_id]
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(scenario.tle_url, timeout=30.0)
            response.raise_for_status()
            satellites = parse_tle(response.text)
            
            # Update scenario count
            SCENARIOS[scenario_id] = Scenario(
                id=scenario.id,
                name=scenario.name,
                description=scenario.description,
                satellite_count=len(satellites),
                tle_url=scenario.tle_url,
                created_at=scenario.created_at
            )
            
            # Cache the results
            tle_cache.set(scenario_id, satellites)
            
            return satellites
        except Exception as e:
            print(f"Error fetching TLE data: {e}")
            return []

def propagate_satellite(satellite: Satellite, dt: datetime) -> dict:
    """
    Propagate satellite position using SGP4.
    Returns lat/lon/alt for Cesium rendering.
    """
    try:
        # Create satellite record from TLE
        sat = Satrec.twoline2rv(satellite.tle_line1, satellite.tle_line2)
        
        # Get Julian date
        jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond/1e6)
        
        # Propagate
        error, position, velocity = sat.sgp4(jd, fr)
        
        if error != 0:
            return None
        
        # position is in km in TEME frame
        x, y, z = position
        vx, vy, vz = velocity
        
        # Convert TEME to geodetic (simplified - ignoring Earth rotation for demo)
        # For accuracy, should use proper TEME to ITRF conversion
        r = math.sqrt(x*x + y*y + z*z)
        
        # Approximate conversion to lat/lon/alt
        lon = math.degrees(math.atan2(y, x))
        lat = math.degrees(math.asin(z / r))
        alt = (r - 6371.0) * 1000  # Convert to meters above Earth surface
        
        # Calculate velocity magnitude
        vel = math.sqrt(vx*vx + vy*vy + vz*vz)
        
        return {
            "id": satellite.id,
            "name": satellite.name,
            "orbit_type": satellite.orbit_type.value,
            "longitude": lon,
            "latitude": lat,
            "altitude": alt,
            "velocity": vel
        }
    except Exception as e:
        print(f"Error propagating {satellite.name}: {e}")
        return None

# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/")
async def root():
    return {
        "service": "Satellite Constellation Simulator",
        "version": "1.0.0",
        "data_source": "CelesTrak",
        "endpoints": {
            "scenarios": "/api/scenarios",
            "satellites": "/api/scenarios/{id}/satellites",
            "positions": "/api/scenarios/{id}/positions",
            "compare": "/api/compare"
        }
    }

@app.get("/api/scenarios")
async def list_scenarios():
    """List all available scenarios"""
    return {"scenarios": [asdict(s) for s in SCENARIOS.values()]}

@app.get("/api/scenarios/{scenario_id}")
async def get_scenario(scenario_id: str):
    """Get scenario details"""
    if scenario_id not in SCENARIOS:
        return {"error": "Scenario not found"}, 404
    
    # Fetch to update satellite count
    satellites = await fetch_tle_data(scenario_id)
    
    return asdict(SCENARIOS[scenario_id])

@app.get("/api/scenarios/{scenario_id}/satellites")
async def get_satellites(scenario_id: str):
    """Get all satellites in a scenario"""
    start = time.perf_counter()
    
    satellites = await fetch_tle_data(scenario_id)
    
    result = []
    for sat in satellites:
        result.append({
            "id": sat.id,
            "name": sat.name,
            "orbit_type": sat.orbit_type.value
        })
    
    elapsed = time.perf_counter() - start
    
    return {
        "scenario_id": scenario_id,
        "count": len(result),
        "satellites": result,
        "_meta": {
            "fetch_time_ms": round(elapsed * 1000, 2),
            "data_source": "CelesTrak"
        }
    }

@app.get("/api/scenarios/{scenario_id}/positions")
async def get_positions(
    scenario_id: str,
    time_offset: float = Query(0, description="Time offset in seconds from now"),
    limit: Optional[int] = Query(None, description="Limit number of satellites returned")
):
    """
    Get current positions for all satellites.
    Uses SGP4 propagation for accurate positioning.
    """
    start = time.perf_counter()
    
    satellites = await fetch_tle_data(scenario_id)
    
    if limit:
        satellites = satellites[:limit]
    
    # Calculate target time
    target_time = datetime.now(timezone.utc)
    if time_offset:
        from datetime import timedelta
        target_time = target_time + timedelta(seconds=time_offset)
    
    positions = []
    for sat in satellites:
        pos = propagate_satellite(sat, target_time)
        if pos:
            positions.append(pos)
    
    elapsed = time.perf_counter() - start
    
    return {
        "scenario_id": scenario_id,
        "timestamp": target_time.isoformat(),
        "time_offset_seconds": time_offset,
        "count": len(positions),
        "positions": positions,
        "_meta": {
            "computation_time_ms": round(elapsed * 1000, 2),
            "data_source": "CelesTrak",
            "propagator": "SGP4"
        }
    }

@app.get("/api/compare")
async def compare_scenarios(
    scenario_ids: str = Query(..., description="Comma-separated scenario IDs"),
    metric: str = Query("count", description="Comparison metric: count, altitude")
):
    """Compare multiple scenarios"""
    start = time.perf_counter()
    ids = [s.strip() for s in scenario_ids.split(",")]
    
    comparison = {}
    target_time = datetime.now(timezone.utc)
    
    for scenario_id in ids:
        if scenario_id not in SCENARIOS:
            continue
        
        satellites = await fetch_tle_data(scenario_id)
        
        if metric == "altitude":
            altitudes = []
            for sat in satellites[:100]:  # Limit for performance
                pos = propagate_satellite(sat, target_time)
                if pos:
                    altitudes.append(pos["altitude"] / 1000)  # km
            
            if altitudes:
                comparison[scenario_id] = {
                    "min": min(altitudes),
                    "max": max(altitudes),
                    "mean": sum(altitudes) / len(altitudes),
                    "unit": "km"
                }
        else:  # count
            comparison[scenario_id] = {
                "satellite_count": len(satellites),
                "name": SCENARIOS[scenario_id].name
            }
    
    elapsed = time.perf_counter() - start
    
    return {
        "metric": metric,
        "comparison": comparison,
        "_meta": {
            "computation_time_ms": round(elapsed * 1000, 2)
        }
    }

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

# WebSocket for real-time updates
@app.websocket("/ws/positions/{scenario_id}")
async def websocket_positions(websocket: WebSocket, scenario_id: str):
    """WebSocket endpoint for real-time position streaming"""
    await websocket.accept()
    
    satellites = await fetch_tle_data(scenario_id)
    
    try:
        while True:
            target_time = datetime.now(timezone.utc)
            
            positions = []
            for sat in satellites:
                pos = propagate_satellite(sat, target_time)
                if pos:
                    positions.append(pos)
            
            await websocket.send_json({
                "timestamp": target_time.isoformat(),
                "count": len(positions),
                "positions": positions
            })
            
            await asyncio.sleep(1)  # Update every second
            
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)