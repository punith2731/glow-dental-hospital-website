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
const { GoogleAuth } = require("google-auth-library");
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
const ENFORCE_APP_CHECK = defineString("ENFORCE_APP_CHECK", { default: "false" });
const CANCELLATION_HOURS = defineString("CANCELLATION_HOURS", { default: "24" });
const GOOGLE_CALENDAR_ID = defineString("GOOGLE_CALENDAR_ID", { default: "" });

const DOCTOR = { id: "general-dentist", name: "Glow Dental Care Team" };
const SERVICES = {
  consultation: { id: "consultation", name: "Dental Consultation", duration: 30 },
  cleaning: { id: "cleaning", name: "Cleaning & Polishing", duration: 60 },
  "root-canal": { id: "root-canal", name: "Root Canal Consultation", duration: 60 },
  implant: { id: "implant", name: "Dental Implant Consultation", duration: 60 },
  whitening: { id: "whitening", name: "Teeth Whitening", duration: 60 },
  orthodontics: { id: "orthodontics", name: "Braces / Aligners Consultation", duration: 60 },
  emergency: { id: "emergency", name: "Emergency Dental Visit", duration: 30 }
};

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
    serviceId: text(input && input.serviceId, 30) || "consultation",
    doctorId: DOCTOR.id,
    date: text(input && input.date, 10),
    time: text(input && input.time, 5),
    message: text(input && input.message, 1000),
    consentVersion: "2026-08-16"
  };
  const service = SERVICES[appointment.serviceId];
  if (!service) throw new HttpsError("invalid-argument", "Please choose a valid dental service.");
  appointment.serviceName = service.name;
  appointment.duration = service.duration;
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
  const minute = Number(appointment.time.slice(3));
  const day = chosen.getUTCDay();
  const hours = day === 0 ? [10, 16] : day === 6 ? [9, 18] : [9, 20];
  if (hour * 60 + minute < hours[0] * 60 || hour * 60 + minute + appointment.duration > hours[1] * 60) throw new HttpsError("invalid-argument", "That time cannot fit within clinic working hours.");
  return appointment;
}

function feeInPaise() {
  const rupees = Number(APPOINTMENT_FEE_INR.value());
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new HttpsError("failed-precondition", "The appointment fee has not been configured yet.");
  }
  return Math.round(rupees * 100);
}

function slotKeys(appointment) {
  const [hour, minute] = appointment.time.split(":").map(Number);
  const keys = [];
  for (let offset = 0; offset < Number(appointment.duration || 30); offset += 30) {
    const total = hour * 60 + minute + offset;
    keys.push(`${String(Math.floor(total / 60)).padStart(2, "0")}-${String(total % 60).padStart(2, "0")}`);
  }
  return keys;
}

function slotsRef(appointment) {
  return db.ref(`appointmentSlots/${appointment.doctorId || DOCTOR.id}/${appointment.date}`);
}

function isActiveSlot(slot, now) {
  return slot && (slot.status !== "pending_payment" || Number(slot.expiresAt) > now);
}

async function reserveSlot(appointment, appointmentId, reservationId) {
  const now = Date.now();
  const keys = slotKeys(appointment);
  const result = await slotsRef(appointment).transaction((current) => {
    const slots = current || {};
    if (keys.some((key) => isActiveSlot(slots[key], now))) return;
    keys.forEach((key) => { slots[key] = { appointmentId, reservationId, status: "pending_payment", heldAt: now, expiresAt: now + HOLD_MS }; });
    return slots;
  }, undefined, false);
  if (!result.committed) throw new HttpsError("already-exists", "This appointment time is no longer available.");
}

async function releaseReservedSlots(appointment, appointmentId, reservationId) {
  await slotsRef(appointment).transaction((current) => {
    if (!current) return current;
    slotKeys(appointment).forEach((key) => {
      const slot = current[key];
      if (slot && slot.appointmentId === appointmentId && (!reservationId || slot.reservationId === reservationId)) delete current[key];
    });
    return current;
  }, undefined, false);
}

async function releaseSlot(appointment, reservationId, appointmentId) {
  await releaseReservedSlots(appointment, appointmentId, reservationId);
  await db.ref(`appointments/${appointmentId}`).remove();
}

