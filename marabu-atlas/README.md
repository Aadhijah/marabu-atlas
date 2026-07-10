# Marabu Atlas — MERN + Python ML (v2)

A multi-city, multi-day trip planner with a real optimisation engine.
MongoDB Atlas (browser version) for storage, Express for the API,
FastAPI + NSGA-II / A* / Dijkstra / 2-opt / GA / SA / Pareto for the planner.

## Architecture

```
marabu-atlas/
├── frontend/    React + Vite + Tailwind  (port 5173)
├── backend/     Node + Express + Mongoose (port 4000)
└── ml-service/  Python FastAPI            (port 8000)
```

## Wizard flow

1. **Trip basics** — dates, home city, state, travellers.
2. **Cities to visit** in that state (multi-select, days per city).
3. **Accommodation** for each city.
4. **Must-visit spots** per city (anchors are locked in by NSGA-II).
5. **Nearby suggestions** — auto-fetched activities + restaurants near each
   anchor; opt-in.
6. **Live events** falling on the trip dates.
7. **Generate Plan A & Plan B** — pick the one you like, edit, validate,
   re-route on the day of the trip.

## Algorithms wired in

| Algorithm | Where it runs |
|---|---|
| **NSGA-II** | Multi-objective search over (travel-time, distance, crowd, weather, −enjoyment). Anchors are locked in the chromosome prefix. Returns the full first Pareto front. |
| **Pareto optimisation** | Plan A picks the balanced extreme; Plan B picks the crowd-averse extreme of the same front. |
| **A\* search** | Every consecutive stop pair is routed on a k-NN proximity graph using A* with a haversine travel-time heuristic. |
| **Dijkstra** | Same graph, used as the fallback when A* can't reach the target — also exposed via `POST /api/itinerary/route`. |
| **2-opt** | Local refinement on the chosen permutation. |
| **Genetic Algorithm** | Used as a divergence seed for Plan B when the Pareto front collapses. |
| **Simulated Annealing** | Final refinement to escape 2-opt local optima. |
| **Dynamic Shortest Path** | `/reallocate` re-runs A* from the user's *current* location after a stop is completed or an emergency is flagged, swapping any remaining stop that fails the live weather/crowd/traffic check. |

## Quick start

### 1. MongoDB Atlas
Create a free M0 cluster at https://cloud.mongodb.com, create a DB user,
allow `0.0.0.0/0` for dev, copy the connection string.

### 2. Backend
```bash
cd backend
cp .env.example .env       # paste MONGODB_URI + optional API keys
npm install
npm run seed               # 4 cities, 40 places, stays, dining, events
npm run dev                # http://localhost:4000
```

### 3. ML service
```bash
cd ml-service
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4. Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev                # http://localhost:5173
```

## API keys (all optional — fall back to seeded data)

| Key | Used for |
|---|---|
| `MONGODB_URI` | Database (required) |
| `OPENWEATHER_API_KEY` | Per-day weather forecast |
| `GOOGLE_MAPS_API_KEY` | Live crowd signal |
| `TICKETMASTER_API_KEY` | Live events overlay |

## Key API endpoints

```
GET  /api/cities?state=Tamil%20Nadu
GET  /api/cities/states/list
GET  /api/places?city=madurai
GET  /api/places/:id/nearby?radiusKm=8        # activities + restaurants nearby
GET  /api/stays?city=madurai
GET  /api/events?city=madurai                  # seeded + live (Ticketmaster)
GET  /api/weather/:cityId/forecast

POST /api/trips                                # multi-leg body
POST /api/itinerary/:tripId/generate           # → {plans:[A,B], pareto:[...]}
POST /api/itinerary/:tripId/validate           # feasibility issues
POST /api/itinerary/:tripId/reallocate         # dynamic re-route (DSPP + A*)
POST /api/itinerary/:tripId/active             # switch active plan
POST /api/itinerary/:tripId/stop/:d/:s/complete  # mark stop done

POST /api/itinerary/route                      # standalone A*/Dijkstra
```

ML service mirrors the same shapes — see `ml-service/README.md`.

## Trip data model (multi-city)

```json
{
  "name": "Tamil Nadu loop",
  "state": "Tamil Nadu",
  "startDate": "2025-12-20",
  "legs": [
    { "cityId": "madurai", "days": 2, "startDate": "2025-12-20",
      "stayId": "stay-x", "anchorPlaceIds": ["meenakshi"],
      "extraPlaceIds": ["thirumalai"], "eventIds": ["ev1"], "trafficFactor": 1.3 },
    { "cityId": "ooty", "days": 2, "startDate": "2025-12-22",
      "stayId": "stay-y", "anchorPlaceIds": ["botanical-gardens"],
      "extraPlaceIds": [], "eventIds": [], "trafficFactor": 1.4 }
  ],
  "plans": [ { "label": "Plan A — NSGA-II balanced", "days": [...], "scores": {...} },
             { "label": "Plan B — crowd-averse",     "days": [...], "scores": {...} } ],
  "activePlanIndex": 0,
  "pareto": [ { "cityId": "madurai", "frontSize": 5, "frontPoints": [...] } ]
}
```
