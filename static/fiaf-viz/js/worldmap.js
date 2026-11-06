// Interactive world choropleth of distinct works per production country.

import { countryIso } from "./countries.js";
import { HEAT_RAMP, drawHeatLegend, heatScale } from "./heat.js";
import { humanize } from "./labels.js";
import { limit, runQuery, sparqlIri } from "./sparql.js";
import * as ui from "./ui.js";

const GEOMETRY_URL = "vendor/world-countries-50m.geojson";
let geometryCache = null;

async function loadGeometry(signal) {
  if (geometryCache) return geometryCache;
  const response = await fetch(GEOMETRY_URL, { signal });
  if (!response.ok) {
    throw new Error(`could not load ${GEOMETRY_URL} (${response.status})`);
  }
  const payload = await response.json();
  if (
    !payload ||
    payload.type !== "FeatureCollection" ||
    !Array.isArray(payload.features)
  ) {
    throw new Error(`${GEOMETRY_URL} is not a GeoJSON FeatureCollection`);
  }
  geometryCache = payload;
  return geometryCache;
}

function featureId(feature) {
  const properties = feature.properties || {};
  const id = feature.id && feature.id !== "-99" ? feature.id : properties.ISO_A3_EH;
  return id && id !== "-99" ? id : properties.ADM0_A3 || null;
}

function countText(count) {
  return `${ui.formatNumber(count)} ${count === 1 ? "work" : "works"}`;
}

function countryText(count) {
  return `${ui.formatNumber(count)} ${count === 1 ? "country" : "countries"}`;
}

