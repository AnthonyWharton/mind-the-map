# Mind the Map

A phone map for playing Jet Lag-style hide and seek in London Zone 1.

It shows every Zone 1 tube station with its hiding zone, and gives seekers tools to rule areas out:

- **Radar**: "are you within X of me?" from your GPS position or any point
- **Thermometer**: hotter or colder after moving from A to B, with progress against the official distances
- **Match**: "is your nearest ___ the same as mine?" for transit line, station name length, river side (north/south), borough and ward
- **Measure**: "are you closer to or further from ___ than me?" for the Thames (optionally lakes, canals and docks), rail stations, and the river and borough borders
- **Draw**: outline any area and say whether the hider is inside or outside it (for photos and anything else)
- **Stations**: rule individual stations out by hand, and open any station in Google Maps
- **Game**: game size, hiding zone radius (official ¼ or ½ mile, or 500 m), a hiding timer and the question costs

Everything ruled out is shaded grey, the header counts the stations left, and every answer can be switched off, deleted or undone. Answers are saved in the browser, and a game code lets teammates share the same map.

Live at **https://mindthemap.wharton.dev/** (served over HTTPS, which phones need before they share GPS).

## How it works

A single static `index.html`, no build step. Leaflet and polygon-clipping load from jsDelivr with pinned versions and integrity hashes. Station and line data load at startup from Oliver O'Brien's compilation of TfL open data, pinned to one commit, with the Northern line extension zones corrected. Station pins and hiding-zone centres use coordinates and Place IDs from a supplied Google Places listing (`scripts/fetch-station-coordinates.mjs` rebuilds it with a `GOOGLE_PLACES_API_KEY`).

Data for the newer questions is pre-built into `data/`:

- `admin-divisions.json`: wards and boroughs from the ONS Open Geography Portal (Open Government Licence)
- `measure-thames-water.json`, `measure-station-rail.json`: water and rail stations from OpenStreetMap (ODbL)
- `match-name-stations.json`: Zone 2 stations near Zone 1, from the same TfL data

Street map © OpenStreetMap contributors. Boundaries contain National Statistics and OS data © Crown copyright and database right.
