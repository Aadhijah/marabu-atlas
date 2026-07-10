import { Router } from "express";
import { Trip } from "../models/index.js";

const r = Router();

r.get("/", async (_req, res) => res.json(await Trip.find().sort({ updatedAt: -1 }).lean()));

r.post("/", async (req, res) => {
  // Accept both legacy single-city body and new multi-leg body.
  const body = { ...req.body };
  if (!body.legs && body.cityId) {
    body.legs = [{
      cityId: body.cityId,
      days: body.days || 2,
      startDate: body.startDate,
      stayId: body.stayId,
      anchorPlaceIds: body.selectedPlaces || [],
      extraPlaceIds: [],
      eventIds: [],
      trafficFactor: 1.2,
    }];
  }
  const trip = await Trip.create(body);
  res.status(201).json(trip);
});

r.get("/:id", async (req, res) => {
  const t = await Trip.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ error: "Trip not found" });
  res.json(t);
});

r.patch("/:id", async (req, res) => {
  const t = await Trip.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(t);
});

r.delete("/:id", async (req, res) => {
  await Trip.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default r;
