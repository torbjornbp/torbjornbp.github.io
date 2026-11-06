// Bubble cloud of credited names. Area is proportional to distinct works.
//
// Canvas rather than SVG: the "All" option can put the whole catalog of names
// on screen. Circles are drawn per frame, labels only where they fit, and hit
// testing scans the packed circles exactly.

import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MAX_ZOOM = 240;

function cssValue(value, styles) {
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(String(value || ""));
  if (!match) return value;
  const source = styles || getComputedStyle(document.documentElement);
  return source.getPropertyValue(match[1]).trim() || "#000000";
}

function rgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!match) return null;
  const number = parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function luminance(value) {
  const colour = rgb(value);
  if (!colour) return 1;
  const channels = colour.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045
      ? unit / 12.92
      : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) /
    (Math.min(first, second) + 0.05);
}

function blend(foreground, background, alpha) {
  const front = rgb(foreground);
  const back = rgb(background);
  if (!front || !back) return background;
  const channels = front.map(
    (value, index) => Math.round(value * alpha + back[index] * (1 - alpha))
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function labelColour(fill, surface) {
  const background = blend(fill, surface, 0.9);
  return contrast("#111111", background) >= contrast("#ffffff", background)
    ? "#111111"
    : "#ffffff";
}

export function create(ctx, root, legendElement, statsElement) {
  let data = null;
  let term = "";
  let bubbles = [];
  let hovered = null;
  let width = 1000;
  let height = 700;
  let transform = d3.zoomIdentity;
  let searchTimer = null;
  let selectedAgents = new Set();
  let selectedMatches = new Set();
  let bubbleAgents = new Set();
  let frame = null;
  let hasRendered = false;
  let loadToken = 0;

  const canvas = document.createElement("canvas");
  canvas.className = "cloud-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Bubble cloud of credited names sized by number of works"
  );
  root.append(canvas);

  const painter = canvas.getContext("2d");
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (!data) return;
          const next = dimensions();
          if (next.width !== width || next.height !== height) layout();
        })
      : null;
  if (resizeObserver) resizeObserver.observe(root);
  const selection = d3.select(canvas);
  const zoom = d3
    .zoom()
    .scaleExtent([1, MAX_ZOOM])
    .on("zoom", (event) => {
      transform = event.transform;
      scheduleDraw();
    });
  selection.call(zoom).on("dblclick.zoom", null);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  selection.on("dblclick", fitView);

  function fitView() {
    selection.interrupt();
    if (reduceMotion.matches) {
      selection.call(zoom.transform, d3.zoomIdentity);
      return;
    }
    selection.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
  }

  canvas.addEventListener("mousemove", (event) => {
    const bubble = pick(event);
    if (bubble !== hovered) {
      hovered = bubble;
      scheduleDraw();
      canvas.style.cursor = bubble ? "pointer" : "grab";
      if (!bubble) {
        ui.hideTooltip();
        return;
      }
      const roles = (bubble.roles || [])
        .slice(0, 3)
        .map((entry) => roleLabel(entry.role))
        .join(", ");
      ui.showTooltip(
        event,
        bubble.name,
        `${ui.formatNumber(bubble.works)} works${roles ? ` · ${roles}` : ""}`
      );
      return;
    }
    if (bubble) ui.moveTooltip(event);
  });

  canvas.addEventListener("mouseleave", () => {
    hovered = null;
    ui.hideTooltip();
    canvas.style.cursor = "";
    scheduleDraw();
  });

  canvas.addEventListener("click", (event) => {
    const bubble = pick(event);
    if (bubble) ctx.openAgent(bubble.agent, bubble.name);
  });

  async function load({ signal } = {}) {
    const token = ++loadToken;
    if (!hasRendered) {
      ui.message(root, "Loading names from QLever…");
    }
    ui.setStatus("Loading credited names…");
    const result = await ctx.agentData(true);
    if (token !== loadToken || (signal && signal.aborted)) return;
    data = result;
    layout();
    hasRendered = true;
    ui.setStatus(`Loaded ${ui.formatNumber(data.rows.length)} names.`);
  }

  function layout() {
    const rows = (data ? data.rows : []).filter(
      (row) => Number(row.works) >= ctx.state.minWorks
    );
    if (!rows.length) {
      bubbles = [];
      bubbleAgents = new Set();
      selectedMatches = new Set();
      hovered = null;
      ui.empty(root, "No names match the current filters.");
      statsElement.textContent = "";
      return;
    }
    ui.clear(root);
    resizeCanvas(rows.length);
    const hierarchy = d3
      .hierarchy({ children: rows })
      .sum((row) => Math.max(1, Number(row.works) || 1));
    d3.pack().size([width, height]).padding(2)(hierarchy);

    bubbles = hierarchy.leaves().map((leaf) => ({
      agent: leaf.data.agent,
      name: leaf.data.name,
      search: String(leaf.data.name || "").toLowerCase(),
      works: leaf.data.works,
      roles: leaf.data.roles || data.roleMap.get(leaf.data.agent) || [],
      colour: ctx.colorFor(
        leaf.data.dominantRole || ctx.dominantRole(leaf.data.agent, data.roleMap)
      ),
      x: leaf.x,
      y: leaf.y,
      r: leaf.r
    }));
    bubbleAgents = new Set(bubbles.map((bubble) => bubble.agent));
    refreshSelection();
    updateStats();

    ui.renderLegend(legendElement, ctx.topRoles(), ctx.colorFor);
    selection.call(zoom.transform, d3.zoomIdentity);
    scheduleDraw();
  }

  function updateStats() {
    if (!data) return;
    const baseRows = data.rows.filter(
      (row) => Number(row.works) >= ctx.state.minWorks
    );
    const cappedAll =
      ctx.state.topLimit === null && data.rows.length < data.total;
    const selectionStatus = ctx.selectionStatus?.();
    statsElement.textContent =
      `Showing ${ui.formatNumber(baseRows.length)} of ${ui.formatNumber(data.total)} credited names` +
      (data.works == null
        ? ""
        : ` · ${ui.formatNumber(data.works)} works credited`) +
      (data.credits == null
        ? ""
        : ` · ${ui.formatNumber(data.credits)} credits (each name counted once per work)`) +
      (cappedAll
        ? " · All is capped; narrow the scope to see more"
        : data.rows.length < data.total
          ? " · load more with “Names loaded”"
          : "") +
      (selectionStatus?.short ? ` · ${selectionStatus.short}` : "");
  }

  function dimensions() {
    return {
      width: Math.max(1, root.clientWidth || 1000),
      height: Math.max(460, Math.min(window.innerHeight * 0.72, 720))
    };
  }

  function resizeCanvas(count) {
    ({ width, height } = dimensions());
    // A 50k-bubble cloud is fill-rate bound; one device pixel per CSS pixel is
    // enough detail and cuts the raster work by 4x on a 2x display.
    const ratio = count > 20000 ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    // Keep the CSS box exactly equal to the packed layout. A percentage width
    // would stretch the old bitmap horizontally between a container resize and
    // the next repack, turning circles into ellipses.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    painter.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function visible(bubble, needle) {
    return !needle || bubble.search.includes(needle);
  }

  function refreshSelection() {
    selectedMatches = new Set();
    if (!selectedAgents.size) return;
    for (const agent of selectedAgents) {
      if (bubbleAgents.has(agent)) selectedMatches.add(agent);
    }
  }

  // Selection never repacks the cloud or resets the viewport. A name outside
  // the loaded slice has no bubble to highlight; the sidebar dims that row
  // instead of the chart inventing one.
  function select(selection) {
    // The selection arrives in two phases: the id first, then the query result
    // (workIds/agentIds). Painting the unresolved phase would flash the cloud
    // back to full opacity, so keep the current picture until it resolves.
    if (selection && selection.pending) {
      const awaitingAgents =
        selection.kind === "work" && selection.agentIds == null;
      const awaitingWorks =
        selection.kind === "agent" &&
        !bubbleAgents.has(selection.id) &&
        !Array.isArray(selection.workIds);
      if (awaitingAgents || awaitingWorks) return;
    }

    selectedAgents = new Set();
    if (selection) {
      if (selection.kind === "agent") {
        selectedAgents.add(selection.id);
      } else if (selection.agentIds) {
        for (const agent of selection.agentIds) selectedAgents.add(agent);
      }
    }

    refreshSelection();
    updateStats();
    scheduleDraw();
  }

  function scheduleDraw() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      draw();
    });
  }

  function draw() {
    if (!painter) return;
    const rendered = bubbles;
    if (!rendered.length) return;
    painter.clearRect(0, 0, width, height);
    const scale = transform.k;
    const offsetX = transform.x;
    const offsetY = transform.y;
    const needle = term.trim().toLowerCase();
    const hasSelection = selectedMatches.size > 0;

    // Resolve CSS variables once per frame instead of once per bubble.
    const styles = getComputedStyle(document.documentElement);
    const resolved = new Map();
    const colourOf = (value) => {
      if (resolved.has(value)) return resolved.get(value);
      const result = cssValue(value, styles);
      resolved.set(value, result);
      return result;
    };
    const accent = cssValue("var(--accent)", styles);
    const textColour =
      styles.getPropertyValue("--text").trim() || "#1a1a1a";
    const surfaceColour =
      styles.getPropertyValue("--surface").trim() || "#ffffff";

    // Group the circles by colour and alpha so a 50k-name cloud issues a
    // handful of fills instead of one beginPath/fill per bubble. Packed
    // bubbles do not overlap, so grouping does not change the picture.
    const groups = new Map();
    const minRadius = rendered.length > 20000 ? 0.5 : 0.35;
    for (const bubble of rendered) {
      const x = offsetX + bubble.x * scale;
      const y = offsetY + bubble.y * scale;
      const radius = bubble.r * scale;
      if (radius < minRadius) continue;
      if (x + radius < 0 || y + radius < 0 || x - radius > width || y - radius > height) {
        continue;
      }
      const chosen = hasSelection && selectedMatches.has(bubble.agent);
      const dimmed = hasSelection ? !chosen : !visible(bubble, needle);
      const alpha = dimmed ? 0.08 : 0.9;
      const key = `${bubble.colour}\u0000${alpha}`;
      let group = groups.get(key);
      if (!group) {
        group = { colour: bubble.colour, alpha, bubbles: [] };
        groups.set(key, group);
      }
      group.bubbles.push(bubble);
    }
    for (const group of groups.values()) {
      painter.globalAlpha = group.alpha;
      painter.fillStyle = colourOf(group.colour);
      painter.beginPath();
      for (const bubble of group.bubbles) {
        const radius = bubble.r * scale;
        const x = offsetX + bubble.x * scale;
        const y = offsetY + bubble.y * scale;
        painter.moveTo(x + radius, y);
        painter.arc(x, y, radius, 0, 2 * Math.PI);
      }
      painter.fill();
    }

    // Outlines are only needed for the hovered name and the current selection.
    for (const bubble of rendered) {
      const chosen = hasSelection && selectedMatches.has(bubble.agent);
      if (!chosen && bubble !== hovered) continue;
      const radius = bubble.r * scale;
      const x = offsetX + bubble.x * scale;
      const y = offsetY + bubble.y * scale;
      if (radius < minRadius) continue;
      if (x + radius < 0 || y + radius < 0 || x - radius > width || y - radius > height) {
        continue;
      }
      painter.globalAlpha = 1;
      painter.strokeStyle = accent;
      painter.lineWidth = chosen ? 2.4 : 2;
      painter.beginPath();
      painter.arc(x, y, radius, 0, 2 * Math.PI);
      painter.stroke();
      if (chosen) {
        painter.beginPath();
        painter.arc(x, y, Math.max(radius + 4, 10), 0, 2 * Math.PI);
        painter.lineWidth = 2.4;
        painter.stroke();
      }
    }

    painter.textAlign = "center";
    painter.textBaseline = "middle";
    for (const bubble of rendered) {
      const radius = bubble.r * scale;
      const chosen = hasSelection && selectedMatches.has(bubble.agent);
      if (radius < 13 && !chosen) continue;
      if (hasSelection && !chosen) continue;
      const x = offsetX + bubble.x * scale;
      const y = offsetY + bubble.y * scale;
      if (x + radius < 0 || y + radius < 0 || x - radius > width || y - radius > height) {
        continue;
      }
      const small = radius < 13;
      const size = small ? 11 : Math.max(9, Math.min(16, radius / 2.4));
      const labelY = small
        ? Math.max(12, Math.min(height - 12, y - 16))
        : y;
      painter.globalAlpha = hasSelection ? 1 : visible(bubble, needle) ? 1 : 0.15;
      painter.font = `600 ${size}px ${FONT}`;
      painter.lineWidth = Math.max(2, size / 5);
      const fill = colourOf(bubble.colour);
      const textFill = small
        ? textColour
        : labelColour(fill, surfaceColour);
      painter.strokeStyle = small
        ? surfaceColour
        : textFill === "#111111"
          ? "#ffffff"
          : "rgba(0, 0, 0, 0.35)";
      painter.fillStyle = textFill;
      const label = small ? bubble.name : truncate(bubble.name, radius);
      painter.strokeText(label, x, labelY);
      painter.fillText(label, x, labelY);
    }
    painter.globalAlpha = 1;
  }

  // Exact hit-test: a quadtree nearest-centre lookup misses pointers inside a
  // large bubble whenever a small bubble's centre is closer. A linear scan of
  // the packed bubbles is exact and cheap (tens of thousands of comparisons).
  function pick(event) {
    if (!painter || !bubbles.length) return null;
    const rect = canvas.getBoundingClientRect();
    const [x, y] = transform.invert([event.clientX - rect.left, event.clientY - rect.top]);
    const reach = 4 / transform.k;
    for (let index = bubbles.length - 1; index >= 0; index -= 1) {
      const bubble = bubbles[index];
      const dx = bubble.x - x;
      const dy = bubble.y - y;
      if (dx * dx + dy * dy <= (bubble.r + reach) ** 2) return bubble;
    }
    return null;
  }

  function truncate(name, radius) {
    const max = Math.max(3, Math.floor(radius / 3.2));
    const text = String(name || "");
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
  }

  return {
    load,
    select,
    fit: fitView,
    kinds: new Set(["agent"]),
    hasNode(id) {
      return bubbleAgents.has(id);
    },
    search(value) {
      term = value || "";
      clearTimeout(searchTimer);
      searchTimer = setTimeout(scheduleDraw, 80);
    },
    resize() {
      if (!data) return;
      const next = dimensions();
      if (next.width !== width || next.height !== height) layout();
      else scheduleDraw();
    },
    invalidate() {
      loadToken += 1;
      data = null;
    },
    exportSvg() {
      return { canvas, name: "fiaf-name-cloud.png" };
    }
  };
}
