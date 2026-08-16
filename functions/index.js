"use strict";

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const Razorpay = require("razorpay");
const Stripe = require("stripe");

initializeApp({
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://glowdental-8615c-default-rtdb.firebaseio.com",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "glowdental-8615c.firebasestorage.app"
});
const db = getDatabase();
const REGION = "asia-south1";
const HOLD_MS = 30 * 60 * 1000;

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const SMTP_HOST = defineString("SMTP_HOST", { default: "smtp.gmail.com" });
const SMTP_PORT = defineString("SMTP_PORT", { default: "465" });
const ADMIN_EMAIL = defineString("ADMIN_EMAIL", { default: "appointments@glowdental.com" });
const APPOINTMENT_FEE_INR = defineString("APPOINTMENT_FEE_INR", { default: "" });
const APP_BASE_URL = defineString("APP_BASE_URL", { default: "" });

function text(value, max) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, max);
}

function istToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function validateAppointment(input) {
  const appointment = {
    name: text(input && input.name, 80),
    email: text(input && input.email, 120).toLowerCase(),
    phone: text(input && input.phone, 18),
    date: text(input && input.date, 10),
    time: text(input && input.time, 5),
    message: text(input && input.message, 1000)
  };
  if (appointment.name.length < 2 || !/^\S+@\S+\.\S+$/.test(appointment.email) || !/^[0-9+() -]{8,18}$/.test(appointment.phone)) {
    throw new HttpsError("invalid-argument", "Please enter valid patient contact details.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) || appointment.date < istToday()) {
    throw new HttpsError("invalid-argument", "Please choose a valid future appointment date.");
  }
  const chosen = new Date(`${appointment.date}T00:00:00Z`);
  const max = new Date(); max.setUTCFullYear(max.getUTCFullYear() + 1);
  if (Number.isNaN(chosen.valueOf()) || chosen > max) throw new HttpsError("invalid-argument", "Appointments can be booked up to one year ahead.");
  const match = /^(\d{2}):(00|30)$/.exec(appointment.time);
  if (!match) throw new HttpsError("invalid-argument", "Please choose an available 30-minute time.");
  const hour = Number(match[1]);
  const day = chosen.getUTCDay();
  const hours = day === 0 ? [10, 16] : day === 6 ? [9, 18] : [9, 20];
  if (hour < hours[0] || hour >= hours[1]) throw new HttpsError("invalid-argument", "That time is outside clinic working hours.");
  return appointment;
}

function feeInPaise() {
  const rupees = Number(APPOINTMENT_FEE_INR.value());
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new HttpsError("failed-precondition", "The appointment fee has not been configured yet.");
  }
  return Math.round(rupees * 100);
}

function slotRef(appointment) {
  return db.ref(`appointmentSlots/${appointment.date}/${appointment.time.replace(":", "-")}`);
}

async function reserveSlot(appointment, appointmentId, reservationId) {
  const now = Date.now();
  const result = await slotRef(appointment).transaction((current) => {
    if (!current || (current.status === "pending_payment" && Number(current.expiresAt) <= now)) {
      return { appointmentId, reservationId, status: "pending_payment", heldAt: now, expiresAt: now + HOLD_MS };
    }
    return;
  }, undefined, false);
  if (!result.committed) throw new HttpsError("already-exists", "This appointment time is no longer available.");
}

async function releaseSlot(appointment, reservationId, appointmentId) {
  await slotRef(appointment).transaction((current) => {
    if (current && current.appointmentId === appointmentId && current.reservationId === reservationId && current.status === "pending_payment") return null;
    return current;
  }, undefined, false);
  await db.ref(`appointments/${appointmentId}`).remove();
}

