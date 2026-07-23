const admin = require('firebase-admin');

// 1. Check for Firebase Service Account Secret
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountRaw) {
  console.error("❌ ERROR: FIREBASE_SERVICE_ACCOUNT secret is missing in GitHub Repository Settings!");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountRaw);
} catch (err) {
  console.error("❌ ERROR: FIREBASE_SERVICE_ACCOUNT is not valid JSON text. Please re-copy the downloaded JSON key file.");
  process.exit(1);
}

// 2. Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// 3. Fetch Sports Events from TheSportsDB (Free Public Sports API)
async function fetchSportsEvents() {
  console.log("⚽ Fetching upcoming Football & Cricket events...");
  const events = [];

  try {
    // English Premier League events
    const resEpl = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328');
    const dataEpl = await resEpl.json();
    if (dataEpl && dataEpl.events) {
      dataEpl.events.slice(0, 5).forEach(e => {
        events.push({
          id: `epl_${e.idEvent}`,
          name: `${e.strHomeTeam} vs ${e.strAwayTeam}`,
          category: 'Football',
          title: e.strLeague || 'Premier League',
          team1Name: e.strHomeTeam || 'Team A',
          team2Name: e.strAwayTeam || 'Team B',
          team1Logo: e.strHomeTeamBadge || '',
          team2Logo: e.strAwayTeamBadge || '',
          startTime: new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}`).getTime(),
          endTime: new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}`).getTime() + (2 * 60 * 60 * 1000),
          isHidden: false
        });
      });
    }

    // UEFA Champions League events
    const resUcl = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4480');
    const dataUcl = await resUcl.json();
    if (dataUcl && dataUcl.events) {
      dataUcl.events.slice(0, 5).forEach(e => {
        events.push({
          id: `ucl_${e.idEvent}`,
          name: `${e.strHomeTeam} vs ${e.strAwayTeam}`,
          category: 'Football',
          title: e.strLeague || 'Champions League',
          team1Name: e.strHomeTeam || 'Team A',
          team2Name: e.strAwayTeam || 'Team B',
          team1Logo: e.strHomeTeamBadge || '',
          team2Logo: e.strAwayTeamBadge || '',
          startTime: new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}`).getTime(),
          endTime: new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}`).getTime() + (2 * 60 * 60 * 1000),
          isHidden: false
        });
      });
    }
  } catch (err) {
    console.warn("⚠️ Warning fetching API data:", err.message);
  }

  // Fallback / Sample 10 Live Events if API returns less than 10
  if (events.length < 10) {
    console.log("ℹ️ Adding fallback active live sports events to ensure 10 total queue...");
    const now = Date.now();
    const fallbackList = [
      { name: "Real Madrid vs Barcelona", team1: "Real Madrid", team2: "Barcelona", cat: "Football", title: "El Clasico Special" },
      { name: "Arsenal vs Chelsea", team1: "Arsenal", team2: "Chelsea", cat: "Football", title: "Premier League" },
      { name: "Manchester City vs Liverpool", team1: "Man City", team2: "Liverpool", cat: "Football", title: "Premier League" },
      { name: "India vs Pakistan", team1: "India", team2: "Pakistan", cat: "Cricket", title: "Asia Cup Live" },
      { name: "Bangladesh vs Sri Lanka", team1: "Bangladesh", team2: "Sri Lanka", cat: "Cricket", title: "T20 International" },
      { name: "Australia vs England", team1: "Australia", team2: "England", cat: "Cricket", title: "The Ashes" },
      { name: "Bayern Munich vs PSG", team1: "Bayern Munich", team2: "PSG", cat: "Football", title: "UEFA Champions League" },
      { name: "Inter Milan vs AC Milan", team1: "Inter Milan", team2: "AC Milan", cat: "Football", title: "Serie A" },
      { name: "South Africa vs New Zealand", team1: "South Africa", team2: "New Zealand", cat: "Cricket", title: "World Cup Special" },
      { name: "Juventus vs Roma", team1: "Juventus", team2: "Roma", cat: "Football", title: "Serie A" }
    ];

    fallbackList.forEach((item, index) => {
      if (events.length < 10) {
        const eventTime = now + (index * 3600000); // 1 hour spacing
        events.push({
          id: `auto_event_${index + 1}`,
          name: item.name,
          category: item.cat,
          title: item.title,
          team1Name: item.team1,
          team2Name: item.team2,
          team1Logo: "",
          team2Logo: "",
          startTime: eventTime,
          endTime: eventTime + (2 * 3600000),
          isHidden: false
        });
      }
    });
  }

  // 4. Sort by match time and take EXACTLY top 10
  events.sort((a, b) => a.startTime - b.startTime);
  const final10Events = events.slice(0, 10);

  console.log(`🔥 Updating ${final10Events.length} events to Firebase Firestore...`);

  const batch = db.batch();
  final10Events.forEach(evt => {
    const docRef = db.collection('live_events').doc(evt.id);
    batch.set(docRef, evt, { merge: true });
  });

  await batch.commit();
  console.log("✅ SUCCESS: 10 Live Events successfully synced to Firebase Firestore!");
}

fetchSportsEvents().catch(err => {
  console.error("❌ Execution Error:", err);
  process.exit(1);
});
