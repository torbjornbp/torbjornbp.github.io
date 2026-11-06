// Works per production year (or decade).

import { limit, runQuery, sparqlLiteral } from "./sparql.js";
import * as ui from "./ui.js";

const DESCRIPTION =
  "Works by production year. Four-digit years only. Click a bar for titles.";
const ARIA_LABEL = "Works per production year";

export function normaliseTimelineRows(rows) {
  return rows
    .map((row) => ({
      year: Number(row.year),
      works: Number(row.works) || 0
    }))
    .filter((row) => Number.isFinite(row.year) && row.works > 0)
    .sort((a, b) => a.year - b.year);
}

export function create(ctx, root, statsElement, granularityButtons, descriptionElement) {
  let data = null;
  let granularity = "year";
  let drawerToken = 0;
  let drawerController = null;
  let hasRendered = false;
  const svg = d3
    .select(root)
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", ARIA_LABEL);

  for (const button of granularityButtons || []) {
    button.addEventListener("click", () => {
      granularity = button.dataset.granularity || "year";
      for (const other of granularityButtons) other.classList.toggle("active", other === button);
      draw();
    });
  }

  document.addEventListener("fiaf-viz:drawer-close", () => {
    drawerToken += 1;
    if (drawerController) drawerController.abort();
    drawerController = null;
  });

  async function load({ signal } = {}) {
    if (!hasRendered) {
      ui.message(root, "Loading production dates…");
    }
    ui.setStatus("Counting works per year…");
    const [rows, decadeRows, totalRows] = await Promise.all([
      runQuery("timeline", { SCOPE_FILTER: ctx.scopeFilter() }, { signal }),
      runQuery("timeline-decades", { SCOPE_FILTER: ctx.scopeFilter() }, { signal }),
      runQuery("works-total", { SCOPE_FILTER: ctx.scopeFilter() }, { signal })
    ]);
    if (signal && signal.aborted) return;
    data = {
      rows: normaliseTimelineRows(rows),
      decades: normaliseTimelineRows(decadeRows),
      dated: totalRows.length ? Number(totalRows[0].datedWorks) || 0 : 0,
      total: totalRows.length ? Number(totalRows[0].works) : 0
    };
    if (descriptionElement) descriptionElement.textContent = DESCRIPTION;
    draw();
    hasRendered = true;
    ui.setStatus("");
  }

  function draw() {
    if (!data) return;
    const rows = granularity === "decade" ? data.decades : data.rows;
    if (!rows.length) {
      ui.empty(root, "No dated works found.");
      statsElement.textContent = "";
      return;
    }
    ui.clear(root);

    const width = Math.max(360, root.clientWidth || 1000);
    const height = Math.max(320, root.clientHeight || 420);
    const margin = { top: 16, right: 20, bottom: 38, left: 58 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();

    const step = granularity === "decade" ? 10 : 1;
    const domain = d3.range(
      rows[0].year,
      rows[rows.length - 1].year + step,
      step
    );
    const x = d3.scaleBand().domain(domain).range([0, innerWidth]).paddingInner(0.18);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(rows, (row) => row.works) || 1])
      .nice()
      .range([innerHeight, 0]);

    const chart = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    chart
      .append("g")
      .attr("class", "grid")
      .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""));

    const tickValues =
      innerWidth < 520
        ? d3.ticks(
            rows[0].year,
            rows[rows.length - 1].year,
            Math.max(3, Math.floor(innerWidth / 65))
          )
        : granularity === "year"
          ? domain.filter((year) => year % 10 === 0)
          : domain;

    chart
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(tickValues)
          .tickFormat((year) => (granularity === "decade" ? `${year}s` : String(year)))
      );

    chart.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(ui.formatNumber));

    chart
      .append("g")
      .selectAll("rect")
      .data(rows, (row) => row.year)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (row) => x(row.year))
      .attr("y", (row) => y(row.works))
      .attr("width", Math.max(1, x.bandwidth()))
      .attr("height", (row) => innerHeight - y(row.works))
      .attr("fill", "var(--accent)")
      .attr("fill-opacity", 0.8)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (row) => {
        const period = granularity === "decade" ? `${row.year}s` : String(row.year);
        return `${period}: ${ui.formatNumber(row.works)} works. Activate to list works.`;
      })
      .on("mouseenter", (event, row) => {
        const period = granularity === "decade" ? `${row.year}s` : String(row.year);
        ui.showTooltip(
          event,
          period,
          `${ui.formatNumber(row.works)} works · activate for titles`
        );
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave", ui.hideTooltip)
      .on("click", (event, row) => {
        openPeriod(row);
      })
      .on("keydown", (event, row) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPeriod(row);
        }
      });

    const dated = data.dated;
    const total = data.total;
    const percent = total ? (100 * dated) / total : 0;
    const scopeSuffix = ctx.scopeFilter() ? " in this dataset" : " in total";
    statsElement.textContent =
      `${ui.formatNumber(dated)} works dated · ${ui.formatNumber(total)} works${scopeSuffix}` +
      ` (${percent.toFixed(1)}% dated)`;
  }

  async function openPeriod(row) {
    const token = ++drawerToken;
    if (drawerController) drawerController.abort();
    const controller = new AbortController();
    drawerController = controller;
    const workLimit = limit("heatmapWorkRows", 200);
    const mode = granularity;
    const period = mode === "decade" ? `${row.year}s` : String(row.year);
    const year = String(row.year).padStart(4, "0");
    const prefix = mode === "decade" ? year.slice(0, 3) : year;
    const subtitle =
      `${ui.formatNumber(row.works)} ${row.works === 1 ? "work" : "works"} ` +
      (mode === "decade" ? "dated in this decade." : "dated in this year.");
    ui.openDrawer(period, subtitle);
    ui.drawerMessage("Loading works…");
    try {
      const rows = await runQuery(
        "timeline-period-works",
        {
          YEAR_PREFIX: sparqlLiteral(prefix),
          SCOPE_FILTER: ctx.scopeFilter(),
          LIMIT: workLimit
        },
        { signal: controller.signal }
      );
      if (token !== drawerToken) return;
      const limited = workLimit === 0 || rows.length >= workLimit;
      ui.openDrawer(
        period,
        subtitle +
          (limited
            ? ` Row limit reached; showing at most ${ui.formatNumber(workLimit)} works.`
            : "")
      );
      if (!rows.length) {
        ui.drawerMessage("No works returned for this period.");
        return;
      }
      ui.drawerList(rows, {
        title: (entry) => entry.title || entry.work,
        meta: (entry) => entry.work,
        onSelect: (entry) => ctx.openWork(entry.work, entry.title || entry.work)
      });
    } catch (error) {
      if (token !== drawerToken || error.name === "AbortError") return;
      ui.drawerMessage(error.message, "error");
    } finally {
      if (token === drawerToken) drawerController = null;
    }
  }

  return {
    load,
    invalidate() {
      data = null;
    },
    resize() {
      if (data) draw();
    },
    exportSvg() {
      return { element: svg.node(), name: "fiaf-timeline.svg" };
    }
  };
}
