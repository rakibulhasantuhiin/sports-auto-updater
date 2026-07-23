const admin = require('firebase-admin');

// Firebase Service Account Credentials
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountJson) {
  console.error("ERROR: FIREBASE_SERVICE_ACCOUNT Secret is missing!");
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// 1. Fetch Cricket Matches (ESPN Scoreboard API)
async function fetchCricketEvents() {
  const events = [];
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/cricket/13875/scoreboard');
    const data = await res.json();

    if (data && data.events) {
      for (const item of data.events) {
        const comp = item.competitions && item.competitions[0];
        if (!comp) continue;

        const team1 = comp.competitors[0]?.team?.name || comp.competitors[0]?.team?.displayName || 'Team A';
        const team2 = comp.competitors[1]?.team?.name || comp.competitors[1]?.team?.displayName || 'Team B';
        const logo1 = comp.competitors[0]?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team1)}&background=0D8ABC&color=fff`;
        const logo2 = comp.competitors[1]?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team2)}&background=0D8ABC&color=fff`;

        const matchTime = new Date(item.date).getTime();

        events.push({
          id: `cricket_${item.id}`,
          title: item.name || `${team1} vs ${team2}`,
          category: 'Cricket',
          team1Name: team1,
          team2Name: team2,
          team1Logo: logo1,
          team2Logo: logo2,
          matchTime: matchTime,
          startTime: matchTime,
          endTime: matchTime + (8 * 60 * 60 * 1000), // 8 hours duration for cricket
          isHidden: false
        });
      }
    }
  } catch (err) {
    console.error("Cricket API Fetch Error:", err.message);
  }
  return events;
}

// 2. Fetch Football Matches (ESPN World Football Scoreboard API)
async function fetchFootballEvents() {
  const events = [];
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard');
    const data = await res.json();

    if (data && data.events) {
      for (const item of data.events) {
        const comp = item.competitions && item.competitions[0];
        if (!comp) continue;

        const team1 = comp.competitors[0]?.team?.name || comp.competitors[0]?.team?.displayName || 'Team A';
        const team2 = comp.competitors[1]?.team?.name || comp.competitors[1]?.team?.displayName || 'Team B';
        const logo1 = comp.competitors[0]?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team1)}&background=10B981&color=fff`;
        const logo2 = comp.competitors[1]?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team2)}&background=10B981&color=fff`;

        const matchTime = new Date(item.date).getTime();

        events.push({
          id: `football_${item.id}`,
          title: item.name || `${team1} vs ${team2}`,
          category: 'Football',
          team1Name: team1,
          team2Name: team2,
          team1Logo: logo1,
          team2Logo: logo2,
          matchTime: matchTime,
          startTime: matchTime,
          endTime: matchTime + (2.5 * 60 * 60 * 1000), // 2.5 hours duration for football
          isHidden: false
        });
      }
    }
  } catch (err) {
    console.error("Football API Fetch Error:", err.message);
  }
  return events;
}

// Main Execution Flow
async function main() {
  console.log("Fetching live & upcoming sports events...");
  
  const cricketEvents = await fetchCricketEvents();
  const footballEvents = await fetchFootballEvents();

  let allEvents = [...cricketEvents, ...footballEvents];

  // Filter out expired events (ended more than 3 hours ago)
  const now = Date.now();
  allEvents = allEvents.filter(e => e.endTime > (now - 3 * 60 * 60 * 1000));

  // Sort by match time (upcoming/live first)
  allEvents.sort((a, b) => a.matchTime - b.matchTime);

  // Take top 10 unique events
  const selectedEvents = allEvents.slice(0, 10);

  console.log(`Found ${selectedEvents.length} events to sync to Firebase...`);

  // Get existing events in Firestore to preserve existing streaming links added from Admin Panel
  const snapshot = await db.collection('live_events').get();
  const existingDocs = {};
  snapshot.forEach(doc => {
    existingDocs[doc.id] = doc.data();
  });

  const batch = db.batch();

  for (const event of selectedEvents) {
    const docRef = db.collection('live_events').doc(event.id);
    const existing = existingDocs[event.id];

    batch.set(docRef, {
      name: event.title,
      category: event.category,
      title: event.title,
      team1Name: event.team1Name,
      team2Name: event.team2Name,
      team1Logo: event.team1Logo,
      team2Logo: event.team2Logo,
      matchTime: event.matchTime,
      startTime: event.startTime,
      endTime: event.endTime,
      isHidden: event.isHidden
    }, { merge: true });
  }

  await batch.commit();
  console.log("SUCCESS: 10 Sports Events successfully synced to Firebase!");
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
