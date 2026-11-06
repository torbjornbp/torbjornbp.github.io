// Shared chrome: tooltip, drawer, legend, status and error rendering.

import { humanize, roleLabel } from "./labels.js";

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-GB");
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

// -- tooltip ----------------------------------------------------------------

let tooltipElement = null;

function tooltip() {
  if (!tooltipElement) tooltipElement = document.getElementById("tooltip");
  return tooltipElement;
}

function positionTooltip(event) {
  const element = tooltip();
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const x = Math.min(window.innerWidth - rect.width - 12, event.clientX + 14);
  const y = Math.max(8, event.clientY - rect.height - 12);
  element.style.left = `${Math.max(8, x)}px`;
  element.style.top = `${y}px`;
}

export function showTooltip(event, title, body) {
  const element = tooltip();
  if (!element) return;
  element.replaceChildren();
  const heading = node("div", "tooltip-title", title);
  element.append(heading);
  if (body) element.append(node("div", "tooltip-body", body));
  element.hidden = false;
  positionTooltip(event);
}

export function moveTooltip(event) {
  const element = tooltip();
  if (!element || element.hidden) return;
  positionTooltip(event);
}

export function hideTooltip() {
  const element = tooltip();
  if (element) element.hidden = true;
}

// -- drawer -----------------------------------------------------------------

let drawerElement = null;
let drawerBody = null;
let drawerResizer = null;
let drawerHasSelection = false;
let drawerNav = null;
let drawerDrag = null;
let drawerResizeFrame = null;
const DESKTOP_DRAWER = window.matchMedia("(min-width: 1100px)");

function drawerViewportWidth() {
  return (
    document.body.clientWidth ||
    document.documentElement.clientWidth ||
    window.innerWidth
  );
}

function drawerWidthBounds() {
  const viewport = drawerViewportWidth();
  const catalogue = document.body.dataset.activeView === "catalogue";
  const desktop = DESKTOP_DRAWER.matches;
  const preferredMin = desktop && catalogue ? 460 : 320;
  const max = Math.max(220, viewport - (desktop ? 400 : 0));
  return { min: Math.min(preferredMin, max), max };
}

function syncDrawerViewport() {
  document.documentElement.style.setProperty(
    "--drawer-viewport-width",
    `${drawerViewportWidth()}px`
  );
}

function syncDrawerResizer() {
  if (!drawerResizer || !drawerElement) return;
  const open = drawerHasSelection && !drawerElement.hidden;
  drawerResizer.hidden = !open;
  if (!open) return;
  const bounds = drawerWidthBounds();
  const width = Math.round(drawerElement.getBoundingClientRect().width);
  const min = Math.round(bounds.min);
  const max = Math.round(bounds.max);
  drawerResizer.setAttribute("aria-valuemin", String(min));
  drawerResizer.setAttribute("aria-valuemax", String(max));
  drawerResizer.setAttribute("aria-valuenow", String(width));
  drawerResizer.setAttribute(
    "aria-valuetext",
    `${width} pixels wide`
  );
  drawerResizer.title =
    `Drag to resize the details panel. Left and right arrow keys resize it. ${width}px`;
}

function scheduleDrawerResize() {
  if (drawerResizeFrame !== null) return;
  drawerResizeFrame = requestAnimationFrame(() => {
    drawerResizeFrame = null;
    syncDrawerResizer();
    if (drawerHasSelection) notifyDrawerMode();
  });
}

function setDrawerWidth(width) {
  if (!drawerElement) return;
  const bounds = drawerWidthBounds();
  const value = Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
  document.body.style.setProperty("--drawer-user-width", `${value}px`);
  syncDrawerResizer();
  scheduleDrawerResize();
}

function startDrawerResize(event) {
  if (!drawerHasSelection || event.button !== 0) return;
  event.preventDefault();
  const width = drawerElement.getBoundingClientRect().width;
  drawerDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: width
  };
  drawerResizer.setPointerCapture(event.pointerId);
  drawerResizer.dataset.resizing = "true";
  drawerResizer.focus({ preventScroll: true });
  document.body.classList.add("drawer-resizing");
}

function moveDrawerResize(event) {
  if (!drawerDrag || event.pointerId !== drawerDrag.pointerId) return;
  const width =
    drawerDrag.startWidth + drawerDrag.startX - event.clientX;
  setDrawerWidth(width);
}

