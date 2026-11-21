// Bakes data/match-streets.json (named streets and paths) from the raw Overpass response saved by fetch.sh.
// usage: bash fetch.sh <rawdir> && node build.js <rawdir> data/match-streets.json
// Writes <out>.report.json with what was dropped and why, and the most repeated names (not committed).
//
// Inclusion rule (what a player standing somewhere would call their nearest street or path):
//  - highway = motorway/trunk/primary/secondary/tertiary (and their _links), unclassified, residential,
//    living_street, pedestrian, service, road, busway, footway, path, cycleway, steps, bridleway or track, with a name;
//  - not tunnel=yes (or culvert), not indoor=*, not location=underground/indoor, not part of a building
//    (building / building:part tags, e.g. the British Museum's Great Court), not a platform, not a disused or
//    abandoned railway; not service=parking_aisle/parking/drive-through/garages/loading. (level=-1 alone is kept:
//    it's used for outdoor sunken streets such as Electric Boulevard at Battersea);
//  - tunnel=building_passage (a street running under a building) and covered=yes (arcades, markets) are kept,
//    since you'd be standing in them outdoors-ish and they carry street signs;
//  - named sidewalks and crossings (footway=sidewalk/crossing/traffic_island) are dropped when a road of the same name is within
//    40 m: they're the same street, and nearest is measured to the centreline;
//  - pedestrian/footway areas (area=yes ways and multipolygon relations, e.g. Covent Garden Piazza) are kept as
//    areas: distance 0 inside, their outline otherwise.
// Only parts within COVER m of a station pin (hiding zone 500 m + 400 m margin) are kept.
// Grouping: same normalised name, and pieces within MERGE m of each other (chained), form one street.
// Coverage check: the build fails unless every point of every hiding zone (10 m grid) has a named street within
// MARGIN − 50 m; the farthest such distance is stored as dmax (the app uses it to bound its search).
// Format: { _src, cover, dmax, s: [[name, lines, areas?], ...] } where lines and areas are lists of delta-coded integer
// polylines in 1e-5 degrees: [lat0, lon0, dLat1, dLon1, ...]. Area rings leave out the closing point; a street's
// area rings are combined even-odd (so an inner ring is a hole).
const fs = require("fs"), path = require("path");
const RAW = process.argv[2], OUT = process.argv[3];
const ER = 6371008.8, LAT0 = 51.507, LON0 = -0.12, KX = Math.cos(LAT0 * Math.PI / 180);
const proj = (lat, lon) => [(lon - LON0) * Math.PI / 180 * ER * KX, (lat - LAT0) * Math.PI / 180 * ER];
const unproj = (x, y) => [y / ER * 180 / Math.PI + LAT0, x / (ER * KX) * 180 / Math.PI + LON0];
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const ZONE = 500, MARGIN = 400, COVER = ZONE + MARGIN, MERGE = 200, SIMP = 2, SIDEWALK = 40;

// Station pins, straight from index.html (the hiding-zone centres).
const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
const pins = [...html.matchAll(/^ {4}"([^"]+)": \{"lat": ([\d.-]+), "lon": ([\d.-]+)/gm)].map((m) => ({ n: m[1], xy: proj(+m[2], +m[3]) }));
if (pins.length < 60) throw new Error("station pins not found in index.html");
const nearPin = (x, y) => { let d = Infinity; for (const p of pins) { const v = Math.hypot(x - p.xy[0], y - p.xy[1]); if (v < d) d = v; } return d; };
const segNearPin = (a, b) => pins.some((p) => segDist(p.xy[0], p.xy[1], a[0], a[1], b[0], b[1]) <= COVER);

const raw = JSON.parse(fs.readFileSync(path.join(RAW, "streets.json"), "utf8"));
const KEEP = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
  "unclassified", "residential", "living_street", "pedestrian", "service", "road", "busway", "footway", "path", "cycleway", "steps", "bridleway", "track"]);
