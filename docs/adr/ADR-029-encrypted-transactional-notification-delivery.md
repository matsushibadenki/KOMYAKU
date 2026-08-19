# ADR-029: Encrypted Transactional Notification Delivery

- Status: Accepted
- Date: 2026-08-19

## Context

Email verification and password reset previously stored a one-time token hash and then attempted SMTP delivery synchronously. If the process or SMTP transport failed after commit, the API could report `pending`, but the raw token could not be reconstructed for retry. Storing a raw token in Outbox or Job JSON would make database access sufficient to use the credential.

## Decision

- Reuse the PostgreSQL Transactional Outbox and Durable Job Runner for notification delivery.
- Create the one-time token record and `notification.delivery_requested` Outbox Event in the same database transaction.
- Store only the token hash in the token table.
- Seal the complete delivery payload with AES-256-GCM before writing it to Outbox JSON. The stored Job payload contains only a delivery ID and authenticated ciphertext.
- Inject the 256-bit `NOTIFICATION_ENCRYPTION_KEY` from a Secret Manager in production. The repository contains only an explicit local-development example.
- Before SMTP delivery, decrypt and strictly validate the envelope, reject expired tokens, and query PostgreSQL to confirm that the token is still active. Superseded or consumed links are not sent.
- Treat SMTP transport failures and recipient rejection as retryable. Use the existing Job lease, exponential backoff, attempt history, and Dead Letter controls.
- Keep delivery at-least-once. An SMTP server may accept a message immediately before a Worker loses its lease, so a duplicate email is possible; the link remains single-use.
- Separate `AUTH_ROUTES_ENABLED` from `NOTIFICATION_WORKER_ENABLED`. A future API replica may queue encrypted delivery without SMTP, while a Worker replica may deliver without mounting public authentication routes.
- Never log the envelope, recipient, token, SMTP response body, or provider error message.

## Reconciliation invariant

```text
One-time Token Transaction
├─ token hash
└─ encrypted notification Outbox Event
             ↓
       idempotent Job
             ↓
 active-token check → SMTP → complete
             └ failure → retry / Dead Letter
```

There is no committed token created by the current application path without its corresponding encrypted Event. Expired Worker leases are reclaimed, attempts are recorded, and terminal delivery failures remain inspectable through the payload-free Dead Letter interface.

## Key rotation

The first implementation accepts one active encryption key. Do not replace it while pending notification Events or Jobs remain. Drain or terminally resolve the notification queue before rotation. A future envelope version may add key identifiers and overlapping decrypt-only keys when operational evidence requires online rotation.

## Consequences

Notification retries survive process and SMTP outages without placing usable credentials in PostgreSQL plaintext. API responses consistently report delivery as pending because completion is asynchronous. Operations must monitor notification Job age, retries, and Dead Letters, protect the encryption key separately from the database, and account for possible duplicate messages.
