/*
 * Owner Panel logic (admin.html).
 * ONLY the shop owner (with the password) can:
 *   - change item prices (per 1 kg / 1 L) and stock status
 *   - add / remove items, export / import the catalogue
 *   - set the shop's GPS location and the delivery-charge rates
 *   - view orders placed on this device
 * Customers never see these controls.
 */
(function () {
  "use strict";

  var S = window.GrocerStore;
  var SESSION_KEY = "gs_owner_session";
  var settings = S.getSettings();
  var products = S.getProducts();
  var adminSearch = "";

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
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function isLoggedIn() {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; }
  }
  function setLoggedIn(v) {
    try {
      if (v) sessionStorage.setItem(SESSION_KEY, "1");
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  /* ---------------- login / logout ---------------- */
  function showDashboard() {
    $("loginPanel").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    $("adminShopName").textContent = "Owner Panel — " + settings.shopName;
    renderPriceTable();
    fillSettingsForm();
    renderOrders();
  }
  function showLogin() {
    $("loginPanel").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
    $("logoutBtn").classList.add("hidden");
    $("ownerPassword").value = "";
  }

  function handleLogin(e) {
    e.preventDefault();
    var entered = $("ownerPassword").value;
    settings = S.getSettings();
    S.sha256Hex(entered).then(function (hash) {
      /* Hash compare; if SubtleCrypto is unavailable (plain http), fall back
         to checking the well-known default so the owner is never locked out
         of a fresh install. */
      var ok = hash && hash === settings.ownerPasswordHash;
      if (!ok && !hash && entered === "admin123" &&
          settings.ownerPasswordHash === S.DEFAULT_SETTINGS.ownerPasswordHash) {
        ok = true;
      }
      $("loginError").style.display = ok ? "none" : "block";
      if (ok) {
        setLoggedIn(true);
        showDashboard();
        toast("✅ Welcome, owner!");
      }
    });
  }

  /* ---------------- price table ---------------- */
  function renderPriceTable() {
    var q = adminSearch.trim().toLowerCase();
    var rows = products.filter(function (p) {
      return !q || (p.name + " " + p.category).toLowerCase().indexOf(q) !== -1;
    });
    $("priceTableBody").innerHTML = rows.map(function (p) {
      return (
        '<tr data-row="' + p.id + '">' +
          "<td>" + esc(p.emoji || "🛒") + " <strong>" + esc(p.name) + "</strong></td>" +
          "<td>" + esc(p.category) + "</td>" +
          '<td><input class="price-input" type="number" min="0" step="0.5" value="' +
            esc(p.price) + '" data-price="' + p.id + '" data-original="' + esc(p.price) +
            '" aria-label="Price per 1 ' + esc(p.unit) + ' for ' + esc(p.name) + '"> / 1 ' + esc(p.unit) + "</td>" +
          '<td><label class="switch-row"><input type="checkbox" data-stock="' + p.id + '"' +
            (p.inStock ? " checked" : "") + "> <span>" + (p.inStock ? "In stock" : "Out") + "</span></label></td>" +
          '<td><button type="button" class="remove-link" data-delete="' + p.id + '" title="Remove item">🗑️</button></td>' +
        "</tr>"
      );
    }).join("");

    $("priceTableBody").querySelectorAll("[data-price]").forEach(function (input) {
      input.addEventListener("input", function () {
        input.classList.toggle(
          "changed",
          parseFloat(input.value) !== parseFloat(input.getAttribute("data-original"))
        );
      });
    });
    $("priceTableBody").querySelectorAll("[data-stock]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        cb.nextElementSibling.textContent = cb.checked ? "In stock" : "Out";
      });
    });
    $("priceTableBody").querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-delete");
        var p = S.getProductById(products, id);
        if (!window.confirm("Remove “" + (p ? p.name : id) + "” from the shop?")) return;
        saveTableIntoProducts(); // keep any unsaved edits to other rows
        products = products.filter(function (x) { return x.id !== id; });
        S.saveProducts(products);
        renderPriceTable();
        toast("🗑️ Item removed");
      });
    });
  }

  /* Read the (possibly filtered) table back into the products array. */
  function saveTableIntoProducts() {
    document.querySelectorAll("[data-price]").forEach(function (input) {
      var p = S.getProductById(products, input.getAttribute("data-price"));
      var v = parseFloat(input.value);
      if (p && !isNaN(v) && v >= 0) p.price = S.round2(v);
    });
    document.querySelectorAll("[data-stock]").forEach(function (cb) {
      var p = S.getProductById(products, cb.getAttribute("data-stock"));
      if (p) p.inStock = cb.checked;
    });
  }

  function handleSavePrices() {
    saveTableIntoProducts();
    S.saveProducts(products);
    renderPriceTable();
    toast("💾 Prices saved! The shop is updated.");
  }

  /* ---------------- add item / catalogue tools ---------------- */
  function fillCategorySelect() {
    var cats = (window.GS_CATEGORIES || []).slice();
    products.forEach(function (p) {
      if (cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    $("newCategory").innerHTML = cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
    }).join("");
  }

  function handleAddItem(e) {
    e.preventDefault();
    var name = $("newName").value.trim();
    var price = parseFloat($("newPrice").value);
    if (!name || isNaN(price) || price < 0) {
      toast("⚠️ Please enter an item name and a valid price");
      return;
    }
    saveTableIntoProducts();
    var id = "item-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") +
      "-" + Date.now().toString(36);
    products.push({
      id: id, name: name, category: $("newCategory").value || "Daily essentials",
      price: S.round2(price), unit: $("newUnit").value,
      emoji: $("newEmoji").value.trim() || "🛒", inStock: true
    });
    S.saveProducts(products);
    e.target.reset();
    fillCategorySelect();
    renderPriceTable();
    toast("✅ “" + name + "” added to the shop");
  }

  function handleExport() {
    saveTableIntoProducts();
    var blob = new Blob([JSON.stringify(products, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "grocery-catalogue.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("⬇️ Catalogue downloaded");
  }

  function handleImport(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data) || !data.length ||
            !data.every(function (p) { return p && p.id && p.name && typeof p.price === "number"; })) {
          throw new Error("bad file");
        }
        products = data;
        S.saveProducts(products);
        fillCategorySelect();
        renderPriceTable();
        toast("✅ Catalogue imported (" + data.length + " items)");
      } catch (err) {
        toast("⚠️ Could not import that file");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  /* ---------------- settings ---------------- */
  function ratePreviewText(s) {
    var examples = [0.5, 1, 2, 3, 5].map(function (km) {
      return km + " km → " + S.formatINR(S.deliveryCharge(km, s));
    });
    return "Preview: " + examples.join("  •  ");
  }
  function fillSettingsForm() {
    settings = S.getSettings();
    $("setShopName").value = settings.shopName;
    $("setTagline").value = settings.tagline;
    $("setPhoneDisplay").value = settings.phoneDisplay;
    $("setWhatsapp").value = settings.whatsappNumber;
    $("setAddress").value = settings.address;
    $("setLat").value = settings.shopLat;
    $("setLng").value = settings.shopLng;
    $("setMinCharge").value = settings.minDeliveryCharge;
    $("setIncludedKm").value = settings.includedKm;
    $("setPerKm").value = settings.perKmRate;
    $("newPassword").value = "";
    $("ratePreview").textContent = ratePreviewText(settings);
  }
  function liveRatePreview() {
    var s = {
      minDeliveryCharge: parseFloat($("setMinCharge").value) || 0,
      includedKm: parseFloat($("setIncludedKm").value) || 0,
      perKmRate: parseFloat($("setPerKm").value) || 0
    };
    $("ratePreview").textContent = ratePreviewText(s);
  }

  function handleUseMyLocation() {
    var status = $("shopLocStatus");
    if (!("geolocation" in navigator)) {
      status.className = "loc-status err";
      status.textContent = "⚠️ This browser has no location support. Type the coordinates manually.";
      return;
    }
    status.className = "loc-status";
    status.textContent = "⏳ Detecting… stand inside the shop and allow location access.";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        $("setLat").value = pos.coords.latitude;
        $("setLng").value = pos.coords.longitude;
        status.className = "loc-status ok";
        status.textContent = "✅ Location captured. Now press “Save Settings” below.";
      },
      function () {
        status.className = "loc-status err";
        status.textContent = "⚠️ Location denied/unavailable. Type the coordinates manually (from Google Maps).";
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  function handleSaveSettings(e) {
    e.preventDefault();
    var next = S.getSettings();
    next.shopName = $("setShopName").value.trim() || next.shopName;
    next.tagline = $("setTagline").value.trim() || next.tagline;
    next.phoneDisplay = $("setPhoneDisplay").value.trim() || next.phoneDisplay;
    next.whatsappNumber = $("setWhatsapp").value.replace(/\D/g, "") || next.whatsappNumber;
    next.address = $("setAddress").value.trim() || next.address;
    var lat = parseFloat($("setLat").value), lng = parseFloat($("setLng").value);
    if (!isNaN(lat) && lat >= -90 && lat <= 90) next.shopLat = lat;
    if (!isNaN(lng) && lng >= -180 && lng <= 180) next.shopLng = lng;
    var min = parseFloat($("setMinCharge").value);
    var inc = parseFloat($("setIncludedKm").value);
    var per = parseFloat($("setPerKm").value);
    if (!isNaN(min) && min >= 0) next.minDeliveryCharge = min;
    if (!isNaN(inc) && inc >= 0) next.includedKm = inc;
    if (!isNaN(per) && per >= 0) next.perKmRate = per;

    var newPw = $("newPassword").value;
    var finish = function () {
      S.saveSettings(next);
      settings = S.getSettings();
      $("adminShopName").textContent = "Owner Panel — " + settings.shopName;
      $("ratePreview").textContent = ratePreviewText(settings);
      $("newPassword").value = "";
      toast("💾 Settings saved!");
    };
    if (newPw) {
      if (newPw.length < 6) { toast("⚠️ New password must be at least 6 characters"); return; }
      S.sha256Hex(newPw).then(function (hash) {
        if (!hash) { toast("⚠️ Password change needs a secure (https) connection"); return; }
        next.ownerPasswordHash = hash;
        finish();
        toast("🔑 Password changed — remember it for next login!");
      });
    } else {
      finish();
    }
  }

  /* ---------------- orders ---------------- */
  var ORDER_STATUSES = ["New", "Packed", "Out for Delivery", "Delivered", "Cancelled"];
  function renderOrders() {
    var orders = S.getOrders();
    $("noOrders").classList.toggle("hidden", orders.length > 0);
    $("ordersList").innerHTML = orders.map(function (o, idx) {
      var when = "";
      try { when = new Date(o.placedAt).toLocaleString("en-IN"); } catch (e) {}
      var statusOpts = ORDER_STATUSES.map(function (st) {
        return '<option value="' + st + '"' + (o.status === st ? " selected" : "") + ">" + st + "</option>";
      }).join("");
      return (
        '<div class="order-card">' +
          '<div class="oc-head">' +
            "<strong>🧾 " + esc(o.id) + "</strong>" +
            '<span style="color:var(--muted);font-size:.85rem;">' + esc(when) + "</span>" +
            '<span class="status-tag' + (o.status === "Delivered" ? " delivered" : "") + '">' + esc(o.status) + "</span>" +
          "</div>" +
          "<p style='margin-top:6px;'><strong>" + esc(o.customer.name) + "</strong> • " +
            '<a href="tel:+91' + esc(o.customer.phone) + '">' + esc(o.customer.phone) + "</a><br>" +
            "<span style='color:var(--muted);'>" + esc(o.customer.address) + "</span>" +
            (o.customer.note ? "<br><em>Note: " + esc(o.customer.note) + "</em>" : "") +
            (o.location && o.location.mapsLink
              ? '<br><a href="' + esc(o.location.mapsLink) + '" target="_blank" rel="noopener">📍 Open customer location in Maps</a>'
              : "") +
          "</p>" +
          "<ul>" + o.items.map(function (it) {
            return "<li>" + esc(it.emoji || "") + " " + esc(it.name) + " — " +
              S.qtyLabel(it.qty, it.unit) + " × " + S.formatINR(it.ratePerUnit) + "/" + esc(it.unit) +
              " = <strong>" + S.formatINR(it.amount) + "</strong></li>";
          }).join("") + "</ul>" +
          "<p>Items: <strong>" + S.formatINR(o.itemsTotal) + "</strong> + Delivery (" +
            esc(o.distanceKm) + " km): <strong>" + S.formatINR(o.deliveryCharge) + "</strong> = " +
            "Grand Total: <strong>" + S.formatINR(o.grandTotal) + "</strong></p>" +
          '<div class="toolbar" style="margin:10px 0 0;">' +
            '<label style="font-size:.88rem;font-weight:700;">Status: ' +
            '<select data-order-status="' + idx + '">' + statusOpts + "</select></label>" +
          "</div>" +
        "</div>"
      );
    }).join("");

    $("ordersList").querySelectorAll("[data-order-status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var orders2 = S.getOrders();
        var i = parseInt(sel.getAttribute("data-order-status"), 10);
        if (orders2[i]) {
          orders2[i].status = sel.value;
          S.saveOrders(orders2);
          renderOrders();
          toast("✅ Order status updated");
        }
      });
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    fillCategorySelect();
    $("loginForm").addEventListener("submit", handleLogin);
    $("logoutBtn").addEventListener("click", function () {
      setLoggedIn(false);
      showLogin();
      toast("Logged out. See you soon!");
    });
    $("adminSearch").addEventListener("input", function (e) {
      saveTableIntoProducts(); /* don't lose edits when re-filtering */
      adminSearch = e.target.value;
      renderPriceTable();
    });
    $("savePricesBtn").addEventListener("click", handleSavePrices);
    $("resetCatalogBtn").addEventListener("click", function () {
      if (!window.confirm("Reset ALL items and prices to the default list? Your changes will be lost.")) return;
      products = S.resetProducts();
      fillCategorySelect();
      renderPriceTable();
      toast("↩️ Catalogue reset to defaults");
    });
    $("addItemForm").addEventListener("submit", handleAddItem);
    $("exportBtn").addEventListener("click", handleExport);
    $("importFile").addEventListener("change", handleImport);
    $("settingsForm").addEventListener("submit", handleSaveSettings);
    $("useMyLocationBtn").addEventListener("click", handleUseMyLocation);
    ["setMinCharge", "setIncludedKm", "setPerKm"].forEach(function (id) {
      $(id).addEventListener("input", liveRatePreview);
    });
    $("refreshOrdersBtn").addEventListener("click", renderOrders);
    $("clearDeliveredBtn").addEventListener("click", function () {
      var kept = S.getOrders().filter(function (o) { return o.status !== "Delivered"; });
      S.saveOrders(kept);
      renderOrders();
      toast("🧹 Delivered orders cleared");
    });

    if (isLoggedIn()) showDashboard(); else showLogin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
