# Testing the Room Climate Card

The Room Climate Card installs directly into live dashboards; there is no staging environment
between a commit and the people running it. The suite is therefore written to be cheap enough
to run on every change, and it is the release gate.

Two commands cover almost everything:

```bash
npm test
```

Builds the bundle, checks it parses, runs every Node test, then every browser test. It has to
pass before a commit; [Known defects](#known-defects) describes how that requirement is kept
while a defect is knowingly left unfixed.

```bash
npm run test:node
```

The non-browser half: build plus every Node layer. Use `npm run test:unit` only for the direct
ES-module unit layer; its name is deliberately narrower than `test:node`.

Install the browser binaries once with `npm run test:install`. The command installs Chromium,
Firefox and WebKit without trying to mutate operating-system packages; CI runner images own
their system dependencies. A `spawn UNKNOWN` when a project starts means that engine arrived
only partly — run the installer again rather than reading it as a browser the card cannot
support.

## The layers, and what a failure in each one means

Where a test lives is a claim about what it may touch, and that claim is what makes a failure
locatable. `test/architecture/suite-structure.test.js` enforces every rule below.

| Directory | What it may do | A failure here means |
|---|---|---|
| `test/unit/` | imports `src/` modules **directly**, never loads the bundle | a function computes the wrong thing |
| `test/component/` | loads the built bundle in jsdom, drives the assembled card | the card behaves wrongly, though every part may be right |
| `test/contract/` | the promises made to the outside world: custom element, registration, distribution artifact, safety | something users or Home Assistant depend on has changed |
| `test/architecture/` | the layering rules `src/` obeys, and the rules this suite obeys | the design has eroded, even though everything still works |
| `test/characterization/` | frozen recordings of what the card produced | something **changed**; whether that is a bug is for you to decide — see [POLICY.md](test/characterization/POLICY.md) |
| `test/property/` | generated populations, the invariants that hold over all of them, and the relations that hold between two cards | an input nobody thought of breaks something, or the card discards data it could have used |
| `test/browser/` | real browser engines; Chromium owns the complete suite, Firefox and WebKit own a defined core | real geometry, fonts, pointers, pixels or the cross-engine public surface disagree |

`test/unit/` and `test/component/` are subdivided further — by `src` layer and by concern
respectively — so that a directory listing is a map rather than an inventory.

Shared material lives in three directories and is never a test itself:

- `test/manifests/product-surface.js` — the **one** hand-written statement of what the card
  supports: fifteen languages, four metrics, four views, the palette keys. Generic matrices
  import it; a curated subset (five typographically extreme languages, say) stays local and
  says in a comment that it is curated.
- `test/fixtures/scenario.js` — the scenario builder. One way to describe a card situation, for
  every layer, including the environment around it: which timestamps a sensor reports, which
  fields `hass` arrives without, which theme it declares.
- `test/fixtures/attributes.js` — the named attribute pairs, derived from the product surface
  rather than restated. A fixture that is deliberately WRONG — a thermometer reporting
  hectopascals — keeps its literal, because naming it would hide the thing its test is about.
- `test/helpers/` — the jsdom harness, the fake platform, colour measurement, browser helpers.

## Running part of it

```bash
npm run test:file -- test/unit/domain/palette-fit.test.js
npm run test:name -- "the verdict changes exactly once" test/unit/domain/palette-fit.test.js
npm run test:unit
npm run test:component
npm run test:contract
npm run test:architecture
npm run test:characterization
npm run test:property
npm run test:known-issues
npm run test:browser:accessibility
npm run test:browser:core
npm run test:browser:geometry
npm run test:browser:interaction
npm run test:browser:visual
npm run test:browser:cross-engine
npm run test:browser:file -- test/browser/visual/visual-golden.spec.js
npm run test:browser:ui
```

`test:file` and `test:name` take anything `node --test` takes, so a directory glob works too.
Each public layer command builds first. The matching internal `*:run` command skips that build
and exists for a pipeline that already produced its own bundle. `test:browser:ui` opens
Playwright's inspector, which is the fastest way to understand a geometry failure.

When a Node test fails, the reporter prints the message, the expected/actual comparison, the
cause of a wrapped error, a trimmed stack, the full nested suite path, and anything the run
wrote to stderr. Explicit `undefined` values remain visible in comparisons. If you still need
more, `npm run test:node:verbose` uses Node's own reporter.

## Writing a test

**Build the situation with the scenario builder.** It is the same description the property
generator emits, which is what makes a randomly found failure directly reusable as a fixture.

```js
const { scenario } = require("../../fixtures/scenario.js");

const built = scenario().temperature().rooms(3).unit("°F").primaryUnavailable().build();
env.withCard(built.config, built.hass, (card) => {
  assert.equal(card._computeViewModel().empty, false);
});
```

`withCard` cleans up even when the body throws, which the manual create/cleanup pair does not —
and a leaked card keeps its timers running into the next test.

Existing tests often write entity attributes out by hand instead. That is fine where the test
is *about* those exact attributes; prefer the builder for everything else, and do not rewrite
old tests wholesale just to adopt it.

Put a test under the owner whose failure it explains, and open the file with a header that
says what it covers — and, where it was split out of a larger file, where its boundary to the
neighbour runs. That header is enforced as a floor of four comment lines, because a split file
inherits none of the reason it exists apart from its neighbour and the next reader cannot
recover that reason from the code.

Cohesion, dependency direction and ownership determine whether a file should be split; line
counts and arbitrary size targets do not. Beyond the header floor, the architecture suite
enforces directory and dependency contracts, not stylistic quotas.

## The property layer

`test/property/` throws randomly described dashboards at the card the way a person tries
things by hand, several hundred times, with the results actually checked.

Everything a person can write in YAML is generated, and can be generated slightly wrong:
values, units (every unit Home Assistant's sensor device classes list, plus units from no
domain at all), device classes, **attribute names**, availability, room counts, mixed units,
palettes in every shape, view lists, view options, actions, subtitles, classification
overrides, and misspellings of all of them.

So is the environment the card runs in: entity ids Home Assistant would never issue,
timestamps that are missing or in the future, extra attributes in their awkward shapes, a
`hass` object arriving without its locale or with an empty `states`, and the same sensor
configured both as the average and as a room.

The weights live in one place (`generators.js`), and `generators.test.js` measures the realised
distribution against them. The measurement is what makes the run mean anything: a property test
can pass five hundred iterations while checking nothing, if every card it builds lands in the
no-data state and its invariants sit behind an `if (!data.empty)` that never runs. The run
therefore asserts what its own population looks like and fails if that population stops being
worth testing — including the two guards for the quieter version of the same problem: every
declared weight table has to be drawn from, and every optional configuration key has to appear
somewhere in the population.

### Two cards, not one

`metamorphic.js` asks a different question. Every invariant above looks at **one** card and
asks whether it is self-consistent, which finds a card that is *wrong* — not one that is merely
*poorer than it should be*, because "poorer" is a comparison and there was nothing to compare
against.

Each relation derives a **sequence** of configurations from one description, applies them to a
single card, and states what may have moved between the first card and the last: a room the
card cannot use changes nothing else; taking a source away removes that source and no other;
giving it back restores exactly what was there; the order of `rooms:` does not change what they
say; the same readings in another unit describe the same rooms; the same configuration applied
twice changes nothing.

The preconditions are the careful part. A relation that quietly applies where it has nothing to
say reports correct behaviour as a defect, which is worse than no test — so each says what it
needs and why, and the runner **fails if a relation never applied at all**. A relation excluded
by a wrong precondition looks exactly like one that holds.

### What the card picker finds

`discovery.js` generates whole Home Assistant installations instead of cards: areas in the
order the user arranged them, devices (some nested under a parent), zero to five sensors of
each measurement — declared, misspelled, undeclared or foreign, usable or not, named or not,
placed in an area or not, hidden or diagnostic — and distractors such as batteries reporting
`%`. For each, the browse path's start configuration must be rooms only, one to three of them,
of one measurement, never a distractor, named all by area or all by `friendly_name`, the same
whatever order the installation arrived in, unchanged by one more distractor, and chosen by
the priority rule over each measurement taken alone; found usable rooms are then rendered in
the built card, which must show a value without a warning. The run fails when its census —
template, one, two or three rooms, area or sensor names, each measurement — leaves its bands.
`discovery.test.js` measures the generator against `DISCOVERY_WEIGHTS`, and a failure prints the
minimized installation as JSON for `installation(…)` in `test/fixtures/installation.js`.

```bash
npm run test:property                                            # all three deterministic runs
ROOM_CLIMATE_CARD_FUZZ_CASES=25000 npm run test:property:run         # a real model sweep
ROOM_CLIMATE_CARD_METAMORPHIC_CASES=15000 npm run test:property:run  # a real metamorphic sweep
ROOM_CLIMATE_CARD_DISCOVERY_CASES=20000 npm run test:property:run    # a real card-picker sweep
```

The counts are separate because a metamorphic case builds the card at least twice and costs
about three times a model case — measured at 48 ms against 15 ms. `ROOM_CLIMATE_CARD_DISCOVERY_SEED`
replays a card-picker population.

A failure prints a **locally minimized** case as lossless JSON, including values such as
`NaN` and `-0`. The shrinker accepts a candidate only when it reproduces the same exact unknown
violation signature, and verifies the final candidate again. Paste that description into
`scenario(…)`; keep the reported seed to replay the complete population as well.

A large sweep also runs [weekly in CI](.github/workflows/property.yml). Its default seeds come
from the workflow `run_id`: rerunning the same workflow is stable, while a new weekly run
explores a new population. A manually supplied seed always wins. Each sweep publishes JSON
reports with its seed, case count, outcome census, applied metamorphic relations and observed
known defects.

## Browser matrix

`npm run test:browser` runs the complete Playwright matrix:

- Chromium runs all `core`, `interaction`, `geometry`, `accessibility` and `visual` specs.
- Firefox and WebKit run only `availability`, `public-surface-smoke` and `source-modes` from
  `test/browser/core/`.

The smaller cross-engine scope checks public registration and source modes without pretending
that one browser's pixel geometry is another's. Golden screenshots and pixel geometry remain
Chromium-owned. `playwright.config.js` fixes the worker count at two and uses no global retry;
the few timing tests that justify a retry own and explain it locally.

## Golden screenshots

The PNGs under `test/browser/visual/visual-golden.spec.js-snapshots`, compared with an absolute
budget of 200 differing pixels. Absolute rather than a ratio on purpose: rendering noise does
not scale with image area, while a ratio gives a large screenshot a thousand-pixel allowance —
wide enough to hide a caption the card has stopped drawing.

Re-record with `npx playwright test --update-snapshots=all`, then **look at every changed
image**. Never widen the budget to make a diff go away.

Calibration specs attach their generated image to the Playwright report with
`testInfo.attach()` rather than writing a temporary file: open the report artifact and inspect
the attachment.

## Coverage

`npm run coverage` builds the bundle once with an inline source map, measures four independent
layers and then merges them:

| Layer | Tests | What runs |
| --- | --- | --- |
| `unit` | `test/unit/` | `src/` modules imported directly |
| `bundle` | `test/component/`, `test/known-issues.test.js` | the built bundle in jsdom, plus any `src/` module a test imports |
| `surface` | `test/contract/`, `test/property/`, `test/characterization/`, `test/fixtures/` | the same, driven from outside: registration, artifact, generated populations, recordings |
| `browser` | the Chromium suite | the built bundle in a real browser, collected by the shared Playwright fixture |

`test/architecture/` is the one unmeasured directory: it reads sources as text and never runs
the card. `test/architecture/coverage-layers.test.js` fails when a Node test directory belongs
to no layer, so a new one cannot drop out of the measurement unnoticed.

Every report is normalized to `src/`; `dist/` is never presented as a product source. c8
reports the `src/` modules a test imports; the bundle, which the tests evaluate with `vm`, is
remapped to `src/` from the raw V8 coverage c8 keeps in `coverage/raw-<layer>/v8/` — c8's own
remapping of it (`--exclude-after-remap`) counts every bundled line as covered. The Node layers
run with fixed settings: property runs at their default counts and seeds, no baseline is
rewritten, and the artifact tests judge `dist/` without the coverage source map. Each layer and
the merge write LCOV, JSON and a text summary under `coverage/`.

Before it reports anything, the merge runs two checks. The INVENTORY: every `.js` file under
`src/` has to appear in each layer and in the merge, and the run fails naming the files if one
does not. The reason is how Istanbul reports: it covers only the files it was handed, so a
module no layer executed does not show up as 0 % — it does not show up at all, and every
percentage below it is then computed over a smaller product than the one that ships. And
EXECUTION: every layer that loads the bundle has to show `src/index.js` and
`src/element/room-climate-card.js` executed, and a function of the card element called — both
files are reachable only through the bundle, and every such layer creates cards, so a layer
that lost the bundle's coverage, or counts its lines without mapping its functions, fails by
name instead of reporting a quietly wrong number. The merge then enforces the calibrated floor of 99% statements, 98% branches, 99%
functions and 99% lines; branches sit a point lower because a few timing-dependent tests take
a different branch from run to run. CI uploads the complete folder.

## Mutation testing

A mutation test changes one thing in the product code on purpose and runs the tests. If the
mutant lives, no test noticed the difference: the line was executed but not checked.

`npm run test:mutation:dry-run` validates the runner; `npm run test:mutation` mutates only the
critical classification boundary, metric-resolution and aggregate modules named in
`stryker.config.mjs`. The scope is narrow on purpose — the command runner has no per-test
coverage to narrow the work with, so a wide scope buys running time rather than answers.

**The floor is 100%.** Anything lower cannot tell a provably equivalent mutant from one that
was simply never tested, so it would pass the next real survivor as readily as the known ones.
Exactly one mutant is excused, by name, at the line it sits on and for one mutator only, with
the argument written beside it; every other mutation of that same line still has to die.
Weekly CI publishes the JSON and HTML reports under `reports/mutation/`.

## Known defects

The suite is green at every commit. Once a red run is normal, a new regression cannot be told
apart from an old one everybody has agreed to live with, and the suite stops being a gate.

A defect that is understood, reproduced and deliberately not fixed yet is registered in
`test/known-issues.js` and reproduced in `test/known-issues.test.js` through
`expectedFailure()`, which requires the reproduction to **fail**. The run stays green and the
defect stays documented in executable form. The register cannot go stale either: **if the
reproduction ever passes, the run fails** and tells whoever fixed the defect to close the entry
and promote the reproduction to an ordinary test.

`test/known-issues.js` is the list of what is known to be wrong and deliberately left that
way.

## Trying a change in your own Home Assistant

```bash
npm run build:dev
```

Builds `dist/room-climate-card-dev.js`: the same card under a development identity, so it loads
as a second dashboard resource beside the released card instead of replacing it. It registers
`custom:room-climate-card-dev`, appears in the card picker as "Room Climate Card (Dev)", sets
`window.roomClimateCardDevVersion` and announces its version once in the browser console. The
version is the package version plus `-dev+`, a UTC build stamp, the commit, and `.dirty` when the
working tree has uncommitted changes.

1. Copy the file into your Home Assistant `www/` folder.
2. Add it as a JavaScript module resource (Settings → Dashboards → the three-dot menu →
   **Resources**) with the URL the command prints, e.g.
   `/local/room-climate-card-dev.js?v=20260912T112621Z`. After each new build, replace the file
   and change only the `?v=` value, so the browser cannot serve the previous build from its cache.
3. Use `type: custom:room-climate-card-dev` in a test card.

Remove the resource and the file when you are done. Apart from its identity
(`src/core/card-metadata.js`), its banner and the console line, the file is the product bundle
byte for byte; `test/contract/dev-build.test.js` holds that, and holds both cards registering side
by side. It is never a release asset and never committed.

## Continuous integration

[`ci.yml`](.github/workflows/ci.yml) runs two independent jobs on every push and pull request —
Node tests and browser tests — deliberately without `needs:` between them, because a failure in
one says nothing about the other. Both build the bundle themselves, so no job can report green
against an artifact it did not produce. The browser job installs all three engines, runs the
complete Chromium suite while collecting source-normalized coverage, then runs the defined
Firefox/WebKit core without repeating Chromium. It always keeps both coverage and Playwright
reports.

[`property.yml`](.github/workflows/property.yml) sweeps both large generated populations and
runs the narrow mutation scope once a week. It can be started by hand with a case count and
optional seed for each property population.
