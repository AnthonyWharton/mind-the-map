// Bakes data/measure-sea-level.json: ground height on a 25 m grid over every hiding zone, for the
// "closer to or further from sea level" question.
// usage: node build.js <tiledir> ../measure-sea-level.json   (Node 18+, no npm packages)
// Tiles are cached in <tiledir>, so a re-run only downloads what's missing.
//
// Source: AWS Terrain Tiles (Mapzen / Tilezen "joerd"), Terrarium PNG encoding, zoom 14 (about 6 m pixels at
// London). Over England these zooms come from the Environment Agency's 2 m LIDAR composite DTM (each tile's
// x-amz-meta-x-imagery-sources header names uk_lidar/LIDAR-DTM-2M-*.tif), released under the Open Government
// Licence v3. Attribution: "© Environment Agency copyright and/or database right 2015. All rights reserved."
// A DTM is bare earth: buildings, bridges and trees are removed. Heights are metres above Ordnance Datum Newlyn
// (about mean sea level).
//
// Output grid: cells of C metres in the app's local projection (same proj as index.html), origin x0,y0 at the
// south-west corner, nx columns by ny rows, row-major from the south. For each cell, lo and hi are the lowest and
// highest pixel inside it, in decimetres (lo rounded down, hi rounded up), so the app can stay on the hider's side.
// Encoding: two base64 strings of LEB128 varints, one value per cell in order. "lo": zigzag(lo - previous lo), where
// previous is the cell to the left (or, at the start of a row, the first cell of the row below). "spread": hi - lo.
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const TILEDIR = process.argv[2], OUT = process.argv[3];
if (!TILEDIR || !OUT) { console.error("usage: node build.js <tiledir> <out.json>"); process.exit(1); }

const ER = 6371008.8, LAT0 = 51.507, LON0 = -0.12, KX = Math.cos(LAT0 * Math.PI / 180);
const proj = (lat, lon) => [(lon - LON0) * Math.PI / 180 * ER * KX, (lat - LAT0) * Math.PI / 180 * ER];
const unproj = (x, y) => [y / ER * 180 / Math.PI + LAT0, x / (ER * KX) * 180 / Math.PI + LON0];

// The 67 hiding-zone stations span lat 51.4798..51.5322, lon -0.1963..-0.0710 (Zone 1 and the Zone 1/2
// boundary). Cover that plus 1 km: the 500 m zones, and 500 m of context for the map preview.
const C = 25, Z = 14, MARGIN = 1000;
const sw = proj(51.4798, -0.1963), ne = proj(51.5322, -0.0710);
const x0 = Math.floor((sw[0] - MARGIN) / C) * C, y0 = Math.floor((sw[1] - MARGIN) / C) * C;
const nx = Math.ceil((ne[0] + MARGIN - x0) / C), ny = Math.ceil((ne[1] + MARGIN - y0) / C);

// ---- tiles ----
const N = 2 ** Z;
const tileXY = (lat, lon) => [(lon + 180) / 360 * N, (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * N];
const llOfPix = (px, py) => [Math.atan(Math.sinh(Math.PI * (1 - 2 * py / N))) * 180 / Math.PI, px / N * 360 - 180]; // px, py in tile units
const [la0, lo0] = unproj(x0, y0), [la1, lo1] = unproj(x0 + nx * C, y0 + ny * C);
const [tx0, ty0] = tileXY(la1, lo0).map(Math.floor), [tx1, ty1] = tileXY(la0, lo1).map(Math.floor);

// Minimal PNG decoder: 8-bit RGB or RGBA, non-interlaced (what Terrarium tiles are).
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0 || (ct !== 2 && ct !== 6)) throw new Error("unsupported PNG"); }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst - stride + i] : 0, c = i >= bpp && y ? out[dst - stride + i - bpp] : 0, x = raw[src + i];
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error("bad filter " + f);
      out[dst + i] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

async function getTile(x, y) {
  const f = path.join(TILEDIR, `${Z}-${x}-${y}.png`);
  if (!fs.existsSync(f)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
    for (let t = 1; ; t++) {
      try {
        const r = await fetch(url); if (!r.ok) throw new Error(r.status);
        const src = r.headers.get("x-amz-meta-x-imagery-sources") || "";
        fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); fs.writeFileSync(f + ".src", src);
        break;
      } catch (e) { if (t >= 3) throw e; await new Promise((ok) => setTimeout(ok, 2000 * t)); }
    }
  }
  return { img: decodePNG(fs.readFileSync(f)), src: fs.existsSync(f + ".src") ? fs.readFileSync(f + ".src", "utf8") : "" };
}

