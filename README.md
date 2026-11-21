# Mind the Map

A phone map for playing Jet Lag-style hide and seek in London Zone 1.

It shows every Zone 1 tube station with its 500 m hiding zone, and gives seekers tools to rule areas out:

- **Radar**: "are you within X of me?" from your GPS position or any point
- **Thermometer**: hotter or colder after moving from A to B
- **Draw**: outline any area and say whether the hider is inside or outside it (for matching, measuring, photos and so on)
- **Stations**: rule individual stations out by hand

Everything ruled out is shaded grey, the header counts the stations left, and every answer can be switched off, deleted or undone. Answers are saved in the browser, and a game code lets teammates share the same map.

Live at **https://mindthemap.wharton.dev/** (served over HTTPS, which phones need before they share GPS).

## How it works

A single static `index.html`, no build step. Leaflet and polygon-clipping load from jsDelivr with pinned versions and integrity hashes. Station and line data load at startup from Oliver O'Brien's compilation of TfL open data, pinned to one commit, with the Northern line extension zones corrected.

Street map © OpenStreetMap contributors.
