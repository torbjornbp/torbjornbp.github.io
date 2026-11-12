// Co-credit network: names connected when they share at least one work.
//
// Drawn on one canvas, like the names & works network (see network.js), so
// both force-directed views share one rendering approach: hit-testing, hover
// and drag are done by hand, and the export is a PNG.

import { iriList, limit, runQuery } from "./sparql.js";
import * as ui from "./ui.js";
import { maxRadiusFor, runLayout, zoomedRadiusFactor } from "./layout.js";

const FONT_FALLBACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const NODE_MIN_RADIUS = 3;
// Largest name radius in a small graph; grows with the graph (see
// maxRadiusFor in layout.js).
const NODE_MAX_RADIUS = 9.5;
// Edge opacity of the earlier SVG version (its .link rule), kept so the mesh
// reads the same on canvas.
const LINK_ALPHA = 0.6;
// Edges are stroked in interleaved batches per width rather than one call
// each; see network.js.
const LINK_BATCHES = 24;
// Names the view can draw, chosen in its own Names control.
const NAME_OPTIONS = [100, 250, 500, 1000, 2500, 5000, 10000];
// Above this many names, pairs sharing fewer than coCreditLargeMinShared works
// are left out on the server: at two shared works, 10,000 names produce far
// more pairs than the endpoint can return within its time budget.
const LARGE_NAMES = 1000;
// The pair budget grows with the names: coCreditRows is the floor and
// coCreditRowsMax the ceiling (the strongest pairs are kept), so 100 names
// keep their old budget.
const PAIRS_PER_NAME = 20;

// Up to this many nodes the repulsion stops at a distance, which keeps a small
// graph compact. Larger graphs need unlimited range: with a cutoff, thousands
// of nodes pile up on visible circles at exactly that distance. Without one,
// separate clusters drift far apart, so a gentle pull towards the centre
// (LARGE_GRAPH_GRAVITY) holds them; that halved the spread of a 7,400-name
// graph without blurring its clusters.
const SMALL_GRAPH_NODES = 400;
const LARGE_GRAPH_GRAVITY = 0.03;
function repulsionRange(nodeCount) {
  return nodeCount > SMALL_GRAPH_NODES ? Infinity : 1200;
}
// A fitted 10,000-name graph needs to zoom out well below the usual 5%.
const MIN_ZOOM = 0.01;

