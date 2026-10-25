/*
 * Default grocery catalogue.
 *
 * - `price` is ALWAYS the price for 1 kg (or 1 L where unit is "L").
 * - The amount a customer pays scales with the quantity they choose:
 *     amount = price x quantity
 *   e.g. Tomato at ₹40/kg  ->  250 g = ₹10, 500 g = ₹20, 2 kg = ₹80.
 * - Only the shop OWNER can change these prices, from the Owner Panel
 *   (admin.html). Owner edits are saved over this default list.
 */
(function (global) {
  "use strict";

  var DEFAULT_PRODUCTS = [
    /* ---------------- Vegetables ---------------- */
    { id: "veg-tomato",       name: "Tomato",            category: "Vegetables", price: 40,  unit: "kg", emoji: "🍅", inStock: true },
    { id: "veg-onion",        name: "Onion",             category: "Vegetables", price: 35,  unit: "kg", emoji: "🧅", inStock: true },
    { id: "veg-potato",       name: "Potato",            category: "Vegetables", price: 32,  unit: "kg", emoji: "🥔", inStock: true },
    { id: "veg-carrot",       name: "Carrot",            category: "Vegetables", price: 52,  unit: "kg", emoji: "🥕", inStock: true },
    { id: "veg-beans",        name: "Beans",             category: "Vegetables", price: 64,  unit: "kg", emoji: "🫛", inStock: true },
    { id: "veg-cabbage",      name: "Cabbage",           category: "Vegetables", price: 28,  unit: "kg", emoji: "🥬", inStock: true },
    { id: "veg-cauliflower",  name: "Cauliflower",       category: "Vegetables", price: 42,  unit: "kg", emoji: "🥦", inStock: true },
    { id: "veg-brinjal",      name: "Brinjal",           category: "Vegetables", price: 46,  unit: "kg", emoji: "🍆", inStock: true },
    { id: "veg-ladiesfinger", name: "Lady's Finger",     category: "Vegetables", price: 48,  unit: "kg", emoji: "🌿", inStock: true },
    { id: "veg-greenchilli",  name: "Green Chilli",      category: "Vegetables", price: 60,  unit: "kg", emoji: "🌶️", inStock: true },
    { id: "veg-capsicum",     name: "Capsicum",          category: "Vegetables", price: 55,  unit: "kg", emoji: "🫑", inStock: true },
    { id: "veg-cucumber",     name: "Cucumber",          category: "Vegetables", price: 35,  unit: "kg", emoji: "🥒", inStock: true },
    { id: "veg-beetroot",     name: "Beetroot",          category: "Vegetables", price: 45,  unit: "kg", emoji: "🟣", inStock: true },
    { id: "veg-pumpkin",      name: "Pumpkin",           category: "Vegetables", price: 30,  unit: "kg", emoji: "🎃", inStock: true },

    /* ---------------- Fruits ---------------- */
    { id: "fru-banana",       name: "Banana",            category: "Fruits", price: 62,  unit: "kg", emoji: "🍌", inStock: true },
    { id: "fru-apple",        name: "Apple",             category: "Fruits", price: 185, unit: "kg", emoji: "🍎", inStock: true },
    { id: "fru-mango",        name: "Mango",             category: "Fruits", price: 130, unit: "kg", emoji: "🥭", inStock: true },
    { id: "fru-orange",       name: "Orange",            category: "Fruits", price: 95,  unit: "kg", emoji: "🍊", inStock: true },
    { id: "fru-papaya",       name: "Papaya",            category: "Fruits", price: 55,  unit: "kg", emoji: "🍈", inStock: true },
    { id: "fru-watermelon",   name: "Watermelon",        category: "Fruits", price: 32,  unit: "kg", emoji: "🍉", inStock: true },
    { id: "fru-grapes",       name: "Grapes",            category: "Fruits", price: 85,  unit: "kg", emoji: "🍇", inStock: true },
    { id: "fru-pomegranate",  name: "Pomegranate",       category: "Fruits", price: 165, unit: "kg", emoji: "🔴", inStock: true },

    /* ---------------- Rice & Grains ---------------- */
    { id: "grn-sonamasoori",  name: "Sona Masoori Rice", category: "Rice & Grains", price: 68,  unit: "kg", emoji: "🍚", inStock: true },
    { id: "grn-basmati",      name: "Basmati Rice",      category: "Rice & Grains", price: 125, unit: "kg", emoji: "🌾", inStock: true },
    { id: "grn-atta",         name: "Wheat atta",       category: "Rice & Grains", price: 48,  unit: "kg", emoji: "🫓", inStock: true },
    { id: "grn-ragi",         name: "Ragi Flour",        category: "Rice & Grains", price: 55,  unit: "kg", emoji: "⚫", inStock: true },
    { id: "grn-maida",        name: "Maida",             category: "Rice & Grains", price: 42,  unit: "kg", emoji: "⚪", inStock: true },
    { id: "grn-rava",         name: "Sooji / Rava",      category: "Rice & Grains", price: 46,  unit: "kg", emoji: "🥣", inStock: true },
    { id: "grn-poha",         name: "Poha (Avalakki)",   category: "Rice & Grains", price: 55,  unit: "kg", emoji: "🍥", inStock: true },

    /* ---------------- Dal & Pulses ---------------- */
    { id: "dal-toor",         name: "Toor Dal",          category: "Dal & Pulses", price: 155, unit: "kg", emoji: "🟠", inStock: true },
    { id: "dal-moong",        name: "Moong Dal",         category: "Dal & Pulses", price: 145, unit: "kg", emoji: "🟡", inStock: true },
    { id: "dal-urad",         name: "Urad Dal",          category: "Dal & Pulses", price: 150, unit: "kg", emoji: "⚪", inStock: true },
    { id: "dal-chana",        name: "Kabuli Chana",      category: "Dal & Pulses", price: 95,  unit: "kg", emoji: "🫘", inStock: true },
    { id: "dal-greenmoong",   name: "Green Moong (Whole)", category: "Dal & Pulses", price: 130, unit: "kg", emoji: "🟢", inStock: true },
    { id: "dal-masoor",       name: "Masoor Dal",        category: "Dal & Pulses", price: 95,  unit: "kg", emoji: "🔶", inStock: true },

    /* ---------------- Oils & Ghee (priced per 1 L / 1 kg) ---------------- */
    { id: "oil-sunflower",    name: "Sunflower Oil",     category: "Oils & Ghee", price: 135, unit: "L",  emoji: "🌻", inStock: true },
    { id: "oil-groundnut",    name: "Groundnut Oil",     category: "Oils & Ghee", price: 180, unit: "L",  emoji: "🥜", inStock: true },
    { id: "oil-coconut",      name: "Coconut Oil",       category: "Oils & Ghee", price: 220, unit: "L",  emoji: "🥥", inStock: true },
    { id: "oil-ghee",         name: "Ghee",              category: "Oils & Ghee", price: 650, unit: "kg", emoji: "🫙", inStock: true },

    /* ---------------- Dairy ---------------- */
    { id: "dai-milk",         name: "Milk",              category: "Dairy", price: 62,  unit: "L",  emoji: "🥛", inStock: true },
    { id: "dai-curd",         name: "Curd",              category: "Dairy", price: 72,  unit: "kg", emoji: "🍦", inStock: true },
    { id: "dai-paneer",       name: "Paneer",            category: "Dairy", price: 360, unit: "kg", emoji: "🧀", inStock: true },
    { id: "dai-butter",       name: "Butter",            category: "Dairy", price: 560, unit: "kg", emoji: "🧈", inStock: true },

    /* ---------------- Spices & Masala ---------------- */
    { id: "spi-turmeric",     name: "Turmeric Powder",   category: "Spices & Masala", price: 320,  unit: "kg", emoji: "🟨", inStock: true },
    { id: "spi-chillipowder", name: "Red Chilli Powder", category: "Spices & Masala", price: 360,  unit: "kg", emoji: "🌶️", inStock: true },
    { id: "spi-coriander",    name: "Coriander Powder",  category: "Spices & Masala", price: 300,  unit: "kg", emoji: "🌿", inStock: true },
    { id: "spi-garammasala",  name: "Garam Masala",      category: "Spices & Masala", price: 650,  unit: "kg", emoji: "✨", inStock: true },
    { id: "spi-pepper",       name: "Black Pepper",      category: "Spices & Masala", price: 900,  unit: "kg", emoji: "⚫", inStock: true },
    { id: "spi-jeera",        name: "Cumin (Jeera)",     category: "Spices & Masala", price: 550,  unit: "kg", emoji: "🌾", inStock: true },
    { id: "spi-mustard",      name: "Mustard Seeds",     category: "Spices & Masala", price: 140,  unit: "kg", emoji: "🟤", inStock: true },
    { id: "spi-cardamom",     name: "Cardamom",          category: "Spices & Masala", price: 3200, unit: "kg", emoji: "🟢", inStock: true },

    /* ---------------- essentials & Dry Fruits ---------------- */
    { id: "ess-sugar",        name: "Sugar",             category: "Daily essentials", price: 46,  unit: "kg", emoji: "🍬", inStock: true },
    { id: "ess-jaggery",      name: "Jaggery",           category: "Daily essentials", price: 65,  unit: "kg", emoji: "🟫", inStock: true },
    { id: "ess-salt",         name: "Salt",              category: "Daily essentials", price: 28,  unit: "kg", emoji: "🧂", inStock: true },
    { id: "ess-tea",          name: "Tea Powder",        category: "Daily essentials", price: 480, unit: "kg", emoji: "🍵", inStock: true },
    { id: "ess-coffee",       name: "Coffee Powder",     category: "Daily essentials", price: 550, unit: "kg", emoji: "☕", inStock: true },
    { id: "ess-cashew",       name: "Cashew",            category: "Daily essentials", price: 850, unit: "kg", emoji: "🥜", inStock: true },
    { id: "ess-almond",       name: "Almond (Badam)",    category: "Daily essentials", price: 950, unit: "kg", emoji: "🌰", inStock: true },
    { id: "ess-raisins",      name: "Raisins",           category: "Daily essentials", price: 420, unit: "kg", emoji: "🍇", inStock: true },
    { id: "ess-dates",        name: "Dates",             category: "Daily essentials", price: 320, unit: "kg", emoji: "🌴", inStock: true }
  ];

  var CATEGORIES = [
    "Vegetables",
    "Fruits",
    "Rice & Grains",
    "Dal & Pulses",
    "Oils & Ghee",
    "Dairy",
    "Spices & Masala",
    "Daily essentials"
  ];

  /* Quantity choices offered to customers (in kg / L). 1 kg is the default. */
  var QUANTITY_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

  global.GS_DEFAULT_PRODUCTS = DEFAULT_PRODUCTS;
  global.GS_CATEGORIES = CATEGORIES;
  global.GS_QUANTITY_OPTIONS = QUANTITY_OPTIONS;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      DEFAULT_PRODUCTS: DEFAULT_PRODUCTS,
      CATEGORIES: CATEGORIES,
      QUANTITY_OPTIONS: QUANTITY_OPTIONS
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
