import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { AlertTriangle, CheckCircle2, RefreshCw, Replace, Check, Zap, MapPin } from "lucide-react";

export default function TripView() {
  const { tripId } = useParams();
  const [trip, setTrip] = useState(null);
  const [places, setPlaces] = useState({});
  const [issues, setIssues] = useState(null);
  const [busy, setBusy] = useState(false);
  const [swapInfo, setSwapInfo] = useState(null);

  const load = async () => {
    const { data } = await api.get(`/trips/${tripId}`);
    setTrip(data);
    const ids = [...new Set(
      (data.plans || []).flatMap((p) => (p.days || []).flatMap((d) => d.stops.map((s) => s.placeId)))
    )].filter((id) => !id?.startsWith("event:"));
    if (ids.length) {
      const items = await Promise.all(ids.map((id) =>
        api.get(`/places/${id}`).then((r) => r.data).catch(() => null)
      ));
      setPlaces(Object.fromEntries(items.filter(Boolean).map((p) => [p._id, p])));
    }
  };
  useEffect(() => { load(); }, [tripId]);

  if (!trip) return <div className="p-12 text-center">Loading…</div>;
  const pi = trip.activePlanIndex ?? 0;
  const plan = trip.plans?.[pi];
  if (!plan) return <div className="p-12 text-center">No plan generated yet.</div>;

  const switchPlan = async (idx) => {
    await api.post(`/itinerary/${tripId}/active`, { planIndex: idx });
    await load();
  };

  const validate = async () => {
    setBusy(true); setIssues(null);
    try {
      const { data } = await api.post(`/itinerary/${tripId}/validate`, { planIndex: pi });
      setIssues(data);
    } finally { setBusy(false); }
  };

  const reallocate = async (dayIndex, reason = null) => {
    setBusy(true); setSwapInfo(null);
    try {
      const completedStopIds = (plan.days[dayIndex]?.stops || [])
        .filter((s) => s.completed).map((s) => s.placeId);
      const { data } = await api.post(`/itinerary/${tripId}/reallocate`, {
        dayIndex, reason, completedStopIds,
      });
      setSwapInfo(data.swaps || []);
      await load();
    } finally { setBusy(false); }
  };

  const completeStop = async (di, si) => {
    await api.post(`/itinerary/${tripId}/stop/${di}/${si}/complete`);
    await load();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">{trip.name}</h1>
          <p className="text-navy/60 text-sm mt-1">
            {trip.legs?.map((l) => l.cityName || l.cityId).join(" → ")} · starts {trip.startDate}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={validate} disabled={busy} className="btn btn-ghost">
            <CheckCircle2 size={16}/> Check feasibility
          </button>
        </div>
      </div>

      {/* plan A vs B chooser */}
      <div className="mt-6 grid sm:grid-cols-2 gap-3">
        {(trip.plans || []).map((p, idx) => (
          <button key={idx} onClick={() => switchPlan(idx)}
            className={`text-left card p-4 transition ${idx === pi ? "ring-2 ring-teal" : ""}`}>
            <div className="flex items-center gap-2 font-display text-lg">
              {idx === pi && <Check size={18} className="text-teal"/>} {p.label}
            </div>
            <p className="text-sm text-navy/70 mt-1">{p.description}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Stat label="Travel" value={`${Math.round(p.scores?.travelMin || 0)} min`}/>
              <Stat label="Distance" value={`${Math.round(p.scores?.distanceKm || 0)} km`}/>
              <Stat label="Enjoyment" value={(p.scores?.enjoyment || 0).toFixed(2)}/>
            </div>
          </button>
        ))}
      </div>

      {issues && (
        <div className={`mt-5 card p-4 ${issues.ok ? "border-green-200" : "border-amber-200"}`}>
          {issues.ok ? (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 size={18}/> Looks good — no issues detected.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-amber-700 font-semibold">
                <AlertTriangle size={18}/> {issues.issues.length} issue(s) found
              </div>
              <ul className="mt-2 text-sm space-y-1 text-navy/80">
                {issues.issues.map((i, idx) => (
                  <li key={idx}>· Day {i.day} — <span className="capitalize">{i.type.replace(/_/g, " ")}</span>: {i.message}</li>
                ))}
              </ul>
              <div className="mt-3 text-sm text-navy/70">
                Tip: switch to the other Plan, or click <em>Re-route day</em> to dynamically swap problem stops.
              </div>
            </>
          )}
        </div>
      )}

      {swapInfo && swapInfo.length > 0 && (
        <div className="mt-4 card p-4 border-teal/30">
          <div className="font-semibold text-teal-dark">Re-allocated stops:</div>
          <ul className="mt-2 text-sm">
            {swapInfo.map((s, i) => (
              <li key={i}>· {s.removedName} → {s.addedName} ({s.reason})</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 space-y-6">
        {(plan.days || []).map((day, dIdx) => (
          <div key={dIdx} className="card p-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-display text-xl">
                Day {day.day} <span className="text-sm text-navy/50 font-sans">{day.date} · {day.cityId}</span>
              </h2>
              <div className="flex gap-1">
                <button onClick={() => reallocate(dIdx, "weather")} disabled={busy}
                  className="btn btn-ghost text-xs">
                  <RefreshCw size={14}/> Re-route (weather)
                </button>
                <button onClick={() => reallocate(dIdx, "traffic")} disabled={busy}
                  className="btn btn-ghost text-xs">
                  <Zap size={14}/> Re-route (live traffic)
                </button>
                <button onClick={() => reallocate(dIdx, "emergency")} disabled={busy}
                  className="btn btn-ghost text-xs text-red-600">
                  <AlertTriangle size={14}/> Emergency
                </button>
              </div>
            </div>

            <ol className="mt-3 space-y-2">
              {day.stops.map((s, i) => {
                const isEvent = !!s.eventId;
                const p = !isEvent ? places[s.placeId] : null;
                return (
                  <li key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${s.completed ? "bg-green-50 border-green-200" : "bg-white border-navy/10"}`}>
                    <span className="w-6 text-center font-semibold text-teal-dark">{i + 1}</span>
                    <div className="flex-1">
                      <div className="font-medium flex items-center gap-2">
                        {isEvent ? <>🎟 {s.note || "Live event"}</> : <>{p?.name || s.placeId}</>}
                        {p?.crowd && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            p.crowd.level === "low" ? "bg-green-100 text-green-700"
                            : p.crowd.level === "moderate" ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"}`}>
                            {p.crowd.level}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-navy/60 flex items-center gap-2 flex-wrap">
                        {s.arrival && <span>{s.arrival}{s.departure && ` → ${s.departure}`}</span>}
                        {s.travelMinFromPrev > 0 && <span>· {Math.round(s.travelMinFromPrev)} min travel</span>}
                        {s.distanceKmFromPrev > 0 && <span>· {s.distanceKmFromPrev?.toFixed?.(1)} km</span>}
                        {s.routePath?.length > 1 && <span className="text-teal-dark"><MapPin size={11} className="inline"/> A* route</span>}
                      </div>
                    </div>
                    {!s.completed && !isEvent && (
                      <button onClick={() => completeStop(dIdx, i)} className="btn btn-ghost !py-1 !px-2 text-xs">
                        <Check size={14}/> Done
                      </button>
                    )}
                  </li>
                );
              })}
              {day.stops.length === 0 && (
                <li className="text-sm text-navy/50 italic p-2">Rest day — no stops.</li>
              )}
            </ol>
          </div>
        ))}
      </div>

      {trip.pareto?.length > 0 && (
        <details className="mt-8 card p-4">
          <summary className="cursor-pointer text-sm font-semibold">Pareto front details (NSGA-II)</summary>
          <pre className="text-xs mt-3 overflow-x-auto">{JSON.stringify(trip.pareto, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-sand rounded-lg p-2">
      <div className="text-[10px] uppercase text-navy/50">{label}</div>
      <div className="font-semibold text-sm">{value}</div>
    </div>
  );
}
