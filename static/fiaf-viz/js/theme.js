// Light/dark theme: follows the operating system until the visitor chooses.
//
// The inline script in index.html applies a saved preference before first
// paint. This module keeps the header button in sync, persists changes and
// notifies views that draw colours outside CSS (the canvas cloud and the
// sunburst labels).

const STORAGE_KEY = "fiaf-viz:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function savedTheme() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch (_) {
    return null;
  }
}

function mediaQuery() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY)
    : null;
}

function systemTheme() {
  const query = mediaQuery();
  return query && query.matches ? "dark" : "light";
}

function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return systemTheme();
}

function updateToggle(theme) {
  const button = document.getElementById("theme-toggle");
  if (!button) return;
  const action =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  button.setAttribute("aria-label", action);
  button.title = action;
}

function announce(theme) {
  window.dispatchEvent(
    new CustomEvent("fiaf-viz:theme-change", { detail: { theme } })
  );
}

export function setTheme(theme, { persist = true } = {}) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch (_) {
      // Storage can be blocked; the theme still applies for this page.
    }
  }
  updateToggle(next);
  announce(next);
}

export function initTheme() {
  const button = document.getElementById("theme-toggle");
  updateToggle(currentTheme());
  if (button) {
    button.addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  // No explicit preference means the CSS media query owns the palette. Keep
  // the button's accessible name and canvas views in sync when the OS theme
  // changes.
  const query = mediaQuery();
  if (!query) return;
  const onChange = () => {
    if (savedTheme()) return;
    const theme = currentTheme();
    updateToggle(theme);
    announce(theme);
  };
  if (query.addEventListener) query.addEventListener("change", onChange);
  else if (query.addListener) query.addListener(onChange);
}