async function sendConfirmation(appointmentId, appointment) {
  const lock = await db.ref(`appointmentNotifications/${appointmentId}`).transaction((current) => {
    if (current) return;
    return { claimedAt: Date.now() };
  }, undefined, false);
  if (!lock.committed) return;
  try {
    const archive = { id: appointmentId, ...appointment, archivedAt: new Date().toISOString() };
    await getStorage().bucket().file(`appointment-archives/${appointment.date}/${appointmentId}.json`).save(JSON.stringify(archive, null, 2), {
      contentType: "application/json", resumable: false, metadata: { cacheControl: "private, no-store" }
    });

    if (!SMTP_USER.value() || !SMTP_PASS.value()) {
      logger.warn("SMTP is not configured; appointment archived but emails were skipped", { appointmentId });
      return;
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST.value(), port: Number(SMTP_PORT.value()), secure: Number(SMTP_PORT.value()) === 465,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
    });
    const summary = `Patient: ${appointment.name}\nEmail: ${appointment.email}\nPhone: ${appointment.phone}\nDate: ${appointment.date}\nTime: ${appointment.time} IST\nConcern: ${appointment.message || "Not provided"}\nGateway: ${appointment.paymentProvider}\nPayment reference: ${appointment.paymentId || appointment.gatewayOrderId}`;
    await Promise.all([
      transporter.sendMail({ from: SMTP_USER.value(), to: ADMIN_EMAIL.value(), subject: `Confirmed dental appointment: ${appointment.date} ${appointment.time}`, text: `A paid appointment has been confirmed.\n\n${summary}` }),
      transporter.sendMail({ from: SMTP_USER.value(), to: appointment.email, subject: "Your Glow Dental appointment is confirmed", text: `Hello ${appointment.name},\n\nYour appointment is confirmed for ${appointment.date} at ${appointment.time} IST.\n\nBooking reference: ${appointmentId}\nPayment reference: ${appointment.paymentId || appointment.gatewayOrderId}\n\nPlease arrive 10 minutes early. If you need help, reply to this email.\n\nGlow Dental Hospital` })
    ]);
    await db.ref(`appointments/${appointmentId}/notificationSentAt`).set(Date.now());
  } catch (error) {
    await db.ref(`appointmentNotifications/${appointmentId}`).remove();
    logger.error("Appointment archive/email failed", { appointmentId, error: error.message });
  }
}

async function confirmAppointment(appointmentId, payment) {
  const ref = db.ref(`appointments/${appointmentId}`);
  const before = await ref.get();
  if (!before.exists()) throw new Error("Appointment reservation not found");
  if (before.val().status === "confirmed") return before.val();

  // Claim the slot before confirming the appointment. If an unusually late gateway
  // callback arrives after the hold was released, this prevents a double booking.
  const slotClaim = await slotRef(before.val()).transaction((current) => {
    if (current && current.appointmentId === appointmentId) {
      return { appointmentId, status: "confirmed", bookedAt: Date.now() };
    }
    return;
  }, undefined, false);
  if (!slotClaim.committed) {
    await ref.update({ ...payment, status: "payment_review_required", paymentConflictAt: Date.now() });
    throw new Error("Paid reservation arrived after its slot was released; manual review/refund required");
  }

  const result = await ref.transaction((current) => {
    if (!current || current.status === "cancelled") return;
    if (current.status === "confirmed") return current;
    return { ...current, ...payment, status: "confirmed", confirmedAt: Date.now() };
  }, undefined, false);
  if (!result.committed || !result.snapshot.exists()) throw new Error("Appointment reservation not found");
  const appointment = result.snapshot.val();
  await sendConfirmation(appointmentId, appointment);
  return appointment;
}

