import { Router } from "express";
import { City } from "../models/index.js";

const r = Router();

r.get("/", async (req, res) => {
  const filter = req.query.state ? { state: req.query.state } : {};
  res.json(await City.find(filter).lean());
});

r.get("/states/list", async (_req, res) => {
  const states = await City.distinct("state");
  res.json(states.filter(Boolean));
});

r.get("/:id", async (req, res) => {
  const c = await City.findById(req.params.id).lean();
  if (!c) return res.status(404).json({ error: "City not found" });
  res.json(c);
});

export default r;
