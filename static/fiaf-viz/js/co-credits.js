// Co-credit network: names connected when they share at least one work.
//
// Drawn on one canvas, like the names & works network (see network.js), so
// both force-directed views share one rendering approach: hit-testing, hover
// and drag are done by hand, and the export is a PNG.

import { iriList, limit, runQuery } from "./sparql.js";
import * as ui from "./ui.js";

const FONT_FALLBACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const NODE_MIN_RADIUS = 3;
const NODE_MAX_RADIUS = 9.5;
// Edge opacity of the earlier SVG version (its .link rule), kept so the mesh
// reads the same on canvas.
const LINK_ALPHA = 0.6;

export function create(ctx, root, statsElement, thresholdInput, linkButtons) {
  let data = null;
  let threshold = limit("coCreditMinShared", 2);
  let simulation = null;
  let focusIds = new Set();
  let nodeIndex = new Map();
  let lastSelection = null;
  let lastNodes = [];
  let lastLinks = [];
  let incident = new Map();
  let widthScale = () => 0.5;
  let labelBoxes = [];
  let labelled = new Map();
  let shownLabels = new Set();
  let selectedId = null;
  let highlighting = false;
  let hovered = null;
  let dragging = false;
  let transform = d3.zoomIdentity;
  let frame = null;
  let ratio = 1;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let ego = null;
  let egoToken = 0;
  let egoMode = false;
  let radiusScale = null;
  let linkMode = "all";
  let renderedMode = "global";
  let renderedEgoId = null;
  let renderedStats = { nodes: 0, links: 0 };
  let hasRendered = false;
  const thresholdControl = thresholdInput
    ? thresholdInput.closest(".inline-control")
    : null;
  const egoButton = document.getElementById("co-credits-ego");

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

  function updateEgoButton() {
    if (!egoButton) return;
    const agentSelected =
      lastSelection && lastSelection.kind === "agent" ? lastSelection : null;
    egoButton.hidden = !agentSelected;
    if (!agentSelected) return;
    const isolated = renderedMode === "ego";
    egoButton.textContent = isolated
      ? "Show global network"
      : "Isolate selected name";
    egoButton.setAttribute("aria-pressed", String(isolated));
  }

  if (egoButton) {
    egoButton.addEventListener("click", () => {
      // The global network highlights in place; isolating is an explicit,
      // reversible action that rebuilds the graph around one name.
      egoMode = renderedMode !== "ego";
      ego = null;
      egoToken += 1;
      select(lastSelection);
    });
  }

  // Selecting a name highlights it and its neighbours in the settled global
  // graph. Names outside the loaded graph cannot be drawn without inventing
  // nodes, so they simply leave the graph undimmed; the sidebar dims the rows
  // the view cannot show. The ego network is only built when the user isolates a
  // name.
  function select(selection) {
    // A work click carries its credited names only after work-agents.rq
    // answers. Keep the current highlight until then instead of resetting the
    // graph and repainting it a moment later.
    if (
      selection &&
      selection.pending &&
      selection.kind === "work" &&
      selection.agentIds == null
    ) {
      return;
    }
    lastSelection = selection;

    if (egoMode && selection && selection.kind === "agent") {
      selectEgo(selection);
      return;
    }

    // Leaving the isolated view, or selecting something else: the global graph
    // is the base again.
    if (ego) {
      ego = null;
      egoToken += 1;
    }
    if (thresholdControl) thresholdControl.hidden = false;

    focusIds = new Set();
    if (selection) {
      if (selection.kind === "agent" && nodeIndex.has(selection.id)) {
        focusIds.add(selection.id);
      }
      if (selection.agentIds) {
        for (const id of selection.agentIds) {
          if (nodeIndex.has(id)) focusIds.add(id);
        }
      }
    }

    if (data && renderedMode === "ego") {
      draw();
      return;
    }
    refreshHighlight();
    updateEgoButton();
    updateStats();
  }

  function selectEgo(selection) {
    const agentId = selection.id;
    if (thresholdControl) thresholdControl.hidden = true;
    focusIds = new Set([agentId]);

    if (!ego || ego.id !== agentId) {
      ego = {
        id: agentId,
        label: selection.label || agentId,
        roles: selection.roles || [],
        rows: null,
        error: null
      };
      updateEgoButton();
      const token = ++egoToken;
      loadEgo(agentId, token);
      return;
    }

    ego.label = selection.label || ego.label;
    if (selection.roles) ego.roles = selection.roles;
    if (!ego.rows) {
      updateEgoButton();
      return;
    }
    if (renderedMode !== "ego" || renderedEgoId !== agentId) draw();
    else refreshHighlight();
    updateEgoButton();
  }

  async function loadEgo(agentId, token) {
    try {
      const rows = await ctx.agentCoCredits(agentId);
      if (token !== egoToken || !ego || ego.id !== agentId) return;
      ego.rows = rows;
      draw();
    } catch (error) {
      if (token !== egoToken || !ego || ego.id !== agentId) return;
      ego.rows = [];
      ego.error = error;
      draw();
    }
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
    const pad = 24;
    let minX = d3.min(lastNodes, (entry) => entry.x) - pad;
    let maxX = d3.max(lastNodes, (entry) => entry.x) + pad;
    let minY = d3.min(lastNodes, (entry) => entry.y) - pad;
    let maxY = d3.max(lastNodes, (entry) => entry.y) + pad;
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

  const canvas = document.createElement("canvas");
  canvas.className = "network-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Co-credit network of names");
  const painter = canvas.getContext("2d");
  const selection = d3.select(root).append(() => canvas);

  const zoom = d3
    .zoom()
    .scaleExtent([0.05, 8])
    .on("zoom", (event) => {
      transform = event.transform;
      scheduleDraw();
    });

  // The drag is registered before the zoom so a press on a node moves the node
  // and a press on empty canvas pans. The simulation stays warm while a node
  // is held, so its neighbours follow.
  const drag = d3
    .drag()
    .subject((event) => {
      const node = pickAt(event.x, event.y);
      if (!node) return undefined;
      return { node, x: transform.applyX(node.x), y: transform.applyY(node.y) };
    })
    .on("start", (event) => {
      dragging = true;
      hovered = null;
      ui.hideTooltip();
      const node = event.subject.node;
      if (!event.active && simulation) simulation.alphaTarget(0.08).restart();
      node.fx = node.x;
      node.fy = node.y;
    })
    .on("drag", (event) => {
      const node = event.subject.node;
      node.fx = transform.invertX(event.x);
      node.fy = transform.invertY(event.y);
      scheduleDraw();
    })
    .on("end", (event) => {
      dragging = false;
      const node = event.subject.node;
      if (!event.active && simulation) simulation.alphaTarget(0);
      node.fx = null;
      node.fy = null;
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
    if (node) ctx.openAgent(node.id, node.name);
    else ui.closeDrawer();
  });

  canvas.addEventListener("dblclick", (event) => {
    if (!pick(event)) fitGraph();
  });

  function showNodeTooltip(event, entry) {
    const isEgo = renderedMode === "ego" && ego && ego.rows;
    const body = isEgo
      ? entry.id === ego.id
        ? `${ui.formatNumber(ego.rows.length)} co-credited names · ${ui.formatNumber(entry.weight)} shared-work links`
        : `${ui.formatNumber(entry.weight)} shared works with ${ego.label}`
      : `${entry.degree} co-credit links · ${ui.formatNumber(entry.weight)} shared works`;
    ui.showTooltip(event, entry.name, body);
  }

  if (thresholdInput) {
    const thresholdOutput = document.getElementById("shared-value");
    thresholdInput.min = String(limit("coCreditMinShared", 2));
    thresholdInput.max = String(limit("coCreditMaxThreshold", 10));
    thresholdInput.value = String(threshold);
    if (thresholdOutput) thresholdOutput.textContent = String(threshold);
    thresholdInput.addEventListener("input", () => {
      threshold = Number(thresholdInput.value) || 1;
      if (thresholdOutput) thresholdOutput.textContent = String(threshold);
    });
    // Physics is expensive; settle a new topology once, when the slider is
    // released, rather than on every pixel of pointer movement.
    thresholdInput.addEventListener("change", draw);
  }

  function dropGraph() {
    if (simulation) simulation.stop();
    nodeIndex = new Map();
    lastNodes = [];
    lastLinks = [];
    incident = new Map();
    labelled = new Map();
    shownLabels = new Set();
    labelBoxes = [];
    hovered = null;
    radiusScale = null;
    renderedMode = "global";
    renderedEgoId = null;
  }

  async function load({ signal } = {}) {
    if (!hasRendered) {
      ui.message(root, "Loading co-credits from QLever…");
    }
    ui.setStatus("Building the co-credit network…");
    if (ego) {
      ego = null;
      egoToken += 1;
    }
    const agentData = await ctx.agentData();
    if (signal && signal.aborted) return;
    const agents = agentData.rows
      .filter((row) => Number(row.works) >= ctx.state.minWorks)
      .slice(0, limit("coCreditAgents", 200));
    if (!agents.length) {
      dropGraph();
      simulation = null;
      data = null;
      focusIds = new Set();
      renderedStats = { nodes: 0, links: 0 };
      updateEgoButton();
      ui.empty(root, "No names match the current filters.");
      statsElement.textContent = "";
      hasRendered = true;
      return;
    }
    const rows = await runQuery("co-credits", {
      AGENT_IRIS: iriList(agents.map((row) => row.agent)),
      SCOPE_FILTER: ctx.scopeFilter(),
      MIN_SHARED: limit("coCreditMinShared", 2),
      LIMIT: limit("coCreditRows", 6000)
    }, { signal });
    if (signal && signal.aborted) return;
    data = build(rows, agentData.total, agents, agentData.roleMap);
    if (egoMode && lastSelection && lastSelection.kind === "agent") {
      selectEgo(lastSelection);
    } else {
      draw();
    }
    hasRendered = true;
    ui.setStatus("");
  }

  function build(rows, total, agents, roleMap) {
    const names = new Map(agents.map((agent) => [agent.agent, agent.name]));
    const links = rows.map((row) => ({
      source: row.a,
      target: row.b,
      nameA: names.get(row.a) || row.a,
      nameB: names.get(row.b) || row.b,
      shared: Number(row.shared) || 1
    }));
    return {
      links,
      names,
      roleMap,
      agentIds: agents.map((agent) => agent.agent),
      capped: rows.length >= limit("coCreditRows", 6000),
      nameTotal: total
    };
  }

  // Build and settle the layout for the current mode and threshold.
  function draw() {
    if (!data) return;
    const isEgo = lastSelection && lastSelection.kind === "agent" && ego;
    if (isEgo && !ego.rows) return;

    resizeCanvas();
    const width = viewportWidth;
    const height = viewportHeight;
    if (simulation) simulation.stop();

    const visible = isEgo
      ? ego.rows.map((row) => ({
          source: ego.id,
          target: row.agent,
          nameA: ego.label,
          nameB: row.name,
          shared: row.shared
        }))
      : data.links.filter((link) => link.shared >= threshold);
    if (!visible.length && !isEgo) {
      dropGraph();
      ui.empty(root, `No pairs share ${threshold} or more works in the loaded names.`);
      statsElement.textContent = `${ui.formatNumber(data.links.length)} pairs at ${limit("coCreditMinShared", 2)}+ shared works`;
      return;
    }
    ui.clear(root);

    const nodes = new Map();
    const node = (id, name) => {
      if (!nodes.has(id)) nodes.set(id, { id, name, degree: 0, weight: 0 });
      return nodes.get(id);
    };
    for (const link of visible) {
      const source = node(link.source, link.nameA);
      const target = node(link.target, link.nameB);
      source.degree += 1;
      target.degree += 1;
      source.weight += link.shared;
      target.weight += link.shared;
    }
    if (isEgo && !nodes.has(ego.id)) node(ego.id, ego.label);
    if (isEgo) {
      const selected = nodes.get(ego.id);
      selected.extra = true;
      selected.fx = width / 2;
      selected.fy = height / 2;
    }
    const nodeList = [...nodes.values()];
    hovered = null;
    nodeIndex = new Map(nodeList.map((entry) => [entry.id, entry]));
    radiusScale = makeRadiusScale(nodeList);
    for (const entry of nodeList) entry.r = nodeRadius(entry);
    const links = visible.map((link) => ({
      source: link.source,
      target: link.target,
      shared: link.shared
    }));

    const minimumShared = isEgo ? 1 : threshold;
    widthScale = d3
      .scaleSqrt()
      .domain([
        minimumShared,
        d3.max(links, (link) => link.shared) || minimumShared
      ])
      .range([0.5, 2.2]);
    for (const link of links) link.width = widthScale(link.shared);
    renderedMode = isEgo ? "ego" : "global";
    renderedEgoId = isEgo ? ego.id : null;
    updateEgoButton();

    simulation = d3
      .forceSimulation(nodeList)
      .velocityDecay(0.4)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((entry) => entry.id)
          .distance((link) => 100 + 50 / Math.sqrt(link.shared))
          .strength(0.05)
      )
      .force("charge", d3.forceManyBody().strength(-800).distanceMax(1200))
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((entry) => entry.r + 5)
          .strength(0.95)
          .iterations(2)
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      // Only a drag restarts the simulation; each of its ticks is one repaint.
      .on("tick", scheduleDraw);

    // Settle off-screen, then fit: the user never sees the initial collisions.
    simulation.stop();
    simulation.tick(420);

    // forceLink has replaced each link's source and target ids with the nodes.
    incident = new Map();
    for (const link of links) {
      for (const end of [link.source, link.target]) {
        if (!incident.has(end.id)) incident.set(end.id, []);
        incident.get(end.id).push(link);
      }
    }
    lastNodes = nodeList;
    lastLinks = links;
    labelled = chooseLabels(nodeList);
    refreshHighlight();
    fitGraph();
    renderedStats = { nodes: nodeList.length, links: links.length };
    updateStats();
    ctx.refreshSelectionStatus?.();
  }

  // Work out once per selection which nodes, edges and labels are highlighted,
  // so a repaint only reads flags.
  function refreshHighlight() {
    const isEgo = renderedMode === "ego";
    selectedId = isEgo
      ? renderedEgoId
      : lastSelection && lastSelection.kind === "agent"
        ? lastSelection.id
        : null;
    // The isolated view is already the selection, so nothing in it is dimmed.
    highlighting = !isEgo && focusIds.size > 0;
    const neighbours = new Set(focusIds);
    if (highlighting) {
      for (const link of lastLinks) {
        if (focusIds.has(link.source.id)) neighbours.add(link.target.id);
        if (focusIds.has(link.target.id)) neighbours.add(link.source.id);
      }
    }
    for (const entry of lastNodes) entry.near = highlighting && neighbours.has(entry.id);
    for (const link of lastLinks) {
      link.touching =
        highlighting && (focusIds.has(link.source.id) || focusIds.has(link.target.id));
    }
    shownLabels = highlighting ? neighbours : new Set(labelled.keys());
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
    if (!lastNodes.length) return;

    // Resolve the theme's colours once per frame, not once per mark.
    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const border = token("--border", "#cccccc");
    const accent = token("--accent", "#b0203a");
    const surface = token("--surface", "#ffffff");
    const text = token("--text", "#1a1a1a");
    const nameColour = token("--name-colour", "#000000");
    const font = token("--font", FONT_FALLBACK);
    const fontSize = 0.6875 * (parseFloat(styles.fontSize) || 16);

    const k = transform.k;
    painter.translate(transform.x, transform.y);
    painter.scale(k, k);

    // Each edge is stroked on its own so overlapping edges still darken, and
    // the width is divided by the zoom scale so it does not grow with the zoom.
    const strokeLinks = (list, colour, alpha, minimumWidth, wanted) => {
      painter.strokeStyle = colour;
      painter.globalAlpha = alpha;
      for (const link of list) {
        if (wanted && !wanted(link)) continue;
        painter.lineWidth = Math.max(minimumWidth, link.width) / k;
        painter.beginPath();
        painter.moveTo(link.source.x, link.source.y);
        painter.lineTo(link.target.x, link.target.y);
        painter.stroke();
      }
    };

    // "Selected only" hides the background mesh in the global view; the
    // isolated view has no background, so it always shows its edges.
    if (renderedMode === "ego" || linkMode !== "selected") {
      strokeLinks(lastLinks, border, LINK_ALPHA, 0, (link) => !link.touching);
    }
    if (highlighting) strokeLinks(lastLinks, accent, 0.9, 1.2, (link) => link.touching);
    // Hovered edges are redrawn above the mesh, so a node's relations stand
    // out without raising the opacity of the whole graph.
    if (hovered) strokeLinks(incident.get(hovered.id) || [], accent, 0.9, 1);

    for (const entry of lastNodes) {
      painter.globalAlpha = highlighting && !entry.near ? 0.1 : 1;
      painter.beginPath();
      painter.arc(entry.x, entry.y, entry.r, 0, 2 * Math.PI);
      painter.fillStyle = nameColour;
      painter.fill();
      if (entry.near) {
        painter.strokeStyle = accent;
        painter.lineWidth = entry.id === selectedId ? 2.4 : 1.3;
      } else {
        painter.strokeStyle = surface;
        painter.lineWidth = 1;
      }
      painter.stroke();
    }
    painter.globalAlpha = 1;

    const selectedNode = selectedId ? nodeIndex.get(selectedId) : null;
    if (selectedNode) {
      painter.beginPath();
      painter.arc(selectedNode.x, selectedNode.y, selectedNode.r + 5, 0, 2 * Math.PI);
      painter.strokeStyle = accent;
      painter.lineWidth = 2;
      painter.stroke();
    }

    // Labels sit in graph space, so they scale with the zoom like the nodes.
    painter.font = `500 ${fontSize}px ${font}`;
    painter.textBaseline = "alphabetic";
    painter.lineJoin = "round";
    painter.lineWidth = 3;
    painter.strokeStyle = surface;
    painter.fillStyle = text;
    for (const id of shownLabels) {
      const entry = nodeIndex.get(id);
      if (!entry) continue;
      const placement = labelled.get(id);
      const x = entry.x + (placement ? placement.dx : entry.r + 2);
      const y = entry.y + (placement ? placement.dy : 3);
      const label = truncate(entry.name, 20);
      painter.textAlign = placement && placement.anchor === "end" ? "right" : "left";
      painter.strokeText(label, x, y);
      painter.fillText(label, x, y);
    }
  }

  // Exact hit-test in graph coordinates. Later nodes are painted on top, so
  // scan from the end.
  function pickAt(x, y) {
    if (!lastNodes.length) return null;
    const [gx, gy] = transform.invert([x, y]);
    const slack = 2 / transform.k;
    for (let index = lastNodes.length - 1; index >= 0; index -= 1) {
      const entry = lastNodes[index];
      const dx = entry.x - gx;
      const dy = entry.y - gy;
      if (dx * dx + dy * dy <= (entry.r + slack) ** 2) return entry;
    }
    return null;
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    return pickAt(event.clientX - rect.left, event.clientY - rect.top);
  }

  function updateStats() {
    if (!data) return;
    if (renderedMode === "ego" && ego && ego.rows) {
      const rowLimit = limit("coCreditAgents", 200);
      statsElement.textContent =
        `${ui.formatNumber(ego.rows.length)} co-credited names with ${ego.label}` +
        (ego.rows.length >= rowLimit
          ? ` · showing the strongest ${ui.formatNumber(rowLimit)}`
          : "") +
        (ego.error ? " · could not load all relationships" : "");
      return;
    }
    const selectionStatus = ctx.selectionStatus?.();
    statsElement.textContent =
      `${ui.formatNumber(renderedStats.nodes)} connected names` +
      (data.nameTotal
        ? ` of ${ui.formatNumber(data.nameTotal)} credited`
        : "") +
      ` · ${ui.formatNumber(renderedStats.links)} pairs · ` +
      `min ${threshold} shared works` +
      (selectionStatus?.short ? ` · ${selectionStatus.short}` : "") +
      (data.capped ? " · pair limit reached, narrow the filters to see more" : "");
  }

  // Size by the number of co-credit links, not by the sum of shared works: one
  // very strong pair would otherwise produce a huge, colliding sphere. A
  // square-root scale over the current graph keeps the hub of a large ego
  // network from swallowing its neighbours while preserving the rank order.
  function makeRadiusScale(nodeList) {
    const maximum = d3.max(nodeList, (entry) => entry.degree || 0) || 1;
    return d3
      .scaleSqrt()
      .domain([1, Math.max(2, maximum)])
      .range([NODE_MIN_RADIUS, NODE_MAX_RADIUS])
      .clamp(true);
  }

  function nodeRadius(entry) {
    if (!radiusScale) return NODE_MIN_RADIUS;
    return radiusScale(Math.max(1, entry.degree || 0));
  }

  // Placements are stored as offsets from the node, so a label follows its
  // node when the node is dragged.
  function chooseLabels(nodes) {
    const chosen = new Map();
    const boxes = [];
    for (const entry of [...nodes].sort(
      (a, b) => (b.extra ? 1 : 0) - (a.extra ? 1 : 0) || b.weight - a.weight
    )) {
      const radius = nodeRadius(entry);
      const label = truncate(entry.name, 20);
      const labelWidth = Math.max(30, label.length * 5.8 + 10);
      const options = [
        { dx: radius + 3, dy: 3, anchor: "start" },
        { dx: -radius - 3, dy: 3, anchor: "end" }
      ];
      for (const option of options) {
        const x = entry.x + option.dx;
        const y = entry.y + option.dy;
        const left = option.anchor === "start" ? x : x - labelWidth;
        const box = {
          left: left - 3,
          right: left + labelWidth + 3,
          top: y - 10,
          bottom: y + 10
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
        chosen.set(entry.id, option);
        break;
      }
      if (chosen.size >= 18) break;
    }
    labelBoxes = boxes;
    return chosen;
  }

  function truncate(text, length) {
    const value = String(text || "");
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  return {
    load,
    select,
    kinds: new Set(["agent"]),
    hasNode(id) {
      return nodeIndex.has(id);
    },
    fit: fitGraph,
    resetLinks() {
      if (linkMode === "all") return;
      linkMode = "all";
      syncLinkButtons();
      scheduleDraw();
    },
    pause() {
      if (simulation) simulation.stop();
    },
    resume() {
      if (simulation && simulation.alpha() > simulation.alphaMin()) simulation.restart();
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
      return { canvas, name: "fiaf-co-credits.png" };
    }
  };
}
