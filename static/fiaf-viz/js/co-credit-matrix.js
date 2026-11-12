// Co-credit adjacency matrix: an alternative to the co-credit network.
//
// The network turns into a hairball once a few hundred names share works. A
// matrix stays readable at any density: every name is a row and a column, and a
// filled cell is a pair of names credited on the same works. Cells are coloured
// by role when both names have the same dominant role, so blocks of directors
// and cinematographers, or of cast, stand out; their opacity follows the shared
// work count. Rows can be ordered by cluster, by shared works, by name or by
// role, and a reorder animates so the blocks can be followed.
//
// It draws only the strongest names (see MAX_NAMES): beyond that cells are
// smaller than a few pixels and labels can no longer be read.

import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";

export const MAX_NAMES = 60;
const LABEL_SPACE = 180;
const MIN_CELL = 9;
const MAX_CELL = 22;
const ORDER_MS = 750;
// Cluster ordering looks back at this many placed names when choosing the next.
const CLUSTER_WINDOW = 4;

// Pick the strongest names and the pairs among them. Names are ranked by the
// sum of their shared works with the other names in the pairs.
export function matrixData(pairs, names, maxNames = MAX_NAMES) {
  const weight = new Map();
  for (const pair of pairs) {
    weight.set(pair.source, (weight.get(pair.source) || 0) + pair.shared);
    weight.set(pair.target, (weight.get(pair.target) || 0) + pair.shared);
  }
  const ranked = [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, maxNames);
  const kept = new Set(ranked.map(([id]) => id));
  const links = pairs.filter((pair) => kept.has(pair.source) && kept.has(pair.target));
  const nodes = ranked.map(([id, total], index) => ({
    id,
    index,
    name: names.get(id) || id,
    weight: total,
    shared: 0
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const link of links) {
    byId.get(link.source).shared += link.shared;
    byId.get(link.target).shared += link.shared;
  }
  return { nodes, links, total: weight.size };
}

// Seriation that keeps names who work together next to each other: start from
// the strongest name, then repeatedly place the name with the most shared works
// with the last few placed names (nearer ones weigh more). Names with no pair
// among the drawn ones fall to the end in weight order.
export function clusterOrder(nodes, links) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Map()]));
  for (const link of links) {
    adjacency.get(link.source).set(link.target, link.shared);
    adjacency.get(link.target).set(link.source, link.shared);
  }
  const remaining = new Set(nodes.map((node) => node.id));
  const byWeight = [...nodes].sort((a, b) => b.shared - a.shared || b.weight - a.weight);
  const order = [];
  while (remaining.size) {
    let best = null;
    let bestScore = 0;
    const recent = order.slice(-CLUSTER_WINDOW).reverse();
    for (const id of remaining) {
      let score = 0;
      recent.forEach((placed, distance) => {
        score += (adjacency.get(placed).get(id) || 0) / (distance + 1);
      });
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    // Nothing links to the recent names: start a new block from the strongest
    // name left.
    if (best === null) best = byWeight.find((node) => remaining.has(node.id)).id;
    order.push(best);
    remaining.delete(best);
  }
  return order;
}

