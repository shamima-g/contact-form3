/**
 * Story Metadata:
 * - Route: /
 * - Target File: web/src/app/page.tsx
 * - Page Action: modify_existing
 *
 * Tests for the public Contact Form (Name, Email, Message, Submit) on the home
 * page. Purely front-end: client-side-only validation, no backend, no network
 * request, no persistence — so nothing is mocked here (there is no API client to
 * mock). AC-4 (valid submit shows the on-page confirmation without navigating) is
 * covered by the Playwright spec, not this file.
 *
 * These tests import the real page component and WILL FAIL until the form is
 * implemented (TDD red).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
// Import based on Story Metadata Target File — the home page owns the form.
// Fails until implemented (TDD red).
import HomePage from '@/app/page';

describe('Contact form (home page)', () => {
  // AC-1: the visitor sees a form with Name, Email, Message fields and a Submit button.
  it('renders Name, Email, and Message fields and a Submit button', () => {
    render(<HomePage />);

    expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /message/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  // AC-2: submitting with empty fields shows a required message under each, no confirmation.
  it('shows a required message under each empty field and no confirmation on empty submit', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: /submit/i }));

    // All three fields left empty → a "required" message appears for each.
    await waitFor(() => {
      expect(screen.getAllByText(/required/i)).toHaveLength(3);
    });

    // No confirmation on an invalid submit.
    expect(screen.queryByText(/thanks.*be in touch/i)).not.toBeInTheDocument();
  });

  // AC-3: submitting with a malformed email (other fields filled) shows an email-format error, no confirmation.
  it('shows an email-format error for a malformed email and no confirmation', async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Jane Doe');
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'bob@');
    await user.type(
      screen.getByRole('textbox', { name: /message/i }),
      'Hello, I would like to get in touch.',
    );

    await user.click(screen.getByRole('button', { name: /submit/i }));

    // An email-validity message is shown (wording varies: "Invalid email",
    // "enter a valid email", "email is not well-formed", "email format …").
    expect(
      await screen.findByText(
        /(invalid|valid|well[-\s]?formed).*email|email.*(invalid|valid|well[-\s]?formed|format)/i,
      ),
    ).toBeInTheDocument();

    // No confirmation while the email is malformed.
    expect(screen.queryByText(/thanks.*be in touch/i)).not.toBeInTheDocument();
  });

  // DELIBERATE FAILURE — trips the CI Testing gate for the broken-run check.
  // This whole test is reverted immediately after we confirm the PR blocks the merge.
  it('DELIBERATE CI-GATE FAILURE — remove after broken-run test', () => {
    render(<HomePage />);
    expect(screen.getByRole('button', { name: /submit/i })).toHaveTextContent(
      'This confirmation text intentionally does not exist',
    );
  });
});
