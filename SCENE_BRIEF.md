# SCENE BRIEF — "The Wizard's Feast" (3D interactive invitation)

**Deliverable**: one self-contained static page (`index.html` + local `assets/`), no build step, no framework — plain HTML/CSS/JS + Three.js. It must work served over HTTP (not file://), on desktop and mobile. It lives at `/invitation2/` on a Hugo site and is deployed by pushing to `main`.

**Concept**: a dark, mysterious dungeon study with a wizard's workbench. The wizard is preparing a dinner party: an unrolled invitation scroll, an open recipe tome, and a small cauldron of glowing green brew. Viewer can look around slightly, zoom, and click objects to glide the camera to them and read them in-scene. Mood: old-school dungeon RPG (Legend of Grimrock), stylized hand-painted look. Interaction feel reference: henryheffernan.com (fixed cinematic camera, eased camera flights to hotspots). Aesthetic reference: "Props: Brewing Station" by Théo Jacquemin (warm candle/brew glow vs cool moonlight, copper pots, hanging herbs, glowing bottles, clutter).

## Tech requirements

- Three.js r170, vendored locally in `assets/lib/` (three.module.js + only needed addons: GLTFLoader, post-processing). No CDN dependency.
- Import map pointing `three` and `three/addons/` at local files.
- `EffectComposer`: RenderPass → UnrealBloomPass → custom grade ShaderPass (teal-tinted shadows, warm highlights, vignette, film grain, chromatic aberration) → OutputPass. ACES tone mapping.
- All user-facing text in ONE `COPY` object at the top; recipes in ONE `RECIPES` array (`[{title, serves, ingredients[], steps[], note}]`) — the owner will paste real recipes later.
- Loading veil with progress bar (LoadingManager) and an "Enter the hall" button (required for audio autoplay policies). Every model/texture failure must fall back to a simple procedural primitive, never break the page.
- Mobile: `pointer events`, tap = click, one-finger drag = look, two-finger pinch = zoom, `devicePixelRatio` capped (1.5 mobile / 2 desktop), fewer lights on mobile, adaptive DPR drop if fps < 26. `touch-action: none` on the canvas. Loading target < ~3 MB, 30+ fps on mid phones.

## Scene layout (concrete numbers)

Room: 8.4 × 7.2 m floor, 4.6 m ceiling. Origin near the bench. Bench back wall at z = −3.6; camera/door side at +z. Floor flagstone, walls stone brick, ceiling planks with wooden beams (ambientCG PBR sets, 512px, color/normal/roughness/AO; tint materials cooler/darker to keep the scene moody).

- **Workbench**: 3.3 wide × 1.05 deep × 0.98 high, centered back at (0, 0, −1.9). Heavy timber legs/apron, worn stone slab top, lower storage shelf, sacks and a stew pot under it.
- **Cauldron** (small, ~0.72 m tall) ON the bench at (−0.75, benchTop, −1.9). Dark copper/bronze. Animated brew surface INSIDE it (see pitfalls). Wooden-handled copper ladle leaning against it.
- **Scroll (invitation)**: unrolled parchment 0.66 × 0.4 m lying on the bench front-center at (0.32, benchTop, −1.63), wooden rods at both ends, red sealing wax. The actual invitation text is rendered onto the parchment as a canvas texture (see "Scroll").
- **Tome**: large open book (two pages, each 0.36 × 0.47 m) on a small wooden reading stand on the bench right side at (0.95, benchTop, −2.14), tilted ~12° toward the reader. NO glow on the pages. A candle nearby. (see "Tome")
- **Skull** on the bench far left (−1.42, benchTop, −1.75) with two candles, one melted onto its cranium.
- Bench clutter: mushrooms, mortar & pestle, honey jar, glowing green potion vial, bread loaf, cheese wedge, apple, wooden bowl with tomato/onion/egg. All small, dense, cozy — but NOTHING may overlap the scroll's 0.7 × 0.45 m footprint or block the reading sightlines.
- **Back wall**: two wooden shelves (y 1.6 and 2.5) crowded with bottles/jars/pots; two or three potion vials with subtle colored emissive liquid (purple/blue/amber); a banner; a string of hanging herb bundles; a small barred window slit (x ≈ −2.2, y ≈ 3.0) with a cool moonbeam shaft cutting across the room.
- **Above the bench**: iron pot rack (bar at y ≈ 4.2) with two hanging copper pots and herb bundles — must be ABOVE the overview camera height so it never blocks the view.
- **Floor**: faint glowing rune circle (canvas texture, additive, slow rotation, gentle pulse) beneath the bench; a slowly bobbing, slowly rotating floating crystal (octahedron, green emissive, halo sprite) ~0.6 m above the cauldron.
- **Sides/corners**: chest, crates, barrels, floor produce (cabbage, carrots), cobwebs in top corners, dust motes drifting in the light, 2–4 wall torch sconces with flickering flames + faint additive light cones.
- **Lighting** (≤ ~10 lights total; fewer on mobile): dim cool ambient + hemisphere, warm point key light above the bench, cool spot from the window, green point light in the brew, warm candle/sconce points (flicker with layered sines), soft light over the tome while reading. Target: warm highlights, teal shadows, magical green accents.

## Camera system

- Fixed cinematic poses; smooth eased flights between them (cubic ease-in-out, ~1.8 s, lerp position + lookAt + fov).
- **Overview**: high and close — declination 35–45°, ~2.5–3.5 m from the bench, fov ~52. You see the full tabletop and the tops of props (cauldron rim, bottle caps), not their sides. Slight idle sway (disabled by prefers-reduced-motion), mouse parallax (±a few degrees), wheel/pinch zoom (bounded), one-finger drag look on touch.
- **Per-hotspot poses**: same 35–45° top-down bias; reading poses ~1 m from the parchment/book so text is clearly legible; in portrait/phone aspect, pull the reading camera higher/backer so both pages fit.
- "Back to the hall" button (and Escape) returns to overview.

## Hotspots & interactions

- Hover (desktop): cursor pointer + label glow on a small floating marker dot projected above each object. Markers hidden while focused.
- Click/tap a hotspot → camera glides to it:

1. **Scroll** → the invitation is read in-scene (no popup, ever). The full text (title, ruled border, body lines, signature, wax seal) is drawn onto the parchment canvas texture, redrawn after `document.fonts.ready` so real fonts render. Clicking just glides the camera down over it.
2. **Tome** → no popup. Clicking glides the camera over the open book and the pages turn as real 3D geometry: a two-sided "leaf" plane (front = current right page, back = next left page) pivots on the spine 0 → −180° with an arc lift, easing ~0.7 s, then the static page textures swap. Controls: on-screen ‹ › buttons (bottom center), arrow keys, and tapping the left/right page in the 3D view. Page counter "2 / 5". First spread is an intro (title + flavor). While reading: bloom strength eases down (~0.2) and grain down so text is crisp, a soft light over the book brightens, then restore on exit. Each recipe = one spread: left page = title/serves/ingredients, right = numbered steps + note. Page textures 512 × 668 canvas, parchment background, ink text with word-wrap helper.
3. **Cauldron** → camera glides close; brew flares (bubble burst + light spike + sound).
4. **Skull** → camera glides close; flavor toast easter egg ("Not another dinner party…").

- Flavor toasts bottom-center; stingers on focus.

## Brew effect (must be correct — see pitfalls)

Custom ShaderMaterial disc: polar FBM swirl (4 octaves of hash noise), color ramp deep green → bright mint, glowing rim, alpha fade at edge; ~30 rising additive bubble points; 5–6 faint steam sprites; pulsing green point light. The disc must be anchored to the model's liquid surface and sized to the pot's opening.

## Audio (procedural WebAudio, starts on Enter click, mute button)

Low drone (detuned sines through slow-LFO lowpass), room air (looped noise, bandpass, slow gain LFO), fire crackle (scheduled filtered-noise bursts), random drips, and one-shots: bell on focus, page-turn swish, brew flare sweep, per-hotspot stinger notes.

## Assets (all CC0)

- Kenney kits (direct zip URLs on kenney.nl asset pages, extract `Models/GLB format/`): pirate-kit (barrel, bottle, bottle-large, crate, chest), castle-kit (flag-banner-long/short), fantasy-town-kit (pillar-stone, lantern), mini-dungeon (potion, pot, coin), food-kit (loaf, cheese-cut, mortar-pestle, honey, apple, bread, mushroom, tomato, onion, egg, carrot, cabbage, bottle-oil, pan-stew, bag), furniture-kit (books.glb — self-contained, no external texture).
- IMPORTANT GLB quirks: Kenney GLBs reference an external palette `Textures/colormap.png` — keep the folder structure `<pack>/<model>.glb` + `<pack>/Textures/colormap.png`. Banner cloth faces ±X by default (rotate for north walls). Always normalize: measure `Box3`, scale to target height, ground on target surface, then re-center horizontally at the placement point (GLB origins are often off-center). Check aspect ratio BEFORE stretching (a "pillar" model may be a squat block — non-uniform scaling to a column looks stretched; pick a model whose native proportions fit the job).
- cauldron/scroll models: any CC0 pot-and-scroll GLBs (Poly Pizza model pages expose the direct `static.poly.pizza/<id>.glb` URL in their HTML). Cauldron should be small (~0.7 m), scroll is better built procedurally (plane + rods + wax + canvas-text).
- ambientCG 1K PBR sets (Bricks091 walls, Bricks075A floor, Planks023A ceiling), downscaled to 512 JPG (~80 quality), used with color multiply tints.
- All copy in English (owner will translate).

## Known pitfalls (learned from a previous implementation — don't repeat)

1. **Blooming parchment**: paper is the brightest surface in a dark room — it exceeds the bloom threshold and text turns to glowing fuzz. Keep paper textures at ≤ ~60% brightness (e.g. #cbb78d), set bloom threshold ≥ 0.75, and reduce bloom strength while reading. Test: paper must NOT trigger bloom; only flames/brew/crystals should.
2. **Floating brew disc**: don't derive the brew disc's position from the model's max height (handles/rims lie). Anchor it to the liquid surface mesh's actual height, and size it to the pot's inner opening — an oversized disc shows a glowing rim ring hovering around the soup like a flying saucer.
3. **Stuff hovering in the air**: keep glow sprites and steam rooted AT the rim — no glow ball 0.5 m above the pot; steam rises ≤ 0.5 m at low opacity. Only intentionally-floating things (the crystal) may hover.
4. **Sightline blocking**: a candle or prop between the reading camera and the book/scroll makes it unreadable or "clipping". After placing every prop, ray-test from each reading pose to the text surface and clear anything in the path. Keep the book's stand SMALLER than the book so no wood pokes out around the pages ("book clipping into a shelf").
5. **Scroll footprint**: nothing may overlap the scroll — a ladle lying across the parchment ruins it. Define each prop's footprint and check against the scroll's 0.7 × 0.45 m.
6. **Model placement math**: ground/recenter after ALL rotations (rotation about a non-centered origin displaces the model); verify Kenney external palettes load (missing colormap.png = untextured white models).
7. **Verification without a GPU sandbox**: run a Node dry-run that stubs the renderer and fake DOM/canvas, executes the full scene construction + animation ticks, and asserts construction; parse every GLB with the real GLTFLoader; check every asset URL serves 200; confirm Hugo output is byte-identical. (CI sandboxes often lack WebGL — don't rely on headless screenshots.)

## Acceptance checklist

- Loads under ~3 MB, progress veil, Enter button → scene, ambience starts, mute works.
- Overview: bench fills frame, tops of props visible, 35–45° declination, drag/zoom/touch all smooth.
- Scroll: click → glide → invitation readable on the parchment; no popup.
- Tome: click → glide → both pages crisp and readable; page turns are 3D flips with sound; counter correct; bloom/grain drop while reading; works with ‹ ›, arrows, and tapping pages; recipes replaced by pasting into the RECIPES array.
- Cauldron: brew swirls INSIDE the pot; flare on click. Skull: flavor toast.
- Mobile: tap/pinch/drag work, no layout overflow, 30+ fps on a mid phone.
- No console errors; every failed asset falls back gracefully.
