// NOAA CO-OPS tide prediction stations. Add entries here to grow the spot picker.
//
// Swell: each break uses the nearest CDIP MOP model point (15m depth, so
// 0.5–2 km offshore of the break itself), and they all share the Monterey
// Canyon Outer buoy (CDIP 156 / NDBC 46236). Points were matched to breaks
// from coordinates; a few MOP points nearby share duplicate coordinates
// (SC136–147, SC155–157, SC266–269), so those are avoided. lat/lon is the
// break itself (approximate), used for the wind forecast.
export const stations = [
  {
    id: "9413745",
    spot: "Santa Cruz",
    name: "Santa Cruz, Monterey Bay",
    lat: 36.9633,
    lon: -122.0218,
    cdipBuoy: "156",
    cdipBuoyName: "Monterey Canyon",
    // Offshore buoy 27 nm out, via the GitHub Action (see swell-plan.md).
    ndbcBuoy: "46042",
    ndbcBuoyName: "Monterey offshore",
    breaks: [
      { id: "cowells", name: "Cowell's", mopPoint: "SC149", lat: 36.962, lon: -122.023 },
      { id: "steamer-lane", name: "Steamer Lane", mopPoint: "SC150", lat: 36.951, lon: -122.026 },
      { id: "indicators", name: "Indicators", mopPoint: "SC151", lat: 36.951, lon: -122.029 },
      { id: "pleasure-point", name: "Pleasure Point", mopPoint: "SC117", lat: 36.955, lon: -121.97 },
      { id: "davenport-landing", name: "Davenport Landing", mopPoint: "SC271", lat: 37.024, lon: -122.218 },
    ],
  },
];

export const defaultStation = stations[0];
