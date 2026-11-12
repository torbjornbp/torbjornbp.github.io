// Film length: the physical film in the collections, measured in kilometres.
//
// Each physical film item (a print, a negative, a sound negative) counts the
// full length recorded for its manifestation. The view shows the total as a
// headline with a few comparisons, and a zoomable treemap of the length by
// production decade, base and element (in a chosen order); a holding
// institution level is added when there is more than one.

import { MAP_HEAT_RAMP } from "./heat.js";
import { humanize } from "./labels.js";
import { runQuery } from "./sparql.js";
import * as ui from "./ui.js";

export const ORDERS = {
  decade: ["decade", "base", "element"],
  base: ["base", "decade", "element"],
  element: ["element", "base", "decade"]
};

const DIMENSION_TITLES = {
  institution: "Holding institution",
  decade: "Decade",
  base: "Base",
  element: "Element"
};

// 35 mm film runs at 456 mm a second at 24 frames a second (4-perf).
const METRES_PER_MINUTE_35MM = 27.36;
const EARTH_KM = 40075;
const EVEREST_KM = 8.849;
const LONDON_BERLIN_KM = 930;

// The role palette starting from its second colour, so element tiles never
// take role-1, which sits close to the nitrate accent.
const PALETTE = [...ui.ROLE_PALETTE.slice(1), ui.ROLE_PALETTE[0]];
const BASE_COLOURS = {
  NitrateBase: "var(--accent)",
  AcetateBase: "var(--role-2)",
  PolyesterBase: "var(--role-3)"
};

export function valueLabel(dimension, value) {
  if (!value) {
    return {
      decade: "No production year",
      base: "Base not recorded",
      element: "Element not recorded",
      institution: "Institution not recorded"
    }[dimension] || "Not recorded";
  }
  if (dimension === "decade") return `${value}s`;
  return /^https?:\/\//.test(value) ? humanize(value) : value;
}

// The hierarchy for d3: one level per dimension in the order chosen, leaves
// carrying metres and items. A holding institution level comes first when
// the rows hold more than one institution.
export function lengthTree(rows, order = ORDERS.decade) {
  const institutions = new Set(rows.map((row) => row.institution || ""));
  const levels = institutions.size > 1 ? ["institution", ...order] : [...order];
  const root = { name: "All film", dimension: null, value: null, children: new Map(), metres: 0, items: 0 };
  for (const row of rows) {
    const metres = Number(row.length) || 0;
    const items = Number(row.items) || 0;
    if (!metres) continue;
    let node = root;
    node.metres += metres;
    node.items += items;
    for (const dimension of levels) {
      const value = row[dimension] || "";
      if (!node.children.has(value)) {
        node.children.set(value, {
          name: valueLabel(dimension, value),
          dimension,
          value,
          children: new Map(),
          metres: 0,
          items: 0
        });
      }
      node = node.children.get(value);
      node.metres += metres;
      node.items += items;
    }
  }
  const finish = (node) => ({
    ...node,
    children: [...node.children.values()].map(finish)
  });
  return { root: finish(root), levels };
}

// Ways to picture a length, with numbers rounded for reading.
export function projectionText(metres) {
  const hours = metres / METRES_PER_MINUTE_35MM / 60;
  if (hours >= 24 * 365) return `${round(hours / 24 / 365)} years`;
  if (hours >= 48) return `${ui.formatNumber(Math.round(hours / 24))} days`;
  return `${ui.formatNumber(Math.round(hours))} hours`;
}

// "once", "1.4 times": a ratio that rounds to one reads as "once".
function timesText(ratio) {
  const rounded = round(ratio);
  return rounded === "1" ? "once" : `${rounded} times`;
}

