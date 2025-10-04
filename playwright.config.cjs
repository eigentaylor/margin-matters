/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './tests/playwright',
  timeout: 30 * 1000,
  use: {
    headless: true,
    viewport: { width: 1200, height: 800 },
  }
};
