# Fast2SMS WhatsApp integration

Implementation is prepared, not activated or live-validated. No real API send,
database write, migration or deployment was performed. The running backend
nodemon process tree was stopped before editing watched source files: startup
seeds/top-ups data in several modules. It has deliberately not been restarted.

## Existing architecture and gaps

The customer `LoginScreen` calls `POST /api/v1/auth/otp/send` with a `LOGIN`
challenge; `OtpVerificationScreen` verifies it using the existing identity
service and JWT/session system. New customers are provisioned only on successful
verification. There is no separate signup challenge enum or signup endpoint.

`IdentityModule` selects `SMS_SERVICE`; the existing WhatsApp adapter reads the
Phone Number ID and template message IDs separately. Existing mock/SMS/WhatsApp
providers, expiry, cooldown and attempts remain in place. The new signup mapping
is opt-in and does not change the stored challenge purpose or verification UI.

Customer `ReviewRequestStep` calls `POST /api/v1/customer/pickups/request`.
`PickupsService.requestPickup` creates the pickup, automatically schedules it,
then emits `pickup.requested`. Scheduling still leaves it for admin review.
There is no separate admin booking-confirmation action. The existing admin
dispatch/calendar screens call `POST /api/v1/admin/pickups/:id/assign`; the
persisted `ASSIGNED` transition is the first operational acceptance, and is used
for both booking confirmation and partner assignment. Automatic `SCHEDULED`
and customer weighing approval (`CUSTOMER_CONFIRMED`) do not send confirmation.
This interpretation should be reviewed by the business owner before activation.

Customer/admin cancellation uses the shared pickup state machine. Employee
acceptance/travel, arrival, verification, weighing and closing code operations
continue through existing handlers. The employee app calls
`POST /api/v1/employee/pickups/:id/settle` and
`POST /api/v1/employee/pickups/:id/verify-closing-otp`. `SettlementsService`
persists the settlement and completes the pickup, emitting state transitions,
`settlement.completed` and `pickup.completed`.

The existing outbox already polls committed domain events, publishes sockets
and in-app/FCM notifications, and exposes admin monitoring through
`GET /api/v1/admin/outbox`. It had no customer lifecycle WhatsApp dispatch,
provider delivery audit or delivery webhook. These now reuse its existing
Mixed payload and unique `_id`; no schema/index changes were made.

## Approved template mapping

All lifecycle recipients are resolved from `Pickup.customerId` -> active customer
`User.mobile`, never event/mobile fields submitted by the client. Names come
from `CustomerProfile.fullName`. Missing/invalid records cause a recorded failure,
not invented personal data. Assignment fields and schedule come from the pickup.

| Approved template | Message ID | Committed backend event / handler | Variables in exact order |
| --- | --- | --- | --- |
| `ak_login_otp` | 42871 | `IdentityService.sendOtp`, existing account | Generated challenge OTP |
| `ak_auth_signup_otp` | 42921 | Same customer login endpoint, no existing account; signup flag enabled | Generated challenge OTP |
| `ak_pickup_request_received` | 42922 | `pickup.requested`, after `PickupsService.requestPickup` persists | Customer name, pickup code |
| `ak_pickup_confirmed` | 42923 | First persisted `ASSIGNED` transition, operational confirmation | Customer name, pickup code, scheduled date, time-slot display label |
| `ak_employee_assigned` | 42924 | Persisted `ASSIGNED`, once per assignment snapshot | Customer name, pickup code, assigned partner name |
| `ak_pickup_cancelled` | 42926 | Persisted `CANCELLED` transition | Customer name, pickup code |
| `ak_pickup_completed_payment` | 42929 | Completion/settlement event, gated on persisted pickup `COMPLETED` and settlement `COMPLETED` | Customer name, pickup code, net kg, INR amount, payment mode |

