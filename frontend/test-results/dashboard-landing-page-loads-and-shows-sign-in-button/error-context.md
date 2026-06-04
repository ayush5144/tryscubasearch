# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> landing page loads and shows sign in button
- Location: tests/dashboard.spec.ts:10:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('link', { name: /get started/i })
Expected: visible
Error: strict mode violation: getByRole('link', { name: /get started/i }) resolved to 3 elements:
    1) <a href="/sign-up" class="bg-[#4338ca] hover:bg-[#3730a3] text-white rounded-full px-4 py-2 text-sm font-medium transition-colors">Get started</a> aka getByRole('banner').getByRole('link', { name: 'Get started' })
    2) <a href="/sign-up" class="rounded-xl bg-[#4338ca] px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-all hover:bg-[#3730a3] hover:shadow-md">Get started</a> aka getByRole('link', { name: 'Get started' }).nth(1)
    3) <a href="/dashboard/billing" class="inline-block rounded-xl bg-[#4338ca] px-8 py-4 text-base font-semibold text-white shadow-sm transition-all hover:bg-[#3730a3] hover:shadow-md">Get started</a> aka getByRole('link', { name: 'Get started' }).nth(2)

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('link', { name: /get started/i })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e5]:
        - link "ScubaSearch" [ref=e6] [cursor=pointer]:
          - /url: /
        - navigation [ref=e7]:
          - link "Product" [ref=e8] [cursor=pointer]:
            - /url: "#features"
          - link "Pricing" [ref=e9] [cursor=pointer]:
            - /url: "#pricing"
        - generic [ref=e10]:
          - link "Sign in" [ref=e11] [cursor=pointer]:
            - /url: /sign-in
          - link "Get started" [ref=e12] [cursor=pointer]:
            - /url: /sign-up
    - main [ref=e13]:
      - generic [ref=e15]:
        - generic [ref=e16]: AI-Powered Search
        - heading "Your customers can't find what they're looking for. Fix it in 30 minutes." [level=1] [ref=e17]:
          - text: Your customers can't find what they're looking for.
          - text: Fix it in 30 minutes.
        - paragraph [ref=e18]: Most search only skims the surface. ScubaSearch dives into the intent behind every query -understanding what customers actually want, not just the words they type.
        - generic [ref=e19]:
          - link "Get started" [ref=e20] [cursor=pointer]:
            - /url: /sign-up
          - link "See pricing" [ref=e21] [cursor=pointer]:
            - /url: "#pricing"
      - generic [ref=e23]:
        - generic [ref=e24]:
          - text: Under the surface
          - heading "Built to go deep." [level=2] [ref=e25]
        - generic [ref=e26]:
          - generic [ref=e27]:
            - img [ref=e29]
            - heading "Dives deeper than keywords." [level=3] [ref=e32]
            - paragraph [ref=e33]: BM25 keyword matching runs alongside vector semantic search on every query. "comfortable running shoe for flat feet" surfaces "orthopedic athletic footwear" - even when no words match.
          - generic [ref=e34]:
            - img [ref=e36]
            - heading "One script tag. Works everywhere." [level=3] [ref=e40]
            - paragraph [ref=e41]: Paste a single line of JavaScript on your store - Shopify, WooCommerce, or custom. ScubaSearch attaches to your existing search input automatically. No framework. No rebuild. No developer.
          - generic [ref=e42]:
            - img [ref=e44]
            - heading "Typo tolerance built in." [level=3] [ref=e46]
            - paragraph [ref=e47]: "\"niky\", \"adidass\", \"iphone chargr\" - all handled. Your customers type like humans. ScubaSearch finds what they mean, not what they typed."
          - generic [ref=e48]:
            - img [ref=e50]
            - heading "Search-as-you-type." [level=3] [ref=e53]
            - paragraph [ref=e54]: Results surface on every keystroke. Cached responses return in under 5ms. The right product appears before the customer finishes typing.
          - generic [ref=e55]:
            - img [ref=e57]
            - heading "See what customers couldn't find." [level=3] [ref=e58]
            - paragraph [ref=e59]: Zero-result query reports surface exactly what customers searched for and found nothing. That list is your next purchase order. Top queries, click-through rates, and response times included.
          - generic [ref=e60]:
            - img [ref=e62]
            - heading "Dashboard you actually understand." [level=3] [ref=e67]
            - paragraph [ref=e68]: Upload your product CSV, watch it index in real time. Create and revoke API keys. Copy your embed snippet. See usage against your plan limits. No technical knowledge needed.
      - generic [ref=e70]:
        - heading "Up and running in 30 minutes" [level=2] [ref=e72]
        - generic [ref=e73]:
          - generic [ref=e74]:
            - text: Step 1
            - heading "Upload your catalog" [level=3] [ref=e75]
            - paragraph [ref=e76]: Export your products as a CSV from Shopify, WooCommerce, or any platform. Upload it to your ScubaSearch dashboard. Products are embedded and indexed in the background -usually under 5 minutes.
          - generic [ref=e77]:
            - text: Step 2
            - heading "Paste one script tag" [level=3] [ref=e78]
            - paragraph [ref=e79]: Copy the embed snippet from your dashboard. Paste it before the closing </body> tag on your site. ScubaSearch attaches to your existing search input automatically.
          - generic [ref=e80]:
            - text: That's it. Really.
            - heading "Customers find what they're looking for" [level=3] [ref=e81]
            - paragraph [ref=e82]: Results surface as they type. Typos are handled. Natural language works. "comfortable summer dress" finds "cotton sundress" -even when the words don't match.
      - generic [ref=e84]:
        - generic [ref=e85]:
          - heading "Simple pricing" [level=2] [ref=e86]
          - paragraph [ref=e87]: Annual plans save 2 months -$290 / $490 / $690 per year.
        - generic [ref=e88]:
          - generic [ref=e89]:
            - heading "Starter" [level=3] [ref=e90]
            - paragraph [ref=e91]: For small stores getting started with real search.
            - generic [ref=e92]:
              - generic [ref=e93]: $29
              - generic [ref=e94]: /month
            - generic [ref=e95]:
              - paragraph [ref=e96]: 1,000 products
              - paragraph [ref=e97]: 10,000 sessions/month
            - list [ref=e99]:
              - listitem [ref=e100]:
                - img [ref=e101]
                - text: Hybrid search (keyword + semantic)
              - listitem [ref=e103]:
                - img [ref=e104]
                - text: JS embed widget
              - listitem [ref=e106]:
                - img [ref=e107]
                - text: Typo tolerance
              - listitem [ref=e109]:
                - img [ref=e110]
                - text: Category & price filters
              - listitem [ref=e112]:
                - img [ref=e113]
                - text: API access
              - listitem [ref=e115]:
                - img [ref=e116]
                - text: Email support
              - listitem [ref=e118]:
                - img [ref=e119]
                - text: Full analytics dashboard
              - listitem [ref=e121]:
                - img [ref=e122]
                - text: Zero-result query reports
              - listitem [ref=e124]:
                - img [ref=e125]
                - text: Search performance metrics
              - listitem [ref=e127]:
                - img [ref=e128]
                - text: Click-through rate tracking
            - link "Start with Starter" [ref=e131] [cursor=pointer]:
              - /url: /dashboard/billing
          - generic [ref=e132]:
            - generic [ref=e133]: Most popular
            - heading "Growth" [level=3] [ref=e134]
            - paragraph [ref=e135]: For growing stores that need more scale and advanced integrations.
            - generic [ref=e136]:
              - generic [ref=e137]: $49
              - generic [ref=e138]: /month
            - generic [ref=e139]:
              - paragraph [ref=e140]: 5,000 products
              - paragraph [ref=e141]: 50,000 sessions/month
            - list [ref=e143]:
              - listitem [ref=e144]:
                - img [ref=e145]
                - text: Everything in Starter
              - listitem [ref=e147]:
                - img [ref=e148]
                - text: Webhook sync (real-time updates)
              - listitem [ref=e150]:
                - img [ref=e151]
                - text: White-label widget
              - listitem [ref=e153]:
                - img [ref=e154]
                - text: Priority support
              - listitem [ref=e156]:
                - img [ref=e157]
                - text: WhatsApp support
            - link "Start with Growth" [ref=e160] [cursor=pointer]:
              - /url: /dashboard/billing
          - generic [ref=e161]:
            - heading "Scale" [level=3] [ref=e162]
            - paragraph [ref=e163]: For large catalogs that need maximum scale and dedicated support.
            - generic [ref=e164]:
              - generic [ref=e165]: $69
              - generic [ref=e166]: /month
            - generic [ref=e167]:
              - paragraph [ref=e168]: 100,000 products
              - paragraph [ref=e169]: Unlimited
            - list [ref=e171]:
              - listitem [ref=e172]:
                - img [ref=e173]
                - text: Everything in Growth
              - listitem [ref=e175]:
                - img [ref=e176]
                - text: 100,000 products
              - listitem [ref=e178]:
                - img [ref=e179]
                - text: Unlimited sessions
              - listitem [ref=e181]:
                - img [ref=e182]
                - text: Dedicated onboarding
            - link "Start with Scale" [ref=e185] [cursor=pointer]:
              - /url: /dashboard/billing
      - generic [ref=e187]:
        - heading "Ready to dive in?" [level=2] [ref=e188]
        - paragraph [ref=e189]: Go live in 30 minutes. No lock-in.
        - link "Get started" [ref=e191] [cursor=pointer]:
          - /url: /dashboard/billing
    - contentinfo [ref=e192]:
      - generic [ref=e193]:
        - generic [ref=e194]:
          - generic [ref=e195]:
            - text: ScubaSearch
            - paragraph [ref=e196]: AI-powered search for ecommerce
          - navigation [ref=e197]:
            - link "Pricing" [ref=e198] [cursor=pointer]:
              - /url: "#pricing"
            - link "How billing works" [ref=e199] [cursor=pointer]:
              - /url: /how-billing-works
            - link "Dashboard" [ref=e200] [cursor=pointer]:
              - /url: /dashboard
            - link "Contact" [ref=e201] [cursor=pointer]:
              - /url: mailto:hello@scubasearch.io
          - navigation [ref=e202]:
            - link "Terms" [ref=e203] [cursor=pointer]:
              - /url: /terms
            - link "Privacy" [ref=e204] [cursor=pointer]:
              - /url: /privacy
        - paragraph [ref=e205]: © 2026 ScubaSearch. All rights reserved.
  - button "Open Next.js Dev Tools" [ref=e211] [cursor=pointer]:
    - img [ref=e212]
  - alert [ref=e215]
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
> 18 |   await expect(page.getByRole('link', { name: /get started/i })).toBeVisible()
     |                                                                  ^ Error: expect(locator).toBeVisible() failed
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
  34 |   expect(isRedirected).toBeTruthy()
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