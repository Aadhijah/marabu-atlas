import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { Check, Plus, X, MapPin, Loader2 } from "lucide-react";

/**
 * Multi-step wizard:
 *  1. Trip basics (name, dates, home city, state)
 *  2. Cities to visit in that state (multi-select; per-city days)
 *  3. Per-city accommodation
 *  4. Per-city must-visit anchor places
 *  5. Suggested nearby activities + restaurants per anchor (opt-in)
 *  6. Live events on the trip dates (opt-in)
 *  7. Generate Plan A vs Plan B with NSGA-II
 */
export default function TripBuilder() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [states, setStates] = useState([]);
  const [allCities, setAllCities] = useState([]);
  const [trip, setTrip] = useState({
    name: "My Tamil Nadu trip",
    homeCity: "",
    state: "Tamil Nadu",
    travellers: 2,
    startDate: new Date().toISOString().slice(0, 10),
    legs: [], // [{cityId, cityName, days, startDate, stayId, anchorPlaceIds, extraPlaceIds, eventIds, trafficFactor}]
  });

  const [cityData, setCityData] = useState({}); // cityId → { places, stays, events, nearby:{[anchorId]:{places,dining}} }

  // ─────────────── load states + cities
  useEffect(() => {
    api.get("/cities/states/list").then((r) => setStates(r.data.length ? r.data : ["Tamil Nadu"]));
  }, []);
  useEffect(() => {
    if (!trip.state) return;
    api.get(`/cities?state=${encodeURIComponent(trip.state)}`).then((r) => setAllCities(r.data));
  }, [trip.state]);

  // ─────────────── helpers to mutate legs
  const upsertLeg = (cityId, patch) =>
    setTrip((t) => {
      const i = t.legs.findIndex((l) => l.cityId === cityId);
      const next = [...t.legs];
      if (i >= 0) next[i] = { ...next[i], ...patch };
      else next.push({
        cityId, cityName: allCities.find((c) => c._id === cityId)?.name,
        days: 2, startDate: t.startDate, stayId: "",
        anchorPlaceIds: [], extraPlaceIds: [], eventIds: [],
        trafficFactor: 1.2, ...patch,
      });
      return { ...t, legs: next };
    });
  const removeLeg = (cityId) =>
    setTrip((t) => ({ ...t, legs: t.legs.filter((l) => l.cityId !== cityId) }));

  // when legs change, prefetch place/stay/event lists for each
  useEffect(() => {
    trip.legs.forEach((leg) => {
      if (cityData[leg.cityId]) return;
      Promise.all([
        api.get(`/places?city=${leg.cityId}`),
        api.get(`/stays?city=${leg.cityId}`),
        api.get(`/events?city=${leg.cityId}`),
      ]).then(([pl, st, ev]) =>
        setCityData((d) => ({
          ...d, [leg.cityId]: { places: pl.data, stays: st.data, events: ev.data, nearby: {} },
        }))
      );
    });
  }, [trip.legs.map((l) => l.cityId).join(",")]);  // eslint-disable-line

  // fetch nearby for each anchor when step 5 is reached
  const loadNearby = async (cityId, anchorId) => {
    if (cityData[cityId]?.nearby?.[anchorId]) return;
    const { data } = await api.get(`/places/${anchorId}/nearby?radiusKm=8`);
    setCityData((d) => ({
      ...d,
      [cityId]: {
        ...d[cityId],
        nearby: { ...(d[cityId]?.nearby || {}), [anchorId]: data },
      },
    }));
  };

  // ─────────────── auto-roll start dates per leg
  const cascadeDates = (legs, anchor) => {
    let cur = anchor;
    return legs.map((l) => {
      const d = { ...l, startDate: cur };
      const next = new Date(cur);
      next.setDate(next.getDate() + (l.days || 1));
      cur = next.toISOString().slice(0, 10);
      return d;
    });
  };
  useEffect(() => {
    if (!trip.legs.length) return;
    const fixed = cascadeDates(trip.legs, trip.startDate);
    if (JSON.stringify(fixed) !== JSON.stringify(trip.legs)) {
      setTrip((t) => ({ ...t, legs: fixed }));
    }
  }, [trip.startDate, trip.legs.map((l) => l.days).join(",")]);  // eslint-disable-line

  // ─────────────── generate
  const generate = async () => {
    if (!trip.legs.length) return alert("Pick at least one city.");
    for (const l of trip.legs) {
      if (!l.stayId) return alert(`Pick accommodation for ${l.cityName || l.cityId}.`);
      if (!l.anchorPlaceIds.length) return alert(`Pick at least one place in ${l.cityName || l.cityId}.`);
    }
    setBusy(true);
    try {
      const { data: created } = await api.post("/trips", trip);
      await api.post(`/itinerary/${created._id}/generate`);
      nav(`/trip/${created._id}`);
    } catch (e) {
      alert(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // ─────────────── step UI
  const StepHeader = () => (
    <div className="flex gap-1.5 mt-4 mb-6">
      {[1,2,3,4,5,6,7].map((s) => (
        <div key={s}
          className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-teal" : "bg-navy/10"}`} />
      ))}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl">Plan a trip</h1>
      <p className="text-navy/60 text-sm mt-1">Step {step} of 7</p>
      <StepHeader />

      {step === 1 && (
        <Card>
          <h2 className="text-xl font-display">When & where</h2>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Field label="Trip name">
              <input className="ipt" value={trip.name}
                onChange={(e) => setTrip({ ...trip, name: e.target.value })} />
            </Field>
            <Field label="Home city">
              <input className="ipt" placeholder="e.g. Bengaluru"
                value={trip.homeCity}
                onChange={(e) => setTrip({ ...trip, homeCity: e.target.value })} />
            </Field>
            <Field label="Travellers">
              <input type="number" min={1} className="ipt" value={trip.travellers}
                onChange={(e) => setTrip({ ...trip, travellers: Number(e.target.value) })} />
            </Field>
            <Field label="Start date">
              <input type="date" className="ipt" value={trip.startDate}
                onChange={(e) => setTrip({ ...trip, startDate: e.target.value })} />
            </Field>
            <Field label="State to visit">
              <select className="ipt" value={trip.state}
                onChange={(e) => setTrip({ ...trip, state: e.target.value, legs: [] })}>
                {states.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <h2 className="text-xl font-display">Cities in {trip.state}</h2>
          <p className="text-sm text-navy/60 mt-1">Pick one or more. Set how many days for each.</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {allCities.map((c) => {
              const leg = trip.legs.find((l) => l.cityId === c._id);
              const on = !!leg;
              return (
                <div key={c._id} className={`p-4 rounded-xl border ${on ? "border-teal bg-teal/5" : "border-navy/10 bg-white"}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold flex items-center gap-1"><MapPin size={14}/> {c.name}</div>
                      <div className="text-xs text-navy/60 mt-1">{c.tagline}</div>
                    </div>
                    <button onClick={() => on ? removeLeg(c._id) : upsertLeg(c._id, {})}
                      className={`btn ${on ? "btn-ghost" : "btn-primary"} !py-1 !px-3 text-xs`}>
                      {on ? <X size={14}/> : <Plus size={14}/>} {on ? "Remove" : "Add"}
                    </button>
                  </div>
                  {on && (
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span>Days:</span>
                      <input type="number" min={1} max={10} value={leg.days}
                        onChange={(e) => upsertLeg(c._id, { days: Number(e.target.value) })}
                        className="w-16 ipt !py-1" />
                      <span className="text-navy/50 text-xs">starts {leg.startDate}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {step === 3 && (
        <SectionPerCity trip={trip} cityData={cityData} title="Accommodation"
          render={(leg, data) => (
            <div className="grid sm:grid-cols-2 gap-3">
              {(data?.stays || []).map((s) => (
                <button key={s._id} onClick={() => upsertLeg(leg.cityId, { stayId: s._id })}
                  className={`text-left p-3 rounded-lg border ${leg.stayId === s._id ? "border-teal ring-2 ring-teal bg-teal/5" : "border-navy/10 bg-white"}`}>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-navy/60">{s.type} · ★ {s.rating} · {s.priceRange}</div>
                </button>
              ))}
            </div>
          )}
        />
      )}

      {step === 4 && (
        <SectionPerCity trip={trip} cityData={cityData} title="Must-visit spots"
          render={(leg, data) => (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(data?.places || []).map((p) => {
                const on = leg.anchorPlaceIds.includes(p._id);
                return (
                  <button key={p._id}
                    onClick={() => upsertLeg(leg.cityId, {
                      anchorPlaceIds: on
                        ? leg.anchorPlaceIds.filter((x) => x !== p._id)
                        : [...leg.anchorPlaceIds, p._id],
                    })}
                    className={`text-left p-3 rounded-lg border text-sm ${on ? "border-teal ring-2 ring-teal bg-teal/5" : "border-navy/10 bg-white"}`}>
                    <div className="font-medium flex items-center gap-1">
                      {on && <Check size={14} className="text-teal"/>} {p.name}
                    </div>
                    <div className="text-[11px] text-navy/60 capitalize">{p.type}</div>
                  </button>
                );
              })}
            </div>
          )}
        />
      )}

      {step === 5 && (
        <SectionPerCity trip={trip} cityData={cityData}
          title="Nearby activities & restaurants"
          subtitle="Quick suggestions around each must-visit spot. Tap to add."
          onMount={(leg) => leg.anchorPlaceIds.forEach((id) => loadNearby(leg.cityId, id))}
          render={(leg, data) => (
            <div className="space-y-4">
              {leg.anchorPlaceIds.map((aid) => {
                const anchor = (data?.places || []).find((p) => p._id === aid);
                const nearby = data?.nearby?.[aid];
                if (!anchor) return null;
                return (
                  <div key={aid}>
                    <div className="text-sm font-semibold">Near {anchor.name}</div>
                    {!nearby ? (
                      <div className="text-xs text-navy/50 flex items-center gap-1 mt-1">
                        <Loader2 size={12} className="animate-spin"/> loading…
                      </div>
                    ) : (
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                        {[...(nearby.places || []), ...(nearby.dining || [])].slice(0, 9).map((x) => {
                          const on = leg.extraPlaceIds.includes(x._id);
                          const isDining = !!x.cuisine;
                          return (
                            <button key={x._id}
                              onClick={() => !isDining && upsertLeg(leg.cityId, {
                                extraPlaceIds: on
                                  ? leg.extraPlaceIds.filter((i) => i !== x._id)
                                  : [...leg.extraPlaceIds, x._id],
                              })}
                              className={`text-left p-2.5 rounded-lg border text-sm ${on ? "border-teal ring-2 ring-teal bg-teal/5" : "border-navy/10 bg-white"} ${isDining ? "opacity-80" : ""}`}>
                              <div className="font-medium">{x.name}</div>
                              <div className="text-[11px] text-navy/60">
                                {isDining ? `🍽 ${x.cuisine}` : `📍 ${x.type}`} · {x.distanceKm?.toFixed?.(1) || ""} km
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        />
      )}

      {step === 6 && (
        <SectionPerCity trip={trip} cityData={cityData}
          title="Live events on your dates"
          subtitle="Pick any you'd like the planner to slot into the day."
          render={(leg, data) => {
            const dates = Array.from({ length: leg.days }, (_, i) => {
              const d = new Date(leg.startDate); d.setDate(d.getDate() + i);
              return d.toISOString().slice(0, 10);
            });
            const matching = (data?.events || []).filter((e) => dates.includes(e.date));
            if (!matching.length) return <div className="text-sm text-navy/50">No live events found for {leg.cityName}.</div>;
            return (
              <div className="grid sm:grid-cols-2 gap-2">
                {matching.map((e) => {
                  const on = leg.eventIds.includes(e._id);
                  return (
                    <button key={e._id}
                      onClick={() => upsertLeg(leg.cityId, {
                        eventIds: on ? leg.eventIds.filter((i) => i !== e._id) : [...leg.eventIds, e._id],
                      })}
                      className={`text-left p-3 rounded-lg border ${on ? "border-teal ring-2 ring-teal bg-teal/5" : "border-navy/10 bg-white"}`}>
                      <div className="font-semibold">{e.name}</div>
                      <div className="text-xs text-navy/60">{e.date} {e.time && `· ${e.time}`} {e.venue && `· ${e.venue}`}</div>
                    </button>
                  );
                })}
              </div>
            );
          }}
        />
      )}

      {step === 7 && (
        <Card>
          <h2 className="text-xl font-display">Ready to optimise</h2>
          <p className="text-sm text-navy/60 mt-1">
            We'll run NSGA-II over (travel time, distance, crowd, weather, enjoyment),
            refine with 2-opt + Simulated Annealing, route every hop with A*, and
            return Plan A (balanced) and Plan B (crowd-averse).
          </p>
          <ul className="mt-4 text-sm space-y-1">
            {trip.legs.map((l) => (
              <li key={l.cityId} className="text-navy/80">
                · <b>{l.cityName}</b>: {l.days} day(s), {l.anchorPlaceIds.length} must-visits
                + {l.extraPlaceIds.length} extras + {l.eventIds.length} event(s)
              </li>
            ))}
          </ul>
          <button onClick={generate} disabled={busy} className="btn btn-primary mt-6">
            {busy ? <><Loader2 size={16} className="animate-spin"/> Generating…</> : "Generate Plan A & B"}
          </button>
        </Card>
      )}

      <div className="flex justify-between mt-6">
        <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}
          className="btn btn-ghost">Back</button>
        {step < 7 && (
          <button onClick={() => setStep((s) => s + 1)}
            disabled={step === 1 ? !trip.state : step === 2 ? !trip.legs.length : false}
            className="btn btn-primary">Next</button>
        )}
      </div>
    </div>
  );
}

function Card({ children }) {
  return <div className="card p-6">{children}</div>;
}
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function SectionPerCity({ trip, cityData, title, subtitle, render, onMount }) {
  useEffect(() => {
    if (!onMount) return;
    trip.legs.forEach((leg) => onMount(leg));
  }, [trip.legs.length]);  // eslint-disable-line
  return (
    <Card>
      <h2 className="text-xl font-display">{title}</h2>
      {subtitle && <p className="text-sm text-navy/60 mt-1">{subtitle}</p>}
      <div className="mt-4 space-y-6">
        {trip.legs.map((leg) => (
          <div key={leg.cityId}>
            <div className="text-sm font-semibold text-teal-dark mb-2">{leg.cityName}</div>
            {render(leg, cityData[leg.cityId])}
          </div>
        ))}
      </div>
    </Card>
  );
}
