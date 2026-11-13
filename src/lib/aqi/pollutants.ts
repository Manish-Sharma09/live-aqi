import type { PollutantId } from './standards';

export interface Guideline {
  value: number;
  unit: 'µg/m³' | 'mg/m³';
  averaging: '24-h' | '8-h';
}

export interface PollutantInfo {
  id: PollutantId;
  /** Chemical symbol and subscript, rendered as e.g. PM<sub>2.5</sub> by PollutantLabel. */
  symbol: string;
  sub: string;
  /** ASCII label for attributes, URLs and plain text. */
  ascii: string;
  name: string;
  displayUnit: 'µg/m³' | 'mg/m³';
  about: string;
  sources: string;
  health: string;
  /** WHO Global Air Quality Guidelines (2021) short-term guideline. */
  who: Guideline;
  /** India National Ambient Air Quality Standards (2009). */
  naaqsIndia: Guideline;
}

export const POLLUTANTS: Record<PollutantId, PollutantInfo> = {
  pm25: {
    id: 'pm25',
    symbol: 'PM',
    sub: '2.5',
    ascii: 'PM2.5',
    name: 'Fine particulate matter',
    displayUnit: 'µg/m³',
    about: 'Particles 2.5 micrometres or smaller — small enough to reach deep into the lungs and enter the bloodstream.',
    sources: 'Vehicle exhaust, industry and power plants, crop-residue and waste burning, wildfires, household solid fuels.',
    health: 'Linked to heart attacks, stroke, lung cancer, worsened asthma and premature death.',
    who: { value: 15, unit: 'µg/m³', averaging: '24-h' },
    naaqsIndia: { value: 60, unit: 'µg/m³', averaging: '24-h' },
  },
  pm10: {
    id: 'pm10',
    symbol: 'PM',
    sub: '10',
    ascii: 'PM10',
    name: 'Coarse particulate matter',
    displayUnit: 'µg/m³',
    about: 'Inhalable particles 10 micrometres or smaller, including all fine particles (PM2.5).',
    sources: 'Road and construction dust, mining, industry, desert dust and sea salt, plus combustion particles.',
    health: 'Irritates the airways and aggravates asthma, bronchitis and other respiratory conditions.',
    who: { value: 45, unit: 'µg/m³', averaging: '24-h' },
    naaqsIndia: { value: 100, unit: 'µg/m³', averaging: '24-h' },
  },
  o3: {
    id: 'o3',
    symbol: 'O',
    sub: '3',
    ascii: 'O3',
    name: 'Ground-level ozone',
    displayUnit: 'µg/m³',
    about: 'Formed when sunlight acts on nitrogen oxides and volatile organic compounds, so it usually peaks in the afternoon.',
    sources: 'Not emitted directly. It forms from traffic, industrial and natural precursor gases.',
    health: 'Inflames the airways, reduces lung function and triggers asthma attacks.',
    who: { value: 100, unit: 'µg/m³', averaging: '8-h' },
    naaqsIndia: { value: 100, unit: 'µg/m³', averaging: '8-h' },
  },
  no2: {
    id: 'no2',
    symbol: 'NO',
    sub: '2',
    ascii: 'NO2',
    name: 'Nitrogen dioxide',
    displayUnit: 'µg/m³',
    about: 'A reddish-brown gas that is a marker of traffic pollution and a precursor of ozone and particles.',
    sources: 'Road traffic (especially diesel), power generation, industrial boilers and gas stoves.',
    health: 'Inflames the airways; long-term exposure is associated with the development of asthma in children.',
    who: { value: 25, unit: 'µg/m³', averaging: '24-h' },
    naaqsIndia: { value: 80, unit: 'µg/m³', averaging: '24-h' },
  },
  so2: {
    id: 'so2',
    symbol: 'SO',
    sub: '2',
    ascii: 'SO2',
    name: 'Sulphur dioxide',
    displayUnit: 'µg/m³',
    about: 'A pungent gas produced when sulphur-containing fuels are burned.',
    sources: 'Coal- and oil-fired power plants, smelters, refineries, shipping and volcanoes.',
    health: 'Irritates the eyes and airways and can cause airway narrowing in people with asthma.',
    who: { value: 40, unit: 'µg/m³', averaging: '24-h' },
    naaqsIndia: { value: 80, unit: 'µg/m³', averaging: '24-h' },
  },
  co: {
    id: 'co',
    symbol: 'CO',
    sub: '',
    ascii: 'CO',
    name: 'Carbon monoxide',
    displayUnit: 'mg/m³',
    about: 'A colourless, odourless gas from incomplete combustion.',
    sources: 'Road traffic, biomass and waste burning, generators and poorly ventilated stoves.',
    health: 'Reduces the blood’s ability to carry oxygen; a particular risk for people with heart disease.',
    who: { value: 4, unit: 'mg/m³', averaging: '24-h' },
    naaqsIndia: { value: 2, unit: 'mg/m³', averaging: '8-h' },
  },
};
