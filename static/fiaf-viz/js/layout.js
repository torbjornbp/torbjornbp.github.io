// Off-main-thread force layouts for the network views.
//
// Settling thousands of nodes takes seconds, so a view hands a pure "settle"
// function and its input to a worker and keeps the page responsive meanwhile.
// The worker is built from the function's own source text, so a settle
// function may only use its arguments: (d3, input, report) => result. It may
// call report(partial) with interim positions while it settles, so a view can
// draw the graph filling in instead of waiting for the final layout. Without
// worker support, or if the worker fails to start, it runs on the main thread
// (without interim reports).

// The largest radius grows with the graph. Credits are heavily skewed (in a
// 10,000-name graph the median name has a handful of links and the busiest
// hundreds), and a fixed 3x range left the busiest name barely larger than the
// rest once thousands of nodes share the screen. From about 400 nodes the
// ceiling rises with the square root of the node count, up to three times.
export function maxRadiusFor(nodeCount, base) {
  return base * Math.min(3, Math.max(1, Math.sqrt((Number(nodeCount) || 0) / 400)));
}

// Zoomed out, nodes shrink with the square root of the zoom instead of the
// zoom itself, so the busiest names stay visible in a fitted view of thousands
// of nodes. Multiply a node's radius (in graph units) by this to draw it.
export function zoomedRadiusFactor(k) {
  return k > 0 && k < 1 ? 1 / Math.sqrt(k) : 1;
}

const workerUrls = new Map();

function workerUrl(settle) {
  if (!workerUrls.has(settle)) {
    const d3Url = new URL("../vendor/d3.v7.min.js", import.meta.url).href;
    const source =
      `importScripts(${JSON.stringify(d3Url)});\n` +
      `const settle = ${settle.toString()};\n` +
      "const buffers = (value) => Object.values(value).filter((entry) => entry && entry.buffer)\n" +
      "  .map((entry) => entry.buffer);\n" +
      "self.onmessage = (event) => {\n" +
      "  const report = (partial) => self.postMessage({ progress: partial }, buffers(partial));\n" +
      "  const result = settle(self.d3, event.data, report);\n" +
      "  self.postMessage({ result }, buffers(result));\n" +
      "};\n";
    workerUrls.set(settle, URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  }
  return workerUrls.get(settle);
}

// Resolves to settle's result, or to null when the signal aborts first.
// `inline` runs small layouts on the main thread, where a worker's start-up
// would cost more than the layout itself. `onProgress` receives the worker's
// interim reports.
export function runLayout(settle, input, { signal, inline = false, onProgress } = {}) {
  const here = () => settle(d3, input, null);
  if (signal && signal.aborted) return Promise.resolve(null);
  if (inline || typeof Worker !== "function" || typeof Blob !== "function") {
    return Promise.resolve(here());
  }
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(workerUrl(settle));
    } catch (_) {
      resolve(here());
      return;
    }
    const finish = (result) => {
      worker.terminate();
      if (signal) signal.removeEventListener("abort", cancel);
      resolve(result);
    };
    const cancel = () => finish(null);
    worker.onmessage = (event) => {
      if (!event.data.progress) {
        finish(event.data.result);
        return;
      }
      if (onProgress && !(signal && signal.aborted)) onProgress(event.data.progress);
    };
    worker.onerror = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      finish(signal && signal.aborted ? null : here());
    };
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    worker.postMessage(input);
  });
}
