# Characterization baselines — what they are, who owns them, when they may change

A characterization baseline is a **recording of what the card produced**, not a statement of
what it ought to produce. That distinction is the whole reason this file exists.

An ordinary test says "the average must be the mean of the usable rooms". If it fails,
something is wrong. A baseline says "on 4 August 2026 this configuration emitted exactly this
markup". If it fails, something *changed* — and whether that change is a bug or the point of
the commit is a question only a person can answer.

Both are valuable. What is not valuable is a baseline nobody can decide about, so every one of
the 81 files under `test/baseline/` has an owner, a purpose, and a rule for when it may be
re-recorded. `policy.test.js` checks that this document and the files agree — the table below
against the directory, not this sentence, so the count here is the one place it can go stale.

## The rule that matters

> **Re-record deliberately, and look at the diff.**

Never re-record to make a red run green. A baseline that is regenerated because it failed has
stopped being evidence of anything: it now records whatever the code does today, which is
exactly what the test was there to question.

The re-recording command is `npm run characterize:update`. It regenerates every baseline at
once, which is deliberate — it forces the diff to be read rather than one file to be quietly
replaced.

## What each group records

| Group | Files | Owner | Purpose | May be re-recorded when |
|---|---:|---|---|---|
| `dom/` | 36 | `render/composition`, `render/primitives`, `views/` | The complete rendered markup for 36 configurations. The broadest safety net the suite has: any change in structure, class, attribute or order shows up here first. | The markup change is the intended result of the commit, and the diff has been read line by line. |
| `model/` | 36 | `application/model`, `presentation/view-model` | The same 36 configurations as data, through the flat test-only DTO (`test/helpers/legacy-dto.js`): every value, position, colour and label the views are built from. The DTO projects explicit fields only; the display unit profile is recorded by `key` and `displayUnit`, never by its functions or helper fields. | A computed value changes on purpose, the diff has been read entry by entry, and the changelog names the change. |
| `styles/` | 3 | `styles/` | The whole emitted stylesheet, a per-scenario digest list, and the dynamic `@keyframes` block. | The stylesheet change is intended. The digests exist so that a change in ONE scenario is visible without reading 30 kB of CSS. |
| `diagnostics/` | 3 | `config/`, `application/model`, `presentation/view-model` | Every refusal, warning and hint the card emits, verbatim and in English: the refusals `setConfig()` throws, the warnings of a configuration, and the warnings and hints its sensors cause. These are a user-facing contract: the text is what somebody reads at two in the morning. | The wording is being improved on purpose. A message that changes by accident is a regression. |
| `registration/` | 2 | `element/`, `index.js` | What the card registers with Home Assistant: its card-picker entry and its `getStubConfig()` output. | Only alongside a deliberate change to the public surface, which is a `minor` at least. |
| `carousel/` | 3 | `controllers/runtime` | Slide timings, easing, and the accessibility flip sequence, as pure numbers. A migration anchor from the timing rework. | The timing change is intended and the changelog says so. |

## Sunset

Two groups are anchors from a migration rather than permanent contracts, and are worth
retiring once what they anchor is settled:

- **`model/`** records the view model through a flat DTO. It can be retired when that DTO is
  gone from the suite entirely — the adapter is test-only and allowlisted (see
  `architecture/element-ownership.test.js`).
- **`carousel/`** anchors one rework. It can be retired once the timing contracts it records
  are stated as ordinary tests with reasons, rather than as recorded numbers.

Neither is urgent. Both should be a deliberate decision rather than a slow drift into nobody
knowing why they are there.

## What does not belong here

- A baseline for something an ordinary assertion can state directly. "The average is the mean"
  is a rule; record rules as rules.
- A baseline nobody can explain. If the answer to "what would it mean if this changed?" is
  "I do not know", the file should go rather than stay as a tripwire nobody can read.
