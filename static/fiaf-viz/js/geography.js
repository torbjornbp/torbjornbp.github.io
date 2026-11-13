// Reusable heatmaps over works and items, with cell drill-down.

import { limit, runQuery, sparqlIri, sparqlLiteral } from "./sparql.js";
import { humanize } from "./labels.js";
import {
  HEAT_RAMP,
  drawHeatLegend,
  heatPercentScale,
  heatScale
} from "./heat.js";
import { drawChord as drawChordDiagram } from "./chord.js";
import * as ui from "./ui.js";

const FIAF = "https://dev.fiafcore.org/";

const ITEM_BUCKETS = [
  { value: "0", label: "0 items" },
  { value: "1", label: "1 item" },
  { value: "2-3", label: "2–3 items" },
  { value: "4-5", label: "4–5 items" },
  { value: "6-10", label: "6–10 items" },
  { value: "11-20", label: "11–20 items" },
  { value: "21+", label: "21+ items" }
];
const ITEM_BUCKET_LABELS = new Map(
  ITEM_BUCKETS.map((bucket) => [bucket.value, bucket.label])
);
const ITEM_BUCKET_ORDER = ITEM_BUCKETS.map((bucket) => bucket.label);

const DATE_REQUIREMENT =
  "a four-digit production date (fiaf:ProductionEvent / fiaf:hasDate)";

function itemBucketLabel(value) {
  return ITEM_BUCKET_LABELS.get(value) || String(value || "");
}

