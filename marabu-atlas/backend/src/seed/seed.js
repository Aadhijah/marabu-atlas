import "dotenv/config";
import mongoose from "mongoose";
import { City, Place, Stay, Dining, Event } from "../models/index.js";
import { cities, places, stays, dining, events } from "./seedSource.js";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅  Connected. Seeding…");

  await Promise.all([
    City.deleteMany({}),
    Place.deleteMany({}),
    Stay.deleteMany({}),
    Dining.deleteMany({}),
    Event.deleteMany({}),
  ]);

  await City.insertMany(cities.map((x) => ({ ...x, _id: x.id, state: x.state || "Tamil Nadu" })));
  await Place.insertMany(places.map((x) => ({ ...x, _id: x.id })));
  await Stay.insertMany(stays.map((x) => ({ ...x, _id: x.id })));
  await Dining.insertMany(dining.map((x) => ({ ...x, _id: x.id })));
  await Event.insertMany(
    events.map((e) => ({
      _id: e.id,
      name: e.title || e.name,
      city: e.city,
      type: e.type,
      description: e.description,
      date: e.date,
      time: e.time,
      venue: e.venue,
      priceRange: e.price || e.priceRange || "TBA",
      bookingUrl: e.link || e.bookingUrl || "#",
    }))
  );

  console.log(
    `🌱  ${cities.length} cities · ${places.length} places · ${stays.length} stays · ${dining.length} dining · ${events.length} events`
  );
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
