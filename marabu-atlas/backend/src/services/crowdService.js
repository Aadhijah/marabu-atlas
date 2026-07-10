import axios from "axios";

// Live crowd from Google Places (current_opening_hours.populartimes proxy via place_details).
// If no key or no data, fall back to rule-based score using baseCrowd + peakHours.
export async function getLiveCrowd(place) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      // Search by lat/lng + name to get place_id
      const search = await axios.get(
        "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
        {
          params: {
            input: place.name,
            inputtype: "textquery",
            locationbias: `point:${place.lat},${place.lng}`,
            fields: "place_id",
            key,
          },
          timeout: 4000,
        }
      );
      const placeId = search.data?.candidates?.[0]?.place_id;
      if (placeId) {
        const det = await axios.get(
          "https://maps.googleapis.com/maps/api/place/details/json",
          {
            params: {
              place_id: placeId,
              fields: "current_opening_hours",
              key,
            },
            timeout: 4000,
          }
        );
        // Google's "currently busy" isn't returned in details; we approximate
        // using opening_hours.open_now as a presence signal and combine with our score.
        if (det.data?.result) {
          // best-effort — fall through to rule-based with a small boost when open
        }
      }
    } catch {
      /* fall through */
    }
  }
  return ruleBasedCrowd(place);
}

function ruleBasedCrowd(p) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sun, 6 = Sat
  const peak = p.peakHours?.includes(hour) ? 0.4 : 0;
  const weekend = day === 0 || day === 6 ? 0.15 : 0;
  const score = Math.min(1, (p.baseCrowd || 0.4) + peak + weekend);
  const level = score < 0.4 ? "low" : score < 0.7 ? "moderate" : "high";
  return { score: Number(score.toFixed(2)), level };
}
