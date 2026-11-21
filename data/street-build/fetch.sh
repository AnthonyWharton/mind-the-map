#!/usr/bin/env bash
# Fetch every named highway=* way (and named highway relations, e.g. pedestrian squares) around the hiding zones
# from Overpass into $1/streets.json. build.js does all the filtering. Skips the download if it's already there.
# Box: the 67 Zone 1 station pins in index.html (lat 51.4798–51.5322, lon −0.1963 to −0.0710) plus ~1 km.
OUT="$1"; mkdir -p "$OUT"
BOX="51.4708,-0.2109,51.5413,-0.0564"
Q="[out:json][timeout:300];way[\"highway\"][\"name\"]($BOX);out tags geom;relation[\"highway\"][\"name\"]($BOX);out body geom;"
EPS=(https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter)
[ -s "$OUT/streets.json" ] && grep -q '"elements"' "$OUT/streets.json" && { echo "streets cached"; exit 0; }
for try in 1 2 3; do
  for ep in "${EPS[@]}"; do
    curl -s -m 360 -A "mind-the-map-data-build/1.0" --data-urlencode "data=$Q" "$ep" -o "$OUT/streets.tmp"
    if grep -q '"elements"' "$OUT/streets.tmp" 2>/dev/null && ! grep -q '"remark"' "$OUT/streets.tmp"; then
      mv "$OUT/streets.tmp" "$OUT/streets.json"; echo "streets ok from $ep ($(wc -c < "$OUT/streets.json") bytes)"; exit 0
    fi
    echo "failed at $ep: $(head -c 160 "$OUT/streets.tmp" 2>/dev/null | tr '\n' ' ')"
  done
  sleep $((try * 20))
done
exit 1
