# ML service (v2)

FastAPI microservice powering the itinerary engine.

## Endpoints

- `POST /itinerary/generate` — run NSGA-II per leg, return `{plans:[A,B], pareto:[...]}`.
- `POST /itinerary/validate` — feasibility check (travel overflow, crowd streak,
  peak overlap, weather mismatch, long hops).
- `POST /itinerary/reallocate` — dynamic shortest-path re-route from current
  location, swapping any remaining stop that fails live conditions.
- `POST /route` — standalone A*/Dijkstra between two nodes on a k-NN graph.
- `POST /cara/recommend` — context-aware ranking stub.

## Algorithm pipeline (per city-leg)

1. Build the candidate pool: anchor must-visits + accepted nearby suggestions.
2. **NSGA-II** over 5 objectives — travel time, distance, crowd cost,
   weather cost, and −enjoyment. Anchors are locked in the chromosome prefix
   so they always appear in the route.
3. **Pareto picking** — Plan A = balanced extreme, Plan B = crowd-averse
   extreme. If the front collapses, Plan B is seeded by a **GA** starting from
   the least-crowded place.
4. Refine each permutation with **2-opt** then **Simulated Annealing**;
   Plan B's cost function adds a crowd penalty so SA reorders it differently.
5. Split the ordered list across days (balanced count + per-day time budget).
6. Materialise each day: every consecutive hop is routed with **A\*** on a
   k-NN graph (Dijkstra fallback) so each stop carries a real `routePath`.
7. Live events on matching dates are slotted in as `eventId` stops.

## Dynamic re-allocation (DSPP)

`/itinerary/reallocate` accepts:
- `dayIndex` — which day to re-plan,
- `completedStopIds` — stops already visited today,
- `currentLocation` — where the user actually is,
- `reason` — `"weather" | "traffic" | "emergency"`.

It scans every remaining stop, swaps any that fail the current weather/crowd
test (or the user's emergency flag) with the best unused alternative ranked by
`enjoyment` then proximity to the current location, then re-runs A* from the
current location through the rewritten sequence.
