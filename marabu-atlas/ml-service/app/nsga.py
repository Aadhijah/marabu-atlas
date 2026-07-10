"""NSGA-II — non-dominated sorting genetic algorithm for multi-objective
trip planning. Objectives are minimised: travel time, total distance,
crowd cost, weather cost, and (negative) enjoyment.

Each "individual" is a permutation of place indices (the must-visit anchors
are kept first so they always appear in the plan). We return the full first
Pareto front so the user can pick a trade-off (Plan A vs Plan B).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Callable, List, Sequence, Tuple

Objectives = Tuple[float, ...]


@dataclass
class Individual:
    perm: List[int]
    obj: Objectives = ()
    rank: int = 0
    crowding: float = 0.0


# ───────────────── Pareto utilities ─────────────────
def dominates(a: Objectives, b: Objectives) -> bool:
    """a Pareto-dominates b iff a is ≤ in all objectives and < in at least one."""
    better = False
    for x, y in zip(a, b):
        if x > y:
            return False
        if x < y:
            better = True
    return better


def fast_non_dominated_sort(pop: List[Individual]) -> List[List[int]]:
    """Returns fronts as lists of indices into `pop`."""
    S: List[List[int]] = [[] for _ in pop]
    n = [0] * len(pop)
    fronts: List[List[int]] = [[]]
    for p_i, p in enumerate(pop):
        for q_i, q in enumerate(pop):
            if p_i == q_i:
                continue
            if dominates(p.obj, q.obj):
                S[p_i].append(q_i)
            elif dominates(q.obj, p.obj):
                n[p_i] += 1
        if n[p_i] == 0:
            p.rank = 0
            fronts[0].append(p_i)

    i = 0
    while fronts[i]:
        nxt: List[int] = []
        for p_i in fronts[i]:
            for q_i in S[p_i]:
                n[q_i] -= 1
                if n[q_i] == 0:
                    pop[q_i].rank = i + 1
                    nxt.append(q_i)
        i += 1
        fronts.append(nxt)
    return fronts[:-1]


def crowding_distance(pop: List[Individual], front: List[int]) -> None:
    if not front:
        return
    for i in front:
        pop[i].crowding = 0.0
    m = len(pop[front[0]].obj)
    for k in range(m):
        front.sort(key=lambda i: pop[i].obj[k])
        pop[front[0]].crowding = math.inf
        pop[front[-1]].crowding = math.inf
        lo, hi = pop[front[0]].obj[k], pop[front[-1]].obj[k]
        rng = max(1e-9, hi - lo)
        for r in range(1, len(front) - 1):
            pop[front[r]].crowding += (
                (pop[front[r + 1]].obj[k] - pop[front[r - 1]].obj[k]) / rng
            )


# ───────────────── GA operators ─────────────────
def _ox(p1: List[int], p2: List[int], start_lock: int, rng: random.Random) -> List[int]:
    """Order-crossover keeping the first `start_lock` indices fixed."""
    n = len(p1)
    if n - start_lock < 2:
        return p1[:]
    i, j = sorted(rng.sample(range(start_lock, n), 2))
    middle = p1[i:j + 1]
    rest = [g for g in p2 if g not in middle and g not in p1[:start_lock]]
    child = p1[:start_lock] + rest[: i - start_lock] + middle + rest[i - start_lock:]
    return child


def _swap_mut(chrom: List[int], start_lock: int, rng: random.Random) -> List[int]:
    if len(chrom) - start_lock < 2:
        return chrom
    i, j = rng.sample(range(start_lock, len(chrom)), 2)
    chrom[i], chrom[j] = chrom[j], chrom[i]
    return chrom


# ───────────────── public API ─────────────────
def nsga2(
    n_items: int,
    evaluate: Callable[[List[int]], Objectives],
    fixed_prefix: List[int] | None = None,
    pop_size: int = 40,
    generations: int = 60,
    mutation_rate: float = 0.2,
    seed: int = 13,
) -> List[Individual]:
    """Run NSGA-II and return the **first Pareto front**.

    `fixed_prefix` (e.g. anchor must-visit places) is locked at the start of every
    chromosome so anchors always appear in the plan in user-chosen priority.
    """
    rng = random.Random(seed)
    prefix = list(fixed_prefix or [])
    free = [i for i in range(n_items) if i not in prefix]
    start_lock = len(prefix)

    def make() -> Individual:
        c = free[:]
        rng.shuffle(c)
        ind = Individual(perm=prefix + c)
        ind.obj = evaluate(ind.perm)
        return ind

    pop = [make() for _ in range(pop_size)]

    for _ in range(generations):
        # offspring
        children: List[Individual] = []
        while len(children) < pop_size:
            a, b = rng.sample(pop, 2)
            ch = _ox(a.perm, b.perm, start_lock, rng)
            if rng.random() < mutation_rate:
                ch = _swap_mut(ch[:], start_lock, rng)
            ind = Individual(perm=ch)
            ind.obj = evaluate(ind.perm)
            children.append(ind)

        # combined selection
        union = pop + children
        fronts = fast_non_dominated_sort(union)
        new_pop: List[Individual] = []
        for f in fronts:
            crowding_distance(union, f)
            f_sorted = sorted(f, key=lambda i: (-union[i].crowding,))
            for i in f_sorted:
                if len(new_pop) >= pop_size:
                    break
                new_pop.append(union[i])
            if len(new_pop) >= pop_size:
                break
        pop = new_pop

    fronts = fast_non_dominated_sort(pop)
    crowding_distance(pop, fronts[0])
    front0 = sorted([pop[i] for i in fronts[0]], key=lambda x: -x.crowding)
    # de-duplicate by permutation
    seen, uniq = set(), []
    for ind in front0:
        key = tuple(ind.perm)
        if key not in seen:
            seen.add(key)
            uniq.append(ind)
    return uniq