(async () => {
  fs.mkdirSync(TILEDIR, { recursive: true });
  const lo = new Float64Array(nx * ny).fill(Infinity), hi = new Float64Array(nx * ny).fill(-Infinity), cnt = new Uint16Array(nx * ny);
  const sources = new Set();
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const { img, src } = await getTile(tx, ty);
    src.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => sources.add(s.split("/")[0]));
    for (let py = 0; py < img.h; py++) for (let pxi = 0; pxi < img.w; pxi++) {
      const [lat, lon] = llOfPix(tx + (pxi + 0.5) / img.w, ty + (py + 0.5) / img.h), [x, y] = proj(lat, lon);
      const i = Math.floor((x - x0) / C), j = Math.floor((y - y0) / C);
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const o = (py * img.w + pxi) * img.bpp, e = img.px[o] * 256 + img.px[o + 1] + img.px[o + 2] / 256 - 32768, k = j * nx + i;
      if (e < lo[k]) lo[k] = e; if (e > hi[k]) hi[k] = e; cnt[k]++;
    }
  }
  // Encode.
  const bytes = [], varint = (v) => { do { let b = v & 127; v = Math.floor(v / 128); if (v) b |= 128; bytes.push(b); } while (v); };
  const zz = (v) => (v < 0 ? -2 * v - 1 : 2 * v);
  const L = new Int16Array(nx * ny), Hh = new Int16Array(nx * ny);
  let maxSpread = 0, minE = Infinity, maxE = -Infinity;
  for (let k = 0; k < nx * ny; k++) {
    if (!cnt[k]) throw new Error(`cell ${k} has no pixels`);
    L[k] = Math.floor(lo[k] * 10); Hh[k] = Math.ceil(hi[k] * 10);
    maxSpread = Math.max(maxSpread, Hh[k] - L[k]); minE = Math.min(minE, lo[k]); maxE = Math.max(maxE, hi[k]);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; varint(zz(L[k] - (i ? L[k - 1] : j ? L[k - nx] : 0))); }
  const loBytes = bytes.splice(0);
  for (let k = 0; k < nx * ny; k++) varint(Hh[k] - L[k]);
  const spBytes = bytes.splice(0);
  const out = {
    source: `AWS Terrain Tiles (Tilezen/Mapzen), Terrarium zoom ${Z}, fetched ${new Date().toISOString().slice(0, 10)}. Imagery sources: ${[...sources].join(", ")} (Environment Agency LIDAR Composite DTM 2 m).`,
    licence: "Open Government Licence v3.0. © Environment Agency copyright and/or database right 2015. All rights reserved.",
    note: `Bare-earth ground height (buildings and bridges removed), metres above Ordnance Datum Newlyn. Cells of ${C} m in the app's projection (LAT0 ${LAT0}, LON0 ${LON0}), row-major from the south-west corner. Each cell holds the lowest and highest ${Z === 14 ? "~6 m" : ""} pixel in it, in decimetres. lo and spread: base64 LEB128 varints, one per cell; lo holds zigzag(lo - previous lo), previous being the cell to the left, or the first cell of the row below at a row start; spread holds hi - lo. Built by data/sea-level-build/build.js.`,
    proj: { LAT0, LON0 }, C, x0, y0, nx, ny,
    lo: Buffer.from(loBytes).toString("base64"),
    spread: Buffer.from(spBytes).toString("base64"),
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`grid ${nx}x${ny} (${nx * ny} cells), tiles ${tx1 - tx0 + 1}x${ty1 - ty0 + 1}, ${loBytes.length}+${spBytes.length} bytes -> ${fs.statSync(OUT).size} B json (${zlib.gzipSync(fs.readFileSync(OUT)).length} B gzip)`);
  console.log(`elevation ${minE.toFixed(1)}..${maxE.toFixed(1)} m, max spread in a cell ${(maxSpread / 10).toFixed(1)} m, sources: ${[...sources].join(", ")}`);
  // Spot checks: mid of the cell, and lo..hi.
  const at = (lat, lon) => { const [x, y] = proj(lat, lon), k = Math.floor((y - y0) / C) * nx + Math.floor((x - x0) / C); return `${((L[k] + Hh[k]) / 20).toFixed(1)} m (${(L[k] / 10).toFixed(1)}..${(Hh[k] / 10).toFixed(1)})`; };
  for (const [n, la, lo2] of [["Westminster", 51.501, -0.1248], ["Embankment", 51.5074, -0.1223], ["Bank", 51.5133, -0.0889], ["King's Cross", 51.5308, -0.1238], ["Euston", 51.5282, -0.1337], ["Angel", 51.5322, -0.1058], ["Notting Hill Gate", 51.5094, -0.1967], ["Tower Hill", 51.5098, -0.0766], ["Waterloo", 51.5031, -0.1132], ["Oxford Circus", 51.5152, -0.1419], ["Hyde Park Corner", 51.5027, -0.1527], ["Elephant & Castle", 51.4943, -0.1001]])
    console.log(`  ${n.padEnd(18)} ${at(la, lo2)}`);
})().catch((e) => { console.error(e); process.exit(1); });
