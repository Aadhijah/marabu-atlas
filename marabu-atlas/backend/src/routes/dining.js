import { Router } from "express";
import { Dining } from "../models/index.js";
const r = Router();
r.get("/", async (req, res) => {
  const filter = req.query.city ? { city: req.query.city } : {};
  res.json(await Dining.find(filter).lean());
});
export default r;
