# Umami Integration — Architecture & Implementation Plan

## Overview

Add Umami analytics as part of ScubaSearch to give stores full customer journey tracking:
- Search analytics (what we have now)
- Website analytics via Umami (page views, referrals, sessions, replays)

## Problem Statement

**Current Gap:**
- We track: queries searched, products clicked from search, zero-results
- We DON'T track: where customer came from (Google, Instagram, direct), what they did AFTER clicking, session replays

**What stores want:**
> "Customer came from Instagram → searched 'sneakers' → clicked result → viewed product → left"
> vs
> "Customer came from Google → browsed 'sale' category → added to cart → purchased"

## Solution

Embed Umami data in our dashboard alongside search analytics. Stores see everything in one place.

---

## Architecture Options

### Option A: Self-Hosted Umami (Recommended)

```
┌──────────────────────────────────────────────────────┐
│                  VPS (ours)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ ScubaSearch │  │  Umami      │  │ PostgreSQL  │  │
│  │  FastAPI   │  │ (:3001)     │  │ (umami DB) │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────┘
           ↑                    ↑
     Our app data          Analytics data
```

**Hosting:** Same VPS, separate PostgreSQL database
**Cost:** +$4/mo (500MB RAM, +10GB storage)
**Port:** Umami on :3001

### Option B: Cloud Umami (umami.is)

- SaaS from Umami team
- $19+/mo for Unlimited sites
- Data leaves our infrastructure
- Not recommended

### Option C: Separate VPS

- Dedicated Umami server
- +$8-15/mo
- Best isolation
- Overkill for Phase 1

---

## Tracking Methods

### Method 1: Auto-Injected in Widget

Widget automatically includes Umami script:

```javascript
// In widget.js, on load:
(function() {
  var script = document.createElement('script');
  script.src = 'https://analytics.scubasearch.io/script.js';
  script.setAttribute('data-website-id', client.umami_website_id);
  document.head.appendChild(script);
})();
```

**Pros:**
- Stores do ZERO extra work
- Works immediately after widget install
- No Umami setup required

**Cons:**
- Widget script size increases slightly
- Only tracks when widget loads

### Method 2: Store Installs Separate Script

We provide a tracking script URL. Store adds to their entire site.

```html
<script
  defer
  src="https://analytics.scubasearch.io/script.js"
  data-website-id="CLIENT_WEBSITE_ID"
></script>
```

**Pros:**
- Full site tracking, not just widget
- Session replays work
- More accurate referral data

**Cons:**
- Requires store to add script to ALL pages
- More installation friction

### Method 3: Platform-Specific Plugins

#### WordPress
Simple mu-plugin (1 PHP file):

```php
<?php
/*
Plugin Name: ScubaSearch Analytics
Description: Track store analytics for ScubaSearch dashboard
*/
add_action('wp_footer', function() {
    ?>
    <script defer src="https://analytics.scubasearch.io/script.js" 
      data-website-id="<?php echo get_option('scuba_website_id'); ?>"></script>
    <?php
}, 99);
```

#### Shopify
Theme snippet addition:

```liquid
<!-- In theme.liquid, before </body> -->
<script defer src="https://analytics.scubasearch.io/script.js" 
  data-website-id="{{ client.umami_website_id }}"></script>
```

---

## Implementation Plan

### Phase 1: Infrastructure (Week 1)

| Task | Details |
|------|---------|
| Deploy Umami | Docker on VPS, port :3001 |
| Create PostgreSQL | New `umami` database |
| Configure Nginx | analytics.scubasearch.io → :3001 |
| SSL certificate | Let's Encrypt |

### Phase 2: Backend Integration (Week 2)

| Task | Details |
|------|---------|
| Create Umami website on signup | API call to Umami when client created |
| Store website_id in clients table | `umami_website_id` column |
| API endpoints | Query Umami API for stats |
| Data parsing | Normalize Umami data for dashboard |

### Phase 3: Widget Update (Week 2)

| Task | Details |
|------|---------|
| Add Umami script | Auto-inject in widget.js |
| Configuration | Read umami_website_id from client config |
| Fallback | If no website_id, skip |

### Phase 4: Dashboard Integration (Week 3)

| Task | Details |
|------|---------|
| Embed Umami stats | Show in our analytics page |
| Custom events | Track widget-specific events |
| Unified view | Search + site analytics combined |

---

## Data Model

### Additional columns in `clients` table:

```sql
umami_website_id  UUID  -- Umami's website ID for this client
umami_share_code  TEXT  -- Share URL code for client access
```

### New environment variables:

```bash
UMAMI_URL=http://localhost:3001
UMAMI_DATABASE_URL=postgresql://umami:password@localhost:5432/umami
UMAMI_API_KEY=your-umami-admin-api-key
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/analytics/umami/summary` | GET | Website stats |
| `/api/v1/analytics/umami/realtime` | GET | Live visitors |
| `/api/v1/analytics/umami/pages` | GET | Top pages |
| `/api/v1/analytics/umami/referrers` | GET | Traffic sources |
| `/api/v1/analytics/umami/events` | GET | Custom events |

---

## Pros/Cons Summary

| Approach | Pros | Cons |
|----------|------|------|
| Self-hosted Umami | Full control, cheap | +RAM, +maintenance |
| Auto-inject widget | Zero install friction | Limited to widget |
| Full site script | Complete journey | Requires setup |
| WordPress plugin | 1-click install | Platform-specific |
| Embed in dashboard | Unified experience | More dev work |

---

## Security Considerations

1. **Website isolation:** Ensure client can only see their own website data
2. **API keys:** Rotate Umami admin API key regularly
3. **Data retention:** Configure Umami data retention policy (default: 6 months)
4. **Privacy:** Umami is GDPR-friendly (no cookies), but add privacy policy

---

## Costs

| Item | Monthly Cost |
|------|-------------|
| Additional PostgreSQL (~500MB) | ~$2 |
| Umami container (~500MB RAM) | ~$2 |
| Nginx + SSL | $0 |
| **Total** | **~$4/mo** |

---

## Milestones

- [ ] Deploy Umami on VPS
- [ ] Create website on client signup
- [ ] Update widget with auto-tracking
- [ ] Query Umami API from backend
- [ ] Display in dashboard
- [ ] Test with pilot client

---

## Future Enhancements

- Custom event tracking (product views, cart adds)
- Conversion funnels
- UTM parameter tracking
- Client-accessible share URLs
- Team access for agencies