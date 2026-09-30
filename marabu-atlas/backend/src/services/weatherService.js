import axios from "axios";

const KEY = () => process.env.OPENWEATHER_API_KEY;

export async function getCurrentWeather(lat, lng) {
  if (!KEY()) return mockWeather();
  try {
    const { data } = await axios.get("https://api.openweathermap.org/data/2.5/weather", {
      params: { lat, lon: lng, units: "metric", appid: KEY() },
      timeout: 4000,
    });
    return {
      temp: Math.round(data.main.temp),
      condition: data.weather[0].main,
      description: data.weather[0].description,
      icon: data.weather[0].icon,
      humidity: data.main.humidity,
      wind: data.wind.speed,
    };
  } catch {
    return mockWeather();
  }
}
// 5-day forecast (3-hour intervals)
export async function getForecast(lat, lng) {
  if (!KEY()) return { daily: Array.from({ length: 5 }, mockWeather) };
  try {
    const { data } = await axios.get("https://api.openweathermap.org/data/2.5/forecast", {
      params: { lat, lon: lng, units: "metric", appid: KEY() },
      timeout: 5000,
    });
    // collapse 3-hour entries → daily
    const byDay = new Map();
    for (const item of data.list) {
      const d = item.dt_txt.slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(item);
    }
    const daily = [...byDay.entries()].slice(0, 5).map(([date, items]) => {
      const noon = items.find((i) => i.dt_txt.includes("12:00:00")) || items[0];
      return {
        date,
        temp: Math.round(noon.main.temp),
        condition: noon.weather[0].main,
        description: noon.weather[0].description,
        rainProb: Math.max(...items.map((i) => i.pop || 0)),
      };
    });
    return { daily };
  } catch {
    return { daily: Array.from({ length: 5 }, mockWeather) };
  }
}

function mockWeather() {
  return { temp: 30, condition: "Clouds", description: "scattered clouds", rainProb: 0.1 };
}
