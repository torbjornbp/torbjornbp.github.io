// Co-credit network: names connected when they share at least one work.

import { iriList, limit, runQuery } from "./sparql.js";
import { linkOpacity } from "./graph.js";
import * as ui from "./ui.js";

export function create(ctx, root, statsElement, thresholdInput, linkButtons) {
  let data = null;
  let threshold = limit("coCreditMinShared", 2);
  let simulation = null;
  let focusIds = new Set();
  let nodeIndex = new Map();
  let lastSelection = null;
  let repaint = () => {};
  let lastNodes = [];
  let labelBoxes = [];
  let labelled = new Map();
  let viewportWidth = 0;
  let viewportHeight = 0;
  let ego = null;
  let egoToken = 0;
  let egoMode = false;
  let radiusScale = null;
  let linkMode = "all";
  let linkBaseOpacity = 0.2;
  let highlightHoverEdges = () => {};
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
      repaint();
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
    repaint();
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
    else repaint();
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

  function fitGraph() {
    if (!lastNodes.length) return;
    const width = Math.max(360, root.clientWidth || 1000);
    const height = Math.max(420, root.clientHeight || 600);
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
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "Co-credit network of names");
  const layer = svg.append("g");
  const zoom = d3
    .zoom()
    .scaleExtent([0.05, 8])
    .on("zoom", (event) => layer.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("dblclick", () => fitGraph());

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
      if (simulation) simulation.stop();
      simulation = null;
      data = null;
      nodeIndex = new Map();
      lastNodes = [];
      focusIds = new Set();
      repaint = () => {};
      highlightHoverEdges = () => {};
      renderedMode = "global";
      renderedEgoId = null;
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

  function draw() {
    if (!data) return;
    const isEgo = lastSelection && lastSelection.kind === "agent" && ego;
    if (isEgo && !ego.rows) return;

    const width = Math.max(360, root.clientWidth || 1000);
    const height = Math.max(420, root.clientHeight || 600);
    viewportWidth = width;
    viewportHeight = height;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    layer.selectAll("*").remove();
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
      nodeIndex = new Map();
      lastNodes = [];
      radiusScale = null;
      linkBaseOpacity = 0;
      highlightHoverEdges = () => {};
      renderedMode = "global";
      renderedEgoId = null;
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
      selected.dominantRole = ego.roles[0] || null;
      selected.fx = width / 2;
      selected.fy = height / 2;
    }
    const nodeList = [...nodes.values()];
    lastNodes = nodeList;
    nodeIndex = new Map(nodeList.map((entry) => [entry.id, entry]));
    radiusScale = makeRadiusScale(nodeList);
    const links = visible.map((link) => ({
      source: link.source,
      target: link.target,
      shared: link.shared
    }));

    const minimumShared = isEgo ? 1 : threshold;
    const widthScale = d3
      .scaleSqrt()
      .domain([
        minimumShared,
        d3.max(links, (link) => link.shared) || minimumShared
      ])
      .range([0.5, 2.2]);
    linkBaseOpacity = linkOpacity(links.length);
    renderedMode = isEgo ? "ego" : "global";
    renderedEgoId = isEgo ? ego.id : null;

    const linkSelection = layer
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", "link")
      .attr("stroke-width", (link) => widthScale(link.shared))
      .attr("stroke-opacity", linkBaseOpacity);

    // Hovered edges are redrawn above the faint mesh, so a node's relations
    // stand out without raising the opacity of the whole graph.
    const hoverLinkGroup = layer.append("g").attr("class", "link-hover-layer");

    highlightHoverEdges = (entry) => {
      hoverLinkGroup.selectAll("*").remove();
      if (!entry) return;
      const incident = links.filter(
        (link) => link.source.id === entry.id || link.target.id === entry.id
      );
      if (!incident.length) return;
      hoverLinkGroup
        .selectAll("line")
        .data(incident)
        .join("line")
        .attr("class", "link link-hover")
        .attr("stroke-opacity", 0.9)
        .attr("stroke-width", (link) => Math.max(1, widthScale(link.shared)))
        .attr("x1", (link) => link.source.x)
        .attr("y1", (link) => link.source.y)
        .attr("x2", (link) => link.target.x)
        .attr("y2", (link) => link.target.y);
    };

    const nodeSelection = layer
      .append("g")
      .selectAll("g")
      .data(nodeList)
      .join("g")
      .attr("class", "node")
      .call(drag());

    nodeSelection
      .append("circle")
      .attr("class", "node-agent")
      .attr("r", (entry) => nodeRadius(entry))
      .attr(
        "fill",
        (entry) => ctx.colorFor(entry.dominantRole || ctx.dominantRole(entry.id, data.roleMap))
      )
      .on("mouseenter", (event, entry) => {
        highlightHoverEdges(entry);
        const body = isEgo
          ? entry.id === ego.id
            ? `${ui.formatNumber(ego.rows.length)} co-credited names · ${ui.formatNumber(entry.weight)} shared-work links`
            : `${ui.formatNumber(entry.weight)} shared works with ${ego.label}`
          : `${entry.degree} co-credit links · ${ui.formatNumber(entry.weight)} shared works`;
        ui.showTooltip(event, entry.name, body);
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", () => {
        highlightHoverEdges(null);
        ui.hideTooltip();
      })
      .on("click", (event, entry) => {
        event.stopPropagation();
        ctx.openAgent(entry.id, entry.name);
      })
      .on("dblclick", (event) => event.stopPropagation());

    const haloSelection = nodeSelection
      .append("circle")
      .attr("class", "node-halo")
      .attr("r", (entry) => nodeRadius(entry) + 5)
      .attr("display", "none");

    labelled = new Map();
    labelBoxes = [];
    const labelSelection = nodeSelection
      .append("text")
      .attr("class", "node-label")
      .attr("x", (entry) => nodeRadius(entry) + 2)
      .attr("y", 3)
      .attr("display", "none")
      .text((entry) => truncate(entry.name, 20));


    function paintHighlight() {
      const selectedId = isEgo
        ? ego.id
        : lastSelection && lastSelection.kind === "agent"
          ? lastSelection.id
          : null;
      haloSelection.attr("display", (entry) =>
        entry.id === selectedId ? null : "none"
      );
      if (isEgo) {
        nodeSelection.attr("opacity", 1);
        nodeSelection
          .select("text")
          .attr("display", (entry) => (labelled.has(entry.id) ? null : "none"));
        nodeSelection
          .select("circle")
          .attr("stroke", null)
          .attr("stroke-width", null);
        linkSelection
          .attr("display", null)
          .attr("stroke-opacity", linkBaseOpacity)
          .attr("stroke-width", (link) => widthScale(link.shared))
          .attr("stroke", null);
        return;
      }
      if (!focusIds.size) {
        nodeSelection.attr("opacity", 1);
        nodeSelection
          .select("text")
          .attr("display", (entry) => (labelled.has(entry.id) ? null : "none"));
        nodeSelection
          .select("circle")
          .attr("stroke", null)
          .attr("stroke-width", null);
        linkSelection
          .attr("display", linkMode === "selected" ? "none" : null)
          .attr("stroke-opacity", linkBaseOpacity)
          .attr("stroke-width", (link) => widthScale(link.shared))
          .attr("stroke", null);
        return;
      }
      const neighbours = new Set(focusIds);
      for (const link of links) {
        if (focusIds.has(link.source.id)) neighbours.add(link.target.id);
        if (focusIds.has(link.target.id)) neighbours.add(link.source.id);
      }
      nodeSelection.attr("opacity", (entry) =>
        neighbours.has(entry.id) ? 1 : 0.1
      );
      nodeSelection
        .select("text")
        .attr("display", (entry) => (neighbours.has(entry.id) ? null : "none"));
      nodeSelection
        .select("circle")
        .attr("stroke", (entry) => (neighbours.has(entry.id) ? "var(--accent)" : null))
        .attr("stroke-width", (entry) =>
          entry.id === selectedId ? 2.4 : neighbours.has(entry.id) ? 1.3 : null
        );
      const touching = (link) =>
        focusIds.has(link.source.id) || focusIds.has(link.target.id);
      linkSelection
        .attr("display", (link) =>
          linkMode === "selected" && !touching(link) ? "none" : null
        )
        .attr("stroke-opacity", (link) =>
          touching(link) ? 0.9 : Math.min(0.04, linkBaseOpacity)
        )
        .attr("stroke-width", (link) =>
          touching(link)
            ? Math.max(1.2, widthScale(link.shared))
            : widthScale(link.shared)
        )
        .attr("stroke", (link) => (touching(link) ? "var(--accent)" : null));
    }

    svg.on("click", () => {
      ui.closeDrawer();
    });

    repaint = paintHighlight;
    paintHighlight();
    updateEgoButton();

    const ticked = () => {
      linkSelection
        .attr("x1", (link) => link.source.x)
        .attr("y1", (link) => link.source.y)
        .attr("x2", (link) => link.target.x)
        .attr("y2", (link) => link.target.y);
      nodeSelection.attr("transform", (entry) => `translate(${entry.x},${entry.y})`);
    };

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
          .radius((entry) => nodeRadius(entry) + 5)
          .strength(0.95)
          .iterations(2)
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .on("tick", ticked);

    // Settle off-screen, then fit: the user never sees the initial collisions.
    simulation.stop();
    simulation.tick(420);
    ticked();
    labelled = chooseLabels(nodeList);
    labelSelection
      .attr("display", (entry) => (labelled.has(entry.id) ? null : "none"))
      .attr("x", (entry) => {
        const label = labelled.get(entry.id);
        return label ? label.x - entry.x : nodeRadius(entry) + 2;
      })
      .attr("y", (entry) => {
        const label = labelled.get(entry.id);
        return label ? label.y - entry.y : 3;
      })
      .attr("text-anchor", (entry) => labelled.get(entry.id)?.anchor || "start");
    fitGraph();
    renderedStats = { nodes: nodeList.length, links: links.length };
    updateStats();
    ctx.refreshSelectionStatus?.();
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

  const NODE_MIN_RADIUS = 3;
  const NODE_MAX_RADIUS = 9.5;

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
        { x: entry.x + radius + 3, y: entry.y + 3, anchor: "start" },
        { x: entry.x - radius - 3, y: entry.y + 3, anchor: "end" }
      ];
      for (const option of options) {
        const left = option.anchor === "start" ? option.x : option.x - labelWidth;
        const box = {
          left: left - 3,
          right: left + labelWidth + 3,
          top: option.y - 10,
          bottom: option.y + 10
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

  function drag() {
    return d3
      .drag()
      .on("start", (event, node) => {
        highlightHoverEdges(null);
        if (!event.active) simulation.alphaTarget(0.08).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        highlightHoverEdges(null);
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event, node) => {
        if (!event.active) simulation.alphaTarget(0);
        node.fx = null;
        node.fy = null;
      });
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
      repaint();
    },
    pause() {
      if (simulation) simulation.stop();
    },
    resume() {
      if (simulation && simulation.alpha() > simulation.alphaMin()) simulation.restart();
    },
    resize() {
      if (!data || !lastNodes.length) return;
      const width = Math.max(360, root.clientWidth || 1000);
      const height = Math.max(420, root.clientHeight || 600);
      if (width === viewportWidth && height === viewportHeight) return;
      viewportWidth = width;
      viewportHeight = height;
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      svg.attr("width", width).attr("height", height);
      fitGraph();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-co-credits.svg" };
    }
  };
}
