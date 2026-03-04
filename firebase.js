(function () {
	const defaultFirebaseConfig = {
		apiKey: "YOUR_FIREBASE_API_KEY",
		authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
		databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
		projectId: "YOUR_PROJECT_ID",
		storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
		messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
		appId: "YOUR_APP_ID"
	};

	const firebaseConfig = window.FIREBASE_CONFIG || defaultFirebaseConfig;

	const hasValidConfig =
		firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_") &&
		firebaseConfig.databaseURL && !firebaseConfig.databaseURL.includes("YOUR_");

	if (!window.firebase) {
		console.error("Firebase SDK not loaded. Add firebase-app-compat and firebase-database-compat scripts before firebase.js.");
		window.firebaseBackend = {
			isConfigured: false
		};
		return;
	}

	if (hasValidConfig && !firebase.apps.length) {
		firebase.initializeApp(firebaseConfig);
	} else if (!hasValidConfig) {
		console.error("Firebase is not configured. Add real values in firebase-config.js or firebase.js.");
	}

	const database = hasValidConfig ? firebase.database() : null;

	window.firebaseBackend = {
		isConfigured: !!database,

		saveAppointment: function (appointmentData) {
			if (!database) {
				return Promise.reject(new Error("Firebase is not configured."));
			}

			return database.ref("appointments").push({
				...appointmentData,
				createdAt: new Date().toISOString(),
				source: "website"
			});
		},

		saveReview: function (reviewData) {
			if (!database) {
				return Promise.reject(new Error("Firebase is not configured."));
			}

			return database.ref("reviews").push({
				...reviewData,
				createdAt: new Date().toISOString(),
				source: "website"
			});
		},

		loadReviews: async function () {
			if (!database) {
				throw new Error("Firebase is not configured.");
			}

			const snapshot = await database.ref("reviews").once("value");
			const reviews = [];

			snapshot.forEach(function (childSnapshot) {
				reviews.push({
					id: childSnapshot.key,
					...childSnapshot.val()
				});
			});

			return reviews.sort(function (a, b) {
				return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
			});
		},

		subscribeReviews: function (onUpdate, onError) {
			if (!database) {
				if (typeof onError === "function") {
					onError(new Error("Firebase is not configured."));
				}
				return function () {};
			}

			const reviewsRef = database.ref("reviews");

			const valueListener = function (snapshot) {
				const reviews = [];

				snapshot.forEach(function (childSnapshot) {
					reviews.push({
						id: childSnapshot.key,
						...childSnapshot.val()
					});
				});

				reviews.sort(function (a, b) {
					return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
				});

				onUpdate(reviews);
			};

			reviewsRef.on("value", valueListener, function (error) {
				if (typeof onError === "function") {
					onError(error);
				}
			});

			return function () {
				reviewsRef.off("value", valueListener);
			};
		}
	};
})();