async function syncClinicCalendar(appointmentId, appointment, action) {
  if (!GOOGLE_CALENDAR_ID.value()) return;
  try {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/calendar"] });
    const client = await auth.getClient();
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID.value())}/events`;
    if (action === "delete" && appointment.googleCalendarEventId) {
      await client.request({ url: `${base}/${encodeURIComponent(appointment.googleCalendarEventId)}`, method: "DELETE" });
      return;
    }
    const start = `${appointment.date}T${appointment.time}:00+05:30`;
    const endDate = new Date(new Date(start).getTime() + Number(appointment.duration || 30) * 60000);
    const data = {
      summary: `${appointment.serviceName} — ${appointment.name}`,
      description: `Glow Dental booking ${appointmentId}\nPhone: ${appointment.phone}\nStatus: ${appointment.status}`,
      start: { dateTime: start, timeZone: "Asia/Kolkata" },
      end: { dateTime: endDate.toISOString(), timeZone: "Asia/Kolkata" }
    };
    if (appointment.googleCalendarEventId) {
      await client.request({ url: `${base}/${encodeURIComponent(appointment.googleCalendarEventId)}`, method: "PATCH", data });
    } else {
      const result = await client.request({ url: base, method: "POST", data, params: { sendUpdates: "none" } });
      await db.ref(`appointments/${appointmentId}/googleCalendarEventId`).set(result.data.id);
    }
  } catch (error) {
    logger.error("Google Calendar synchronization failed", { appointmentId, error: error.message });
  }
}

async function archiveAppointment(appointmentId, appointment) {
  const { pendingManageToken, manageTokenHash, ...archiveData } = appointment;
  const archive = { id: appointmentId, ...archiveData, archivedAt: new Date().toISOString() };
  await getStorage().bucket().file(`appointment-archives/${appointment.date}/${appointmentId}.json`).save(JSON.stringify(archive, null, 2), {
    contentType: "application/json", resumable: false, metadata: { cacheControl: "private, no-store" }
  });
}

async function sendConfirmation(appointmentId, appointment) {
  const lock = await db.ref(`appointmentNotifications/${appointmentId}`).transaction((current) => {
    if (current) return;
    return { claimedAt: Date.now() };
  }, undefined, false);
  if (!lock.committed) return;
  try {
    await archiveAppointment(appointmentId, appointment);

    if (!SMTP_USER.value() || !SMTP_PASS.value()) {
      logger.warn("SMTP is not configured; appointment archived but emails were skipped", { appointmentId });
      return;
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST.value(), port: Number(SMTP_PORT.value()), secure: Number(SMTP_PORT.value()) === 465,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
    });
    const summary = `Patient: ${appointment.name}\nEmail: ${appointment.email}\nPhone: ${appointment.phone}\nService: ${appointment.serviceName}\nDate: ${appointment.date}\nTime: ${appointment.time} IST\nDuration: ${appointment.duration} minutes\nConcern: ${appointment.message || "Not provided"}\nGateway: ${appointment.paymentProvider}\nPayment reference: ${appointment.paymentId || appointment.gatewayOrderId}`;
    const manageUrl = `${APP_BASE_URL.value().replace(/\/$/, "")}/manage-appointment.html?id=${encodeURIComponent(appointmentId)}&token=${encodeURIComponent(appointment.pendingManageToken)}`;
    await Promise.all([
      transporter.sendMail({ from: SMTP_USER.value(), to: ADMIN_EMAIL.value(), subject: `Confirmed dental appointment: ${appointment.date} ${appointment.time}`, text: `A paid appointment has been confirmed.\n\n${summary}` }),
      transporter.sendMail({ from: SMTP_USER.value(), to: appointment.email, subject: "Your Glow Dental appointment is confirmed", text: `Hello ${appointment.name},\n\nYour ${appointment.serviceName} appointment is confirmed for ${appointment.date} at ${appointment.time} IST.\n\nBooking reference: ${appointmentId}\nPayment reference: ${appointment.paymentId || appointment.gatewayOrderId}\n\nManage, reschedule or cancel securely:\n${manageUrl}\n\nYou can also complete your private medical intake form through that link. Please arrive 10 minutes early.\n\nGlow Dental Hospital` })
    ]);
    await db.ref(`appointments/${appointmentId}`).update({ notificationSentAt: Date.now(), pendingManageToken: null });
  } catch (error) {
    await db.ref(`appointmentNotifications/${appointmentId}`).remove();
    logger.error("Appointment archive/email failed", { appointmentId, error: error.message });
  }
}

async function confirmAppointment(appointmentId, payment) {
  const ref = db.ref(`appointments/${appointmentId}`);
  const before = await ref.get();
  if (!before.exists()) throw new Error("Appointment reservation not found");
  if (before.val().status === "confirmed") {
    await syncClinicCalendar(appointmentId, before.val(), "upsert");
    await sendConfirmation(appointmentId, before.val());
    return before.val();
  }

  // Claim the slot before confirming the appointment. If an unusually late gateway
  // callback arrives after the hold was released, this prevents a double booking.
  const appointmentBefore = before.val();
  const keys = slotKeys(appointmentBefore);
  const slotClaim = await slotsRef(appointmentBefore).transaction((current) => {
    if (!current || keys.some((key) => !current[key] || current[key].appointmentId !== appointmentId)) return;
    keys.forEach((key) => { current[key] = { appointmentId, status: "confirmed", bookedAt: Date.now() }; });
    return current;
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
  await syncClinicCalendar(appointmentId, appointment, "upsert");
  await sendConfirmation(appointmentId, appointment);
  return appointment;
}

function requireAppCheck(request) {
  if (ENFORCE_APP_CHECK.value() === "true" && !request.app) throw new HttpsError("failed-precondition", "App verification failed. Refresh the page and try again.");
}

async function checkRateLimit(request, action, limit) {
  const ip = request.rawRequest && request.rawRequest.ip || "unknown";
  const key = crypto.createHash("sha256").update(`${action}:${ip}:${istToday()}`).digest("hex");
  const result = await db.ref(`rateLimits/${key}`).transaction((current) => {
    const value = current || { count: 0, expiresAt: Date.now() + 48 * 60 * 60 * 1000 };
    if (value.count >= limit) return;
    value.count += 1;
    return value;
  }, undefined, false);
  if (!result.committed) throw new HttpsError("resource-exhausted", "Too many attempts. Please try again later.");
}

async function audit(actor, action, appointmentId, details) {
  await db.ref("auditLogs").push({ actor, action, appointmentId: appointmentId || null, details: details || null, at: Date.now() });
}

function requireAdmin(request) {
  if (!request.auth || request.auth.token.admin !== true) throw new HttpsError("permission-denied", "Administrator access is required.");
  return request.auth.uid;
}

exports.getBookingCatalog = onCall({ region: REGION }, async () => ({ doctor: DOCTOR, services: Object.values(SERVICES) }));

exports.getUnavailableSlots = onCall({ region: REGION }, async (request) => {
  const date = text(request.data && request.data.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError("invalid-argument", "Invalid date.");
  const snapshot = await db.ref(`appointmentSlots/${DOCTOR.id}/${date}`).get();
  const now = Date.now();
  const slots = [];
  snapshot.forEach((child) => {
    const value = child.val();
    if (isActiveSlot(value, now)) slots.push(child.key.replace("-", ":"));
  });
  return { slots };
});

exports.createAppointmentPayment = onCall({ region: REGION, secrets: [STRIPE_SECRET_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  requireAppCheck(request);
  await checkRateLimit(request, "create-payment", 12);
  const appointment = validateAppointment(request.data && request.data.appointment);
  const provider = text(request.data && request.data.provider, 10);
  if (!["stripe", "razorpay"].includes(provider)) throw new HttpsError("invalid-argument", "Choose Stripe or Razorpay.");
  const amount = feeInPaise();
  const appointmentId = db.ref("appointments").push().key;
  const reservationId = crypto.randomUUID();
  const manageToken = crypto.randomBytes(32).toString("hex");
  await reserveSlot(appointment, appointmentId, reservationId);
  const stored = { ...appointment, paymentProvider: provider, amount, currency: "INR", status: "pending_payment", reservationId, userId: request.auth ? request.auth.uid : null, manageTokenHash: crypto.createHash("sha256").update(manageToken).digest("hex"), pendingManageToken: manageToken, createdAt: Date.now(), expiresAt: Date.now() + HOLD_MS, source: "website" };
  await db.ref(`appointments/${appointmentId}`).set(stored);
  try {
    if (provider === "stripe") {
      if (!STRIPE_SECRET_KEY.value()) throw new HttpsError("failed-precondition", "Stripe is not configured yet.");
      const baseUrl = APP_BASE_URL.value().replace(/\/$/, "");
      if (!baseUrl) throw new HttpsError("failed-precondition", "The website URL has not been configured.");
      const stripe = new Stripe(STRIPE_SECRET_KEY.value());
      const session = await stripe.checkout.sessions.create({
        mode: "payment", customer_email: appointment.email,
        line_items: [{ quantity: 1, price_data: { currency: "inr", unit_amount: amount, product_data: { name: `${appointment.serviceName} booking fee`, description: `${appointment.date} at ${appointment.time} IST with ${DOCTOR.name}` } } }],
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
  snapshot.forEach((doctorSnapshot) => doctorSnapshot.forEach((dateSnapshot) => dateSnapshot.forEach((slotSnapshot) => {
    const slot = slotSnapshot.val();
    if (slot.status === "pending_payment" && Number(slot.expiresAt) <= now) {
      updates[`appointmentSlots/${doctorSnapshot.key}/${dateSnapshot.key}/${slotSnapshot.key}`] = null;
      updates[`appointments/${slot.appointmentId}/status`] = "expired";
      updates[`appointments/${slot.appointmentId}/expiredAt`] = now;
    }
  })));
  const rateSnapshot = await db.ref("rateLimits").get();
  rateSnapshot.forEach((child) => { if (Number(child.val().expiresAt) <= now) updates[`rateLimits/${child.key}`] = null; });
  if (Object.keys(updates).length) await db.ref().update(updates);
});


function tokenMatches(appointment, token) {
  if (!appointment.manageTokenHash || !token) return false;
  const actual = crypto.createHash("sha256").update(String(token)).digest("hex");
  return actual.length === appointment.manageTokenHash.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(appointment.manageTokenHash));
}

function canManage(request, appointment) {
  return (request.auth && appointment.userId === request.auth.uid) || tokenMatches(appointment, request.data && request.data.token);
}

function publicAppointment(id, value) {
  return {
    id, name: value.name, email: value.email, phone: value.phone, serviceId: value.serviceId,
    serviceName: value.serviceName, doctorName: DOCTOR.name, date: value.date, time: value.time,
    duration: value.duration, message: value.message, status: value.status, paymentStatus: value.paymentStatus,
    paymentProvider: value.paymentProvider, amount: value.amount, currency: value.currency,
    createdAt: value.createdAt, confirmedAt: value.confirmedAt, intakeCompleted: !!value.intakeCompleted,
    reminder24SentAt: value.reminder24SentAt || null, reminder2SentAt: value.reminder2SentAt || null
  };
}

async function loadManageableAppointment(request) {
  const id = text(request.data && request.data.appointmentId, 40);
  const snapshot = await db.ref(`appointments/${id}`).get();
  if (!snapshot.exists() || !canManage(request, snapshot.val())) throw new HttpsError("permission-denied", "This secure appointment link is invalid or expired.");
  return { id, ref: snapshot.ref, appointment: snapshot.val() };
}

async function sendSimpleEmail(to, subject, body) {
  if (!SMTP_USER.value() || !SMTP_PASS.value()) throw new Error("SMTP is not configured");
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST.value(), port: Number(SMTP_PORT.value()), secure: Number(SMTP_PORT.value()) === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
  });
  return transporter.sendMail({ from: SMTP_USER.value(), to, subject, text: body });
}

exports.getManagedAppointment = onCall({ region: REGION }, async (request) => {
  await checkRateLimit(request, "manage-view", 60);
  const result = await loadManageableAppointment(request);
  return { appointment: publicAppointment(result.id, result.appointment), cancellationHours: Number(CANCELLATION_HOURS.value()) };
});

exports.patientListAppointments = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in to see your appointments.");
  if (!request.auth.token.email_verified) throw new HttpsError("permission-denied", "Verify your email before viewing appointments.");
  const snapshot = await db.ref("appointments").orderByChild("userId").equalTo(request.auth.uid).get();
  const appointments = [];
  snapshot.forEach((child) => appointments.push(publicAppointment(child.key, child.val())));
  appointments.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return { appointments };
});

exports.manageAppointment = onCall({ region: REGION, secrets: [SMTP_USER, SMTP_PASS] }, async (request) => {
  requireAppCheck(request);
  await checkRateLimit(request, "manage-change", 20);
  const managed = await loadManageableAppointment(request);
  const action = text(request.data.action, 20);
  if (managed.appointment.status !== "confirmed") throw new HttpsError("failed-precondition", "Only confirmed appointments can be changed.");
  const old = managed.appointment;
  const visitAt = new Date(`${old.date}T${old.time}:00+05:30`).getTime();
  const refundEligible = visitAt - Date.now() >= Number(CANCELLATION_HOURS.value()) * 3600000;

  if (action === "cancel") {
    await releaseReservedSlots(old, managed.id);
    await managed.ref.update({ status: "cancelled", cancelledAt: Date.now(), cancelledBy: "patient", refundStatus: refundEligible ? "requested" : "not_eligible" });
    await syncClinicCalendar(managed.id, old, "delete");
    await archiveAppointment(managed.id, (await managed.ref.get()).val());
    await audit(request.auth ? request.auth.uid : "secure-link", "patient_cancelled", managed.id, { refundEligible });
    try { await sendSimpleEmail(ADMIN_EMAIL.value(), `Appointment cancelled: ${managed.id}`, `${old.name} cancelled ${old.date} at ${old.time}. Refund status: ${refundEligible ? "requested" : "not eligible"}.`); } catch (error) { logger.error("Cancellation email failed", error); }
    return { success: true, status: "cancelled", refundEligible };
  }

  if (action === "reschedule") {
    const updated = validateAppointment({ ...old, date: request.data.date, time: request.data.time });
    if (updated.date === old.date && updated.time === old.time) throw new HttpsError("invalid-argument", "Please choose a different time.");
    const reservationId = crypto.randomUUID();
    if (updated.date === old.date) {
      const oldKeys = slotKeys(old); const newKeys = slotKeys(updated); const now = Date.now();
      const moved = await slotsRef(old).transaction((current) => {
        if (!current || newKeys.some((key) => isActiveSlot(current[key], now) && current[key].appointmentId !== managed.id)) return;
        oldKeys.forEach((key) => { if (current[key] && current[key].appointmentId === managed.id) delete current[key]; });
        newKeys.forEach((key) => { current[key] = { appointmentId: managed.id, status: "confirmed", bookedAt: now }; });
        return current;
      }, undefined, false);
      if (!moved.committed) throw new HttpsError("already-exists", "That time is no longer available.");
    } else {
      await reserveSlot(updated, managed.id, reservationId);
      try {
        await releaseReservedSlots(old, managed.id);
        await slotsRef(updated).transaction((current) => {
          if (!current) return;
          slotKeys(updated).forEach((key) => { if (current[key] && current[key].appointmentId === managed.id) current[key] = { appointmentId: managed.id, status: "confirmed", bookedAt: Date.now() }; });
          return current;
        }, undefined, false);
      } catch (error) {
        await releaseReservedSlots(updated, managed.id, reservationId);
        throw error;
      }
    }
    await managed.ref.update({ date: updated.date, time: updated.time, reservationId, rescheduledAt: Date.now(), previousSlot: `${old.date} ${old.time}` });
    await syncClinicCalendar(managed.id, { ...old, date: updated.date, time: updated.time }, "upsert");
    await archiveAppointment(managed.id, (await managed.ref.get()).val());
    await audit(request.auth ? request.auth.uid : "secure-link", "patient_rescheduled", managed.id, { from: `${old.date} ${old.time}`, to: `${updated.date} ${updated.time}` });
    try {
      await Promise.all([
        sendSimpleEmail(old.email, "Your Glow Dental appointment was rescheduled", `Your appointment is now ${updated.date} at ${updated.time} IST. Booking reference: ${managed.id}.`),
        sendSimpleEmail(ADMIN_EMAIL.value(), `Appointment rescheduled: ${managed.id}`, `${old.name} moved from ${old.date} ${old.time} to ${updated.date} ${updated.time}.`)
      ]);
    } catch (error) { logger.error("Reschedule email failed", error); }
    return { success: true, status: "confirmed", date: updated.date, time: updated.time };
  }
  throw new HttpsError("invalid-argument", "Unsupported appointment action.");
});

exports.saveMedicalIntake = onCall({ region: REGION }, async (request) => {
  requireAppCheck(request);
  const managed = await loadManageableAppointment(request);
  const input = request.data.intake || {};
  const intake = {
    allergies: text(input.allergies, 1000), medications: text(input.medications, 1000),
    conditions: text(input.conditions, 1000), previousDentalCare: text(input.previousDentalCare, 1000),
    emergencyName: text(input.emergencyName, 80), emergencyPhone: text(input.emergencyPhone, 18),
    pregnancy: ["yes", "no", "not-applicable"].includes(input.pregnancy) ? input.pregnancy : "not-applicable",
    consent: input.consent === true, submittedAt: Date.now()
  };
  if (!intake.consent || !intake.emergencyName || !/^[0-9+() -]{8,18}$/.test(intake.emergencyPhone)) throw new HttpsError("invalid-argument", "Complete the required intake consent and emergency contact.");
  await db.ref(`medicalIntake/${managed.id}`).set(intake);
  await getStorage().bucket().file(`medical-intake-archives/${managed.id}.json`).save(JSON.stringify({ appointmentId: managed.id, ...intake }, null, 2), { contentType: "application/json", resumable: false, metadata: { cacheControl: "private, no-store" } });
  await managed.ref.update({ intakeCompleted: true, intakeCompletedAt: Date.now() });
  await audit(request.auth ? request.auth.uid : "secure-link", "medical_intake_completed", managed.id);
  return { success: true };
});

exports.joinWaitlist = onCall({ region: REGION }, async (request) => {
  requireAppCheck(request);
  await checkRateLimit(request, "waitlist", 8);
  const input = request.data || {};
  const entry = {
    name: text(input.name, 80), email: text(input.email, 120).toLowerCase(), phone: text(input.phone, 18),
    date: text(input.date, 10), serviceId: text(input.serviceId, 30) || "consultation", preferredTime: text(input.time, 5) || "any",
    status: "waiting", createdAt: Date.now(), userId: request.auth ? request.auth.uid : null
  };
  if (!entry.name || !/^\S+@\S+\.\S+$/.test(entry.email) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !SERVICES[entry.serviceId]) throw new HttpsError("invalid-argument", "Enter valid waitlist details.");
  const id = db.ref("waitlist").push().key;
  await db.ref(`waitlist/${id}`).set(entry);
  await audit(request.auth ? request.auth.uid : "guest", "waitlist_joined", null, { waitlistId: id, date: entry.date });
  return { success: true, waitlistId: id };
});

exports.adminListAppointments = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  const snapshot = await db.ref("appointments").get();
  const appointments = [];
  snapshot.forEach((child) => {
    const { manageTokenHash, pendingManageToken, ...safe } = child.val();
    appointments.push({ id: child.key, ...safe });
  });
  appointments.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  const waitlistSnapshot = await db.ref("waitlist").get();
  const waitlist = []; waitlistSnapshot.forEach((child) => waitlist.push({ id: child.key, ...child.val() }));
  return { appointments, waitlist };
});

exports.adminGetMedicalIntake = onCall({ region: REGION }, async (request) => {
  requireAdmin(request);
  const appointmentId = text(request.data.appointmentId, 40);
  const snapshot = await db.ref(`medicalIntake/${appointmentId}`).get();
  if (!snapshot.exists()) throw new HttpsError("not-found", "No medical intake has been submitted.");
  return { intake: snapshot.val() };
});

exports.adminUpdateAppointment = onCall({ region: REGION, secrets: [STRIPE_SECRET_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SMTP_USER, SMTP_PASS] }, async (request) => {
  const adminUid = requireAdmin(request);
  const appointmentId = text(request.data.appointmentId, 40);
  const action = text(request.data.action, 30);
  const ref = db.ref(`appointments/${appointmentId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists()) throw new HttpsError("not-found", "Appointment not found.");
  const appointment = snapshot.val();

  if (["completed", "no_show"].includes(action)) {
    await ref.update({ status: action, updatedAt: Date.now(), updatedBy: adminUid });
  } else if (action === "cancel") {
    await releaseReservedSlots(appointment, appointmentId);
    await ref.update({ status: "cancelled", cancelledAt: Date.now(), cancelledBy: adminUid });
    await syncClinicCalendar(appointmentId, appointment, "delete");
  } else if (action === "resend_confirmation") {
    const manageToken = crypto.randomBytes(32).toString("hex");
    const refreshed = { ...appointment, pendingManageToken: manageToken, manageTokenHash: crypto.createHash("sha256").update(manageToken).digest("hex") };
    await ref.update({ pendingManageToken: manageToken, manageTokenHash: refreshed.manageTokenHash });
    await db.ref(`appointmentNotifications/${appointmentId}`).remove();
    await sendConfirmation(appointmentId, refreshed);
  } else if (action === "refund") {
    if (!appointment.paymentId || appointment.refundStatus === "refunded") throw new HttpsError("failed-precondition", "This payment cannot be refunded.");
    if (appointment.paymentProvider === "stripe") {
      await new Stripe(STRIPE_SECRET_KEY.value()).refunds.create({ payment_intent: appointment.paymentId, metadata: { appointmentId } });
    } else {
      const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID.value(), key_secret: RAZORPAY_KEY_SECRET.value() });
      await razorpay.payments.refund(appointment.paymentId, { notes: { appointmentId } });
    }
    await ref.update({ refundStatus: "refunded", refundedAt: Date.now(), refundedBy: adminUid });
  } else {
    throw new HttpsError("invalid-argument", "Unsupported administrator action.");
  }
  await archiveAppointment(appointmentId, (await ref.get()).val());
  await audit(adminUid, `admin_${action}`, appointmentId);
  if (["cancel", "refund"].includes(action)) {
    const subject = action === "refund" ? "Your Glow Dental refund was submitted" : "Your Glow Dental appointment was cancelled";
    const body = action === "refund"
      ? `Hello ${appointment.name},\n\nA refund for booking ${appointmentId} was submitted through ${appointment.paymentProvider}. Your bank or payment provider controls the final processing time.`
      : `Hello ${appointment.name},\n\nYour appointment on ${appointment.date} at ${appointment.time} IST was cancelled by the clinic. Please contact us if you need another time.`;
    try { await sendSimpleEmail(appointment.email, subject, body); } catch (error) { logger.error("Admin action email failed", { appointmentId, error: error.message }); }
  }
  return { success: true };
});

