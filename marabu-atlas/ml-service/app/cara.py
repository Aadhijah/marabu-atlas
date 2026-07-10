"""CARA — Context-Aware Recommender (heuristic stub).

Replace `recommend()` with a trained tensor-factorisation / deep CARS model
once you have user × place × context rating data. The contract returned to
the frontend is stable.
"""
from .schemas import CARARequest


def recommend(req: CARARequest):
    hour = int(req.context.get("hour", 12))
    rain = float(req.context.get("rainProb", 0.0))

    def score(p):
        peak = 0.4 if hour in (p.peakHours or []) else 0.0
        crowd = 0.5 * p.crowd.score + peak
        weather = 0.4 if rain > 0.5 and p.type in {"beach", "hill", "waterfall", "park"} else 0.0
        return p.popularity - crowd - weather

    ranked = sorted(req.candidates, key=lambda p: -score(p))
    return {
        "model": "heuristic-stub",
        "ranking": [
            {"placeId": p.id, "score": round(score(p), 3)} for p in ranked
        ],
    }
