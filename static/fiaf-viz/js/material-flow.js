// Material flow for the Breakdowns tab: parallel sets of items across holding
// institution, format, element, base, colour and status.
//
// Each column is one dimension and each block one value, as tall as its items.
// Ribbons between neighbouring columns carry the items that share both values,
// coloured by their value in the first column, so one archive's or one
// format's items can be followed across the whole chart. Hovering a block
// draws exactly the items through it on top of the ribbons. Columns can be
// hidden and reordered; everything is computed from one query's rows.

import { humanize } from "./labels.js";
import { runQuery } from "./sparql.js";
import * as ui from "./ui.js";

export const DIMENSIONS = [
  { key: "institution", title: "Holding institution" },
  { key: "format", title: "Format" },
  { key: "element", title: "Element" },
  { key: "base", title: "Base" },
  { key: "colour", title: "Colour" },
  { key: "status", title: "Status" }
];
export const NONE = "__none";
export const OTHER = "__other";
const TOP_VALUES = 8;
const NODE_WIDTH = 14;
const NODE_GAP = 8;
const PALETTE = ui.ROLE_PALETTE;

// Sum the rows over the chosen dimensions. Each dimension keeps its top
// values; the rest become "Other" and empty values "Not recorded", both
// placed last. Every path has a value on every axis, so each column adds up
// to the same total.
export function flowModel(rows, axes, topValues = TOP_VALUES) {
  const totals = axes.map(() => new Map());
  for (const row of rows) {
    const items = Number(row.items) || 0;
    axes.forEach((axis, index) => {
      const value = row[axis] || NONE;
      totals[index].set(value, (totals[index].get(value) || 0) + items);
    });
  }
  const keep = totals.map((counts) =>
    new Set(
      [...counts.entries()]
        .filter(([value]) => value !== NONE)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topValues)
        .map(([value]) => value)
    )
  );
  const category = (index, value) => {
    const raw = value || NONE;
    if (raw === NONE) return NONE;
    return keep[index].has(raw) ? raw : OTHER;
  };

  const paths = new Map();
  for (const row of rows) {
    const items = Number(row.items) || 0;
    if (!items) continue;
    const values = axes.map((axis, index) => category(index, row[axis]));
    const key = values.join("\u0001");
    if (!paths.has(key)) paths.set(key, { values, items: 0 });
    paths.get(key).items += items;
  }
  const pathList = [...paths.values()];

  const nodes = axes.map((axis, index) => {
    const counts = new Map();
    const others = new Set();
    for (const row of rows) {
      const value = category(index, row[axis]);
      if (value === OTHER) others.add(row[axis]);
    }
    for (const path of pathList) {
      counts.set(path.values[index], (counts.get(path.values[index]) || 0) + path.items);
    }
    const rank = (value) => (value === NONE ? 2 : value === OTHER ? 1 : 0);
    return [...counts.entries()]
      .map(([value, items]) => ({ axis, index, value, items, others: value === OTHER ? others.size : 0 }))
      .sort((a, b) => rank(a.value) - rank(b.value) || b.items - a.items);
  });
  const total = pathList.reduce((sum, path) => sum + path.items, 0);
  return { axes, nodes, paths: pathList, total, links: linksFor(pathList, axes.length) };
}

// Ribbons between neighbouring columns, keyed by both ends and the colour
// (the path's first-column value).
function linksFor(paths, columns) {
  const links = [];
  for (let index = 0; index < columns - 1; index += 1) {
    const grouped = new Map();
    for (const path of paths) {
      const source = path.values[index];
      const target = path.values[index + 1];
      const colour = path.values[0];
      const key = `${source}\u0001${target}\u0001${colour}`;
      if (!grouped.has(key)) grouped.set(key, { index, source, target, colour, items: 0, key });
      grouped.get(key).items += path.items;
    }
    links.push([...grouped.values()]);
  }
  return links;
}

