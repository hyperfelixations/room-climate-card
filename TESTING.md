# Testing the Room Climate Card

This card has more than 300 installations and no staging environment. The test suite is the
only thing standing between a change and somebody's dashboard, so it is built to be run
constantly and to be believed when it is green.

Two commands cover almost everything:

```bash
npm test
```

Builds the bundle, checks it parses, runs every Node test, then every browser test. This is
what must pass before a commit — no exceptions, and see [Known defects](#known-defects) for how
that rule survives contact with a bug nobody is fixing yet.

```bash
npm run test:unit
```

The fast half: build plus every Node test, about ten seconds. What you run while working.

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
| `test/property/` | generated populations and the invariants that hold over all of them | an input nobody thought of breaks something |
| `test/browser/` | a real Chromium, because the question needs one | real geometry, fonts, pointers or pixels disagree |

`test/unit/` and `test/component/` are subdivided further — by `src` layer and by concern
respectively — so that a directory listing is a map rather than an inventory.

Shared material lives in three places and is never a test itself:

- `test/contracts/product-surface.js` — the **one** hand-written statement of what the card
  supports: fifteen languages, four metrics, four views, the palette keys. Generic matrices
  import it; a curated subset (five typographically extreme languages, say) stays local and
  says in a comment that it is curated.
- `test/fixtures/scenario.js` — the scenario builder. One way to describe a card situation, for
  every layer.
- `test/helpers/` — the jsdom harness, the fake platform, colour measurement, browser helpers.

## Running part of it

```bash
npm run test:file -- test/unit/domain/palette-fit.test.js
npm run test:name -- "the verdict changes exactly once" test/unit/domain/palette-fit.test.js
npm run test:contracts
npm run test:property
npm run test:known-issues
npm run test:browser:file -- test/browser/visual/visual-golden.spec.js
npm run test:browser:ui
```

`test:file` and `test:name` take anything `node --test` takes, so a directory glob works too.
`test:browser:ui` opens Playwright's inspector, which is the fastest way to understand a
geometry failure.

When a Node test fails, the reporter prints the message, the expected/actual comparison, the
cause of a wrapped error, a trimmed stack, and anything the run wrote to stderr. If you still
need more, `npm run test:unit:verbose` uses Node's own reporter.

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

**Give the file a header.** Four lines minimum, and the structure test enforces it. Say what
the file covers and why it is separate from its neighbours — the second half is the part that
saves the next person from adding a fifth file for the same subject.

## The property layer

`test/property/` throws randomly described dashboards at the card the way a person tries
things by hand, several hundred times, with the results actually checked.

Everything a person can write in YAML is generated, and can be generated slightly wrong:
values, units (every unit Home Assistant's sensor device classes list, plus units from no
domain at all), device classes, **attribute names**, availability, room counts, mixed units,
palettes in every shape, view lists, view options, actions, subtitles, classification
overrides, and misspellings of all of them.

The weights live in one place (`generators.js`), and `generators.test.js` measures the realised
distribution against them. That is not ceremony: the previous property test passed five hundred
iterations while checking nothing, because every card it built landed in the no-data state and
its invariants sat behind an `if (!data.empty)` that never ran. The run now asserts what its own
population looks like, and fails if that population stops being worth testing.

```bash
npm run test:property                                   # the deterministic run, ~5 s
ROOM_CLIMATE_CARD_FUZZ_CASES=25000 npm run test:fuzz:run  # a real sweep, ~2 min
```

A failure prints a **shrunk** case: the same failure, reduced to the smallest description that
still causes it, as plain JSON you can paste into `scenario(…)`. The seed is not needed
afterwards.

A large sweep also runs [weekly in CI](.github/workflows/property.yml).

## Golden screenshots

52 PNGs under `test/browser/visual/visual-golden.spec.js-snapshots`, compared with an absolute
budget of 200 differing pixels. Absolute rather than a ratio on purpose: rendering noise does
not scale with image area, and a ratio quietly gave a large screenshot a thousand-pixel
allowance — under which seven baselines depicted a caption the card had stopped drawing.

Re-record with `npx playwright test --update-snapshots=all`, then **look at every changed
image**. Never widen the budget to make a diff go away.

## Known defects

The suite is green at every commit. That rule is not negotiable — once a red run is normal,
nobody can tell a new regression from an old one everybody agreed to live with.

A defect that is understood, reproduced and deliberately not fixed yet is registered in
`test/known-issues.js` and reproduced in `test/known-issues.test.js` through
`expectedFailure()`, which requires the reproduction to **fail**. The run stays green, the bug
stays documented in executable form, and — the part that makes this honest — **if the
reproduction ever passes, the run fails**, telling whoever fixed the defect to come and close
the entry.

Read `test/known-issues.js` to find out what is currently broken on purpose.

## Continuous integration

[`ci.yml`](.github/workflows/ci.yml) runs two independent jobs on every push and pull request —
Node tests and browser tests — deliberately without `needs:` between them, because a failure in
one says nothing about the other. Both build the bundle themselves, so no job can report green
against an artifact it did not produce. Coverage is published as an artifact and never enforced;
the Playwright report is kept whatever the outcome, because a *flaky* result is a pass whose
evidence is the first thing to be thrown away.

[`property.yml`](.github/workflows/property.yml) sweeps a large generated population once a
week, and can be started by hand with a case count.
