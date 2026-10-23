import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Today in Asia/Manila as YYYY-MM-DD (the app's business timezone). */
const manilaToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

/** Text inputs by accessible name (the required-field `*` is aria-hidden, but is part of the label text). */
const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

const OWNER = {
  name: 'Smoke Test Owner',
  email: 'smoke-owner@example.test',
  password: 'smoke-test-password-1',
};

test('setup wizard → add employee → run payroll → payslip PDF', async ({ page }) => {
  // 1. First run: the app sends us to the setup wizard.
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await field(page, 'Your name').fill(OWNER.name);
  await field(page, 'Email').fill(OWNER.email);
  await field(page, 'Password').fill(OWNER.password);
  await field(page, 'Confirm password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Create owner account' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // 2. Add a monthly employee (defaults: semi-monthly payroll, 261 factor, NCR, active).
  await page.goto('/employees/new');
  await field(page, 'Employee no.').fill('SMK-001');
  await field(page, 'First name').fill('Smoke');
  await field(page, 'Last name').fill('Tester');
  await field(page, 'Base rate').fill('30000');
  await page.getByLabel('Hire date').fill('2024-01-08');
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page).toHaveURL(/\/employees$/);
  await expect(page.getByText('Smoke Tester').first()).toBeVisible();

  // 3. Run payroll for the current month's first cutoff, review and approve it.
  await page.goto('/payroll');
  await page.getByRole('button', { name: 'New payroll run' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Pay date').fill(manilaToday());
  await dialog.getByRole('button', { name: 'Create and compute' }).click();
  await expect(page).toHaveURL(/\/payroll\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Smoke Tester').first()).toBeVisible();

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

  // 4. Open the payslip and download its PDF.
  await page.getByRole('link', { name: 'Smoke Tester', exact: true }).click();
  await expect(page).toHaveURL(/\/payslips\/[0-9a-f-]{36}$/);
  await expect(page.getByText('NET PAY', { exact: false }).first()).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download PDF' }).click(),
  ]);
  const path = await download.path();
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(1000);
});