function finishDrawerResize(event) {
  if (!drawerDrag || event.pointerId !== drawerDrag.pointerId) return;
  if (drawerResizer.hasPointerCapture(event.pointerId)) {
    drawerResizer.releasePointerCapture(event.pointerId);
  }
  drawerDrag = null;
  delete drawerResizer.dataset.resizing;
  document.body.classList.remove("drawer-resizing");
  scheduleDrawerResize();
}

function resizeDrawerWithKeyboard(event) {
  if (!drawerHasSelection) return;
  const bounds = drawerWidthBounds();
  const width = drawerElement.getBoundingClientRect().width;
  const step = event.shiftKey ? 64 : 16;
  let next = null;
  if (event.key === "ArrowLeft") next = width + step;
  else if (event.key === "ArrowRight") next = width - step;
  else if (event.key === "Home") next = bounds.min;
  else if (event.key === "End") next = bounds.max;
  if (next === null) return;
  event.preventDefault();
  setDrawerWidth(next);
}

function drawer() {
  if (!drawerElement) {
    drawerElement = document.getElementById("drawer");
    drawerBody = document.getElementById("drawer-body");
    drawerResizer = document.getElementById("drawer-resizer");
    const close = document.getElementById("drawer-close");
    if (close) close.addEventListener("click", closeDrawer);
    syncDrawerViewport();
    if (drawerResizer) {
      drawerResizer.addEventListener("pointerdown", startDrawerResize);
      drawerResizer.addEventListener("pointermove", moveDrawerResize);
      drawerResizer.addEventListener("pointerup", finishDrawerResize);
      drawerResizer.addEventListener("pointercancel", finishDrawerResize);
      drawerResizer.addEventListener("keydown", resizeDrawerWithKeyboard);
    }
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => syncDrawerResizer()).observe(drawerElement);
    }
    window.addEventListener("resize", () => {
      syncDrawerViewport();
      syncDrawerResizer();
    });
    const previous = document.getElementById("drawer-prev");
    const next = document.getElementById("drawer-next");
    if (previous) {
      previous.addEventListener("click", () => {
        if (drawerNav && drawerNav.onPrev) drawerNav.onPrev();
      });
    }
    if (next) {
      next.addEventListener("click", () => {
        if (drawerNav && drawerNav.onNext) drawerNav.onNext();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
    });
    DESKTOP_DRAWER.addEventListener("change", syncDrawerMode);
  }
  return drawerElement;
}

function notifyDrawerMode() {
  document.dispatchEvent(
    new CustomEvent("fiaf-viz:drawer-mode", {
      detail: {
        desktop: DESKTOP_DRAWER.matches,
        open: drawerHasSelection
      }
    })
  );
}

function applyDrawerState(notify) {
  const element = drawer();
  if (!element) return;
  element.dataset.mode = DESKTOP_DRAWER.matches ? "docked" : "overlay";
  element.hidden = !drawerHasSelection;
  element.classList.toggle("open", drawerHasSelection);
  document.body.classList.toggle("drawer-open", drawerHasSelection);
  syncDrawerResizer();
  if (notify) notifyDrawerMode();
}

function syncDrawerMode() {
  applyDrawerState(true);
}

export function initDrawer() {
  drawer();
  applyDrawerState(false);
}

// Record-set navigation in the drawer header. `nav` is { position, hasPrev,
// hasNext, onPrev, onNext }; pass null to hide the controls.
export function setDrawerNav(nav) {
  const element = document.getElementById("drawer-nav");
  if (!element) return;
  drawerNav = nav || null;
  element.hidden = !drawerNav;
  if (!drawerNav) return;
  const position = document.getElementById("drawer-position");
  if (position) position.textContent = drawerNav.position || "";
  const previous = document.getElementById("drawer-prev");
  const next = document.getElementById("drawer-next");
  if (previous) previous.disabled = !drawerNav.hasPrev;
  if (next) next.disabled = !drawerNav.hasNext;
}

export function openDrawer(title, subtitle) {
  const element = drawer();
  if (!element) return;
  setDrawerNav(null);
  const firstOpen =
    element.hidden || !document.body.classList.contains("drawer-open");
  element.classList.remove("drawer-has-tabs");
  drawerHasSelection = true;
  document.getElementById("drawer-title").textContent = title;
  document.getElementById("drawer-subtitle").textContent = subtitle || "";
  drawerBody.replaceChildren();
  setDrawerContext("");
  element.hidden = false;
  document.body.classList.add("drawer-open");
  syncDrawerResizer();
  if (firstOpen) {
    requestAnimationFrame(() => {
      if (drawerHasSelection) element.classList.add("open");
    });
  } else {
    element.classList.add("open");
  }
  if (firstOpen) notifyDrawerMode();
}

