import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    // Intercept Google Fonts to prevent load event blocking in headless CI
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, body: '', headers: { 'content-type': 'text/css' } })
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, body: '', headers: { 'content-type': 'font/woff2' } })
    );
    await use(page);
  },
});

export { expect };