const AREA_HW = new Set(["pedestrian", "footway", "path", "living_street"]);
const dropped = {}, drop = (why, t) => { (dropped[why] = dropped[why] || []).push(t.name); return null; };
function why(t) {
  if (!KEEP.has(t.highway)) return `highway=${t.highway}`;
  if (["yes", "culvert", "flooded"].includes(t.tunnel)) return "tunnel";
  if (t.indoor && t.indoor !== "no") return "indoor";
  if (["underground", "indoor"].includes(t.location)) return "underground";
  if (/\bplatforms?\b/i.test(t.name)) return "platform";
  if ((t.building && t.building !== "no") || t["building:part"]) return "part of a building";
  if (t.public_transport === "platform" || t.railway === "platform") return "platform";
  if (["disused", "abandoned"].includes(t.railway)) return "disused railway";
  if (["parking_aisle", "parking", "drive-through", "garages", "loading"].includes(t.service)) return `service=${t.service}`;
  return null;
}
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’'`.,]/g, "").replace(/&/g, " and ").replace(/\s+/g, " ").trim();
const ptsOf = (geom) => geom.map((q) => proj(q.lat, q.lon));
const closed = (g) => g.length >= 4 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

// Join member ways into closed rings (for multipolygon relations).
function assemble(ways) {
  const segs = ways.map((w) => w.slice()), rings = [];
  const key = (p) => p.lat.toFixed(7) + "," + p.lon.toFixed(7);
  while (segs.length) {
    let cur = segs.shift();
    for (let guard = 0; key(cur[0]) !== key(cur[cur.length - 1]) && guard < 10000; guard++) {
      const end = key(cur[cur.length - 1]);
      const i = segs.findIndex((s) => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (i < 0) break;
      const s = segs.splice(i, 1)[0];
      cur = cur.concat((key(s[0]) === end ? s : s.slice().reverse()).slice(1));
    }
    if (key(cur[0]) === key(cur[cur.length - 1]) && cur.length >= 4) rings.push(cur);
  }
  return rings;
}

// 1. Filter, and split lines into the runs of segments within COVER of a station.
const pieces = []; // { name, key, kind: "line" | "area", pts, side }
let nWays = 0;
for (const e of raw.elements) {
  const t = e.tags || {}, name = (t.name || "").trim();
  if (!name) continue;
  const w = why(t); if (w) { drop(w, t); continue; }
  nWays++;
  const side = t.highway === "footway" && ["sidewalk", "crossing", "traffic_island"].includes(t.footway);
  if (e.type === "relation") {
    if (t.type !== "multipolygon" || !AREA_HW.has(t.highway)) { drop(`relation type=${t.type} highway=${t.highway}`, t); continue; }
    const outer = assemble(e.members.filter((m) => m.type === "way" && m.geometry).map((m) => m.geometry));
    if (!outer.length) { drop("relation without closed rings", t); continue; }
    const rings = outer.map(ptsOf).filter((r) => r.some((p, i) => i && segNearPin(r[i - 1], p)));
    if (rings.length) pieces.push({ name, kind: "area", rings });
    continue;
  }
  if (!e.geometry || e.geometry.length < 2) continue;
  if (t.area === "yes" && closed(e.geometry)) {
    if (!AREA_HW.has(t.highway)) { drop(`area highway=${t.highway}`, t); continue; }
    const r = ptsOf(e.geometry);
    if (r.some((p, i) => i && segNearPin(r[i - 1], p))) pieces.push({ name, kind: "area", rings: [r] });
    continue;
  }
  const p = ptsOf(e.geometry);
  let run = null;
  for (let i = 1; i < p.length; i++) {
    if (segNearPin(p[i - 1], p[i])) { if (!run) { run = [p[i - 1]]; pieces.push({ name, kind: "line", pts: run, side }); } run.push(p[i]); }
    else run = null;
  }
}
pieces.forEach((p) => { p.key = norm(p.name); });

// 2. Sidewalks and crossings named after a road within SIDEWALK m are that road: drop them.
const byKey = new Map();
for (const p of pieces) { if (!byKey.has(p.key)) byKey.set(p.key, []); byKey.get(p.key).push(p); }
const lineDist = (a, b) => { // min distance between two polylines (vertex-to-segment both ways; fine for the thresholds used)
  let d = Infinity;
  for (const [P, Q] of [[a, b], [b, a]]) for (const [x, y] of P) for (let i = 1; i < Q.length; i++) { const v = segDist(x, y, Q[i - 1][0], Q[i - 1][1], Q[i][0], Q[i][1]); if (v < d) d = v; }
  return d;
};
const partsOf = (p) => (p.kind === "line" ? [p.pts] : p.rings);
const bb = (p) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of partsOf(p)) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
pieces.forEach((p) => { p.bb = bb(p); });
const bbNear = (a, b, r) => a[0] - r <= b[2] && b[0] - r <= a[2] && a[1] - r <= b[3] && b[1] - r <= a[3];
const pieceDist = (a, b) => { let d = Infinity; for (const r of partsOf(a)) for (const s of partsOf(b)) d = Math.min(d, lineDist(r, s)); return d; };
let sideDropped = 0;
for (const [k, list] of byKey) {
  const roads = list.filter((p) => !p.side);
  const keep = list.filter((p) => !p.side || !roads.some((r) => bbNear(p.bb, r.bb, SIDEWALK) && pieceDist(p, r) <= SIDEWALK));
  sideDropped += list.length - keep.length;
  byKey.set(k, keep);
}

