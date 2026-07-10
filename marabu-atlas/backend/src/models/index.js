import mongoose from "mongoose";

const { Schema, model } = mongoose;

// ────────────────── reference data ──────────────────
const CitySchema = new Schema({
  _id: String,
  name: String,
  state: { type: String, default: "Tamil Nadu", index: true },
  tagline: String,
  description: String,
  personality: String,
  lat: Number,
  lng: Number,
});

const PlaceSchema = new Schema({
  _id: String,
  name: String,
  city: { type: String, index: true },
  type: String,
  description: String,
  tags: [String],
  lat: Number,
  lng: Number,
  popularity: Number,
  baseCrowd: Number,
  peakHours: [Number],
  bestTime: String,
  visitMin: { type: Number, default: 75 },
  culturalInfo: { myth: String, festival: String, history: String },
});

const StaySchema = new Schema({
  _id: String,
  name: String,
  city: { type: String, index: true },
  type: String,
  description: String,
  priceRange: String,
  rating: Number,
  amenities: [String],
  lat: Number,
  lng: Number,
  contact: String,
});

const DiningSchema = new Schema({
  _id: String,
  name: String,
  city: { type: String, index: true },
  type: String,
  cuisine: String,
  description: String,
  priceRange: String,
  rating: Number,
  mustTry: [String],
  lat: Number,
  lng: Number,
  hours: String,
});

const EventSchema = new Schema({
  _id: String,
  name: String,
  city: { type: String, index: true },
  type: String,
  description: String,
  date: String,
  time: String,
  venue: String,
  lat: Number,
  lng: Number,
  durationMin: { type: Number, default: 120 },
  priceRange: String,
  bookingUrl: String,
});

// ────────────────── new multi-leg Trip ──────────────────
const StopSchema = new Schema(
  {
    placeId: String,
    order: Number,
    arrival: String,
    departure: String,
    travelMinFromPrev: Number,
    distanceKmFromPrev: Number,
    routePath: [[Number]],
    eventId: String,
    note: String,
    completed: { type: Boolean, default: false },
    completedAt: Date,
  },
  { _id: false }
);

const DaySchema = new Schema(
  {
    day: Number,
    date: String,
    cityId: String,
    stops: [StopSchema],
  },
  { _id: false }
);

const PlanScoresSchema = new Schema(
  {
    travelMin: Number,
    distanceKm: Number,
    crowdCost: Number,
    weatherCost: Number,
    enjoyment: Number,
    feasible: { type: Boolean, default: true },
  },
  { _id: false }
);

const PlanSchema = new Schema(
  {
    label: String,
    description: String,
    days: [DaySchema],
    scores: PlanScoresSchema,
  },
  { _id: false }
);

const LegSchema = new Schema(
  {
    cityId: String,
    cityName: String,
    days: Number,
    startDate: String,
    stayId: String,
    anchorPlaceIds: [String], // user's must-visit
    extraPlaceIds: [String], // nearby suggestions they accepted
    eventIds: [String],
    trafficFactor: { type: Number, default: 1.2 },
  },
  { _id: false }
);

const TripSchema = new Schema(
  {
    name: String,
    homeCity: String,
    state: String,
    travellers: { type: Number, default: 2 },
    startDate: String,
    legs: [LegSchema],

    plans: [PlanSchema], // [planA, planB]
    activePlanIndex: { type: Number, default: 0 },
    pareto: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true }
);

export const City = model("City", CitySchema);
export const Place = model("Place", PlaceSchema);
export const Stay = model("Stay", StaySchema);
export const Dining = model("Dining", DiningSchema);
export const Event = model("Event", EventSchema);
export const Trip = model("Trip", TripSchema);
