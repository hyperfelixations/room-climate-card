"use strict";

// Single Playwright fixture boundary for every browser spec.
// Ordinary runs behave exactly like @playwright/test; an explicit coverage run records raw
// Chromium V8 ranges per test, including failed tests, for source-map normalization later.
// Firefox and WebKit never enter Chromium's page.coverage API.

const base = require("@playwright/test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const test = base.test.extend({
  page: async ({ page, browserName }, use, testInfo) => {
    const enabled = process.env.ROOM_CLIMATE_CARD_BROWSER_COVERAGE === "1" && browserName === "chromium";
    if (!enabled) {
      await use(page);
      return;
    }

    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    try {
      await use(page);
    } finally {
      const entries = await page.coverage.stopJSCoverage();
      const directory = path.resolve(process.env.ROOM_CLIMATE_CARD_BROWSER_COVERAGE_DIR || "coverage/browser/raw");
      fs.mkdirSync(directory, { recursive: true });
      const identity = `${testInfo.project.name}\0${testInfo.testId}\0${testInfo.retry}`;
      const name = crypto.createHash("sha256").update(identity).digest("hex");
      fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(entries)}\n`, "utf8");
    }
  },
});

module.exports = { ...base, test };
