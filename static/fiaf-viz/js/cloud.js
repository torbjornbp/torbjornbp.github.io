// Bubble cloud of credited names. Area is proportional to distinct works.
//
// Canvas rather than SVG: the "All" option can put the whole catalog of names
// on screen. Circles are drawn per frame, labels only where they fit, and hit
// testing scans the packed circles exactly.

import { roleLabel } from "./labels.js";
import * as ui from "./ui.js";

const FONT = '"Schibsted Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MAX_ZOOM = 400;

// d3.pack is exact but superlinear: ~0.25 s for 20k circles, ~6 s for 100k and
// ~35 s for every credited name. A larger cloud packs its biggest names exactly
// and lays the rest (mostly one-work names of equal size) on sunflower spirals
// around them, in linear time. It reads like d3.pack's own output: big names
// in the middle, small ones further out.
const EXACT_PACK = 20000;
// "All" first draws this many names, then grows as the full list arrives.
// The preview's names are the first EXACT_PACK of the full list, so their
// positions do not move when the rest is added.
const PREVIEW_NAMES = EXACT_PACK;
// Gap between bubbles, in units of a one-work bubble's radius.
const SPIRAL_PAD = 0.15;
// Nearest neighbours of a sunflower spiral sit 1.676 * sqrt(step) apart; a
// little under that keeps equal circles from touching.
const SPIRAL_SPACING = 1.6;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Representative coverage of a sub-pixel bubble drawn as a 1px square, by
// level (see draw()).
const DUST_COVERAGE = [0, 0.07, 0.18, 0.37, 0.65];

