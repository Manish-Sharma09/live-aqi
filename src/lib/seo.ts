/**
 * Search-demand data for titles, link text and the sitemap.
 * Source: Google Trends, India, "AQI" related queries (top + rising), Nov 2026.
 * Full keyword research: .docs/seo-keywords.md
 */

/**
 * Names people search by when they differ from the dataset's official name
 * ("gurgaon aqi", "bangalore aqi"; nobody searches "gurugram aqi").
 */
const SEARCH_NAMES: Record<string, string> = {
  gurugram: 'Gurgaon',
  bengaluru: 'Bangalore',
};

/** The commonly searched alternative name for a city page, if any. */
export function searchName(slug: string): string | undefined {
  return SEARCH_NAMES[slug];
}

/** "Gurugram (Gurgaon)" where people search by another name, otherwise just the name. */
export function nameWithSearchName(name: string, slug: string): string {
  const alt = SEARCH_NAMES[slug];
  return alt ? `${name} (${alt})` : name;
}

/**
 * Indian city pages with real "<city> aqi" search demand, highest first.
 * `label` is the spelling people search. The top ones are linked from the footer
 * on every page; all of them are always in the sitemap.
 */
export const POPULAR_CITIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'delhi', label: 'Delhi' },
  { slug: 'noida', label: 'Noida' },
  { slug: 'gurugram', label: 'Gurgaon' },
  { slug: 'mumbai', label: 'Mumbai' },
  { slug: 'bengaluru', label: 'Bangalore' },
  { slug: 'ghaziabad', label: 'Ghaziabad' },
  { slug: 'pune', label: 'Pune' },
  { slug: 'lucknow', label: 'Lucknow' },
  { slug: 'kolkata', label: 'Kolkata' },
  { slug: 'new-delhi', label: 'New Delhi' },
  { slug: 'hyderabad', label: 'Hyderabad' },
  { slug: 'jaipur', label: 'Jaipur' },
  { slug: 'kanpur', label: 'Kanpur' },
  { slug: 'faridabad', label: 'Faridabad' },
  { slug: 'chandigarh', label: 'Chandigarh' },
  { slug: 'greater-noida', label: 'Greater Noida' },
  { slug: 'jammu', label: 'Jammu' },
  { slug: 'patna', label: 'Patna' },
  { slug: 'ahmedabad', label: 'Ahmedabad' },
  { slug: 'dehradun', label: 'Dehradun' },
  { slug: 'rohini', label: 'Rohini' },
  { slug: 'shimla', label: 'Shimla' },
  { slug: 'jalandhar', label: 'Jalandhar' },
  { slug: 'meerut', label: 'Meerut' },
  { slug: 'surat', label: 'Surat' },
];
