# Story 1: Contact Form with Validation and Confirmation

**Epic:** Contact Form (`contact-form`)
**Slug:** story-1-contact-form
**Route:** `/`
**Target file:** `web/src/app/page.tsx`
**Page action:** modify_existing
**Roles:** Public visitor
**Requirement IDs:** R1, R2, R3, R4, BR1, BR2, BR3
**Infrastructure only:** false

## Plain summary

A public visitor opens the home page, fills in their name, email, and message, and — once every field is filled and the email looks valid — sees "Thanks, we'll be in touch" appear on the same page. Empty fields or a malformed email show clear inline messages instead.

## Summary

Single public page at route `/` rendering a contact form (Name, Email, Message, Submit) with client-side-only validation (all fields required, well-formed email) and inline per-field error messages. On a valid submit the form clears its errors and shows an on-page "Thanks, we'll be in touch" confirmation — no navigation, no network request, no persistence.

## Acceptance criteria

- **AC-1** *(vitest)*: On the home page the visitor sees a contact form with Name, Email, and Message fields and a Submit button.
- **AC-2** *(vitest)*: Submitting with any of Name, Email, or Message empty shows a clear "required" message under each empty field, and no confirmation appears.
- **AC-3** *(vitest)*: Submitting with a malformed email (e.g. "bob@") while other fields are filled shows an email-format error message, and no confirmation appears.
- **AC-4** *(playwright)*: Submitting with all fields filled and a well-formed email clears any error messages and shows "Thanks, we'll be in touch" on the same page without navigating away.

## Manual test checklist

- Open the app at the home page → you see a contact form with Name, Email, and Message fields and a Submit button
- Click Submit with every field empty → a clear "required" message appears under each field and no thank-you shows
- Type an invalid email like "bob@", fill the other fields, and Submit → an email-format message appears and no thank-you shows
- Fill in all three fields with a valid email and Submit → the error messages clear and "Thanks, we'll be in touch" appears on the same page

## Infrastructure reuse notes

- Home page already exists at `web/src/app/page.tsx` — modify it in place rather than creating a new route
- Use Shadcn primitives (Input, Textarea, Button, Label) via the Shadcn CLI per Critical Rule 1 — do not hand-roll form controls
- Styling references tokens in `web/src/app/globals.css` — no hex literals in the component