exports.getUnavailableSlots = onCall({ region: REGION }, async (request) => {
  const date = text(request.data && request.data.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError("invalid-argument", "Invalid date.");
  const snapshot = await db.ref(`appointmentSlots/${date}`).get();
  const now = Date.now();
  const slots = [];
  snapshot.forEach((child) => {
    const value = child.val();
    if (value.status === "confirmed" || (value.status === "pending_payment" && Number(value.expiresAt) > now)) slots.push(child.key.replace("-", ":"));
  });
  return { slots };
});

exports.createAppointmentPayment = onCall({ region: REGION, secrets: [STRIPE_SECRET_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const appointment = validateAppointment(request.data && request.data.appointment);
  const provider = text(request.data && request.data.provider, 10);
  if (!["stripe", "razorpay"].includes(provider)) throw new HttpsError("invalid-argument", "Choose Stripe or Razorpay.");
  const amount = feeInPaise();
  const appointmentId = db.ref("appointments").push().key;
  const reservationId = crypto.randomUUID();
  await reserveSlot(appointment, appointmentId, reservationId);
  const stored = { ...appointment, paymentProvider: provider, amount, currency: "INR", status: "pending_payment", reservationId, createdAt: Date.now(), expiresAt: Date.now() + HOLD_MS, source: "website" };
  await db.ref(`appointments/${appointmentId}`).set(stored);
  try {
    if (provider === "stripe") {
      if (!STRIPE_SECRET_KEY.value()) throw new HttpsError("failed-precondition", "Stripe is not configured yet.");
      const baseUrl = APP_BASE_URL.value().replace(/\/$/, "");
      if (!baseUrl) throw new HttpsError("failed-precondition", "The website URL has not been configured.");
      const stripe = new Stripe(STRIPE_SECRET_KEY.value());
      const session = await stripe.checkout.sessions.create({
        mode: "payment", customer_email: appointment.email,
        line_items: [{ quantity: 1, price_data: { currency: "inr", unit_amount: amount, product_data: { name: "Dental appointment booking fee", description: `${appointment.date} at ${appointment.time} IST` } } }],
        metadata: { appointmentId }, payment_intent_data: { metadata: { appointmentId } },
        success_url: `${baseUrl}/appointment.html?payment=success&appointment=${appointmentId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/appointment.html?payment=cancelled`, expires_at: Math.floor(Date.now() / 1000) + 30 * 60
      });
      await db.ref(`appointments/${appointmentId}/gatewayOrderId`).set(session.id);
      return { provider, appointmentId, checkoutUrl: session.url };
    }
    if (!RAZORPAY_KEY_ID.value() || !RAZORPAY_KEY_SECRET.value()) throw new HttpsError("failed-precondition", "Razorpay is not configured yet.");
    const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
    const order = await razorpay.orders.create({ amount, currency: "INR", receipt: appointmentId, notes: { appointmentId } });
    await db.ref(`appointments/${appointmentId}/gatewayOrderId`).set(order.id);
    return { provider, appointmentId, orderId: order.id, amount: order.amount, currency: order.currency, keyId: RAZORPAY_KEY_ID.value() };
  } catch (error) {
    await releaseSlot(appointment, reservationId, appointmentId);
    if (error instanceof HttpsError) throw error;
    logger.error("Payment order creation failed", { provider, error: error.message });
    throw new HttpsError("internal", "The payment gateway is temporarily unavailable.");
  }
});

exports.verifyRazorpayPayment = onCall({ region: REGION, secrets: [RAZORPAY_KEY_SECRET, SMTP_USER, SMTP_PASS] }, async (request) => {
  const data = request.data || {};
  const appointmentId = text(data.appointmentId, 40);
  const orderId = text(data.razorpayOrderId, 80);
  const paymentId = text(data.razorpayPaymentId, 80);
  const signature = text(data.razorpaySignature, 200);
  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET.value()).update(`${orderId}|${paymentId}`).digest("hex");
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new HttpsError("permission-denied", "Payment signature verification failed.");
  const snapshot = await db.ref(`appointments/${appointmentId}`).get();
  if (!snapshot.exists() || snapshot.val().gatewayOrderId !== orderId) throw new HttpsError("not-found", "Appointment payment was not found.");
  await confirmAppointment(appointmentId, { paymentId, gatewayOrderId: orderId, paymentStatus: "paid" });
  return { confirmed: true, appointmentId };
});

exports.stripeWebhook = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SMTP_USER, SMTP_PASS] }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    const event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET.value());
    if (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") {
      const session = event.data.object;
      await confirmAppointment(session.metadata.appointmentId, { paymentId: session.payment_intent, gatewayOrderId: session.id, paymentStatus: "paid" });
    }
    res.json({ received: true });
  } catch (error) { logger.error("Stripe webhook failed", error); res.status(400).send(`Webhook error: ${error.message}`); }
});

exports.razorpayWebhook = onRequest({ region: REGION, secrets: [RAZORPAY_WEBHOOK_SECRET, SMTP_USER, SMTP_PASS] }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const expected = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET.value()).update(req.rawBody).digest("hex");
  const received = String(req.headers["x-razorpay-signature"] || "");
  if (!received || received.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return res.status(401).send("Invalid signature");
  try {
    if (req.body.event === "payment.captured") {
      const payment = req.body.payload.payment.entity;
      const appointmentId = payment.notes && payment.notes.appointmentId;
      if (appointmentId) await confirmAppointment(appointmentId, { paymentId: payment.id, gatewayOrderId: payment.order_id, paymentStatus: "paid" });
    }
    res.json({ received: true });
  } catch (error) { logger.error("Razorpay webhook failed", error); res.status(500).send("Webhook processing failed"); }
});

exports.releaseExpiredAppointmentHolds = onSchedule({ region: REGION, schedule: "every 15 minutes", timeZone: "Asia/Kolkata" }, async () => {
  const snapshot = await db.ref("appointmentSlots").get();
  const now = Date.now();
  const updates = {};
  snapshot.forEach((dateSnapshot) => dateSnapshot.forEach((slotSnapshot) => {
    const slot = slotSnapshot.val();
    if (slot.status === "pending_payment" && Number(slot.expiresAt) <= now) {
      updates[`appointmentSlots/${dateSnapshot.key}/${slotSnapshot.key}`] = null;
      updates[`appointments/${slot.appointmentId}/status`] = "expired";
      updates[`appointments/${slot.appointmentId}/expiredAt`] = now;
    }
  }));
  if (Object.keys(updates).length) await db.ref().update(updates);
});
