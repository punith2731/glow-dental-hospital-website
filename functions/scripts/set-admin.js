"use strict";
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
initializeApp();
const email = process.argv[2];
if (!email) { console.error("Usage: npm run set-admin -- admin@example.com"); process.exit(1); }
getAuth().getUserByEmail(email).then(async (user) => {
  await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
  console.log(`Administrator access enabled for ${email}. The user must sign out and back in.`);
}).catch((error) => { console.error(error.message); process.exit(1); });
