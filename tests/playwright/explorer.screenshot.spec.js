const { test, expect } = require('@playwright/test');
const path = require('path');

test('explorer page renders and matches golden', async ({ page }) => {
  const file = path.join(__dirname, '..', '..', 'docs', 'explorer.html');
  const url = 'file://' + file.replace(/\\/g, '/');
  await page.goto(url);
  // wait a little for scripts to settle
  await page.waitForTimeout(800);
  const screenshot = await page.screenshot({ fullPage: true });
  expect(screenshot).toMatchSnapshot('explorer-golden.png');
});
