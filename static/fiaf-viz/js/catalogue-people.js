import { catalogueFilter, roleFilter, runQuery, sparqlAnyIri, sparqlLiteral } from "./sparql.js";
import { humanize } from "./labels.js";
import * as ui from "./ui.js";

const PAGE_SIZE = 25;

export function create(ctx, panel) {
  const form = panel.querySelector("form");
  const nameInput = form.elements.namedItem("name");
  const workTitleInput = form.elements.namedItem("work-title");
  const decadeSelect = form.elements.namedItem("decade");
  const countrySelect = form.elements.namedItem("country");
  const roleSelect = form.elements.namedItem("role");
  const typeSelect = form.elements.namedItem("type");
  const status = panel.querySelector(".stats");
  const results = panel.querySelector(".catalogue-table-wrap");
  const previous = panel.querySelector("[data-previous]");
  const next = panel.querySelector("[data-next]");
  let filterTimer;
  let page = 0;
  let request = null;
  let selected = null;
  let scope = null;
  let pageRows = [];

  function noun() {
    return typeSelect.value === "Organisation" ? "organisations" : "people";
  }

  function select(selection) {
    selected = selection && selection.kind === "agent" ? selection.id : null;
    for (const button of results.querySelectorAll("[data-person]")) {
      const active = button.dataset.person === selected;
      button.closest("tr").classList.toggle("is-selected", active);
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
  }

  function render(rows, credits) {
    const table = ui.node("table", "catalogue-table catalogue-people-table");
    const heading = document.createElement("tr");
    for (const label of ["Name", "Example credit", "Credit dataset"]) {
      const cell = ui.node("th", "", label);
      cell.scope = "col";
      heading.append(cell);
    }
    table.createTHead().append(heading);
    const body = table.createTBody();
    for (const person of rows) {
      const credit = credits.get(person.person);
      const role = credit?.creditRole ? humanize(credit.creditRole) : "";
      const sources = credit?.sources?.split("|").filter(Boolean).sort().join(", ");
      pageRows.push([person.name, credit?.title, role, credit?.year, sources, person.person]);
      const button = ui.node("button", "catalogue-link catalogue-title", person.name);
      button.type = "button";
      button.title = person.person;
      button.dataset.person = person.person;
      button.addEventListener("click", () => ctx.openAgent(person.person, person.name));
      const row = ui.node("tr", "catalogue-row");
      const name = document.createElement("td");
      name.append(button);
      const example = ui.node("td", "", credit?.title || "—");
      const details = [role, credit?.year].filter(Boolean).join(" · ");
      if (details) example.append(ui.node("span", "catalogue-sub", details));
      row.append(name, example, ui.node("td", "", sources || "—"));
      body.append(row);
    }
    results.replaceChildren(table);
    select(selected ? { kind: "agent", id: selected } : null);
  }

  function cancel() {
    clearTimeout(filterTimer);
    pageRows = [];
    request?.abort();
    request = null;
  }

  async function load() {
    cancel();
    previous.disabled = true;
    next.disabled = true;
    results.replaceChildren();
    const controller = new AbortController();
    request = controller;
    const { signal } = controller;
    status.textContent = `Searching for ${noun()}…`;
    const role = roleSelect.value
      ? `?activity a ?role . ${roleFilter([roleSelect.value])}`
      : "";
    try {
      const offset = page * PAGE_SIZE;
      const rows = await runQuery("catalogue-people", {
        TERM: sparqlLiteral(nameInput.value.trim()),
        AGENT_TYPE: typeSelect.value === "Organisation" ? "fiaf:Organisation" : "fiaf:Person",
        SCOPE_FILTER: ctx.scopeFilter(),
        ROLE_FILTER: role,
        CATALOGUE_FILTER: catalogueFilter({
          title: workTitleInput.value,
          decade: decadeSelect.value,
          country: countrySelect.value
        }),
        LIMIT: PAGE_SIZE + 1,
        OFFSET: offset
      }, { signal });
      if (signal.aborted) return;
      const visible = rows.slice(0, PAGE_SIZE);
      if (visible.length) {
        const examples = visible.map(({ person, example }) =>
          `(${sparqlAnyIri(person)} ${sparqlAnyIri(example)})`
        ).join(" ");
        let details = [];
        let creditError = false;
        try {
          details = await runQuery("catalogue-people-credits", {
            PEOPLE_EXAMPLES: examples,
            ROLE_FILTER: role
          }, { signal });
        } catch (error) {
          if (error.name === "AbortError") return;
          creditError = true;
        }
        if (signal.aborted) return;
        render(visible, new Map(details.map((row) => [row.person, row])));
        const range = `${ui.formatNumber(offset + 1)}–${ui.formatNumber(offset + visible.length)}`;
        status.textContent = `Showing ${noun()} ${range}.` +
          (creditError ? " Example credits could not be loaded." : "");
      } else {
        status.textContent = `No ${noun()} match this search.`;
      }
      next.disabled = rows.length <= PAGE_SIZE;
    } catch (error) {
      if (signal.aborted || error.name === "AbortError") return;
      status.textContent = `${typeSelect.value === "Organisation" ? "Organisation" : "People"} search failed: ${error.message}`;
    } finally {
      if (request === controller) {
        request = null;
        previous.disabled = page === 0;
      }
    }
  }

  function filter() {
    page = 0;
    load();
  }

  for (const input of [nameInput, workTitleInput]) {
    input.addEventListener("input", () => {
      cancel();
      page = 0;
      previous.disabled = true;
      next.disabled = true;
      filterTimer = setTimeout(load, 250);
    });
  }
  for (const select of [typeSelect, roleSelect, decadeSelect, countrySelect]) {
    select.addEventListener("change", filter);
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    filter();
  });
  form.querySelector("[data-clear-filters]").addEventListener("click", () => {
    form.reset();
    filter();
  });
  previous.addEventListener("click", () => {
    page -= 1;
    load();
  });
  next.addEventListener("click", () => {
    page += 1;
    load();
  });

  function fillOptions(select, options) {
    const chosen = select.value;
    if (chosen && !options.some(({ value }) => value === chosen)) {
      options.push({ value: chosen, label: select.selectedOptions[0].textContent });
    }
    options.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const items = options.map(({ value, label }) => {
      const option = ui.node("option", "", label);
      option.value = value;
      return option;
    });
    select.replaceChildren(select.options[0], ...items);
    select.value = chosen;
  }

  async function loadOptions(currentScope) {
    const [roles, facets] = await Promise.allSettled([
      ctx.creditRoles(),
      runQuery("catalogue-facets", { SCOPE_FILTER: currentScope })
    ]);
    if (currentScope !== ctx.scopeFilter()) return;
    if (roles.status === "fulfilled") {
      fillOptions(roleSelect, roles.value.map(({ iri }) => ({
        value: iri, label: humanize(iri)
      })));
    }
    if (facets.status === "fulfilled") {
      fillOptions(decadeSelect, facets.value.filter(({ facet }) => facet === "decade")
        .map(({ value }) => ({ value, label: `${value}s` })));
      fillOptions(countrySelect, facets.value.filter(({ facet }) => facet === "country")
        .map(({ value }) => ({ value, label: humanize(value) })));
    }
  }

  return {
    load() {
      const currentScope = ctx.scopeFilter();
      if (scope !== currentScope) {
        scope = currentScope;
        page = 0;
      }
      loadOptions(currentScope);
      return load();
    },
    setName(name) {
      form.reset();
      nameInput.value = name;
      page = 0;
    },
    setType(type) {
      typeSelect.value = type === "Organisation" ? "Organisation" : "Person";
    },
    focus() {
      nameInput.focus();
    },
    exportPage() {
      if (!pageRows.length) return null;
      return {
        filename: `fiaf-catalogue-people-page-${page + 1}.csv`,
        rows: [
          ["Name", "Example work title", "Credit role", "Production year", "Credit datasets", "Person IRI"],
          ...pageRows
        ]
      };
    },
    select,
    cancel
  };
}
