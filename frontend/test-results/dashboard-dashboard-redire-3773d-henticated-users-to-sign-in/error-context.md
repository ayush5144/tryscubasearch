# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> dashboard redirects unauthenticated users to sign in
- Location: tests/dashboard.spec.ts:21:5

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e9] [cursor=pointer]:
    - img [ref=e10]
  - alert [ref=e13]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | /**
  4  |  * Dashboard e2e tests.
  5  |  *
  6  |  * Tests 1 and 2 work without auth.
  7  |  * Test 3 would require a real Clerk session or mocked auth middleware.
  8  |  */
  9  | 
  10 | test('landing page loads and shows sign in button', async ({ page }) => {
  11 |   await page.goto('/')
  12 | 
  13 |   // The page should load without error
  14 |   await expect(page).toHaveTitle(/ScubaSearch/)
  15 | 
  16 |   // Sign in and get started buttons should be visible
  17 |   await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
  18 |   await expect(page.getByRole('link', { name: /get started/i })).toBeVisible()
  19 | })
  20 | 
  21 | test('dashboard redirects unauthenticated users to sign in', async ({ page }) => {
  22 |   const response = await page.goto('/dashboard')
  23 | 
  24 |   // Clerk middleware should redirect to sign-in
  25 |   // Accept any redirect to a Clerk-hosted page or /sign-in
  26 |   const finalUrl = page.url()
  27 |   const isRedirected =
  28 |     finalUrl.includes('/sign-in') ||
  29 |     finalUrl.includes('clerk.accounts') ||
  30 |     finalUrl.includes('accounts.dev') ||
  31 |     // Clerk can also redirect to the Clerk hosted sign-in page
  32 |     (response !== null && response.status() === 200 && finalUrl !== 'http://localhost:3000/dashboard')
  33 | 
> 34 |   expect(isRedirected).toBeTruthy()
     |                        ^ Error: expect(received).toBeTruthy()
  35 | })
  36 | 
  37 | test('settings page structure renders key sections', async ({ page }) => {
  38 |   // Navigate to settings — will redirect to sign-in since unauthenticated.
  39 |   // This test checks that the sign-in page renders correctly as a proxy
  40 |   // for the app being in a functioning state.
  41 |   await page.goto('/sign-in')
  42 | 
  43 |   // Clerk renders its own sign-in UI; confirm the page is not a blank error.
  44 |   // The body should have content (not be empty).
  45 |   const body = await page.locator('body').textContent()
  46 |   expect(body).not.toBeNull()
  47 |   expect(body!.length).toBeGreaterThan(10)
  48 | })
  49 | 
```