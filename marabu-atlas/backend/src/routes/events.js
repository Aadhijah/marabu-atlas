import { Router } from "express";
import { Event } from "../models/index.js";
import { fetchLiveEvents } from "../services/eventsService.js";

const r = Router();

r.get("/", async (req, res) => {
  const cityId = req.query.city;
  const filter = cityId ? { city: cityId } : {};
  const seeded = await Event.find(filter).lean();
  const live = await fetchLiveEvents(cityId);
  // dedupe by name+date
  const key = (e) => `${e.name?.toLowerCase()}|${e.date}`;
  const map = new Map();
  for (const e of [...seeded, ...live]) map.set(key(e), e);
  res.json([...map.values()]);
});

export default r;