Signup template selection uses backend account existence (including normalized
number variants), never a caller-supplied signup flag. Employee login retains its
existing flow; no new customer lifecycle template is sent to an employee. Legacy
picker approval/rejection template mappings are preserved, not repurposed.
The pickup-completion code continues to be read in the app; no new closing-code
WhatsApp send was introduced.

Paid notices require CASH or UPI, nonnegative integer paise matching the pickup
total, and positive net grams. Donation is not represented as money paid to the
customer. Payment before completion, pending/failed payment, mismatched totals,
and cancellation do not send the collected-and-paid message. Existing employee
payment confirmation is the source of truth; this adds no bank/UPI reconciliation.

## Delivery, duplicate prevention and failure handling

The original domain consumer prepares `whatsapp.notification` outbox jobs; its
existing socket/push behavior is preserved. A separate worker claims each job
atomically. A deterministic `_id` based on pickup, template and (for assignment)
the actual assignment snapshot prevents duplicate jobs from event/API retries
for the same pickup. The unique `_id` index already exists.

Each logical job gets at most one automatic provider attempt. Rejection records
FAILED/REJECTED with a safe error category and HTTP status. Timeout/network
ambiguity records UNKNOWN. A crash can leave PROCESSING/DISPATCHING. None of
these are blindly resent: this avoids duplicates when a provider accepted a
message but the response was lost. Operator investigation is required before any
manually approved retry. Exactly-once delivery cannot be guaranteed by this API.

Accepted requests retain the provider request ID, not recipient/name/OTP/key
payloads. The opaque outbox ID is sent as `udf1`. Delivery callbacks can therefore
correlate even before the HTTP response arrives. Delivered/read callbacks cannot
be downgraded by a delayed sent/failed callback or timeout result. API acceptance
is distinct from handset delivery. Admin outbox records expose both states;
there is no new dashboard UI.

Provider HTTP 400 invalid/disconnected sender is classified as configuration;
401 as authorization, 429 as rate limiting, and timeouts as ambiguous. Provider
response text and exception text are not logged or stored. Mock provider logs
no longer print OTPs or personal details. OTP rejection still deletes the
undelivered challenge and returns the existing `OTP_SMS_FAILED` error; no fallback
code or fabricated success is introduced.

Existing pickup creation has no request-idempotency contract. If an API retry
actually creates a *different pickup record*, it is a distinct business event;
this notifier does not merge separate bookings. Making creation itself fully
idempotent requires a separately reviewed API/storage change, outside this
no-schema-change task. Similarly, job creation failures retry through the
existing domain outbox, not through the already-committed business operation.

OTP delivery request IDs are not persisted in the OTP schema; callbacks without
a matching lifecycle job are ignored. Adding persistent OTP delivery auditing
would need a separately reviewed retention/storage design. The real challenge
and verification/session lifecycle remain unchanged.

## Configuration status and activation prerequisites

Read-only inspection found local Fast2SMS/WhatsApp selected, the sender ID equal
to the supplied connected sender, and login message ID equal to 42871. This
corrects the previous placeholder configuration, but does not prove delivery or
sender verification. No authenticated provider query was made.

`FAST2SMS_WA_API_KEY` is currently missing/empty; the legacy `FAST2SMS_API_KEY`
fallback remains for existing OTP behavior. New lifecycle dispatch requires the
dedicated key. Its presence alone will not prove authorization. Actual template
approval/ownership, Connected/Unverified sender eligibility and previous HTTP
400/401 errors must be checked in a separately approved live test.

All new activation flags default to false; `.env` was not changed in this task.
Configuration names and the seven approved template IDs are in `.env.example`.

Before enabling anything:

1. Obtain explicit permission for database writes, or use a verified isolated
   test database. The existing remote staging database is still unverified.
   Restarting this backend can itself seed records.
2. Privately configure the dedicated WhatsApp authorization key, the correct
   connected Phone Number ID, and all approved template fields from `.env.example`.
   Do not replace sender/WABA/business IDs with a template ID or telephone number.