export function earthText(metres) {
  const text = timesText(metres / 1000 / EARTH_KM);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function comparisons(metres) {
  const km = metres / 1000;
  const facts = [];
  const earth = km / EARTH_KM;
  if (earth >= 0.1) facts.push(`${timesText(earth)} around the Earth`);
  const londonBerlin = km / LONDON_BERLIN_KM;
  if (londonBerlin >= 1) facts.push(`${timesText(londonBerlin)} from London to Berlin`);
  facts.push(`${ui.formatNumber(Math.round(km / EVEREST_KM))} Everests stacked`);
  facts.push(`${projectionText(metres)} of non-stop projection at 35 mm speed`);
  return facts;
}

function round(value) {
  return value >= 10 ? ui.formatNumber(Math.round(value)) : String(Math.round(value * 10) / 10);
}

export function kmText(metres) {
  const km = metres / 1000;
  if (km >= 100) return `${ui.formatNumber(Math.round(km))} km`;
  if (km >= 1) return `${(Math.round(km * 10) / 10).toLocaleString("en-GB")} km`;
  return `${ui.formatNumber(Math.round(metres))} m`;
}

export function create(ctx, root, statsElement, headlineElement, crumbsElement) {
  let rows = null;
  let rowsScope = null;
  let orderKey = "decade";
  let focusPath = [];
  let drawnWidth = -1;
  const orderButtons = [...document.querySelectorAll("[data-length-order]")];
  const svg = d3.select(root).append("svg").attr("class", "length-svg").attr("role", "group");

  async function load({ signal } = {}) {
    const scope = ctx.scopeFilter();
    if (!rows || rowsScope !== scope) {
      ui.message(root, "Measuring the film…");
      ui.setStatus("Adding up film lengths…");
      rows = await runQuery("film-length", { SCOPE_FILTER: scope }, { signal });
      if (signal && signal.aborted) return;
      rowsScope = scope;
      focusPath = [];
      ui.setStatus("");
    }
    draw();
  }

  function syncControls() {
    for (const button of orderButtons) {
      const active = button.dataset.lengthOrder === orderKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function draw() {
    if (!rows) return;
    syncControls();
    drawnWidth = root.clientWidth;
    const { root: data, levels } = lengthTree(rows, ORDERS[orderKey]);
    renderHeadline(data);
    if (!data.metres) {
      svg.selectAll("*").remove();
      ui.empty(root, "No film lengths are recorded for the works in this selection.");
      if (crumbsElement) crumbsElement.replaceChildren();
      return;
    }
    ui.clear(root);

    // Follow the focus path; drop it if the order or data changed under it.
    let focus = data;
    const path = [data];
    for (const value of focusPath) {
      const next = focus.children.find((child) => child.value === value);
      if (!next) break;
      focus = next;
      path.push(next);
    }
    focusPath = path.slice(1).map((node) => node.value);
    renderCrumbs(path);

    const width = Math.max(320, root.clientWidth || 960);
    const height = Math.max(380, Math.min(620, width * 0.55));
    const hierarchy = d3
      .hierarchy(focus, (node) => (node.children.length ? node.children : null))
      .sum((node) => (node.children.length ? 0 : node.metres))
      .sort((a, b) => b.value - a.value);
    d3.treemap()
      .tile(d3.treemapSquarify.ratio(1.2))
      .size([width, height])
      .paddingOuter(2)
      .paddingTop((node) => (node.depth === 1 ? 20 : 2))
      .paddingInner(2)(hierarchy);

    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("aria-label", `Film length by ${levels.map((level) => DIMENSION_TITLES[level].toLowerCase()).join(", ")}`);
    svg.selectAll("*").remove();

    const decades = [...new Set(rows.map((row) => row.decade).filter(Boolean))].sort();
    const colour = colourer(decades);
    const total = data.metres;
    const ancestorsOf = (node) => [...path.slice(1).map((entry) => entry), ...node.ancestors().reverse().slice(1).map((entry) => entry.data)];

    // Level 1: the focus's children, labelled, clickable to zoom in.
    // Level 2: their children, drawn inside as tiles.
    const groups = svg
      .append("g")
      .selectAll("g")
      .data(hierarchy.children || [])
      .join("g")
      .attr("class", "length-group");
    groups
      .append("rect")
      .attr("class", "length-cell")
      .attr("x", (node) => node.x0)
      .attr("y", (node) => node.y0)
      .attr("width", (node) => Math.max(0, node.x1 - node.x0))
      .attr("height", (node) => Math.max(0, node.y1 - node.y0))
      .attr("fill", (node) => colour(node.data, ancestorsOf(node), node.parent.children.indexOf(node)));
    const tiles = groups
      .selectAll("rect.length-tile")
      .data((node) => node.children || [])
      .join("rect")
      .attr("class", "length-tile")
      .attr("x", (node) => node.x0)
      .attr("y", (node) => node.y0)
      .attr("width", (node) => Math.max(0, node.x1 - node.x0))
      .attr("height", (node) => Math.max(0, node.y1 - node.y0))
      .attr("fill", (node) => colour(node.data, ancestorsOf(node), node.parent.children.indexOf(node)));

    const describe = (node) => {
      const share = node.data.metres / total;
      return [
        kmText(node.data.metres),
        `${ui.formatNumber(node.data.items)} film ${node.data.items === 1 ? "item" : "items"}`,
        `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of the film shown`
      ].join(" · ");
    };
    const pathName = (node) => [...path.slice(1), ...node.ancestors().reverse().slice(1).map((entry) => entry.data)]
      .map((entry) => entry.name)
      .join(" › ");

    groups
      .attr("tabindex", (node) => (node.children ? 0 : null))
      .attr("role", (node) => (node.children ? "button" : null))
      .attr("aria-label", (node) => `${pathName(node)}: ${describe(node)}.${node.children ? " Activate to zoom in." : ""}`)
      .classed("is-zoomable", (node) => Boolean(node.children))
      .on("click", (_event, node) => zoomInto(node))
      .on("keydown", (event, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          zoomInto(node);
        }
      });
    groups.select("rect.length-cell")
      .on("mouseenter", (event, node) => ui.showTooltip(event, pathName(node), describe(node)))
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip);
    tiles
      .on("mouseenter", (event, node) => ui.showTooltip(event, pathName(node), describe(node)))
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip);

    // Labels sit in the group's header band; tiles big enough get one too.
    groups
      .filter((node) => node.x1 - node.x0 > 44)
      .append("text")
      .attr("class", "length-label")
      .attr("x", (node) => node.x0 + 5)
      .attr("y", (node) => node.y0 + 14)
      .text((node) => fit(`${node.data.name} · ${kmText(node.data.metres)}`, node.x1 - node.x0 - 8));
    groups
      .selectAll("text.length-tile-label")
      .data((node) => (node.children || []).filter((tile) => tile.x1 - tile.x0 > 60 && tile.y1 - tile.y0 > 30))
      .join("text")
      .attr("class", "length-tile-label")
      .attr("x", (node) => node.x0 + 4)
      .attr("y", (node) => node.y0 + 13)
      .text((node) => fit(node.data.name, node.x1 - node.x0 - 6))
      .append("tspan")
      .attr("x", (node) => node.x0 + 4)
      .attr("dy", "1.2em")
      .attr("class", "length-tile-value")
      .text((node) => kmText(node.data.metres));

    function zoomInto(node) {
      if (!node.children) return;
      ui.hideTooltip();
      focusPath = [...focusPath, node.data.value];
      draw();
    }

    if (statsElement) {
      const institutions = [...new Set(rows.map((row) => row.institution).filter(Boolean))];
      statsElement.textContent = [
        `${kmText(focus.metres)} in ${ui.formatNumber(focus.items)} film items`,
        focus !== data ? `${((focus.metres / total) * 100).toFixed(1)}% of all recorded film` : null,
        institutions.length ? `lengths recorded by ${institutions.join(", ")}` : null
      ].filter(Boolean).join(" · ");
    }
  }

  // The same stat cards as the World map overview, then the comparisons
  // that do not fit a card as one note.
  function renderHeadline(data) {
    if (!headlineElement) return;
    headlineElement.replaceChildren();
    if (!data.metres) return;
    const card = (label, value) => {
      const element = ui.node("div", "stat-card");
      element.append(ui.node("dt", "stat-label", label), ui.node("dd", "stat-value", value));
      return element;
    };
    const grid = ui.node("dl", "stat-grid");
    grid.setAttribute("aria-label", "Film length overview");
    grid.append(
      card("Film on the shelves", kmText(data.metres)),
      card("Prints, negatives and other elements", ui.formatNumber(data.items)),
      card("Around the Earth", earthText(data.metres)),
      card("Non-stop at 35 mm speed", projectionText(data.metres))
    );
    const others = comparisons(data.metres).filter(
      (fact) => !fact.includes("around the Earth") && !fact.includes("projection")
    );
    headlineElement.append(grid, ui.node("p", "stats length-comparisons", `Also ${others.join(", or ")}.`));
  }

  function renderCrumbs(path) {
    if (!crumbsElement) return;
    crumbsElement.replaceChildren();
    path.forEach((node, index) => {
      if (index) crumbsElement.append(document.createTextNode(" › "));
      if (index === path.length - 1) {
        crumbsElement.append(ui.node("span", "length-crumb-current", node.name));
        return;
      }
      const button = ui.node("button", "catalogue-link", node.name);
      button.type = "button";
      button.addEventListener("click", () => {
        focusPath = focusPath.slice(0, index);
        draw();
      });
      crumbsElement.append(button);
    });
  }

  // Bases keep fixed colours (nitrate in the accent red); decades follow the
  // sequential ramp, oldest palest; anything else uses the palette.
  function colourer(decades) {
    const ramp = MAP_HEAT_RAMP.slice(1, 9);
    return (data, ancestors, index) => {
      const chain = [...ancestors, data];
      const base = chain.find((entry) => entry.dimension === "base");
      if (base) {
        const key = String(base.value || "").split("/").pop();
        return BASE_COLOURS[key] || "var(--role-other)";
      }
      if (data.dimension === "decade") {
        if (!data.value) return "var(--role-other)";
        const position = decades.indexOf(data.value) / Math.max(1, decades.length - 1);
        return ramp[Math.min(ramp.length - 1, Math.round(position * (ramp.length - 1)))];
      }
      if (!data.value) return "var(--role-other)";
      return PALETTE[index % PALETTE.length];
    };
  }

  for (const button of orderButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.lengthOrder === orderKey) return;
      orderKey = button.dataset.lengthOrder;
      focusPath = [];
      draw();
    });
  }

  return {
    load,
    resize() {
      if (rows && root.clientWidth !== drawnWidth) draw();
    },
    restyle() {
      if (rows) draw();
    },
    fit() {
      focusPath = [];
      if (rows) draw();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-film-length.svg" };
    }
  };
}

// Shorten a label to roughly fit a width, at about 6.4 px a character.
function fit(text, width) {
  return ui.truncate(text, Math.max(3, Math.floor(width / 6.4)));
}