const SPECS = [
  {
    key: "countries",
    label: "Countries by decade",
    description:
      "Production countries by decade. Co-productions count under each country.",
    query: "country-decades",
    drilldown: "country-decade-works",
    count: "works",
    rowNoun: "countries",
    columnNoun: "decades",
    chronologicalColumns: true,
    cellNote: "Co-productions can appear under more than one country.",
    emptyMessage:
      "No works in the current selection carry both a production country (fiaf:hasCountry) and " +
      `${DATE_REQUIREMENT}.`,
    params: () => ({}),
    normalise: (row) => ({
      rowValue: row.country,
      columnValue: String(row.decade || ""),
      items: null,
      works: Number(row.works) || 0,
      drilldown: {
        COUNTRY: sparqlIri(row.country),
        DECADE: sparqlLiteral(String(row.decade || ""))
      }
    })
  },
  {
    key: "co-productions",
    label: "Co-production countries",
    description:
      "Country pairs sharing works. Co-productions can involve more than two countries.",
    query: "country-pairs",
    drilldown: "country-pair-works",
    count: "works",
    rowNoun: "countries",
    columnNoun: "countries",
    symmetric: true,
    cellNote: "A work can appear in more than one country pair.",
    emptyMessage:
      "No works in the current selection carry more than one production country (fiaf:hasCountry).",
    params: () => ({}),
    normalise: (row) => ({
      rowValue: row.a,
      columnValue: row.b,
      items: null,
      works: Number(row.works) || 0,
      drilldown: {
        COUNTRY_A: sparqlIri(row.a),
        COUNTRY_B: sparqlIri(row.b)
      }
    })
  },
  {
    key: "subtitles",
    label: "Spoken and subtitle languages",
    description:
      "Spoken languages on works, their manifestations or items, against subtitle languages on manifestations or items.",
    query: "language-subtitles",
    drilldown: "language-subtitle-works",
    count: "works",
    itemLabel: "manifestations",
    itemLabelSingular: "manifestation",
    rowNoun: "spoken languages",
    columnNoun: "subtitle languages",
    cellNote: "Language usages are multi-valued; a work can appear in more than one cell.",
    emptyMessage:
      "No works in the current selection carry both a spoken-language usage " +
      "(fiaf:hasLanguageUsage / fiaf:SpokenLanguage) and a subtitle-language usage " +
      "(fiaf:hasLanguageUsage / fiaf:Subtitles).",
    params: () => ({}),
    normalise: (row) => ({
      rowValue: row.spoken,
      columnValue: row.subtitles,
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        SPOKEN: sparqlIri(row.spoken),
        SUBTITLES: sparqlIri(row.subtitles)
      }
    })
  },
  {
    key: "language-usages",
    label: "Languages by usage type",
    description:
      "Languages by how they are used: spoken, intertitles, subtitles or credits, on works, their manifestations or items.",
    query: "language-usages",
    drilldown: "language-usage-works",
    count: "works",
    rowNoun: "languages",
    columnNoun: "usage types",
    cellNote: "A work can use one language in several ways and appear under each.",
    emptyMessage:
      "No works in the current selection carry a language usage with a language " +
      "(fiaf:hasLanguageUsage / fiaf:hasLanguage).",
    params: () => ({}),
    normalise: (row) => ({
      rowValue: row.language,
      columnValue: row.usage,
      items: null,
      works: Number(row.works) || 0,
      drilldown: {
        LANGUAGE: sparqlIri(row.language),
        USAGE: sparqlIri(row.usage)
      }
    })
  },
  {
    key: "language-decades",
    label: "Language usage by decade",
    description:
      "Language usage types on works, their manifestations or items, by the work's production decade.",
    query: "language-usage-decades",
    drilldown: "language-usage-decade-works",
    count: "works",
    itemLabel: "language usages",
    itemLabelSingular: "language usage",
    rowNoun: "usage types",
    columnNoun: "decades",
    chronologicalColumns: true,
    cellNote:
      "Language usages are multi-valued; a work can appear under more than one type.",
    emptyMessage:
      `No works in the current selection carry both ${DATE_REQUIREMENT} and ` +
      "a language usage (fiaf:hasLanguageUsage).",
    params: () => ({}),
    normalise: (row) => ({
      rowValue: row.value,
      columnValue: String(row.decade || ""),
      items: Number(row.usages) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        USAGE: sparqlIri(row.value),
        DECADE: sparqlLiteral(String(row.decade || ""))
      }
    })
  },
  {
    key: "colour",
    label: "Colour by decade",
    description:
      "Item colour characteristics by the work's production decade.",
    query: "item-facet-decades",
    drilldown: "item-facet-decade-works",
    count: "items",
    rowNoun: "colour types",
    columnNoun: "decades",
    chronologicalColumns: true,
    cellNote: "Items can carry more than one colour characteristic.",
    emptyMessage:
      `No works in the current selection carry both ${DATE_REQUIREMENT} and ` +
      "an item or manifestation colour characteristic (fiaf:hasColourCharacteristic).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasColourCharacteristic`) }),
    normalise: (row) => ({
      rowValue: row.value,
      columnValue: String(row.decade || ""),
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasColourCharacteristic`),
        FACET_VALUE: sparqlIri(row.value),
        DECADE: sparqlLiteral(String(row.decade || ""))
      }
    })
  },
  {
    key: "bases",
    label: "Base material by decade",
    description:
      "Item base materials by the work's production decade, including nitrate holdings.",
    query: "item-facet-decades",
    drilldown: "item-facet-decade-works",
    count: "items",
    rowNoun: "base materials",
    columnNoun: "decades",
    chronologicalColumns: true,
    cellNote: "Items and works can occur in more than one cell.",
    emptyMessage:
      `No works in the current selection carry both ${DATE_REQUIREMENT} and ` +
      "an item or manifestation base material (fiaf:hasBase).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasBase`) }),
    normalise: (row) => ({
      rowValue: row.value,
      columnValue: String(row.decade || ""),
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasBase`),
        FACET_VALUE: sparqlIri(row.value),
        DECADE: sparqlLiteral(String(row.decade || ""))
      }
    })
  },
  {
    key: "sound-decades",
    label: "Sound by decade",
    description:
      "Item sound characteristics by the work's production decade.",
    query: "item-facet-decades",
    drilldown: "item-facet-decade-works",
    count: "items",
    rowNoun: "sound types",
    columnNoun: "decades",
    chronologicalColumns: true,
    cellNote: "Items can carry more than one sound characteristic.",
    emptyMessage:
      `No works in the current selection carry both ${DATE_REQUIREMENT} and ` +
      "an item or manifestation sound characteristic (fiaf:hasSoundCharacteristic).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasSoundCharacteristic`) }),
    normalise: (row) => ({
      rowValue: row.value,
      columnValue: String(row.decade || ""),
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasSoundCharacteristic`),
        FACET_VALUE: sparqlIri(row.value),
        DECADE: sparqlLiteral(String(row.decade || ""))
      }
    })
  },
  {
    key: "element-decades",
    label: "Element type by decade",
    description:
      "Item element types, such as release prints and duplicate negatives, by the work's production decade.",
    query: "item-facet-decades",
    drilldown: "item-facet-decade-works",
    count: "items",
    rowNoun: "element types",
    columnNoun: "decades",
    chronologicalColumns: true,
    cellNote: "Items can carry more than one element type.",
    emptyMessage:
      `No works in the current selection carry both ${DATE_REQUIREMENT} and ` +
      "an item or manifestation element type (fiaf:isElement).",
    params: () => ({ FACET: sparqlIri(`${FIAF}isElement`) }),
    normalise: (row) => ({
      rowValue: row.value,
      columnValue: String(row.decade || ""),
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}isElement`),
        FACET_VALUE: sparqlIri(row.value),
        DECADE: sparqlLiteral(String(row.decade || ""))
      }
    })
  },
  {
    key: "colour-countries",
    label: "Colour by country",
    description:
      "Item colour characteristics by production country. Co-productions count under each country.",
    query: "item-facet-countries",
    drilldown: "item-facet-country-works",
    count: "items",
    rowNoun: "countries",
    columnNoun: "colour types",
    cellNote: "Co-productions can appear under more than one country.",
    emptyMessage:
      "No works in the current selection carry both a production country " +
      "(fiaf:hasCountry) and an item or manifestation colour characteristic " +
      "(fiaf:hasColourCharacteristic).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasColourCharacteristic`) }),
    normalise: (row) => ({
      rowValue: row.country,
      columnValue: row.value,
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasColourCharacteristic`),
        FACET_VALUE: sparqlIri(row.value),
        COUNTRY: sparqlIri(row.country)
      }
    })
  },
  {
    key: "sound-countries",
    label: "Sound by country",
    description:
      "Item sound characteristics by production country. Co-productions count under each country.",
    query: "item-facet-countries",
    drilldown: "item-facet-country-works",
    count: "items",
    rowNoun: "countries",
    columnNoun: "sound types",
    cellNote: "Co-productions can appear under more than one country.",
    emptyMessage:
      "No works in the current selection carry both a production country " +
      "(fiaf:hasCountry) and an item or manifestation sound characteristic " +
      "(fiaf:hasSoundCharacteristic).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasSoundCharacteristic`) }),
    normalise: (row) => ({
      rowValue: row.country,
      columnValue: row.value,
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasSoundCharacteristic`),
        FACET_VALUE: sparqlIri(row.value),
        COUNTRY: sparqlIri(row.country)
      }
    })
  },
  {
    key: "base-countries",
    label: "Base material by country",
    description:
      "Item base materials by production country, including nitrate holdings. Co-productions count under each country.",
    query: "item-facet-countries",
    drilldown: "item-facet-country-works",
    count: "items",
    rowNoun: "countries",
    columnNoun: "base materials",
    cellNote: "Co-productions can appear under more than one country.",
    emptyMessage:
      "No works in the current selection carry both a production country " +
      "(fiaf:hasCountry) and an item or manifestation base material (fiaf:hasBase).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasBase`) }),
    normalise: (row) => ({
      rowValue: row.country,
      columnValue: row.value,
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasBase`),
        FACET_VALUE: sparqlIri(row.value),
        COUNTRY: sparqlIri(row.country)
      }
    })
  },
  {
    key: "element-countries",
    label: "Element type by country",
    description:
      "Item element types, such as release prints and duplicate negatives, by production country.",
    query: "item-facet-countries",
    drilldown: "item-facet-country-works",
    count: "items",
    rowNoun: "countries",
    columnNoun: "element types",
    cellNote: "Co-productions can appear under more than one country.",
    emptyMessage:
      "No works in the current selection carry both a production country " +
      "(fiaf:hasCountry) and an item or manifestation element type (fiaf:isElement).",
    params: () => ({ FACET: sparqlIri(`${FIAF}isElement`) }),
    normalise: (row) => ({
      rowValue: row.country,
      columnValue: row.value,
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}isElement`),
        FACET_VALUE: sparqlIri(row.value),
        COUNTRY: sparqlIri(row.country)
      }
    })
  },
  {
    key: "format-countries",
    label: "Item format by country",
    description:
      "Item formats by production country. Co-productions count under each country.",
    query: "item-facet-countries",
    drilldown: "item-facet-country-works",
    count: "items",
    rowNoun: "countries",
    columnNoun: "formats",
    cellNote: "Co-productions can appear under more than one country.",
    emptyMessage:
      "No works in the current selection carry both a production country " +
      "(fiaf:hasCountry) and an item or manifestation format (fiaf:hasFormat).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasFormat`) }),
    normalise: (row) => ({
      rowValue: row.country,
      columnValue: row.value,
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasFormat`),
        FACET_VALUE: sparqlIri(row.value),
        COUNTRY: sparqlIri(row.country)
      }
    })
  },
  {
    key: "country-items",
    label: "Items per work by country",
    description:
      "Works by number of attached items and production country. Co-productions count under each country.",
    query: "country-item-counts",
    drilldown: "country-item-count-works",
    count: "works",
    rowNoun: "countries",
    columnNoun: "item-count buckets",
    orderedColumns: ITEM_BUCKET_ORDER,
    cellNote:
      "Co-productions count under each country. Zero means no attached items.",
    emptyMessage:
      "No works in the current selection carry a production country (fiaf:hasCountry).",
    params: () => ({}),
    normalise: (row) => ({
      rowValue: row.country,
      columnValue: itemBucketLabel(row.bucket),
      items: null,
      works: Number(row.works) || 0,
      drilldown: {
        COUNTRY: sparqlIri(row.country),
        BUCKET: sparqlLiteral(row.bucket)
      }
    })
  },
  {
    key: "decade-items",
    label: "Items per work by decade",
    description:
      "Works by number of attached items and production decade. Dates are production dates.",
    query: "decade-item-counts",
    drilldown: "decade-item-count-works",
    count: "works",
    rowNoun: "decades",
    columnNoun: "item-count buckets",
    chronologicalRows: true,
    orderedColumns: ITEM_BUCKET_ORDER,
    cellNote: "Zero means no attached items. Dates are production dates.",
    emptyMessage:
      `No works in the current selection carry ${DATE_REQUIREMENT}.`,
    params: () => ({}),
    normalise: (row) => ({
      rowValue: String(row.decade || ""),
      columnValue: itemBucketLabel(row.bucket),
      items: null,
      works: Number(row.works) || 0,
      drilldown: {
        DECADE: sparqlLiteral(String(row.decade || "")),
        BUCKET: sparqlLiteral(row.bucket)
      }
    })
  },
  {
    key: "format-decades",
    label: "Item format by decade",
    description:
      "Item formats by the work's production decade.",
    query: "item-facet-decades",
    drilldown: "item-facet-decade-works",
    count: "items",
    rowNoun: "formats",
    columnNoun: "decades",
    chronologicalColumns: true,
    cellNote: "Items can carry more than one format.",
    emptyMessage:
      `No works in the current selection carry both ${DATE_REQUIREMENT} and ` +
      "an item or manifestation format (fiaf:hasFormat).",
    params: () => ({ FACET: sparqlIri(`${FIAF}hasFormat`) }),
    normalise: (row) => ({
      rowValue: row.value,
      columnValue: String(row.decade || ""),
      items: Number(row.items) || 0,
      works: Number(row.works) || 0,
      drilldown: {
        FACET: sparqlIri(`${FIAF}hasFormat`),
        FACET_VALUE: sparqlIri(row.value),
        DECADE: sparqlLiteral(String(row.decade || ""))
      }
    })
  }
];

const SPEC_BY_KEY = new Map(SPECS.map((spec) => [spec.key, spec]));

// Which group a matrix belongs to is its subject, not what it counts: the
// items-per-work matrices count works but describe holdings.
const WORK_MATRICES = new Set([
  "countries", "co-productions", "subtitles", "language-usages", "language-decades"
]);

// The matrices for one unit ("works" or "items"); null keeps them all.
export function specsFor(unit) {
  if (!unit) return SPECS;
  return SPECS.filter((spec) => WORK_MATRICES.has(spec.key) === (unit === "works"));
}
// Beyond this many countries the chord's arcs are slivers too thin to label.
const CHORD_MAX = 40;
// A mosaic draws at most this many rows as columns, and this many segment
// colours; further segments are combined under Other.
const MOSAIC_MAX = 20;
const MOSAIC_SEGMENTS = 8;

export function create(
  ctx,
  root,
  statsElement,
  kindSelect,
  descriptionElement,
  limitSelect,
  modeButtons
) {
  let activeKey = SPECS[0].key;
  let unit = null;
  // The matrix last chosen in each unit, so returning to a group keeps it.
  const keyByUnit = new Map();
  let activeMode = "count";
  let previousWidth = null;
  let requestToken = 0;
  let requestController = null;
  let drawerToken = 0;
  let drawerController = null;
  let hasRendered = false;
  const dataByKind = new Map();
  const defaultRowLimit = Math.max(
    1,
    Math.floor(limit("heatmapCategories", 30))
  );
  let rowLimit = defaultRowLimit;
  // Besides the grid, a symmetric matrix (country pairs) can be drawn as a
  // chord diagram and any other matrix as a mosaic. One choice covers both:
  // "Chord" on a non-symmetric kind, or "Mosaic" on a symmetric one, falls
  // back to the grid.
  let pairLayout = "grid";
  const layoutControl = document.getElementById("heatmap-layout");
  const layoutButtons = layoutControl
    ? layoutControl.querySelectorAll("[data-layout]")
    : [];
  for (const button of layoutButtons) {
    button.addEventListener("click", () => {
      const next = ["chord", "mosaic"].includes(button.dataset.layout)
        ? button.dataset.layout
        : "grid";
      if (next === pairLayout) return;
      pairLayout = next;
      // Shares of a row or column have no chord or mosaic form; both show
      // counts (the mosaic's heights are already shares of each row).
      if (pairLayout !== "grid") setMode("count");
      ui.hideTooltip();
      updateChrome();
      redrawIfLoaded();
    });
  }
  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "Heatmap of works and items");

  function fillKindOptions() {
    if (!kindSelect) return;
    kindSelect.replaceChildren();
    for (const spec of specsFor(unit)) {
      const option = document.createElement("option");
      option.value = spec.key;
      option.textContent = spec.label;
      kindSelect.append(option);
    }
    kindSelect.value = activeKey;
  }

  if (kindSelect) {
    fillKindOptions();
    kindSelect.addEventListener("change", () => {
      const shown = specsFor(unit);
      activeKey = shown.some((spec) => spec.key === kindSelect.value)
        ? kindSelect.value
        : shown[0].key;
      keyByUnit.set(unit, activeKey);
      drawerToken += 1;
      if (drawerController) drawerController.abort();
      drawerController = null;
      ui.closeDrawer();
      const selectedKey = activeKey;
      loadActive().catch((error) => {
        if (error.name === "AbortError" || activeKey !== selectedKey) return;
        ui.error(root, error, "Choose another matrix or reload the page.");
        ui.setStatus("The heatmap query failed.", "error");
      });
    });
  }

  if (limitSelect) {
    const values = [...new Set([16, 30, 50, defaultRowLimit])].sort(
      (a, b) => a - b
    );
    for (const value of values) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = ui.formatNumber(value);
      limitSelect.append(option);
    }
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All";
    limitSelect.append(allOption);
    limitSelect.value = String(rowLimit);
    limitSelect.addEventListener("change", () => {
      rowLimit =
        limitSelect.value === "all"
          ? null
          : Math.max(
              1,
              Math.floor(Number(limitSelect.value) || defaultRowLimit)
            );
      ui.hideTooltip();
      redrawIfLoaded();
    });
  }

  function setMode(mode) {
    activeMode = mode === "row" || mode === "column" ? mode : "count";
    for (const button of modeButtons || []) {
      const active = (button.dataset.heatmapMode || "count") === activeMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function redrawIfLoaded() {
    if (dataByKind.has(cacheKey(activeKey))) draw();
  }

  function cacheKey(key) {
    return `${ctx.scopeFilter()}|${key}`;
  }

  function cancelRequest() {
    requestToken += 1;
    if (requestController) requestController.abort();
    requestController = null;
  }

  for (const button of modeButtons || []) {
    button.addEventListener("click", () => {
      const mode = button.dataset.heatmapMode || "count";
      if (mode === activeMode) return;
      setMode(mode);
      ui.hideTooltip();
      redrawIfLoaded();
    });
  }
  setMode(activeMode);

  function updateChrome() {
    const spec = SPEC_BY_KEY.get(activeKey);
    if (descriptionElement) descriptionElement.textContent = spec.description;
    const chord = chordActive(spec);
    const mosaic = mosaicActive(spec);
    // The chord's arcs and ribbons carry their own labels, which an image
    // role would hide.
    svg.attr("role", chord ? "group" : "img");
    svg.attr(
      "aria-label",
      chord
        ? `Chord diagram: ${spec.label.toLowerCase()}`
        : mosaic
          ? `Mosaic: ${spec.label.toLowerCase()}`
          : `Heatmap: ${spec.label.toLowerCase()}`
    );
    const shown = chord ? "chord" : mosaic ? "mosaic" : "grid";
    for (const button of layoutButtons) {
      const layout = button.dataset.layout;
      button.hidden =
        (layout === "chord" && !spec.symmetric) || (layout === "mosaic" && spec.symmetric);
      const active = layout === shown;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of modeButtons || []) {
      button.disabled =
        (chord || mosaic) && (button.dataset.heatmapMode || "count") !== "count";
    }
  }

  function chordActive(spec) {
    return Boolean(spec.symmetric && pairLayout === "chord");
  }

  function mosaicActive(spec) {
    return Boolean(!spec.symmetric && pairLayout === "mosaic");
  }

  async function load({ signal } = {}) {
    const loadedKey = activeKey;
    updateChrome();
    try {
      await loadActive(signal);
    } catch (error) {
      // A selector change may have superseded the initial load.
      if (activeKey !== loadedKey) return;
      throw error;
    }
  }

  async function loadActive(signal) {
    const spec = SPEC_BY_KEY.get(activeKey);
    cancelRequest();
    const token = ++requestToken;
    const key = cacheKey(spec.key);
    if (dataByKind.has(key)) {
      draw();
      ui.setStatus("");
      return;
    }
    if (!hasRendered) {
      ui.message(root, `Loading ${spec.label.toLowerCase()}…`);
    }
    ui.setStatus(`Loading ${spec.label.toLowerCase()}…`);
    const controller = new AbortController();
    requestController = controller;
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    let rows;
    try {
      rows = await runQuery(
        spec.query,
        { ...spec.params(), SCOPE_FILTER: ctx.scopeFilter() },
        { signal: controller.signal }
      );
    } finally {
      if (signal) signal.removeEventListener("abort", abort);
      if (requestController === controller) requestController = null;
    }
    if (controller.signal.aborted || token !== requestToken || key !== cacheKey(spec.key)) return;
    dataByKind.set(
      key,
      rows
        .map((row) => {
          const cell = spec.normalise(row);
          cell.count = spec.count === "items" ? cell.items : cell.works;
          return cell;
        })
        .filter(
          (cell) =>
            cell.rowValue &&
            cell.columnValue &&
            Number(cell.count) > 0
        )
    );
    draw();
    hasRendered = true;
    ui.setStatus("");
  }

  function categoryTotals(cells, field) {
    const totals = new Map();
    for (const cell of cells) {
      const value = cell[field];
      totals.set(value, (totals.get(value) || 0) + cell.count);
    }
    return totals;
  }

  function rankCategories(totals, cap) {
    const ranked = [...totals.entries()].sort(
      (a, b) =>
        b[1] - a[1] ||
        humanize(a[0]).localeCompare(humanize(b[0])) ||
        String(a[0]).localeCompare(String(b[0]))
    );
    return (cap == null ? ranked : ranked.slice(0, cap)).map(
      ([value]) => value
    );
  }

  // Chronological axes always render the full contiguous span; a ranked row
  // cap must not silently drop the earliest or latest decades.
  function chronologicalRange(values) {
    const list = Array.isArray(values) ? values : [...values];
    const first = d3.min(list, (value) => Number(value));
    const last = d3.max(list, (value) => Number(value));
    return d3.range(first, last + 10, 10).map(String);
  }

  function draw() {
    const spec = SPEC_BY_KEY.get(activeKey);
    const data = dataByKind.get(cacheKey(spec.key));
    previousWidth = root.clientWidth;
    if (!data || !data.length) {
      root.style.height = "180px";
      ui.empty(
        root,
        spec.emptyMessage || `No ${spec.label.toLowerCase()} data found.`
      );
      statsElement.textContent = "";
      return;
    }

    if (rowLimit !== null && !rowLimit) {
      root.style.height = "180px";
      ui.empty(root, "The heatmap category limit is zero.");
      statsElement.textContent = "";
      return;
    }

    const allRows = categoryTotals(data, "rowValue");
    const allColumns = categoryTotals(data, "columnValue");
    // Symmetric pairs are stored once as a -> b, so both endpoints contribute
    // to the shared row/column category totals.
    if (spec.symmetric) {
      for (const [value, total] of allColumns) {
        allRows.set(value, (allRows.get(value) || 0) + total);
      }
    }
    const rows = spec.chronologicalRows
      ? chronologicalRange(allRows.keys())
      : rankCategories(allRows, rowLimit);
    const selectedRows = new Set(rows);
    const rowData = data.filter((cell) => selectedRows.has(cell.rowValue));
    let columns;
    let decades = null;

    if (spec.symmetric) {
      columns = rows.slice();
    } else if (spec.chronologicalColumns) {
      decades = chronologicalRange(
        rowData.map((cell) => cell.columnValue)
      );
      columns = decades;
    } else if (spec.orderedColumns) {
      columns = spec.orderedColumns.slice();
    } else {
      columns = rankCategories(
        categoryTotals(rowData, "columnValue"),
        rowLimit
      );
    }

    if (!rows.length || !columns.length) {
      root.style.height = "180px";
      ui.empty(root, "No categories fit the current heatmap limit.");
      statsElement.textContent = "";
      return;
    }

    const lookup = new Map();
    for (const cell of data) {
      lookup.set(`${cell.rowValue}\u0000${cell.columnValue}`, cell);
    }

    if (chordActive(spec)) {
      drawChord(spec, rows.slice(0, CHORD_MAX), lookup, allRows);
      return;
    }
    if (mosaicActive(spec)) {
      drawMosaic(spec, rows.slice(0, MOSAIC_MAX), columns, lookup, allRows);
      return;
    }

    const cells = [];
    for (const rowValue of rows) {
      for (const columnValue of columns) {
        let cell = null;
        if (spec.symmetric) {
          if (rowValue === columnValue) continue;
          cell =
            lookup.get(`${rowValue}\u0000${columnValue}`) ||
            lookup.get(`${columnValue}\u0000${rowValue}`) ||
            null;
        } else {
          cell = lookup.get(`${rowValue}\u0000${columnValue}`) || null;
        }
        const count = cell ? cell.count : 0;
        const rowTotal = allRows.get(rowValue) || 0;
        // A symmetric pair is stored once, so a column's total is the same as
        // its row total once both endpoints have been folded into allRows.
        const columnTotal =
          (spec.symmetric ? allRows.get(columnValue) : allColumns.get(columnValue)) ||
          0;
        cells.push({
          rowValue,
          columnValue,
          count,
          items: cell ? cell.items : null,
          works: cell ? cell.works : 0,
          drilldown: cell ? cell.drilldown : null,
          rowTotal,
          columnTotal,
          rowPercent: rowTotal ? (100 * count) / rowTotal : 0,
          columnPercent: columnTotal ? (100 * count) / columnTotal : 0
        });
      }
    }

    ui.clear(root);
    const longColumns = !spec.chronologicalColumns;
    const compact = (root.clientWidth || 960) < 720;
    const margin = {
      top: longColumns ? 76 : 42,
      right: longColumns ? 60 : 24,
      bottom: 72,
      left: compact ? 128 : 176
    };
    const width = Math.max(
      720,
      root.clientWidth || 960,
      margin.left + margin.right + columns.length * 48
    );
    const height = Math.max(420, margin.top + rows.length * 30 + margin.bottom);
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = rows.length * 30;
    root.style.height = `${height}px`;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    updateChrome();

    const x = d3.scaleBand().domain(columns).range([0, innerWidth]).padding(0.1);
    const y = d3.scaleBand().domain(rows).range([0, innerHeight]).padding(0.16);
    const maximum = d3.max(cells, (cell) => cell.count) || 1;
    const maximumPercent = d3.max(cells, (cell) => cellValue(cell)) || 0;
    const { colour, edges, range } =
      activeMode === "count"
        ? heatScale(maximum, HEAT_RAMP)
        : heatPercentScale(maximumPercent, HEAT_RAMP);
    const chart = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xAxis = chart
      .append("g")
      .attr("class", "axis")
      .call(
        d3
          .axisTop(x)
          .tickFormat((value) =>
            spec.chronologicalColumns
              ? `${value}s`
              : ui.truncate(humanize(value), 16)
          )
      );
    if (longColumns) {
      xAxis
        .selectAll("text")
        .attr("transform", "rotate(-35)")
        .attr("text-anchor", "start")
        .attr("dx", "0.35em")
        .attr("dy", "0.25em");
    }

    chart
      .append("g")
      .selectAll("text")
      .data(rows, (value) => value)
      .join("text")
      .attr("class", "heat-label")
      .attr("x", -10)
      .attr("y", (value) => y(value) + y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "end")
      .text((value) => ui.truncate(rowLabel(spec, value), compact ? 18 : 23));

    chart
      .append("g")
      .selectAll("rect")
      .data(cells, (cell) => `${cell.rowValue}\u0000${cell.columnValue}`)
      .join("rect")
      .attr("class", (cell) =>
        cell.count ? "heat-cell" : "heat-cell is-empty"
      )
      .attr("x", (cell) => x(cell.columnValue))
      .attr("y", (cell) => y(cell.rowValue))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("fill", (cell) => (cell.count ? colour(cellValue(cell)) : null))
      .attr("fill-opacity", (cell) => (cell.count ? 1 : null))
      .attr("tabindex", (cell) => (cell.count ? 0 : null))
      .attr("role", (cell) => (cell.count ? "button" : null))
      .attr("aria-label", (cell) =>
        cell.count
          ? `${rowLabel(spec, cell.rowValue)}, ${columnLabel(spec, cell.columnValue)}: ` +
            `${cellCountText(spec, cell)}. Activate to list works.`
          : null
      )
      .on("mouseenter", (event, cell) => {
        ui.showTooltip(
          event,
          `${rowLabel(spec, cell.rowValue)} · ${columnLabel(spec, cell.columnValue)}`,
          cell.count
            ? `${cellCountText(spec, cell)} · activate for titles`
            : "No data"
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, cell) => {
        if (cell.count) openCell(spec, cell);
      })
      .on("keydown", (event, cell) => {
        if (cell.count && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openCell(spec, cell);
        }
      });

    drawHeatLegend(svg, {
      edges,
      range,
      left: margin.left,
      top: height - 42,
      label: legendLabel(spec),
      isPercent: activeMode !== "count",
      zeroLabel: activeMode === "count" ? "0" : "0%"
    });

    const rowSummary = categorySummary(rows.length, allRows.size, spec.rowNoun);
    let columnSummary;
    if (spec.symmetric) {
      columnSummary = `${rowSummary} on both axes`;
    } else if (spec.chronologicalColumns) {
      const first = decades[0];
      const last = decades[decades.length - 1];
      columnSummary = first === last ? `${first}s` : `${first}s–${last}s`;
    } else {
      columnSummary = categorySummary(
        columns.length,
        allColumns.size,
        spec.columnNoun
      );
    }
    const metric =
      activeMode === "column"
        ? "share of column (%)"
        : activeMode === "row"
          ? "share of row (%)"
          : spec.count === "items"
            ? "items per cell"
            : "works per cell";
    statsElement.textContent =
      (spec.symmetric ? columnSummary : `${rowSummary} · ${columnSummary}`) +
      ` · ${metric}`;
  }

  // Chord diagram of a symmetric matrix: each country is an arc sized by its
  // co-productions with the other countries shown, and each ribbon is a pair,
  // as wide at each end as the works the two countries share. The busiest
  // countries get the categorical palette and the rest share a neutral colour.
  // Colours are resolved from the theme now, so the exported SVG keeps them.
  function drawChord(spec, list, lookup, allRows) {
    ui.clear(root);
    svg.selectAll("*").remove();
    updateChrome();
    const n = list.length;
    const pair = (a, b) =>
      lookup.get(`${a}\u0000${b}`) || lookup.get(`${b}\u0000${a}`) || null;
    const matrix = list.map((a) =>
      list.map((b) => {
        if (a === b) return 0;
        const cell = pair(a, b);
        return cell ? cell.count : 0;
      })
    );

    const width = Math.max(360, root.clientWidth || 960);
    const compact = width < 720;
    const labelRoom = compact ? 90 : 120;
    const size = Math.min(width, 900);
    const outer = Math.max(120, size / 2 - labelRoom);
    const height = 2 * (outer + labelRoom) + 16;
    root.style.height = `${height}px`;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);

    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const palette = d3.range(1, 9).map((index) => token(`--role-${index}`, "#888888"));
    const other = token("--role-other", "#b8b8b8");
    const colour = (index) => (index < palette.length ? palette[index] : other);

    const labels = list.map((value) => rowLabel(spec, value));
    const cellFor = (chord) => pair(list[chord.source.index], list[chord.target.index]);
    drawChordDiagram(svg, {
      matrix,
      centre: [width / 2, outer + labelRoom + 8],
      outer,
      fills: list.map((_, index) => colour(index)),
      arcStroke: () => token("--surface", "#ffffff"),
      labels,
      labelChars: compact ? 14 : 20,
      fontSize: compact ? 10 : 11,
      arcTitle: (index) => labels[index],
      arcBody: (index) => {
        const partners = matrix[index].filter(Boolean).length;
        const shared = d3.sum(matrix[index]);
        return (
          `${ui.formatNumber(shared)} shared works with ${ui.formatNumber(partners)} ` +
          "of the countries shown · a work with several partners counts once per pair"
        );
      },
      ribbonTitle: (chord) => `${labels[chord.source.index]} · ${labels[chord.target.index]}`,
      ribbonBody: (chord) => {
        const cell = cellFor(chord);
        return cell ? `${rawCellCountText(spec, cell)} · activate for titles` : "No data";
      },
      onActivate: (chord) => {
        const cell = cellFor(chord);
        if (cell) openCell(spec, cell);
      }
    });

    const capped = rowLimit === null || rowLimit > CHORD_MAX;
    statsElement.textContent =
      `${categorySummary(n, allRows.size, spec.rowNoun)} · ribbon width = works the ` +
      "two countries share" +
      (capped && allRows.size > n
        ? ` · the chord shows at most ${CHORD_MAX} countries`
        : "");
  }

  // Mosaic (Marimekko): each row category is a column whose width is its total
  // and whose segments are its split by the column categories, so both the
  // size of each language (say) and the mix of how it is used read at once.
  // Decades keep their order and get a sequential ramp; other kinds keep the
  // largest categories and fold the rest into Other.
  function drawMosaic(spec, list, columns, lookup, allRows) {
    ui.clear(root);
    svg.selectAll("*").remove();
    updateChrome();
    const chronological = Boolean(spec.chronologicalColumns);
    const kept =
      chronological || columns.length <= MOSAIC_SEGMENTS
        ? columns
        : columns.slice(0, MOSAIC_SEGMENTS - 1);
    const other = !chronological && columns.length > kept.length;
    const segments = other ? [...kept, null] : kept;

    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const surface = token("--surface", "#ffffff");
    let colourOf;
    if (chronological) {
      const ramp = d3.interpolateRgbBasis(
        d3.range(1, 6).map((index) => token(`--heat-${index}`, "#888888"))
      );
      colourOf = (segment) =>
        ramp(kept.length > 1 ? kept.indexOf(segment) / (kept.length - 1) : 1);
    } else {
      const palette = d3.range(1, 9).map((index) => token(`--role-${index}`, "#888888"));
      const otherColour = token("--role-other", "#b8b8b8");
      colourOf = (segment) =>
        segment === null ? otherColour : palette[kept.indexOf(segment) % palette.length];
    }
    const segmentLabel = (segment) =>
      segment === null ? "Other" : columnLabel(spec, segment);

    const width = Math.max(360, root.clientWidth || 960);
    const compact = width < 720;
    const legendColumns = compact ? 2 : 4;
    const legendHeight = Math.ceil(segments.length / legendColumns) * 18 + 12;
    const margin = { top: 12, right: 12, bottom: compact ? 104 : 124, left: 44 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = Math.round(Math.max(260, Math.min(440, width * 0.42)));
    const height = margin.top + innerHeight + margin.bottom + legendHeight;
    root.style.height = `${height}px`;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);

    const totals = list.map((row) => allRows.get(row) || 0);
    const sum = d3.sum(totals) || 1;
    const gap = list.length > 1 ? Math.min(3, innerWidth / list.length / 4) : 0;
    const usable = innerWidth - gap * (list.length - 1);
    const pair = (row, column) => lookup.get(`${row}\u0000${column}`) || null;
    const bars = [];
    let x = 0;
    list.forEach((row, index) => {
      const total = totals[index];
      const barWidth = (usable * total) / sum;
      let y = 0;
      let counted = 0;
      for (const segment of segments) {
        let cell = null;
        let count;
        if (segment === null) {
          count = Math.max(0, total - counted);
        } else {
          cell = pair(row, segment);
          count = cell ? cell.count : 0;
          counted += count;
        }
        if (!count || !total) continue;
        const share = count / total;
        bars.push({ row, segment, cell, count, share, total, x, y, width: barWidth, height: share * innerHeight });
        y += share * innerHeight;
      }
      bars.push({ label: true, row, total, x, width: barWidth });
      x += barWidth + gap;
    });

    const chart = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    const yScale = d3.scaleLinear().domain([0, 1]).range([0, innerHeight]);
    chart
      .append("g")
      .attr("class", "axis")
      .call(
        d3
          .axisLeft(d3.scaleLinear().domain([1, 0]).range([0, innerHeight]))
          .ticks(5)
          .tickFormat(d3.format(".0%"))
      );

    const openBar = (bar) => {
      if (bar.cell) openCell(spec, bar.cell);
    };
    chart
      .append("g")
      .selectAll("rect")
      .data(bars.filter((bar) => !bar.label))
      .join("rect")
      .attr("class", "mosaic-cell")
      .attr("x", (bar) => bar.x)
      .attr("y", (bar) => yScale(bar.y / innerHeight))
      .attr("width", (bar) => Math.max(0.5, bar.width))
      .attr("height", (bar) => Math.max(0.5, bar.height))
      .attr("fill", (bar) => colourOf(bar.segment))
      .attr("stroke", surface)
      .attr("stroke-width", 0.75)
      .attr("tabindex", (bar) => (bar.cell ? 0 : null))
      .attr("role", (bar) => (bar.cell ? "button" : null))
      .attr("aria-label", (bar) =>
        `${rowLabel(spec, bar.row)}, ${segmentLabel(bar.segment)}: ` +
        `${ui.formatNumber(bar.count)} works, ${percentText(100 * bar.share)} of the row.` +
        (bar.cell ? " Activate to list works." : "")
      )
      .on("mouseenter", (event, bar) => {
        ui.showTooltip(
          event,
          `${rowLabel(spec, bar.row)} · ${segmentLabel(bar.segment)}`,
          `${ui.formatNumber(bar.count)} ${spec.count === "items" ? "items" : "works"} · ` +
            `${percentText(100 * bar.share)} of ${rowLabel(spec, bar.row)}` +
            (bar.cell ? " · activate for titles" : "")
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (_event, bar) => openBar(bar))
      .on("keydown", (event, bar) => {
        if (bar.cell && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openBar(bar);
        }
      });

    // Row names under their columns, slanted; columns too narrow for a label
    // are left unlabelled (the tooltip names them).
    chart
      .append("g")
      .selectAll("text")
      .data(bars.filter((bar) => bar.label && bar.width >= 9))
      .join("text")
      .attr("class", "heat-label")
      .attr(
        "transform",
        (bar) => `translate(${bar.x + bar.width / 2},${innerHeight + 8})rotate(-40)`
      )
      .attr("text-anchor", "end")
      .attr("dy", "0.7em")
      .text((bar) => ui.truncate(rowLabel(spec, bar.row), compact ? 14 : 18));

    const legend = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top + innerHeight + margin.bottom})`);
    const legendWidth = innerWidth / legendColumns;
    const items = legend
      .selectAll("g")
      .data(segments)
      .join("g")
      .attr(
        "transform",
        (_segment, index) =>
          `translate(${(index % legendColumns) * legendWidth},${Math.floor(index / legendColumns) * 18})`
      );
    items
      .append("rect")
      .attr("width", 11)
      .attr("height", 11)
      .attr("fill", (segment) => colourOf(segment));
    items
      .append("text")
      .attr("class", "heat-label")
      .attr("x", 16)
      .attr("y", 9)
      .text((segment) => ui.truncate(segmentLabel(segment), compact ? 18 : 26));

    statsElement.textContent =
      `${categorySummary(list.length, allRows.size, spec.rowNoun)} · column width = ` +
      `${spec.count === "items" ? "items" : "works"} · height = share by ${spec.columnNoun.replace(/s$/, "")}` +
      (other ? ` · the ${kept.length} largest ${spec.columnNoun} have their own colour` : "") +
      (allRows.size > list.length && (rowLimit === null || rowLimit > MOSAIC_MAX)
        ? ` · the mosaic shows at most ${MOSAIC_MAX} ${spec.rowNoun}`
        : "");
  }

  function cellValue(cell) {
    if (activeMode === "column") return cell.columnPercent;
    if (activeMode === "row") return cell.rowPercent;
    return cell.count;
  }

  function legendLabel(spec) {
    if (activeMode === "column") return "Share of column (%)";
    if (activeMode === "row") return "Share of row (%)";
    return spec.count === "items" ? "Items per cell" : "Works per cell";
  }

  function categorySummary(shown, total, noun) {
    return total > shown
      ? `${ui.formatNumber(shown)} of ${ui.formatNumber(total)} ${noun}`
      : `${ui.formatNumber(shown)} ${noun}`;
  }

  function rowLabel(spec, value) {
    return spec.chronologicalRows ? `${value}s` : humanize(value);
  }

  function columnLabel(spec, value) {
    return spec.chronologicalColumns ? `${value}s` : humanize(value);
  }

  function cellCountText(spec, cell) {
    if (!cell.count) return "No data";
    const raw = rawCellCountText(spec, cell);
    if (activeMode === "column") {
      return (
        `${percentText(cell.columnPercent)} of column ` +
        `${columnLabel(spec, cell.columnValue)} · ${raw}`
      );
    }
    if (activeMode === "row") {
      return (
        `${percentText(cell.rowPercent)} of row ` +
        `${rowLabel(spec, cell.rowValue)} · ${raw}`
      );
    }
    return raw;
  }

  function rawCellCountText(spec, cell) {
    const itemLabel = spec.itemLabel || "items";
    const itemLabelSingular = spec.itemLabelSingular || "item";
    if (spec.count === "items") {
      return (
        `${ui.formatNumber(cell.items)} ${cell.items === 1 ? itemLabelSingular : itemLabel}` +
        (cell.works == null
          ? ""
          : ` across ${ui.formatNumber(cell.works)} ${cell.works === 1 ? "work" : "works"}`)
      );
    }
    return (
      `${ui.formatNumber(cell.works)} ${cell.works === 1 ? "work" : "works"}` +
      (cell.items == null
        ? ""
        : ` · ${ui.formatNumber(cell.items)} ${cell.items === 1 ? itemLabelSingular : itemLabel}`)
    );
  }

  function percentText(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "0%";
    if (number < 0.1) return "<0.1%";
    return `${number.toFixed(1)}%`;
  }


  async function openCell(spec, cell) {
    const token = ++drawerToken;
    if (drawerController) drawerController.abort();
    const controller = new AbortController();
    drawerController = controller;
    const workLimit = limit("heatmapWorkRows", 200);
    const title =
      `${rowLabel(spec, cell.rowValue)} · ${columnLabel(spec, cell.columnValue)}`;
    const subtitle = `${cellCountText(spec, cell)}. ${spec.cellNote}`;
    ui.openDrawer(title, subtitle);
    ui.drawerMessage("Loading works…");
    try {
      const rows = await runQuery(
        spec.drilldown,
        {
          ...cell.drilldown,
          SCOPE_FILTER: ctx.scopeFilter(),
          LIMIT: workLimit
        },
        { signal: controller.signal }
      );
      if (token !== drawerToken) return;
      const limited = workLimit === 0 || rows.length >= workLimit;
      ui.openDrawer(
        title,
        subtitle +
          (limited
            ? ` Row limit reached; showing at most ${ui.formatNumber(workLimit)} works.`
            : "")
      );
      if (!rows.length) {
        ui.drawerMessage("No works returned for this cell.");
        return;
      }
      ui.drawerList(rows, {
        title: (row) => row.title || row.work,
        meta: (row) => row.work,
        onSelect: (row) => ctx.openWork(row.work, row.title || row.work)
      });
    } catch (error) {
      if (token !== drawerToken || error.name === "AbortError") return;
      ui.drawerMessage(error.message, "error");
    } finally {
      if (token === drawerToken) drawerController = null;
    }
  }

  document.addEventListener("fiaf-viz:drawer-close", () => {
    drawerToken += 1;
    if (drawerController) drawerController.abort();
    drawerController = null;
  });

  updateChrome();

  return {
    load,
    currentQuery: () => SPEC_BY_KEY.get(activeKey).query,
    currentQueryLabel: () => SPEC_BY_KEY.get(activeKey).label,
    invalidate() {
      cancelRequest();
      dataByKind.clear();
    },
    pause: cancelRequest,
    resume() {
      loadActive().catch((error) => {
        if (error.name !== "AbortError") {
          ui.error(root, error, "Choose another matrix or reload the page.");
        }
      });
    },
    // Show the matrices for "works" or "items". True when the active matrix
    // changes, so the caller reloads.
    setUnit(next) {
      const value = next || null;
      if (value === unit) return false;
      unit = value;
      const shown = specsFor(unit);
      const remembered = keyByUnit.get(unit);
      const previousKey = activeKey;
      activeKey = shown.some((spec) => spec.key === remembered)
        ? remembered
        : shown.some((spec) => spec.key === activeKey) ? activeKey : shown[0].key;
      fillKindOptions();
      updateChrome();
      return activeKey !== previousKey;
    },
    resetMode() {
      setMode("count");
      rowLimit = defaultRowLimit;
      if (limitSelect) limitSelect.value = String(rowLimit);
      redrawIfLoaded();
    },
    resize() {
      if (dataByKind.has(cacheKey(activeKey)) && root.clientWidth !== previousWidth) draw();
    },
    // The chord and mosaic resolve their palettes from the theme when drawn.
    restyle() {
      const spec = SPEC_BY_KEY.get(activeKey);
      if (chordActive(spec) || mosaicActive(spec)) redrawIfLoaded();
    },
    exportSvg() {
      return { element: svg.node(), name: `fiaf-${activeKey}.svg` };
    }
  };
}
