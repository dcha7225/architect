---
title: Gallery Page
summary: Plan for adding a new image-only gallery section to the portfolio
tags:
  - gallery
  - images
  - new-page
  - html
  - css
updatedAt: '2026-04-15T19:32:41.239Z'
---
# Gallery Page Plan

## Goal

Add a new `#gallery` section to `index.html` that showcases images in a clean, fullscreen-capable grid layout — consistent with the existing site aesthetic (IBM Plex Mono, dark/minimal style).

---

## Requirements

- REQ-1: New `#gallery` hash route accessible from the sticky nav
- REQ-2: Responsive image grid (masonry or uniform grid) using only HTML + CSS
- REQ-3: Images stored under `imgs/gallery/`
- REQ-4: Clicking any image opens the existing overlay modal (reuse `openOverlay()` / `closeOverlay()`)
- REQ-5: No external libraries — plain HTML, CSS, vanilla JS only
- REQ-6: Section follows existing `.content-section` pattern for visual consistency

---

## Constraints

- CONSTRAINT-1: Static site — no build step, no framework
- CONSTRAINT-2: Must work with current hash-based routing (no new HTML files)
- CONSTRAINT-3: Reuse existing overlay JS rather than writing new modal logic
- CONSTRAINT-4: Images must use relative `src="imgs/gallery/..."` paths

---

## Decisions

- DECISION-1: Use CSS Grid with `auto-fill` + `minmax` for responsive layout (same pattern as `.story-grid`)
- DECISION-2: Add `#gallery` link to the existing `<nav>` alongside Home, Experiences, Projects, Interests
- DECISION-3: Images displayed as uniform square thumbnails (aspect-ratio: 1 / 1, object-fit: cover) for clean grid
- DECISION-4: Section header follows existing `<h2>` heading style

---

## Open Questions

- OQ-1: Should the gallery have category filters (e.g. nature, travel, golf) or be one flat grid?
- OQ-2: Should images be captioned or caption-free for a cleaner look?
- OQ-3: What images should be included — pull from existing `imgs/` subdirectories or require new uploads?

---

## Implementation Steps

### Step 1 — Add images
- Create `imgs/gallery/` directory (or curate from existing subdirs)
- Decide on the image set to display

### Step 2 — Add nav link
In `index.html`, add to `<nav>`:
```html
<a href="#gallery">Gallery</a>
```

### Step 3 — Add HTML section
After the `#interests` section, insert:
```html
<section id="gallery" class="content-section">
  <h2>Gallery</h2>
  <div class="gallery-grid">
    <figure class="gallery-item">
      <img
        src="imgs/gallery/photo1.jpg"
        alt="Description"
        class="thumbnail"
        onclick="openOverlay(this)"
      />
    </figure>
    <!-- repeat per image -->
  </div>
</section>
```

### Step 4 — Add CSS
```css
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}

.gallery-item img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  cursor: pointer;
  display: block;
}

@media (max-width: 600px) {
  .gallery-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
}
```

### Step 5 — Verify overlay wiring
- Confirm `openOverlay()` accepts an `<img>` element and loads its `src` into the modal
- Test click-to-enlarge on gallery images

### Step 6 — QA
- Check responsive layout at mobile (375px), tablet (768px), desktop (1280px)
- Verify nav link scrolls correctly with `scroll-margin` offset
- Check image load performance (consider lazy loading via `loading="lazy"`)
