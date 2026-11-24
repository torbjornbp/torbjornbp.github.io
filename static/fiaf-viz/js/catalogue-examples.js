// Example queries for Catalogue › SPARQL.
//
// The examples are data: queries/examples/index.json lists them in groups
// (each with a title and a one-line question) and each
// query is queries/examples/<id>.rq. Adding an example is one .rq file and one
// entry in the index; scripts/time-examples.py checks it on the live endpoint.
// Picking an example only loads it into the editor; the reader runs it.

const BASE = "queries/examples";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS = ["id", "title", "question"];

// Validate the index and return its groups. Anything malformed is an error,
// not silently dropped, so a bad entry shows up in the tests.
export function parseExampleIndex(data) {
  if (!data || !Array.isArray(data.groups)) {
    throw new Error("example index has no groups");
  }
  const seen = new Set();
  return data.groups.map((group) => {
    if (!group || typeof group.title !== "string" || !group.title.trim()) {
      throw new Error("example group has no title");
    }
    if (!Array.isArray(group.examples) || !group.examples.length) {
      throw new Error(`example group "${group.title}" has no examples`);
    }
    return {
      title: group.title,
      examples: group.examples.map((example) => {
        for (const field of FIELDS) {
          if (!example || typeof example[field] !== "string" || !example[field].trim()) {
            throw new Error(`example in "${group.title}" has no ${field}`);
          }
        }
        if (!ID.test(example.id)) throw new Error(`example id "${example.id}" is not a file name`);
        if (seen.has(example.id)) throw new Error(`example id "${example.id}" is listed twice`);
        seen.add(example.id);
        return {
          id: example.id,
          title: example.title,
          question: example.question
        };
      })
    };
  });
}

export function createExampleLoader(fetchText) {
  let index = null;
  const queries = new Map();
  return {
    groups() {
      if (!index) {
        index = fetchText(`${BASE}/index.json`)
          .then((text) => parseExampleIndex(JSON.parse(text)))
          .catch((error) => {
            index = null;
            throw error;
          });
      }
      return index;
    },
    query(id) {
      if (!ID.test(id)) return Promise.reject(new Error(`unknown example "${id}"`));
      if (!queries.has(id)) {
        queries.set(id, fetchText(`${BASE}/${id}.rq`).catch((error) => {
          queries.delete(id);
          throw error;
        }));
      }
      return queries.get(id);
    }
  };
}

export async function fetchText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`could not load ${path} (${response.status})`);
  return response.text();
}

// Draw the groups into the container: a mono label per group and one button
// per example. onPick receives the example.
export function renderExamples(container, groups, onPick) {
  container.textContent = "";
  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "catalogue-example-group";
    const heading = document.createElement("h4");
    heading.className = "catalogue-templates-label";
    heading.textContent = group.title;
    section.append(heading);
    const list = document.createElement("ul");
    list.className = "catalogue-example-list";
    for (const example of group.examples) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalogue-example";
      button.dataset.catalogueExample = example.id;
      button.setAttribute("aria-pressed", "false");
      const title = document.createElement("span");
      title.className = "catalogue-example-title";
      title.textContent = example.title;
      const question = document.createElement("span");
      question.className = "catalogue-example-question";
      question.textContent = example.question;
      button.append(title, question);
      button.addEventListener("click", () => onPick(example, button));
      item.append(button);
      list.append(item);
    }
    section.append(list);
    container.append(section);
  }
}
