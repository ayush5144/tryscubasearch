# ScubaSearch - Sync Methods User Guide

This guide explains how to use the Sync Methods page at:

- `/dashboard/sync`

It is written for both:

- people who are comfortable with APIs and backend systems
- people who mostly just want to know which button or row to use

The goal of the page is simple:

- send documents into ScubaSearch without using CSV upload
- keep your catalog updated
- choose a sync style that matches how your platform already works

---

## What this page is for

Use **Sync Methods** when your content already exists in another system and you want ScubaSearch to stay updated from there.

Common examples:

- your CMS already stores movies, shows, episodes, or videos
- your backend can send JSON to an API
- your admin panel emits a "publish" event
- your catalog is available at a JSON API URL

This page gives you three ways to sync:

1. **REST API push**
2. **Auto-sync pull**
3. **Webhook sync**

If your catalog lives inside a Postgres database table, use:

- `/dashboard/database`

instead of this page.

---

## The three sync methods in simple words

### 1. REST API push

Think of this as:

- "we send documents to ScubaSearch whenever we want"

Your backend, CMS, admin tool, or script sends a JSON payload directly to ScubaSearch.

Best when:

- your developers can call an API endpoint
- you want to send a batch of titles at once
- you want full control over when updates happen

---

### 2. Webhook sync

Think of this as:

- "our system tells ScubaSearch immediately when something changes"

A webhook is usually triggered by an event such as:

- content published
- title updated
- description corrected
- metadata fixed

Best when:

- your platform already supports event-based updates
- you want changes to appear quickly
- you do not want to wait for a scheduled sync

---

### 3. Auto-sync pull

Think of this as:

- "ScubaSearch fetches the latest catalog from our API on a schedule"

Instead of your system pushing data to ScubaSearch, ScubaSearch pulls data from your JSON API.

Best when:

- you already have a JSON API
- you do not want to build push logic
- you want set-it-once automatic refresh

---

## Which one should you choose?

Choose **REST API push** if:

- you have a backend team
- you can send JSON to an endpoint
- you want manual or scripted control

Choose **Webhook sync** if:

- your CMS or backend already emits events
- you want near real-time updates
- you want to send only what changed

Choose **Auto-sync pull** if:

- you already expose a JSON API
- you want the easiest long-term automation
- you want ScubaSearch to fetch updates for you

---

## Before you start

No matter which sync method you use, keep these basics in mind:

### A. You still need documents in ScubaSearch format

Each document usually includes:

- `id`
- `title`
- `description`
- `category`
- `tags`
- `actors`
- `director`
- `writer`
- `content_type`
- `year`
- `language`
- `image_url`
- `product_url`

You do not need every field every time, but `title` is the most important one.

### B. Pick stable IDs whenever possible

If your source already has a stable content ID, send that as `id`.

That helps ScubaSearch:

- update the same document cleanly
- avoid duplicates
- make append and update mode work properly

### C. Understand the three sync modes

Each push-style sync uses one of these modes:

#### Replace

Simple meaning:

- "throw away the current live catalog and use this new one"

Use replace when:

- this payload is the full fresh catalog
- you changed source type
- you want a clean reset

#### Append

Simple meaning:

- "add new IDs, and overwrite matching IDs completely"

Use append when:

- you are sending new titles
- some known titles changed
- you want to keep everything else as-is

#### Update

Simple meaning:

- "only change the fields included in this payload"

Use update when:

- you are patching description, cast, links, or metadata
- you do not want to resend the full document body

Good rule of thumb:

- full catalog = `replace`
- new batch or mixed new + changed titles = `append`
- partial corrections = `update`

---

## How the page works

The page has three collapsible rows:

1. **REST API push**
2. **Auto-sync pull**
3. **Webhook sync**

Open the row you want, complete the setup, and test from there.

The summary card at the top shows:

- how many documents are indexed
- which source is currently active
- what the last job did

Examples of source labels:

- `CSV manual`
- `JSON manual`
- `NDJSON manual`
- `REST API push`
- `Webhook sync`
- `Auto-sync pull`
- `DB sync`

These labels help you understand where the live catalog came from.

---

## Step by step - REST API push

### What it does

Your system sends a JSON batch directly to ScubaSearch.

### What you need

- an active API key from **Settings**
- a JSON payload

### How to use it

1. Open the **REST API push** row.
2. Make sure you already created an active API key in Settings.
3. Pick a mode:
   - `Replace`
   - `Append`
   - `Update`
