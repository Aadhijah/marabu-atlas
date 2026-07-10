import axios from "axios";

const cityToGeo = {
  chennai: { lat: 13.0827, lng: 80.2707 },
  coimbatore: { lat: 11.0168, lng: 76.9558 },
  madurai: { lat: 9.9252, lng: 78.1198 },
  ooty: { lat: 11.4064, lng: 76.6932 },
};

export async function fetchLiveEvents(cityId) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key || !cityToGeo[cityId]) return [];
  const { lat, lng } = cityToGeo[cityId];
  try {
    const { data } = await axios.get(
      "https://app.ticketmaster.com/discovery/v2/events.json",
      {
        params: {
          apikey: key,
          latlong: `${lat},${lng}`,
          radius: 50,
          unit: "km",
          size: 20,
          sort: "date,asc",
        },
        timeout: 5000,
      }
    );
    return (data._embedded?.events || []).map((e) => ({
      _id: `tm-${e.id}`,
      name: e.name,
      city: cityId,
      type: e.classifications?.[0]?.segment?.name?.toLowerCase() || "event",
      description: e.info || e.description || "",
      date: e.dates?.start?.localDate,
      time: e.dates?.start?.localTime,
      venue: e._embedded?.venues?.[0]?.name,
      priceRange: e.priceRanges
        ? `₹${e.priceRanges[0].min} - ₹${e.priceRanges[0].max}`
        : "TBA",
      bookingUrl: e.url,
    }));
  } catch (err) {
    console.warn("Ticketmaster failed:", err.message);
    return [];
  }
}
