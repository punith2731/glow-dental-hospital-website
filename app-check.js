(function(){
  const key=window.APP_CHECK_SITE_KEY;
  if(!window.firebase||!firebase.appCheck||!key||key.includes("YOUR_")) return;
  try{firebase.appCheck().activate(key,true);}catch(error){console.error("Firebase App Check initialization failed",error);}
})();
