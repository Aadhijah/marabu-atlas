"""Routing & route-improvement algorithms.

Implements (in order of how the trip planner uses them):

* Haversine distance + travel-time conversion.
* Dijkstra's algorithm  — baseline shortest path on a weighted graph.
* A* Search             — same graph, with a haversine heuristic (admissible).
* 2-opt                 — local route-improvement by edge-swap.
* Genetic Algorithm     — population-based multi-stop route search.
* Simulated Annealing   — escapes 2-opt local optima.

These work on plain index lists so they can be reused by NSGA-II.
"""
from __future__ import annotations

import heapq
import math
import random
from typing import Callable, Dict, Iterable, List, Sequence, Tuple

Coord = Tuple[float, float]


# ─────────────────────────── distance / time ───────────────────────────
def haversine_km(a: Coord, b: Coord) -> float:
    lat1, lng1 = a
    lat2, lng2 = b
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def travel_min(a: Coord, b: Coord, avg_speed_kmh: float = 30.0, traffic: float = 1.2) -> float:
    return (haversine_km(a, b) / max(1e-6, avg_speed_kmh)) * 60.0 * traffic


# ─────────────────────────── shortest path ───────────────────────────
def dijkstra(
    graph: Dict[str, List[Tuple[str, float]]],
    source: str,
    target: str,
) -> Tuple[List[str], float]:
    """Classic Dijkstra. Returns (path, total_cost). Empty path if unreachable."""
    if source == target:
        return [source], 0.0
    dist: Dict[str, float] = {source: 0.0}
    prev: Dict[str, str] = {}
    pq: List[Tuple[float, str]] = [(0.0, source)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == target:
            break
        if d > dist.get(u, math.inf):
            continue
        for v, w in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if target not in dist:
        return [], math.inf
    path = [target]
    while path[-1] in prev:
        path.append(prev[path[-1]])
    return list(reversed(path)), dist[target]


def a_star(
    graph: Dict[str, List[Tuple[str, float]]],
    coords: Dict[str, Coord],
    source: str,
    target: str,
    avg_speed_kmh: float = 30.0,
    traffic: float = 1.0,
) -> Tuple[List[str], float]:
    """A* with haversine travel-time heuristic — admissible, so optimal."""
    if source == target:
        return [source], 0.0
    if source not in coords or target not in coords:
        return dijkstra(graph, source, target)

    def h(u: str) -> float:
        return travel_min(coords[u], coords[target], avg_speed_kmh, max(1.0, traffic))

    g: Dict[str, float] = {source: 0.0}
    prev: Dict[str, str] = {}
    open_pq: List[Tuple[float, str]] = [(h(source), source)]
    closed: set = set()
    while open_pq:
        _, u = heapq.heappop(open_pq)
        if u == target:
            break
        if u in closed:
            continue
        closed.add(u)
        for v, w in graph.get(u, []):
            ng = g[u] + w
            if ng < g.get(v, math.inf):
                g[v] = ng
                prev[v] = u
                heapq.heappush(open_pq, (ng + h(v), v))
    if target not in g:
        return [], math.inf
    path = [target]
    while path[-1] in prev:
        path.append(prev[path[-1]])
    return list(reversed(path)), g[target]


def build_knn_graph(
    coords: Dict[str, Coord],
    k: int = 4,
    avg_speed_kmh: float = 30.0,
    traffic: float = 1.0,
) -> Dict[str, List[Tuple[str, float]]]:
    """When no edges are supplied, build a k-NN proximity graph in travel-minutes."""
    ids = list(coords.keys())
    g: Dict[str, List[Tuple[str, float]]] = {i: [] for i in ids}
    for i in ids:
        scored = [
            (j, travel_min(coords[i], coords[j], avg_speed_kmh, traffic))
            for j in ids
            if j != i
        ]
        scored.sort(key=lambda x: x[1])
        for j, w in scored[: max(1, k)]:
            g[i].append((j, w))
            g[j].append((i, w))   # undirected
    # de-duplicate
    for i in g:
        seen: Dict[str, float] = {}
        for j, w in g[i]:
            if j not in seen or w < seen[j]:
                seen[j] = w
        g[i] = sorted(seen.items(), key=lambda x: x[1])
    return g


# ─────────────────────────── 2-opt ───────────────────────────
def two_opt(
    order: List[int],
    cost: Callable[[int, int], float],
    max_passes: int = 30,
) -> List[int]:
    """Iteratively remove crossings. `order` is a list of node indices; cost(i,j)
    returns the edge cost. Endpoints are kept fixed (start at order[0])."""
    if len(order) < 4:
        return order[:]

    def total(seq: List[int]) -> float:
        return sum(cost(seq[i], seq[i + 1]) for i in range(len(seq) - 1))

    best = order[:]
    best_cost = total(best)
    for _ in range(max_passes):
        improved = False
        for i in range(1, len(best) - 2):
            for j in range(i + 1, len(best) - 1):
                cand = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                c = total(cand)
                if c + 1e-6 < best_cost:
                    best, best_cost = cand, c
                    improved = True
        if not improved:
            break
    return best


# ─────────────────────────── Genetic Algorithm ───────────────────────────
def genetic_route(
    nodes: List[int],
    cost: Callable[[int, int], float],
    fixed_start: int | None = None,
    pop_size: int = 40,
    generations: int = 80,
    mutation_rate: float = 0.15,
    seed: int = 7,
) -> List[int]:
    """Order-crossover (OX) GA for route minimisation. Optional fixed start node."""
    rng = random.Random(seed)
    pool = nodes[:]
    start = fixed_start
    if start is not None and start in pool:
        pool.remove(start)

    def make_chrom() -> List[int]:
        c = pool[:]
        rng.shuffle(c)
        return ([start] if start is not None else []) + c

    def fit(chrom: List[int]) -> float:
        return sum(cost(chrom[i], chrom[i + 1]) for i in range(len(chrom) - 1))

    population = [make_chrom() for _ in range(pop_size)]

    def ox(p1: List[int], p2: List[int]) -> List[int]:
        a = 1 if start is not None else 0
        if len(p1) - a < 2:
            return p1[:]
        i, j = sorted(rng.sample(range(a, len(p1)), 2))
        middle = p1[i:j + 1]
        rest = [g for g in p2 if g not in middle and (start is None or g != start)]
        child = ([start] if start is not None else []) + rest[: i - a] + middle + rest[i - a:]
        return child

    def mutate(chrom: List[int]) -> List[int]:
        a = 1 if start is not None else 0
        if len(chrom) - a < 2:
            return chrom
        i, j = rng.sample(range(a, len(chrom)), 2)
        chrom[i], chrom[j] = chrom[j], chrom[i]
        return chrom

    for _ in range(generations):
        scored = sorted(((fit(c), c) for c in population), key=lambda x: x[0])
        elite = [c for _, c in scored[: max(2, pop_size // 5)]]
        children = elite[:]
        while len(children) < pop_size:
            p1, p2 = rng.choice(elite), rng.choice(elite)
            ch = ox(p1, p2)
            if rng.random() < mutation_rate:
                ch = mutate(ch)
            children.append(ch)
        population = children

    return min(population, key=fit)


# ─────────────────────────── Simulated Annealing ───────────────────────────
def simulated_annealing(
    order: List[int],
    cost: Callable[[int, int], float],
    fixed_start: bool = True,
    t0: float = 100.0,
    cooling: float = 0.995,
    iterations: int = 4000,
    seed: int = 11,
) -> List[int]:
    """Standard SA for route ordering. Accepts uphill moves with prob exp(-ΔE/T)."""
    if len(order) < 3:
        return order[:]
    rng = random.Random(seed)

    def total(seq: List[int]) -> float:
        return sum(cost(seq[i], seq[i + 1]) for i in range(len(seq) - 1))

    cur = order[:]
    cur_c = total(cur)
    best, best_c = cur[:], cur_c
    t = t0
    a = 1 if fixed_start else 0
    for _ in range(iterations):
        if len(cur) - a < 2:
            break
        i, j = sorted(rng.sample(range(a, len(cur)), 2))
        cand = cur[:i] + cur[i:j + 1][::-1] + cur[j + 1:]
        c = total(cand)
        d = c - cur_c
        if d < 0 or rng.random() < math.exp(-d / max(1e-6, t)):
            cur, cur_c = cand, c
            if c < best_c:
                best, best_c = cand, c
        t *= cooling
    return best