// 3. Group: union pieces of the same name that are within MERGE m of each other.
const groups = [];
for (const [k, list] of byKey) {
  const par = list.map((_, i) => i), find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (find(i) === find(j) || !bbNear(list[i].bb, list[j].bb, MERGE)) continue;
    if (pieceDist(list[i], list[j]) <= MERGE) par[find(i)] = find(j);
  }
  const by = new Map();
  list.forEach((p, i) => { const r = find(i); if (!by.has(r)) by.set(r, []); by.get(r).push(p); });
  for (const ps of by.values()) {
    const names = {}; ps.forEach((p) => { names[p.name] = (names[p.name] || 0) + 1; });
    const name = Object.entries(names).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    groups.push({ key: k, name, lines: ps.filter((p) => p.kind === "line").map((p) => p.pts), areas: ps.filter((p) => p.kind === "area").flatMap((p) => p.rings) });
  }
}

// 4. Chain lines that meet end to end (fewer, longer polylines), then simplify.
function chain(lines) {
  const k = (p) => p[0].toFixed(2) + "," + p[1].toFixed(2), out = [], rest = lines.map((l) => l.slice());
  while (rest.length) {
    let cur = rest.shift(), grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const s = rest[i], a = k(cur[0]), b = k(cur[cur.length - 1]), c = k(s[0]), d = k(s[s.length - 1]);
        if (b === c) cur = cur.concat(s.slice(1)); else if (b === d) cur = cur.concat(s.slice().reverse().slice(1));
        else if (a === d) cur = s.concat(cur.slice(1)); else if (a === c) cur = s.slice().reverse().concat(cur.slice(1));
        else continue;
        rest.splice(i, 1); grew = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}
function dp(pts, tol) { // Douglas–Peucker on an open polyline
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const simpRing = (r, tol) => { // closed ring (first == last) in; split at the farthest vertex so DP has two anchors
  let far = 0, fd = -1; r.forEach((p, i) => { const d = Math.hypot(p[0] - r[0][0], p[1] - r[0][1]); if (d > fd) { fd = d; far = i; } });
  const out = dp(r.slice(0, far + 1), tol).concat(dp(r.slice(far), tol).slice(1));
  return out.length >= 4 ? out : null;
};
const enc = (pts) => { const out = []; let pa = 0, pb = 0; for (const [x, y] of pts) { const [la, lo] = unproj(x, y), a = Math.round(la * 1e5), b = Math.round(lo * 1e5); out.push(a - pa, b - pb); pa = a; pb = b; } return out; };
const dec = (arr) => { const out = []; let a = 0, b = 0; for (let i = 0; i + 1 < arr.length; i += 2) { a += arr[i]; b += arr[i + 1]; out.push(proj(a / 1e5, b / 1e5)); } return out; };
for (const g of groups) {
  g.lines = chain(g.lines).map((l) => dp(l, SIMP)).map((l) => l.filter((p, i) => !i || Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) > 0.01));
  g.areas = g.areas.map((r) => simpRing(r, SIMP)).filter(Boolean);
  g.enc = [g.name, g.lines.map(enc)];
  if (g.areas.length) g.enc.push(g.areas.map((r) => enc(r.slice(0, -1))));
}
groups.sort((a, b) => a.name.localeCompare(b.name) || a.lines[0]?.[0]?.[0] - b.lines[0]?.[0]?.[0]);

// 5. Check coverage: every point of every hiding zone must have a street well within the margin.
const segs = [];
for (const g of groups) {
  for (const l of g.enc[1].map(dec)) for (let i = 1; i < l.length; i++) segs.push([...l[i - 1], ...l[i]]);
  for (const r of (g.enc[2] || []).map(dec)) for (let i = 0; i < r.length; i++) segs.push([...r[i], ...r[(i + 1) % r.length]]);
}
const B = 100, grid = new Map(), gk = (i, j) => i * 100000 + j;
segs.forEach((s, n) => { for (let i = Math.floor(Math.min(s[0], s[2]) / B); i <= Math.floor(Math.max(s[0], s[2]) / B); i++) for (let j = Math.floor(Math.min(s[1], s[3]) / B); j <= Math.floor(Math.max(s[1], s[3]) / B); j++) { const k = gk(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); } });
const nearestSeg = (x, y) => { const ci = Math.floor(x / B), cj = Math.floor(y / B); let d = Infinity; for (let r = 0; r < 6 && d > (r - 1) * B; r++) for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) { if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; for (const n of grid.get(gk(i, j)) || []) { const s = segs[n]; const v = segDist(x, y, s[0], s[1], s[2], s[3]); if (v < d) d = v; } } return d; };
let dmax = 0, dmaxAt = null;
for (const p of pins) for (let dx = -ZONE; dx <= ZONE; dx += 10) for (let dy = -ZONE; dy <= ZONE; dy += 10) {
  if (dx * dx + dy * dy > ZONE * ZONE) continue;
  const d = nearestSeg(p.xy[0] + dx, p.xy[1] + dy); if (d > dmax) { dmax = d; dmaxAt = unproj(p.xy[0] + dx, p.xy[1] + dy).map((v) => +v.toFixed(5)); }
}
console.log(`farthest point of any zone from a named street: ${dmax.toFixed(1)} m at ${dmaxAt}`);
if (!(dmax < MARGIN - 50)) throw new Error("coverage margin too small");

