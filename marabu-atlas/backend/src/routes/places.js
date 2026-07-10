import { Router } from "express";
import { Place, Dining } from "../models/index.js";
import { getLiveCrowd } from "../services/crowdService.js";

const r = Router();

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

r.get("/", async (req, res) => {
  const filter = req.query.city ? { city: req.query.city } : {};
  const places = await Place.find(filter).lean();
  const enriched = await Promise.all(
    places.map(async (p) => ({ ...p, crowd: await getLiveCrowd(p) }))
  );
  res.json(enriched);
});

r.get("/:id", async (req, res) => {
  const p = await Place.findById(req.params.id).lean();
  if (!p) return res.status(404).json({ error: "Place not found" });
  res.json({ ...p, crowd: await getLiveCrowd(p) });
});

// Nearby activities + restaurants — used by the wizard suggestion step.
r.get("/:id/nearby", async (req, res) => {
  const p = await Place.findById(req.params.id).lean();
  if (!p) return res.status(404).json({ error: "Place not found" });
  const radiusKm = Number(req.query.radiusKm || 8);
  const [places, dining] = await Promise.all([
    Place.find({ city: p.city, _id: { $ne: p._id } }).lean(),
    Dining.find({ city: p.city }).lean(),
  ]);
  const nearbyPlaces = places
    .map((x) => ({ ...x, distanceKm: haversineKm(p, x) }))
    .filter((x) => x.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 8);
  const nearbyDining = dining
    .map((x) => ({ ...x, distanceKm: haversineKm(p, x) }))
    .filter((x) => x.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 8);
  res.json({ places: nearbyPlaces, dining: nearbyDining });
});

export default r;
