# 🛒 FreshMart Grocery — Online Grocery Ordering Website

A simple, mobile-friendly website for a local grocery shop. Customers order
from home, the **owner alone can change prices**, and the **delivery charge is
calculated automatically from the customer's location**.

Built with plain HTML, CSS and JavaScript — no server or build step needed.
It can be hosted free on **GitHub Pages**.

---

## ✨ Features

### For customers (`index.html`)
- 🥦 Full grocery catalogue — vegetables, fruits, rice & grains, dal & pulses,
  oils & ghee, dairy, spices and daily essentials (60 items included, owner can add more)
- ⚖️ **Prices shown per 1 kg / 1 L** — pick a quantity (100 g, 250 g, 500 g,
  1 kg, 2 kg, 5 kg…) and the price scales automatically
  *(e.g. Tomato ₹40/kg → 500 g = ₹20)*
- 🔍 Search and category filters
- 🧺 Cart with quantity steppers and a clear bill (items + delivery = grand total)
- 📍 **Location access**: the site asks for the customer's location and
  measures the distance from the shop (Haversine/GPS)
- 🚚 **Delivery charge rule**
  - Up to **1 km → ₹35** (minimum delivery charge)
  - Beyond 1 km → **₹35 + ₹25 per extra km** (pro-rata, rounded to nearest ₹)
  - If GPS is denied/unavailable, the customer can enter the distance manually
- 💬 One-tap **"Send order to shop on WhatsApp"** with items, bill, address
  and a Google Maps location link
- 💵 Pay on delivery (Cash / UPI)

### For the shop owner (`admin.html`) — password protected
- 💲 Change the **price of any item** (per 1 kg / 1 L) — customers can never edit prices
- ✅ Mark items in stock / out of stock, add new items, remove items
- 📍 Set the **shop's GPS location** ("Use my current location" in the shop,
  or paste coordinates from Google Maps)
- 🚚 Change delivery rates (minimum charge, included km, ₹ per extra km)
- 🏪 Change shop name, phone / WhatsApp number and address
- 🔑 Change the owner password
- 🧾 View orders placed on this device and update their status
- 📦 Export / import the price list as a JSON file (backup / move between devices)

**Default owner password: `admin123`** — change it after your first login
(Owner Panel → Shop Settings → Change owner password).

---

## 🚚 How the delivery charge is calculated

```
distance = GPS distance between the shop and the customer's home (km)

if distance ≤ 1 km:    delivery = ₹35
if distance > 1 km:    delivery = ₹35 + (distance − 1) × ₹25
```

| Distance from shop | Delivery charge |
|--------------------|-----------------|
| 0.5 km             | ₹35 |
| 1 km               | ₹35 |
| 2 km               | ₹60 |
| 2.5 km             | ₹73 |
| 3 km               | ₹85 |
| 5 km               | ₹135 |

> All three numbers (₹35, 1 km, ₹25/km) are configurable by the owner in
> **Owner Panel → Shop Settings → Delivery charge rates**.

---

## 🚀 How to run / publish

### Option A — GitHub Pages (free, recommended)
1. Push this repo to GitHub (already done if you received the link).
2. Go to **Settings → Pages** in the repo.
3. Under "Build and deployment", choose **Deploy from a branch** →
   branch `main`, folder `/ (root)` → **Save**.
4. Your shop is live at `https://<your-username>.github.io/grocery-shop-website/`
   - Customer shop: `…/index.html`
   - Owner panel: `…/admin.html`

> 📍 **Location access needs HTTPS** — GitHub Pages is HTTPS by default, so the
> "Detect My Location" button works there. It also works on `localhost`.

### Option B — Just open the file
Open `index.html` in a browser. Everything works except browser location on
some non-secure setups; the manual-distance option covers that case.

### Local test server
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

---

## 🧭 First-time setup checklist (owner)

1. Open **`admin.html`** and log in with `admin123`.
2. **Shop Settings**:
   - Set your real **shop name, phone number and WhatsApp number**
     (orders are sent to this WhatsApp number).
   - Standing inside the shop, tap **"📍 Use My Current Location as Shop Location"**
     so delivery distances are measured from your actual shop.
     *(Default coordinates point to Mysuru city centre — change them!)*
   - Confirm delivery rates: **₹35 / 1 km / ₹25 per extra km**, or adjust.
   - Set a **new owner password**.
   - Press **Save Settings**.
3. **Item Prices**: review the 60 default prices and set your shop's real
   rates per 1 kg, then **Save All Prices**.
4. Share the shop link with customers on WhatsApp / a printed QR code.

---

## ⚠️ Important note about where data is stored

This is a **static website with no backend**, so to keep it free and simple,
prices, settings and orders are saved in the browser's **localStorage**:

- Price changes made in the Owner Panel take effect **on that device/browser**.
- Orders placed by a customer are stored on the **customer's** device — which
  is why the checkout also offers **"Send order to shop on WhatsApp"**: that
  message is how the order reliably reaches the shop today.

### Going fully live (recommended next step)
To make owner price changes sync to **every customer's phone** and collect all
orders in one owner dashboard, connect a backend such as **Firebase**
(Firestore + Firebase Auth):

1. Create a Firebase project and enable Firestore + Email/Password auth.
2. Store the product list and settings as Firestore documents; write orders
   to an `orders` collection.
3. Replace the `getProducts / saveProducts / getSettings / saveSettings /
   addOrder / getOrders` functions in `js/store.js` with Firestore calls —
   the rest of the site (UI, cart, delivery-charge logic) stays the same.
4. Protect writes with Firestore security rules so only the owner's account
   can change prices.

The functions in `js/store.js` were deliberately kept small and centralised to
make this swap easy.

---

## 📁 Project structure

```
grocery-shop-website/
├── index.html          # Customer storefront (items, cart, checkout)
├── admin.html          # Owner panel (prices, location, rates, orders)
├── css/
│   └── style.css       # All styling (mobile-first)
└── js/
    ├── products.js     # Default catalogue — prices per 1 kg / 1 L
    ├── store.js        # Storage, money formatting, distance + delivery charge
    ├── app.js          # Storefront logic
    └── admin.js        # Owner panel logic
```

## 🧪 Quick logic test

```bash
node -e "
const s = require('./js/store.js');
const st = s.DEFAULT_SETTINGS;
console.log('0.5 km ->', s.deliveryCharge(0.5, st)); // 35
console.log('1 km   ->', s.deliveryCharge(1, st));   // 35
console.log('2 km   ->', s.deliveryCharge(2, st));   // 60
console.log('5 km   ->', s.deliveryCharge(5, st));   // 135
console.log('Mysuru Palace to city centre ≈',
  s.haversineKm(12.3052, 76.6552, 12.2958, 76.6394).toFixed(2), 'km');
"
```

*(Note: in Node, load `js/products.js` first or set
`global.GS_DEFAULT_PRODUCTS` if you call catalogue functions — the delivery
functions above work standalone.)*