3. Review confirmation-at-first-assignment semantics and the treatment of donations.
4. Enable `FAST2SMS_WA_SIGNUP_OTP_ENABLED=true` only when signup template sending
   and its database writes are approved. Real OTP failure behavior stays unchanged.
5. Enable `FAST2SMS_WA_NOTIFICATIONS_ENABLED=true` only after messaging/database
   approval and set `FAST2SMS_WA_NOTIFICATIONS_SINCE` to the activation UTC ISO
   timestamp. Older domain events are ignored to prevent backlog sends.
6. For delivery receipts, register a JSON WhatsApp status webhook at
   `POST /api/v1/webhooks/fast2sms/whatsapp`, using HTTPS and the provider's
   `webhook_secret_key` header. Configure a private 32+ character
   `FAST2SMS_WA_WEBHOOK_SECRET` and explicitly enable
   `FAST2SMS_WA_WEBHOOK_ENABLED=true`. This endpoint writes only correlated
   lifecycle delivery metadata. It returns 503 while disabled, rejects invalid
   secrets and malformed statuses, and discards unrelated personal fields.
7. Only after approval, restart and perform a controlled OTP plus lifecycle test.
   Inspect accepted/delivered/failed states through the existing admin outbox API.

Disabling the three new flags stops new signup-template selection, lifecycle
dispatch/preparation and webhook writes respectively; it does not change existing
login provider selection or purge historical outbox audit data.

Fast2SMS reference: https://www.fast2sms.com/api-sms documents the template GET
endpoint, sender/template identifiers, ordered variables, `udf1` correlation,
delivery statuses and `webhook_secret_key`. No dashboard webhook, cloud setting,
AWS/Vercel deployment or production environment was changed.

## Files changed by this task

- `.env.example`: template names/IDs, blank credentials and opt-in flags.
- `src/modules/identity/identity.service.ts`: opt-in signup delivery selection from account existence.
- `src/modules/identity/sms/sms.interface.ts`: typed lifecycle template/result/correlation contract.
- `src/modules/identity/sms/fast2sms-whatsapp.service.ts`: seven mappings, validation, structured outcomes, safe errors and correlation.
- `src/modules/identity/sms/mock-sms.service.ts`: remove OTP/personal-data logging.
- `src/modules/notifications/whatsapp-notification-plan.ts`: pure event/variable mapping and eligibility rules.
- `src/modules/notifications/whatsapp-notifications.service.ts`: trusted recipients, existing-outbox jobs, claims, outcomes and webhook updates.
- `src/modules/notifications/whatsapp-webhook.controller.ts`: disabled-by-default shared-secret callback.
- `src/modules/outbox/outbox.module.ts`: existing-model/service registration; no schema changes.
- `src/modules/outbox/outbox.service.ts`: committed-event hook; exclude WhatsApp jobs from the original socket worker.
- `test/whatsapp-notifications.spec.ts`: controlled-provider and in-memory-model tests.
- `docs/fast2sms-whatsapp-integration.md`: this report and activation instructions.

No customer/employee/admin frontend files, Google Maps files, database schemas,
private environment values, database records or production configuration were
changed. Business authorization/permissions remain in the existing controllers.

## Verification

All sends and model operations in the tests use controlled mocks, not fabricated
live delivery claims. Targeted authentication, provider, outbox, state-machine,
settlement and new notification suites passed (73 tests). Backend build
TypeScript and lint of all task-touched TypeScript files passed. Additional
tests cover all seven IDs/order/recipients, missing variables/configuration,
inactive/noncustomer recipients, duplicate/concurrent events and claims, stale
cancellation/assignment, payment-before-completion, donation/pending/failed
payment, cutover/disabled gating, HTTP 400/401/429/timeouts, signup rejection,
challenge hashing, webhook secrets, monotonic statuses and early callbacks.
