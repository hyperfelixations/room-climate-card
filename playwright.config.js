// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;

module.exports = defineConfig({
  testDir: "./test/browser",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  // 8 parallel Chromium workers (the local default) caused observable CPU-
  // contention timing flakiness (resize/rAF settling, mouse-gesture
  // sequences) on this machine, worse the larger the full suite run gets —
  // capped locally, uncapped in CI where the runner is normally more
  // consistent/dedicated (a single shared machine, not N parallel browsers
  // competing for the same cores).
  workers: process.env.CI ? undefined : 2,
  forbidOnly: Boolean(process.env.CI),
  // Pointer-gesture tests (test/browser/pointer-interaction.spec.js) were
  // observed to be occasionally flaky under heavy parallel-worker CPU load
  // on this machine (timing-sensitive mouse.move() sequences) — a single
  // retry absorbs that without masking a genuine, reproducible failure
  // (which would still fail on the retry too).
  retries: process.env.CI ? 2 : 1,
  // "dot" locally: one character per test, full detail only on failure, one
  // summary line at the end — far less output to process on the common
  // all-green path than "list"'s one line per test. CI keeps "list" since
  // its logs aren't read token-by-token the way a local run's output is.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["dot"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      // An ABSOLUTE budget, and a deliberately small one.
      //
      // This used to be maxDiffPixelRatio: 0.01, and that was the wrong instrument.
      // A ratio scales with the image, so the same rendering noise got a different
      // allowance per screenshot — 1028 px on the 400x257 shot, 1559 px on the
      // 609x256 one — while the noise it exists to absorb does not scale with area
      // at all. One percent of a card is a lot: seven baselines went on passing for
      // two releases while depicting a headline caption the card had stopped
      // rendering, at 638-1006 differing pixels each, the largest sitting at 86 % of
      // its own budget. Nothing reported it.
      //
      // The rule this replaces it with: the budget must exceed the measured capture
      // noise and stay well under the smallest UI element whose loss would be
      // unacceptable. Measured, after setCardWidth() made capture wait on the layout
      // mechanism instead of a fixed 200 ms: two consecutive full runs at zero
      // tolerance differ by exactly 0 pixels across all 36 baselines. The only real
      // variance left is between environments, and the largest ever observed here —
      // a Chromium version change — moved 45-163 px. 200 covers that with room, and
      // is still a factor of three below the smallest defect class it has to catch.
      //
      // Re-record baselines deliberately (--update-snapshots=all) and review every
      // image; never widen this number to make a diff go away.
      maxDiffPixels: 200,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node test/helpers/static-server.js`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
