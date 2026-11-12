// Syntax highlighting for the catalogue's SPARQL box.
//
// The textarea stays the editor (typing, undo, selection, Tab, Ctrl+Enter all
// keep working); a highlighted copy of its text is drawn underneath, and the
// textarea's own text is made transparent so only the caret and selection show
// on top. The copy follows every change of the value, including the template,
// Clear and row-limit buttons that set it from code.

const KEYWORDS = new Set(
  (
    "select construct describe ask where prefix base distinct reduced from named " +
    "optional filter union minus graph service silent bind as values group by " +
    "order asc desc limit offset having not exists in undef true false a with " +
    "include insert delete data load clear drop create add move copy into to using default all"
  ).split(" ")
);

const FUNCTIONS = new Set(
  (
    "count sum min max avg sample group_concat separator str lang langmatches datatype " +
    "bound iri uri bnode rand abs ceil floor round concat strlen ucase lcase " +
    "encode_for_uri contains strstarts strends strbefore strafter year month day " +
    "hours minutes seconds timezone tz now uuid struuid md5 sha1 sha256 sha384 sha512 " +
    "coalesce if strlang strdt sameterm isiri isuri isblank isliteral isnumeric regex " +
    "substr replace"
  ).split(" ")
);

// One alternation, tried at each position in this order: comments and strings
// first, so a "#" or "<" inside them is not read as anything else; an IRI
// cannot contain spaces, so "?a < ?b" stays a comparison.
const TOKEN = new RegExp(
  [
    String.raw`(?<comment>#[^\n]*)`,
    String.raw`(?<string>"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)`,
    String.raw`(?<iri><[^<>"{}|^\x60\\\s]*>)`,
    String.raw`(?<variable>[?$][\p{L}\p{N}_]+)`,
    String.raw`(?<placeholder>\{\{[A-Z_]+\}\})`,
    String.raw`(?<pname>(?:[\p{L}_][\p{L}\p{N}_.-]*)?:(?:[\p{L}\p{N}_:%-]|\.(?=[\p{L}\p{N}_:%-]))*)`,
    String.raw`(?<language>@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*)`,
    String.raw`(?<number>[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)`,
    String.raw`(?<word>[\p{L}_][\p{L}\p{N}_]*)`
  ].join("|"),
  "gu"
);

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (char) => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"));
}

// Highlighted HTML for a SPARQL text; plain text between tokens is escaped as is.
export function highlightSparql(text) {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [token] = match;
    if (!token) continue;
    html += escapeHtml(text.slice(last, match.index));
    last = match.index + token.length;
    const groups = match.groups;
    let kind = Object.keys(groups).find((name) => groups[name] !== undefined);
    if (kind === "word") {
      const lower = token.toLowerCase();
      kind = KEYWORDS.has(lower) ? "keyword" : FUNCTIONS.has(lower) ? "function" : null;
    } else if (kind === "language") {
      kind = "string";
    } else if (kind === "placeholder") {
      kind = "variable";
    }
    html += kind ? `<span class="sq-${kind}">${escapeHtml(token)}</span>` : escapeHtml(token);
  }
  html += escapeHtml(text.slice(last));
  // A trailing newline needs content after it, or the copy is one line short.
  return text.endsWith("\n") || !text ? `${html} ` : html;
}

// Wrap a textarea so it shows highlighted SPARQL. Returns a refresh function.
export function attachSparqlHighlight(textarea) {
  if (!textarea || !textarea.parentNode || typeof document === "undefined") return () => {};
  const wrapper = document.createElement("div");
  wrapper.className = "sparql-editor";
  const layer = document.createElement("pre");
  layer.className = "sparql-highlight";
  layer.setAttribute("aria-hidden", "true");
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.append(layer, textarea);
  textarea.classList.add("sparql-input");

  const sync = () => {
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  };
  // A scrollbar takes width from the textarea's text but not from the copy;
  // give the copy the same width so lines wrap at the same place.
  const fit = () => {
    const styles = getComputedStyle(textarea);
    const borders = parseFloat(styles.borderLeftWidth) + parseFloat(styles.borderRightWidth);
    const scrollbar = Math.max(0, textarea.offsetWidth - textarea.clientWidth - borders);
    layer.style.paddingRight = `calc(${styles.paddingRight} + ${scrollbar}px)`;
    layer.style.height = `${textarea.offsetHeight}px`;
  };
  const refresh = () => {
    layer.innerHTML = highlightSparql(textarea.value);
    fit();
    sync();
  };

  // Code sets the value directly (templates, Clear, the row limit) without an
  // input event, so follow the value property itself.
  const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value");
  if (native && native.set) {
    Object.defineProperty(textarea, "value", {
      configurable: true,
      get() {
        return native.get.call(this);
      },
      set(next) {
        native.set.call(this, next);
        refresh();
      }
    });
  }
  textarea.addEventListener("input", refresh);
  textarea.addEventListener("scroll", sync);
  if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(textarea);
  refresh();
  return refresh;
}
