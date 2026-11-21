# Mind the Map

A phone map for playing Jet Lag-style hide and seek in London Zone 1, as a small game measured in kilometres.

It shows every Zone 1 tube station with its 500 m hiding zone, and gives seekers tools to rule areas out:

- **Radar**: "are you within X of me?" (0.5, 1, 2, 5, 10, 15, 40, 80 or 160 km, or any distance) from your GPS position or any point
- **Thermometer**: hotter or colder after moving from A to B, with progress towards 1 km and 5 km
- **Match**: "is your nearest ___ the same as mine?" for Tube line, station name length, river side (north/south), borough, ward, and parks, zoos, museums, cinemas, hospitals, libraries and consulates
- **Measure**: "are you closer to or further from ___ than me?" for the Thames (optionally lakes, canals and docks), National Rail stations (or all rail or Tube stations), the river and borough borders, and the same places
- **Draw**: outline any area and say whether the hider is inside or outside it (for photos and anything else)
- **Stations**: rule individual stations out by hand, and open any station in Google Maps

The questions follow the group's question sheet (no airports, mountains, coastlines, golf courses, aquariums or amusement parks). Everything ruled out is shaded grey, the header counts the stations left, and every answer can be switched off, deleted or undone. Answers are saved in the browser, and a game code lets teammates share the same map.

Live at **https://mindthemap.wharton.dev/** (served over HTTPS, which phones need before they share GPS).

## How it works

A single static `index.html`, no build step. Leaflet and polygon-clipping load from jsDelivr with pinned versions and integrity hashes. Station and line data load at startup from Oliver O'Brien's compilation of TfL open data, pinned to one commit, with the Northern line extension zones corrected. Station pins and hiding-zone centres use coordinates and Place IDs from a supplied Google Places listing (`scripts/fetch-station-coordinates.mjs` rebuilds it with a `GOOGLE_PLACES_API_KEY`).

Data for the newer questions is pre-built into `data/`:

- `admin-divisions.json`: wards and boroughs from the ONS Open Geography Portal (Open Government Licence)
- `measure-thames-water.json`, `measure-station-rail.json`, `poi-places.json`: water, rail stations and places from OpenStreetMap (ODbL); `poi-build/` rebuilds the places
- `match-name-stations.json`: Zone 2 stations near Zone 1, from the same TfL data

The layers menu (top right) sets station names to Auto (shown once zoomed in), On or Off, and shows a key to the Tube line colours. Map credits sit behind the small "© OSM" tag in the corner.

Street map © OpenStreetMap contributors. Boundaries contain National Statistics and OS data © Crown copyright and database right.
