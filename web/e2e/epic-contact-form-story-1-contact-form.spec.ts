/**
 * Story Metadata:
 * - Route: /
 * - Target File: web/src/app/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - No backend is mocked because this story makes NO backend calls. The contact
 *   form is purely front-end: validation is client-side only and a valid submit
 *   shows an on-page confirmation with no network request and no persistence
 *   (project.md § Data Source = mock-only / no-backend; brief BR1).
 * - Implementation pattern this assumes:
 *   - The form validates entirely in the browser (all fields required + a
 *     well-formed email) and, on a valid submit, renders the confirmation text
 *     "Thanks, we'll be in touch" on the same page without navigating away from `/`.
 *   - No fetch/Server Action is issued on submit; nothing is persisted.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic contact-form, Story 1: Contact form happy path.
 * playwright.config.ts's webServer block boots the FRONTEND dev server only; this
 * story contacts no backend, so nothing needs mocking.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Epic contact-form, Story 1: Contact form with validation and confirmation', () => {
  // AC-4
  test('valid submit clears errors and shows the confirmation on the same page', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByLabel(/name/i).fill('Ada Lovelace');
    await page.getByLabel(/email/i).fill('ada@example.com');
    await page
      .getByLabel(/message/i)
      .fill('I would like to get in touch about your services.');

    await page.getByRole('button', { name: /submit/i }).click();

    // Confirmation appears on the same page — no navigation away from `/`.
    await expect(page.getByText("Thanks, we'll be in touch")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  // Accessibility — real-browser axe scan scoped to WCAG 2.1 AA (matches NFR-base-1).
  // Axe's defaults also run best-practice rules that fail outside the agreed bar, so
  // scope to the WCAG tags. Scan the default form state after it has settled.
  test('the contact page has no accessibility violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /submit/i })).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations).toEqual([]);
  });
});
