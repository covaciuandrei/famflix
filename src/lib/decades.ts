/** Release-date filter, newest first. Series count from the year they first aired. */
export const DECADES = [
  { value: "2020s", label: "2020s", from: 2020, to: null },
  { value: "2010s", label: "2010s", from: 2010, to: 2019 },
  { value: "2000s", label: "2000s", from: 2000, to: 2009 },
  { value: "1990s", label: "1990s", from: 1990, to: 1999 },
  { value: "1980s", label: "1980s", from: 1980, to: 1989 },
  { value: "older", label: "Before 1980", from: null, to: 1979 },
] as const satisfies readonly {
  value: string;
  label: string;
  from: number | null;
  to: number | null;
}[];

export type Decade = (typeof DECADES)[number];

export const ANY_YEAR = "any";

export function findDecade(value: string | undefined): Decade | null {
  return DECADES.find((d) => d.value === value) ?? null;
}

export function matchesDecade(year: number | null, value: string): boolean {
  if (value === ANY_YEAR) return true;
  const decade = findDecade(value);
  if (!decade || year === null) return false;
  return (
    (decade.from === null || year >= decade.from) &&
    (decade.to === null || year <= decade.to)
  );
}

export interface YearOption {
  value: string;
  label: string;
  count?: number;
}

/** "Any year" plus the decades these release years fall in, with how many titles each has. */
export function listDecades(years: (number | null)[]): YearOption[] {
  const options: YearOption[] = [
    { value: ANY_YEAR, label: "Any year", count: years.length },
  ];
  for (const d of DECADES) {
    const count = years.filter((y) => matchesDecade(y, d.value)).length;
    if (count > 0) options.push({ value: d.value, label: d.label, count });
  }
  return options;
}
