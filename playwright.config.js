// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;

module.exports = defineConfig({
  testDir: "./test/browser",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  // Two workers everywhere, CI included: oversubscription is the one thing observed to make
  // this suite's timing tests flaky, and naming the number makes a local failure believable.
  // See interne Doku §4 "Diagnose und Läufe".
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  // No global retries: a retry hides a genuine intermittent failure behind a `flaky`
  // annotation, and for a golden screenshot that difference is the point. The two
  // timing-sensitive specs opt in themselves via test.describe.configure({ retries }) —
  // pointer-interaction.spec.js and double-swipe.spec.js. See interne Doku §4 "Diagnose und
  // Läufe".
  retries: 0,
  // "dot" locally (one char per test), "list" in CI where logs are not read token by token.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["dot"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Only the specs that asked for retries produce a trace; a deterministic failure is
    // re-run instead.
    trace: "on-first-retry",
  },
  expect: {
    toHaveScreenshot: {
      // Absolute budget, deliberately small: a ratio budget scales with image area while
      // capture noise does not, and once let seven baselines pass while the card had stopped
      // rendering a headline. Rule and measurements: interne Doku §4 "Baseline- und
      // Golden-Vertrag". Never widen this to make a diff go away.
      maxDiffPixels: 200,
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox-core",
      testMatch: /core[\\/](?:availability|public-surface-smoke|source-modes)\.spec\.js/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-core",
      testMatch: /core[\\/](?:availability|public-surface-smoke|source-modes)\.spec\.js/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: `node test/helpers/static-server.js`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
