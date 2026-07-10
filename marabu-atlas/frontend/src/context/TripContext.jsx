import { createContext, useContext, useEffect, useState } from "react";

const TripContext = createContext(null);

export function TripProvider({ children }) {
  const [cityId, setCityId] = useState(() => localStorage.getItem("city") || null);

  useEffect(() => {
    if (cityId) localStorage.setItem("city", cityId);
  }, [cityId]);

  return (
    <TripContext.Provider value={{ cityId, setCityId }}>
      {children}
    </TripContext.Provider>
  );
}

export const useTrip = () => useContext(TripContext);
