import { Router } from "express";
import { City } from "../models/index.js";
import { getCurrentWeather, getForecast } from "../services/weatherService.js";

const r = Router();

r.get("/:cityId", async (req, res) => {
  const city = await City.findById(req.params.cityId).lean();
  if (!city) return res.status(404).json({ error: "City not found" });
  const w = await getCurrentWeather(city.lat, city.lng);
  res.json(w);
});

r.get("/:cityId/forecast", async (req, res) => {
  const city = await City.findById(req.params.cityId).lean();
  if (!city) return res.status(404).json({ error: "City not found" });
  res.json(await getForecast(city.lat, city.lng));
});

export default r;
