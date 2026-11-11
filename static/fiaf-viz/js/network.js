// Bipartite force-directed network: loaded names <-> their works.
//
// The layout is computed once per data load: the simulation is pre-ticked
// off-screen and then stopped, so browsing does not run physics in the browser.
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

const FONT_FALLBACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const AGENT_MIN_RADIUS = 3;
const AGENT_MAX_RADIUS = 10;
const WORK_RADIUS = 2.6;
// Edge opacity of the earlier SVG version (its .link rule), kept so the mesh
// reads the same on canvas.
const LINK_ALPHA = 0.6;

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

  const zoom = d3
    .zoom()
    .scaleExtent([0.05, 8])
    .on("zoom", (event) => {
      transform = event.transform;
      scheduleDraw();
    });

  // Dragging moves one node and its own edges only; the settled layout is not
  // re-simulated, so the rest of the graph stays exactly where it was. The
  // drag is registered before the zoom so a press on a node moves the node and
  // a press on empty canvas pans.
  const drag = d3
    .drag()
    .subject((event) => {
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
    if (!hasRendered) {
      ui.message(root, "Loading credits from QLever…");
    }
    ui.setStatus("Building the names and works network…");
    const agentData = await ctx.agentData();
    if (signal && signal.aborted) return;
    const matching = agentData.rows.filter(
      (row) => Number(row.works) >= ctx.state.minWorks
    );
    // 0 (the default) draws every name in the loaded slice. A positive
    // networkAgents limit is an optional safety cap.
    const maxAgents = limit("networkAgents", 0);
    const agents = maxAgents > 0 ? matching.slice(0, maxAgents) : matching;
    if (!agents.length) {
      data = null;
      dropGraph();
      ui.empty(root, "No names match the current filters.");
      statsElement.textContent = "";
      hasRendered = true;
      return;
    }
    const rows = await runQuery("network", {
      AGENT_IRIS: iriList(agents.map((row) => row.agent)),
      SCOPE_FILTER: ctx.scopeFilter(),
      ROLE_FILTER: ctx.roleFilter(),
      LIMIT: limit("networkRows", 40000)
    }, { signal });
    if (signal && signal.aborted) return;
    data = build(
      agents,
      rows,
      agentData.total,
      maxAgents > 0 && matching.length > maxAgents,
      agentData.roleMap
    );
    if (!data.links.length) {
      dropGraph();
      radiusScale = null;
      ui.empty(root, "No works found for these names.");
      statsElement.textContent = "";
      hasRendered = true;
      return;
    }
    render();
    hasRendered = true;
    select(lastSelection);
    ui.setStatus("");
  }

  function build(agents, rows, total, nameCapped, roleMap) {
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
    return {
      nodes: [...nodes.values()],
      links,
      roleMap,
      capped: rows.length >= limit("networkRows", 40000),
      nameCount: agents.length,
      nameTotal: total,
      nameCapped: Boolean(nameCapped)
    };
  }

  // Build the static layout: pre-tick off-screen, then never animate again.
  function render() {
    resizeCanvas();
    const width = viewportWidth;
    const height = viewportHeight;
    ui.clear(root);

    const links = data.links.map((link) => ({ ...link }));
    const nodes = data.nodes.map((node) => ({ ...node }));
    hovered = null;
    nodeIndex = new Map(nodes.map((node) => [node.id, node]));
    radiusScale = agentRadiusScale(nodes);
    for (const node of nodes) node.r = radius(node);

    // Pre-settle: run the physics once, off-screen, then stop for good.
    const simulation = d3
      .forceSimulation(nodes)
      .velocityDecay(0.45)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((node) => node.id)
          .distance(52)
          .strength(0.22)
      )
      .force(
        "charge",
        d3
          .forceManyBody()
          .strength((node) => (node.type === "agent" ? -220 : -90))
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
    // ~110 ticks settle a small layout without visible overlaps. Large graphs
    // (thousands of names plus works) get fewer ticks so the view stays
    // responsive; the result is cached for the session.
    const ticks = nodes.length > 8000 ? 45 : nodes.length > 4000 ? 70 : 110;
    simulation.tick(ticks);

    // forceLink has replaced each link's source and target ids with the nodes.
    incident = new Map();
    for (const link of links) {
      for (const end of [link.source, link.target]) {
        if (!incident.has(end.id)) incident.set(end.id, []);
        incident.get(end.id).push(link);
      }
    }
    lastNodes = nodes;
    lastLinks = links;

    overviewLabels = chooseOverviewLabels(nodes);
    refreshHighlight();
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

  function paint() {
    if (!painter) return;
    painter.setTransform(ratio, 0, 0, ratio, 0, 0);
    painter.clearRect(0, 0, viewportWidth, viewportHeight);
    const nodes = lastNodes;
    if (!nodes.length) return;

    // Resolve the theme's colours once per frame, not once per mark.
    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const border = token("--border", "#cccccc");
    const accent = token("--accent", "#b0203a");
    const surface = token("--surface", "#ffffff");
    const text = token("--text", "#1a1a1a");
    const nameColour = token("--name-colour", "#000000");
    const workColour = token("--work-colour", "#9a6a2f");
    const font = token("--font", FONT_FALLBACK);
    const fontSize = 0.6875 * (parseFloat(styles.fontSize) || 16);

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
    // Each edge is stroked on its own so overlapping edges still darken, and
    // the width is divided by the zoom scale so lines stay hairlines.
    const strokeLinks = (list, colour, alpha, lineWidth, wanted) => {
      painter.strokeStyle = colour;
      painter.globalAlpha = alpha;
      painter.lineWidth = lineWidth / k;
      for (const link of list) {
        if ((wanted && !wanted(link)) || linkHidden(link)) continue;
        painter.beginPath();
        painter.moveTo(link.source.x, link.source.y);
        painter.lineTo(link.target.x, link.target.y);
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

    const reach = AGENT_MAX_RADIUS + 6;
    let selectedNode = null;
    for (const node of nodes) {
      if (node.id === selectedId) selectedNode = node;
      if (
        node.x < left - reach ||
        node.x > right + reach ||
        node.y < top - reach ||
        node.y > bottom + reach
      ) {
        continue;
      }
      const alpha = !focused || node.focused ? 1 : 0.1;
      const agent = node.type === "agent";
      painter.beginPath();
      painter.arc(node.x, node.y, node.r, 0, 2 * Math.PI);
      painter.globalAlpha = agent ? alpha : alpha * 0.9;
      painter.fillStyle = agent ? nameColour : workColour;
      painter.fill();
      painter.globalAlpha = alpha;
      if (focused && node.focused) {
        painter.strokeStyle = accent;
        painter.lineWidth = node.id === selectedId ? 2.4 : 1.3;
      } else {
        painter.strokeStyle = surface;
        painter.lineWidth = agent ? 1 : 0.6;
      }
      painter.stroke();
    }
    painter.globalAlpha = 1;

    if (selectedNode) {
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
      if (!node) continue;
      painter.textAlign = placement.anchor === "end" ? "right" : "left";
      drawLabel(
        node.type === "agent" ? truncate(node.name, 22) : truncate(node.title, 26),
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
        hovered.type === "agent" ? truncate(hovered.name, 30) : truncate(hovered.title, 34),
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
        for (const link of data.links) {
          if (link.source === selection.id) focusIds.add(link.target);
          else if (link.target === selection.id) focusIds.add(link.source);
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
      (data.nameTotal > data.nameCount
        ? ` of ${ui.formatNumber(data.nameTotal)}`
        : "") +
      ` · ${ui.formatNumber(workCount)} works · ` +
      `${ui.formatNumber(data.links.length)} links` +
      (selectionStatus?.short ? ` · ${selectionStatus.short}` : "") +
      (data.nameCapped ? " · name view limit reached" : "") +
      (data.capped ? " · link limit reached, narrow the filters to see more" : "");
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
      .range([AGENT_MIN_RADIUS, AGENT_MAX_RADIUS])
      .clamp(true);
  }

  function radius(node) {
    if (node.type === "agent") {
      if (!radiusScale) return AGENT_MIN_RADIUS;
      return radiusScale(Math.max(1, node.degree || 0));
    }
    return WORK_RADIUS;
  }

  function placeLabels(candidates, maxLabels) {
    const chosen = new Map();
    const boxes = [];
    for (const node of candidates) {
      const r = radius(node);
      const text =
        node.type === "agent" ? truncate(node.name, 22) : truncate(node.title, 26);
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
    const agents = nodes
      .filter((node) => node.type === "agent")
      .sort((a, b) => b.degree - a.degree);
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

  function truncate(text, length) {
    const value = String(text || "");
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  return {
    load,
    select,
    kinds: new Set(["agent", "work"]),
    hasNode(id) {
      return nodeIndex.has(id);
    },
    fit: fitGraph,
    pause() {},
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
    // Colours are read from the theme on every repaint.
    restyle() {
      if (data && lastNodes.length) scheduleDraw();
    },
    exportSvg() {
      return { canvas, name: "fiaf-names-works.png" };
    }
  };
}
