/*
 * Shared store logic: settings, catalogue persistence, cart/orders storage,
 * money & quantity formatting, distance + delivery-charge calculation.
 *
 * Data is kept in the browser's localStorage so this static site works on
 * GitHub Pages with no server. See README.md ("Going live / syncing") for
 * how to plug in Firebase later so owner price changes sync to every phone.
 */
(function (global) {
  "use strict";

  var KEYS = {
    products: "gs_products_v1",
    settings: "gs_settings_v1",
    orders: "gs_orders_v1",
    cart: "gs_cart_v1"
  };

  /*
   * Shop settings — the owner can change all of these from admin.html.
   *
   * Delivery charge rule (as requested by the shop):
   *   - up to `includedKm` (1 km) from the shop  ->  `minDeliveryCharge` (₹35)
   *   - beyond that, add `perKmRate` (₹25) for every extra km (pro-rata,
   *     rounded to the nearest rupee).
   *   Examples: 0.6 km -> ₹35 | 1 km -> ₹35 | 2 km -> ₹60 | 3 km -> ₹85 |
   *             2.5 km -> ₹73 | 5 km -> ₹135
   *
   * `shopLat` / `shopLng` default to Mysuru city centre — the owner MUST set
   * these to the shop's real location (Owner Panel -> Shop Settings ->
   * "Use my current location" while standing in the shop).
   *
   * `ownerPasswordHash` is the SHA-256 of the default password "admin123".
   * The owner should change the password after first login.
   */
  var DEFAULT_SETTINGS = {
    shopName: "FreshMart Grocery",
    tagline: "Fresh groceries, delivered to your home",
    phoneDisplay: "+91 99999 99999",
    whatsappNumber: "919999999999",
    address: "Main Road, Mysuru, Karnataka",
    shopLat: 12.2958,
    shopLng: 76.6394,
    minDeliveryCharge: 35,
    includedKm: 1,
    perKmRate: 25,
    ownerPasswordHash:
      "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"
  };

  /* ---------- tiny storage helpers (no-ops outside a browser) ---------- */
  function readJSON(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* ---------- settings ---------- */
  function getSettings() {
    var saved = readJSON(KEYS.settings, {});
    var out = clone(DEFAULT_SETTINGS);
    Object.keys(saved || {}).forEach(function (k) {
      if (saved[k] !== undefined && saved[k] !== null && saved[k] !== "") {
        out[k] = saved[k];
      }
    });
    /* keep numeric fields numeric even if saved from form inputs */
    ["shopLat", "shopLng", "minDeliveryCharge", "includedKm", "perKmRate"].forEach(
      function (k) {
        out[k] = parseFloat(out[k]);
        if (isNaN(out[k])) out[k] = DEFAULT_SETTINGS[k];
      }
    );
    return out;
  }
  function saveSettings(settings) {
    return writeJSON(KEYS.settings, settings);
  }

  /* ---------- products ---------- */
  function getProducts() {
    var saved = readJSON(KEYS.products, null);
    if (Array.isArray(saved) && saved.length) return saved;
    return clone(global.GS_DEFAULT_PRODUCTS || []);
  }
  function saveProducts(products) {
    return writeJSON(KEYS.products, products);
  }
  function resetProducts() {
    try {
      global.localStorage.removeItem(KEYS.products);
    } catch (e) {}
    return getProducts();
  }
  function getProductById(products, id) {
    for (var i = 0; i < products.length; i++) {
      if (products[i].id === id) return products[i];
    }
    return null;
  }

  /* ---------- orders ---------- */
  function getOrders() {
    var saved = readJSON(KEYS.orders, []);
    return Array.isArray(saved) ? saved : [];
  }
  function saveOrders(orders) {
    return writeJSON(KEYS.orders, orders);
  }
  function addOrder(order) {
    var orders = getOrders();
    orders.unshift(order);
    saveOrders(orders);
    return order;
  }

  /* ---------- cart: { productId: quantityInUnit } ---------- */
  function getCart() {
    var saved = readJSON(KEYS.cart, {});
    return saved && typeof saved === "object" ? saved : {};
  }
  function saveCart(cart) {
    return writeJSON(KEYS.cart, cart);
  }
  function clearCart() {
    saveCart({});
  }

  /* ---------- money & quantity formatting ---------- */
  function round2(n) {
    return Math.round(n * 100) / 100;
  }
  function formatINR(n) {
    var v = round2(Number(n) || 0);
    return (
      "₹" +
      v.toLocaleString("en-IN", {
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
        maximumFractionDigits: 2
      })
    );
  }
  /* 0.25 kg -> "250 g" | 0.5 kg -> "500 g" | 1.5 kg -> "1.5 kg" | 0.5 L -> "500 ml" */
  function qtyLabel(qty, unit) {
    qty = round2(Number(qty) || 0);
    if (unit === "L") {
      return qty < 1 ? Math.round(qty * 1000) + " ml" : qty + " L";
    }
    return qty < 1 ? Math.round(qty * 1000) + " g" : qty + " kg";
  }
  function unitPriceLabel(product) {
    return formatINR(product.price) + " / 1 " + product.unit;
  }
  /* Price for a chosen quantity: rate is per 1 kg / 1 L, so scale linearly. */
  function priceFor(product, qty) {
    return round2((Number(product.price) || 0) * (Number(qty) || 0));
  }

  /* ---------- distance & delivery charge ---------- */
  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }
  /* Great-circle distance in km between two GPS points (Haversine formula). */
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /*
   * Delivery charge for a given distance:
   *   distance <= includedKm  ->  minDeliveryCharge            (₹35 up to 1 km)
   *   distance  > includedKm  ->  min + (distance - includedKm) x perKmRate
   * Rounded to the nearest rupee. Returns null when distance is unknown.
   */
  function deliveryCharge(distanceKm, settings) {
    if (distanceKm === null || distanceKm === undefined || isNaN(distanceKm)) {
      return null;
    }
    settings = settings || DEFAULT_SETTINGS;
    var min = Number(settings.minDeliveryCharge) || 0;
    var included = Number(settings.includedKm) || 0;
    var perKm = Number(settings.perKmRate) || 0;
    if (distanceKm <= included) return min;
    return Math.round(min + (distanceKm - included) * perKm);
  }
  function deliveryBreakdown(distanceKm, settings) {
    var charge = deliveryCharge(distanceKm, settings);
    if (charge === null) return "Detect your location to see the delivery charge";
    settings = settings || DEFAULT_SETTINGS;
    var d = round2(distanceKm);
    if (distanceKm <= settings.includedKm) {
      return (
        d +
        " km away — within " +
        settings.includedKm +
        " km, so minimum delivery charge " +
        formatINR(charge)
      );
    }
    var extraKm = round2(distanceKm - settings.includedKm);
    return (
      d +
      " km away — " +
      formatINR(settings.minDeliveryCharge) +
      " (first " +
      settings.includedKm +
      " km) + " +
      extraKm +
      " km × " +
      formatINR(settings.perKmRate) +
      " = " +
      formatINR(charge)
    );
  }

  /* ---------- owner auth (demo-grade, client side) ---------- */
  function sha256Hex(text) {
    /* Returns a Promise<string> of the hex SHA-256 (browser SubtleCrypto). */
    if (global.crypto && global.crypto.subtle && global.TextEncoder) {
      var data = new global.TextEncoder().encode(text);
      return global.crypto.subtle.digest("SHA-256", data).then(function (buf) {
        return Array.prototype.map
          .call(new Uint8Array(buf), function (b) {
            return ("00" + b.toString(16)).slice(-2);
          })
          .join("");
      });
    }
    return Promise.resolve(null);
  }

  function makeOrderId() {
    var stamp = Date.now().toString(36).toUpperCase();
    var rand = Math.floor(Math.random() * 900 + 100);
    return "ORD-" + stamp.slice(-6) + rand;
  }

  var api = {
    KEYS: KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getProducts: getProducts,
    saveProducts: saveProducts,
    resetProducts: resetProducts,
    getProductById: getProductById,
    getOrders: getOrders,
    saveOrders: saveOrders,
    addOrder: addOrder,
    getCart: getCart,
    saveCart: saveCart,
    clearCart: clearCart,
    round2: round2,
    formatINR: formatINR,
    qtyLabel: qtyLabel,
    unitPriceLabel: unitPriceLabel,
    priceFor: priceFor,
    haversineKm: haversineKm,
    deliveryCharge: deliveryCharge,
    deliveryBreakdown: deliveryBreakdown,
    sha256Hex: sha256Hex,
    makeOrderId: makeOrderId
  };

  global.GrocerStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
