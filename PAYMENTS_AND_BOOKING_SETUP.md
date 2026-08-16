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
