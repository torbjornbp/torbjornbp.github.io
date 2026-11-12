// Decade frames for the world map's time modes. Pure functions over the rows
// of country-decades.rq (?decade ?country ?works) and timeline-decades.rq
// (?year ?works, where ?year is the decade), so they can be tested without a
// browser.
//
// "decade" mode shows the works produced in one decade. "cumulative" shows the
// works produced up to the end of that decade, so the map fills up as time
// runs. A work dated in two decades counts in both, as in the timeline.

export const TIME_MODES = ["all", "decade", "cumulative"];

function decadeNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.floor(number / 10) * 10 : null;
}

// Every decade from the first to the last, including empty ones, so playback
// moves through time at an even pace.
export function decadeFrames(rows) {
  const perDecade = new Map();
  for (const row of rows) {
    const decade = decadeNumber(row.decade);
    const works = Number(row.works) || 0;
    if (decade === null || !row.country || works <= 0) continue;
    if (!perDecade.has(decade)) perDecade.set(decade, new Map());
    const counts = perDecade.get(decade);
    counts.set(row.country, (counts.get(row.country) || 0) + works);
  }
  const found = [...perDecade.keys()].sort((a, b) => a - b);
  const decades = found.length
    ? Array.from({ length: (found[found.length - 1] - found[0]) / 10 + 1 }, (_, index) => found[0] + index * 10)
    : [];
  const cumulative = new Map();
  const running = new Map();
  for (const decade of decades) {
    for (const [country, works] of perDecade.get(decade) || []) {
      running.set(country, (running.get(country) || 0) + works);
    }
    cumulative.set(decade, new Map(running));
  }
  for (const decade of decades) {
    if (!perDecade.has(decade)) perDecade.set(decade, new Map());
  }
  return { decades, perDecade, cumulative };
}

// Works per country IRI for one frame.
export function frameCounts(frames, decade, mode) {
  const source = mode === "cumulative" ? frames.cumulative : frames.perDecade;
  return source.get(decade) || new Map();
}

// The largest count any country reaches in any frame of the mode, so colours
// and circle sizes mean the same thing in every decade. `include` limits it to
// countries that can be drawn (on-map ones), as the all-years map does.
export function frameMaximum(frames, mode, include = () => true) {
  let maximum = 0;
  const source = mode === "cumulative" ? frames.cumulative : frames.perDecade;
  for (const counts of source.values()) {
    for (const [country, works] of counts) {
      if (include(country) && works > maximum) maximum = works;
    }
  }
  return maximum;
}

// Distinct dated works per decade for the scrubber track, aligned to the
// frame decades; cumulative mode keeps a running total.
export function decadeTotals(frames, rows, mode) {
  const byDecade = new Map();
  for (const row of rows) {
    const decade = decadeNumber(row.year ?? row.decade);
    if (decade === null) continue;
    byDecade.set(decade, (byDecade.get(decade) || 0) + (Number(row.works) || 0));
  }
  let running = 0;
  return frames.decades.map((decade) => {
    const works = byDecade.get(decade) || 0;
    running += works;
    return { decade, works: mode === "cumulative" ? running : works };
  });
}
