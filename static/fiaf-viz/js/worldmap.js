// Interactive world map of distinct works per production country.
//
// "All years" shades each country by its works. The time modes play the map
// through the years: "Per year" shows the works produced in each year,
// "Cumulative" the works produced up to it, so the map fills up. The player
// under the map holds those controls and a bar track of dated works per year,
// which doubles as the scrubber. Countries can be shaded or drawn as spikes
// rising from their centre (after the d3 spike map), which keeps large
// countries from dominating. The colour and length domains are fixed per
// mode, so a colour or a height means the same count in every year.

import { countryIso } from "./countries.js";
import { MAP_HEAT_RAMP, drawHeatLegend, heatScale } from "./heat.js";
import { humanize } from "./labels.js";
import { limit, runQuery, sparqlIri, sparqlLiteral } from "./sparql.js";
import { frameCounts, frameMaximum, labelStep, logTicks, yearFrames, yearTotals } from "./worldmap-time.js";
import * as ui from "./ui.js";

const GEOMETRY_URL = "vendor/world-countries-50m.geojson";
// Time per year while the map plays.
const PLAY_STEP_MS = 220;
// How long a country takes to fade or sink to nothing once its works are
// gone: about three played years. Keep in step with --duration-afterglow.
const AFTERGLOW_MS = 660;
const TRACK_HEIGHT = 44;
// Below this width the legend goes under the map instead of over its corner.
const OVERLAY_LEGEND_WIDTH = 640;
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

// The centre of a country's largest polygon, so overseas territories do not
// pull France's spike into the Atlantic.
function mainCentroid(feature, path) {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type !== "MultiPolygon") return path.centroid(feature);
  let best = null;
  let bestArea = -1;
  for (const coordinates of geometry.coordinates) {
    const polygon = { type: "Polygon", coordinates };
    const area = d3.geoArea(polygon);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return best ? path.centroid(best) : null;
}

// A spike: a thin triangle with its base on the country's centre.
function spikePath(length, width) {
  return `M${-width / 2},0L0,${-length}L${width / 2},0`;
}

function countText(count) {
  return `${ui.formatNumber(count)} ${count === 1 ? "work" : "works"}`;
}