// Layout in units where a one-work bubble has radius 1, centred on the origin.
// Rows must be ordered by work count, highest first (the agents query order).
export function spiralLayout(rows) {
  const count = rows.length;
  const radii = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    radii[index] = Math.sqrt(Math.max(1, Number(rows[index].works) || 1));
  }
  const order = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => radii[b] - radii[a] || a - b
  );
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const core = order
    .slice(0, EXACT_PACK)
    .map((index) => ({ index, r: radii[index] + SPIRAL_PAD }));
  d3.packSiblings(core);
  const enclosure = d3.packEnclose(core);
  for (const circle of core) {
    x[circle.index] = circle.x - enclosure.x;
    y[circle.index] = circle.y - enclosure.y;
  }
  // One sunflower annulus per bubble size, each starting just outside the
  // previous one, so equal circles share a spiral and never overlap.
  let edge = enclosure.r;
  let turn = 0;
  for (let start = core.length; start < count; ) {
    const size = radii[order[start]] + SPIRAL_PAD;
    let end = start;
    while (end < count && radii[order[end]] + SPIRAL_PAD === size) end += 1;
    const step = ((2 * size) / SPIRAL_SPACING) ** 2;
    const inner = edge + size;
    for (let position = start; position < end; position += 1, turn += 1) {
      const distance = Math.sqrt(inner * inner + (position - start) * step);
      const index = order[position];
      x[index] = distance * Math.cos(turn * GOLDEN_ANGLE);
      y[index] = distance * Math.sin(turn * GOLDEN_ANGLE);
      edge = distance + size;
    }
    start = end;
  }
  return { x, y, r: radii, outer: edge };
}

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
  // Pixels per layout unit of the spiral layout (null for a d3.pack cloud).
  let layoutScale = null;
  let colourCount = 0;

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
    const stale = () => token !== loadToken || (signal && signal.aborted);
    if (!hasRendered) {
      ui.message(root, "Loading names from QLever…");
    }
    ui.setStatus("Loading credited names…");
    // "All" can be several hundred thousand names, which take seconds to
    // arrive. Draw the busiest names first, then fetch the full list, unless
    // it is already cached. The two run one after the other so the endpoint
    // computes the name counts once and serves the second query from cache.
    if (ctx.state.topLimit === null && !ctx.agentDataReady?.(true)) {
      const preview = await ctx
        .agentData(true, { cap: PREVIEW_NAMES })
        .catch(() => null);
      if (stale()) return;
      if (preview && preview.rows.length >= PREVIEW_NAMES) {
        data = { ...preview, partial: true };
        layout();
        hasRendered = true;
        ui.setStatus(
          `Showing the top ${ui.formatNumber(preview.rows.length)} names · loading all ${ui.formatNumber(preview.total)}…`
        );
      }
    }
    const result = await ctx.agentData(true);
    if (stale()) return;
    const growing = Boolean(data && data.partial);
    data = result;
    layout({ grow: growing });
    hasRendered = true;
    ui.setStatus(`Loaded ${ui.formatNumber(data.rows.length)} names.`);
  }

  // `grow` adds names around a preview that is already on screen: the preview
  // keeps its place on screen, and an untouched view then zooms out to fit.
  function layout({ grow = false } = {}) {
    const rows = (data ? data.rows : []).filter(
      (row) => Number(row.works) >= ctx.state.minWorks
    );
    if (!rows.length) {
      bubbles = [];
      bubbleAgents = new Set();
      selectedMatches = new Set();
      hovered = null;
      layoutScale = null;
      ui.empty(root, "No names match the current filters.");
      statsElement.textContent = "";
      return;
    }
    ui.clear(root);
    const previousScale = layoutScale;
    const previous = transform;
    resizeCanvas(rows.length);
    const colours = new Map();
    const bubble = (row, x, y, r) => {
      const colour = ctx.colorFor(
        row.dominantRole || ctx.dominantRole(row.agent, data.roleMap)
      );
      if (!colours.has(colour)) colours.set(colour, colours.size);
      return {
        agent: row.agent,
        name: row.name,
        search: String(row.name || "").toLowerCase(),
        works: row.works,
        roles: row.roles || data.roleMap.get(row.agent) || [],
        colour,
        colourIndex: colours.get(colour),
        x,
        y,
        r
      };
    };

    if (rows.length > EXACT_PACK || ctx.state.topLimit === null) {
      const placed = spiralLayout(rows);
      layoutScale = (Math.min(width, height) / (2 * placed.outer)) * 0.98;
      const cx = width / 2;
      const cy = height / 2;
      bubbles = rows.map((row, index) =>
        bubble(
          row,
          cx + placed.x[index] * layoutScale,
          cy + placed.y[index] * layoutScale,
          placed.r[index] * layoutScale
        )
      );
    } else {
      layoutScale = null;
      const hierarchy = d3
        .hierarchy({ children: rows })
        .sum((row) => Math.max(1, Number(row.works) || 1));
      d3.pack().size([width, height]).padding(2)(hierarchy);
      bubbles = hierarchy.leaves().map((leaf) => bubble(leaf.data, leaf.x, leaf.y, leaf.r));
    }
    colourCount = colours.size;
    bubbleAgents = new Set(bubbles.map((entry) => entry.agent));
    refreshSelection();
    updateStats();

    ui.renderLegend(legendElement, ctx.topRoles(), ctx.colorFor);
    if (grow && previousScale && layoutScale) {
      // Same picture as before: the preview's bubbles only shrank by
      // layoutScale / previousScale around the centre.
      const k = Math.max(1, previous.k * (previousScale / layoutScale));
      const cx = width / 2;
      const cy = height / 2;
      const kept = d3.zoomIdentity
        .translate(previous.x + (previous.k - k) * cx, previous.y + (previous.k - k) * cy)
        .scale(k);
      const untouched = previous.k === 1 && previous.x === 0 && previous.y === 0;
      selection.interrupt();
      selection.call(zoom.transform, kept);
      if (untouched) {
        if (reduceMotion.matches) selection.call(zoom.transform, d3.zoomIdentity);
        else selection.transition().duration(700).call(zoom.transform, d3.zoomIdentity);
      }
    } else {
      selection.call(zoom.transform, d3.zoomIdentity);
    }
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
      (data.partial
        ? " · loading the rest…"
        : cappedAll
        ? " · All is capped; narrow the scope to see more"
        : data.rows.length < data.total
          ? " · load more with “Names loaded”"
          : "") +
      (selectionStatus?.short ? ` · ${selectionStatus.short}` : "");
  }

  // The canvas takes every touch for pan and zoom. On touch screens keep it
  // well under the viewport so a strip of page stays free to scroll past it.
  const coarsePointer =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)")
      : { matches: false };

  function dimensions() {
    const share = coarsePointer.matches ? 0.55 : 0.72;
    const floor = coarsePointer.matches ? 320 : 460;
    return {
      width: Math.max(1, root.clientWidth || 1000),
      height: Math.max(floor, Math.min(window.innerHeight * share, 720))
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
      styles.getPropertyValue("--text").trim() || "#111214";
    const surfaceColour =
      styles.getPropertyValue("--surface").trim() || "#ffffff";

    // Group the circles by colour and alpha so a 50k-name cloud issues a
    // handful of fills instead of one beginPath/fill per bubble. Packed
    // bubbles do not overlap, so grouping does not change the picture. The key
    // is numeric: building a string per bubble per frame is measurable at
    // several hundred thousand names.
    //
    // A bubble smaller than half a pixel is drawn as a 1px square whose
    // opacity follows the area it would cover ("dust"), so the long tail of
    // one-work names stays visible when the whole cloud is in view.
    const groups = new Map();
    const minRadius = rendered.length > 20000 ? 0.5 : 0.35;
    for (const bubble of rendered) {
      const x = offsetX + bubble.x * scale;
      const y = offsetY + bubble.y * scale;
      const radius = bubble.r * scale;
      if (x + radius < 0 || y + radius < 0 || x - radius > width || y - radius > height) {
        continue;
      }
      let level = 0;
      if (radius < minRadius) {
        const coverage = Math.PI * radius * radius;
        level = coverage < 0.1 ? 1 : coverage < 0.25 ? 2 : coverage < 0.5 ? 3 : 4;
      }
      const chosen = hasSelection && selectedMatches.has(bubble.agent);
      const dimmed = hasSelection ? !chosen : !visible(bubble, needle);
      const key = ((dimmed ? 1 : 0) * DUST_COVERAGE.length + level) * (colourCount + 1) +
        (bubble.colourIndex ?? colourCount);
      let group = groups.get(key);
      if (!group) {
        const alpha = dimmed ? 0.08 : 0.9;
        group = {
          colour: bubble.colour,
          alpha: level ? alpha * DUST_COVERAGE[level] : alpha,
          dust: level > 0,
          bubbles: []
        };
        groups.set(key, group);
      }
      group.bubbles.push(bubble);
    }
    for (const group of groups.values()) {
      painter.globalAlpha = group.alpha;
      painter.fillStyle = colourOf(group.colour);
      painter.beginPath();
      for (const bubble of group.bubbles) {
        const x = offsetX + bubble.x * scale;
        const y = offsetY + bubble.y * scale;
        if (group.dust) {
          painter.rect(Math.floor(x), Math.floor(y), 1, 1);
          continue;
        }
        const radius = bubble.r * scale;
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
