from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ─────────────────────────── shared primitives ───────────────────────────
class Crowd(BaseModel):
    score: float = 0.5
    level: str = "moderate"


class PlaceCtx(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    type: str = "place"
    city: Optional[str] = None
    popularity: float = 0.5
    baseCrowd: float = 0.4
    peakHours: List[int] = []
    bestTime: Optional[str] = None
    visitMin: int = 75              # how long the user typically spends
    crowd: Crowd = Crowd()
    isAnchor: bool = False          # user-marked must-visit


class Accommodation(BaseModel):
    id: Optional[str] = None
    name: str = ""
    city: Optional[str] = None
    lat: float
    lng: float


class WeatherDay(BaseModel):
    date: Optional[str] = None
    temp: Optional[float] = None
    condition: Optional[str] = None
    description: Optional[str] = None
    rainProb: float = 0.0


class EventCtx(BaseModel):
    id: str
    name: str
    city: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    venue: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    durationMin: int = 120


# ─────────────────────────── multi-city trip ───────────────────────────
class CityLeg(BaseModel):
    """One stretch of the trip in a single city."""
    cityId: str
    cityName: Optional[str] = None
    days: int = Field(ge=1, le=14)
    startDate: Optional[str] = None
    accommodation: Optional[Accommodation] = None
    places: List[PlaceCtx]                 # must-visit + nearby picks
    events: List[EventCtx] = []
    weather: List[WeatherDay] = []
    trafficFactor: float = 1.2             # live-traffic multiplier (≥1)


class GenerateRequest(BaseModel):
    """Multi-city trip request."""
    legs: List[CityLeg]
    objectives: List[str] = ["time", "crowd", "distance"]   # NSGA-II axes
    paretoSize: int = 8


# ───────────────────────────── itinerary shape ─────────────────────────────
class Stop(BaseModel):
    placeId: str
    order: int = 0
    arrival: Optional[str] = None
    departure: Optional[str] = None
    travelMinFromPrev: float = 0
    distanceKmFromPrev: float = 0
    routePath: List[List[float]] = []   # list of [lat, lng] hops from A* / Dijkstra
    eventId: Optional[str] = None       # if this stop is actually a live event
    note: Optional[str] = None


class Day(BaseModel):
    day: int
    date: Optional[str] = None
    cityId: Optional[str] = None
    stops: List[Stop]


class PlanScores(BaseModel):
    travelMin: float = 0
    distanceKm: float = 0
    crowdCost: float = 0
    weatherCost: float = 0
    enjoyment: float = 0
    feasible: bool = True


class Plan(BaseModel):
    label: str = "Plan"
    description: str = ""
    days: List[Day]
    scores: PlanScores = PlanScores()
    paretoRank: int = 0


# ───────────────────────────── validate / reroute ─────────────────────────────
class ValidateRequest(BaseModel):
    legs: List[CityLeg]
    plan: List[Day]


class ReallocateRequest(ValidateRequest):
    dayIndex: int = 0
    completedStopIds: List[str] = []     # already visited today
    currentLocation: Optional[Accommodation] = None  # where user is right now
    reason: Optional[str] = None         # "traffic" / "weather" / "emergency"


# ───────────────────────────── routing-only ─────────────────────────────
class RouteNode(BaseModel):
    id: str
    lat: float
    lng: float


class RouteRequest(BaseModel):
    """Standalone routing call: A* / Dijkstra between two stops on a sparse graph."""
    nodes: List[RouteNode]
    edges: List[List[Any]] = []      # [fromId, toId, weight] ; if empty we build kNN graph
    fromId: str
    toId: str
    algorithm: str = "astar"         # "astar" | "dijkstra"
    trafficFactor: float = 1.0


# ───────────────────────────── CARA ─────────────────────────────
class CARARequest(BaseModel):
    userId: Optional[str] = None
    candidates: List[PlaceCtx]
    context: dict = {}
