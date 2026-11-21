// Bakes data/poi-places.json from the raw Overpass responses saved by fetch.sh.
// usage: bash fetch.sh <rawdir> && node build.js <rawdir> data/poi-places.json
// Writes <out>.report.json listing what was kept and why things were dropped (not committed).
const fs = require("fs"), path = require("path");
const RAW = process.argv[2], OUT = process.argv[3];
const ER = 6371008.8, LAT0 = 51.507, LON0 = -0.12, KX = Math.cos(LAT0 * Math.PI / 180);
const proj = (lat, lon) => [(lon - LON0) * Math.PI / 180 * ER * KX, (lat - LAT0) * Math.PI / 180 * ER];
const unproj = (x, y) => [y / ER * 180 / Math.PI + LAT0, x / (ER * KX) * 180 / Math.PI + LON0];
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
const pointInRing = ([x, y], r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
function dp(pts, tol) { // Douglas–Peucker on an open polyline
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) { const [px, py] = pts[i]; const d = L ? Math.abs(dx * (ay - py) - dy * (ax - px)) / L : Math.hypot(px - ax, py - ay); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(r, tol) { // closed ring in, closed ring out; split at the farthest point so DP has two anchors
  const open = r.slice(0, -1); let far = 0, fd = -1;
  open.forEach((p, i) => { const d = d2(p, open[0]); if (d > fd) { fd = d; far = i; } });
  const a = dp(open.slice(0, far + 1), tol), b = dp(open.slice(far).concat([open[0]]), tol);
  const out = a.concat(b.slice(1));
  return out.length >= 4 ? out : null;
}
// Join way geometries into closed rings (relations).
function assemble(ways) {
  const segs = ways.map((w) => w.slice()), rings = [];
  const key = (p) => p[0].toFixed(7) + "," + p[1].toFixed(7);
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
const norm = (s) => s.toLowerCase().replace(/^the\s+/, "").replace(/[’'`.]/g, "").replace(/&/g, "and").replace(/\s+/g, " ").trim();
const load1 = (k) => !fs.existsSync(path.join(RAW, k + ".json")) ? (console.log("MISSING", k), []) : JSON.parse(fs.readFileSync(path.join(RAW, k + ".json"), "utf8")).elements;
// Museums also take notable public galleries (tourism=gallery with a wikidata tag, not commercial ones).
// Museums also take the big public art galleries, which people call museums (OSM tags them tourism=gallery,
// like the commercial dealers, so they are picked by name).
const GALLERIES = ["National Gallery", "National Portrait Gallery", "Tate Britain", "The Courtauld Gallery", "Hayward Gallery", "Serpentine North", "Serpentine South", "Whitechapel Gallery", "Saatchi Gallery", "Dulwich Picture Gallery", "Guildhall Art Gallery", "South London Gallery", "The Photographers' Gallery", "Estorick Collection", "Ben Uri", "Pump House Gallery"];
const load = (k) => k === "museum" ? load1("museum").concat(load1("gallery").filter((e) => e.tags && GALLERIES.includes(e.tags.name))) : load1(k);
const ptOf = (e) => e.type === "node" ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null;
// Bounding boxes: [minLat, minLon, maxLat, maxLon]
const B1 = [51.433, -0.283, 51.587, 0.063], B2 = [51.352, -0.413, 51.668, 0.193], B3 = [51.235, -0.6, 51.785, 0.38];
const inB = (b, [la, lo]) => la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3];

const report = {};
function points(cat, box, keepFn = () => true) {
  const raw = load(cat), out = [], dropped = [];
  for (const e of raw) {
    const t = e.tags || {}, p = ptOf(e);
    if (!p || !inB(box, p)) continue;
    const name = (t.name || t["name:en"] || "").trim();
    if (!name) { dropped.push(`(unnamed ${e.type}/${e.id})`); continue; }
    const why = keepFn(t, name);
    if (why !== true) { dropped.push(`${name} [${why}]`); continue; }
    const xy = proj(p[0], p[1]);
    // Node-and-area duplicates (and the same place mapped twice): same name within 250 m. Prefer the area's centre.
    const dup = out.find((o) => norm(o.name) === norm(name) && d2(o.xy, xy) < 250);
    if (dup) { if (e.type !== "node" && dup.type === "node") Object.assign(dup, { xy, p, type: e.type }); dropped.push(`${name} [duplicate]`); continue; }
    out.push({ name, p, xy, type: e.type });
  }
  report[cat] = { kept: out.length, dropped };
  return out.sort((a, b) => a.name.localeCompare(b.name)).map((o) => [o.name, +o.p[0].toFixed(5), +o.p[1].toFixed(5)]);
}
// Area categories: polygons (outer rings only), simplified; nodes become points if no polygon of the same name is near.
function areas(cat, box, { minArea = 0, tol = 15, keepFn = () => true, nodes = true, dropNested = false, rename = {} } = {}) {
  const raw = load(cat), polys = [], nodeList = [], dropped = [];
  for (const e of raw) {
    const t = e.tags || {};
    const name0 = (t.name || t["name:en"] || "").trim();
    if (!name0) { dropped.push(`(unnamed ${e.type}/${e.id})`); continue; }
    const why = keepFn(t, name0);
    if (why !== true) { dropped.push(`${name0} [${why}]`); continue; }
    const name = rename[name0] || name0;
    if (e.type === "node") { if (nodes && inB(box, [e.lat, e.lon])) nodeList.push({ name, p: [e.lat, e.lon], xy: proj(e.lat, e.lon) }); continue; }
    let rings = [];
    if (e.type === "way" && e.geometry) { const g = e.geometry.map((q) => [q.lat, q.lon]); if (g.length >= 4 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1]) rings = [g]; }
    if (e.type === "relation") rings = assemble(e.members.filter((m) => m.type === "way" && m.geometry && (m.role === "outer" || m.role === "")).map((m) => m.geometry.map((q) => [q.lat, q.lon])));
    if (!rings.length) { dropped.push(`${name} [no closed ring]`); continue; }
    let pr = rings.map((r) => r.map(([la, lo]) => proj(la, lo)));
    const area = pr.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
    if (area < minArea) { dropped.push(`${name} [${Math.round(area)} m² < min]`); continue; }
    pr = pr.map((r) => { if (ringArea(r) < 0) r = r.slice().reverse(); return simplifyRing(r, tol); }).filter(Boolean).filter((r) => Math.abs(ringArea(r)) > minArea / 10 || Math.abs(ringArea(r)) > 2000);
    if (!pr.length) { dropped.push(`${name} [collapsed]`); continue; }
    // representative point: area-weighted centroid of the biggest ring, or a vertex-average fallback if that lies outside
    const big = pr.slice().sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    let cx = 0, cy = 0, A = 0;
    for (let i = 0; i < big.length - 1; i++) { const f = big[i][0] * big[i + 1][1] - big[i + 1][0] * big[i][1]; cx += (big[i][0] + big[i + 1][0]) * f; cy += (big[i][1] + big[i + 1][1]) * f; A += f; }
    let c = [cx / (3 * A), cy / (3 * A)];
    if (!pointInRing(c, big)) { // pick the interior point nearest the centroid on a coarse grid
      let best = big[0], bd = Infinity; const xs = big.map((q) => q[0]), ys = big.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) { const q = [x0 + (x1 - x0) * i / 40, y0 + (y1 - y0) * j / 40]; if (pointInRing(q, big) && d2(q, c) < bd) { bd = d2(q, c); best = q; } }
      c = best;
    }
    const allPts = pr.flat();
    if (!allPts.some((q) => inB(box, unproj(q[0], q[1])))) continue;
    polys.push({ name, xy: c, rings: pr, area });
  }
  // Same place mapped more than once (e.g. way + relation, or split ways): merge same-name polygons that are within 300 m.
  const merged = [];
  for (const p of polys.sort((a, b) => b.area - a.area)) {
    const m = merged.find((o) => norm(o.name) === norm(p.name) && o.rings.some((r) => r.some((q) => p.rings.some((s) => s.some((u) => d2(q, u) < 300)))));
    if (m) { m.rings.push(...p.rings); m.area += p.area; dropped.push(`${p.name} [merged part]`); } else merged.push(p);
  }
  // Drop polygons that sit inside a bigger one (e.g. a named garden inside a park): its centre is inside the other.
  let final = merged;
  if (dropNested) final = merged.filter((p) => { const host = merged.find((o) => o !== p && o.area > p.area && o.rings.some((r) => pointInRing(p.xy, r))); if (host) dropped.push(`${p.name} [inside ${host.name}]`); return !host; });
  // Nodes: keep only if no polygon of the same name is within 500 m, or the node is inside any polygon of that category.
  for (const n of nodeList) {
    const dup = final.find((o) => o.rings && ((norm(o.name) === norm(n.name) && o.rings.some((r) => r.some((q) => d2(q, n.xy) < 500))) || o.rings.some((r) => pointInRing(n.xy, r))));
    if (dup) { dropped.push(`${n.name} [node of ${dup.name}]`); continue; }
    if (nodeList.find((o) => o !== n && o.keep && norm(o.name) === norm(n.name) && d2(o.xy, n.xy) < 250)) { dropped.push(`${n.name} [duplicate node]`); continue; }
    n.keep = true;
    final.push({ name: n.name, xy: n.xy, rings: null, area: 0 });
  }
  report[cat] = { kept: final.length, dropped };
  // Encode rings as delta-coded integers in 1e-5 degrees: [lat0, lon0, dlat1, dlon1, ...] (closing point omitted).
  return final.sort((a, b) => a.name.localeCompare(b.name)).map((o) => {
    const [la, lo] = unproj(o.xy[0], o.xy[1]);
    const row = [o.name, +la.toFixed(5), +lo.toFixed(5)];
    if (o.rings) row.push(o.rings.map((r) => { const q = r.slice(0, -1).map(([x, y]) => unproj(x, y).map((v) => Math.round(v * 1e5))); const out = []; let pl = 0, pn = 0; q.forEach(([a, b], i) => { out.push(a - pl, b - pn); pl = a; pn = b; }); return out; }));
    return row;
  });
}

const no = (t) => ["private", "no"].includes(t.access);
// Drop points without the category word in the name that sit within r m of one with it (parts of the same site).
function dropParts(rows, cat, r) {
  const re = /hospital|infirmary|london clinic/i, main = rows.filter((x) => re.test(x[0]));
  return rows.filter((x) => {
    const pre = rows.find((m) => m !== x && x[0].startsWith(m[0] + " ") && d2(proj(m[1], m[2]), proj(x[1], x[2])) < r);
    if (pre) { report[cat].dropped.push(`${x[0]} [part of ${pre[0]}]`); return false; }
    if (re.test(x[0])) return true; const host = main.find((m) => d2(proj(m[1], m[2]), proj(x[1], x[2])) < r); if (host) report[cat].dropped.push(`${x[0]} [part of ${host[0]}]`); return !host; });
}
const data = {
  museum: points("museum", B1, (t) => no(t) ? "private" : true),
  library: points("library", B1, (t, n) => no(t) || ["customers", "permit"].includes(t.access) ? "private" : t["operator:type"] === "university" || /universit|college|\bUCL\b|SOAS|school|imperial/i.test((t.operator || "") + " " + n) ? "university or school" : /club|^library$|^main library$|building/i.test(n) ? "not a public library" : /^(toy|tool|seed)/.test(t.library || "") ? `library=${t.library}` : /little free library|book ?swap|bookcrossing|phone ?box/i.test(n) ? "book swap" : (t.disused === "yes" || t["disused:amenity"]) ? "disused" : true),
  cinema: points("cinema", B1, (t, n) => no(t) || /residents/i.test(n) ? "private" : true),
  // Hospitals: drop labs, imaging, clinics-in-name chains and wards/units mapped separately inside a hospital.
  hospital: dropParts(points("hospital", B1, (t, n) => /laborator|diagnostic|imaging|vision|sleep|\bward\b|\bunit\b|department|outpatient|consulting|research facility|medical centre|health centre|clinics\b|cancer centre/i.test(n) && !/hospital/i.test(n) ? "not a hospital" : true), "hospital", 300),
  consulate: points("consulate", B1, (t, n) => {
    if (t.amenity === "embassy") return ["residence", "ambassadors_residence"].includes(t.embassy) ? "residence" : true;
    if (!["consulate", "embassy"].includes(t.diplomatic)) return `diplomatic=${t.diplomatic}`;
    if (/residence/.test(t.embassy || "") || /residence/.test(t.consulate || "")) return "residence";
    if (t.embassy === "delegation") return "delegation";
    // Offices of an embassy that don't serve the public (trade, defence, culture, education...), unless consular.
    if (!/consul|visa|passport/i.test(n) && (t.embassy === "branch_embassy" || /attach|defen[cs]e|military|naval|cultural|trade|commercial|economic|education|student|medical|science|technolog|main building/i.test(n))) return "not a consular office";
    return true;
  }),
  aquarium: points("aquarium", B3, (t) => no(t) ? "private" : true),
  park: areas("park", B1, { minArea: 5000, tol: 12, nodes: false, dropNested: true, keepFn: (t) => no(t) ? "private" : true }),
  golf: areas("golf", B2, { minArea: 20000, tol: 30, keepFn: (t, n) => t.golf === "driving_range" || /driving range/i.test(n) ? "driving range" : /pitch|putt|footgolf|foot golf|crazy|\bmini|adventure golf|bigshots|world of golf|topgolf/i.test(n) || ["pitch_and_putt", "miniature"].includes(t.golf_course || t.golf) ? "not a full course" : true }),
  // Zoos: no petting zoos, city farms, aviaries, park animal enclosures or closed ones. Chessington's zoo areas
  // (Trail of the Kings, Amazu) are one zoo, named after the resort.
  zoo: areas("zoo", B3, { tol: 15, minArea: 3000, dropNested: true, rename: { "Trail of the Kings": "Chessington World of Adventures (zoo)" }, keepFn: (t, n) => ["petting_zoo", "farm", "aviary", "enclosure"].includes(t.zoo) ? `zoo=${t.zoo}` : /\bfarm\b/i.test(n) ? "city farm" : /^(animal enclosure|aviary|amazu)$/i.test(n) ? "enclosure, or part of another zoo" : /closed/i.test(t.opening_hours || "") || t.disused ? "closed" : true }),
  // Amusement parks: theme parks with rides; farm parks and model railways tagged theme_park don't count.
  theme: areas("theme", B3, { tol: 25, keepFn: (t, n) => /farm|society|engineers|railway/i.test(n) ? "farm park or model railway" : true }),
};
const stamp = JSON.parse(fs.readFileSync(path.join(RAW, "park.json"), "utf8")).osm3s.timestamp_osm_base;
const out = { _src: `© OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright). Fetched via the Overpass API, data as of ${stamp}. Tag definitions and format: see the poi section of index.html and data/poi-build/.`, ...data };
const json = JSON.stringify(out);
fs.writeFileSync(OUT, json);
for (const [k, v] of Object.entries(report)) console.log(`${k}: kept ${v.kept}, dropped ${v.dropped.length}`);
fs.writeFileSync(OUT + ".report.json", JSON.stringify({ report, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.map((r) => r[0])])) }, null, 1));
console.log("bytes", json.length);