// Settle the co-credit layout. In a worker it gets typed arrays (links refer
// to node indices) and returns positions; on the main thread it can instead
// take the drawn nodes and links and return a cool simulation for dragging.
// It runs from its source text in the worker, so it may only use its
// arguments.
function settleCoCredits(d3, input, report) {
  const nodes = input.nodes || Array.from(input.radii, (r) => ({ r }));
  const links =
    input.links ||
    Array.from(input.sources, (source, index) => ({
      source,
      target: input.targets[index],
      shared: input.shared[index]
    }));
  if (!input.nodes && input.fixed >= 0) {
    nodes[input.fixed].fx = input.width / 2;
    nodes[input.fixed].fy = input.height / 2;
  }
  const simulation = d3
    .forceSimulation(nodes)
    .velocityDecay(0.4)
    .force(
      "link",
      d3
        .forceLink(links)
        .distance((link) => 100 + 50 / Math.sqrt(link.shared))
        .strength(0.05)
    )
    // A repulsion cutoff piles thousands of nodes up on circles at the cutoff
    // distance, so large graphs repel without one (see SMALL_GRAPH_NODES).
    .force("charge", d3.forceManyBody().strength(-800).distanceMax(input.distanceMax))
    .force(
      "collide",
      d3
        .forceCollide()
        .radius((entry) => entry.r + 5)
        .strength(0.95)
        .iterations(2)
    )
    .force("center", d3.forceCenter(input.width / 2, input.height / 2));
  if (input.distanceMax === Infinity) {
    simulation
      .force("x", d3.forceX(input.width / 2).strength(input.gravity))
      .force("y", d3.forceY(input.height / 2).strength(input.gravity));
  }
  simulation.stop();
  if (input.keep) return { simulation: simulation.alpha(input.alpha) };
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
  let drawSequence = 0;
  // True while a layout settles: dragging waits for the final positions.
  let settling = false;
  // Refit as the layout settles until the user zooms or pans.
  let autoFit = true;
  // Cancels a layout still settling when a newer one starts.
  let drawController = null;
  let linkGroups = [];
  let palette = null;
  let nameCount = NAME_OPTIONS[0];
  const thresholdControl = thresholdInput
    ? thresholdInput.closest(".inline-control")
    : null;
  const egoButton = document.getElementById("co-credits-ego");
  const namesSelect = document.getElementById("co-credits-names");
  const limitsNote = document.getElementById("co-credits-limits");
  if (limitsNote) {
    const count = (value) => ui.formatNumber(value);
    limitsNote.replaceChildren(
      ...[
        "Two names are linked when both are credited on the same work, in any " +
          "role. A line's width is the number of distinct works they share, " +
          "and a name counts once per work however many roles it holds there. " +
          "A name's size follows how many names it is linked to.",
        "Why the limits: every loaded name is paired with each other loaded name it shares a work " +
          "with, so the possible pairs grow roughly with the square of the name " +
          "count, not in step with it. 1,000 names give about 50,000 pairs at two " +
          "shared works; 2,000 names already give about 130,000.",
        "The public endpoint stops any query after 30 seconds, and it has to " +
          "count every pair before it can pick the strongest. So above " +
          `${count(LARGE_NAMES)} names only pairs sharing at least ` +
          `${limit("coCreditLargeMinShared", 3)} works are fetched, and at most the ` +
          `${count(limit("coCreditRowsMax", 50000))} strongest pairs are drawn.`,
        "The layout settles in the background and is drawn as it goes, so a " +
          "larger graph appears quickly but takes longer to come to rest."
      ].map((text) => ui.node("p", "", text))
    );
  }
  if (namesSelect) {
    namesSelect.replaceChildren(
      ...NAME_OPTIONS.map((count) => {
        const option = document.createElement("option");
        option.value = String(count);
        option.textContent = ui.formatNumber(count);
        return option;
      })
    );
    namesSelect.value = String(nameCount);
    namesSelect.addEventListener("change", () => {
      nameCount = Number(namesSelect.value) || NAME_OPTIONS[0];
      syncThreshold();
      ctx.reload?.("co-credits");
    });
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
      MIN_ZOOM,
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
    .scaleExtent([MIN_ZOOM, 8])
    .on("zoom", (event) => {
      transform = event.transform;
      // A user's own zoom or pan (not a programmatic fit) stops the refits
      // that follow a settling layout.
      if (event.sourceEvent) autoFit = false;
      scheduleDraw();
    });

  // The drag is registered before the zoom so a press on a node moves the node
  // and a press on empty canvas pans. The simulation stays warm while a node
  // is held, so its neighbours follow.
  const drag = d3
    .drag()
    .subject((event) => {
      if (settling) return undefined;
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

  // Fewest shared works a pair needs to be fetched at all, for the current
  // name count (see LARGE_NAMES).
  function minimumShared() {
    return nameCount > LARGE_NAMES
      ? Math.max(limit("coCreditMinShared", 2), limit("coCreditLargeMinShared", 3))
      : limit("coCreditMinShared", 2);
  }

  // The slider cannot go below what was fetched; raising the floor raises the
  // threshold with it.
  function syncThreshold() {
    const floor = minimumShared();
    if (threshold < floor) threshold = floor;
    if (!thresholdInput) return;
    thresholdInput.min = String(floor);
    thresholdInput.value = String(threshold);
    const thresholdOutput = document.getElementById("shared-value");
    if (thresholdOutput) thresholdOutput.textContent = String(threshold);
  }

  if (thresholdInput) {
    const thresholdOutput = document.getElementById("shared-value");
    thresholdInput.max = String(limit("coCreditMaxThreshold", 10));
    syncThreshold();
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
    linkGroups = [];
    drawSequence += 1;
    settling = false;
    if (drawController) drawController.abort();
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
    const maxAgents = nameCount;
    const agentData = await ctx.agentData(false, { top: maxAgents });
    if (signal && signal.aborted) return;
    const agents = agentData.rows
      .filter((row) => Number(row.works) >= ctx.state.minWorks)
      .slice(0, maxAgents);
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
    const pairLimit = Math.min(
      limit("coCreditRowsMax", 20000) || Infinity,
      Math.max(limit("coCreditRows", 3000), agents.length * PAIRS_PER_NAME)
    );
    const rows = await runQuery("co-credits", {
      AGENT_IRIS: iriList(agents.map((row) => row.agent)),
      SCOPE_FILTER: ctx.scopeFilter(),
      MIN_SHARED: minimumShared(),
      LIMIT: pairLimit
    }, { signal });
    if (signal && signal.aborted) return;
    data = build(rows, agentData.total, agents, agentData.roleMap, pairLimit, minimumShared());
    if (egoMode && lastSelection && lastSelection.kind === "agent") {
      selectEgo(lastSelection);
    } else {
      await draw();
    }
    hasRendered = true;
    ui.setStatus("");
  }

  function build(rows, total, agents, roleMap, pairLimit, minimum) {
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
      capped: rows.length >= pairLimit,
      minimumShared: minimum,
      nameTotal: total
    };
  }

  // Build and settle the layout for the current mode and threshold. A large
  // graph settles in a worker; the old picture stays up until it is ready.
  async function draw() {
    if (!data) return;
    const isEgo = lastSelection && lastSelection.kind === "agent" && ego;
    if (isEgo && !ego.rows) return;
    const sequence = ++drawSequence;

    const { width, height } = dimensions();
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
      statsElement.textContent = `${ui.formatNumber(data.links.length)} pairs at ${data.minimumShared}+ shared works`;
      return;
    }

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
    const scale = makeRadiusScale(nodeList);
    const position = new Map();
    nodeList.forEach((entry, index) => {
      entry.r = nodeRadius(entry, scale);
      position.set(entry.id, index);
    });

    const ticks = nodeList.length > 300 ? 300 : 420;
    const input = {
      radii: Float64Array.from(nodeList, (entry) => entry.r),
      sources: Uint32Array.from(visible, (link) => position.get(link.source)),
      targets: Uint32Array.from(visible, (link) => position.get(link.target)),
      shared: Float64Array.from(visible, (link) => link.shared),
      fixed: isEgo ? position.get(ego.id) : -1,
      width,
      height,
      ticks,
      reportEvery: 25,
      distanceMax: repulsionRange(nodeList.length),
      gravity: LARGE_GRAPH_GRAVITY
    };
    const links = visible.map((link) => ({
      source: nodeList[position.get(link.source)],
      target: nodeList[position.get(link.target)],
      shared: link.shared
    }));
    const minimumShared = isEgo ? 1 : threshold;
    const widths = d3
      .scaleSqrt()
      .domain([
        minimumShared,
        d3.max(links, (link) => link.shared) || minimumShared
      ])
      .range([0.5, 2.2]);
    // Widths are rounded to a few steps so edges can be stroked in batches.
    for (const link of links) link.width = Math.round(widths(link.shared) * 4) / 4;

    // The old picture stays up until the first positions arrive. From then on
    // the graph is drawn as it settles, refitted each time unless the user has
    // zoomed or panned, and dragging waits for the final layout.
    let shown = false;
    const show = (positions) => {
      if (sequence !== drawSequence) return;
      nodeList.forEach((entry, index) => {
        entry.x = positions.x[index];
        entry.y = positions.y[index];
        entry.vx = 0;
        entry.vy = 0;
      });
      if (!shown) {
        shown = true;
        resizeCanvas();
        ui.clear(root);
        hovered = null;
        autoFit = true;
        nodeIndex = new Map(nodeList.map((entry) => [entry.id, entry]));
        radiusScale = scale;
        widthScale = widths;
        linkGroups = d3.groups(links, (link) => link.width).sort((a, b) => a[0] - b[0]);
        renderedMode = isEgo ? "ego" : "global";
        renderedEgoId = isEgo ? ego.id : null;
        incident = new Map();
        for (const link of links) {
          for (const end of [link.source, link.target]) {
            if (!incident.has(end.id)) incident.set(end.id, []);
            incident.get(end.id).push(link);
          }
        }
        lastNodes = nodeList;
        lastLinks = links;
        renderedStats = { nodes: nodeList.length, links: links.length };
        updateEgoButton();
        updateStats();
      }
      labelled = chooseLabels(nodeList);
      refreshHighlight();
      if (autoFit) fitGraph();
    };

    // A worker's start-up costs more than settling a small graph here.
    const small = nodeList.length + visible.length < 1500;
    if (!small) ui.setStatus(`Laying out ${ui.formatNumber(nodeList.length)} names…`);
    if (drawController) drawController.abort();
    const controller = (drawController = new AbortController());
    settling = true;
    const layout = await runLayout(settleCoCredits, input, {
      inline: small,
      onProgress: show,
      signal: controller.signal
    });
    if (sequence !== drawSequence || !layout) return;
    settling = false;
    if (!small) ui.setStatus("");
    show(layout);

    // The live simulation only runs while a node is dragged, so its neighbours
    // follow. It starts as cool as the settled layout ended, so a drag nudges
    // the graph instead of re-exploding it.
    simulation = settleCoCredits(d3, {
      nodes: nodeList,
      links,
      width,
      height,
      keep: true,
      distanceMax: repulsionRange(nodeList.length),
      gravity: LARGE_GRAPH_GRAVITY,
      alpha: Math.pow(0.001, ticks / 300)
    }).simulation.on("tick", scheduleDraw);
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

  // Large graphs shrink nodes less than the zoom when zoomed out, so their hubs
  // stay visible in a fitted view; small graphs draw nodes at their true size.
  function nodeGrowth(k) {
    return lastNodes.length > SMALL_GRAPH_NODES ? zoomedRadiusFactor(k) : 1;
  }

  // Theme colours, resolved once and again only after a theme change.
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
      font: token("--font", FONT_FALLBACK),
      fontSize: 0.6875 * (parseFloat(styles.fontSize) || 16)
    };
    return palette;
  }

  function paint() {
    if (!painter) return;
    painter.setTransform(ratio, 0, 0, ratio, 0, 0);
    painter.clearRect(0, 0, viewportWidth, viewportHeight);
    if (!lastNodes.length) return;

    const { border, accent, surface, text, nameColour, font, fontSize } = colours();

    const k = transform.k;
    const grow = nodeGrowth(k);
    painter.translate(transform.x, transform.y);
    painter.scale(k, k);

    // Visible part of the graph, in graph coordinates.
    const left = -transform.x / k;
    const top = -transform.y / k;
    const right = left + viewportWidth / k;
    const bottom = top + viewportHeight / k;
    const hidden = (link) => {
      const a = link.source;
      const b = link.target;
      return (
        (a.x < left && b.x < left) ||
        (a.x > right && b.x > right) ||
        (a.y < top && b.y < top) ||
        (a.y > bottom && b.y > bottom)
      );
    };
    // One width per group, stroked in interleaved batches: overlaps within a
    // batch do not darken, but a dense area holds edges from many batches. The
    // width is divided by the zoom scale so it does not grow with the zoom.
    const strokeLinks = (groups, colour, alpha, minimumWidth, wanted) => {
      painter.strokeStyle = colour;
      painter.globalAlpha = alpha;
      for (const [width, list] of groups) {
        const batches = Math.min(LINK_BATCHES, list.length);
        painter.lineWidth = Math.max(minimumWidth, width) / k;
        for (let batch = 0; batch < batches; batch += 1) {
          painter.beginPath();
          for (let index = batch; index < list.length; index += batches) {
            const link = list[index];
            if ((wanted && !wanted(link)) || hidden(link)) continue;
            painter.moveTo(link.source.x, link.source.y);
            painter.lineTo(link.target.x, link.target.y);
          }
          painter.stroke();
        }
      }
    };

    // "Selected only" hides the background mesh in the global view; the
    // isolated view has no background, so it always shows its edges.
    if (renderedMode === "ego" || linkMode !== "selected") {
      strokeLinks(linkGroups, border, LINK_ALPHA, 0, highlighting ? (link) => !link.touching : null);
    }
    if (highlighting) strokeLinks(linkGroups, accent, 0.9, 1.2, (link) => link.touching);
    // Hovered edges are redrawn above the mesh, so a node's relations stand
    // out without raising the opacity of the whole graph.
    if (hovered) {
      strokeLinks(d3.groups(incident.get(hovered.id) || [], (link) => link.width), accent, 0.9, 1);
    }

    // Nodes as one path per style; dimmed ones first, so the highlighted
    // nodes sit on top.
    const groups = [[], [], []];
    for (const entry of lastNodes) {
      groups[highlighting && !entry.near ? 0 : entry.near ? 2 : 1].push(entry);
    }
    const drawNodes = (list, alpha, outline, outlineWidth) => {
      if (!list.length) return;
      painter.beginPath();
      for (const entry of list) {
        painter.moveTo(entry.x + entry.r * grow, entry.y);
        painter.arc(entry.x, entry.y, entry.r * grow, 0, 2 * Math.PI);
      }
      painter.globalAlpha = alpha;
      painter.fillStyle = nameColour;
      painter.fill();
      painter.strokeStyle = outline;
      painter.lineWidth = outlineWidth;
      painter.stroke();
    };
    drawNodes(groups[0], 0.1, surface, 1);
    drawNodes(groups[1], 1, surface, 1);
    drawNodes(groups[2], 1, accent, 1.3);
    painter.globalAlpha = 1;
    const selectedEntry = selectedId ? nodeIndex.get(selectedId) : null;
    if (selectedEntry && selectedEntry.near) {
      painter.beginPath();
      painter.arc(selectedEntry.x, selectedEntry.y, selectedEntry.r * grow, 0, 2 * Math.PI);
      painter.strokeStyle = accent;
      painter.lineWidth = 2.4;
      painter.stroke();
    }

    const selectedNode = selectedId ? nodeIndex.get(selectedId) : null;
    if (selectedNode) {
      painter.beginPath();
      painter.arc(selectedNode.x, selectedNode.y, selectedNode.r * grow + 5, 0, 2 * Math.PI);
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
      // Placements assume the undrawn radius; move out with the node.
      const x = entry.x + (placement ? placement.dx + Math.sign(placement.dx) * entry.r * (grow - 1) : entry.r * grow + 2);
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
    const grow = nodeGrowth(transform.k);
    for (let index = lastNodes.length - 1; index >= 0; index -= 1) {
      const entry = lastNodes[index];
      const dx = entry.x - gx;
      const dy = entry.y - gy;
      if (dx * dx + dy * dy <= (entry.r * grow + slack) ** 2) return entry;
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
      .range([NODE_MIN_RADIUS, maxRadiusFor(nodeList.length, NODE_MAX_RADIUS)])
      .clamp(true);
  }

  function nodeRadius(entry, scale = radiusScale) {
    if (!scale) return NODE_MIN_RADIUS;
    return scale(Math.max(1, entry.degree || 0));
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
      return { canvas, name: "fiaf-co-credits.png", background: colours().surface };
    }
  };
}
