// Bipartite force-directed network: loaded names <-> their works.
//
// The layout is computed once per data load: the simulation is pre-ticked in a
// worker and then stopped, so browsing does not run physics in the browser.
// Selecting a name or work only repaints and never rebuilds the graph. Entities
// outside the loaded slice are not drawn; the sidebar dims rows the view cannot
// show.
//
// Canvas rather than SVG: the view can hold thousands of names, their works and
// 10,000 edges. As SVG that is an element per edge, node, halo and label, and
// every zoom step or highlight restyles all of them. On one canvas a zoom step
// or a highlight is a single repaint. Hit-testing, hover and drag are done by
// hand below, and the export is a PNG.

import { iriList, limit, runQuery } from "./sparql.js";
import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";
import { maxRadiusFor, runLayout } from "./layout.js";

const FONT_FALLBACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const AGENT_MIN_RADIUS = 3;
// Largest name radius in a small graph; see maxRadiusFor in layout.js.
const AGENT_MAX_RADIUS = 10;
const WORK_RADIUS = 2.6;
// Edge opacity of the earlier SVG version (its .link rule), kept so the mesh
// reads the same on canvas.
const LINK_ALPHA = 0.6;
// Edges are stroked in this many interleaved paths rather than one call each.
// Overlaps within one path do not darken, but a dense area holds edges from
// many paths, so the mesh still darkens where it is dense, at a few dozen draw
// calls a frame instead of one per edge.
const LINK_BATCHES = 24;
// Node outlines thinner than this on screen are invisible, so they are skipped.
const OUTLINE_MIN_PX = 0.4;
// The link budget grows with the names drawn: networkRows is the floor and
// networkRowsMax the ceiling. Up to 5,000 names the floor applies.
const LINKS_PER_NAME = 2;
// Time per decade while the scrubber plays.
const PLAY_STEP_MS = 900;

function decadeOf(year) {
  return Math.floor(year / 10) * 10;
}

// A four-digit production year from the query, or null when the work has none.
function parseYear(value) {
  const year = Number.parseInt(value, 10);
  return Number.isFinite(year) && year > 0 ? year : null;
}

// Settle the force layout off-screen. This runs inside a worker, from its
// source text, so it may only use its arguments. Nodes and links arrive as
// typed arrays (links refer to node indices) and the result is the settled
// positions.
function settleLayout(d3, input, report) {
  const { agents, radii, sources, targets, width, height } = input;
  const nodes = Array.from(radii, (r, index) => ({ r, agent: agents[index] === 1 }));
  const links = Array.from(sources, (source, index) => ({ source, target: targets[index] }));
  const simulation = d3
    .forceSimulation(nodes)
    .velocityDecay(0.45)
    .force("link", d3.forceLink(links).distance(52).strength(0.22))
    .force(
      "charge",
      d3
        .forceManyBody()
        .strength((node) => (node.agent ? -220 : -90))
        .distanceMax(700)
    )
    .force(
      "collide",
      d3
        .forceCollide()
        .radius((node) => node.r + 3.5)
        .strength(0.9)
        .iterations(nodes.length > 4000 ? 1 : 2)
    )
    .force("center", d3.forceCenter(width / 2, height / 2));
  simulation.stop();
  const positions = () => {
    const x = new Float64Array(nodes.length);
    const y = new Float64Array(nodes.length);
    nodes.forEach((entry, index) => {
      x[index] = entry.x;
      y[index] = entry.y;
    });
    return { x, y };
  };
  // Interim positions: the first after a few steps so the graph appears
  // quickly, then every input.reportEvery steps.
  for (let done = 0; done < input.ticks; ) {
    const step = report && input.reportEvery
      ? Math.min(done ? input.reportEvery : 5, input.ticks - done)
      : input.ticks - done;
    simulation.tick(step);
    done += step;
    if (report && done < input.ticks) report(positions());
  }
  return positions();
}

