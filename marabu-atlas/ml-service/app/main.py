from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (
    GenerateRequest, ValidateRequest, ReallocateRequest,
    CARARequest, RouteRequest,
)
from .planner import generate_plans, validate_itinerary, reallocate_day
from .cara import recommend as cara_recommend
from .algorithms import a_star, dijkstra, build_knn_graph

app = FastAPI(title="Marabu Atlas ML Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "service": "marabu-ml", "version": "2.0.0",
            "algorithms": ["NSGA-II", "A*", "Dijkstra", "2-opt", "GA", "SA",
                           "Pareto", "DSPP"]}


@app.post("/itinerary/generate")
def generate(req: GenerateRequest):
    return generate_plans(req)


@app.post("/itinerary/validate")
def validate(req: ValidateRequest):
    return validate_itinerary(req)


@app.post("/itinerary/reallocate")
def reallocate(req: ReallocateRequest):
    return reallocate_day(req)


@app.post("/route")
def route(req: RouteRequest):
    """Standalone shortest-path between two nodes (A* default, Dijkstra optional)."""
    coords = {n.id: (n.lat, n.lng) for n in req.nodes}
    if req.edges:
        graph: dict = {n.id: [] for n in req.nodes}
        for fr, to, w in req.edges:
            graph.setdefault(fr, []).append((to, float(w)))
            graph.setdefault(to, []).append((fr, float(w)))
    else:
        graph = build_knn_graph(coords, k=4, traffic=req.trafficFactor)
    if req.algorithm == "dijkstra":
        path, cost = dijkstra(graph, req.fromId, req.toId)
    else:
        path, cost = a_star(graph, coords, req.fromId, req.toId, traffic=req.trafficFactor)
    return {
        "algorithm": req.algorithm,
        "path": path,
        "costMin": round(cost, 2),
        "coords": [list(coords[i]) for i in path if i in coords],
    }


@app.post("/cara/recommend")
def cara(req: CARARequest):
    return cara_recommend(req)