function countryText(count) {
  return `${ui.formatNumber(count)} ${count === 1 ? "country" : "countries"}`;
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
  // Time state. timeData is loaded the first time a time mode is chosen and
  // again when the dataset selection changes.
  let timeMode = "all";
  let marks = "shade";
  let timeData = null;
  let timeLoading = null;
  let yearIndex = 0;
  let playTimer = null;
  // Set by draw(), used by paint() for each frame.
  let scene = null;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const statValues = new Map(
    [
      ...(overviewElement
        ? overviewElement.querySelectorAll("[data-stat]")
        : [])
    ].map((element) => [element.dataset.stat, element])
  );
  const timeButtons = [...document.querySelectorAll("[data-map-time]")];
  const markButtons = [...document.querySelectorAll("[data-map-marks]")];
  const timeControl = document.getElementById("worldmap-time");
  const timeValue = document.getElementById("worldmap-time-value");
  const timePlay = document.getElementById("worldmap-time-play");
  const timeBack = document.getElementById("worldmap-time-back");
  const timeNext = document.getElementById("worldmap-time-next");
  const trackRoot = document.getElementById("worldmap-track");
  const offMapRoot = document.getElementById("worldmap-offmap");

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

  // A time mode draws only with year data for the selection on screen.
  const timed = () =>
    timeMode !== "all" &&
    Boolean(timeData) &&
    timeData.scopeFilter === entriesScopeFilter &&
    timeData.frames.years.length > 0;
  const currentYear = () => (timed() ? timeData.frames.years[yearIndex] : null);

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

  // Every country that can appear in the current mode, keyed by IRI.
  function countryCatalogue() {
    const catalogue = new Map();
    const add = (iri) => {
      if (!iri || catalogue.has(iri)) return;
      catalogue.set(iri, { iri, name: humanize(iri), iso: countryIso(iri) });
    };
    for (const entry of entries || []) add(entry.iri);
    if (timed()) {
      for (const counts of timeData.frames.perYear.values()) {
        for (const iri of counts.keys()) add(iri);
      }
    }
    return [...catalogue.values()];
  }

  // Works per country IRI in the frame on screen.
  function currentCounts() {
    if (!timed()) return new Map((entries || []).map((entry) => [entry.iri, entry.works]));
    return frameCounts(timeData.frames, currentYear(), timeMode);
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
    const catalogue = countryCatalogue();
    const byIso = new Map();
    const offMap = [];
    for (const entry of catalogue) {
      if (entry.iso && isoSet.has(entry.iso)) byIso.set(entry.iso, entry);
      else offMap.push(entry);
    }
    offMap.sort((a, b) => a.name.localeCompare(b.name));
    const onMap = new Set([...byIso.values()].map((entry) => entry.iri));

    // The scale must ignore off-map countries: historical states and a few
    // territories have no Natural Earth polygon to shade. In a time mode it
    // covers every frame, so colours compare across years.
    const maximum = timed()
      ? frameMaximum(timeData.frames, timeMode, (iri) => onMap.has(iri)) || 1
      : d3.max(entries.filter((entry) => onMap.has(entry.iri)), (entry) => entry.works) || 1;
    const { colour, edges, range } = heatScale(maximum, MAP_HEAT_RAMP);
    // Spike height is on a log scale, so one dominant country does not flatten
    // the rest. Symlog keeps zero at zero and gives a single work a visible
    // spike; the tallest reaches about a quarter of the map's height.
    const length = d3.scaleSymlog().domain([0, maximum]).range([0, Math.max(40, mapHeight * 0.26)]);
    const spikeWidth = Math.max(5, Math.min(8, width / 160));
    const spikeTicks = logTicks(maximum);

    // On a wide map the legend sits in the empty ocean at the bottom left; on
    // a narrow one it goes under the map.
    const overlay = width >= OVERLAY_LEGEND_WIDTH;
    // Narrow enough to stay clear of South America; long ramps label every
    // other step so the numbers never run into each other.
    const stepWidth = Math.max(22, Math.min(32, (width - 48) / (range.length + 1)));
    const labelEvery = range.length > 6 ? 2 : 1;
    const spikeStep = Math.max(44, 9 * ui.formatNumber(spikeTicks[spikeTicks.length - 1] || 0).length + 12);
    const legendBox = marks === "spikes"
      ? {
          width: Math.max(190, spikeTicks.length * spikeStep + 24),
          height: length(spikeTicks[spikeTicks.length - 1] || 0) + 56
        }
      : { width: (range.length + 1) * stepWidth + 24, height: 62 };
    const height = overlay ? mapHeight : mapHeight + legendBox.height + 8;

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

    // is-timed turns on the afterglow in CSS; the all-years map has no
    // frames to fade between.
    mapLayer = svg.append("g").attr("class", "map-layer").classed("is-timed", timed());
    const countOf = (iri) => (scene ? scene.counts.get(iri) || 0 : 0);

    const countryPaths = mapLayer
      .append("g")
      .selectAll("path")
      .data(features, (feature) => feature.id)
      .join("path")
      .attr("d", path)
      .on("mouseenter", (event, feature) => {
        const entry = byIso.get(feature.id);
        const name = entry
          ? entry.name
          : (feature.properties && feature.properties.name) || feature.id;
        const works = entry ? countOf(entry.iri) : 0;
        ui.showTooltip(event, name, tooltipText(works));
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, feature) => {
        const entry = byIso.get(feature.id);
        if (entry && countOf(entry.iri)) openCountry(entry, countOf(entry.iri));
      })
      .on("keydown", (event, feature) => {
        const entry = byIso.get(feature.id);
        if (entry && countOf(entry.iri) && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openCountry(entry, countOf(entry.iri));
        }
      });

    // Spikes rise from each country's centre. Northern ones are drawn first,
    // so a spike is never hidden behind one that rises from above it.
    const centres = [...byIso.entries()]
      .map(([iso, entry]) => {
        const feature = features.find((candidate) => candidate.id === iso);
        const centre = feature ? mainCentroid(feature, path) : null;
        return centre && centre.every(Number.isFinite) ? { ...entry, x: centre[0], y: centre[1] } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.y - b.y);
    const spikes = mapLayer
      .append("g")
      .attr("class", "map-spikes")
      .selectAll("path")
      .data(centres, (entry) => entry.iri)
      .join("path")
      .attr("class", "map-spike")
      .attr("transform", (entry) => `translate(${entry.x},${entry.y})`)
      .attr("d", spikePath(0, spikeWidth))
      .on("mouseenter", (event, entry) => {
        ui.showTooltip(event, entry.name, tooltipText(countOf(entry.iri)));
      })
      // Keyboard focus shows the same count, anchored to the spike.
      .on("focus", (event, entry) => {
        ui.showTooltip(ui.elementPoint(event.currentTarget), entry.name, tooltipText(countOf(entry.iri)));
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave blur", ui.hideTooltip)
      .on("click", (event, entry) => {
        if (countOf(entry.iri)) openCountry(entry, countOf(entry.iri));
      })
      .on("keydown", (event, entry) => {
        if (countOf(entry.iri) && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openCountry(entry, countOf(entry.iri));
        }
      });

    // The legend is drawn after the map layer so zooming never covers it.
    const boxTop = overlay ? mapHeight - legendBox.height - 10 : mapHeight + 8;
    if (overlay) {
      svg
        .append("rect")
        .attr("class", "map-legend-box")
        .attr("x", 10)
        .attr("y", boxTop)
        .attr("width", legendBox.width)
        .attr("height", legendBox.height);
    }
    const legendLeft = overlay ? 22 : 16;
    const legendTop = boxTop + 26;
    if (marks === "spikes") {
      drawSpikeLegend(length, spikeTicks, spikeWidth, spikeStep, legendLeft, legendTop);
    } else {
      drawHeatLegend(svg, {
        edges,
        range,
        left: legendLeft,
        top: legendTop,
        label: legendLabel(),
        zeroFill: "var(--map-empty)",
        zeroLabel: "No works",
        stepWidth,
        labelEvery
      });
    }

    scene = { byIso, offMap, countryPaths, spikes, colour, length, spikeWidth, counts: new Map(), track: null };
    drawTrack();
    paint(false);

    zoom
      .extent([[0, 0], [width, mapHeight]])
      .translateExtent([[0, 0], [width, mapHeight]]);
    svg.call(zoom);
    svg.on("dblclick.zoom", null);
    svg.call(zoom.transform, zoomTransform);
  }

  function tooltipText(works) {
    const year = currentYear();
    const when = year === null ? "" : timeMode === "cumulative" ? ` up to ${year}` : ` in ${year}`;
    return works ? `${countText(works)}${when} · activate for titles` : `No works${when}`;
  }

  function legendLabel() {
    if (!timed()) return "Works per country";
    return timeMode === "cumulative" ? "Works per country, up to the year" : "Works per country in the year";
  }

  // Spikes for round counts standing on one baseline, at the map's scale.
  function drawSpikeLegend(length, values, spikeWidth, step, left, top) {
    const legend = svg.append("g").attr("class", "heat-legend").attr("transform", `translate(${left},${top})`);
    legend.append("text").attr("y", -8).text(legendLabel());
    const baseline = 6 + length(values[values.length - 1] || 0);
    values.forEach((value, index) => {
      const x = step / 2 + index * step;
      legend
        .append("path")
        .attr("class", "map-spike map-spike-legend")
        .attr("transform", `translate(${x},${baseline})`)
        .attr("d", spikePath(length(value), spikeWidth));
      legend
        .append("text")
        .attr("x", x)
        .attr("y", baseline + 14)
        .attr("text-anchor", "middle")
        .text(ui.formatNumber(value));
    });
  }

  // Bars of dated works per year under the player controls. The track is
  // the scrubber: click or drag along it, or focus it and use the arrow keys.
  function drawTrack() {
    if (!trackRoot) return;
    trackRoot.hidden = !timed();
    trackRoot.replaceChildren();
    if (!timed()) return;
    const totals = yearTotals(timeData.frames, timeData.totals, timeMode);
    const width = Math.max(300, trackRoot.clientWidth || root.clientWidth || 960);
    const height = TRACK_HEIGHT + 22;
    const x = d3.scaleBand().domain(totals.map((entry) => entry.year)).range([0, width]).padding(0.12);
    const y = d3.scaleLinear().domain([0, d3.max(totals, (entry) => entry.works) || 1]).range([TRACK_HEIGHT, 0]);
    const track = d3
      .select(trackRoot)
      .append("svg")
      .attr("class", "map-track")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", width)
      .attr("height", height)
      .attr("tabindex", 0)
      .attr("role", "slider")
      .attr("aria-label", timeMode === "cumulative" ? "Year, with dated works up to each year" : "Year, with dated works per year")
      .attr("aria-valuemin", totals[0].year)
      .attr("aria-valuemax", totals[totals.length - 1].year);
    const bars = track
      .append("g")
      .selectAll("rect")
      .data(totals)
      .join("rect")
      .attr("class", "map-track-bar")
      .attr("x", (entry) => x(entry.year))
      .attr("width", x.bandwidth())
      .attr("y", (entry) => y(entry.works))
      .attr("height", (entry) => TRACK_HEIGHT - y(entry.works));
    bars.append("title").text((entry) => `${entry.year}: ${countText(entry.works)}`);
    // Only round years are labelled, as many as fit.
    const every = labelStep(totals.length, Math.floor(width / 46));
    track
      .append("g")
      .attr("class", "map-track-axis")
      .selectAll("text")
      .data(totals.filter((entry) => entry.year % every === 0))
      .join("text")
      // Edge labels are kept inside the track instead of centred off it.
      .attr("x", (entry) => Math.max(18, Math.min(width - 18, x(entry.year) + x.bandwidth() / 2)))
      .attr("y", TRACK_HEIGHT + 15)
      .attr("text-anchor", "middle")
      .text((entry) => String(entry.year));
    const pick = (event) => {
      const [px] = d3.pointer(event, track.node());
      const index = Math.max(0, Math.min(totals.length - 1, Math.floor(px / x.step())));
      stopPlaying();
      setYear(index);
    };
    track
      .on("pointerdown", (event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pick(event);
      })
      .on("pointermove", (event) => {
        if (event.buttons) pick(event);
      })
      .on("keydown", (event) => {
        const last = totals.length - 1;
        const moves = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
        if (event.key in moves) setYear(yearIndex + moves[event.key]);
        else if (event.key === "PageDown") setYear(yearIndex - 10);
        else if (event.key === "PageUp") setYear(yearIndex + 10);
        else if (event.key === "Home") setYear(0);
        else if (event.key === "End") setYear(last);
        else if (event.key === " ") {
          if (playTimer !== null) stopPlaying();
          else startPlaying();
        } else return;
        event.preventDefault();
        if (event.key !== " ") stopPlaying();
      });
    scene.track = { svg: track, bars };
  }

  // The off-map list is plain HTML under the player: historical states and
  // territories without a polygon, with their works in the current frame.
  function paintOffMap(counts) {
    if (!offMapRoot || !scene) return;
    const listed = scene.offMap.filter((entry) => counts.get(entry.iri) || !timed());
    offMapRoot.hidden = !listed.length;
    offMapRoot.replaceChildren();
    if (!listed.length) return;
    offMapRoot.append(ui.node("h3", "map-offmap-title", "Countries not shown on this map"));
    const list = ui.node("ul", "map-offmap-list");
    for (const entry of listed) {
      const works = counts.get(entry.iri) || 0;
      const item = ui.node("li", "");
      const button = ui.node("button", "map-offmap-item", `${entry.name} · ${countText(works)}`);
      button.type = "button";
      button.disabled = !works;
      button.addEventListener("click", () => openCountry(entry, works));
      item.append(button);
      list.append(item);
    }
    offMapRoot.append(list);
  }

  // Apply the current frame: fills, spike heights, off-map counts, the track
  // highlight and the stats line.
  function paint(animate = true) {
    if (!scene) return;
    const counts = currentCounts();
    scene.counts = counts;
    const { byIso, colour, length, spikeWidth } = scene;
    const shade = marks === "shade";
    const duration = animate && !reduceMotion.matches ? PLAY_STEP_MS * 0.6 : 0;
    const countFor = (feature) => {
      const entry = byIso.get(feature.id);
      return entry ? counts.get(entry.iri) || 0 : 0;
    };

    // Only countries with works get an inline fill. Empty countries rely on
    // .map-country.is-empty in CSS, so the heat ramp cannot paint them.
    scene.countryPaths
      .attr("class", (feature) =>
        shade && countFor(feature) ? "map-country has-data" : `map-country is-empty${countFor(feature) ? " has-works" : ""}`
      )
      .attr("fill", (feature) => (shade && countFor(feature) ? colour(countFor(feature)) : null))
      .attr("tabindex", (feature) => (shade && countFor(feature) ? 0 : null))
      .attr("role", (feature) => (shade && countFor(feature) ? "button" : null))
      .attr("aria-label", (feature) => {
        const entry = byIso.get(feature.id);
        if (!entry || !shade || !countFor(feature)) return null;
        return `${entry.name}: ${tooltipText(countFor(feature))}.`;
      });

    // Spikes share the shading's afterglow: a spike rises in one step but
    // sinks to nothing over a few played years, and is hidden only once it
    // is flat (a zero-height spike would still draw its base as a short
    // line). Under reduced motion both happen at once.
    const spikeCount = (entry) => (marks === "spikes" ? counts.get(entry.iri) || 0 : 0);
    const sink = animate && !reduceMotion.matches ? AFTERGLOW_MS : 0;
    scene.spikes
      .attr("tabindex", (entry) => (spikeCount(entry) ? 0 : null))
      .attr("role", (entry) => (spikeCount(entry) ? "button" : null))
      .attr("aria-label", (entry) => (spikeCount(entry) ? `${entry.name}: ${tooltipText(spikeCount(entry))}.` : null))
      .style("pointer-events", (entry) => (spikeCount(entry) ? null : "none"))
      .attr("visibility", function (entry) {
        if (spikeCount(entry)) return null;
        return sink ? this.getAttribute("visibility") : "hidden";
      })
      .transition()
      .duration((entry) => (spikeCount(entry) ? duration : sink))
      .attr("d", (entry) => spikePath(length(spikeCount(entry)), spikeWidth))
      .on("end", function (entry) {
        if (!spikeCount(entry)) this.setAttribute("visibility", "hidden");
      });

    paintOffMap(counts);

    const year = currentYear();
    if (scene.track && year !== null) {
      const { svg: track, bars } = scene.track;
      bars
        .classed("is-current", (entry) => entry.year === year)
        .classed("is-before", (entry) => timeMode === "cumulative" && entry.year < year);
      track
        .attr("aria-valuenow", year)
        .attr("aria-valuetext", String(year));
    }
    if (timeValue) timeValue.textContent = year === null ? "" : String(year);
    if (timeBack) timeBack.disabled = year === null || yearIndex <= 0;
    if (timeNext) timeNext.disabled = year === null || yearIndex >= timeData.frames.years.length - 1;
    renderStats(counts);
  }

  function renderStats(counts) {
    if (!statsElement) return;
    const countries = [...counts.values()].filter((works) => works > 0).length;
    const pairs = d3.sum(counts.values());
    const parts = [];
    const year = currentYear();
    if (year !== null) {
      parts.push(timeMode === "cumulative" ? `Up to ${year}` : String(year));
    }
    parts.push(
      countryText(countries),
      `${ui.formatNumber(pairs)} work-country ${pairs === 1 ? "pair" : "pairs"}`,
      "co-productions count once per country"
    );
    if (year !== null && overviewData && overviewData.datedWorks) {
      parts.push(
        `${ui.formatNumber(overviewData.datedWorks)} of ${ui.formatNumber(overviewData.works)} works have a production year`
      );
    }
    const hidden = scene ? scene.offMap.filter((entry) => counts.get(entry.iri)).length : 0;
    if (hidden) parts.push(`${ui.formatNumber(hidden)} not shown on this map`);
    statsElement.textContent = parts.join(" · ");
  }

  function setYear(index) {
    if (!timed()) return;
    yearIndex = Math.max(0, Math.min(timeData.frames.years.length - 1, index));
    paint(true);
  }

  function stopPlaying() {
    if (playTimer === null) return;
    clearInterval(playTimer);
    playTimer = null;
    if (timePlay) {
      timePlay.textContent = "Play";
      timePlay.setAttribute("aria-pressed", "false");
    }
  }

  function startPlaying() {
    if (!timed()) return;
    const last = timeData.frames.years.length - 1;
    if (yearIndex >= last) setYear(0);
    if (timePlay) {
      timePlay.textContent = "Pause";
      timePlay.setAttribute("aria-pressed", "true");
    }
    playTimer = setInterval(() => {
      if (yearIndex >= last) {
        stopPlaying();
        return;
      }
      setYear(yearIndex + 1);
      if (yearIndex >= last) stopPlaying();
    }, PLAY_STEP_MS);
  }

  function syncControls() {
    for (const button of timeButtons) {
      const active = button.dataset.mapTime === timeMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    for (const button of markButtons) {
      const active = button.dataset.mapMarks === marks;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (timeControl) timeControl.hidden = !timed();
  }

  async function ensureTimeData(signal) {
    const scopeFilter = ctx.scopeFilter();
    if (timeData && timeData.scopeFilter === scopeFilter) return timeData;
    if (timeLoading && timeLoading.scopeFilter === scopeFilter) return timeLoading.promise;
    const promise = Promise.all([
      runQuery("country-years", { SCOPE_FILTER: scopeFilter }, { signal }),
      runQuery("timeline", { SCOPE_FILTER: scopeFilter }, { signal })
    ]).then(([rows, totals]) => {
      const frames = yearFrames(rows);
      const result = { scopeFilter, frames, totals };
      // A slow answer for an earlier dataset selection must not replace the
      // data for the current one.
      if (scopeFilter !== ctx.scopeFilter()) return result;
      const previous = timeData ? timeData.frames.years[yearIndex] : null;
      timeData = result;
      // Keep the same year on screen when the selection changes.
      const kept = previous === null ? -1 : frames.years.indexOf(previous);
      yearIndex = kept >= 0 ? kept : 0;
      return timeData;
    }).finally(() => {
      if (timeLoading && timeLoading.promise === promise) timeLoading = null;
    });
    timeLoading = { scopeFilter, promise };
    return promise;
  }

  async function setTimeMode(mode) {
    if (mode === timeMode) return;
    stopPlaying();
    const wasAll = timeMode === "all";
    timeMode = mode;
    syncControls();
    if (mode !== "all") {
      try {
        if (!timeData || timeData.scopeFilter !== ctx.scopeFilter()) {
          ui.setStatus("Loading works by year…");
          await ensureTimeData();
          ui.setStatus("");
        }
        if (timeMode !== mode) return;
        // The selection changed while loading; its own load() draws the map.
        if (!timeData || timeData.scopeFilter !== ctx.scopeFilter()) return;
        // Start a fresh run from the first year.
        if (wasAll) yearIndex = 0;
      } catch (error) {
        if (error.name === "AbortError") return;
        ui.setStatus(error.message, "error");
        timeMode = "all";
      }
    }
    syncControls();
    draw();
  }

  for (const button of timeButtons) {
    button.addEventListener("click", () => setTimeMode(button.dataset.mapTime));
  }
  for (const button of markButtons) {
    button.addEventListener("click", () => {
      if (marks === button.dataset.mapMarks) return;
      marks = button.dataset.mapMarks;
      syncControls();
      draw();
    });
  }
  if (timePlay) {
    timePlay.addEventListener("click", () => {
      if (playTimer !== null) stopPlaying();
      else startPlaying();
    });
  }
  // One year at a time: on a phone the track gives each year about 2px, too
  // fine to pick by touch, and there are no arrow keys.
  for (const [button, step] of [[timeBack, -1], [timeNext, 1]]) {
    if (!button) continue;
    button.addEventListener("click", () => {
      stopPlaying();
      setYear(yearIndex + step);
    });
  }

  async function load({ signal } = {}) {
    const token = ++loadToken;
    const firstLoad = !entries;
    if (firstLoad) {
      const width = Math.max(320, root.clientWidth || 960);
      const mapHeight = Math.max(320, Math.min(620, width * 0.5));
      root.style.minHeight = `${mapHeight}px`;
      ui.message(root, "Loading the world map…");
      ui.setStatus("Loading the world map…");
    }
    stopPlaying();
    const scopeFilter = ctx.scopeFilter();
    let fellBack = false;
    const [rows, overviewRows] = await Promise.all([
      runQuery("country-works", { SCOPE_FILTER: scopeFilter }, { signal }),
      runQuery("worldmap-overview", { SCOPE_FILTER: scopeFilter }, { signal }),
      loadGeometry(signal),
      // The years are optional: if they fail, show the all-years map.
      timeMode === "all"
        ? null
        : ensureTimeData(signal).catch((error) => {
            if (error.name === "AbortError") throw error;
            ui.setStatus(`Works by year could not be loaded (${error.message}); showing all years.`, "error");
            timeMode = "all";
            fellBack = true;
            return null;
          })
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
      lastYear: overview.lastYear || null,
      datedWorks: Number(overview.datedWorks) || 0
    };
    syncControls();
    draw();
    renderOverview();
    if (!fellBack) ui.setStatus("");
  }

  // The drawer lists the works behind the count on screen: one year's works
  // in "Per year", every year otherwise.
  function openCountry(entry, works) {
    const token = ++drawerToken;
    if (drawerController) drawerController.abort();
    const controller = new AbortController();
    drawerController = controller;
    const year = currentYear();
    const perYear = year !== null && timeMode === "year";
    const workLimit = limit("heatmapWorkRows", 200);
    const title = perYear ? `${entry.name}, ${year}` : entry.name;
    const subtitle =
      `${countText(works)} ${perYear ? `produced in ${year}` : year !== null ? `produced up to ${year}; the list covers every year` : "in the current selection"}. ` +
      "Co-productions can appear under more than one country.";
    ui.openDrawer(title, subtitle);
    ui.drawerMessage("Loading works…");
    const request = perYear
      ? runQuery(
          "country-year-works",
          {
            COUNTRY: sparqlIri(entry.iri),
            YEAR: sparqlLiteral(String(year).padStart(4, "0")),
            SCOPE_FILTER: entriesScopeFilter,
            LIMIT: workLimit
          },
          { signal: controller.signal }
        )
      : runQuery(
          "country-works-list",
          {
            COUNTRY: sparqlIri(entry.iri),
            SCOPE_FILTER: entriesScopeFilter,
            LIMIT: workLimit
          },
          { signal: controller.signal }
        );
    request
      .then((rows) => {
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

  syncControls();

  // The year player belongs to Works › Map; the Overview shows all years.
  // Leaving Works remembers its time mode and restores it on the way back.
  const timeModeControl = document.getElementById("worldmap-time-mode");
  let datingEnabled = true;
  let savedTimeMode = "all";

  function setGroup(group) {
    const enabled = group !== "overview";
    if (enabled === datingEnabled) return;
    datingEnabled = enabled;
    if (timeModeControl) timeModeControl.hidden = !enabled;
    if (enabled) {
      setTimeMode(savedTimeMode);
    } else {
      savedTimeMode = timeMode;
      setTimeMode("all");
      if (trackRoot) trackRoot.hidden = true;
    }
  }

  return {
    load,
    setGroup,
    currentQuery: () => (timeMode === "all" ? "country-works" : "country-years"),
    pause: stopPlaying,
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