exports.adminBlockSlot = onCall({ region: REGION }, async (request) => {
  const adminUid = requireAdmin(request);
  const date = text(request.data.date, 10); const time = text(request.data.time, 5); const wholeDay = request.data.wholeDay === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!wholeDay && !/^\d{2}:(00|30)$/.test(time))) throw new HttpsError("invalid-argument", "Choose a valid date and time.");
  const unblock = request.data.unblock === true;
  const reason = text(request.data.reason, 120) || "Clinic unavailable";
  let result;
  if (wholeDay) {
    const chosen = new Date(`${date}T00:00:00Z`); const day = chosen.getUTCDay(); const hours = day === 0 ? [10, 16] : day === 6 ? [9, 18] : [9, 20];
    result = await db.ref(`appointmentSlots/${DOCTOR.id}/${date}`).transaction((current) => {
      const slots = current || {};
      if (!unblock && Object.values(slots).some((slot) => isActiveSlot(slot, Date.now()) && slot.status !== "blocked")) return;
      for (let minutes = hours[0] * 60; minutes < hours[1] * 60; minutes += 30) {
        const key = `${String(Math.floor(minutes / 60)).padStart(2, "0")}-${String(minutes % 60).padStart(2, "0")}`;
        if (unblock) { if (slots[key] && slots[key].status === "blocked") delete slots[key]; }
        else slots[key] = { status: "blocked", reason, blockedAt: Date.now(), blockedBy: adminUid };
      }
      return slots;
    }, undefined, false);
  } else {
    const key = time.replace(":", "-"); const ref = db.ref(`appointmentSlots/${DOCTOR.id}/${date}/${key}`);
    result = await ref.transaction((current) => {
      if (unblock) return current && current.status === "blocked" ? null : current;
      if (isActiveSlot(current, Date.now())) return;
      return { status: "blocked", reason, blockedAt: Date.now(), blockedBy: adminUid };
    }, undefined, false);
  }
  if (!result.committed) throw new HttpsError("already-exists", wholeDay ? "The day already has one or more appointments." : "That time already has an appointment.");
  await audit(adminUid, unblock ? "slot_unblocked" : "slot_blocked", null, { date, time: wholeDay ? "whole-day" : time });
  return { success: true };
});

