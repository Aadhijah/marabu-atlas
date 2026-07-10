import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home.jsx";
import CityPage from "./pages/CityPage.jsx";
import TripBuilder from "./pages/TripBuilder.jsx";
import TripView from "./pages/TripView.jsx";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-navy/10 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-display text-xl text-teal-dark">
            Marabu Atlas
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/" className="hover:text-teal">Cities</Link>
            <Link to="/trip/new" className="hover:text-teal">Plan a Trip</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/city/:cityId" element={<CityPage />} />
          <Route path="/trip/new" element={<TripBuilder />} />
          <Route path="/trip/:tripId" element={<TripView />} />
        </Routes>
      </main>
      <footer className="border-t border-navy/10 py-6 text-center text-sm text-navy/60">
        Marabu Atlas · MERN + Python ML
      </footer>
    </div>
  );
}