export function createMatrix(ctx, container) {
  let model = null;
  let roleMap = null;
  let orderMode = "cluster";
  let selectedIds = new Set();
  let svg = null;
  let scale = null;
  let rows = null;
  let columns = null;

  const reducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function roleOf(id) {
    return ctx.dominantRole ? ctx.dominantRole(id, roleMap) : null;
  }

  function orderedIds() {
    const nodes = model.nodes;
    if (orderMode === "name") {
      return [...nodes].sort((a, b) => a.name.localeCompare(b.name)).map((node) => node.id);
    }
    if (orderMode === "shared") {
      return [...nodes].sort((a, b) => b.shared - a.shared).map((node) => node.id);
    }
    if (orderMode === "role") {
      // Roles in the order of their busiest name, names by shared works within.
      const rank = new Map();
      const sorted = [...nodes].sort((a, b) => b.shared - a.shared);
      for (const node of sorted) {
        const role = node.role || "";
        if (!rank.has(role)) rank.set(role, rank.size);
      }
      return sorted
        .sort((a, b) => rank.get(a.role || "") - rank.get(b.role || "") || b.shared - a.shared)
        .map((node) => node.id);
    }
    return clusterOrder(nodes, model.links);
  }

  function render(pairs, names, roles) {
    roleMap = roles;
    model = matrixData(pairs, names);
    for (const node of model.nodes) node.role = roleOf(node.id);
    draw();
    return { shown: model.nodes.length, total: model.total, pairs: model.links.length };
  }

  function draw() {
    container.replaceChildren();
    if (!model || !model.nodes.length) return;
    const n = model.nodes.length;
    const available = Math.max(320, (container.clientWidth || 900) - LABEL_SPACE - 16);
    const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(available / n)));
    const size = cell * n;
    const width = LABEL_SPACE + size + 8;
    const height = LABEL_SPACE + size + 8;
    const fontSize = Math.max(9, Math.min(12, cell - 1));
    const maxShared = d3.max(model.links, (link) => link.shared) || 1;
    const opacity = d3.scaleSqrt().domain([1, maxShared]).range([0.22, 1]).clamp(true);
    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    scale = d3.scaleBand().domain(orderedIds()).range([0, size]);

    // Each row lists its cells; pairs are symmetric so both halves are filled.
    const cells = new Map(model.nodes.map((node) => [node.id, []]));
    for (const link of model.links) {
      cells.get(link.source).push({ row: link.source, column: link.target, shared: link.shared });
      cells.get(link.target).push({ row: link.target, column: link.source, shared: link.shared });
    }
    const cellFill = (entry) => {
      const a = byId.get(entry.row).role;
      const b = byId.get(entry.column).role;
      return a && a === b ? ctx.colorFor(a) : "var(--text)";
    };

    svg = d3
      .select(container)
      .append("svg")
      .attr("class", "matrix")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", `Co-credit matrix of ${n} names`);
    const plot = svg.append("g").attr("transform", `translate(${LABEL_SPACE},${LABEL_SPACE})`);
    plot
      .append("rect")
      .attr("class", "matrix-background")
      .attr("width", size)
      .attr("height", size);

    const bands = plot.append("g").attr("class", "matrix-bands");
    const rowBand = bands.append("rect").attr("class", "matrix-band").attr("width", size).attr("height", cell).attr("hidden", true);
    const columnBand = bands.append("rect").attr("class", "matrix-band").attr("width", cell).attr("height", size).attr("hidden", true);

    rows = plot
      .selectAll("g.matrix-row")
      .data(model.nodes, (node) => node.id)
      .join("g")
      .attr("class", "matrix-row")
      .attr("transform", (node) => `translate(0,${scale(node.id)})`);
    rows
      .append("line")
      .attr("class", "matrix-grid")
      .attr("x2", size);
    rows
      .append("rect")
      .attr("class", "matrix-self")
      .attr("x", (node) => scale(node.id))
      .attr("width", scale.bandwidth())
      .attr("height", scale.bandwidth())
      .style("fill", (node) => (node.role ? ctx.colorFor(node.role) : "var(--muted)"));
    rows
      .selectAll("rect.matrix-cell")
      .data((node) => cells.get(node.id))
      .join("rect")
      .attr("class", "matrix-cell")
      .attr("x", (entry) => scale(entry.column))
      .attr("width", scale.bandwidth())
      .attr("height", scale.bandwidth())
      .style("fill", cellFill)
      .style("fill-opacity", (entry) => opacity(entry.shared));
    rows
      .append("text")
      .attr("class", "matrix-label")
      .attr("x", -6)
      .attr("y", scale.bandwidth() / 2)
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .style("font-size", `${fontSize}px`)
      .text((node) => ui.truncate(node.name, 22));

    columns = plot
      .selectAll("g.matrix-column")
      .data(model.nodes, (node) => node.id)
      .join("g")
      .attr("class", "matrix-column")
      .attr("transform", (node) => `translate(${scale(node.id)},0)rotate(-90)`);
    columns
      .append("line")
      .attr("class", "matrix-grid")
      .attr("x1", -size);
    columns
      .append("text")
      .attr("class", "matrix-label")
      .attr("x", 6)
      .attr("y", scale.bandwidth() / 2)
      .attr("dy", "0.32em")
      .attr("text-anchor", "start")
      .style("font-size", `${fontSize}px`)
      .text((node) => ui.truncate(node.name, 22));

    const showBands = (rowId, columnId) => {
      rowBand.attr("hidden", rowId ? null : true).attr("y", rowId ? scale(rowId) : 0);
      columnBand.attr("hidden", columnId ? null : true).attr("x", columnId ? scale(columnId) : 0);
      rows.classed("is-hovered", (node) => node.id === rowId);
      columns.classed("is-hovered", (node) => node.id === columnId);
    };

    rows
      .selectAll("rect.matrix-cell")
      .on("mouseenter", (event, entry) => {
        showBands(entry.row, entry.column);
        ui.showTooltip(
          event,
          `${byId.get(entry.row).name} × ${byId.get(entry.column).name}`,
          `${ui.formatNumber(entry.shared)} shared works · click to open ${byId.get(entry.row).name}`
        );
      })
      .on("mousemove", (event) => ui.moveTooltip(event))
      .on("mouseleave", () => {
        showBands(null, null);
        ui.hideTooltip();
      })
      .on("click", (_event, entry) => {
        const node = byId.get(entry.row);
        ctx.openAgent(node.id, node.name);
      });

    for (const group of [rows, columns]) {
      group
        .select("text")
        .on("mouseenter", (event, node) => {
          showBands(node.id, node.id);
          ui.showTooltip(
            event,
            node.name,
            `${ui.formatNumber(node.shared)} shared works with the names shown` +
              (node.role ? ` · ${roleLabel(node.role)}` : "")
          );
        })
        .on("mousemove", (event) => ui.moveTooltip(event))
        .on("mouseleave", () => {
          showBands(null, null);
          ui.hideTooltip();
        })
        .on("click", (_event, node) => ctx.openAgent(node.id, node.name));
    }
    applySelection();
  }

  function setOrder(next) {
    orderMode = next;
    if (!model || !svg) return;
    scale.domain(orderedIds());
    // Rows move first, then each row's cells slide to their new columns, in a
    // short stagger down the matrix so the reorder can be followed.
    const animate = !reducedMotion();
    const step = (node) => (scale(node.id) / scale.bandwidth()) * 6;
    const moved = (selection, delay) =>
      animate
        ? selection.transition().duration(ORDER_MS).delay(delay)
        : selection;
    moved(rows, step).attr("transform", (node) => `translate(0,${scale(node.id)})`);
    moved(columns, step).attr(
      "transform",
      (node) => `translate(${scale(node.id)},0)rotate(-90)`
    );
    rows.each(function (node) {
      const row = d3.select(this);
      const delay = animate ? ORDER_MS + step(node) : 0;
      moved(row.selectAll("rect.matrix-cell"), delay).attr("x", (entry) => scale(entry.column));
      moved(row.selectAll("rect.matrix-self"), delay).attr("x", scale(node.id));
    });
  }

  function select(selection) {
    selectedIds = new Set();
    if (selection) {
      if (selection.kind === "agent") selectedIds.add(selection.id);
      for (const id of selection.agentIds || []) selectedIds.add(id);
    }
    applySelection();
  }

  function applySelection() {
    if (!rows) return;
    rows.classed("is-selected", (node) => selectedIds.has(node.id));
    columns.classed("is-selected", (node) => selectedIds.has(node.id));
  }

  // A standalone copy for download: CSS variables and classes do not survive
  // outside the page, so resolve each element's colours onto it.
  function exportSvg() {
    if (!svg) return null;
    const source = svg.node();
    const clone = source.cloneNode(true);
    const originals = source.querySelectorAll("*");
    const copies = clone.querySelectorAll("*");
    const hidden = [];
    originals.forEach((element, index) => {
      const style = getComputedStyle(element);
      const copy = copies[index];
      // Hover bands are hidden by the page's [hidden] rule, which a
      // standalone viewer does not know; leave them out of the file.
      if (style.display === "none") {
        hidden.push(copy);
        return;
      }
      if (element.tagName === "rect" || element.tagName === "line") {
        copy.setAttribute("fill", style.fill);
        copy.setAttribute("fill-opacity", style.fillOpacity);
        copy.setAttribute("stroke", style.stroke);
        copy.setAttribute("stroke-width", style.strokeWidth);
      } else if (element.tagName === "text") {
        copy.setAttribute("fill", style.fill);
        copy.setAttribute("font-family", style.fontFamily);
        copy.setAttribute("font-weight", style.fontWeight);
        // Label sizes are set inline to fit the cells; keep them.
        copy.setAttribute("font-size", style.fontSize);
      }
      copy.removeAttribute("style");
      copy.removeAttribute("class");
    });
    for (const copy of hidden) copy.remove();
    const background = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    const back = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    back.setAttribute("width", "100%");
    back.setAttribute("height", "100%");
    back.setAttribute("fill", background || "#ffffff");
    clone.insertBefore(back, clone.firstChild);
    return { element: clone, name: "fiaf-co-credit-matrix.svg" };
  }

  return {
    render,
    select,
    setOrder,
    // Whether a name is one of the rows drawn, for the app's in-view checks.
    has(id) {
      return Boolean(model && model.nodes.some((node) => node.id === id));
    },
    redraw: draw,
    exportSvg,
    clear() {
      model = null;
      rows = null;
      columns = null;
      svg = null;
      container.replaceChildren();
    }
  };
}

