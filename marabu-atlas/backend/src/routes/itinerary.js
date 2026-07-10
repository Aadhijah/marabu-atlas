import { Router } from "express";
import axios from "axios";
import { Trip, Place, Stay, Event } from "../models/index.js";
import { getLiveCrowd } from "../services/crowdService.js";
import { getForecast } from "../services/weatherService.js";

const ML = process.env.ML_SERVICE_URL || "http://localhost:8000";
const r = Router();

async function buildLegContext(leg) {
  const stay = leg.stayId ? await Stay.findById(leg.stayId).lean() : null;
  const allIds = [...new Set([...(leg.anchorPlaceIds || []), ...(leg.extraPlaceIds || [])])];
  const places = await Place.find({ _id: { $in: allIds } }).lean();
  const enrichedPlaces = await Promise.all(
    places.map(async (p) => ({
      id: p._id,
      name: p.name,
      city: p.city,
      lat: p.lat,
      lng: p.lng,
      type: p.type,
      popularity: p.popularity ?? 0.5,
      baseCrowd: p.baseCrowd ?? 0.4,
      peakHours: p.peakHours || [],
      bestTime: p.bestTime,
      visitMin: p.visitMin || 75,
      crowd: await getLiveCrowd(p),
      isAnchor: (leg.anchorPlaceIds || []).includes(p._id),
    }))
  );
  const events = leg.eventIds?.length
    ? (await Event.find({ _id: { $in: leg.eventIds } }).lean()).map((e) => ({
        id: e._id, name: e.name, city: e.city, date: e.date, time: e.time,
        venue: e.venue, lat: e.lat, lng: e.lng, durationMin: e.durationMin || 120,
      }))
    : [];
  let weather = [];
  if (stay) {
    const f = await getForecast(stay.lat, stay.lng);
    weather = (f.daily || []).slice(0, leg.days);
  }
  return {
    cityId: leg.cityId,
    cityName: leg.cityName,
    days: leg.days,
    startDate: leg.startDate,
    accommodation: stay
      ? { id: stay._id, name: stay.name, city: stay.city, lat: stay.lat, lng: stay.lng }
      : null,
    places: enrichedPlaces,
    events,
    weather,
    trafficFactor: leg.trafficFactor || 1.2,
  };
}

async function buildRequest(trip) {
  const legs = await Promise.all((trip.legs || []).map(buildLegContext));
  return { legs, objectives: ["time", "crowd", "distance"], paretoSize: 8 };
}

r.post("/:tripId/generate", async (req, res) => {
  const trip = await Trip.findById(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  const ctx = await buildRequest(trip);
  try {
    const { data } = await axios.post(`${ML}/itinerary/generate`, ctx, { timeout: 30000 });
    trip.plans = data.plans || [];
    trip.pareto = data.pareto || [];
    trip.activePlanIndex = 0;
    await trip.save();
    res.json(data);
  } catch (err) {
    console.error("ML generate failed:", err.message);
    res.status(502).json({ error: "ML service unavailable", detail: err.message });
  }
});

r.post("/:tripId/validate", async (req, res) => {
  const trip = await Trip.findById(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  const ctx = await buildRequest(trip);
  const planIdx = req.body.planIndex ?? trip.activePlanIndex ?? 0;
  const plan = req.body.plan || trip.plans?.[planIdx]?.days || [];
  try {
    const { data } = await axios.post(`${ML}/itinerary/validate`, { legs: ctx.legs, plan });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "ML service unavailable", detail: err.message });
  }
});

r.post("/:tripId/reallocate", async (req, res) => {
  const trip = await Trip.findById(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  const ctx = await buildRequest(trip);
  const planIdx = trip.activePlanIndex ?? 0;
  const plan = trip.plans?.[planIdx]?.days || [];
  try {
    const { data } = await axios.post(`${ML}/itinerary/reallocate`, {
      legs: ctx.legs,
      plan,
      dayIndex: req.body.dayIndex ?? 0,
      completedStopIds: req.body.completedStopIds || [],
      currentLocation: req.body.currentLocation || null,
      reason: req.body.reason || null,
    });
    if (trip.plans?.[planIdx]) {
      trip.plans[planIdx].days = data.plan;
      trip.markModified("plans");
      await trip.save();
    }
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "ML service unavailable", detail: err.message });
  }
});

r.post("/:tripId/active", async (req, res) => {
  const trip = await Trip.findByIdAndUpdate(
    req.params.tripId,
    { activePlanIndex: req.body.planIndex ?? 0 },
    { new: true }
  );
  res.json(trip);
});

r.post("/:tripId/stop/:dayIndex/:stopIndex/complete", async (req, res) => {
  const trip = await Trip.findById(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  const pi = trip.activePlanIndex ?? 0;
  const di = Number(req.params.dayIndex), si = Number(req.params.stopIndex);
  const stop = trip.plans?.[pi]?.days?.[di]?.stops?.[si];
  if (!stop) return res.status(404).json({ error: "Stop not found" });
  stop.completed = true;
  stop.completedAt = new Date();
  trip.markModified("plans");
  await trip.save();
  res.json({ ok: true });
});

// Standalone shortest-path for the live route panel.
r.post("/route", async (req, res) => {
  try {
    const { data } = await axios.post(`${ML}/route`, req.body, { timeout: 8000 });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "ML routing unavailable", detail: err.message });
  }
});

export default r;