// Update the header of an already-rendered drawer after a slower label query
// resolves. Unlike openDrawer, this keeps the current content in place.
export function setDrawerTitle(title, subtitle) {
  if (!drawerHasSelection) return;
  const titleElement = document.getElementById("drawer-title");
  const subtitleElement = document.getElementById("drawer-subtitle");
  if (titleElement) titleElement.textContent = title || "";
  if (subtitleElement && subtitle !== undefined) {
    subtitleElement.textContent = subtitle || "";
  }
}

export function drawerContent() {
  drawer();
  return drawerBody;
}

export function setDrawerContext(text, kind) {
  const element = document.getElementById("drawer-context");
  if (!element) return;
  const value = String(text || "").trim();
  element.hidden = !value;
  element.textContent = value;
  if (value) element.dataset.kind = kind || "note";
  else delete element.dataset.kind;
}

export function drawerIsOpen() {
  return drawerHasSelection;
}

export function closeDrawer() {
  const element = drawer();
  if (!element) return;
  const wasOpen = drawerHasSelection || !element.hidden;
  drawerHasSelection = false;
  setDrawerNav(null);
  setDrawerContext("");
  element.classList.remove("open");
  document.body.classList.remove("drawer-open");
  document.body.classList.remove("drawer-resizing");
  if (
    drawerDrag &&
    drawerResizer &&
    drawerResizer.hasPointerCapture(drawerDrag.pointerId)
  ) {
    drawerResizer.releasePointerCapture(drawerDrag.pointerId);
  }
  if (drawerResizer) delete drawerResizer.dataset.resizing;
  drawerDrag = null;
  syncDrawerResizer();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finish = () => {
    if (!drawerHasSelection) element.hidden = true;
  };
  if (DESKTOP_DRAWER.matches || reducedMotion.matches) finish();
  else setTimeout(finish, 200);
  if (wasOpen) notifyDrawerMode();
  document.dispatchEvent(new CustomEvent("fiaf-viz:drawer-close"));
}

export function panelMessage(container, text, kind) {
  if (!container) return;
  container.replaceChildren(
    node("p", kind ? `drawer-message ${kind}` : "drawer-message", text)
  );
}

export function drawerMessage(text, kind) {
  panelMessage(drawerContent(), text, kind);
}

export function drawerListInto(container, items, describe) {
  if (!container) return;
  container.replaceChildren();
  if (Array.isArray(describe.actions) && describe.actions.length) {
    const actions = node("div", "drawer-actions");
    for (const action of describe.actions) {
      const button = node("button", "drawer-action", action.label);
      button.type = "button";
      button.addEventListener("click", action.onClick);
      actions.append(button);
    }
    container.append(actions);
  }
  if (describe.heading) {
    const header = node("div", "drawer-section-head");
    header.append(node("h3", "drawer-section-title", describe.heading));
    const note =
      typeof describe.note === "function" ? describe.note() : describe.note;
    if (note) {
      header.append(node("p", "drawer-section-note", note));
    }
    container.append(header);
  }
  const list = node("ul", "drawer-list");
  const inView = describe.inView || (() => true);
  for (const item of items) {
    const entry = node("li", "drawer-item");
    if (describe.id) entry.dataset.entityId = describe.id(item);
    // Rows for names or works that the active view does not render stay
    // clickable but are dimmed, so "in the catalogue" and "in this view" differ
    // visibly without drawing placeholder nodes on the chart.
    if (!inView(item)) entry.classList.add("is-outside");
    const title = node("span", "drawer-item-title", describe.title(item));
    entry.append(title);
    const meta = describe.meta(item);
    if (meta) entry.append(node("span", "drawer-item-meta", meta));
    const selectable =
      describe.onSelect && (!describe.clickable || describe.clickable(item));
    if (selectable) {
      entry.classList.add("clickable");
      entry.tabIndex = 0;
      entry.setAttribute("role", "button");
      entry.addEventListener("click", () => describe.onSelect(item));
      entry.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          describe.onSelect(item);
        }
      });
    }
    list.append(entry);
  }
  container.append(list);
}

export function drawerList(items, describe) {
  drawerListInto(drawerContent(), items, describe);
}

// -- drawer tabs ------------------------------------------------------------

let drawerTabSequence = 0;

