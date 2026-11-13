// Year frames for the world map's time modes. Pure functions over the rows
// of country-years.rq (?year ?country ?works) and timeline.rq (?year ?works),
// so they can be tested without a browser.
//
// "year" mode shows the works produced in one year. "cumulative" shows the
// works produced up to the end of that year, so the map fills up as time
// runs. A work dated in two years counts in both, as in the timeline.

export const TIME_MODES = ["all", "year", "cumulative"];

function yearNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

// Every year from the first to the last, including empty ones, so playback
// moves through time at an even pace.
export function yearFrames(rows) {
  const perYear = new Map();
  for (const row of rows) {
    const year = yearNumber(row.year);
    const works = Number(row.works) || 0;
    if (year === null || !row.country || works <= 0) continue;
    if (!perYear.has(year)) perYear.set(year, new Map());
    const counts = perYear.get(year);
    counts.set(row.country, (counts.get(row.country) || 0) + works);
  }
  const found = [...perYear.keys()].sort((a, b) => a - b);
  const years = found.length
    ? Array.from({ length: found[found.length - 1] - found[0] + 1 }, (_, index) => found[0] + index)
    : [];
  const cumulative = new Map();
  const running = new Map();
  for (const year of years) {
    for (const [country, works] of perYear.get(year) || []) {
      running.set(country, (running.get(country) || 0) + works);
    }
    cumulative.set(year, new Map(running));
  }
  for (const year of years) {
    if (!perYear.has(year)) perYear.set(year, new Map());
  }
  return { years, perYear, cumulative };
}

// Works per country IRI for one frame.
export function frameCounts(frames, year, mode) {
  const source = mode === "cumulative" ? frames.cumulative : frames.perYear;
  return source.get(year) || new Map();
}

// The largest count any country reaches in any frame of the mode, so colours
// and spike lengths mean the same thing in every year. `include` limits it to
// countries that can be drawn (on-map ones), as the all-years map does.
export function frameMaximum(frames, mode, include = () => true) {
  let maximum = 0;
  const source = mode === "cumulative" ? frames.cumulative : frames.perYear;
  for (const counts of source.values()) {
    for (const [country, works] of counts) {
      if (include(country) && works > maximum) maximum = works;
    }
  }
  return maximum;
}

// Distinct dated works per year for the scrubber track, aligned to the frame
// years; cumulative mode keeps a running total.
export function yearTotals(frames, rows, mode) {
  const byYear = new Map();
  for (const row of rows) {
    const year = yearNumber(row.year);
    if (year === null) continue;
    byYear.set(year, (byYear.get(year) || 0) + (Number(row.works) || 0));
  }
  let running = 0;
  return frames.years.map((year) => {
    const works = byYear.get(year) || 0;
    running += works;
    return { year, works: mode === "cumulative" ? running : works };
  });
}

// Legend values for the log spike scale: powers of ten up to the maximum, at
// most four of them, and the maximum itself when fewer than two fit.
export function logTicks(maximum) {
  const ticks = [];
  for (let value = 1; value <= maximum; value *= 10) ticks.push(value);
  if (ticks.length < 2 && maximum > 1) ticks.push(maximum);
  return ticks.slice(-4);
}

// The year step for track labels: the smallest round step that fits `slots`
// labels across the track.
export function labelStep(count, slots) {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) {
    if (count / step <= Math.max(2, slots)) return step;
  }
  return 100;
}