exports.sendAppointmentReminders = onSchedule({ region: REGION, schedule: "every 60 minutes", timeZone: "Asia/Kolkata", secrets: [SMTP_USER, SMTP_PASS] }, async () => {
  const snapshot = await db.ref("appointments").get();
  const now = Date.now(); const tasks = [];
  snapshot.forEach((child) => {
    const appointment = child.val();
    if (appointment.status !== "confirmed") return;
    const visitAt = new Date(`${appointment.date}T${appointment.time}:00+05:30`).getTime();
    const hours = (visitAt - now) / 3600000;
    let key = null; let label = null;
    if (hours > 1 && hours <= 2.5 && !appointment.reminder2SentAt) { key = "reminder2SentAt"; label = "in about 2 hours"; }
    else if (hours > 23 && hours <= 25 && !appointment.reminder24SentAt) { key = "reminder24SentAt"; label = "tomorrow"; }
    if (key) tasks.push(sendSimpleEmail(appointment.email, `Appointment reminder — ${label}`, `Hello ${appointment.name},\n\nThis is a reminder that your ${appointment.serviceName} appointment is ${label}, on ${appointment.date} at ${appointment.time} IST. Please arrive 10 minutes early.\n\nGlow Dental Hospital`).then(() => child.ref.child(key).set(Date.now())).catch((error) => logger.error("Reminder failed", { appointmentId: child.key, error: error.message })));
  });
  await Promise.all(tasks);
});