// Positions: columns spread across the width, one vertical scale shared by
// all columns, and ribbon ends stacked inside their blocks in the order of
// the block at the other end (then by colour) so ribbons cross as little as
// they can.
export function layoutFlow(model, width, height) {
  const columns = model.axes.length;
  const x = (index) => (columns === 1 ? 0 : (index * (width - NODE_WIDTH)) / (columns - 1));
  const maxGaps = Math.max(0, ...model.nodes.map((column) => (column.length - 1) * NODE_GAP));
  const scale = model.total ? (height - maxGaps) / model.total : 0;
  const nodeAt = new Map();
  model.nodes.forEach((column, index) => {
    let y = 0;
    column.forEach((node, order) => {
      Object.assign(node, { x0: x(index), x1: x(index) + NODE_WIDTH, y0: y, y1: y + node.items * scale, order });
      nodeAt.set(`${index}\u0001${node.value}`, node);
      y = node.y1 + NODE_GAP;
    });
  });
  const colourOrder = new Map((model.nodes[0] || []).map((node, order) => [node.value, order]));
  model.links.forEach((links, index) => {
    const source = (link) => nodeAt.get(`${index}\u0001${link.source}`);
    const target = (link) => nodeAt.get(`${index + 1}\u0001${link.target}`);
    const byColour = (a, b) => (colourOrder.get(a.colour) ?? 0) - (colourOrder.get(b.colour) ?? 0);
    const outgoing = d3.group(links, (link) => link.source);
    for (const [, group] of outgoing) {
      let y = source(group[0]).y0;
      for (const link of [...group].sort((a, b) => target(a).order - target(b).order || byColour(a, b))) {
        link.sy0 = y;
        link.sy1 = y + link.items * scale;
        link.x0 = source(link).x1;
        y = link.sy1;
      }
    }
    const incoming = d3.group(links, (link) => link.target);
    for (const [, group] of incoming) {
      let y = target(group[0]).y0;
      for (const link of [...group].sort((a, b) => source(a).order - source(b).order || byColour(a, b))) {
        link.ty0 = y;
        link.ty1 = y + link.items * scale;
        link.x1 = target(link).x0;
        y = link.ty1;
      }
    }
  });
  return { scale, nodeAt };
}

// The ribbons of only the paths through one block, each drawn from the top of
// its parent ribbon's slot: the subset always fits inside the full ribbon.
export function subsetLinks(model, layout, axisIndex, value) {
  const chosen = model.paths.filter((path) => path.values[axisIndex] === value);
  const subset = linksFor(chosen, model.axes.length);
  return subset.flatMap((links, index) => {
    const parents = new Map(model.links[index].map((link) => [link.key, link]));
    return links.map((link) => {
      const parent = parents.get(link.key);
      const height = link.items * layout.scale;
      return {
        ...link,
        x0: parent.x0,
        x1: parent.x1,
        sy0: parent.sy0,
        sy1: parent.sy0 + height,
        ty0: parent.ty0,
        ty1: parent.ty0 + height
      };
    });
  });
}

export function ribbon(link) {
  const middle = (link.x0 + link.x1) / 2;
  return (
    `M${link.x0},${link.sy0}C${middle},${link.sy0} ${middle},${link.ty0} ${link.x1},${link.ty0}` +
    `L${link.x1},${link.ty1}C${middle},${link.ty1} ${middle},${link.sy1} ${link.x0},${link.sy1}Z`
  );
}

export function valueLabel(value, others = 0) {
  if (value === NONE) return "Not recorded";
  if (value === OTHER) return others ? `Other (${others} values)` : "Other";
  return /^https?:\/\//.test(value) ? humanize(value) : value;
}

