// Shared logarithmic heat ramp, thresholds and legend for the map/heatmap views.

import { formatNumber } from "./ui.js";

export const HEAT_RAMP = [
  "var(--heat-1)",
  "var(--heat-2)",
  "var(--heat-3)",
  "var(--heat-4)",
  "var(--heat-5)"
];

// The world map has room for a finer ramp: ten steps from the palest data
// colour to the deepest, so neighbouring countries with different counts can
// still be told apart. Values come from the --map-heat-* theme tokens.
export const MAP_HEAT_RAMP = Array.from({ length: 10 }, (_, index) => `var(--map-heat-${index + 1})`);

// Counts are long-tailed: space thresholds evenly in log space, rounded to one
// significant digit.
export function heatScale(maximum, ramp = HEAT_RAMP) {
  if (maximum < 2) {
    const top = ramp[ramp.length - 1];
    return { colour: () => top, edges: [], range: [top] };
  }
  const span = Math.log10(maximum + 1);
  const edges = [];
  for (let index = 1; index < ramp.length; index += 1) {
    const value = roundStep(Math.pow(10, (span * index) / ramp.length));
    if (value > 1 && value < maximum && !edges.includes(value)) edges.push(value);
  }
  const range = ramp.slice(ramp.length - 1 - edges.length);
  return { colour: d3.scaleThreshold().domain(edges).range(range), edges, range };
}

function roundStep(value) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.max(2, Math.round(value / magnitude) * magnitude);
}

// Percentages are bounded shares rather than long-tailed counts, so use evenly
// stepped bands instead of the logarithmic count scale. The bands still adapt
// to the maximum so small shares remain readable.
export function heatPercentScale(maximum, ramp = HEAT_RAMP) {
  const top = ramp[ramp.length - 1];
  const max = Number(maximum) || 0;
  if (max <= 0) {
    return { colour: () => top, edges: [], range: [top], isPercent: true };
  }
  // Pick the largest 1/2/5 step that still leaves a band for every ramp
  // colour, so small maxima keep the full light-to-dark range.
  const step = niceStepBelow(max / (ramp.length - 1));
  const edges = [];
  for (let index = 1; index < ramp.length; index += 1) {
    const value = cleanNumber(step * index);
    if (value < max && !edges.includes(value)) edges.push(value);
  }
  const range = ramp.slice(ramp.length - 1 - edges.length);
  return {
    colour: d3.scaleThreshold().domain(edges).range(range),
    edges,
    range,
    isPercent: true
  };
}

function niceStepBelow(value) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalised = value / magnitude;
  const factor = normalised > 5 ? 5 : normalised > 2 ? 2 : normalised > 1 ? 1 : 0.5;
  return cleanNumber(factor * magnitude);
}

function cleanNumber(value) {
  return Number(value.toPrecision(12));
}

function formatPercentBound(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0%";
  if (number >= 10) return `${Math.round(number)}%`;
  if (number >= 1) return `${Number(number.toFixed(1))}%`;
  if (number >= 0.1) return `${Number(number.toFixed(2))}%`;
  return `${Number(number.toPrecision(2))}%`;
}

export function drawHeatLegend(svg, options) {
  const {
    edges, range, left, top, label,
    isPercent = false,
    zeroFill = "var(--surface)",
    zeroLabel = isPercent ? "0%" : "0",
    stepWidth = 34,
    // Label every nth swatch (the first and last always), for long ramps.
    labelEvery = 1
  } = options;
  const bounds = isPercent ? [0, ...edges] : [1, ...edges];
  const legend = svg
    .append("g")
    .attr("class", "heat-legend")
    .attr("transform", `translate(${left},${top})`);
  legend.append("text").attr("y", -8).text(label);
  const swatches = [{ fill: zeroFill, label: zeroLabel }].concat(
    range.map((fill, index) => {
      if (isPercent) {
        const lower = bounds[index];
        return {
          fill,
          label:
            index === range.length - 1
              ? `${formatPercentBound(lower)}+`
              : index === 0
                ? `<${formatPercentBound(bounds[index + 1])}`
                : formatPercentBound(lower)
        };
      }
      return {
        fill,
        label: index === range.length - 1
          ? `${formatNumber(bounds[index])}+`
          : formatNumber(bounds[index])
      };
    })
  );
  legend.append("g").selectAll("rect")
    .data(swatches).join("rect")
    .attr("x", (swatch, index) => index * stepWidth)
    .attr("width", stepWidth + 0.5)
    .attr("height", 12)
    .attr("fill", (swatch) => swatch.fill);
  const labelled = swatches.filter(
    (swatch, index) => index % labelEvery === 0 || index === swatches.length - 1
  );
  legend.append("g").selectAll("text")
    .data(labelled).join("text")
    .attr("x", (swatch) => swatches.indexOf(swatch) * stepWidth + stepWidth / 2)
    .attr("y", 26)
    .attr("text-anchor", "middle")
    .text((swatch) => swatch.label);
  return legend;
}
