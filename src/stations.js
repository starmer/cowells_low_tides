// NOAA CO-OPS tide prediction stations. Add entries here to grow the spot picker.
//
// Swell: each break uses the nearest CDIP MOP model point (15m depth, so
// 0.5–2 km offshore of the break itself), and they all share the Monterey
// Canyon Outer buoy (CDIP 156 / NDBC 46236). Points were matched to breaks
// from coordinates; a few MOP points nearby share duplicate coordinates
// (SC136–147, SC155–157, SC266–269), so those are avoided.
export const stations = [
  {
    id: "9413745",
    spot: "Santa Cruz",
    name: "Santa Cruz, Monterey Bay",
    lat: 36.9633,
    lon: -122.0218,
    cdipBuoy: "156",
    cdipBuoyName: "Monterey Canyon",
    breaks: [
      { id: "cowells", name: "Cowell's", mopPoint: "SC149" },
      { id: "steamer-lane", name: "Steamer Lane", mopPoint: "SC150" },
      { id: "indicators", name: "Indicators", mopPoint: "SC151" },
      { id: "mitchells", name: "Mitchell's Cove", mopPoint: "SC159" },
      { id: "pleasure-point", name: "Pleasure Point", mopPoint: "SC117" },
      { id: "the-hook", name: "The Hook", mopPoint: "SC116" },
      { id: "davenport-landing", name: "Davenport Landing", mopPoint: "SC271" },
    ],
  },
];

export const defaultStation = stations[0];
