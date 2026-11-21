#!/usr/bin/env bash
# Fetch raw OSM data per category from Overpass into $1 (raw dir). Skips categories already fetched.
# Needs bash 4+ (associative arrays). Public Overpass servers are often busy, so it retries across mirrors.
OUT="$1"; mkdir -p "$OUT"
B1="51.433,-0.283,51.587,0.063"    # play area + ~3 km
B2="51.352,-0.413,51.668,0.193"    # play area + ~12 km (golf)
B3="51.235,-0.600,51.785,0.380"    # play area + ~25 km (zoo, aquarium, theme park)
declare -A Q
Q[museum]="nwr[\"tourism\"=\"museum\"]($B1);out center tags;"
Q[library]="nwr[\"amenity\"=\"library\"]($B1);out center tags;"
Q[cinema]="nwr[\"amenity\"=\"cinema\"]($B1);out center tags;"
Q[hospital]="nwr[\"amenity\"=\"hospital\"]($B1);out center tags;"
Q[consulate]="(nwr[\"office\"=\"diplomatic\"]($B1);nwr[\"amenity\"=\"embassy\"]($B1););out center tags;"
Q[aquarium]="nwr[\"tourism\"=\"aquarium\"]($B3);out center tags;"
# Parks: anything people (and Google Maps) call a park. build.js decides which gardens, rec grounds and reserves count.
Q[park]="(nwr[\"leisure\"~\"^(park|garden|common|nature_reserve)\$\"][\"name\"]($B1);nwr[\"landuse\"=\"recreation_ground\"][\"name\"]($B1););out geom;"
Q[golf]="nwr[\"leisure\"=\"golf_course\"]($B2);out geom;"
Q[zoo]="nwr[\"tourism\"=\"zoo\"]($B3);out geom;"
Q[theme]="nwr[\"tourism\"=\"theme_park\"]($B3);out geom;"
Q[gallery]="nwr[\"tourism\"=\"gallery\"]($B1);out center tags;"   # only a named list of public galleries is used
EPS=(https://overpass-api.de/api/interpreter https://overpass.private.coffee/api/interpreter https://maps.mail.ru/osm/tools/overpass/api/interpreter)
for k in "${!Q[@]}"; do
  [ -s "$OUT/$k.json" ] && grep -q '"elements"' "$OUT/$k.json" && { echo "$k cached"; continue; }
  for try in 1 2 3; do
    for ep in "${EPS[@]}"; do
      curl -s -m 150 -A "mind-the-map-data-build/1.0" --data-urlencode "data=[out:json][timeout:120];${Q[$k]}" "$ep" -o "$OUT/$k.tmp"
      if grep -q '"elements"' "$OUT/$k.tmp" 2>/dev/null && ! grep -q '"remark"' "$OUT/$k.tmp"; then mv "$OUT/$k.tmp" "$OUT/$k.json"; echo "$k ok from $ep ($(wc -c < "$OUT/$k.json") bytes)"; break 2; fi
      echo "$k failed at $ep: $(head -c 120 "$OUT/$k.tmp" 2>/dev/null | tr '\n' ' ')"
    done
    sleep $((try * 20))
  done
done