export function drawerTabs(tabs, options = {}) {
  const body = drawerContent();
  body.replaceChildren();
  if (!Array.isArray(tabs) || !tabs.length) {
    return {
      activate() {},
      active() {
        return null;
      },
      refresh() {},
      panel: null
    };
  }

  const element = drawer();
  if (element) element.classList.add("drawer-has-tabs");
  const tabsetId = `drawer-tabset-${++drawerTabSequence}`;
  const panelId = `${tabsetId}-panel`;
  const strip = node("div", "drawer-tabs");
  strip.setAttribute("role", "tablist");
  if (options.label) strip.setAttribute("aria-label", options.label);

  const panel = node("div", "drawer-tab-panel");
  panel.id = panelId;
  panel.setAttribute("role", "tabpanel");
  panel.tabIndex = 0;

  const buttons = new Map();
  let activeId = null;

  function render(tab, notify) {
    for (const [tabId, button] of buttons) {
      const selected = tabId === tab.id;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    }
    const button = buttons.get(tab.id);
    if (button) panel.setAttribute("aria-labelledby", button.id);
    panel.replaceChildren();
    tab.render(panel);
    if (notify && typeof options.onChange === "function") {
      options.onChange(tab.id);
    }
  }

  function activate(tabId) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    activeId = tab.id;
    render(tab, true);
  }

  for (const tab of tabs) {
    const button = node("button", "drawer-tab", tab.label || tab.id);
    button.type = "button";
    button.id = `${tabsetId}-${tab.id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panelId);
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    button.addEventListener("click", () => activate(tab.id));
    buttons.set(tab.id, button);
    strip.append(button);
  }

  strip.addEventListener("keydown", (event) => {
    const current =
      event.target.closest && event.target.closest('[role="tab"]');
    if (!current) return;
    const index = [...buttons.values()].indexOf(current);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    activate(tab.id);
    const button = buttons.get(tab.id);
    if (button) button.focus();
  });

  body.append(strip, panel);

  const initial = tabs.find((tab) => tab.id === options.active) || tabs[0];
  activeId = initial.id;
  render(initial, true);

  return {
    activate,
    active() {
      return activeId;
    },
    refresh() {
      const tab = tabs.find((entry) => entry.id === activeId);
      if (tab) render(tab, false);
    },
    panel
  };
}

// -- drawer metadata --------------------------------------------------------

function metadataText(value) {
  if (Array.isArray(value)) value = value.join(", ");
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function drawerMeta(container, groups) {
  if (!container) return;
  container.replaceChildren();
  for (const group of groups || []) {
    if (!group) continue;
    const rows = (group.rows || []).filter((row) => row && row.label);
    if (!rows.length) continue;
    const section = node("section", "drawer-meta-section");
    if (group.heading) {
      section.append(node("h3", "drawer-section-title", group.heading));
    }
    if (group.note) {
      section.append(node("p", "drawer-section-note", group.note));
    }
    const list = node("dl", "drawer-meta");
    for (const row of rows) {
      const text = metadataText(row.value);
      const empty = !text || text === "—";
      const term = node("dt", "drawer-meta-label", row.label);
      const value = node(
        "dd",
        empty ? "drawer-meta-value is-empty" : "drawer-meta-value",
        empty ? "—" : text
      );
      list.append(term, value);
    }
    section.append(list);
    container.append(section);
  }
}

// -- status -----------------------------------------------------------------

let statusElement = null;

export function setStatus(text, kind) {
  if (!statusElement) statusElement = document.getElementById("status");
  if (!statusElement) return;
  statusElement.textContent = text || "";
  statusElement.dataset.kind = kind || "";
}

export function setEndpoint(text, ok) {
  const element = document.getElementById("endpoint");
  if (!element) return;
  element.textContent = text;
  element.dataset.ok = ok ? "true" : "false";
}

// -- legend -----------------------------------------------------------------

export function renderLegend(container, roleRows, colourFor) {
  container.replaceChildren();
  if (!roleRows.length) return;
  for (const row of roleRows) {
    const item = node("span", "legend-item");
    const swatch = node("span", "legend-swatch");
    swatch.style.background = colourFor(row.iri);
    item.append(swatch, node("span", "", roleLabel(row.iri)));
    container.append(item);
  }
  const other = node("span", "legend-item");
  const swatch = node("span", "legend-swatch");
  swatch.style.background = colourFor(null);
  other.append(swatch, node("span", "", "Other role"));
  container.append(other);
}

// -- chart states -----------------------------------------------------------

function stateElement(container) {
  let element = container.querySelector(":scope > .chart-state");
  if (!element) {
    element = node("div", "chart-state");
    container.append(element);
  }
  return element;
}

function chartElements(container) {
  return [...container.children].filter((child) => {
    const tag = child.tagName && child.tagName.toLowerCase();
    return tag === "svg" || tag === "canvas";
  });
}

function hideSvg(container) {
  for (const child of chartElements(container)) child.style.display = "none";
}

export function clear(container) {
  const element = container.querySelector(":scope > .chart-state");
  if (element) element.remove();
  for (const child of chartElements(container)) child.style.display = "";
}

export function message(container, text, kind) {
  const element = stateElement(container);
  element.className = "chart-state" + (kind ? ` ${kind}` : "");
  element.replaceChildren(node("p", "chart-message", text));
  hideSvg(container);
}

export function error(container, error, hint) {
  const element = stateElement(container);
  element.className = "chart-state error";
  const wrapper = node("div", "chart-message error");
  wrapper.append(node("p", "", error && error.message ? error.message : String(error)));
  if (hint) wrapper.append(node("p", "chart-hint", hint));
  element.replaceChildren(wrapper);
  hideSvg(container);
}

export function roleCountText(row) {
  const works = Number(row.works || 0);
  const activities = Number(row.activities || 0);
  const parts = [`${formatNumber(works)} works`];
  if (activities) parts.push(`${formatNumber(activities)} credits`);
  return parts.join(" · ");
}

export function humanizeValue(iri) {
  return humanize(iri);
}

export function empty(container, text) {
  message(container, text || "No data for this filter.", "empty");
}

// -- export -----------------------------------------------------------------

const EXPORT_STYLE = `
  .link { stroke: var(--border); stroke-opacity: .6; }
  .node-agent { fill: var(--name-colour); }
  .node-work { fill: var(--work-colour); }
  .node-reference { fill: var(--muted); }
  .node-label, .bubble-label, .bar-label, .bar-value, .arc-label { font-family: var(--font); fill: var(--text); }
  .bubble-label { fill: #fff; }
  .axis text { fill: var(--muted); font-family: var(--font); font-size: 10px; }
  .axis path, .axis line { stroke: var(--border); }
  .grid line { stroke: var(--border); stroke-dasharray: 2 3; }
  .grid path { display: none; }
  .heat-cell { stroke: var(--border); stroke-width: 1; }
  .heat-cell.is-empty { fill: var(--surface); stroke: none; }
  .heat-label, .heat-legend text { fill: var(--muted); font-family: var(--font); font-size: 10.5px; }
  .heat-legend rect { stroke: var(--border); stroke-width: 1; }
  .map-ocean { fill: var(--bg); }
  .map-country { stroke: var(--border); stroke-width: .6; }
  .map-country.is-empty { fill: var(--map-empty); }
  .map-offmap-title { fill: var(--muted); font-family: var(--font); font-size: 11px; font-weight: 600; }
  .map-offmap-item text { fill: var(--text); font-family: var(--font); font-size: 11px; }
`;

const EXPORT_VARS = [
  "--bg", "--surface", "--surface-2", "--text", "--muted", "--border",
  "--accent", "--accent-strong", "--accent-soft", "--name-colour",
  "--work-colour", "--error", "--role-1", "--role-2", "--role-3",
  "--role-4", "--role-5", "--role-6", "--role-7", "--role-8",
  "--role-other", "--heat-1", "--heat-2", "--heat-3", "--heat-4",
  "--heat-5", "--map-empty", "--font"
];

function resolvedStyle() {
  const styles = getComputedStyle(document.documentElement);
  const variables = EXPORT_VARS.map(
    (name) => `${name}: ${styles.getPropertyValue(name).trim()};`
  ).join(" ");
  return (
    `svg { ${variables} }\n` +
    EXPORT_STYLE.replace(
      /var\((--[a-z0-9-]+)\)/gi,
      (match, name) => styles.getPropertyValue(name).trim() || match
    )
  );
}

export function downloadSvg(svgElement, filename) {
  if (!svgElement) return;
  const clone = svgElement.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = svgElement.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/\s+/).map(Number);
    if (parts.length === 4) {
      clone.setAttribute("width", parts[2]);
      clone.setAttribute("height", parts[3]);
    }
  }
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = resolvedStyle();
  clone.insertBefore(style, clone.firstChild);
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: "image/svg+xml;charset=utf-8"
  });
  saveBlob(blob, filename || "fiaf-view.svg");
}

export function downloadCanvas(canvas, filename) {
  if (!canvas || !canvas.toBlob) return;
  canvas.toBlob((blob) => {
    if (blob) saveBlob(blob, filename || "fiaf-view.png");
  }, "image/png");
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
