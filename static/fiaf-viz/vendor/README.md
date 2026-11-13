# Vendored assets

## `world-countries-50m.geojson`

A reduced copy of **Natural Earth v5.1.2, Admin 0 Countries, 1:50m**. It is
vendored so the world map works without a CDN or a build step.

- Source: <https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson>
- Version: Natural Earth 5.1.2 (1:50m)
- Licence: public domain. See <https://www.naturalearthdata.com/about/terms-of-use/>.
- Reduction: feature `id` is `ISO_A3_EH`, falling back to `ADM0_A3` when
  `ISO_A3_EH` is `-99`; `properties.name` is `NAME_EN` or `NAME`; geometry
  coordinates are rounded to three decimal places. Dependency polygons that
  share a sovereign state's ISO code are collapsed in favour of the country
  polygon so feature ids stay unique.

Rebuild it from the source URL with:

```bash
python3 scripts/build_world_map.py
```

The script also accepts `--source` for a local source file and `--output` for a
different destination.

## `fonts/schibsted-grotesk-*.woff2`

**Schibsted Grotesk** (variable: weight 400–900), the Latin and Latin Extended
subsets as served by Google Fonts (v7). Self-hosted so the page has no font CDN
dependency; other scripts fall back to the system UI font.

- Source: <https://fonts.google.com/specimen/Schibsted+Grotesk>
- Licence: SIL Open Font License 1.1, see `fonts/OFL.txt`.

## `fonts/jetbrains-mono-*.woff2`

**JetBrains Mono** (variable: weight 100–800), the Latin and Latin Extended
subsets as served by Google Fonts. The data and display face: view titles,
headline figures, labels, identifiers and table numbers.

- Source: <https://www.jetbrains.com/lp/mono/>
- Licence: SIL Open Font License 1.1, see `fonts/OFL-JetBrainsMono.txt`.