4. Paste your JSON payload into the box.
5. Click **Queue REST sync**.

### What happens next

ScubaSearch will:

- validate your request
- store the incoming documents
- queue the sync job
- embed the searchable fields
- index everything into Meilisearch

### Best for

- batch imports from your CMS
- admin tooling
- migration scripts
- backend jobs

### Example mental model

- "Every night, our backend sends the latest 200 changed titles."

---

## Step by step - Webhook sync

### What it does

Your platform sends updates when something happens.

Typical examples:

- a title is published
- the cast changes
- a content manager edits a synopsis

### What you need

- an active API key
- a system that can send a webhook payload when content changes

### How to use it

1. Open the **Webhook sync** row.
2. Confirm you have an active API key.
3. Paste a sample webhook payload or your real event payload.
4. Click the webhook sync action.

### What happens next

ScubaSearch will:

- receive the event payload
- normalize the document data
- update only what needs to change
- reindex the affected content

### Best for

- real-time publishing
- metadata corrections
- faster updates than batch jobs

### Example mental model

- "Whenever an editor clicks Publish, our system sends that title to ScubaSearch."

---

## Step by step - Auto-sync pull

### What it does

ScubaSearch fetches your catalog from a JSON API.

### What you need

- a reachable JSON API URL
- field names that can be mapped into ScubaSearch fields
- dashboard access

### How to use it

1. Open the **Auto-sync pull** row.
2. Enter your source URL.
3. Add headers if your API needs authentication.
4. Add the items path if the list is nested inside the response.
   - Example: `items`
   - Example: `data.results`
5. Click preview.
6. Map your API fields to ScubaSearch fields.
7. Choose a sync interval.
8. Connect the source.

### What happens next

ScubaSearch will:

- save the pull source config
- run the first sync
- keep polling the source on the chosen schedule
- replace the live pull-based catalog each run

### Best for

- teams with a content API but no push integration
- easy automation after one-time setup
- "set and forget" refresh

### Example mental model

- "Our catalog API already exists. We just want ScubaSearch to fetch from it every 15 minutes."

---

## What happens during setup behind the scenes

Here is the simple version of the setup flow:

### REST API push or webhook sync

1. Your system sends JSON to ScubaSearch.
2. ScubaSearch checks the API key.
3. Documents are normalized into the ScubaSearch format.
4. A sync job is queued.
5. Searchable fields are embedded.
6. The catalog is indexed.
7. New search results become available.

### Auto-sync pull

1. You connect a JSON API from the dashboard.
2. ScubaSearch stores the URL, headers, field mapping, and sync interval.
3. The first sync runs.
4. Scheduled syncs keep fetching fresh data.
5. The live search catalog stays updated automatically.

---

## Important source rules

ScubaSearch keeps one active live catalog source at a time.

That means the live catalog should reflect the latest active method, not a mix of unrelated old sources.

Examples:

- if JSON manual upload is the active source, the page shows `JSON manual`
- if webhook sync is the active source, the page shows `Webhook sync`
- if pull sync is the active source, the page shows `Auto-sync pull`

This makes it easier to understand:

- where the current catalog came from
- which workflow is active right now
- what changed most recently

---

## Common questions

### Do I need to be a developer to use this page?

Not always.

- **Auto-sync pull** is the easiest option for less technical teams if you already have a JSON API.
- **REST API push** and **Webhook sync** usually need developer help once during setup.

### Which sync method is easiest?

Usually:

1. Auto-sync pull
2. REST API push
3. Webhook sync

Webhook sync is powerful, but it assumes your platform already has an event flow.

### Which sync method is fastest?

- **Webhook sync** is usually the fastest for live changes
- **REST API push** is fast when triggered manually or by a script
- **Auto-sync pull** depends on the interval you choose

### What if I change my source later?

That is okay, but the active source label and sync behavior should match the latest source that owns the live catalog.

### What if I only want to fix one field?

Use:

- `Update`

That is the safest mode for partial metadata changes.

### What if I want to send a full fresh catalog?

Use:

- `Replace`

---

## Simple recommendations

If you are unsure, use this:

- **REST API push + Append** for developer-controlled batch updates
- **Webhook sync + Update** for real-time metadata changes
- **Auto-sync pull** when your catalog already lives behind a JSON API

And if your team is just getting started:

- first test with a small batch
- make sure IDs are stable
- confirm search results look right
- then automate the full workflow
