// NOAA CO-OPS tide prediction stations. Add entries here to grow the spot picker.
export const stations = [
  { id: "9413745", spot: "Santa Cruz", name: "Santa Cruz, Monterey Bay", lat: 36.9633, lon: -122.0218,
    // Swell: CDIP MOP model point just inside Lighthouse Point, and the
    // Monterey Canyon Outer buoy (CDIP 156 / NDBC 46236).
    swellSpot: "Cowell's", mopPoint: "SC149", cdipBuoy: "156", cdipBuoyName: "Monterey Canyon" },
];

export const defaultStation = stations[0];
