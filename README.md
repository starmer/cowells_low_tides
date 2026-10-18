# Santa Cruz tides

Tides, water temperature and swell for Santa Cruz surf spots.

Live site: https://starmer.github.io/cowells_low_tides/

- **Tides:** every high and low for a year from [NOAA Tides & Currents](https://tidesandcurrents.noaa.gov/) station 9413745, with a daily tide curve and a year strip that highlights minus tides.
- **Water temperature:** NOAA Monterey station 9413450.
- **Swell:** offshore swell components from NOAA GFS-Wave via [Open-Meteo](https://open-meteo.com/), modeled nearshore waves per break from [CDIP](https://cdip.ucsd.edu/) MOP, and the Monterey Canyon buoy (CDIP 156).
- **Best times:** hourly ratings per break from tide, wave size, swell direction and wind. Each break's preferences are in `src/surfRating.js`.

See `swell-plan.md` for data sources and the todo list.

## Development

Requires Node 24 (see `.node-version`).

```sh
npm install
npm start          # http://localhost:3000
```

## Deploy

```sh
npm run deploy     # builds and publishes to the gh-pages branch
```
