# Cowell's Low Tides

Tide predictions for Cowell's Beach in Santa Cruz, using data from [NOAA Tides & Currents](https://tidesandcurrents.noaa.gov/) (station 9413745).

Live site: https://starmer.github.io/cowells_low_tides/

- **Full year**: every high and low tide for a year, with a daily tide curve and a year-at-a-glance strip that highlights minus tides.
- **Next 25 days**: daytime low tides under 1 foot.

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
