/*
 * Storefront logic (customer side).
 * Customers can browse, search, add items by quantity and order.
 * They CANNOT change prices — prices are read-only here and are edited
 * only by the shop owner in admin.html.
 */
(function () {
  "use strict";

  var S = window.GrocerStore;
  var settings = S.getSettings();
  var products = S.getProducts();
  var cart = S.getCart(); // { productId: qty }
  var selectedQty = {}; // productId -> quantity chosen on its card
  var activeCategory = "All";
  var searchText = "";

  /* Customer location state (for the delivery charge) */
  var customerLoc = {
    lat: null,
    lng: null,
    distanceKm: null,
    source: null // "gps" | "manual"
  };

  /* ---------------- DOM helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

  /* ---------------- header / shop info ---------------- */
  function renderShopInfo() {
    document.title = settings.shopName + " — Order Groceries Online";
    $("shopName").textContent = settings.shopName;
    $("shopTagline").textContent = settings.tagline;
    $("footShopName").textContent = settings.shopName;
    $("footAddress").textContent = settings.address;
    var tel = "tel:+91" + String(settings.whatsappNumber || "").replace(/\D/g, "").slice(-10);
    $("callBtn").href = tel;
    $("callShopBtn2").href = tel;
    $("footPhone").href = tel;
    $("footPhone").textContent = settings.phoneDisplay;
    $("pillMin").textContent =
      S.formatINR(settings.minDeliveryCharge) + " within " + settings.includedKm + " km";
    $("pillPerKm").textContent = "+ " + S.formatINR(settings.perKmRate) + " per km";
  }

  /* ---------------- categories ---------------- */
  function renderChips() {
    var cats = ["All"];
    products.forEach(function (p) {
      if (cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    var box = $("categoryChips");
    box.innerHTML = "";
    cats.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (c === activeCategory ? " active" : "");
      b.textContent = c;
      b.addEventListener("click", function () {
        activeCategory = c;
        renderChips();
        renderProducts();
      });
      box.appendChild(b);
    });
  }

  /* ---------------- product grid ---------------- */
  function qtyOptionsHTML(product, chosen) {
    return (window.GS_QUANTITY_OPTIONS || [1]).map(function (q) {
      var sel = q === chosen ? " selected" : "";
      return '<option value="' + q + '"' + sel + ">" + S.qtyLabel(q, product.unit) +
        " — " + S.formatINR(S.priceFor(product, q)) + "</option>";
    }).join("");
  }

  function visibleProducts() {
    var q = searchText.trim().toLowerCase();
    return products.filter(function (p) {
      if (activeCategory !== "All" && p.category !== activeCategory) return false;
      if (q && (p.name + " " + p.category).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function renderProducts() {
    var grid = $("productGrid");
    var list = visibleProducts();
    $("emptyNote").classList.toggle("hidden", list.length > 0);
    grid.innerHTML = list.map(function (p) {
      var chosen = selectedQty[p.id] || 1;
      var inCartQty = cart[p.id] || 0;
      var action = "";
      if (!p.inStock) {
        action = '<button class="btn add-btn" disabled>Out of Stock</button>';
      } else if (inCartQty > 0) {
        action =
          '<div class="in-cart-row">' +
            '<button class="stepper-btn" data-step="-1" data-id="' + p.id + '" aria-label="Reduce quantity">−</button>' +
            '<span class="qty-now">In cart<br>' + S.qtyLabel(inCartQty, p.unit) + "</span>" +
            '<button class="stepper-btn" data-step="1" data-id="' + p.id + '" aria-label="Increase quantity">+</button>' +
          "</div>";
      } else {
        action = '<button class="btn primary add-btn" data-add="' + p.id + '">➕ Add to Cart</button>';
      }
      return (
        '<article class="card' + (p.inStock ? "" : " out") + '">' +
          (p.inStock ? "" : '<span class="badge-out">OUT OF STOCK</span>') +
          '<div class="emoji">' + esc(p.emoji || "🛒") + "</div>" +
          '<div class="cat">' + esc(p.category) + "</div>" +
          "<h3>" + esc(p.name) + "</h3>" +
          '<div class="price">' + S.formatINR(p.price) + " <small>/ 1 " + esc(p.unit) + "</small></div>" +
          '<label class="qty-label" for="qty-' + p.id + '">Quantity</label>' +
          '<select class="qty-select" id="qty-' + p.id + '" data-qtyfor="' + p.id + '"' +
            (p.inStock ? "" : " disabled") + ">" + qtyOptionsHTML(p, chosen) + "</select>" +
          '<div class="line-price">You pay: <strong id="pay-' + p.id + '">' +
            S.formatINR(S.priceFor(p, chosen)) + "</strong> for " +
            '<span id="payq-' + p.id + '">' + S.qtyLabel(chosen, p.unit) + "</span></div>" +
          action +
        "</article>"
      );
    }).join("");

    /* wire up card controls */
    grid.querySelectorAll("[data-qtyfor]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var id = sel.getAttribute("data-qtyfor");
        var p = S.getProductById(products, id);
        var q = parseFloat(sel.value) || 1;
        selectedQty[id] = q;
        $("pay-" + id).textContent = S.formatINR(S.priceFor(p, q));
        $("payq-" + id).textContent = S.qtyLabel(q, p.unit);
      });
    });
    grid.querySelectorAll("[data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-add");
        var p = S.getProductById(products, id);
        var q = selectedQty[id] || 1;
        cart[id] = S.round2((cart[id] || 0) + q);
        persistCart();
        toast("✅ " + p.name + " (" + S.qtyLabel(q, p.unit) + ") added to cart");
        renderProducts();
      });
    });
    grid.querySelectorAll("[data-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        changeQty(btn.getAttribute("data-id"), parseInt(btn.getAttribute("data-step"), 10) * 0.25);
        renderProducts();
      });
    });
  }

  /* ---------------- cart ---------------- */
  function changeQty(id, delta) {
    var next = S.round2((cart[id] || 0) + delta);
    if (next <= 0) delete cart[id];
    else cart[id] = next;
    persistCart();
  }
  function persistCart() {
    S.saveCart(cart);
    renderCartBar();
    renderCartSheet();
  }
  function cartLinesData() {
    return Object.keys(cart).map(function (id) {
      var p = S.getProductById(products, id);
      if (!p) return null;
      var qty = cart[id];
      return { product: p, qty: qty, amount: S.priceFor(p, qty) };
    }).filter(Boolean);
  }
  function itemsTotal() {
    return S.round2(cartLinesData().reduce(function (sum, l) { return sum + l.amount; }, 0));
  }
  function cartItemCount() { return cartLinesData().length; }

  function renderCartBar() {
    var count = cartItemCount();
    var total = itemsTotal();
    $("cartCount").textContent = count;
    $("cartBar").classList.toggle("show", count > 0);
    $("cartBarTotal").textContent = S.formatINR(total);
    var dc = S.deliveryCharge(customerLoc.distanceKm, settings);
    $("cartBarMeta").textContent =
      count + (count === 1 ? " item" : " items") +
      (dc === null ? " • delivery extra" : " • incl. " + S.formatINR(total + dc) + " with delivery");
  }

  function renderCartSheet() {
    var lines = cartLinesData();
    var box = $("cartLines");
    $("cartEmpty").classList.toggle("hidden", lines.length > 0);
    $("checkoutForm").style.display = lines.length ? "" : "none";
    $("billBox").style.display = lines.length ? "" : "none";

    box.innerHTML = lines.map(function (l) {
      var p = l.product;
      return (
        '<div class="cart-line">' +
          '<div class="cl-emoji">' + esc(p.emoji || "🛒") + "</div>" +
          '<div class="cl-main">' +
            "<strong>" + esc(p.name) + "</strong>" +
            "<span>" + S.unitPriceLabel(p) + "</span><br>" +
            '<div class="mini-stepper" style="margin-top:5px;">' +
              '<button type="button" data-cstep="-0.25" data-id="' + p.id + '" aria-label="Less">−</button>' +
              '<span class="q">' + S.qtyLabel(l.qty, p.unit) + "</span>" +
              '<button type="button" data-cstep="0.25" data-id="' + p.id + '" aria-label="More">+</button>' +
              '<button type="button" class="remove-link" data-remove="' + p.id + '">Remove</button>' +
            "</div>" +
          "</div>" +
          '<div class="cl-amt">' + S.formatINR(l.amount) + "</div>" +
        "</div>"
      );
    }).join("");

    box.querySelectorAll("[data-cstep]").forEach(function (b) {
      b.addEventListener("click", function () {
        changeQty(b.getAttribute("data-id"), parseFloat(b.getAttribute("data-cstep")));
        renderProducts();
      });
    });
    box.querySelectorAll("[data-remove]").forEach(function (b) {
      b.addEventListener("click", function () {
        delete cart[b.getAttribute("data-remove")];
        persistCart();
        renderProducts();
      });
    });

    updateBill();
  }

  function updateBill() {
    var items = itemsTotal();
    var dc = S.deliveryCharge(customerLoc.distanceKm, settings);
    $("billItems").textContent = S.formatINR(items);
    $("billDelivery").textContent = dc === null ? "—" : S.formatINR(dc);
    $("billBreakdown").textContent =
      "🚚 " + S.deliveryBreakdown(customerLoc.distanceKm, settings) +
      (customerLoc.source === "manual" ? " (distance entered manually)" : "");
    $("billTotal").textContent = S.formatINR(items + (dc || 0));
    renderCartBar();
  }

  /* ---------------- location & delivery charge ---------------- */
  function setLocationUI(state, message) {
    /* state: "idle" | "loading" | "ok" | "error" */
    var topCard = $("locationCard");
    var status = $("locStatus");
    topCard.classList.toggle("ok", state === "ok");
    if (state === "ok") {
      var dc = S.deliveryCharge(customerLoc.distanceKm, settings);
      $("locTitle").textContent = "📍 Location detected — you are " +
        S.round2(customerLoc.distanceKm) + " km from our shop";
      $("locDetail").textContent = "Delivery charge for your order: " + S.formatINR(dc) +
        " (" + S.formatINR(settings.minDeliveryCharge) + " up to " + settings.includedKm +
        " km, then " + S.formatINR(settings.perKmRate) + "/km).";
      $("detectBtnTop").textContent = "🔄 Re-detect Location";
      status.className = "loc-status ok";
      status.textContent = "✅ " + S.deliveryBreakdown(customerLoc.distanceKm, settings);
    } else if (state === "loading") {
      $("locTitle").textContent = "Detecting your location…";
      $("locDetail").textContent = "Please allow location access if your browser asks.";
      status.className = "loc-status";
      status.textContent = "⏳ Detecting… please allow location access.";
    } else if (state === "error") {
      $("locTitle").textContent = "Could not detect your location";
      $("locDetail").textContent = message || "You can enter the distance manually at checkout.";
      status.className = "loc-status err";
      status.textContent = "⚠️ " + (message || "Location unavailable. Please enter the distance manually below.");
      $("manualDistBox").classList.add("show");
    }
    updateBill();
  }

  function detectLocation() {
    if (!("geolocation" in navigator)) {
      setLocationUI("error", "Your browser does not support location. Please enter the distance manually at checkout.");
      return;
    }
    setLocationUI("loading");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        customerLoc.lat = pos.coords.latitude;
        customerLoc.lng = pos.coords.longitude;
        customerLoc.distanceKm = S.round2(
          S.haversineKm(settings.shopLat, settings.shopLng, customerLoc.lat, customerLoc.lng)
        );
        customerLoc.source = "gps";
        setLocationUI("ok");
        toast("📍 Location detected: " + customerLoc.distanceKm + " km away");
      },
      function (err) {
        var msg = "Location access was denied or timed out. Please allow location, or enter the distance manually at checkout.";
        if (err && err.code === 1) msg = "Location permission denied. Tap “Enter distance manually” at checkout, or allow location in your browser settings and try again.";
        setLocationUI("error", msg);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  function initLocation() {
    $("detectBtnTop").addEventListener("click", detectLocation);
    $("detectBtn").addEventListener("click", detectLocation);
    $("manualToggle").addEventListener("click", function () {
      $("manualDistBox").classList.toggle("show");
      var input = $("manualKm");
      if ($("manualDistBox").classList.contains("show")) input.focus();
    });
    $("manualKm").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value);
      if (!isNaN(v) && v >= 0) {
        customerLoc.distanceKm = S.round2(v);
        customerLoc.source = "manual";
        customerLoc.lat = null;
        customerLoc.lng = null;
        setLocationUI("ok");
        $("locStatus").textContent += " (manual distance)";
      } else if (customerLoc.source === "manual") {
        customerLoc.distanceKm = null;
        customerLoc.source = null;
        updateBill();
      }
    });
    /* If the customer has already granted location permission before,
       detect silently so the delivery charge is ready right away. */
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then(function (res) {
        if (res.state === "granted") detectLocation();
      }).catch(function () {});
    }
  }

  /* ---------------- cart sheet open/close ---------------- */
  function openCart() {
    $("cartView").classList.remove("hidden");
    $("successView").classList.add("hidden");
    renderCartSheet();
    $("cartOverlay").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeCart() {
    $("cartOverlay").classList.remove("open");
    document.body.style.overflow = "";
  }

  /* ---------------- checkout ---------------- */
  function showError(id, show) { $(id).style.display = show ? "block" : "none"; }

  function validateCheckout() {
    var ok = true;
    var name = $("custName").value.trim();
    var phone = $("custPhone").value.replace(/\D/g, "");
    var address = $("custAddress").value.trim();
    showError("errName", !(name.length >= 2)); if (name.length < 2) ok = false;
    var phoneOk = /^\d{10}$/.test(phone);
    showError("errPhone", !phoneOk); if (!phoneOk) ok = false;
    var addrOk = address.length >= 10;
    showError("errAddress", !addrOk); if (!addrOk) ok = false;

    var general = $("errGeneral");
    if (cartItemCount() === 0) {
      general.textContent = "Your cart is empty — please add some items first.";
      general.style.display = "block"; ok = false;
    } else if (customerLoc.distanceKm === null) {
      general.textContent = "📍 Please detect your location (or enter the distance manually) so we can calculate the delivery charge.";
      general.style.display = "block"; ok = false;
      document.querySelector(".loc-box").scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      general.style.display = "none";
    }
    return ok ? { name: name, phone: phone, address: address } : null;
  }

  function placeOrder(e) {
    e.preventDefault();
    var customer = validateCheckout();
    if (!customer) { toast("⚠️ Please fix the highlighted details"); return; }

    var lines = cartLinesData();
    var items = itemsTotal();
    var dc = S.deliveryCharge(customerLoc.distanceKm, settings);
    var mapsLink = (customerLoc.lat !== null)
      ? "https://www.google.com/maps?q=" + customerLoc.lat + "," + customerLoc.lng
      : null;

    var order = {
      id: S.makeOrderId(),
      placedAt: new Date().toISOString(),
      customer: {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        note: $("custNote").value.trim()
      },
      items: lines.map(function (l) {
        return {
          id: l.product.id, name: l.product.name, emoji: l.product.emoji,
          qty: l.qty, unit: l.product.unit,
          ratePerUnit: l.product.price, amount: l.amount
        };
      }),
      itemsTotal: items,
      distanceKm: customerLoc.distanceKm,
      distanceSource: customerLoc.source,
      deliveryCharge: dc,
      grandTotal: S.round2(items + dc),
      location: { lat: customerLoc.lat, lng: customerLoc.lng, mapsLink: mapsLink },
      payment: "Pay on delivery",
      status: "New"
    };
    S.addOrder(order);

    /* WhatsApp message for the shop */
    var msgLines = [
      "🛒 *New Order — " + settings.shopName + "*",
      "Order ID: " + order.id,
      "------------------------------"
    ];
    order.items.forEach(function (it) {
      msgLines.push((it.emoji || "•") + " " + it.name + " — " +
        S.qtyLabel(it.qty, it.unit) + " × " + S.formatINR(it.ratePerUnit) + "/" + it.unit +
        " = " + S.formatINR(it.amount));
    });
    msgLines.push("------------------------------");
    msgLines.push("Items total: " + S.formatINR(order.itemsTotal));
    msgLines.push("Delivery (" + order.distanceKm + " km): " + S.formatINR(order.deliveryCharge));
    msgLines.push("*Grand Total: " + S.formatINR(order.grandTotal) + "* (pay on delivery)");
    msgLines.push("------------------------------");
    msgLines.push("Name: " + customer.name);
    msgLines.push("Phone: " + customer.phone);
    msgLines.push("Address: " + customer.address);
    if (order.customer.note) msgLines.push("Note: " + order.customer.note);
    if (mapsLink) msgLines.push("📍 Location: " + mapsLink);
    var waNumber = String(settings.whatsappNumber || "").replace(/\D/g, "");
    $("whatsappBtn").href = "https://wa.me/" + waNumber + "?text=" +
      encodeURIComponent(msgLines.join("\n"));

    /* success view */
    $("successOrderId").textContent = order.id;
    $("successSummary").innerHTML =
      "Thank you, <strong>" + esc(customer.name) + "</strong>! " +
      "Your order of <strong>" + order.items.length + " item(s)</strong> will be delivered to your address.<br>" +
      "Items: <strong>" + S.formatINR(order.itemsTotal) + "</strong> + Delivery (" +
      order.distanceKm + " km): <strong>" + S.formatINR(order.deliveryCharge) + "</strong> = " +
      "Grand Total <strong>" + S.formatINR(order.grandTotal) + "</strong>";
    $("successBill").innerHTML =
      order.items.map(function (it) {
        return '<div class="bill-row"><span>' + esc(it.emoji || "") + " " + esc(it.name) +
          " (" + S.qtyLabel(it.qty, it.unit) + ')</span><span>' + S.formatINR(it.amount) + "</span></div>";
      }).join("") +
      '<div class="bill-row"><span>Delivery (' + order.distanceKm + ' km)</span><span>' +
        S.formatINR(order.deliveryCharge) + "</span></div>" +
      '<div class="bill-row total"><span>Grand Total</span><span>' +
        S.formatINR(order.grandTotal) + "</span></div>" +
      '<p class="breakdown">🚚 ' + esc(S.deliveryBreakdown(order.distanceKm, settings)) + "</p>";

    cart = {};
    S.clearCart();
    renderCartBar();
    renderProducts();
    $("cartView").classList.add("hidden");
    $("successView").classList.remove("hidden");
    $("cartOverlay").classList.add("open");
    document.querySelector(".sheet").scrollTop = 0;
    toast("🎉 Order " + order.id + " placed!");
  }

  /* ---------------- init ---------------- */
  function init() {
    renderShopInfo();
    renderChips();
    renderProducts();
    renderCartBar();
    renderCartSheet();
    initLocation();

    $("searchInput").addEventListener("input", function (e) {
      searchText = e.target.value;
      renderProducts();
    });
    $("openCartBtn").addEventListener("click", openCart);
    $("openCartBtn2").addEventListener("click", openCart);
    $("closeCartBtn").addEventListener("click", closeCart);
    $("cartOverlay").addEventListener("click", function (e) {
      if (e.target === $("cartOverlay")) closeCart();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeCart();
    });
    $("checkoutForm").addEventListener("submit", placeOrder);
    $("continueBtn").addEventListener("click", closeCart);

    /* If the owner updates prices in another tab, refresh the storefront. */
    window.addEventListener("storage", function (e) {
      if (e.key === S.KEYS.products || e.key === S.KEYS.settings) {
        settings = S.getSettings();
        products = S.getProducts();
        renderShopInfo(); renderChips(); renderProducts(); renderCartSheet();
        toast("🔄 Prices updated by the shop");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
