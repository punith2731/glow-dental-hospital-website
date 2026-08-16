(function () {
  "use strict";

  const SLOT_MINUTES = 30;
  const HOURS = {
    weekday: [9, 20],
    saturday: [9, 18],
    sunday: [10, 16]
  };

  function showNotice(message, type) {
    const notice = document.getElementById("bookingNotice");
    notice.textContent = message;
    notice.className = "booking-notice " + (type || "info");
    notice.hidden = false;
    notice.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function setLoading(button, loading, text) {
    if (!button) return;
    if (loading) button.dataset.originalText = button.textContent;
    button.disabled = loading;
    button.textContent = loading ? text : (button.dataset.originalText || button.textContent);
  }

  function formatTime(value) {
    const parts = value.split(":");
    const date = new Date(2000, 0, 1, Number(parts[0]), Number(parts[1]));
    return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  }

  function getHours(dateString) {
    const day = new Date(dateString + "T12:00:00").getDay();
    return day === 0 ? HOURS.sunday : day === 6 ? HOURS.saturday : HOURS.weekday;
  }

  function buildSlots(dateString, unavailable) {
    const select = document.getElementById("time");
    const [start, end] = getHours(dateString);
    select.innerHTML = '<option value="">Select an available time</option>';
    for (let minutes = start * 60; minutes < end * 60; minutes += SLOT_MINUTES) {
      const value = String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatTime(value) + (unavailable.includes(value) ? " — unavailable" : "");
      option.disabled = unavailable.includes(value);
      select.appendChild(option);
    }
    select.disabled = false;
  }

  function collectData() {
    return {
      name: document.getElementById("name").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      date: document.getElementById("date").value,
      time: document.getElementById("time").value,
      message: document.getElementById("message").value.trim()
    };
  }

  function goToStep(step) {
    document.getElementById("detailsStep").hidden = step !== 1;
    document.getElementById("paymentStep").hidden = step !== 2;
    document.querySelectorAll("[data-step-indicator]").forEach(function (indicator) {
      indicator.classList.toggle("active", Number(indicator.dataset.stepIndicator) <= step);
    });
    document.getElementById("appointmentForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadAvailability(date) {
    const select = document.getElementById("time");
    const help = document.getElementById("slotHelp");
    select.disabled = true;
    select.innerHTML = '<option value="">Checking availability…</option>';
    help.textContent = "Checking live availability…";
    try {
      if (!window.firebaseBackend || !window.firebaseBackend.isConfigured) throw new Error("Booking service is not configured.");
      const unavailable = await window.firebaseBackend.getUnavailableSlots(date);
      buildSlots(date, unavailable);
      help.textContent = "Times are shown in India Standard Time. Unpaid reservations are held for up to 30 minutes.";
    } catch (error) {
      console.error(error);
      select.innerHTML = '<option value="">Availability unavailable</option>';
      help.textContent = "We could not load available times. Please try again.";
    }
  }

  function launchRazorpay(result, appointmentData, payButton) {
    if (!window.Razorpay) throw new Error("Razorpay Checkout did not load.");
    const options = {
      key: result.keyId,
      amount: result.amount,
      currency: result.currency,
      name: "Glow Dental Hospital",
      description: "Appointment booking fee",
      order_id: result.orderId,
      prefill: { name: appointmentData.name, email: appointmentData.email, contact: appointmentData.phone },
      notes: { appointmentId: result.appointmentId },
      theme: { color: "#0A6EBD" },
      handler: async function (response) {
        setLoading(payButton, true, "Confirming payment…");
        try {
          await window.firebaseBackend.verifyRazorpayPayment({
            appointmentId: result.appointmentId,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature
          });
          window.location.href = "appointment.html?payment=success&appointment=" + encodeURIComponent(result.appointmentId);
        } catch (error) {
          console.error(error);
          showNotice("Payment was received but confirmation is still processing. Please keep your payment reference; we will email you shortly.", "warning");
          setLoading(payButton, false);
        }
      },
      modal: { ondismiss: function () { setLoading(payButton, false); showNotice("Payment was cancelled. Your slot will be released automatically if payment is not completed.", "warning"); } }
    };
    new window.Razorpay(options).open();
  }

  document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("appointmentForm");
    if (!form) return;

    const dateInput = document.getElementById("date");
    const continueButton = document.getElementById("continueButton");
    const payButton = document.getElementById("payButton");
    const todayParts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const todayMap = Object.fromEntries(todayParts.map(function (part) { return [part.type, part.value]; }));
    dateInput.min = todayMap.year + "-" + todayMap.month + "-" + todayMap.day;

    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      showNotice("Payment successful! Your appointment is being confirmed. A confirmation email will arrive shortly.", "success");
      form.reset();
    } else if (params.get("payment") === "cancelled") {
      showNotice("Payment was cancelled. No appointment was confirmed; you may try again.", "warning");
    }

    dateInput.addEventListener("change", function () {
      if (this.value) loadAvailability(this.value);
    });

    continueButton.addEventListener("click", function () {
      const fields = document.getElementById("detailsStep").querySelectorAll("input, select, textarea");
      for (const field of fields) {
        if (!field.checkValidity()) { field.reportValidity(); return; }
      }
      const data = collectData();
      document.getElementById("summaryName").textContent = data.name;
      document.getElementById("summarySlot").textContent = new Date(data.date + "T12:00:00").toLocaleDateString("en-IN", { dateStyle: "long" }) + " at " + formatTime(data.time);
      goToStep(2);
    });

    document.getElementById("backButton").addEventListener("click", function () { goToStep(1); });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const provider = form.querySelector('input[name="paymentProvider"]:checked').value;
      const appointmentData = collectData();
      setLoading(payButton, true, "Securing your slot…");
      try {
        const result = await window.firebaseBackend.createAppointmentPayment({ appointment: appointmentData, provider: provider });
        if (provider === "stripe") {
          window.location.assign(result.checkoutUrl);
        } else {
          launchRazorpay(result, appointmentData, payButton);
        }
      } catch (error) {
        console.error("Could not start payment", error);
        const code = (error.code || "").toLowerCase();
        const message = code.includes("already-exists")
          ? "That time was just reserved by another patient. Please go back and choose another available time."
          : (error.message || "We could not start payment. Please try again.");
        showNotice(message, "error");
        setLoading(payButton, false);
        if (code.includes("already-exists")) loadAvailability(appointmentData.date);
      }
    });
  });
})();
