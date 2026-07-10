import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { Compass, Bed, UtensilsCrossed, CalendarDays, ArrowRight } from "lucide-react";

const TABS = [
  { id: "places", label: "Places", icon: Compass, ep: "/places" },
  { id: "stays", label: "Stays", icon: Bed, ep: "/stays" },
  { id: "dining", label: "Dining", icon: UtensilsCrossed, ep: "/dining" },
  { id: "events", label: "Events", icon: CalendarDays, ep: "/events" },
];

export default function CityPage() {
  const { cityId } = useParams();
  const [tab, setTab] = useState("places");
  const [data, setData] = useState({});

  useEffect(() => {
    if (data[tab]) return;
    const ep = TABS.find((t) => t.id === tab).ep;
    api.get(`${ep}?city=${cityId}`).then((r) => setData((d) => ({ ...d, [tab]: r.data })));
  }, [tab, cityId, data]);

  const items = data[tab] || [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display text-3xl capitalize">{cityId}</h1>
        <Link to="/trip/new" className="btn btn-primary">
          Plan a trip here <ArrowRight size={16} />
        </Link>
      </div>

      <div className="mt-6 flex gap-2 border-b border-navy/10 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 -mb-px border-b-2 text-sm font-medium whitespace-nowrap ${
              tab === t.id
                ? "border-teal text-teal-dark"
                : "border-transparent text-navy/60 hover:text-navy"
            }`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((it) => (
          <div key={it._id || it.id} className="card p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-lg">{it.name}</h3>
              {it.crowd && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    it.crowd.level === "low"
                      ? "bg-green-100 text-green-700"
                      : it.crowd.level === "moderate"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {it.crowd.level}
                </span>
              )}
            </div>
            <p className="text-sm text-navy/70 mt-2 line-clamp-3">{it.description}</p>
            {it.priceRange && <div className="text-xs mt-3 text-navy/60">{it.priceRange}</div>}
            {it.date && (
              <div className="text-xs mt-3 text-teal-dark">
                {it.date} {it.time && `· ${it.time}`}
              </div>
            )}
            {it.bestTime && <div className="text-xs mt-3 text-navy/60">Best: {it.bestTime}</div>}
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-navy/50 col-span-full text-center py-12">
            Nothing here yet.
          </div>
        )}
      </div>
    </div>
  );
}
