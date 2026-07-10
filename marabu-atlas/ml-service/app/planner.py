"""Trip planner orchestration.

Pipeline per city-leg:
1. Build candidate place pool (anchors + nearby suggestions).
2. Run NSGA-II over [travelTime, distance, crowdCost, weatherCost, -enjoyment].
3. Pick two diverse points on the Pareto front  → Plan A (balanced) & Plan B
   (least-crowded extreme). Refine each with 2-opt and Simulated Annealing.
4. Split the ordered list across days, fitting events into matching dates.
5. Compute every consecutive segment with A-star (Dijkstra fallback) on a
   k-NN proximity graph so each stop carries a real `routePath`.

Public functions:
    generate_plans(req)        → {plans: [planA, planB], pareto: [...]}
    validate_itinerary(req)    → {ok, issues}
    reallocate_day(req)        → dynamic on-trip reroute
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

from .schemas import (
    GenerateRequest, ValidateRequest, ReallocateRequest,
    CityLeg, PlaceCtx, WeatherDay, EventCtx, Accommodation,
    Plan, PlanScores, Day, Stop,
)
from .algorithms import (
    haversine_km, travel_min, two_opt, simulated_annealing,
    a_star, dijkstra, build_knn_graph,
)
from .nsga import nsga2

OUTDOOR_TYPES = {"beach", "hill", "waterfall", "lake", "park", "viewpoint"}
AVG_SPEED_KMH = 30.0
DAY_START_HOUR = 9
DAY_END_HOUR = 19


# ────────────────────────── per-place scoring ──────────────────────────
def _crowd_cost(p: PlaceCtx, arrival_hour: int) -> float:
    overlap = 0.4 if arrival_hour in (p.peakHours or []) else 0.0
    return 0.5 * p.crowd.score + overlap


def _weather_cost(p: PlaceCtx, w: WeatherDay | None) -> float:
    if not w or p.type not in OUTDOOR_TYPES:
        return 0
    if w.rainProb > 0.6:
        return 0.6
    if w.rainProb > 0.3:
        return 0.25
    return 0


def _enjoyment(p: PlaceCtx, arrival_hour: int, w: WeatherDay | None) -> float:
    return p.popularity - _crowd_cost(p, arrival_hour) - _weather_cost(p, w)


# ─────────────────── leg evaluation for NSGA-II ───────────────────
def _leg_evaluator(leg: CityLeg):
    """Closes over leg context. evaluate(perm) → (travelMin, distKm, crowd, weather, -enjoy)."""
    start: Tuple[float, float] = (
        (leg.accommodation.lat, leg.accommodation.lng) if leg.accommodation
        else (sum(p.lat for p in leg.places) / max(1, len(leg.places)),
              sum(p.lng for p in leg.places) / max(1, len(leg.places)))
    )
    weather0 = leg.weather[0] if leg.weather else None
    traffic = max(1.0, leg.trafficFactor)
    coords = [(p.lat, p.lng) for p in leg.places]

    # cap the route at what's feasible across `days`
    minutes_per_day = (DAY_END_HOUR - DAY_START_HOUR) * 60
    budget = minutes_per_day * leg.days

    def evaluate(perm):
        if not perm:
            return (0.0, 0.0, 0.0, 0.0, 0.0)
        t_total = 0.0
        d_total = 0.0
        crowd_total = 0.0
        weather_total = 0.0
        enjoy_total = 0.0
        here = start
        cur_min = DAY_START_HOUR * 60
        kept = 0
        for idx in perm:
            p = leg.places[idx]
            seg = travel_min(here, coords[idx], AVG_SPEED_KMH, traffic)
            arr_min = cur_min + seg
            arr_hour = int(arr_min // 60)
            t_total += seg
            d_total += haversine_km(here, coords[idx])
            crowd_total += _crowd_cost(p, arr_hour)
            weather_total += _weather_cost(p, weather0)
            enjoy_total += _enjoyment(p, arr_hour, weather0)
            here = coords[idx]
            cur_min = arr_min + p.visitMin
            kept += 1
            if t_total + (kept * 60) > budget:   # prune long perms
                break
        # We minimise; enjoyment is good so we negate it.
        return (t_total, d_total, crowd_total, weather_total, -enjoy_total)

    return evaluate, start, traffic


# ─────────────────── pick two diverse Pareto points ───────────────────
def _pick_two(front, weights_a=(1, 1, 1, 0.5, 1), weights_b=(0.5, 0.5, 2, 1, 0.7)):
    """Plan A: balanced. Plan B: heavily crowd-averse."""
    def score(ind, w):
        return sum(o * wi for o, wi in zip(ind.obj, w))
    if not front:
        return None, None
    a = min(front, key=lambda i: score(i, weights_a))
    b = min(front, key=lambda i: score(i, weights_b))
    if b is a and len(front) > 1:
        rest = [x for x in front if x is not a]
        b = min(rest, key=lambda i: score(i, weights_b))
    return a, b


# ─────────────────── refine with 2-opt + SA ───────────────────
def _refine(perm, leg: CityLeg, start, traffic, crowd_weight: float = 0.0):
    """`crowd_weight` lets Plan B penalise crowded-place edges so SA reorders to
    visit calm places first / avoid clusters of high-crowd stops."""
    coords = {i: (leg.places[i].lat, leg.places[i].lng) for i in range(len(leg.places))}

    def cost(i, j):
        base = (
            travel_min(start, coords[j], AVG_SPEED_KMH, traffic) if i < 0
            else travel_min(coords[i], coords[j], AVG_SPEED_KMH, traffic)
        )
        if crowd_weight > 0 and j >= 0:
            # Penalise edges *into* high-crowd places by extra "minutes".
            base += crowd_weight * 60 * leg.places[j].crowd.score
        return base

    seq = [-1] + list(perm)            # -1 sentinel for accommodation
    seq = two_opt(seq, cost)
    seq = simulated_annealing(seq, cost, fixed_start=True, iterations=1500)
    return [s for s in seq if s != -1]


# ─────────────────── day splitting + materialisation ───────────────────
def _split_days(perm, leg: CityLeg, start, traffic):
    """Day-fill respecting per-day time budget AND a balanced count target.

    We aim for `ceil(N / days)` stops per day so a 2-day trip with 6 places
    becomes 3+3, not 5+1, while still rolling over if the time budget blows."""
    minutes_per_day = (DAY_END_HOUR - DAY_START_HOUR) * 60
    days: List[List[int]] = [[] for _ in range(leg.days)]
    coords = [(p.lat, p.lng) for p in leg.places]
    target_per_day = max(1, math.ceil(len(perm) / max(1, leg.days)))
    di = 0
    here = start
    cur = 0
    for idx in perm:
        if di >= leg.days:
            break
        seg = travel_min(here, coords[idx], AVG_SPEED_KMH, traffic)
        new_cur = cur + seg + leg.places[idx].visitMin
        roll = (
            (new_cur > minutes_per_day and days[di])
            or (len(days[di]) >= target_per_day and di < leg.days - 1)
        )
        if roll:
            di += 1
            if di >= leg.days:
                break
            here = start
            cur = 0
            seg = travel_min(here, coords[idx], AVG_SPEED_KMH, traffic)
            new_cur = cur + seg + leg.places[idx].visitMin
        days[di].append(idx)
        here = coords[idx]
        cur = new_cur
    return days


def _materialise_day(
    day_idx: int,
    leg: CityLeg,
    start: Tuple[float, float],
    visits: List[int],
    date: str | None,
    traffic: float,
    coord_graph: Dict[str, list],
) -> Day:
    stops: List[Stop] = []
    here = start
    here_id = "__stay__"
    cur = datetime(2000, 1, 1, DAY_START_HOUR, 0)
    coords_lookup = {p.id: (p.lat, p.lng) for p in leg.places}
    coords_lookup[here_id] = start

    for order, idx in enumerate(visits):
        p = leg.places[idx]
        # A* through the k-NN graph; falls back to direct edge if disconnected.
        path_ids, _ = a_star(
            coord_graph, coords_lookup, here_id, p.id,
            avg_speed_kmh=AVG_SPEED_KMH, traffic=traffic,
        )
        if not path_ids:
            path_ids, _ = dijkstra(coord_graph, here_id, p.id)
        if not path_ids:
            path_ids = [here_id, p.id]
        route_path = [list(coords_lookup[i]) for i in path_ids]

        seg_min = travel_min(here, (p.lat, p.lng), AVG_SPEED_KMH, traffic)
        seg_km = haversine_km(here, (p.lat, p.lng))
        cur = cur + timedelta(minutes=seg_min)
        arrival = cur.strftime("%H:%M")
        cur = cur + timedelta(minutes=p.visitMin)
        departure = cur.strftime("%H:%M")
        stops.append(Stop(
            placeId=p.id, order=order,
            arrival=arrival, departure=departure,
            travelMinFromPrev=round(seg_min, 1),
            distanceKmFromPrev=round(seg_km, 2),
            routePath=route_path,
        ))
        here = (p.lat, p.lng)
        here_id = p.id

    # Slot in matching live events for the date.
    if date:
        for e in leg.events:
            if e.date != date:
                continue
            note = f"Live event: {e.name}" + (f" @ {e.venue}" if e.venue else "")
            stops.append(Stop(
                placeId=f"event:{e.id}", order=len(stops),
                arrival=e.time or "20:00",
                departure=None,
                travelMinFromPrev=0, distanceKmFromPrev=0,
                eventId=e.id, note=note,
            ))

    return Day(day=day_idx + 1, date=date, cityId=leg.cityId, stops=stops)


def _date_for(day_idx: int, leg: CityLeg) -> str | None:
    if not leg.startDate:
        return None
    try:
        return (datetime.strptime(leg.startDate, "%Y-%m-%d")
                + timedelta(days=day_idx)).strftime("%Y-%m-%d")
    except Exception:
        return None


def _build_plan_for_perm(perm, leg, start, traffic, label, description, crowd_weight: float = 0.0) -> Plan:
    perm = _refine(perm, leg, start, traffic, crowd_weight=crowd_weight)
    daily_idx = _split_days(perm, leg, start, traffic)

    # Build a k-NN graph over (accommodation + all leg places) for A*.
    coords = {p.id: (p.lat, p.lng) for p in leg.places}
    coords["__stay__"] = start
    graph = build_knn_graph(coords, k=4, traffic=traffic)

    days: List[Day] = []
    travel = dist = crowd = weather = enjoy = 0.0
    for di, visits in enumerate(daily_idx):
        d = _materialise_day(di, leg, start, visits, _date_for(di, leg), traffic, graph)
        days.append(d)
        for s in d.stops:
            travel += s.travelMinFromPrev
            dist += s.distanceKmFromPrev
        for idx in visits:
            p = leg.places[idx]
            w0 = leg.weather[di] if di < len(leg.weather) else None
            crowd += _crowd_cost(p, 12)
            weather += _weather_cost(p, w0)
            enjoy += _enjoyment(p, 12, w0)

    feasible = travel <= 480 * leg.days
    return Plan(
        label=label, description=description, days=days,
        scores=PlanScores(
            travelMin=round(travel, 1), distanceKm=round(dist, 2),
            crowdCost=round(crowd, 3), weatherCost=round(weather, 3),
            enjoyment=round(enjoy, 3), feasible=feasible,
        ),
    )


# ─────────────────────────── public ───────────────────────────
def generate_plans(req: GenerateRequest):
    """Returns {plans:[A,B], pareto:[...meta]} aggregated across all city-legs."""
    plan_a_legs: List[Day] = []
    plan_b_legs: List[Day] = []
    pareto_meta: List[dict] = []
    score_a = PlanScores()
    score_b = PlanScores()
    day_offset = 0

    for leg in req.legs:
        if not leg.places:
            continue
        evaluate, start, traffic = _leg_evaluator(leg)

        # Anchor must-visit places first → keep them in the plan.
        anchor_idx = [i for i, p in enumerate(leg.places) if p.isAnchor]
        front = nsga2(
            n_items=len(leg.places),
            evaluate=evaluate,
            fixed_prefix=anchor_idx,
            pop_size=max(20, min(60, len(leg.places) * 4)),
            generations=50,
        )
        a_ind, b_ind = _pick_two(front)
        if a_ind is None:
            continue

        # Force Plan B to actually diverge if NSGA-II's front collapsed.
        if b_ind is a_ind or list(b_ind.perm) == list(a_ind.perm):
            coolest = min(range(len(leg.places)), key=lambda i: leg.places[i].crowd.score)
            from .algorithms import genetic_route
            coords_idx = {i: (leg.places[i].lat, leg.places[i].lng) for i in range(len(leg.places))}

            def _gcost(i, j, _c=coords_idx, _t=traffic):
                return travel_min(_c[i], _c[j], AVG_SPEED_KMH, _t)

            anchors_first = anchor_idx + ([coolest] if coolest not in anchor_idx else [])
            seed_perm = genetic_route(
                nodes=list(range(len(leg.places))),
                cost=_gcost,
                fixed_start=anchors_first[0] if anchors_first else None,
                pop_size=30, generations=40,
            )
            # Move "coolest" to second slot so Plan B literally starts differently.
            if coolest in seed_perm and seed_perm[0] != coolest:
                seed_perm.remove(coolest)
                seed_perm.insert(1 if anchors_first else 0, coolest)
            class _I:  # tiny shim
                pass
            b_ind = _I()
            b_ind.perm = seed_perm
            b_ind.obj = evaluate(seed_perm)
            b_ind.rank = -1

        plan_a = _build_plan_for_perm(
            a_ind.perm, leg, start, traffic,
            label=f"Plan A · {leg.cityName or leg.cityId}",
            description="Pareto-balanced: minimises travel time and crowd while keeping enjoyment high.",
        )
        plan_b = _build_plan_for_perm(
            b_ind.perm, leg, start, traffic,
            label=f"Plan B · {leg.cityName or leg.cityId}",
            description="Crowd-averse alternative: avoids peak-hour congestion at the cost of slightly more travel.",
            crowd_weight=0.6,
        )

        for d in plan_a.days:
            d.day += day_offset
            plan_a_legs.append(d)
        for d in plan_b.days:
            d.day += day_offset
            plan_b_legs.append(d)
        day_offset += leg.days

        # Aggregate scores
        for src, dst in [(plan_a.scores, score_a), (plan_b.scores, score_b)]:
            dst.travelMin += src.travelMin
            dst.distanceKm += src.distanceKm
            dst.crowdCost += src.crowdCost
            dst.weatherCost += src.weatherCost
            dst.enjoyment += src.enjoyment
            dst.feasible = dst.feasible and src.feasible

        pareto_meta.append({
            "cityId": leg.cityId,
            "frontSize": len(front),
            "objectives": ["travelMin", "distanceKm", "crowdCost", "weatherCost", "-enjoyment"],
            "frontPoints": [
                {"perm": ind.perm, "obj": list(ind.obj), "rank": ind.rank}
                for ind in front[: req.paretoSize]
            ],
        })

    plan_a_full = Plan(
        label="Plan A — NSGA-II balanced",
        description="Recommended Pareto-balanced trade-off across all cities.",
        days=plan_a_legs, scores=score_a,
    )
    plan_b_full = Plan(
        label="Plan B — crowd-averse",
        description="Alternative biased away from peak-hour congestion.",
        days=plan_b_legs, scores=score_b,
    )
    return {"plans": [plan_a_full.model_dump(), plan_b_full.model_dump()], "pareto": pareto_meta}


# ─────────────────────────── validate ───────────────────────────
def validate_itinerary(req: ValidateRequest):
    issues: List[dict] = []
    by_id: Dict[str, PlaceCtx] = {p.id: p for leg in req.legs for p in leg.places}
    weather_by_date: Dict[str, WeatherDay] = {}
    for leg in req.legs:
        for w in leg.weather:
            if w.date:
                weather_by_date[w.date] = w

    for day in req.plan:
        total_travel = sum(s.travelMinFromPrev for s in day.stops)
        if total_travel > 480:
            issues.append({
                "day": day.day, "type": "travel_overflow",
                "message": f"Day {day.day}: {round(total_travel)} min of travel exceeds 8h.",
            })
        streak = 0
        weather = weather_by_date.get(day.date or "")
        for s in day.stops:
            p = by_id.get(s.placeId)
            if not p:
                continue
            if p.crowd.score >= 0.7:
                streak += 1
                if streak >= 3:
                    issues.append({
                        "day": day.day, "type": "crowd_streak",
                        "placeId": s.placeId,
                        "message": f"3+ high-crowd places in a row ending at {p.name}.",
                    })
            else:
                streak = 0
            if s.arrival:
                try:
                    hour = int(s.arrival.split(":")[0])
                    if hour in (p.peakHours or []):
                        issues.append({
                            "day": day.day, "type": "peak_overlap",
                            "placeId": s.placeId,
                            "message": f"{p.name} arrival {s.arrival} hits peak hour.",
                        })
                except Exception:
                    pass
            if weather and p.type in OUTDOOR_TYPES and weather.rainProb > 0.6:
                issues.append({
                    "day": day.day, "type": "weather_mismatch", "placeId": s.placeId,
                    "message": f"{p.name} is outdoor; rain probability {int(weather.rainProb*100)}%.",
                })
            if s.distanceKmFromPrev > 80:
                issues.append({
                    "day": day.day, "type": "long_hop", "placeId": s.placeId,
                    "message": f"{round(s.distanceKmFromPrev)} km hop to {p.name} — consider an overnight stop.",
                })
    return {"ok": len(issues) == 0, "issues": issues}


# ─────────────────────────── reallocate (dynamic) ───────────────────────────
def reallocate_day(req: ReallocateRequest):
    """Dynamic Shortest-Path reroute. Drops completed stops, swaps the next problem
    stop with the best unused alternative, and recomputes the rest with A* + 2-opt
    starting from the user's *current* location."""
    di = req.dayIndex
    if di < 0 or di >= len(req.plan):
        return {"plan": [d.model_dump() for d in req.plan], "swaps": [], "next": None}

    leg = next((l for l in req.legs if l.cityId == req.plan[di].cityId), req.legs[0])
    by_id = {p.id: p for p in leg.places}
    weather = leg.weather[di] if di < len(leg.weather) else None
    traffic = max(1.0, leg.trafficFactor)
    swaps: List[dict] = []

    plan = [d.model_dump() for d in req.plan]
    day = plan[di]

    here = (
        (req.currentLocation.lat, req.currentLocation.lng) if req.currentLocation
        else (leg.accommodation.lat, leg.accommodation.lng) if leg.accommodation
        else (leg.places[0].lat, leg.places[0].lng)
    )
    here_id = "__stay__"

    completed = set(req.completedStopIds or [])
    remaining = [s for s in day["stops"] if s["placeId"] not in completed and not s.get("eventId")]
    used_ids = {s["placeId"] for d in plan for s in d["stops"]}
    pool = [p for p in leg.places if p.id not in used_ids]

    # Scan ALL remaining stops and swap any that fail current conditions.
    for nxt in list(remaining):
        if not pool:
            break
        p = by_id.get(nxt["placeId"])
        if p is None:
            continue
        try:
            hour = int(nxt.get("arrival", "12:00").split(":")[0])
        except Exception:
            hour = 12
        bad = False
        reason_bits = []
        if weather and p.type in OUTDOOR_TYPES and weather.rainProb > 0.6:
            bad = True; reason_bits.append("rain")
        if p.crowd.score >= 0.85 or hour in (p.peakHours or []):
            bad = True; reason_bits.append("crowd")
        if req.reason in ("traffic", "emergency") and nxt is remaining[0]:
            bad = True; reason_bits.append(req.reason)
        if not bad:
            continue
        cands = sorted(
            pool,
            key=lambda c: (
                -_enjoyment(c, hour, weather),
                haversine_km(here, (c.lat, c.lng)),
            ),
        )
        rep = cands[0]
        swaps.append({
            "removed": p.id, "removedName": p.name,
            "added": rep.id, "addedName": rep.name,
            "reason": "/".join(reason_bits) or "user request",
        })
        nxt["placeId"] = rep.id
        pool.remove(rep)

    # Re-route remaining stops from `here` with A* on a fresh kNN graph.
    coords = {p.id: (p.lat, p.lng) for p in leg.places}
    coords[here_id] = here
    graph = build_knn_graph(coords, k=4, traffic=traffic)

    cur = datetime(2000, 1, 1, max(DAY_START_HOUR, datetime.now().hour), 0)
    last_id = here_id
    last_xy = here
    rewritten: List[dict] = []
    for s in remaining:
        if s.get("eventId"):
            rewritten.append(s)
            continue
        p = by_id.get(s["placeId"])
        if not p:
            continue
        path_ids, _ = a_star(graph, coords, last_id, p.id, AVG_SPEED_KMH, traffic)
        if not path_ids:
            path_ids, _ = dijkstra(graph, last_id, p.id)
        if not path_ids:
            path_ids = [last_id, p.id]
        seg_min = travel_min(last_xy, (p.lat, p.lng), AVG_SPEED_KMH, traffic)
        seg_km = haversine_km(last_xy, (p.lat, p.lng))
        cur = cur + timedelta(minutes=seg_min)
        s["arrival"] = cur.strftime("%H:%M")
        cur = cur + timedelta(minutes=p.visitMin)
        s["departure"] = cur.strftime("%H:%M")
        s["travelMinFromPrev"] = round(seg_min, 1)
        s["distanceKmFromPrev"] = round(seg_km, 2)
        s["routePath"] = [list(coords[i]) for i in path_ids]
        last_id, last_xy = p.id, (p.lat, p.lng)
        rewritten.append(s)

    # rebuild day's stops: completed + rewritten
    kept_completed = [s for s in day["stops"] if s["placeId"] in completed or s.get("eventId")]
    day["stops"] = kept_completed + rewritten
    plan[di] = day

    next_stop = rewritten[0] if rewritten else None
    return {"plan": plan, "swaps": swaps, "next": next_stop}
