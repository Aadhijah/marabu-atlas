import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useTrip } from "../context/TripContext.jsx";
import { MapPin, Cloud } from "lucide-react";

export default function Home() {
  const [cities, setCities] = useState([]);
  const [weather, setWeather] = useState({});
  const { setCityId } = useTrip();

  useEffect(() => {
    api.get("/cities").then((r) => {
      setCities(r.data);
      Promise.all(
        r.data.map((c) => api.get(`/weather/${c._id}`).then((w) => [c._id, w.data]).catch(() => [c._id, null]))
      ).then((pairs) => setWeather(Object.fromEntries(pairs)));
    });
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <h1 className="font-display text-4xl md:text-5xl text-navy">
        Pick a city, plan your story
      </h1>
      <p className="mt-3 text-navy/70 max-w-2xl">
        Four cities. Real crowd, weather, and event signals. A planner that
        builds a day-by-day itinerary you can drag, edit, and re-validate.
      </p>

      <div className="mt-10 grid sm:grid-cols-2 gap-5">
        {cities.map((c) => {
          const w = weather[c._id];
          return (
            <Link
              key={c._id}
              to={`/city/${c._id}`}
              onClick={() => setCityId(c._id)}
              className="card p-6 hover:shadow-lg transition group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-teal-dark text-xs uppercase tracking-wider">
                    <MapPin size={14} />
                    {c.personality}
                  </div>
                  <h2 className="font-display text-2xl mt-1">{c.name}</h2>
                  <p className="text-navy/70 text-sm mt-1">{c.tagline}</p>
                </div>
                {w && (
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-navy/60 text-xs">
                      <Cloud size={14} /> {w.condition}
                    </div>
                    <div className="text-2xl font-semibold">{w.temp}°</div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
