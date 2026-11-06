// Shared graph helpers for the force-layout views.
//
// Edges are alpha-blended, so a dense graph turns into a solid tint long before
// every line is individually visible. Fading each line as the graph grows keeps
// the structure readable without dropping relationships.

const LINK_ALPHA_MIN = 0.04;
const LINK_ALPHA_MAX = 0.35;
const LINK_ALPHA_SCALE = 9;

// Opacity for one background edge: ~0.07 at 16k edges, ~0.12 at 6k, and the
// 0.35 ceiling for a sparse graph.
export function linkOpacity(count) {
  const number = Number(count) || 0;
  if (number <= 0) return LINK_ALPHA_MAX;
  const alpha = LINK_ALPHA_SCALE / Math.sqrt(number);
  return Math.max(LINK_ALPHA_MIN, Math.min(LINK_ALPHA_MAX, alpha));
}
