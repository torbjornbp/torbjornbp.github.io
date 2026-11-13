// The chord diagram shared by Heatmaps (co-production countries) and
// People › Roles (roles held by the same name). The caller sizes the chart,
// picks the colours and writes the text; this draws the arcs, ribbons and
// labels and makes every mark readable by hover, keyboard focus and tap.

import * as ui from "./ui.js";

const REST_FILL = 0.72;
const REST_STROKE = 0.9;

// parent: a d3 selection to draw into (an empty <g> or <svg>).
// options:
//   matrix       square, symmetric counts; the diagonal is ignored
//   centre       [x, y] of the circle within parent
//   outer        outer arc radius; the arcs are 14px deep
//   fills        colour per index
//   arcStroke    optional colour per index for the arc edge (default surface)
//   labels       full label per index; drawn truncated to labelChars
//   labelChars, fontSize
//   arcTitle(index), arcBody(index), ribbonTitle(chord), ribbonBody(chord)
//   onActivate   optional; makes ribbons buttons that call it with the chord
//   onRest       optional; restores the highlight when the pointer or focus
//                leaves a mark (default: every ribbon at rest)
// Returns { ribbons, fade(keep), rest() }.
export function drawChord(parent, options) {
  const {
    matrix, centre, outer, fills, labels,
    labelChars = 20, fontSize = 11,
    arcTitle, arcBody, ribbonTitle, ribbonBody,
    arcStroke = () => "var(--surface)",
    onActivate = null
  } = options;
  const inner = outer - 14;
  const chords = d3
    .chord()
    .padAngle(Math.min(0.04, 10 / inner))
    .sortSubgroups(d3.descending)
    .sortChords(d3.descending)(matrix);
  const arc = d3.arc().innerRadius(inner).outerRadius(outer);
  const ribbon = d3.ribbon().radius(inner - 1).padAngle(0.002);
  const chart = parent.append("g").attr("transform", `translate(${centre[0]},${centre[1]})`);

  let ribbons = null;
  const fade = (keep) => {
    if (!ribbons) return;
    ribbons
      .attr("fill-opacity", (chord) => (keep(chord) ? 0.85 : 0.06))
      .attr("stroke-opacity", (chord) => (keep(chord) ? 0.9 : 0.1));
  };
  const rest = () => {
    if (ribbons) ribbons.attr("fill-opacity", REST_FILL).attr("stroke-opacity", REST_STROKE);
  };
  const onRest = options.onRest || rest;

  const inspect = (selection, keep, title, body, activate) => {
    selection
      .attr("tabindex", 0)
      .attr("role", activate ? "button" : "img")
      .attr("aria-label", (entry) => `${title(entry)}: ${body(entry)}.`)
      .on("mouseenter", (event, entry) => {
        fade(keep(entry));
        ui.showTooltip(event, title(entry), body(entry));
      })
      .on("focus", (event, entry) => {
        fade(keep(entry));
        // Focus has no pointer, so the tooltip anchors to the mark itself.
        ui.showTooltip(ui.elementPoint(event.currentTarget), title(entry), body(entry));
      })
      .on("mousemove", ui.moveTooltip)
      .on("mouseleave blur", () => {
        onRest();
        ui.hideTooltip();
      })
      .on("click", (event, entry) => {
        event.stopPropagation();
        if (activate) {
          activate(entry);
          return;
        }
        // A tap: show what hover would.
        fade(keep(entry));
        ui.showTooltip(event, title(entry), body(entry));
      });
    if (activate) {
      selection.on("keydown", (event, entry) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(entry);
        }
      });
    }
    return selection;
  };

  // Arcs come first so the tab order runs arc by arc, then ribbon by ribbon.
  const groups = chart
    .append("g")
    .attr("class", "chord-groups")
    .selectAll("g")
    .data(chords.groups)
    .join("g");
  groups
    .append("path")
    .attr("class", "chord-arc")
    .attr("d", arc)
    .attr("fill", (group) => fills[group.index])
    .attr("stroke", (group) => arcStroke(group.index))
    .attr("stroke-width", 1)
    .call(
      inspect,
      (group) => (chord) => chord.source.index === group.index || chord.target.index === group.index,
      (group) => arcTitle(group.index),
      (group) => arcBody(group.index),
      null
    );

  ribbons = chart
    .append("g")
    .attr("class", "chord-ribbons")
    .selectAll("path")
    .data(chords)
    .join("path")
    .attr("class", "chord-ribbon")
    .attr("d", ribbon)
    .attr("fill", (chord) => fills[chord.source.index])
    .attr("stroke", (chord) => fills[chord.source.index])
    .attr("stroke-width", 0.5)
    .call(inspect, (chord) => (other) => other === chord, ribbonTitle, ribbonBody, onActivate);
  rest();

  // Labels run outwards from their arc and flip on the left half so they
  // never read upside down. Arcs too thin for a label stay unlabelled.
  groups
    .filter((group) => (group.endAngle - group.startAngle) * outer >= fontSize * 0.9)
    .append("text")
    .attr("class", "heat-label chord-label")
    .each((group) => {
      group.angle = (group.startAngle + group.endAngle) / 2;
    })
    .attr("dy", "0.35em")
    .attr(
      "transform",
      (group) =>
        `rotate(${(group.angle * 180) / Math.PI - 90})` +
        `translate(${outer + 6})` +
        (group.angle > Math.PI ? "rotate(180)" : "")
    )
    .attr("text-anchor", (group) => (group.angle > Math.PI ? "end" : null))
    .style("font-size", `${fontSize}px`)
    .text((group) => ui.truncate(labels[group.index], labelChars));

  return { ribbons, fade, rest };
}
