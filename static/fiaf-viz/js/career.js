// Career strip for the name drawer: a person's works by production year, one
// lane per role, as a beeswarm. Credits are facts about events, not people, so
// one name can work as a writer in one decade and a director in the next; the
// lanes show that shift at a glance. A work credited in two roles appears once
// in each lane.

import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";

const RADIUS = 3.2;
// Smaller dot sizes to try, in order, when a lane would grow taller than
// MAX_HALF above and below its centre line.
const RADII = [RADIUS, 2.6, 2.1, 1.7, 1.4, 1.2];
const MAX_HALF = 44;
const LANE_GAP = 10;
const LABEL_WIDTH = 106;
// Roles beyond this many are merged into one lane.
const MAX_LANES = 5;

// One entry per work and role, with the year parsed. Works without a year are
// counted but not placed.
export function careerModel(items) {
  const dots = [];
  const undated = new Set();
  const roleWorks = new Map();
  for (const item of items) {
    const year = Number.parseInt(item.year, 10);
    if (!Number.isFinite(year) || year <= 0) {
      undated.add(item.work);
      continue;
    }
    for (const role of item.roles) {
      roleWorks.set(role, (roleWorks.get(role) || 0) + 1);
      dots.push({ work: item.work, title: item.title, year, role });
    }
  }
  const ranked = [...roleWorks.entries()]
    .sort((a, b) => b[1] - a[1] || roleLabel(a[0]).localeCompare(roleLabel(b[0])))
    .map(([role]) => role);
  const lanes = ranked.length > MAX_LANES ? ranked.slice(0, MAX_LANES - 1) : ranked;
  const merged = ranked.length > lanes.length;
  const laneOf = (role) => (lanes.includes(role) ? role : null);
  // In the merged lane one work shows once even if it has several minor roles.
  const seen = new Set();
  const placed = [];
  for (const dot of dots) {
    const lane = laneOf(dot.role);
    if (lane === null) {
      const key = dot.work;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    placed.push({ ...dot, lane });
  }
  return {
    dots: placed,
    lanes: merged ? [...lanes, null] : lanes,
    undated: undated.size,
    dated: new Set(dots.map((dot) => dot.work)).size
  };
}

// Place dots along x and pile them up and down from the lane's centre line
// without overlap. Returns the half-height the lane needs.
export function dodge(dots, x, radius = RADIUS) {
  const diameter = radius * 2 + 0.6;
  const placed = [];
  let extent = radius;
  const position = (dot) => x(dot.at ?? dot.year);
  const sorted = [...dots].sort((a, b) => position(a) - position(b));
  for (const dot of sorted) {
    dot.x = position(dot);
    const near = placed.filter((other) => Math.abs(other.x - dot.x) < diameter);
    let offset = 0;
    for (let step = 0; ; step += 1) {
      offset = step === 0 ? 0 : Math.ceil(step / 2) * diameter * (step % 2 ? -1 : 1);
      const clash = near.some((other) => {
        const dx = other.x - dot.x;
        const dy = other.dy - offset;
        return dx * dx + dy * dy < diameter * diameter;
      });
      if (!clash) break;
    }
    dot.dy = offset;
    placed.push(dot);
    extent = Math.max(extent, Math.abs(offset) + radius);
  }
  return extent;
}

export function renderCareer(container, items, { colorFor, onSelect, capped }) {
  const model = careerModel(items);
  const section = ui.node("section", "drawer-meta-section career");
  section.append(ui.node("h3", "drawer-section-title", "Career"));
  if (!model.dots.length) {
    section.append(
      ui.node("p", "drawer-section-note", "None of these works has a production year.")
    );
    container.append(section);
    return;
  }

  const width = Math.max(260, container.clientWidth || 380);
  const plotWidth = width - LABEL_WIDTH - 12;
  const [first, last] = d3.extent(model.dots, (dot) => dot.year);
  const start = Math.floor(first / 10) * 10;
  const end = Math.max(start + 10, Math.ceil((last + 1) / 10) * 10);
  const x = d3.scaleLinear().domain([start, end]).range([RADIUS, plotWidth - RADIUS]);

  // Years are the finest resolution, so spread each lane's works for one year
  // evenly across that year instead of stacking them on one x.
  for (const group of d3.group(model.dots, (dot) => dot.lane, (dot) => dot.year).values()) {
    for (const [year, dots] of group) {
      dots.forEach((dot, index) => {
        dot.at = year + (index + 0.5) / dots.length;
      });
    }
  }

  // A busy career piles hundreds of dots into a few decades. Shrink the dots
  // until every lane fits, rather than letting one lane run off the drawer.
  let radius = RADIUS;
  let lanes = [];
  for (radius of RADII) {
    lanes = model.lanes.map((role) => {
      const dots = model.dots.filter((dot) => dot.lane === role);
      return { role, dots, half: dodge(dots, x, radius) };
    });
    if (d3.max(lanes, (lane) => lane.half) <= MAX_HALF) break;
  }
  let y = 4;
  for (const lane of lanes) {
    lane.y = y + lane.half;
    y += lane.half * 2 + LANE_GAP;
  }
  const axisTop = y;
  const height = axisTop + 22;

  const svg = d3
    .select(section)
    .append("svg")
    .attr("class", "career-strip")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img")
    .attr(
      "aria-label",
      `Works by production year, ${start}s to ${end - 10}s, one row per role`
    );
  const plot = svg.append("g").attr("transform", `translate(${LABEL_WIDTH},0)`);

  const ticks = d3.range(start, end + 1, end - start > 60 ? 20 : 10);
  plot
    .append("g")
    .attr("class", "career-grid")
    .selectAll("line")
    .data(ticks)
    .join("line")
    .attr("x1", x)
    .attr("x2", x)
    .attr("y1", 0)
    .attr("y2", axisTop);
  plot
    .append("g")
    .attr("class", "career-axis")
    .selectAll("text")
    .data(ticks)
    .join("text")
    .attr("x", x)
    .attr("y", axisTop + 14)
    .attr("text-anchor", "middle")
    .text((year) => `${year}s`);

  const laneGroups = svg
    .selectAll("g.career-lane")
    .data(lanes)
    .join("g")
    .attr("class", "career-lane");
  laneGroups
    .append("text")
    .attr("class", "career-lane-label")
    .attr("x", LABEL_WIDTH - 8)
    .attr("y", (lane) => lane.y)
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .text((lane) => ui.truncate(lane.role ? roleLabel(lane.role) : "Other roles", 16));

  plot
    .append("g")
    .selectAll("circle")
    .data(lanes.flatMap((lane) => lane.dots.map((dot) => ({ ...dot, laneY: lane.y }))))
    .join("circle")
    .attr("class", "career-dot")
    .attr("cx", (dot) => dot.x)
    .attr("cy", (dot) => dot.laneY + dot.dy)
    .attr("r", radius)
    .style("stroke-width", radius < 2 ? 0.3 : null)
    .style("fill", (dot) => colorFor(dot.role))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (dot) => `${dot.title}, ${dot.year}. Activate to open.`)
    .on("mouseenter", (event, dot) =>
      ui.showTooltip(event, dot.title, `${dot.year} · ${roleLabel(dot.role)}`)
    )
    .on("mousemove", ui.moveTooltip)
    .on("mouseleave", ui.hideTooltip)
    .on("click", (_event, dot) => {
      ui.hideTooltip();
      onSelect(dot);
    })
    .on("keydown", (event, dot) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(dot);
      }
    });

  const notes = [
    `${ui.formatNumber(model.dated)} dated works`,
    model.undated ? `${ui.formatNumber(model.undated)} without a production year` : null,
    capped ? "from the first 500 credited works" : null
  ].filter(Boolean);
  section.append(ui.node("p", "drawer-section-note", notes.join(" · ")));
  container.append(section);
}

