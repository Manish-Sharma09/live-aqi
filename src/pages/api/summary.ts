import type { APIRoute } from 'astro';
import { error, json } from '../../lib/api';
import { defaultStandardFor } from '../../lib/aqi/standards';
import { describeError } from '../../lib/services/http';
import { getLocationReport, resolveLocationToken } from '../../lib/services/reports';

export const prerender = false;

/** Compact current reading for a saved location (header chip, in-page alerts). */
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('loc') ?? '';
  if (!/^(s:[a-z0-9-]{1,120}|g:-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?)$/.test(token)) return error(400, 'Invalid location');
  const place = await resolveLocationToken(token).catch(() => null);
  if (!place) return error(404, 'Unknown location');
  try {
    const report = await getLocationReport(place);
    const reading = (std: 'us' | 'in') => {
      const r = report.current.aqi[std];
      return r
        ? { aqi: r.aqi, level: r.category.level, label: r.category.label, color: r.category.color, ink: r.category.ink, dominant: r.dominant }
        : null;
    };
    return json(
      {
        name: place.name,
        subtitle: [place.region, place.country].filter(Boolean).join(', '),
        href: `/city/${place.slug}`,
        cc: place.cc,
        defaultStandard: defaultStandardFor(place.cc),
        time: report.current.time,
        fetchedAt: report.fetchedAt,
        stale: report.stale,
        readings: { us: reading('us'), in: reading('in') },
      },
      { cache: 'public, max-age=300' },
    );
  } catch (err) {
    console.error('[api/summary]', err);
    return error(502, describeError(err));
  }
};
