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
