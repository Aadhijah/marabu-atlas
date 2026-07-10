import { Router } from "express";
import { Stay } from "../models/index.js";
const r = Router();
r.get("/", async (req, res) => {
  const filter = req.query.city ? { city: req.query.city } : {};
  res.json(await Stay.find(filter).lean());
});
r.get("/:id", async (req, res) => {
  const s = await Stay.findById(req.params.id).lean();
  if (!s) return res.status(404).json({ error: "Stay not found" });
  res.json(s);
});
export default r;
