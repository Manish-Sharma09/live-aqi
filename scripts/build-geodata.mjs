#!/usr/bin/env node
/**
 * Builds the compact geographic datasets used by Live AQI from GeoNames dumps.
 *
 *   node scripts/build-geodata.mjs <dir-with-geonames-files>
 *
 * The directory must contain (from https://download.geonames.org/export/dump/):
 *   - cities15000.txt      (unzipped cities15000.zip)
 *   - countryInfo.txt
 *   - admin1CodesASCII.txt
 *
 * Output: src/data/cities.json and src/data/countries.json
 * GeoNames data is licensed CC BY 4.0 — attribution is shown in the site footer.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = process.argv[2];
if (!srcDir) {
  console.error('Usage: node scripts/build-geodata.mjs <geonames-dir>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'data');
mkdirSync(outDir, { recursive: true });

/** Minimum population for a city to be included (capitals are always included). */
const MIN_POPULATION = 50_000;

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const lines = (file) =>
  readFileSync(join(srcDir, file), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'));

// ---------- Countries ----------
const countries = new Map();
for (const line of lines('countryInfo.txt')) {
  const f = line.split('\t');
  const [iso, , , , name, capital, , population, continent] = f;
  if (!iso || !name) continue;
  countries.set(iso, {
    cc: iso,
    name,
    slug: slugify(name),
    continent,
    capital,
    population: Number(population) || 0,
  });
}

// ---------- Admin1 (states / provinces) ----------
const admin1All = new Map();
for (const line of lines('admin1CodesASCII.txt')) {
  const [code, name] = line.split('\t');
  admin1All.set(code, name);
}

// ---------- Cities ----------
const raw = [];
for (const line of lines('cities15000.txt')) {
  const f = line.split('\t');
  const id = Number(f[0]);
  const name = f[1];
  const ascii = f[2] || f[1];
  const lat = Number(f[4]);
  const lon = Number(f[5]);
  const featureCode = f[7];
  const cc = f[8];
  const admin1 = f[10];
  const pop = Number(f[14]) || 0;
  const tz = f[17];
  if (!countries.has(cc)) continue;
  const isCapital = featureCode === 'PPLC';
  // PPLX = a section of a populated place (e.g. Puxi in Shanghai). Kept for search,
  // excluded from rankings so a city is not listed several times.
  const isDistrict = featureCode === 'PPLX';
  if (pop < MIN_POPULATION && !isCapital) continue;
  // Skip historical / destroyed / abandoned places that GeoNames still lists.
  if (/^(PPLH|PPLQ|PPLW)$/.test(featureCode)) continue;
  raw.push({ id, name, ascii, lat, lon, cc, admin1, pop, tz, isCapital, isDistrict });
}

raw.sort((a, b) => b.pop - a.pop);

// Slugs: most populous place keeps the bare slug; others get a region or country suffix.
const used = new Set();
for (const c of raw) {
  const base = slugify(c.ascii) || String(c.id);
  const regionName = admin1All.get(`${c.cc}.${c.admin1}`);
  const candidates = [
    base,
    regionName ? `${base}-${slugify(regionName)}` : null,
    `${base}-${c.cc.toLowerCase()}`,
    regionName ? `${base}-${slugify(regionName)}-${c.cc.toLowerCase()}` : null,
    `${base}-${c.id}`,
  ].filter(Boolean);
  c.slug = candidates.find((s) => !used.has(s));
  used.add(c.slug);
}

// ---------- World-monitored set (map + global rankings) ----------
// Every city ≥ 2.5M people, plus the capital and the largest city of every
// country with ≥ 1M people — skipping districts and any place within 20 km of a
// larger monitored city (the ~45 km model grid would give them the same reading).
// Keeps the snapshot around ~300 locations so the free Open-Meteo quota is respected.
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const candidates = new Set();
const eligible = raw.filter((c) => !c.isDistrict);
for (const c of eligible) if (c.pop >= 2_500_000) candidates.add(c.id);
const largestByCountry = new Map();
for (const c of eligible) if (!largestByCountry.has(c.cc)) largestByCountry.set(c.cc, c);
for (const [cc, c] of largestByCountry) {
  if ((countries.get(cc)?.population ?? 0) >= 1_000_000) candidates.add(c.id);
}
for (const c of eligible) {
  if (c.isCapital && (countries.get(c.cc)?.population ?? 0) >= 1_000_000) candidates.add(c.id);
}
const monitored = new Set();
const chosen = [];
for (const c of eligible) {
  if (!candidates.has(c.id)) continue;
  if (chosen.some((m) => km(m, c) < 20)) continue; // eligible is sorted by population, so larger cities win
  monitored.add(c.id);
  chosen.push(c);
}

// ---------- Compact output ----------
const tzList = [...new Set(raw.map((c) => c.tz))].sort();
const tzIndex = new Map(tzList.map((t, i) => [t, i]));
const admin1Used = {};
for (const c of raw) {
  const key = `${c.cc}.${c.admin1}`;
  const n = admin1All.get(key);
  if (n) admin1Used[key] = n;
}

const round = (n) => Math.round(n * 1e4) / 1e4;
const rows = raw.map((c) => [
  c.id,
  c.name,
  c.slug,
  round(c.lat),
  round(c.lon),
  c.cc,
  c.admin1,
  c.pop,
  tzIndex.get(c.tz),
  (c.isCapital ? 1 : 0) | (monitored.has(c.id) ? 2 : 0) | (c.isDistrict ? 4 : 0),
]);

// Friendly aliases for common alternative spellings → canonical slug.
const byName = (name, cc) => raw.find((c) => c.name === name && c.cc === cc);
const aliasPairs = [
  ['new-york', 'New York City', 'US'],
  ['nyc', 'New York City', 'US'],
  ['gurgaon', 'Gurugram', 'IN'],
  ['bangalore', 'Bengaluru', 'IN'],
  ['bombay', 'Mumbai', 'IN'],
  ['calcutta', 'Kolkata', 'IN'],
  ['madras', 'Chennai', 'IN'],
  ['saigon', 'Ho Chi Minh City', 'VN'],
  ['peking', 'Beijing', 'CN'],
];
const aliases = {};
for (const [alias, name, cc] of aliasPairs) {
  const c = byName(name, cc);
  if (c && !used.has(alias)) aliases[alias] = c.slug;
}

const countryRows = [...countries.values()]
  .filter((c) => raw.some((city) => city.cc === c.cc))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((c) => [c.cc, c.name, c.slug, c.continent, c.population]);

writeFileSync(
  join(outDir, 'cities.json'),
  JSON.stringify({ source: 'GeoNames cities15000 (CC BY 4.0)', tz: tzList, admin1: admin1Used, aliases, rows }),
);
writeFileSync(join(outDir, 'countries.json'), JSON.stringify({ source: 'GeoNames countryInfo (CC BY 4.0)', rows: countryRows }));

console.log(`cities: ${rows.length}, monitored: ${monitored.size}, countries: ${countryRows.length}, tz: ${tzList.length}`);
console.log('aliases:', aliases);
