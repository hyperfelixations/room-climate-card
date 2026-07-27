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
      // Small tolerance for sub-pixel text anti-aliasing variance between
      // otherwise-identical Chromium launches (observed occasionally on
      // this machine) — large enough to absorb that noise, far too small
      // to hide an actual visual regression (a real layout/color change
      // affects far more than 1% of the card's pixels).
      maxDiffPixelRatio: 0.01,
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
