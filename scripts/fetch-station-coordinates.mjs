import { readFile } from "node:fs/promises";

const usage = "Usage: GOOGLE_PLACES_API_KEY=<key> node scripts/fetch-station-coordinates.mjs";
const args = process.argv.slice(2);
const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();

if (args.length === 1 && args[0] === "--help") {
  console.log(usage);
} else if (args.length || !apiKey) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    // Read the app's mapping as JSON without executing the inline browser script.
    const match = html.match(/const STATION_PINS = new Map\(Object\.entries\((\{[\s\S]*?\})\)\);/);
    const stations = match ? Object.entries(JSON.parse(match[1])) : [];
    if (!stations.length) throw new Error("No station Place IDs found in index.html.");

    const coordinates = {};
    for (const [name, { placeId }] of stations) {
      coordinates[name] = await fetchCoordinates(name, placeId);
    }
    console.log(JSON.stringify(coordinates, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

async function fetchCoordinates(name, placeId) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  try {
    const response = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "location"
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Places API returned HTTP ${response.status}`);

    const { location } = await response.json();
    if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
      throw new Error("Places API returned no valid coordinates");
    }
    return { placeId, latitude: location.latitude, longitude: location.longitude };
  } catch (error) {
    throw new Error(`${name} (${placeId}): ${error.message}`);
  }
}