export function create(ctx, root, statsElement, linkButtons) {
  let data = null;
  let focusIds = new Set();
  let nodeIndex = new Map();
  let lastSelection = null;
  let lastNodes = [];
  let lastLinks = [];
  let incident = new Map();
  let labelBoxes = [];
  let overviewLabels = new Map();
  let activeLabels = new Map();
  let radiusScale = null;
  let linkMode = "all";
  let hovered = null;
  let dragging = false;
  let transform = d3.zoomIdentity;
  let frame = null;
  let ratio = 1;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let hasRendered = false;
  let palette = null;
  let loadSequence = 0;
  // True while a layout settles: dragging waits for the final positions.
  let settling = false;
  // Refit as the layout settles until the user zooms or pans.
  let autoFit = true;
  // Decade scrubber. The layout is settled once for every work, so stepping
  // through the decades only toggles visibility and nothing moves. decades
  // lists the decades of the dated works; a step equal to decades.length is
  // "All", which also shows undated works.
  let decades = [];
  let timeStep = 0;
  let playTimer = null;
  const timeControl = document.getElementById("network-time");
  const timeRange = document.getElementById("network-time-range");
  const timeValue = document.getElementById("network-time-value");
  const timePlay = document.getElementById("network-time-play");
  const freshLegend = document.getElementById("network-legend-fresh");

  const timeFiltered = () => decades.length > 0 && timeStep < decades.length;

  function stopPlaying() {
    if (playTimer === null) return;
    clearInterval(playTimer);
    playTimer = null;
    if (timePlay) {
      timePlay.textContent = "Play";
      timePlay.setAttribute("aria-pressed", "false");
    }
  }

  function setTimeStep(step) {
    timeStep = Math.max(0, Math.min(decades.length, step));
    if (timeRange) timeRange.value = String(timeStep);
    applyTime();
  }

  if (timeRange) {
    timeRange.addEventListener("input", () => {
      stopPlaying();
      setTimeStep(Number(timeRange.value));
    });
  }

  if (timePlay) {
    timePlay.addEventListener("click", () => {
      if (playTimer !== null) {
        stopPlaying();
        return;
      }
      if (!decades.length) return;
      // Start from the first decade unless the scrubber is part-way through.
      if (!timeFiltered()) setTimeStep(0);
      timePlay.textContent = "Pause";
      timePlay.setAttribute("aria-pressed", "true");
      playTimer = setInterval(() => {
        if (timeStep >= decades.length) {
          stopPlaying();
          return;
        }
        setTimeStep(timeStep + 1);
        if (timeStep >= decades.length) stopPlaying();
      }, PLAY_STEP_MS);
    });
  }

  // Collect the decades of the drawn works and show the scrubber at "All".
  function setupTime(nodes) {
    stopPlaying();
    const found = new Set();
    for (const node of nodes) {
      if (node.type === "work" && node.year != null) found.add(decadeOf(node.year));
    }
    decades = [...found].sort((a, b) => a - b);
    timeStep = decades.length;
    if (timeControl) timeControl.hidden = decades.length === 0;
    if (timeRange) {
      timeRange.max = String(decades.length);
      timeRange.value = String(timeStep);
    }
    applyTime(false);
  }

  // Mark what the current decade shows: works dated up to the end of that
  // decade, the names linked to them, and the lines between. Works from the
  // decade itself are flagged as new so they are drawn in the accent colour.
  function applyTime(redraw = true) {
    const filtered = timeFiltered();
    const decade = filtered ? decades[timeStep] : null;
    if (timeValue) timeValue.textContent = filtered ? `${decade}s` : "All";
    if (freshLegend) freshLegend.hidden = !filtered;
    for (const node of lastNodes) {
      if (node.type !== "work") continue;
      node.visible = !filtered || (node.year != null && decadeOf(node.year) <= decade);
      node.fresh = filtered && node.year != null && decadeOf(node.year) === decade;
    }
    for (const node of lastNodes) {
      if (node.type === "agent") node.shown = 0;
    }
    for (const link of lastLinks) {
      link.visible = link.target.visible !== false;
      if (link.visible) link.source.shown += 1;
    }
    for (const node of lastNodes) {
      if (node.type === "agent") node.visible = node.shown > 0;
    }
    if (hovered && hovered.visible === false) {
      hovered = null;
      ui.hideTooltip();
    }
    if (!redraw) return;
    overviewLabels = chooseOverviewLabels(lastNodes);
    refreshHighlight();
    updateStats();
  }

  function syncLinkButtons() {
    for (const button of linkButtons || []) {
      button.classList.toggle("active", button.dataset.linkScope === linkMode);
    }
  }

  for (const button of linkButtons || []) {
    button.addEventListener("click", () => {
      const next = button.dataset.linkScope === "selected" ? "selected" : "all";
      if (next === linkMode) return;
      linkMode = next;
      syncLinkButtons();
      scheduleDraw();
    });
  }

  syncLinkButtons();

  const canvas = document.createElement("canvas");
  canvas.className = "network-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Network of names and works");
  const painter = canvas.getContext("2d");
  const selection = d3.select(root).append(() => canvas);

  // The size of the full graph comes from the loaded totals (names, works and
  // credits under the current filters) once they are known.
  const limitsNote = document.getElementById("network-limits");
  function describeLimits(totals) {
    if (!limitsNote) return;
    const count = (value) => ui.formatNumber(value);
    const maxNames = limit("networkAgents", 0) || 10000;
    const floor = limit("networkRows", 10000);
    const ceiling = limit("networkRowsMax", 20000);
    const whole =
      totals && totals.total && totals.works != null && totals.credits != null
        ? `With the current filters that is ${count(totals.total + totals.works)} ` +
          `nodes and ${count(totals.credits)} lines`
        : "For the whole catalogue that is hundreds of thousands of nodes and " +
          "over a million lines";
    limitsNote.replaceChildren(
      ...[
        "A line links a name to each work it is credited on in the selected " +
          "roles; several credits on one work give one line. A name's size " +
          "follows its works in view, and selecting a node highlights only " +
          "what it is directly linked to.",
        "Why the limits: every name and every work is a node, and every credit a line between " +
          `them. ${whole}; laying that out would take minutes and more memory ` +
          `than a browser tab has. The busiest ${count(maxNames)} names with ` +
          "their works come to about twice as many nodes and settle in a few " +
          "seconds.",
        "Busy names carry hundreds of credits each, so the lines are capped as " +
          `well: two per name, at least ${count(floor)} and at most ` +
          `${count(ceiling)}. The cap samples credits evenly across the names ` +
          "rather than taking the busiest first, so a name can end up with no " +
          "line within it; the stats line counts those names.",
        "The layout settles in the background and is drawn as it goes. To see " +
          "the credits of one name in full, click it or open it from Search."
      ].map((text) => ui.node("p", "", text))
    );
  }
  describeLimits(null);

  const zoom = d3
    .zoom()
    .scaleExtent([0.05, 8])
    .on("zoom", (event) => {
      transform = event.transform;
      // A user's own zoom or pan (not a programmatic fit) stops the refits
      // that follow a settling layout.
      if (event.sourceEvent) autoFit = false;
      scheduleDraw();
    });

  // Dragging moves one node and its own edges only; the settled layout is not
  // re-simulated, so the rest of the graph stays exactly where it was. The
  // drag is registered before the zoom so a press on a node moves the node and
  // a press on empty canvas pans.
  const drag = d3
    .drag()
    .subject((event) => {
      if (settling) return undefined;
      const node = pickAt(event.x, event.y);
      if (!node) return undefined;
      return { node, x: transform.applyX(node.x), y: transform.applyY(node.y) };
    })
    .on("start", () => {
      dragging = true;
      hovered = null;
      ui.hideTooltip();
    })
    .on("drag", (event) => {
      event.subject.node.x = transform.invertX(event.x);
      event.subject.node.y = transform.invertY(event.y);
      scheduleDraw();
    })
    .on("end", () => {
      dragging = false;
    });

  selection.call(drag).call(zoom).on("dblclick.zoom", null);

  canvas.addEventListener("mousemove", (event) => {
    if (dragging) return;
    const node = pick(event);
    if (node !== hovered) {
      hovered = node;
      canvas.style.cursor = node ? "pointer" : "";
      scheduleDraw();
      if (node) showNodeTooltip(event, node);
      else ui.hideTooltip();
      return;
    }
    if (node) ui.moveTooltip(event);
  });

  canvas.addEventListener("mouseleave", () => {
    if (!hovered) return;
    hovered = null;
    canvas.style.cursor = "";
    ui.hideTooltip();
    scheduleDraw();
  });

  canvas.addEventListener("click", (event) => {
    const node = pick(event);
    if (!node) {
      ui.closeDrawer();
    } else if (node.type === "agent") {
      ctx.openAgent(node.id, node.name);
    } else {
      ctx.openWork(node.id, node.title);
    }
  });

  canvas.addEventListener("dblclick", (event) => {
    if (!pick(event)) fitGraph();
  });

  function showNodeTooltip(event, node) {
    const role = node.type === "agent" ? ctx.dominantRole(node.id, data.roleMap) : null;
    const selectedWork =
      lastSelection &&
      lastSelection.kind === "work" &&
      lastSelection.id === node.id &&
      Array.isArray(lastSelection.agents);
    ui.showTooltip(
      event,
      node.type === "agent" ? node.name : node.title,
      node.type === "agent"
        ? `${ui.formatNumber(node.works)} works · ${node.degree} in view` +
          (role ? ` · ${roleLabel(role)}` : "")
        : `${
            selectedWork
              ? `${ui.formatNumber(lastSelection.agents.length)} credited names`
              : `${node.degree} credited names in view`
          } · click to highlight`
    );
  }

  function dimensions() {
    return {
      width: Math.max(360, root.clientWidth || 1000),
      height: Math.max(420, root.clientHeight || 600)
    };
  }

  function resizeCanvas() {
    const { width, height } = dimensions();
    viewportWidth = width;
    viewportHeight = height;
    ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    // Pin the CSS box to the bitmap: a percentage size would stretch the old
    // picture between a container resize and the next repaint.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function fitGraph() {
    if (!lastNodes.length) return;
    const { width, height } = dimensions();
    const pad = 32;
    let minX = d3.min(lastNodes, (node) => node.x) - pad;
    let maxX = d3.max(lastNodes, (node) => node.x) + pad;
    let minY = d3.min(lastNodes, (node) => node.y) - pad;
    let maxY = d3.max(lastNodes, (node) => node.y) + pad;
    for (const box of labelBoxes) {
      minX = Math.min(minX, box.left);
      maxX = Math.max(maxX, box.right);
      minY = Math.min(minY, box.top);
      maxY = Math.max(maxY, box.bottom);
    }
    const dx = Math.max(1, maxX - minX);
    const dy = Math.max(1, maxY - minY);
    const scale = Math.max(
      0.05,
      Math.min(2, Math.min(width / dx, height / dy) * 0.92)
    );
    const tx = width / 2 - scale * ((minX + maxX) / 2);
    const ty = height / 2 - scale * ((minY + maxY) / 2);
    selection.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  function dropGraph() {
    lastNodes = [];
    lastLinks = [];
    incident = new Map();
    nodeIndex = new Map();
    focusIds = new Set();
    labelBoxes = [];
    overviewLabels = new Map();
    activeLabels = new Map();
    hovered = null;
  }

  async function load({ signal } = {}) {
    const sequence = (loadSequence += 1);
    const stale = () => sequence !== loadSequence || (signal && signal.aborted);
    if (!hasRendered) {
      ui.message(root, "Loading credits from QLever…");
    }
    ui.setStatus("Building the names and works network…");
    // 0 (the default) draws every name in the loaded slice. A positive
    // networkAgents limit is an optional safety cap, and then only that many
    // names are fetched.
    const maxAgents = limit("networkAgents", 0);
    const agentData = await ctx.agentData(false, { cap: maxAgents });
    if (stale()) return;
    describeLimits(agentData);
    const matching = agentData.rows.filter(
      (row) => Number(row.works) >= ctx.state.minWorks
    );
    const agents = maxAgents > 0 ? matching.slice(0, maxAgents) : matching;
    if (!agents.length) {
      data = null;
      dropGraph();
      ui.empty(root, "No names match the current filters.");
      statsElement.textContent = "";
      hasRendered = true;
      return;
    }
    const rowLimit = Math.min(
      limit("networkRowsMax", 20000) || Infinity,
      Math.max(limit("networkRows", 10000), agents.length * LINKS_PER_NAME)
    );
    const rows = await runQuery("network", {
      AGENT_IRIS: iriList(agents.map((row) => row.agent)),
      SCOPE_FILTER: ctx.scopeFilter(),
      ROLE_FILTER: ctx.roleFilter(),
      LIMIT: rowLimit
    }, { signal });
    if (stale()) return;
    const next = build(
      agents,
      rows,
      agentData.total,
      // A capped fetch returns at most maxAgents rows, so a full slice of
      // matching names out of a larger total means the cap cut names off.
      maxAgents > 0 && matching.length >= maxAgents && agentData.total > maxAgents,
      agentData.roleMap,
      rowLimit
    );
    if (!next.links.length) {
      data = next;
      dropGraph();
      radiusScale = null;
      ui.empty(root, "No works found for these names.");
      statsElement.textContent = "";
      hasRendered = true;
      return;
    }
    const graph = prepare(next);
    ui.setStatus(`Laying out ${ui.formatNumber(graph.nodes.length)} nodes…`);
    const { width, height } = dimensions();
    const ticks = graph.nodes.length > 8000 ? 45 : graph.nodes.length > 4000 ? 70 : 110;
    // Draw the graph as it settles: the first positions replace the old graph,
    // later ones move it, refitted each time unless the user zoomed or panned.
    // Dragging waits for the final layout.
    let shown = false;
    const show = (positions) => {
      if (stale()) return;
      if (!shown) {
        shown = true;
        data = next;
        render(graph, positions);
        hasRendered = true;
        select(lastSelection);
        return;
      }
      graph.nodes.forEach((node, index) => {
        node.x = positions.x[index];
        node.y = positions.y[index];
      });
      overviewLabels = chooseOverviewLabels(lastNodes);
      refreshHighlight();
      if (autoFit) fitGraph();
    };
    settling = true;
    const layout = await runLayout(settleLayout, {
      agents: graph.agents,
      radii: graph.radii,
      sources: graph.sources,
      targets: graph.targets,
      width,
      height,
      ticks,
      reportEvery: 10
    }, { signal, onProgress: show });
    if (sequence === loadSequence) settling = false;
    if (!layout || stale()) return;
    show(layout);
    ui.setStatus("");
  }

  function build(agents, rows, total, nameCapped, roleMap, rowLimit) {
    const nodes = new Map();
    for (const agent of agents) {
      nodes.set(agent.agent, {
        id: agent.agent,
        type: "agent",
        name: agent.name,
        works: Number(agent.works) || 0,
        degree: 0
      });
    }
    const links = [];
    const seen = new Set();
    for (const row of rows) {
      if (!nodes.has(row.agent)) continue;
      if (!nodes.has(row.work)) {
        nodes.set(row.work, {
          id: row.work,
          type: "work",
          title: row.title || row.work,
          year: parseYear(row.year),
          degree: 0
        });
      }
      const key = `${row.agent}\u0000${row.work}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: row.agent, target: row.work });
      nodes.get(row.agent).degree += 1;
      nodes.get(row.work).degree += 1;
    }
    // When the link limit is reached, some loaded names keep no edge at all.
    // As free nodes the layout pushes them to the rim, where they add nothing
    // but cost layout time and force the fitted view far out.
    const linked = [...nodes.values()].filter(
      (node) => node.type !== "agent" || node.degree > 0
    );
    return {
      nodes: linked,
      links,
      roleMap,
      capped: rows.length >= rowLimit,
      nameCount: agents.length,
      nameTotal: total,
      nameCapped: Boolean(nameCapped),
      unlinked: nodes.size - linked.length
    };
  }

  // Copy the nodes, size them, and encode the graph for the layout worker.
  function prepare(graph) {
    const nodes = graph.nodes.map((node) => ({ ...node }));
    const scale = agentRadiusScale(nodes);
    const agents = new Uint8Array(nodes.length);
    const radii = new Float64Array(nodes.length);
    const position = new Map();
    nodes.forEach((node, index) => {
      node.r = radius(node, scale);
      agents[index] = node.type === "agent" ? 1 : 0;
      radii[index] = node.r;
      position.set(node.id, index);
    });
    const sources = new Uint32Array(graph.links.length);
    const targets = new Uint32Array(graph.links.length);
    graph.links.forEach((link, index) => {
      sources[index] = position.get(link.source);
      targets[index] = position.get(link.target);
    });
    return { nodes, scale, agents, radii, sources, targets };
  }

  // Place the settled layout; the graph is static from here on.
  function render(graph, layout) {
    resizeCanvas();
    ui.clear(root);
    const nodes = graph.nodes;
    hovered = null;
    radiusScale = graph.scale;
    nodes.forEach((node, index) => {
      node.x = layout.x[index];
      node.y = layout.y[index];
    });
    nodeIndex = new Map(nodes.map((node) => [node.id, node]));
    const links = Array.from(graph.sources, (source, index) => ({
      source: nodes[source],
      target: nodes[graph.targets[index]]
    }));

    incident = new Map();
    for (const link of links) {
      for (const end of [link.source, link.target]) {
        if (!incident.has(end.id)) incident.set(end.id, []);
        incident.get(end.id).push(link);
      }
    }
    lastNodes = nodes;
    lastLinks = links;
    setupTime(nodes);

    overviewLabels = chooseOverviewLabels(nodes);
    refreshHighlight();
    autoFit = true;
    fitGraph();
  }

  // Work out once per selection which nodes, edges and labels are in focus, so
  // a repaint only reads flags.
  function refreshHighlight() {
    const selectedId = lastSelection ? lastSelection.id : null;
    activeLabels = focusIds.size
      ? chooseFocusedLabels(lastNodes, focusIds, selectedId)
      : overviewLabels;
    for (const node of lastNodes) node.focused = focusIds.has(node.id);
    for (const link of lastLinks) {
      link.focused = link.source.focused && link.target.focused;
    }
    scheduleDraw();
  }

  function scheduleDraw() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      paint();
    });
  }

  // Theme colours, resolved once and again only after a theme change: reading
  // computed style on every zoom frame is wasted work.
  function colours() {
    if (palette) return palette;
    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    palette = {
      border: token("--border", "#cccccc"),
      accent: token("--accent", "#b0203a"),
      surface: token("--surface", "#ffffff"),
      text: token("--text", "#1a1a1a"),
      nameColour: token("--name-colour", "#000000"),
      workColour: token("--work-colour", "#9a6a2f"),
      font: token("--font", FONT_FALLBACK),
      fontSize: 0.6875 * (parseFloat(styles.fontSize) || 16)
    };
    return palette;
  }

  function paint() {
    if (!painter) return;
    painter.setTransform(ratio, 0, 0, ratio, 0, 0);
    painter.clearRect(0, 0, viewportWidth, viewportHeight);
    const nodes = lastNodes;
    if (!nodes.length) return;

    const {
      border, accent, surface, text, nameColour, workColour, font, fontSize
    } = colours();

    const k = transform.k;
    painter.translate(transform.x, transform.y);
    painter.scale(k, k);

    // Visible part of the graph, in graph coordinates.
    const left = -transform.x / k;
    const top = -transform.y / k;
    const right = left + viewportWidth / k;
    const bottom = top + viewportHeight / k;
    const linkHidden = (link) => {
      const a = link.source;
      const b = link.target;
      return (
        (a.x < left && b.x < left) ||
        (a.x > right && b.x > right) ||
        (a.y < top && b.y < top) ||
        (a.y > bottom && b.y > bottom)
      );
    };
    // Interleaved batches (see LINK_BATCHES); the width is divided by the zoom
    // scale so lines stay hairlines.
    const strokeLinks = (list, colour, alpha, lineWidth, wanted) => {
      const batches = Math.min(LINK_BATCHES, list.length);
      if (!batches) return;
      painter.strokeStyle = colour;
      painter.globalAlpha = alpha;
      painter.lineWidth = lineWidth / k;
      for (let batch = 0; batch < batches; batch += 1) {
        painter.beginPath();
        for (let index = batch; index < list.length; index += batches) {
          const link = list[index];
          if (link.visible === false || (wanted && !wanted(link)) || linkHidden(link)) continue;
          painter.moveTo(link.source.x, link.source.y);
          painter.lineTo(link.target.x, link.target.y);
        }
        painter.stroke();
      }
    };

    const focused = focusIds.size > 0;
    const selectedId = lastSelection ? lastSelection.id : null;
    if (linkMode !== "selected") {
      strokeLinks(lastLinks, border, LINK_ALPHA, 0.5, focused ? (link) => !link.focused : null);
    }
    if (focused) strokeLinks(lastLinks, accent, 0.9, 1.4, (link) => link.focused);
    // A node's own edges are redrawn above the background mesh on hover, so a
    // click target stays readable even when the full graph is a faint hairball.
    if (hovered) strokeLinks(incident.get(hovered.id) || [], accent, 0.9, 1.2);

    // Nodes are drawn as one path per style. Dimmed nodes go first so the
    // highlighted ones sit on top of them.
    const reach = (radiusScale ? radiusScale.range()[1] : AGENT_MAX_RADIUS) + 6;
    const groups = {
      dimAgents: [],
      dimWorks: [],
      agents: [],
      works: [],
      fresh: []
    };
    let selectedNode = null;
    for (const node of nodes) {
      if (node.visible === false) continue;
      if (node.id === selectedId) selectedNode = node;
      if (
        node.x < left - reach ||
        node.x > right + reach ||
        node.y < top - reach ||
        node.y > bottom + reach
      ) {
        continue;
      }
      const agent = node.type === "agent";
      if (focused && !node.focused) (agent ? groups.dimAgents : groups.dimWorks).push(node);
      else if (!agent && node.fresh && !focused) groups.fresh.push(node);
      else (agent ? groups.agents : groups.works).push(node);
    }
    const drawNodes = (list, fill, fillAlpha, outline, outlineAlpha, outlineWidth) => {
      if (!list.length) return;
      painter.beginPath();
      for (const node of list) {
        painter.moveTo(node.x + node.r, node.y);
        painter.arc(node.x, node.y, node.r, 0, 2 * Math.PI);
      }
      painter.globalAlpha = fillAlpha;
      painter.fillStyle = fill;
      painter.fill();
      if (outlineWidth * k < OUTLINE_MIN_PX) return;
      painter.globalAlpha = outlineAlpha;
      painter.strokeStyle = outline;
      painter.lineWidth = outlineWidth;
      painter.stroke();
    };
    drawNodes(groups.dimAgents, nameColour, 0.1, surface, 0.1, 1);
    drawNodes(groups.dimWorks, workColour, 0.09, surface, 0.1, 0.6);
    if (focused) {
      drawNodes(groups.agents, nameColour, 1, accent, 1, 1.3);
      drawNodes(groups.works, workColour, 0.9, accent, 1, 1.3);
    } else {
      drawNodes(groups.agents, nameColour, 1, surface, 1, 1);
      drawNodes(groups.works, workColour, 0.9, surface, 1, 0.6);
      // Works from the scrubber's current decade, slightly larger than the rest.
      if (groups.fresh.length) {
        painter.beginPath();
        for (const node of groups.fresh) {
          const r = node.r + 0.8;
          painter.moveTo(node.x + r, node.y);
          painter.arc(node.x, node.y, r, 0, 2 * Math.PI);
        }
        painter.globalAlpha = 1;
        painter.fillStyle = accent;
        painter.fill();
      }
    }
    painter.globalAlpha = 1;

    if (selectedNode) {
      if (focused && selectedNode.focused) {
        painter.beginPath();
        painter.arc(selectedNode.x, selectedNode.y, selectedNode.r, 0, 2 * Math.PI);
        painter.strokeStyle = accent;
        painter.lineWidth = 2.4;
        painter.stroke();
      }
      painter.beginPath();
      painter.arc(selectedNode.x, selectedNode.y, selectedNode.r + 4, 0, 2 * Math.PI);
      painter.strokeStyle = accent;
      painter.lineWidth = 2;
      painter.stroke();
    }

    // Labels sit in graph space, so they scale with the zoom like the nodes.
    painter.textBaseline = "alphabetic";
    painter.lineJoin = "round";
    painter.lineWidth = 3;
    painter.strokeStyle = surface;
    painter.fillStyle = text;
    const drawLabel = (label, x, y) => {
      painter.strokeText(label, x, y);
      painter.fillText(label, x, y);
    };
    painter.font = `500 ${fontSize}px ${font}`;
    for (const [id, placement] of activeLabels) {
      const node = nodeIndex.get(id);
      if (!node || node.visible === false) continue;
      painter.textAlign = placement.anchor === "end" ? "right" : "left";
      drawLabel(
        node.type === "agent" ? ui.truncate(node.name, 22) : ui.truncate(node.title, 26),
        node.x + placement.dx,
        node.y + 3
      );
    }
    // One extra label for whatever the pointer is over. The overview keeps only
    // a sparse, collision-free set of labels, so without this a node whose label
    // did not fit would be unidentifiable except through the tooltip.
    if (hovered && !activeLabels.has(hovered.id)) {
      painter.font = `600 ${fontSize}px ${font}`;
      painter.textAlign = "left";
      drawLabel(
        hovered.type === "agent" ? ui.truncate(hovered.name, 30) : ui.truncate(hovered.title, 34),
        hovered.x + hovered.r + 3,
        hovered.y + 3
      );
    }
  }

  // Exact hit-test in graph coordinates. Later nodes are painted on top, so
  // scan from the end; a linear pass over a few thousand circles is cheap.
  function pickAt(x, y) {
    if (!lastNodes.length) return null;
    const [gx, gy] = transform.invert([x, y]);
    const slack = 2 / transform.k;
    for (let index = lastNodes.length - 1; index >= 0; index -= 1) {
      const node = lastNodes[index];
      if (node.visible === false) continue;
      const dx = node.x - gx;
      const dy = node.y - gy;
      if (dx * dx + dy * dy <= (node.r + slack) ** 2) return node;
    }
    return null;
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    return pickAt(event.clientX - rect.left, event.clientY - rect.top);
  }

  // A click highlights exactly one hop: the clicked node plus the nodes it is
  // directly connected to (a name and its works, or a work and its credited
  // names). It is never expanded again, so selecting a work does not light up
  // every other work its names appear in.
  function select(selection) {
    lastSelection = selection;

    // The selection arrives in two phases: the id first, then the query result
    // (workIds/agentIds). Repainting in between would flash the whole graph back
    // to full opacity, so wait for the phase this view needs.
    if (selection && selection.pending) {
      const awaitingAgents =
        selection.kind === "work" && selection.agentIds == null;
      const awaitingWorks =
        selection.kind === "agent" &&
        !nodeIndex.has(selection.id) &&
        !Array.isArray(selection.workIds);
      if (awaitingAgents || awaitingWorks) return;
    }

    focusIds = new Set();

    if (selection) {
      const inSlice = nodeIndex.has(selection.id);
      if (inSlice) focusIds.add(selection.id);

      if (selection.kind === "work") {
        for (const id of selection.agentIds || []) {
          if (nodeIndex.has(id)) focusIds.add(id);
        }
      } else if (inSlice) {
        for (const link of incident.get(selection.id) || []) {
          focusIds.add(link.source.id === selection.id ? link.target.id : link.source.id);
        }
      }
    }

    refreshHighlight();
    updateStats();
  }

  function updateStats() {
    if (!data) return;
    const agentCount = data.nodes.filter((node) => node.type === "agent").length;
    const workCount = data.nodes.length - agentCount;
    const selectionStatus = ctx.selectionStatus?.();
    statsElement.textContent =
      `${ui.formatNumber(agentCount)} names` +
      (data.nameTotal > agentCount
        ? ` of ${ui.formatNumber(data.nameTotal)}`
        : "") +
      ` · ${ui.formatNumber(workCount)} works · ` +
      `${ui.formatNumber(data.links.length)} links` +
      (selectionStatus?.short ? ` · ${selectionStatus.short}` : "") +
      (data.nameCapped ? " · name view limit reached" : "") +
      (data.capped ? " · link limit reached, narrow the filters to see more" : "") +
      (data.unlinked
        ? ` · ${ui.formatNumber(data.unlinked)} loaded names have no works within the link limit`
        : "") +
      timeStatus();
  }

  // "Up to the 1950s: 420 of 1,850 works", plus how many works have no date at
  // all and so only appear under All.
  function timeStatus() {
    if (!timeFiltered()) return "";
    let shown = 0;
    let total = 0;
    let undated = 0;
    for (const node of lastNodes) {
      if (node.type !== "work") continue;
      total += 1;
      if (node.visible !== false) shown += 1;
      if (node.year == null) undated += 1;
    }
    return (
      ` · up to the ${decades[timeStep]}s: ${ui.formatNumber(shown)} of ` +
      `${ui.formatNumber(total)} works` +
      (undated ? `, ${ui.formatNumber(undated)} undated shown only under All` : "")
    );
  }

  // Size by the number of works this name has *in view*. A square-root scale
  // keeps a handful of prolific names from turning into blobs that swallow their
  // neighbours, while still ranking them visibly above the rest.
  function agentRadiusScale(nodes) {
    const degrees = nodes
      .filter((node) => node.type === "agent")
      .map((node) => node.degree || 0);
    const maximum = d3.max(degrees) || 1;
    return d3
      .scaleSqrt()
      .domain([1, Math.max(2, maximum)])
      .range([AGENT_MIN_RADIUS, maxRadiusFor(nodes.length, AGENT_MAX_RADIUS)])
      .clamp(true);
  }

  function radius(node, scale = radiusScale) {
    if (node.type === "agent") {
      if (!scale) return AGENT_MIN_RADIUS;
      return scale(Math.max(1, node.degree || 0));
    }
    return WORK_RADIUS;
  }

  function placeLabels(candidates, maxLabels) {
    const chosen = new Map();
    const boxes = [];
    for (const node of candidates) {
      const r = node.r;
      const text =
        node.type === "agent" ? ui.truncate(node.name, 22) : ui.truncate(node.title, 26);
      const labelWidth = Math.max(30, text.length * 5.8 + 10);
      const options = [
        { dx: r + 3, anchor: "start" },
        { dx: -(r + 3), anchor: "end" }
      ];
      for (const option of options) {
        const left =
          option.anchor === "start"
            ? node.x + option.dx
            : node.x + option.dx - labelWidth;
        const box = {
          left: left - 4,
          right: left + labelWidth + 4,
          top: node.y - 10,
          bottom: node.y + 10
        };
        const clear = boxes.every(
          (other) =>
            box.right < other.left ||
            box.left > other.right ||
            box.bottom < other.top ||
            box.top > other.bottom
        );
        if (!clear) continue;
        boxes.push(box);
        chosen.set(node.id, option);
        break;
      }
      if (maxLabels && chosen.size >= maxLabels) break;
    }
    return { chosen, boxes };
  }

  function chooseOverviewLabels(nodes) {
    // Under the decade scrubber, label the names busiest in what is shown.
    const weight = (node) => (timeFiltered() ? node.shown || 0 : node.degree);
    const agents = nodes
      .filter((node) => node.type === "agent" && node.visible !== false)
      .sort((a, b) => weight(b) - weight(a));
    const { chosen, boxes } = placeLabels(agents, 40);
    labelBoxes = boxes;
    return chosen;
  }

  function chooseFocusedLabels(nodes, focused, selectedId) {
    const focusedWorks = nodes.filter(
      (node) => node.type === "work" && focused.has(node.id)
    );
    const includeWorks = focusedWorks.length <= 30;
    const candidates = nodes
      .filter(
        (node) =>
          focused.has(node.id) &&
          node.visible !== false &&
          (node.type === "agent" || includeWorks || node.id === selectedId)
      )
      .sort((a, b) => {
        if (a.id === selectedId && b.id !== selectedId) return -1;
        if (b.id === selectedId && a.id !== selectedId) return 1;
        if (a.type !== b.type) return a.type === "agent" ? -1 : 1;
        return b.degree - a.degree;
      });
    return placeLabels(candidates, 40).chosen;
  }


  return {
    load,
    select,
    kinds: new Set(["agent", "work"]),
    hasNode(id) {
      return nodeIndex.has(id);
    },
    fit: fitGraph,
    pause() {
      stopPlaying();
    },
    resume() {},
    resetLinks() {
      if (linkMode === "all") return;
      linkMode = "all";
      syncLinkButtons();
      scheduleDraw();
    },
    resize() {
      if (!data || !lastNodes.length) return;
      const { width, height } = dimensions();
      if (width === viewportWidth && height === viewportHeight) return;
      resizeCanvas();
      fitGraph();
      scheduleDraw();
    },
    restyle() {
      palette = null;
      if (data && lastNodes.length) scheduleDraw();
    },
    exportSvg() {
      // Flush a pending repaint so the file matches the screen.
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      paint();
      return { canvas, name: "fiaf-names-works.png", background: colours().surface };
    }
  };
}
