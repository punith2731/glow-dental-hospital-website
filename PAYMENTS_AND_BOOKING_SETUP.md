# Secure payments, appointment locking, email and cloud archive

The website is ready for **Stripe and Razorpay**, but payment processing remains disabled until the clinic supplies credentials and chooses a booking fee. Secrets are used only by Firebase Cloud Functions; never put secret keys in `firebase-config.js`, HTML, or browser JavaScript.

## What is implemented

1. The patient enters details and chooses a live 30-minute slot.
2. At the final step they choose Stripe or Razorpay.
3. A Firebase Realtime Database transaction atomically holds the slot. Concurrent requests for the same time cannot both succeed.
4. The selected provider takes payment. Card/UPI credentials never pass through this website.
5. A signed provider webhook (plus Razorpay's immediate signature check) confirms the booking.
6. The function stores the record under private `appointments/`, permanently claims the slot, writes a private JSON archive to Firebase Cloud Storage, emails the clinic, and emails a receipt/confirmation to the patient.
7. Unpaid holds expire automatically. A late payment can never overwrite another patient's confirmed slot; it is flagged `payment_review_required` for manual refund/review.

## Prerequisites

- Firebase **Blaze** plan (Cloud Functions, scheduler, external payment/email calls, and Storage).
- Firebase CLI: `npm install -g firebase-tools`, then `firebase login`.
- Stripe and Razorpay accounts with live or test credentials.
- An SMTP mailbox (Google Workspace/Gmail app password, Microsoft 365, SendGrid SMTP, etc.).

Run commands from the repository root. Select the existing Firebase project if prompted:

```bash
firebase use glowdental-8615c
cd functions && npm install && cd ..
```

## Non-secret environment parameters

Create `functions/.env.glowdental-8615c` (this filename is ignored by Git if you add it locally) with:

```dotenv
# Integer or decimal rupee amount, for example 500
APPOINTMENT_FEE_INR=500
# Exact deployed website origin, with no trailing slash
APP_BASE_URL=https://your-real-domain.example
ADMIN_EMAIL=real-clinic-email@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

Do not leave `APPOINTMENT_FEE_INR` empty in production. The backend deliberately refuses to create a payment until the clinic approves this value.

> Depending on your Firebase CLI version, non-secret parameters may be requested during deployment rather than read from the project environment file. Enter the same values when prompted.

## Store secrets

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
```

Use Stripe test key `sk_test_...` and Razorpay test credentials during acceptance testing. `SMTP_PASS` should be an app password or SMTP-specific credential, not the mailbox's normal password.

## Deploy

```bash
firebase deploy --only functions,database,storage
```

The callable functions deploy in `asia-south1` (Mumbai). Keep that region unchanged unless `firebase.js` is updated to match.

## Configure signed webhooks

After deployment, Firebase prints the two HTTPS URLs.

### Stripe

In Stripe Dashboard → Developers → Webhooks:

- Endpoint: deployed `stripeWebhook` URL
- Event: `checkout.session.completed`
- Copy the endpoint signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`, then redeploy functions if it changed.

### Razorpay

In Razorpay Dashboard → Accounts & Settings → Webhooks:

- Endpoint: deployed `razorpayWebhook` URL
- Event: `payment.captured`
- Set a strong webhook secret and store the exact same value in `RAZORPAY_WEBHOOK_SECRET`.

Use HTTPS URLs only. Do not disable webhook signature validation.

## Test checklist

1. Use provider test mode and a small approved fee.
2. Open the appointment page in two separate browsers.
3. Select the same date/time in both and continue.
4. Start payment in the first browser. Starting payment in the second must report that the slot is unavailable.
5. Complete a Stripe test payment and a Razorpay test payment.
6. Verify:
   - `appointments/{id}` is `confirmed` in Realtime Database;
   - `appointmentSlots/{date}/{time}` is `confirmed`;
   - `appointment-archives/{date}/{id}.json` exists in Storage;
   - both admin and patient emails arrived;
   - no card, CVV, UPI PIN, Stripe secret, or Razorpay secret appears in the database/browser.
7. Cancel a checkout and verify the hold becomes selectable after its expiry.

## Operational notes

- Clinic hours follow the website: Mon–Fri 9:00–20:00, Sat 9:00–18:00, Sun 10:00–16:00, in IST.
- Never manually change a confirmed slot without also updating the appointment.
- Restrict Firebase Console access to clinic administrators because records contain patient contact and health-related information.
- Configure Firebase/Google Cloud retention, backups, audit logs, and local legal/privacy requirements before handling real patient data.
- The old direct browser `saveAppointment` function remains only for compatibility; the new appointment page does not use it. Production database rules deny all browser access to appointments and slots.

# Extended clinic features

The following production features are also included:

- treatment selection with 30/60-minute atomic multi-slot reservations;
- a patient portal using Firebase Email/Password Authentication and verified email;
- secure emailed management links for guest bookings;
- patient rescheduling, cancellation/refund requests, `.ics` calendar downloads, and private medical intake;
- an administrator dashboard at `admin.html`, protected by a Firebase `admin` custom claim;
- completion/no-show/cancellation tracking, Stripe/Razorpay refunds, CSV export, clinic-time blocking, waitlist visibility, and medical intake access;
- automated 24-hour and 2-hour email reminders;
- cancellation-waitlist availability emails;
- rate limiting, optional Firebase App Check, consent versioning, audit logs, terms, and privacy pages.

## Enable patient authentication

In Firebase Console → Authentication → Sign-in method, enable **Email/Password**. Add the final website domain under Authentication → Settings → Authorized domains. Patients must verify their email before the portal returns appointment records.

Bookings are linked to a patient account only when the patient is signed in while booking. Guest bookings are managed through the high-entropy secure link in the confirmation email.

## Create the first administrator

1. Create the staff account in Firebase Authentication (or let the staff member create it through the patient portal).
2. Authenticate Application Default Credentials (`gcloud auth application-default login`) or set `GOOGLE_APPLICATION_CREDENTIALS` to a securely stored service-account file. Never add that file to Git.
3. Run:

```bash
cd functions
npm run set-admin -- real-admin@example.com
```

4. The staff member must sign out and back in, then visit `admin.html`.

Do not authorize staff by editing browser JavaScript. Only the server-side Firebase custom claim grants access.

## Enable App Check and CAPTCHA protection

1. In Firebase Console → App Check, register the web app with reCAPTCHA v3.
2. Put the **public site key** in `app-check-config.js` (it is not a secret).
3. Initially deploy with `ENFORCE_APP_CHECK=false` and verify real requests receive App Check tokens.
4. Change `ENFORCE_APP_CHECK=true` and redeploy.

The backend also applies per-IP/day limits to payment, waitlist, and management operations. Expired counters are removed by the scheduled cleanup.

## Additional non-secret parameters

Add these alongside the parameters documented earlier:

```dotenv
# Require valid App Check only after its browser configuration has been tested
ENFORCE_APP_CHECK=false
# Patient refund-request eligibility window
CANCELLATION_HOURS=24
```

## Scheduled jobs

Deployment creates these jobs in `asia-south1`:

- `releaseExpiredAppointmentHolds`: every 15 minutes;
- `sendAppointmentReminders`: hourly;
- `notifyWaitlist`: hourly.

Cloud Scheduler requires billing. Confirm all three jobs are enabled after deployment. Waitlist messages only indicate possible availability; the slot remains first-come, first-served.

## Data paths

All paths except public reviews are server-only:

- `appointments/` — booking and payment state;
- `appointmentSlots/general-dentist/` — confirmed, held, and admin-blocked intervals;
- `medicalIntake/` — private patient medical intake;
- `waitlist/` — cancellation waitlist;
- `auditLogs/` — administrator and patient changes;
- `rateLimits/` — short-lived abuse controls;
- Storage `appointment-archives/` — private JSON booking-state archives;
- Storage `medical-intake-archives/` — private medical-intake archives.

Before launch, have the clinic review `privacy.html`, `terms.html`, cancellation/refund wording, treatment names and durations, record-retention requirements, and placeholder clinic contact information with qualified legal/compliance advisers.

## Optional clinic Google Calendar synchronization

Set `GOOGLE_CALENDAR_ID` to the clinic calendar ID to create, update, and remove clinic events automatically. In Google Calendar, share that calendar with the Cloud Functions runtime service account and grant **Make changes to events**. Enable the Google Calendar API in the same Google Cloud project. Leave the value empty to disable clinic-side synchronization; patient `.ics` downloads continue to work with Google Calendar, Apple Calendar, and Outlook.