const stamp = raw.osm3s.timestamp_osm_base;
const out = { _src: `© OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright). Fetched via the Overpass API, data as of ${stamp}. Inclusion rule and format: see the match-street section of index.html and data/street-build/build.js.`, cover: COVER, dmax: Math.ceil(dmax), s: groups.map((g) => g.enc) };
const json = JSON.stringify(out);
fs.writeFileSync(OUT, json);
const rep = {};
for (const g of groups) rep[g.key] = (rep[g.key] || 0) + 1;
fs.writeFileSync(OUT + ".report.json", JSON.stringify({ dropped: Object.fromEntries(Object.entries(dropped).map(([k, v]) => [k, [...new Set(v)].sort()])), repeated: Object.entries(rep).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]), names: groups.map((g) => g.name) }, null, 1));
console.log(`ways kept ${nWays}, sidewalk/crossing pieces dropped ${sideDropped}, streets ${groups.length} (${groups.filter((g) => g.areas.length).length} with areas), vertices ${groups.reduce((s, g) => s + g.lines.reduce((t, l) => t + l.length, 0) + g.areas.reduce((t, r) => t + r.length, 0), 0)}, segments ${segs.length}`);
for (const [k, v] of Object.entries(dropped)) console.log(`dropped ${k}: ${v.length}`);
console.log("bytes", json.length);