function waitlistHasAvailability(entry, slotMap) {
  const chosen = new Date(`${entry.date}T00:00:00Z`);
  const day = chosen.getUTCDay(); const hours = day === 0 ? [10, 16] : day === 6 ? [9, 18] : [9, 20];
  const duration = (SERVICES[entry.serviceId] || SERVICES.consultation).duration;
  const starts = entry.preferredTime === "any" ? null : [entry.preferredTime];
  const candidates = starts || Array.from({ length: ((hours[1] - hours[0]) * 60 - duration) / 30 + 1 }, (_, index) => {
    const total = hours[0] * 60 + index * 30;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  });
  return candidates.some((start) => {
    const [h, m] = start.split(":").map(Number); const base = h * 60 + m;
    if (base < hours[0] * 60 || base + duration > hours[1] * 60) return false;
    for (let offset = 0; offset < duration; offset += 30) {
      const total = base + offset; const key = `${String(Math.floor(total / 60)).padStart(2, "0")}-${String(total % 60).padStart(2, "0")}`;
      if (isActiveSlot(slotMap[key], Date.now())) return false;
    }
    return true;
  });
}

exports.notifyWaitlist = onSchedule({ region: REGION, schedule: "every 60 minutes", timeZone: "Asia/Kolkata", secrets: [SMTP_USER, SMTP_PASS] }, async () => {
  const snapshot = await db.ref("waitlist").orderByChild("status").equalTo("waiting").get();
  const tasks = [];
  snapshot.forEach((child) => {
    const entry = child.val();
    if (entry.date < istToday()) { tasks.push(child.ref.update({ status: "expired", expiredAt: Date.now() })); return; }
    tasks.push(db.ref(`appointmentSlots/${DOCTOR.id}/${entry.date}`).get().then(async (slots) => {
      if (waitlistHasAvailability(entry, slots.val() || {})) {
        await sendSimpleEmail(entry.email, "A Glow Dental appointment may be available", `Hello ${entry.name},\n\nAn appointment may be available on ${entry.date}. Please book promptly at ${APP_BASE_URL.value().replace(/\/$/, "")}/appointment.html. Availability is first-come, first-served.`);
        await child.ref.update({ status: "notified", notifiedAt: Date.now() });
      }
    }).catch((error) => logger.error("Waitlist notification failed", { waitlistId: child.key, error: error.message })));
  });
  await Promise.all(tasks);
});
