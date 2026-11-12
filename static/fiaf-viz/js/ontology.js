// Ontology explorer: the FIAFcore schema, read from the graph itself.
//
// "Class tree" is a zoomable icicle of every class (rdfs:subClassOf), shaded
// by how many records use the class or one of its subclasses; classes no
// record uses are drawn as faint ghosts. "Schema graph" shows what the
// properties connect: the top-level classes as nodes and one arrow per
// property and class pair, weighted by an estimate of its triples. Counts
// cover the whole public graph; the dataset selection does not apply.

import { MAP_HEAT_RAMP, heatScale } from "./heat.js";
import {
  FIAF_NS,
  LITERAL,
  ancestors,
  classQuery,
  classTree,
  literalProperties,
  propertyQuery,
  schemaGraph
} from "./ontology-model.js";
import { limit, runQuery, sparqlIri } from "./sparql.js";
import * as ui from "./ui.js";

// Levels of the icicle shown side by side.
const COLUMNS = 4;
const ACTIVITY = `${FIAF_NS}Activity`;

const local = (iri) => (String(iri || "").startsWith(FIAF_NS) ? String(iri).slice(FIAF_NS.length) : String(iri || ""));

function countText(count, singular, plural) {
  return `${ui.formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function useText(node) {
  const parts = [];
  if (node.total) parts.push(countText(node.total, "record", "records"));
  if (node.valueTotal) parts.push(`${ui.formatNumber(node.valueTotal)} uses as a value`);
  return parts.join(", ") || "not used in the data";
}

function shortUse(node) {
  if (node.total) return ui.formatNumber(node.total);
  if (node.valueTotal) return `${ui.formatNumber(node.valueTotal)} as value`;
  return "unused";
}

// Whether a ramp colour (a CSS variable) is light, resolved from the theme.
function isLightFill(value) {
  const name = /var\((--[\w-]+)\)/.exec(String(value || ""));
  const resolved = name
    ? getComputedStyle(document.documentElement).getPropertyValue(name[1]).trim()
    : String(value || "");
  const match = /^#([0-9a-f]{6})$/i.exec(resolved);
  if (!match) return true;
  const number = parseInt(match[1], 16);
  const channel = (shift) => {
    const c = ((number >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.25;
}


export function create(ctx, root, statsElement, detailsElement) {
  let mode = "tree";
  let sizeBy = "classes";
  let tree = null;
  let schema = null;
  let schemaLoading = null;
  let focusId = null;
  let selected = null;
  let drawnSize = "";
  const modeButtons = [...document.querySelectorAll("[data-ontology-mode]")];
  const sizeButtons = [...document.querySelectorAll("[data-ontology-size]")];
  const sizeControl = document.getElementById("ontology-size");

  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "group")
    .attr("aria-label", "FIAFcore ontology");

  const containerSize = () => `${root.clientWidth}x${root.clientHeight}`;

  async function load({ signal } = {}) {
    if (!tree) {
      ui.message(root, "Loading the ontology…");
      ui.setStatus("Loading the FIAFcore classes…");
      const [classRows, usageRows, valueRows] = await Promise.all([
        runQuery("ontology-classes", {}, { signal }),
        runQuery("ontology-usage", {}, { signal }),
        runQuery("ontology-values", {}, { signal })
      ]);
      if (signal && signal.aborted) return;
      tree = classTree(classRows, usageRows, valueRows);
      ui.setStatus("");
    }
    if (mode === "schema") await ensureSchema(signal);
    if (signal && signal.aborted) return;
    draw();
  }

  // The schema graph needs every property's triple count and a small sample
  // of what it connects. The samples run through the shared request queue,
  // a few at a time, and are kept for the session.
  async function ensureSchema(signal) {
    if (schema) return schema;
    if (schemaLoading) return schemaLoading;
    schemaLoading = (async () => {
      ui.message(root, "Reading what each property connects…");
      const properties = (await runQuery("ontology-properties", {}, { signal })).filter(
        (row) => String(row.property || "").startsWith(FIAF_NS) && Number(row.triples) > 0
      );
      const samples = new Map();
      const failed = [];
      let done = 0;
      const sampleSize = limit("ontologySample", 500);
      // Each sample stands alone: a property whose sample fails is left out
      // of the graph and named in the stats, rather than losing the graph.
      await Promise.all(
        properties.map((property) =>
          runQuery(
            "ontology-property-sample",
            { PROPERTY: sparqlIri(property.property), LIMIT: sampleSize },
            { signal }
          )
            .then((rows) => samples.set(property.property, rows))
            .catch((error) => {
              if (error.name === "AbortError") throw error;
              failed.push(property);
            })
            .finally(() => {
              done += 1;
              ui.setStatus(`Sampling properties ${done} of ${properties.length}…`);
            })
        )
      );
      ui.setStatus("");
      if (properties.length && failed.length === properties.length) {
        throw new Error("None of the properties could be sampled; the endpoint may be busy. Try again shortly.");
      }
      schema = { graph: schemaGraph(tree, properties, samples), properties, sampleSize, failed };
      return schema;
    })();
    try {
      return await schemaLoading;
    } finally {
      schemaLoading = null;
    }
  }

  function draw() {
    if (!tree) return;
    ui.clear(root);
    svg.selectAll("*").remove();
    syncControls();
    if (mode === "schema" && schema) drawSchema();
    else drawTree();
    drawnSize = containerSize();
  }

  function syncControls() {
    for (const button of modeButtons) {
      const active = button.dataset.ontologyMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    for (const button of sizeButtons) {
      const active = button.dataset.ontologySize === sizeBy;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (sizeControl) sizeControl.hidden = mode !== "tree";
  }

  // -- class tree ------------------------------------------------------------

  function drawTree() {
    const width = Math.max(360, root.clientWidth || 960);
    const height = Math.max(480, Math.min(860, window.innerHeight * 0.75));
    const hierarchy = d3
      .hierarchy(tree.root, (node) => node.children)
      .sum((node) => (sizeBy === "uses" ? node.direct + node.values : node.children.length ? 0 : 1))
      .sort((a, b) => b.value - a.value || a.data.label.localeCompare(b.data.label));
    const columns = Math.min(COLUMNS, hierarchy.height + 1);
    const columnWidth = width / columns;
    d3.partition().size([height, (hierarchy.height + 1) * columnWidth])(hierarchy);

    const used = tree.root.total || 1;
    const { colour } = heatScale(d3.max(hierarchy.descendants().slice(1), (node) => node.data.uses) || 1, MAP_HEAT_RAMP);
    const fill = (node) => (node.data.uses ? colour(node.data.uses) : null);
    // Label colour follows the fill: light text on the deep end of the ramp.
    const onDark = (node) => node.data.uses > 0 && !isLightFill(colour(node.data.uses));

    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("aria-label", "Class tree of the FIAFcore ontology");

    const cells = svg
      .append("g")
      .selectAll("g")
      .data(hierarchy.descendants().filter((node) => node.x1 - node.x0 > 0))
      .join("g")
      .attr("class", (node) => `ontology-cell${node.data.uses ? (onDark(node) ? " is-on-dark" : " is-on-light") : " is-unused"}`)
      .attr("transform", (node) => `translate(${node.y0},${node.x0})`);

    const rectHeight = (node) => node.x1 - node.x0 - Math.min(1, (node.x1 - node.x0) / 2);
    const rects = cells
      .append("rect")
      .attr("width", (node) => node.y1 - node.y0 - 1)
      .attr("height", rectHeight)
      .attr("fill", fill)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (node) => `${node.data.label}: ${useText(node.data)}. Activate to zoom.`)
      .on("click", (_event, node) => zoom(node))
      .on("keydown", (event, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          zoom(node);
        }
      })
      .on("mouseenter", (event, node) => {
        const share = node.data.total / used;
        ui.showTooltip(
          event,
          node.data.label,
          [
            node.data.total
              ? countText(node.data.total, "record", "records") +
                (node.data.direct !== node.data.total ? ` (${ui.formatNumber(node.data.direct)} typed directly)` : "")
              : null,
            node.data.total && share >= 0.001 ? `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}% of typed records` : null,
            node.data.valueTotal ? `used ${ui.formatNumber(node.data.valueTotal)} times as a value` : null,
            node.data.uses ? null : "not used in the data",
            node.data.children.length ? countText(node.data.children.length, "subclass", "subclasses") : null,
            ui.truncate(node.data.description, 160)
          ].filter(Boolean).join(" · ")
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip);

    const labels = cells
      .append("text")
      .attr("class", "ontology-label")
      .attr("x", 6)
      .attr("y", 15)
      .attr("fill-opacity", (node) => +labelVisible(node));
    labels.append("tspan").text((node) => ui.truncate(node.data.label, Math.floor(columnWidth / 7.2)));
    labels
      .append("tspan")
      .attr("class", "ontology-count")
      .attr("x", 6)
      .attr("dy", "1.2em")
      .text((node) => shortUse(node.data));
    labels.select(".ontology-count").attr("fill-opacity", (node) => +(rectHeight(node) > 34));

    function labelVisible(node) {
      return node.y1 <= width + 1 && node.y0 >= -1 && node.x1 - node.x0 > 19;
    }

    // Zoom: the chosen class fills the height and becomes the first column.
    // Choosing the class already in focus steps back out to its parent.
    function zoom(node, animate = true) {
      ui.hideTooltip();
      let target = node;
      if (focusId === node.data.id && node.parent) target = node.parent;
      focusId = target.data.id;
      select({ kind: "class", id: node.data.id });
      hierarchy.each((entry) => {
        entry.target = {
          x0: ((entry.x0 - target.x0) / (target.x1 - target.x0)) * height,
          x1: ((entry.x1 - target.x0) / (target.x1 - target.x0)) * height,
          y0: entry.y0 - target.y0,
          y1: entry.y1 - target.y0
        };
      });
      const duration = animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 600 : 0;
      const transition = svg.transition().duration(duration);
      cells
        .transition(transition)
        .attr("transform", (entry) => `translate(${entry.target.y0},${entry.target.x0})`);
      rects
        .transition(transition)
        .attr("height", (entry) => targetHeight(entry));
      labels
        .transition(transition)
        .attr("fill-opacity", (entry) => +targetLabelVisible(entry));
      labels
        .select(".ontology-count")
        .transition(transition)
        .attr("fill-opacity", (entry) => +(targetHeight(entry) > 34));
      cells.classed("is-selected", (entry) => entry.data.id === node.data.id);
    }
    const targetHeight = (entry) =>
      entry.target.x1 - entry.target.x0 - Math.min(1, (entry.target.x1 - entry.target.x0) / 2);
    const targetLabelVisible = (entry) =>
      entry.target.y1 <= width + 1 && entry.target.y0 >= -1 && entry.target.x1 - entry.target.x0 > 19;

    zoomTo = (id) => {
      const node = hierarchy.descendants().find((entry) => entry.data.id === id);
      if (node) {
        focusId = null;
        zoom(node);
      }
    };

    // Keep the zoom across redraws (resize, size toggle, theme).
    const focus = focusId && hierarchy.descendants().find((entry) => entry.data.id === focusId);
    if (focus && focus !== hierarchy) {
      focusId = null;
      zoom(focus, false);
      if (selected && selected.kind === "class") {
        cells.classed("is-selected", (entry) => entry.data.id === selected.id);
        renderDetails();
      }
    } else {
      focusId = hierarchy.data.id;
      if (!selected || selected.kind !== "class") select({ kind: "class", id: tree.root.id });
      else renderDetails();
    }

    const typedClasses = [...tree.classes.values()].filter((node) => node.direct > 0).length;
    const valueClasses = [...tree.classes.values()].filter((node) => node.values > 0).length;
    statsElement.textContent = [
      countText(tree.classes.size, "class", "classes"),
      `${ui.formatNumber(typedClasses)} typing records`,
      `${ui.formatNumber(valueClasses)} used as values`,
      countText(tree.root.children.length, "top-level class", "top-level classes"),
      `${ui.formatNumber(tree.root.total)} typed records`,
      "counts cover the whole public graph"
    ].join(" · ");
  }

  let zoomTo = () => {};

  // -- schema graph ------------------------------------------------------------

  function drawSchema() {
    const { graph } = schema;
    const width = Math.max(360, root.clientWidth || 960);
    const height = Math.max(520, Math.min(820, window.innerHeight * 0.75));
    // Literal-valued properties are listed with their class, not drawn: they
    // would all converge on one "literal" node in the middle of the graph.
    const edges = graph.edges.filter((edge) => edge.target !== LITERAL).map((edge) => ({ ...edge }));
    const linked = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    const nodes = graph.nodes.filter((node) => linked.has(node.id)).map((node) => ({ ...node }));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const radius = d3
      .scaleSqrt()
      .domain([0, d3.max(nodes, (node) => node.instances) || 1])
      .range([7, Math.max(22, Math.min(width, height) / 18)]);
    const nodeRadius = (node) => (node.kind === "class" ? radius(node.instances) : 9);
    const strokeWidth = d3
      .scaleLog()
      .domain([1, d3.max(edges, (edge) => edge.estimate) || 10])
      .range([0.8, 6])
      .clamp(true);

    // Parallel edges between one pair of nodes fan out; loops get a circle.
    const pairCount = d3.rollup(edges, (group) => group.length, (edge) => [edge.source, edge.target].sort().join("|"));
    const pairIndex = new Map();
    for (const edge of edges) {
      const key = [edge.source, edge.target].sort().join("|");
      const index = pairIndex.get(key) || 0;
      pairIndex.set(key, index + 1);
      edge.bend = (index - ((pairCount.get(key) || 1) - 1) / 2) * 0.35;
    }

    // Deterministic start positions on a circle, then a fixed number of ticks.
    nodes.forEach((node, index) => {
      const angle = (index / nodes.length) * 2 * Math.PI;
      node.x = width / 2 + Math.cos(angle) * width * 0.3;
      node.y = height / 2 + Math.sin(angle) * height * 0.3;
    });
    const links = edges
      .filter((edge) => edge.source !== edge.target)
      .map((edge) => ({ source: edge.source, target: edge.target, weight: edge.estimate }));
    const simulation = d3
      .forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((node) => node.id).distance(150).strength(0.25))
      .force("charge", d3.forceManyBody().strength(-900))
      .force("collide", d3.forceCollide((node) => nodeRadius(node) + 34))
      .force("x", d3.forceX(width / 2).strength(0.05))
      .force("y", d3.forceY(height / 2).strength(0.08))
      .stop();
    // Keep nodes inside the frame on every tick, so the collision force
    // still separates nodes pushed against an edge.
    const pad = 70;
    for (let tick = 0; tick < 400; tick += 1) {
      simulation.tick();
      for (const node of nodes) {
        node.x = Math.max(pad, Math.min(width - pad, node.x));
        node.y = Math.max(pad / 2, Math.min(height - pad / 2, node.y));
      }
    }

    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("aria-label", "Schema graph: what the FIAFcore properties connect");
    svg
      .append("defs")
      .append("marker")
      .attr("id", "ontology-arrow")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 7)
      // A fixed size: by default markers scale with the stroke and the
      // busiest properties grew huge arrowheads.
      .attr("markerUnits", "userSpaceOnUse")
      .attr("markerWidth", 9)
      .attr("markerHeight", 9)
      .attr("orient", "auto")
      .append("path")
      .attr("class", "ontology-arrow")
      .attr("d", "M0,-4L8,0L0,4");

    const geometry = (edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (source === target) {
        const r = nodeRadius(source);
        const lift = r + 22 + Math.abs(edge.bend) * 40;
        return {
          d: `M${source.x - r * 0.6},${source.y - r * 0.8}C${source.x - lift},${source.y - lift * 1.6} ${source.x + lift},${source.y - lift * 1.6} ${source.x + r * 0.6},${source.y - r * 0.8}`,
          mid: [source.x, source.y - lift * 1.25]
        };
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const start = [source.x + ux * nodeRadius(source), source.y + uy * nodeRadius(source)];
      const end = [target.x - ux * (nodeRadius(target) + 3), target.y - uy * (nodeRadius(target) + 3)];
      const offset = edge.bend * length;
      const control = [(start[0] + end[0]) / 2 - uy * offset, (start[1] + end[1]) / 2 + ux * offset];
      const mid = [
        0.25 * start[0] + 0.5 * control[0] + 0.25 * end[0],
        0.25 * start[1] + 0.5 * control[1] + 0.25 * end[1]
      ];
      return { d: `M${start[0]},${start[1]}Q${control[0]},${control[1]} ${end[0]},${end[1]}`, mid };
    };
    for (const edge of edges) Object.assign(edge, geometry(edge));

    const edgePaths = svg
      .append("g")
      .attr("class", "ontology-edges")
      .selectAll("path")
      .data(edges)
      .join("path")
      .attr("class", (edge) => `ontology-edge${edge.classValues ? " is-class-value" : ""}${edge.target === LITERAL ? " is-literal" : ""}`)
      .attr("d", (edge) => edge.d)
      .attr("stroke-width", (edge) => strokeWidth(Math.max(1, edge.estimate)))
      .attr("marker-end", "url(#ontology-arrow)");
    // A wide invisible path makes thin edges easy to hover and click.
    const edgeHits = svg
      .append("g")
      .selectAll("path")
      .data(edges)
      .join("path")
      .attr("class", "ontology-edge-hit")
      .attr("d", (edge) => edge.d)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (edge) => `${byId.get(edge.source).label} ${edge.label} ${byId.get(edge.target).label}: about ${ui.formatNumber(edge.estimate)} triples.`)
      .on("mouseenter", (event, edge) => {
        highlight({ edge });
        ui.showTooltip(
          event,
          `${byId.get(edge.source).label} → ${edge.label} → ${byId.get(edge.target).label}`,
          `about ${ui.formatNumber(edge.estimate)} triples${edge.classValues ? " · values are classes" : ""} · activate for examples`
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", () => {
        highlight(null);
        ui.hideTooltip();
      })
      .on("click", (_event, edge) => select({ kind: "edge", id: edge.id }))
      .on("keydown", (event, edge) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select({ kind: "edge", id: edge.id });
        }
      });

    // Label the busiest edges; the rest show their name on hover.
    const labelled = new Set(edges.slice(0, 14).map((edge) => edge.id));
    const edgeLabels = svg
      .append("g")
      .attr("class", "ontology-edge-labels")
      .selectAll("text")
      .data(edges.filter((edge) => labelled.has(edge.id)))
      .join("text")
      .attr("class", "ontology-edge-label")
      .attr("x", (edge) => edge.mid[0])
      .attr("y", (edge) => edge.mid[1])
      .attr("text-anchor", "middle")
      .attr("dy", "0.32em")
      .text((edge) => edge.label.replace(/^Has /, "has ").replace(/^has([A-Z])/, (_, letter) => `has ${letter.toLowerCase()}`));

    const nodeGroups = svg
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", (node) => `ontology-node is-${node.kind}`)
      .attr("transform", (node) => `translate(${node.x},${node.y})`)
      .attr("tabindex", (node) => (node.kind === "class" ? 0 : null))
      .attr("role", (node) => (node.kind === "class" ? "button" : null))
      .attr("aria-label", (node) => `${node.label}: ${countText(node.instances, "record", "records")}.`)
      .on("mouseenter", (event, node) => {
        highlight({ node });
        const out = edges.filter((edge) => edge.source === node.id).length;
        const incoming = edges.filter((edge) => edge.target === node.id).length;
        ui.showTooltip(
          event,
          node.label,
          [
            node.kind === "class" ? countText(node.instances, "record", "records") : null,
            `${out} outgoing, ${incoming} incoming`
          ].filter(Boolean).join(" · ")
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", () => {
        highlight(null);
        ui.hideTooltip();
      })
      .on("click", (_event, node) => {
        if (node.kind === "class") select({ kind: "class", id: node.id });
      })
      .on("keydown", (event, node) => {
        if (node.kind === "class" && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          select({ kind: "class", id: node.id });
        }
      });
    nodeGroups
      .append((node) =>
        document.createElementNS("http://www.w3.org/2000/svg", node.kind === "class" ? "circle" : "rect")
      )
      .each(function (node) {
        const shape = d3.select(this);
        if (node.kind === "class") shape.attr("r", nodeRadius(node));
        else shape.attr("x", -9).attr("y", -9).attr("width", 18).attr("height", 18).attr("rx", 3);
      });
    nodeGroups
      .append("text")
      .attr("class", "ontology-node-label")
      .attr("y", (node) => nodeRadius(node) + 13)
      .attr("text-anchor", "middle")
      .text((node) => node.label);

    function highlight(focus) {
      const near = new Set();
      if (focus && focus.node) {
        near.add(focus.node.id);
        for (const edge of edges) {
          if (edge.source === focus.node.id || edge.target === focus.node.id) {
            near.add(edge.id);
            near.add(edge.source);
            near.add(edge.target);
          }
        }
      } else if (focus && focus.edge) {
        near.add(focus.edge.id).add(focus.edge.source).add(focus.edge.target);
      }
      const dim = (id) => Boolean(focus) && !near.has(id);
      edgePaths.classed("is-dim", (edge) => dim(edge.id));
      edgeLabels.classed("is-dim", (edge) => dim(edge.id));
      nodeGroups.classed("is-dim", (node) => dim(node.id));
      // Hovering a node shows every edge name around it.
      edgeLabels.classed("is-shown", false);
    }

    statsElement.textContent = [
      countText(schema.properties.length, "property", "properties"),
      countText(edges.length, "connection", "connections"),
      `${ui.formatNumber(graph.edges.length - edges.length)} literal properties listed with their class`,
      countText(nodes.filter((node) => node.kind === "class").length, "top-level class", "top-level classes"),
      `estimated from samples of up to ${ui.formatNumber(schema.sampleSize)} triples per property`,
      schema.failed.length
        ? `${countText(schema.failed.length, "property", "properties")} could not be sampled and ${schema.failed.length === 1 ? "is" : "are"} left out (${schema.failed.map((property) => property.label || local(property.property)).join(", ")})`
        : null,
      "counts cover the whole public graph"
    ].filter(Boolean).join(" · ");
    if (!selected || (selected.kind === "edge" && !edges.some((edge) => edge.id === selected.id))) {
      select({ kind: "edge", id: edges[0] && edges[0].id });
    } else {
      renderDetails();
    }
  }

  // -- details panel -----------------------------------------------------------

  let detailsToken = 0;

  function select(next) {
    selected = next;
    renderDetails();
  }

  function renderDetails() {
    if (!detailsElement || !selected) return;
    const token = ++detailsToken;
    detailsElement.replaceChildren();
    if (selected.kind === "class") {
      const node = selected.id === tree.root.id ? tree.root : tree.classes.get(selected.id);
      if (!node) return;
      renderClassDetails(node);
      return;
    }
    const edge = schema && schema.graph.edges.find((entry) => entry.id === selected.id);
    if (edge) renderEdgeDetails(edge, token);
  }

  function action(label, onClick) {
    const button = ui.node("button", "drawer-action", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function renderClassDetails(node) {
    const path = node === tree.root ? [] : ancestors(tree, node.id);
    if (path.length > 1) {
      const crumbs = ui.node("nav", "ontology-crumbs");
      crumbs.setAttribute("aria-label", "Superclasses");
      for (const step of path.slice(0, -1)) {
        const link = ui.node("button", "catalogue-link", step.label);
        link.type = "button";
        link.addEventListener("click", () => showClass(step.id));
        crumbs.append(link, document.createTextNode(" › "));
      }
      detailsElement.append(crumbs);
    }
    detailsElement.append(ui.node("h3", "ontology-details-title", node.label));
    if (node !== tree.root) {
      const iri = ui.node("a", "ontology-iri", node.id.replace(FIAF_NS, "fiaf:"));
      iri.href = node.id;
      iri.target = "_blank";
      iri.rel = "noopener";
      detailsElement.append(iri);
    }
    if (node.description) detailsElement.append(ui.node("p", "ontology-description", node.description));
    const usedChildren = node.children.filter((child) => child.total > 0).length;
    const facts = [
      node.total
        ? countText(node.total, "record", "records") +
          (node.children.length ? ` in this class and its subclasses (${ui.formatNumber(node.direct)} typed directly)` : "")
        : "No records are typed with this class" + (node.children.length ? " or its subclasses" : ""),
      node.valueTotal
        ? `Used ${ui.formatNumber(node.valueTotal)} times as a value${node.children.length ? " (with its subclasses)" : ""}, for example as a production country or a film format`
        : null,
      node.children.length ? `${countText(node.children.length, "subclass", "subclasses")}, ${ui.formatNumber(usedChildren)} in use` : "No subclasses",
      node.otherParents && node.otherParents.length
        ? `Also a subclass of ${node.otherParents.map((iri) => (tree.classes.get(iri) || { label: local(iri) }).label).join(", ")}`
        : null
    ].filter(Boolean);
    const list = ui.node("ul", "ontology-facts");
    for (const fact of facts) list.append(ui.node("li", "", fact));
    detailsElement.append(list);

    if (schema && node !== tree.root && node.parent === tree.root) {
      const literals = literalProperties(schema.graph, node.id);
      if (literals.length) {
        detailsElement.append(ui.node("h4", "ontology-subtitle", "Literal properties"));
        const literalList = ui.node("ul", "ontology-facts");
        for (const edge of literals) {
          literalList.append(ui.node("li", "", `${edge.label}: about ${ui.formatNumber(edge.estimate)} values`));
        }
        detailsElement.append(literalList);
      }
    }

    const actions = ui.node("div", "drawer-actions ontology-actions");
    if (node.direct > 0) {
      actions.append(action("List records in the catalogue", () => ctx.openCatalogueQuery(classQuery(node.id))));
    }
    if (node !== tree.root && (node.id === ACTIVITY || path.some((step) => step.id === ACTIVITY))) {
      actions.append(action("Open the Roles view", () => { location.hash = "#roles"; }));
    }
    if (mode === "schema" && node !== tree.root) {
      actions.append(action("Show in the class tree", () => showClass(node.id)));
    }
    if (actions.childElementCount) detailsElement.append(actions);
  }

  function showClass(id) {
    if (mode !== "tree") {
      mode = "tree";
      focusId = null;
      draw();
    }
    selected = { kind: "class", id };
    zoomTo(id);
  }

  function renderEdgeDetails(edge, token) {
    const label = (id) => {
      const cls = tree.classes.get(id);
      return cls ? cls.label : id === LITERAL ? "Literal value" : id === "untyped" ? "Untyped" : local(id);
    };
    detailsElement.append(
      ui.node("h3", "ontology-details-title", `${label(edge.source)} → ${edge.label} → ${label(edge.target)}`)
    );
    const iri = ui.node("a", "ontology-iri", edge.property.replace(FIAF_NS, "fiaf:"));
    iri.href = edge.property;
    iri.target = "_blank";
    iri.rel = "noopener";
    detailsElement.append(iri);
    if (edge.description) detailsElement.append(ui.node("p", "ontology-description", edge.description));
    const property = schema.properties.find((entry) => entry.property === edge.property);
    const facts = ui.node("ul", "ontology-facts");
    facts.append(
      ui.node("li", "", `About ${ui.formatNumber(edge.estimate)} triples between these classes, of ${ui.formatNumber(Number(property && property.triples) || 0)} using the property`),
      ui.node("li", "", edge.classValues
        ? "The values are classes themselves (for example a country or a format), not records"
        : edge.target === LITERAL ? "The values are literals (text, dates or numbers)" : "The values are records")
    );
    detailsElement.append(facts);

    const pairs = ui.node("table", "ontology-pairs");
    const head = ui.node("tr", "");
    head.append(ui.node("th", "", "Subject type"), ui.node("th", "", "Object"), ui.node("th", "", "In sample"));
    pairs.append(head);
    for (const pair of edge.pairs.slice(0, 8)) {
      const row = ui.node("tr", "");
      row.append(
        ui.node("td", "", pair.subjectType ? label(pair.subjectType) : "Untyped"),
        ui.node("td", "", pair.objectKind === LITERAL ? "Literal" : pair.objectClass ? label(pair.objectClass) : "Untyped"),
        ui.node("td", "", ui.formatNumber(pair.sampled))
      );
      pairs.append(row);
    }
    detailsElement.append(ui.node("h4", "ontology-subtitle", "Sampled types"), pairs);

    const examples = ui.node("div", "ontology-examples");
    examples.append(ui.node("h4", "ontology-subtitle", "Example triples"), ui.node("p", "drawer-section-note", "Loading…"));
    detailsElement.append(examples);
    const actions = ui.node("div", "drawer-actions ontology-actions");
    actions.append(action("Query this property in the catalogue", () => ctx.openCatalogueQuery(propertyQuery(edge.property))));
    detailsElement.append(actions);

    runQuery("ontology-property-examples", { PROPERTY: sparqlIri(edge.property), LIMIT: 6 })
      .then((rows) => {
        if (token !== detailsToken) return;
        const list = ui.node("ul", "ontology-example-list");
        for (const row of rows) {
          const item = ui.node("li", "");
          item.append(entityLink(row.subject, row.subjectLabel), document.createTextNode(` ${edge.label} `));
          // Literals come back as text with a label; blank nodes without one.
          if (!/^https?:\/\//.test(String(row.object || "")) && row.objectLabel) {
            item.append(ui.node("q", "", ui.truncate(row.objectLabel || row.object, 80)));
          } else {
            item.append(entityLink(row.object, row.objectLabel));
          }
          list.append(item);
        }
        examples.replaceChildren(ui.node("h4", "ontology-subtitle", "Example triples"), list);
      })
      .catch((error) => {
        if (token !== detailsToken) return;
        examples.replaceChildren(ui.node("p", "drawer-message error", error.message));
      });
  }

  function entityLink(iri, name) {
    // Blank nodes (activities, colour characteristics) have no address to
    // open; name them as such instead of linking to a broken record.
    if (!/^https?:\/\//.test(String(iri || ""))) {
      return ui.node("span", "ontology-blank", name ? ui.truncate(name, 48) : "an unnamed record");
    }
    const button = ui.node("button", "catalogue-link", ui.truncate(name || local(iri), 48));
    button.type = "button";
    button.title = iri;
    button.addEventListener("click", () => ctx.openEntity(iri, name || iri));
    return button;
  }

  // -- controls ----------------------------------------------------------------

  for (const button of modeButtons) {
    button.addEventListener("click", async () => {
      const next = button.dataset.ontologyMode;
      if (next === mode) return;
      mode = next;
      syncControls();
      try {
        if (mode === "schema") await ensureSchema();
        draw();
      } catch (error) {
        if (error.name === "AbortError") return;
        ui.error(root, error);
      }
    });
  }
  for (const button of sizeButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.ontologySize === sizeBy) return;
      sizeBy = button.dataset.ontologySize;
      draw();
    });
  }

  return {
    load,
    resize() {
      if (tree && containerSize() !== drawnSize) draw();
    },
    restyle() {
      if (tree) draw();
    },
    fit() {
      if (mode === "tree" && tree) {
        focusId = null;
        selected = { kind: "class", id: tree.root.id };
        draw();
      }
    },
    exportSvg() {
      return { element: svg.node(), name: mode === "schema" ? "fiaf-schema-graph.svg" : "fiaf-class-tree.svg" };
    }
  };
}

