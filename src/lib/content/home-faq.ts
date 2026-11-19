/**
 * Home page FAQ. One source for both the visible accordion (HomeFaq.astro) and the
 * FAQPage JSON-LD, so the structured data always matches what visitors see.
 * Questions follow the searches in .docs/seo-keywords.md ("aqi today near me",
 * "aqi full form", "aqi level", "highest aqi", "aqi india"…).
 * Answers are HTML (internal links only); the JSON-LD gets the plain text.
 */
export interface FaqItem {
  q: string;
  /** Answer as trusted, hand-written HTML. */
  a: string;
}

export const HOME_FAQ: ReadonlyArray<FaqItem> = [
  {
    q: 'What is the AQI today near me?',
    a: 'Open the <a href="/">Live AQI home page</a> and it shows the live air quality index for your area straight away. It starts from an approximate location based on your connection; tap “Use my location” for a reading for your exact neighbourhood, or search any city, town or village. You get the AQI number, its level, the main pollutant and what it means for your health.',
  },
  {
    q: 'What is the full form of AQI?',
    a: 'AQI stands for Air Quality Index. It turns the levels of the main air pollutants (PM2.5, PM10, ozone, nitrogen dioxide, sulphur dioxide and carbon monoxide) into one number from 0 to 500. The higher the number, the more polluted the air and the greater the health risk. <a href="/what-is-aqi">Read the full guide to AQI levels</a>.',
  },
  {
    q: 'What is a good AQI level?',
    a: 'An AQI from 0 to 50 is “Good” on both the India and US scales, and up to 100 is acceptable for most people. Above 100, children, older adults and people with asthma, heart or lung disease should cut back on long or hard exercise outdoors.',
  },
  {
    q: 'At what AQI level does the air become dangerous?',
    a: 'On India’s National AQI, 201–300 is “Poor”, 301–400 “Very Poor” and above 400 “Severe”, when even healthy people are affected. On the US scale, above 150 is “Unhealthy” for everyone and above 300 is “Hazardous”. At these levels, limit time outdoors, keep windows closed and use an air purifier or a well-fitted N95 mask if you have one.',
  },
  {
    q: 'Why does the same place show two different AQI numbers?',
    a: 'India’s Central Pollution Control Board (CPCB) and the US EPA use different pollutant bands and averaging times. India averages particles over 24 hours, while the US real-time AQI uses NowCast, which reacts faster to change. Live AQI shows the India NAQI by default for places in India and the US AQI elsewhere, and you can switch on every page. The two are never mixed.',
  },
  {
    q: 'How often is the AQI updated?',
    a: 'Every hour. Each reading shows the hour it is valid for and when it was fetched, so you always know how fresh it is. The 48-hour forecast is refreshed as new model runs arrive.',
  },
  {
    q: 'Where does Live AQI get its data, and how accurate is it?',
    a: 'Pollutant concentrations come from the Copernicus Atmosphere Monitoring Service (CAMS), delivered by Open-Meteo, and Live AQI computes each index itself. This is model data, at about 11 km resolution in Europe and 45 km elsewhere, so every place gets a consistent reading with history and a forecast. It can differ from a single ground monitor near you, especially next to busy roads or local fires. The <a href="/methodology">methodology</a> explains every step.',
  },
  {
    q: 'What are PM2.5 and PM10?',
    a: 'They are particulate matter: PM2.5 is fine particles 2.5 micrometres across or smaller, and PM10 is coarser particles up to 10 micrometres. PM2.5 reaches deep into the lungs and the bloodstream, which is why it drives the AQI in most Indian cities, especially in winter. Live AQI shows both in µg/m³ for every place.',
  },
  {
    q: 'How can I protect myself when the AQI is high?',
    a: 'Check the AQI and the forecast before going out, move exercise indoors or to the cleanest hours of the day, keep windows closed during pollution peaks, run an air purifier if you have one, and wear a well-fitted N95 or FFP2 mask outdoors. Every Live AQI reading comes with health advice for that level.',
  },
  {
    q: 'Can I get an alert when the air quality gets worse?',
    a: 'Yes. On the <a href="/alerts">alerts page</a>, choose a place and a level. Live AQI tells you when the air there crosses it, in the page or as a background notification on your phone or computer, and, if you like, when it recovers. No account is needed.',
  },
  {
    q: 'Which city has the worst AQI today?',
    a: 'The <a href="/rankings">AQI ranking</a> lists the most polluted and the cleanest of about 300 major cities right now. The <a href="/map">live AQI map</a> shows them all at once, and each country page, such as <a href="/country/india">India</a>, ranks its own cities and regions.',
  },
  {
    q: 'Is Live AQI free, and does it work outside India?',
    a: 'Live AQI is free and needs no account or app. It covers every country: search any city, town or village in the world, from Delhi and Mumbai to London, New York and Kuala Lumpur.',
  },
];

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Visible answer HTML → plain text for structured data. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** schema.org FAQPage for a list of questions shown on the page. */
export function faqJsonLd(items: ReadonlyArray<FaqItem>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: plainText(item.a) },
    })),
  };
}
