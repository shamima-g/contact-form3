# Contact Form

A single-page public contact form: visitors enter their name, email, and message, and receive an on-page confirmation when they submit. Purely front-end — no backend, no data persistence, no authentication.

| Field | Value |
|---|---|
| Project slug | `contact-form3` |
| Created | 2026-07-31 |
| Intake source | guided-qa |
| Backend connectivity | no-backend |

---

## Roles & Permissions

**Template:** `custom`

| Permission | Public visitor |
|---|---|
| View and submit contact form | ✓ |

> Permissions extend during BUILD as new stories surface new actions — see [agent-autonomy.md](.claude/shared/agent-autonomy.md). Additions land here via a project-change PR (§6.1 of the epic-branch plan). Permission removals or role-set changes halt for user review.

---

## Authentication

| Field | Value |
|---|---|
| Method | `custom` |
| BFF login endpoint (if BFF) | N/A |
| BFF userinfo endpoint (if BFF) | N/A |
| BFF logout endpoint (if BFF) | N/A |
| Custom auth notes (if custom) | No authentication — public page, anyone can open and submit the form. No sign-in, no protected routes. |

> Auth method is never inferred — the user must confirm explicitly per [authentication-intake.md](.claude/policies/authentication-intake.md).

---

## Data Source & Backend Integration

| Field | Value |
|---|---|
| Data source | `mock-only` |
| Backend status | `N/A` |
| Mock layer required | no |

<!-- No backend connectivity subsection — data source is mock-only and this project has no API calls at all. -->

### API specs

<!-- No API spec files — this project makes no backend/API calls. -->

None — this project is purely front-end with no API integration.

---

## Compliance

**Applicable domains:** None
**Region (if Personal data applies):** N/A

### Compliance Requirements

- No compliance domains were identified during intake screening.

---

## Styling & Branding

| Field | Value |
|---|---|
| Primary brand color | `#2563EB` |
| Accent / secondary | `#64748B` |
| Background (light) | `#FFFFFF` |
| Background (dark, if applicable) | `#0F172A` |
| Font family (headings) | Inter |
| Font family (body) | system stack |
| Theme | light only |
| Source | defaulted |

> Component-specific styling (button radii, card shadows, etc.) emerges during BUILD. This section captures only palette intent and typography per [styling-centralisation.md](.claude/policies/styling-centralisation.md).

---

## Baseline NFRs

- **NFR-base-1:** Accessibility — WCAG 2.1 Level AA baseline
- **NFR-base-2:** Performance — First Contentful Paint < 2.5s on a mid-tier mobile network
- **NFR-base-3:** Responsive design — mobile (≥360px) / tablet (≥768px) / desktop (≥1280px) breakpoints
- **NFR-base-4:** Browser support — latest two versions of Chrome / Edge / Firefox / Safari
- **NFR-base-5:** Error UX — user-visible error states with retry affordance for all async operations

<!-- No connectivity-derived NFRs — this project has no backend and no async operations. -->

---
