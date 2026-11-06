// Bipartite force-directed network: loaded names <-> their works.
//
// The layout is computed once per data load: the simulation is pre-ticked
// off-screen and then stopped, so browsing does not run physics in the browser.
// Selecting a name or work only repaints opacity/stroke and never rebuilds the
// graph. Entities outside the loaded slice are not drawn; the sidebar dims rows
// the view cannot show.

import { iriList, limit, runQuery } from "./sparql.js";
import { linkOpacity } from "./graph.js";
import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";

export function create(ctx, root, statsElement, linkButtons) {
  let data = null;
  let focusIds = new Set();
  let nodeIndex = new Map();
  let lastSelection = null;
  let lastNodes = [];
  let labelBoxes = [];
  let labelledIds = new Set();
  let radiusScale = null;
  let linkMode = "all";
  let linkBaseOpacity = 0.2;
  let paintHighlight = () => {};
  let hideHoverLabel = () => {};
  let highlightHoverEdges = () => {};
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
      paintHighlight();
    });
  }

  syncLinkButtons();

  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "Network of names and works");
  const layer = svg.append("g");
  const zoom = d3
    .zoom()
    .scaleExtent([0.05, 8])
    .on("zoom", (event) => layer.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("dblclick", () => fitGraph());

  function dimensions() {
    return {
      width: Math.max(360, root.clientWidth || 1000),
      height: Math.max(420, root.clientHeight || 600)
    };
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
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
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
      nodeIndex = new Map();
      lastNodes = [];
      focusIds = new Set();
      labelBoxes = [];
      paintHighlight = () => {};
      highlightHoverEdges = () => {};
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
      lastNodes = [];
      nodeIndex = new Map();
      focusIds = new Set();
      labelBoxes = [];
      radiusScale = null;
      linkBaseOpacity = 0;
      paintHighlight = () => {};
      highlightHoverEdges = () => {};
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
    const { width, height } = dimensions();
    viewportWidth = width;
    viewportHeight = height;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    ui.clear(root);
    layer.selectAll("*").remove();

    const links = data.links.map((link) => ({ ...link }));
    const nodes = data.nodes.map((node) => ({ ...node }));
    lastNodes = nodes;
    nodeIndex = new Map(nodes.map((node) => [node.id, node]));
    radiusScale = agentRadiusScale(nodes);
    linkBaseOpacity = linkOpacity(links.length);

    const linkSelection = layer
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", "link")
      .attr("stroke-width", 0.5);

    // A node's own edges are redrawn above the background mesh on hover, so a
    // click target stays readable even when the full graph is a faint hairball.
    const hoverLinkGroup = layer.append("g").attr("class", "link-hover-layer");

    const nodeSelection = layer
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .call(drag(linkSelection));

    nodeSelection
      .append("circle")
      .attr("class", (node) => `node-${node.type}`)
      .attr("r", (node) => radius(node))
      .on("mouseenter", (event, node) => {
        showHoverLabel(node);
        highlightHoverEdges(node);
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
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", () => {
        hoverLabel.attr("display", "none");
        highlightHoverEdges(null);
        ui.hideTooltip();
      })
      .on("click", (event, node) => {
        event.stopPropagation();
        if (node.type === "agent") {
          ctx.openAgent(node.id, node.name);
        } else {
          ctx.openWork(node.id, node.title);
        }
      })
      .on("dblclick", (event) => event.stopPropagation());

    const haloSelection = nodeSelection
      .append("circle")
      .attr("class", "node-halo")
      .attr("r", (node) => radius(node) + 4)
      .attr("display", "none");

    const labelSelection = nodeSelection
      .append("text")
      .attr("class", "node-label")
      .attr("x", (node) => radius(node) + 3)
      .attr("y", 3)
      .attr("display", "none")
      .text((node) =>
        node.type === "agent" ? truncate(node.name, 22) : truncate(node.title, 26)
      );

    // One extra label for whatever the pointer is over. The overview keeps only
    // a sparse, collision-free set of labels, so without this a node whose label
    // did not fit would be unidentifiable except through the tooltip.
    const hoverLabel = layer
      .append("text")
      .attr("class", "node-label node-label-hover")
      .attr("display", "none")
      .attr("pointer-events", "none");

    function showHoverLabel(node) {
      if (!node || labelledIds.has(node.id)) {
        hoverLabel.attr("display", "none");
        return;
      }
      hoverLabel
        .attr("x", node.x + radius(node) + 3)
        .attr("y", node.y + 3)
        .attr("text-anchor", "start")
        .text(
          node.type === "agent" ? truncate(node.name, 30) : truncate(node.title, 34)
        )
        .attr("display", null);
    }

    hideHoverLabel = () => hoverLabel.attr("display", "none");

    highlightHoverEdges = (node) => {
      hoverLinkGroup.selectAll("*").remove();
      if (!node) return;
      const incident = links.filter(
        (link) => link.source.id === node.id || link.target.id === node.id
      );
      if (!incident.length) return;
      hoverLinkGroup
        .selectAll("line")
        .data(incident)
        .join("line")
        .attr("class", "link link-hover")
        .attr("stroke-opacity", 0.9)
        .attr("stroke-width", 1.2)
        .attr("x1", (link) => link.source.x)
        .attr("y1", (link) => link.source.y)
        .attr("x2", (link) => link.target.x)
        .attr("y2", (link) => link.target.y);
    };

    let overviewLabels = new Map();

    paintHighlight = () => {
      const selectedId = lastSelection ? lastSelection.id : null;
      haloSelection.attr("display", (node) =>
        node.id === selectedId ? null : "none"
      );
      const activeLabels = focusIds.size
        ? chooseFocusedLabels(nodes, focusIds, selectedId)
        : overviewLabels;
      labelledIds = new Set(activeLabels.keys());
      labelSelection
        .attr("display", (node) => (activeLabels.has(node.id) ? null : "none"))
        .attr("x", (node) => {
          const placement = activeLabels.get(node.id);
          return placement ? placement.dx : radius(node) + 3;
        })
        .attr("text-anchor", (node) => {
          const placement = activeLabels.get(node.id);
          return placement ? placement.anchor : "start";
        });
      if (!focusIds.size) {
        nodeSelection.attr("opacity", 1);
        linkSelection
          .attr("display", linkMode === "selected" ? "none" : null)
          .attr("stroke-opacity", linkBaseOpacity)
          .attr("stroke-width", 0.5)
          .attr("stroke", null);
        nodeSelection
          .select("circle")
          .attr("stroke", null)
          .attr("stroke-width", null);
        return;
      }
      nodeSelection.attr("opacity", (node) =>
        focusIds.has(node.id) ? 1 : 0.1
      );
      const focusedLink = (link) =>
        focusIds.has(link.source.id) && focusIds.has(link.target.id);
      linkSelection
        .attr("display", (link) =>
          linkMode === "selected" && !focusedLink(link) ? "none" : null
        )
        .attr("stroke-opacity", (link) =>
          focusedLink(link) ? 0.9 : Math.min(0.04, linkBaseOpacity)
        )
        .attr("stroke-width", (link) => (focusedLink(link) ? 1.4 : 0.5))
        .attr("stroke", (link) => (focusedLink(link) ? "var(--accent)" : null));
      nodeSelection
        .select("circle")
        .attr("stroke", (node) => (focusIds.has(node.id) ? "var(--accent)" : null))
        .attr("stroke-width", (node) =>
          node.id === selectedId ? 2.4 : focusIds.has(node.id) ? 1.3 : null
        );
    };

    svg.on("click", () => {
      ui.closeDrawer();
    });

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
          .radius((node) => radius(node) + 3.5)
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

    linkSelection
      .attr("x1", (link) => link.source.x)
      .attr("y1", (link) => link.source.y)
      .attr("x2", (link) => link.target.x)
      .attr("y2", (link) => link.target.y);
    nodeSelection.attr("transform", (node) => `translate(${node.x},${node.y})`);

    overviewLabels = chooseOverviewLabels(nodes);
    paintHighlight();
    fitGraph();
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

    paintHighlight();
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

  const AGENT_MIN_RADIUS = 3;
  const AGENT_MAX_RADIUS = 10;
  const WORK_RADIUS = 2.6;

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

  // Dragging moves one node and its own edges only; the settled layout is not
  // re-simulated, so the rest of the graph stays exactly where it was.
  function drag(linkSelection) {
    return d3
      .drag()
      .on("drag", function (event, node) {
        hideHoverLabel();
        highlightHoverEdges(null);
        node.x = event.x;
        node.y = event.y;
        d3.select(this).attr("transform", `translate(${node.x},${node.y})`);
        linkSelection
          .filter((link) => link.source === node || link.target === node)
          .attr("x1", (link) => link.source.x)
          .attr("y1", (link) => link.source.y)
          .attr("x2", (link) => link.target.x)
          .attr("y2", (link) => link.target.y);
      });
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
      paintHighlight();
    },
    resize() {
      if (!data || !lastNodes.length) return;
      const { width, height } = dimensions();
      if (width === viewportWidth && height === viewportHeight) return;
      viewportWidth = width;
      viewportHeight = height;
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      svg.attr("width", width).attr("height", height);
      fitGraph();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-names-works.svg" };
    }
  };
}
