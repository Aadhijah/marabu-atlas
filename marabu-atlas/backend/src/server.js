import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import mongoose from "mongoose";

import citiesRouter from "./routes/cities.js";
import placesRouter from "./routes/places.js";
import staysRouter from "./routes/stays.js";
import diningRouter from "./routes/dining.js";
import eventsRouter from "./routes/events.js";
import weatherRouter from "./routes/weather.js";
import tripsRouter from "./routes/trips.js";
import itineraryRouter from "./routes/itinerary.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/cities", citiesRouter);
app.use("/api/places", placesRouter);
app.use("/api/stays", staysRouter);
app.use("/api/dining", diningRouter);
app.use("/api/events", eventsRouter);
app.use("/api/weather", weatherRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/itinerary", itineraryRouter);

const PORT = process.env.PORT || 4000;
const MONGO = process.env.MONGODB_URI;

if (!MONGO) {
  console.error("❌  MONGODB_URI missing in .env");
  process.exit(1);
}

mongoose
  .connect(MONGO)
  .then(() => {
    console.log("✅  MongoDB Atlas connected");
    app.listen(PORT, () => console.log(`🚀  API on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("❌  Mongo error:", err.message);
    process.exit(1);
  });