export function create(ctx, root, controlsElement, statsElement) {
  let rows = null;
  let rowsScope = null;
  let axes = DIMENSIONS.map((dimension) => dimension.key);
  let pinned = null;
  let drawnWidth = -1;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const svg = d3.select(root).append("svg").attr("class", "flow-svg").attr("role", "group");

  async function load({ signal } = {}) {
    const scope = ctx.scopeFilter();
    if (!rows || rowsScope !== scope) {
      ui.message(root, "Loading the material flow…");
      ui.setStatus("Loading items by institution, format, element, base, colour and status…");
      const result = await runQuery("material-flow", { SCOPE_FILTER: scope }, { signal });
      if (signal && signal.aborted) return;
      rows = result;
      rowsScope = scope;
      ui.setStatus("");
    }
    draw();
  }

  // Column toggles are plain checkboxes, like the sidebar's role list.
  function renderControls() {
    if (!controlsElement) return;
    controlsElement.replaceChildren();
    const group = ui.node("fieldset", "flow-columns");
    group.append(ui.node("legend", "", "Columns"));
    for (const dimension of DIMENSIONS) {
      const shown = axes.includes(dimension.key);
      const label = ui.node("label", "flow-column");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = shown;
      // At least two columns stay, so there is always a flow to draw.
      box.disabled = shown && axes.length <= 2;
      box.addEventListener("change", () => {
        axes = box.checked ? [...axes, dimension.key] : axes.filter((key) => key !== dimension.key);
        pinned = null;
        draw();
      });
      label.append(box, document.createTextNode(dimension.title));
      group.append(label);
    }
    controlsElement.append(
      group,
      ui.node("p", "stats flow-controls-hint", "Drag a column heading, or focus it and use the arrow keys, to reorder.")
    );
  }

  function draw() {
    if (!rows) return;
    ui.clear(root);
    renderControls();
    drawnWidth = root.clientWidth;
    const model = flowModel(rows, axes);
    const width = Math.max(560, root.clientWidth || 960);
    const labelRoom = 150;
    const top = 40;
    const plotHeight = Math.max(380, Math.min(640, window.innerHeight * 0.6));
    const plotWidth = width - labelRoom - 12;
    const layout = layoutFlow(model, plotWidth, plotHeight);
    const height = top + plotHeight + 12;
    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("aria-label", `Items across ${axes.map((key) => DIMENSIONS.find((d) => d.key === key).title).join(", ")}`);
    svg.selectAll("*").remove();
    const plot = svg.append("g").attr("transform", `translate(6,${top})`);

    const colourIndex = new Map((model.nodes[0] || []).map((node, index) => [node.value, index]));
    const colourOf = (value) =>
      value === NONE || value === OTHER ? "var(--role-other)" : PALETTE[(colourIndex.get(value) || 0) % PALETTE.length];
    const title = (key) => DIMENSIONS.find((dimension) => dimension.key === key).title;
    const nodeLabel = (node) => valueLabel(node.value, node.others);

    const links = plot
      .append("g")
      .attr("class", "flow-links")
      .selectAll("path")
      .data(model.links.flat())
      .join("path")
      .attr("class", "flow-link")
      .attr("d", ribbon)
      .attr("fill", (link) => colourOf(link.colour))
      .on("mouseenter", (event, link) => {
        ui.showTooltip(
          event,
          `${valueLabel(link.source)} → ${valueLabel(link.target)}`,
          `${countText(link.items)} · ${title(axes[0])}: ${valueLabel(link.colour)}`
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip);
    const overlay = plot.append("g").attr("class", "flow-overlay");

    const columnNodes = model.nodes.flat();
    const nodes = plot
      .append("g")
      .selectAll("g")
      .data(columnNodes)
      .join("g")
      .attr("class", "flow-node")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (node) => `${title(node.axis)} ${nodeLabel(node)}: ${countText(node.items)}. Activate to highlight.`);
    nodes
      .append("rect")
      .attr("x", (node) => node.x0)
      .attr("y", (node) => node.y0)
      .attr("width", NODE_WIDTH)
      .attr("height", (node) => Math.max(1, node.y1 - node.y0))
      .attr("fill", (node) => (node.index === 0 ? colourOf(node.value) : "var(--muted)"));
    const last = axes.length - 1;
    nodes
      .filter((node) => node.y1 - node.y0 >= 9)
      .append("text")
      .attr("class", "flow-node-label")
      .attr("x", (node) => (node.index === last ? node.x0 - 6 : node.x1 + 6))
      .attr("y", (node) => (node.y0 + node.y1) / 2)
      .attr("dy", "0.32em")
      .attr("text-anchor", (node) => (node.index === last ? "end" : "start"))
      .text((node) => ui.truncate(nodeLabel(node), 22))
      .append("tspan")
      .attr("class", "flow-node-count")
      .text((node) => ` ${shortCount(node.items)}`);

    const highlight = (node) => {
      overlay.selectAll("*").remove();
      links.classed("is-dim", Boolean(node));
      nodes.classed("is-dim", (other) => Boolean(node) && !touches(node, other));
      if (!node) return;
      overlay
        .selectAll("path")
        .data(subsetLinks(model, layout, node.index, node.value))
        .join("path")
        .attr("class", "flow-link flow-link-highlight")
        .attr("d", ribbon)
        .attr("fill", (link) => colourOf(link.colour));
    };
    // Blocks reached by the highlighted block's items stay bright.
    const touches = (node, other) =>
      model.paths.some((path) => path.values[node.index] === node.value && path.values[other.index] === other.value);
    const describe = (node) => {
      const share = model.total ? node.items / model.total : 0;
      return `${countText(node.items)} · ${(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of the items shown${
        node.value === OTHER ? ` · ${node.others} smaller values grouped` : ""
      }`;
    };
    nodes
      .on("mouseenter", (event, node) => {
        if (!pinned) highlight(node);
        ui.showTooltip(event, `${title(node.axis)}: ${nodeLabel(node)}`, describe(node));
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", () => {
        ui.hideTooltip();
        if (!pinned) highlight(null);
      })
      .on("click", (_event, node) => togglePin(node))
      .on("keydown", (event, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          togglePin(node);
        }
      });
    function togglePin(node) {
      const same = pinned && pinned.index === node.index && pinned.value === node.value;
      pinned = same ? null : { index: node.index, value: node.value };
      highlight(same ? null : node);
      nodes.classed("is-pinned", (other) => Boolean(pinned) && other.index === pinned.index && other.value === pinned.value);
      renderStats(model, same ? null : node);
    }

    // Column headings: drag sideways, or focus and use the arrow keys, to
    // move a column.
    const step = axes.length > 1 ? (plotWidth - NODE_WIDTH) / (axes.length - 1) : 0;
    const headings = svg
      .append("g")
      .selectAll("g")
      .data(axes)
      .join("g")
      .attr("class", "flow-heading")
      .attr("transform", (_key, index) => `translate(${6 + index * step},${top - 14})`)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (key) => `${title(key)} column. Use the arrow keys to move it.`)
      .on("keydown", (event, key) => {
        const index = axes.indexOf(key);
        const move = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (!move) return;
        event.preventDefault();
        moveAxis(index, index + move, key);
      })
      .call(
        d3.drag()
          .on("start", function () {
            d3.select(this).classed("is-dragging", true);
          })
          .on("drag", function (event, key) {
            const index = axes.indexOf(key);
            d3.select(this).attr("transform", `translate(${6 + index * step + event.x - event.subject.x},${top - 14})`);
          })
          .on("end", function (event, key) {
            d3.select(this).classed("is-dragging", false);
            const index = axes.indexOf(key);
            const target = step ? Math.round((index * step + event.x - event.subject.x) / step) : index;
            moveAxis(index, target, key);
          })
      );
    headings
      .append("text")
      .attr("class", "flow-heading-label")
      .attr("text-anchor", (_key, index) => (index === last && axes.length > 1 ? "end" : "start"))
      .attr("x", (_key, index) => (index === last && axes.length > 1 ? NODE_WIDTH : 0))
      .text((key) => `⇆ ${title(key)}`);

    if (pinned) {
      const node = columnNodes.find((entry) => entry.index === pinned.index && entry.value === pinned.value);
      if (node) {
        highlight(node);
        nodes.classed("is-pinned", (other) => other === node);
      } else {
        pinned = null;
      }
    }
    renderStats(model, pinned ? columnNodes.find((entry) => entry.index === pinned.index && entry.value === pinned.value) : null);
    if (!reduceMotion.matches) {
      links.attr("opacity", 0).transition().duration(300).attr("opacity", null);
    }
  }

  function moveAxis(from, to, key) {
    const target = Math.max(0, Math.min(axes.length - 1, to));
    if (target !== from) {
      axes = axes.filter((entry) => entry !== key);
      axes.splice(target, 0, key);
      pinned = null;
    }
    draw();
    // Keep keyboard focus on the moved heading.
    const heading = svg.selectAll(".flow-heading").filter((entry) => entry === key).node();
    if (heading && typeof heading.focus === "function") heading.focus();
  }

  function renderStats(model, node) {
    if (!statsElement) return;
    const parts = [
      `${countText(model.total)} across ${model.paths.length} combinations`,
      `ribbons coloured by ${DIMENSIONS.find((dimension) => dimension.key === axes[0]).title.toLowerCase()}`
    ];
    if (node) parts.unshift(`${valueLabel(node.value, node.others)}: ${countText(node.items)}`);
    statsElement.textContent = parts.join(" · ");
  }

  return {
    load,
    resize() {
      if (rows && root.clientWidth !== drawnWidth) draw();
    },
    redraw() {
      if (rows) draw();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-material-flow.svg" };
    }
  };
}

function countText(count) {
  return `${ui.formatNumber(count)} ${count === 1 ? "item" : "items"}`;
}

function shortCount(count) {
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return ui.formatNumber(count);
}

