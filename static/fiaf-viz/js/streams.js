// Streamgraph for the timeline: works per decade split into layers by genre,
// role, country or language usage. "Streams" centres the layers around a
// wiggling baseline so each one's rise and fall is easy to follow; "Share"
// stacks them to 100% so the mix of each decade can be compared even where
// few works are dated.

import { humanize } from "./labels.js";
import * as ui from "./ui.js";

export const MAX_LAYERS = 8;
const OTHER = "\u0000other";

// Rows of { value, decade, works } -> one record per decade with a count per
// layer. The biggest values overall keep their own layer; the rest are summed
// into "Other". Missing decades between the first and last are filled with
// zero so the streams do not jump across gaps.
export function streamModel(rows, maxLayers = MAX_LAYERS) {
  const totals = new Map();
  const cells = [];
  for (const row of rows) {
    const decade = Number(row.decade);
    const works = Number(row.works) || 0;
    if (!Number.isFinite(decade) || !row.value || works <= 0) continue;
    totals.set(row.value, (totals.get(row.value) || 0) + works);
    cells.push({ value: row.value, decade, works });
  }
  if (!cells.length) return { decades: [], layers: [], records: [], other: false };
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || humanize(a[0]).localeCompare(humanize(b[0])))
    .map(([value]) => value);
  const kept = ranked.slice(0, ranked.length > maxLayers ? maxLayers - 1 : maxLayers);
  const keptSet = new Set(kept);
  const other = ranked.length > kept.length;
  const layers = other ? [...kept, OTHER] : kept;
  const [first, last] = d3.extent(cells, (cell) => cell.decade);
  const decades = d3.range(first, last + 10, 10);
  const byDecade = new Map(
    decades.map((decade) => [decade, Object.fromEntries(layers.map((layer) => [layer, 0]))])
  );
  for (const cell of cells) {
    const layer = keptSet.has(cell.value) ? cell.value : OTHER;
    byDecade.get(cell.decade)[layer] += cell.works;
  }
  const records = decades.map((decade) => ({ decade, ...byDecade.get(decade) }));
  return { decades, layers, records, other, totals, valueCount: ranked.length };
}

// Layers grouped by a parent class, such as formats by format class: the
// streams of one class sit next to each other so they can share a hue in
// different shades. Classes are ordered by size, and within each class the
// largest `perGroup` values keep a layer while the rest fold into an "other
// <class>" layer of that class. Values with no class form their own group.
export const PER_GROUP = 4;
export function groupedStreamModel(rows, groupOf, perGroup = PER_GROUP) {
  const totals = new Map();
  const cells = [];
  for (const row of rows) {
    const decade = Number(row.decade);
    const works = Number(row.works) || 0;
    if (!Number.isFinite(decade) || !row.value || works <= 0) continue;
    totals.set(row.value, (totals.get(row.value) || 0) + works);
    cells.push({ value: row.value, decade, works });
  }
  if (!cells.length) return { decades: [], layers: [], records: [], groups: [], other: false };
  const groupTotals = new Map();
  for (const [value, total] of totals) {
    const group = groupOf(value) || "";
    groupTotals.set(group, (groupTotals.get(group) || 0) + total);
  }
  const groups = [...groupTotals.entries()]
    .sort((a, b) => b[1] - a[1] || humanize(a[0]).localeCompare(humanize(b[0])))
    .map(([group]) => group);
  const layers = [];
  const layerOf = new Map();
  const groupOfLayer = new Map();
  for (const group of groups) {
    const members = [...totals.entries()]
      .filter(([value]) => (groupOf(value) || "") === group)
      .sort((a, b) => b[1] - a[1] || humanize(a[0]).localeCompare(humanize(b[0])))
      .map(([value]) => value);
    const kept = members.length > perGroup ? members.slice(0, perGroup - 1) : members;
    for (const value of kept) {
      layers.push(value);
      layerOf.set(value, value);
      groupOfLayer.set(value, group);
    }
    if (members.length > kept.length) {
      const rest = `${OTHER}${group}`;
      layers.push(rest);
      groupOfLayer.set(rest, group);
      for (const value of members.slice(kept.length)) layerOf.set(value, rest);
    }
  }
  const [first, last] = d3.extent(cells, (cell) => cell.decade);
  const decades = d3.range(first, last + 10, 10);
  const byDecade = new Map(
    decades.map((decade) => [decade, Object.fromEntries(layers.map((layer) => [layer, 0]))])
  );
  for (const cell of cells) byDecade.get(cell.decade)[layerOf.get(cell.value)] += cell.works;
  return {
    decades,
    layers,
    records: decades.map((decade) => ({ decade, ...byDecade.get(decade) })),
    groups,
    groupOfLayer,
    grouped: true,
    other: false,
    valueCount: totals.size
  };
}

