# Epic: Contact Form

Inherits roles, auth, data source, compliance, and styling from project.md.

## Goal

A public visitor fills in name, email, and message, and sees a "Thanks, we'll be in touch" confirmation on the page after submitting.

---

## Data Model

This epic introduces no persisted or fetched entities — there is no backend and no data store. The only data shape is transient, client-side form state:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Free text |
| `email` | string | Must be a well-formed email address |
| `message` | string | Free text |

This state exists only in the browser for the duration of the page visit and is discarded on submit (no persistence, no API call).

---

## Functional Requirements

- **R1:** Present a contact form on the home page (route `/`) with three inputs — Name, Email, Message — and a Submit button, open to any public visitor.
- **R2:** Validate on the client that Name, Email, and Message are all filled in before the form can be submitted; show a clear message on any empty field.
- **R3:** Validate on the client that the Email field contains a well-formed email address; show a clear message when it is not.
- **R4:** After a valid submission, show the confirmation message "Thanks, we'll be in touch" on the same page (no navigation, no backend call).

---

## Business Rules

- **BR1:** Validation is client-side only — there is no backend to validate against, and no network request is made on submit.
- **BR2:** Submission is considered valid only when Name, Email, and Message are all non-empty and Email is well-formed; the confirmation message appears only in that case.
- **BR3:** The confirmation replaces or appears alongside the form on the same page — the visitor never navigates away from `/`.

---

## Key Workflows

1. Visitor lands on `/` and sees the empty contact form (Name, Email, Message, Submit).
2. Visitor leaves one or more fields empty and clicks Submit → clear per-field error messages appear; no confirmation is shown.
3. Visitor fills all fields but enters a malformed email (e.g. `bob@`) and clicks Submit → an email-format error message appears; no confirmation is shown.
4. Visitor fills all fields correctly and clicks Submit → the form's error states clear and "Thanks, we'll be in touch" is shown on the page.

---

## Feature NFRs

- No feature-specific NFRs beyond the baseline in project.md — this epic is a single static page with client-side validation only.

---

## Out of Scope

- Sending the message anywhere (email, backend, database, third-party service) — no backend exists for this project.
- Persisting submitted data in any form (localStorage, cookies, files).
- Any authentication, rate limiting, spam protection (e.g. CAPTCHA), or anti-bot measures.
- Server-side validation — there is no server.
- Multi-step forms, file attachments, or additional fields beyond Name, Email, Message.

---

## Notes & Caveats

None — no prototype source was cataloged for this project, and no data-structure mismatches apply since there is no backend or data model to reconcile against.