function truncate(text, length) {
  const value = String(text || "");
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function create(ctx, root, statsElement, overviewElement) {
  let entries = null;
  let entriesScopeFilter = "";
  let overviewData = null;
  let previousWidth = null;
  let loadToken = 0;
  let drawerToken = 0;
  let drawerController = null;
  let zoomTransform = d3.zoomIdentity;
  let mapLayer = null;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const statValues = new Map(
    [
      ...(overviewElement
        ? overviewElement.querySelectorAll("[data-stat]")
        : [])
    ].map((element) => [element.dataset.stat, element])
  );

  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "group")
    .attr("aria-label", "World map of works by production country");

  const zoom = d3
    .zoom()
    .scaleExtent([1, 8])
    .filter((event) =>
      event.type === "wheel" ? event.ctrlKey || event.metaKey : !event.button
    )
    .on("zoom", (event) => {
      zoomTransform = event.transform;
      if (mapLayer) mapLayer.attr("transform", zoomTransform);
    });

  function renderOverview() {
    if (!overviewData) return;
    const set = (name, value) => {
      const element = statValues.get(name);
      if (element) element.textContent = value;
    };
    set("works", ui.formatNumber(overviewData.works));
    set("countries", ui.formatNumber(overviewData.countries));
    set("names", ui.formatNumber(overviewData.agents));
    const first = overviewData.firstYear;
    const last = overviewData.lastYear;
    set(
      "years",
      first && last ? (first === last ? first : `${first}–${last}`) : "—"
    );
  }

  function draw() {
    if (!entries || !geometryCache) return;
    ui.clear(root);
    previousWidth = root.clientWidth;

    const width = Math.max(320, root.clientWidth || 960);
    const mapHeight = Math.max(320, Math.min(620, width * 0.5));
    const features = geometryCache.features
      .map((feature) => ({ ...feature, id: featureId(feature) }))
      .filter((feature) => feature.id && feature.id !== "ATA");
    const collection = { type: "FeatureCollection", features };
    const projection = d3
      .geoNaturalEarth1()
      .fitExtent([[12, 12], [width - 12, mapHeight - 12]], collection);
    const path = d3.geoPath(projection);

    const isoSet = new Set(features.map((feature) => feature.id));
    const byIso = new Map();
    const offMap = [];
    for (const entry of entries) {
      if (entry.iso && isoSet.has(entry.iso)) byIso.set(entry.iso, entry);
      else offMap.push(entry);
    }

    // The scale must ignore off-map countries: historical states and a few
    // territories have no Natural Earth polygon to shade.
    const maximum = d3.max([...byIso.values()], (entry) => entry.works) || 1;
    const { colour, edges, range } = heatScale(maximum, HEAT_RAMP.slice(1));

    const columns = width >= 720 ? 2 : 1;
    const offMapRows = offMap.length ? Math.ceil(offMap.length / columns) : 0;
    const offMapTop = mapHeight + 72;
    const height = offMap.length
      ? offMapTop + 24 + offMapRows * 18 + 16
      : mapHeight + 60;

    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height);
    svg.selectAll("*").remove();
    mapLayer = null;

    svg
      .append("rect")
      .attr("class", "map-ocean")
      .attr("width", width)
      .attr("height", mapHeight);

    mapLayer = svg.append("g").attr("class", "map-layer");

    mapLayer
      .append("g")
      .selectAll("path")
      .data(features, (feature) => feature.id)
      .join("path")
      .attr("class", (feature) =>
        byIso.has(feature.id) ? "map-country has-data" : "map-country is-empty"
      )
      .attr("d", path)
      // Only countries with works get an inline fill. Empty countries rely on
      // .map-country.is-empty in CSS, so the heat ramp cannot paint them.
      .attr("fill", (feature) =>
        byIso.has(feature.id) ? colour(byIso.get(feature.id).works) : null
      )
      .attr("tabindex", (feature) => (byIso.has(feature.id) ? 0 : null))
      .attr("role", (feature) => (byIso.has(feature.id) ? "button" : null))
      .attr("aria-label", (feature) => {
        const entry = byIso.get(feature.id);
        if (!entry) return null;
        return `${entry.name}: ${countText(entry.works)}. Activate to list works.`;
      })
      .on("mouseenter", (event, feature) => {
        const entry = byIso.get(feature.id);
        const name = entry
          ? entry.name
          : (feature.properties && feature.properties.name) || feature.id;
        ui.showTooltip(
          event,
          name,
          entry ? `${countText(entry.works)} · activate for titles` : "No works"
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, feature) => {
        const entry = byIso.get(feature.id);
        if (entry) openCountry(entry);
      })
      .on("keydown", (event, feature) => {
        const entry = byIso.get(feature.id);
        if (entry && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openCountry(entry);
        }
      });

    drawHeatLegend(svg, {
      edges,
      range,
      left: 16,
      top: mapHeight + 18,
      label: "Works per country",
      zeroFill: "var(--map-empty)",
      zeroLabel: "No works"
    });

    if (offMap.length) {
      svg
        .append("text")
        .attr("class", "map-offmap-title")
        .attr("x", 16)
        .attr("y", offMapTop)
        .text("Countries not shown on this map");

      const columnWidth = (width - 32) / columns;
      const labelLength =
        columns === 2 ? 46 : Math.max(24, Math.floor((width - 120) / 6));
      const items = svg
        .append("g")
        .selectAll("g")
        .data(offMap, (entry) => entry.iri)
        .join("g")
        .attr("class", "map-offmap-item")
        .attr(
          "transform",
          (entry, index) =>
            `translate(${16 + (index % columns) * columnWidth},` +
            `${offMapTop + 22 + Math.floor(index / columns) * 18})`
        )
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (entry) =>
          `${entry.name}: ${countText(entry.works)}. Activate to list works.`
        )
        .on("mouseenter", (event, entry) => {
          ui.showTooltip(
            event,
            entry.name,
            `${countText(entry.works)} · not shown on this map`
          );
        })
        .on("mousemove", ui.moveTooltip)
        .on("mouseleave", ui.hideTooltip)
        .on("click", (event, entry) => openCountry(entry))
        .on("keydown", (event, entry) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openCountry(entry);
          }
        });

      items
        .append("text")
        .attr("x", 0)
        .attr("y", 0)
        .text(
          (entry) =>
            `${truncate(entry.name, labelLength)} · ${countText(entry.works)}`
        );
    }

    if (statsElement) {
      const pairs = entries.reduce((sum, entry) => sum + entry.works, 0);
      const parts = [
        countryText(entries.length),
        `${ui.formatNumber(pairs)} work-country ${pairs === 1 ? "pair" : "pairs"}`,
        "co-productions count once per country"
      ];
      if (offMap.length) {
        parts.push(`${ui.formatNumber(offMap.length)} not shown on this map`);
      }
      statsElement.textContent = parts.join(" · ");
    }

    zoom
      .extent([[0, 0], [width, mapHeight]])
      .translateExtent([[0, 0], [width, mapHeight]]);
    svg.call(zoom);
    svg.on("dblclick.zoom", null);
    svg.call(zoom.transform, zoomTransform);
  }

  async function load({ signal } = {}) {
    const token = ++loadToken;
    const firstLoad = !entries;
    if (firstLoad) {
      const width = Math.max(320, root.clientWidth || 960);
      const mapHeight = Math.max(320, Math.min(620, width * 0.5));
      root.style.minHeight = `${mapHeight + 130}px`;
      ui.message(root, "Loading the world map…");
      ui.setStatus("Loading the world map…");
    }
    const scopeFilter = ctx.scopeFilter();
    const [rows, overviewRows] = await Promise.all([
      runQuery("country-works", { SCOPE_FILTER: scopeFilter }, { signal }),
      runQuery("worldmap-overview", { SCOPE_FILTER: scopeFilter }, { signal }),
      loadGeometry(signal)
    ]);
    if (token !== loadToken || (signal && signal.aborted)) return;
    const overview = overviewRows[0] || {};
    entries = rows
      .map((row) => ({
        iri: row.country,
        name: humanize(row.country),
        iso: countryIso(row.country),
        works: Number(row.works) || 0
      }))
      .filter((entry) => entry.iri && entry.works > 0)
      .sort(
        (a, b) => b.works - a.works || a.name.localeCompare(b.name)
      );
    entriesScopeFilter = scopeFilter;
    overviewData = {
      works:
        Number(overview.works) ||
        entries.reduce((sum, entry) => sum + entry.works, 0),
      countries: Number(overview.countries) || entries.length,
      agents: Number(overview.agents) || 0,
      firstYear: overview.firstYear || null,
      lastYear: overview.lastYear || null
    };
    draw();
    renderOverview();
    ui.setStatus("");
  }

  function openCountry(entry) {
    const token = ++drawerToken;
    if (drawerController) drawerController.abort();
    const controller = new AbortController();
    drawerController = controller;
    const workLimit = limit("heatmapWorkRows", 200);
    const subtitle =
      `${countText(entry.works)} in the current selection. ` +
      "Co-productions can appear under more than one country.";
    ui.openDrawer(entry.name, subtitle);
    ui.drawerMessage("Loading works…");
    runQuery(
      "country-works-list",
      {
        COUNTRY: sparqlIri(entry.iri),
        SCOPE_FILTER: entriesScopeFilter,
        LIMIT: workLimit
      },
      { signal: controller.signal }
    )
      .then((rows) => {
        if (token !== drawerToken) return;
        const limited = workLimit === 0 || rows.length >= workLimit;
        ui.openDrawer(
          entry.name,
          subtitle +
            (limited
              ? ` Row limit reached; showing at most ${ui.formatNumber(workLimit)} works.`
              : "")
        );
        if (!rows.length) {
          ui.drawerMessage("No works returned for this country.");
          return;
        }
        ui.drawerList(rows, {
          title: (row) => row.title || row.work,
          meta: (row) => row.work,
          onSelect: (row) => ctx.openWork(row.work, row.title || row.work)
        });
      })
      .catch((error) => {
        if (token !== drawerToken || error.name === "AbortError") return;
        ui.drawerMessage(error.message, "error");
      })
      .finally(() => {
        if (token === drawerToken) drawerController = null;
      });
  }

  for (const name of ["fiaf:theme", "fiaf-viz:theme", "nln:theme"]) {
    document.addEventListener(name, () => {
      if (entries) draw();
    });
  }

  for (const name of [
    "fiaf:drawer-close",
    "fiaf-viz:drawer-close",
    "nln:drawer-close"
  ]) {
    document.addEventListener(name, () => {
      drawerToken += 1;
      if (drawerController) drawerController.abort();
      drawerController = null;
    });
  }

  return {
    load,
    resize() {
      if (entries && root.clientWidth && root.clientWidth !== previousWidth) draw();
    },
    fit() {
      if (!entries) return;
      zoomTransform = d3.zoomIdentity;
      svg.interrupt();
      if (reduceMotion.matches) {
        svg.call(zoom.transform, d3.zoomIdentity);
        return;
      }
      svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity);
    },
    exportSvg() {
      return { element: svg.node(), name: "nln-world-map.svg" };
    }
  };
}