// Shades of one hue for the layers of a group, darkest first. Lightness is
// spread around the base but kept between 25 and 80 (CIELAB), so a theme whose
// base colour is already light (dark mode) does not run out into white.
export function shades(base, count) {
  if (count <= 1) return [base];
  const colour = d3.lab(base);
  const from = Math.max(25, Math.min(colour.l - 18, 80 - 36));
  const to = Math.min(80, from + 36);
  return d3.range(count).map((index) => {
    const shade = d3.lab(colour);
    shade.l = from + ((to - from) * index) / (count - 1);
    return shade.formatHex();
  });
}

// Shares of a decade with three works swing wildly, so the share view runs from
// the first to the last decade with at least `minimum` counted works.
export const SHARE_MINIMUM = 10;
export function shareRecords(model, minimum = SHARE_MINIMUM) {
  const total = (record) => model.layers.reduce((sum, key) => sum + record[key], 0);
  const first = model.records.findIndex((record) => total(record) >= minimum);
  if (first < 0) return model.records;
  let last = model.records.length - 1;
  while (last > first && total(model.records[last]) < minimum) last -= 1;
  return model.records.slice(first, last + 1);
}

export function layerLabel(layer) {
  if (layer === OTHER) return "Other";
  if (String(layer).startsWith(OTHER)) {
    const group = layer.slice(OTHER.length);
    return group ? `Other ${humanize(group).toLowerCase()}s` : "Other";
  }
  return humanize(layer);
}

// Draw into an emptied svg. Colours are resolved by the caller so an exported
// SVG keeps them.
export function drawStreams(svg, { width, height, model, share, colour, stroke, noun }) {
  const margin = { top: 16, right: 20, bottom: 38, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const stack = d3
    .stack()
    .keys(model.layers)
    // Grouped layers keep their order so a class's shades stay together.
    .order(share || model.grouped ? d3.stackOrderNone : d3.stackOrderInsideOut)
    .offset(share ? d3.stackOffsetExpand : d3.stackOffsetWiggle);
  const records = share ? shareRecords(model) : model.records;
  const series = stack(records);
  const x = d3
    .scaleLinear()
    .domain(d3.extent(records, (record) => record.decade))
    .range([0, innerWidth]);
  const y = d3
    .scaleLinear()
    .domain(
      share
        ? [0, 1]
        : [d3.min(series, (layer) => d3.min(layer, (point) => point[0])),
           d3.max(series, (layer) => d3.max(layer, (point) => point[1]))]
    )
    .range([innerHeight, 0]);
  if (!share) y.nice();
  const area = d3
    .area()
    .x((point) => x(point.data.decade))
    .y0((point) => y(point[0]))
    .y1((point) => y(point[1]))
    .curve(d3.curveMonotoneX);

  const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const tickCount = Math.max(3, Math.min(records.length, Math.floor(innerWidth / 70)));
  chart
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(tickCount)
        .tickFormat((decade) => `${decade}s`)
    );
  if (share) {
    chart
      .append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  }

  const paths = chart
    .append("g")
    .selectAll("path")
    .data(series)
    .join("path")
    .attr("class", "stream-layer")
    .attr("d", area)
    .attr("fill", (layer) => colour(layer.key))
    .attr("fill-opacity", 0.88)
    .attr("stroke", stroke || "#ffffff")
    .attr("stroke-width", 0.6);

  // Hover follows the pointer along a layer: the nearest decade's value and
  // its share of that decade.
  const marker = chart
    .append("line")
    .attr("class", "stream-marker")
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("hidden", true);
  paths
    .on("mousemove", (event, layer) => {
      const [pointerX] = d3.pointer(event, chart.node());
      const decade = Math.round(x.invert(pointerX) / 10) * 10;
      const record = records.find((entry) => entry.decade === decade);
      if (!record) return;
      const total = model.layers.reduce((sum, key) => sum + record[key], 0);
      const value = record[layer.key];
      paths.attr("fill-opacity", (other) => (other === layer ? 1 : 0.35));
      marker.attr("hidden", null).attr("x1", x(decade)).attr("x2", x(decade));
      ui.showTooltip(
        event,
        `${layerLabel(layer.key)} · ${decade}s`,
        `${ui.formatNumber(value)} ${noun}` +
          (total ? ` · ${((100 * value) / total).toFixed(1)}% of the decade` : "")
      );
    })
    .on("mouseleave", () => {
      paths.attr("fill-opacity", 0.88);
      marker.attr("hidden", true);
      ui.hideTooltip();
    });
  return { margin, records };
}
