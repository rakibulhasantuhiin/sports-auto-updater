const admin = require('firebase-admin');

// 1. Check Firebase Secret
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ ERROR: GitHub Secret 'FIREBASE_SERVICE_ACCOUNT' is missing!");
  console.error("👉 Please add FIREBASE_SERVICE_ACCOUNT in GitHub Repository Settings -> Secrets and variables -> Actions.");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("❌ ERROR: Invalid JSON in FIREBASE_SERVICE_ACCOUNT secret.");
  console.error(err.message);
  process.exit(1);
}

// 2. Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("✅ Firebase Admin Initialized Successfully!");
} catch (err) {
  console.error("❌ Firebase Admin Initialization Failed:", err.message);
  process.exit(1);
}

const db = admin.firestore();

// Helper to fetch JSON from API using native fetch
async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn(`Failed to fetch from ${url}:`, e.message);
    return null;
  }
}

// Main Updater Function
async function updateSportsEvents() {
  console.log("🚀 Starting Sports Events Fetch...");

  const eventsList = [];

  // 1. Fetch Football Events from ESPN API
  const footballUrls = [
    'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard',
    'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
    'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard',
    'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard'
  ];

  for (const url of footballUrls) {
    const data = await fetchJson(url);
    if (data && data.events) {
      for (const ev of data.events) {
        try {
          const competition = ev.competitions?.[0];
          if (!competition) continue;

          const team1 = competition.competitors?.[0];
          const team2 = competition.competitors?.[1];

          const title = ev.shortName || `${team1?.team?.shortDisplayName || 'Team A'} vs ${team2?.team?.shortDisplayName || 'Team B'}`;
          const team1Logo = team1?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team1?.team?.name || 'T1')}&background=0D8ABC&color=fff`;
          const team2Logo = team2?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team2?.team?.name || 'T2')}&background=E31B23&color=fff`;

          const category = 'Football';
          const status = ev.status?.type?.state === 'in' ? 'LIVE' : (ev.status?.type?.state === 'post' ? 'FINISHED' : 'UPCOMING');
          const startTime = new Date(ev.date || Date.now()).toISOString();

          eventsList.push({
            id: `espn_fb_${ev.id}`,
            title: title,
            category: category,
            status: status,
            team1Logo: team1Logo,
            team2Logo: team2Logo,
            streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
            startTime: startTime,
            updatedAt: new Date().toISOString()
          });
        } catch (e) {
          console.warn("Error parsing event:", e.message);
        }
      }
    }
  }

  // 2. Fetch Cricket Events from ESPN API
  const cricketUrls = [
    'https://site.api.espn.com/apis/site/v2/sports/cricket/all/scoreboard',
    'https://site.api.espn.com/apis/site/v2/sports/cricket/8880/scoreboard' // International
  ];

  for (const url of cricketUrls) {
    const data = await fetchJson(url);
    if (data && data.events) {
      for (const ev of data.events) {
        try {
          const competition = ev.competitions?.[0];
          if (!competition) continue;

          const team1 = competition.competitors?.[0];
          const team2 = competition.competitors?.[1];

          const title = ev.shortName || `${team1?.team?.name || 'Team 1'} vs ${team2?.team?.name || 'Team 2'}`;
          const team1Logo = team1?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team1?.team?.name || 'C1')}&background=1B5E20&color=fff`;
          const team2Logo = team2?.team?.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(team2?.team?.name || 'C2')}&background=0D47A1&color=fff`;

          const status = ev.status?.type?.state === 'in' ? 'LIVE' : (ev.status?.type?.state === 'post' ? 'FINISHED' : 'UPCOMING');
          const startTime = new Date(ev.date || Date.now()).toISOString();

          eventsList.push({
            id: `espn_cr_${ev.id}`,
            title: title,
            category: 'Cricket',
            status: status,
            team1Logo: team1Logo,
            team2Logo: team2Logo,
            streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
            startTime: startTime,
            updatedAt: new Date().toISOString()
          });
        } catch (e) {
          console.warn("Error parsing cricket event:", e.message);
        }
      }
    }
  }

  console.log(`📊 Total raw matches fetched: ${eventsList.length}`);

  // Fallback Featured Matches if API returns empty at midnight
  if (eventsList.length === 0) {
    console.log("⚠️ No live events found from API currently. Adding high-profile featured matches...");
    const now = new Date();
    eventsList.push(
      {
        id: "feat_cricket_1",
        title: "India vs Bangladesh - T20 World Cup Match",
        category: "Cricket",
        status: "LIVE",
        team1Logo: "https://flagsapi.com/IN/flat/64.png",
        team2Logo: "https://flagsapi.com/BD/flat/64.png",
        streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        startTime: now.toISOString(),
        updatedAt: now.toISOString()
      },
      {
        id: "feat_football_1",
        title: "Real Madrid vs Barcelona - El Clasico",
        category: "Football",
        status: "UPCOMING",
        team1Logo: "https://ui-avatars.com/api/?name=Real+Madrid&background=111&color=fff",
        team2Logo: "https://ui-avatars.com/api/?name=Barcelona&background=A50044&color=fff",
        streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        startTime: new Date(now.getTime() + 3600000 * 2).toISOString(),
        updatedAt: now.toISOString()
      }
    );
  }

  // Deduplicate by ID
  const uniqueEventsMap = new Map();
  for (const item of eventsList) {
    if (!uniqueEventsMap.has(item.id)) {
      uniqueEventsMap.set(item.id, item);
    }
  }

  // Take top 10 unique events to optimize Firebase daily write quota
  const finalEvents = Array.from(uniqueEventsMap.values()).slice(0, 10);

  console.log(`🔥 Writing ${finalEvents.length} unique events to Firebase Firestore...`);

  // Write to Firestore 'live_events' collection
  const batch = db.batch();
  for (const event of finalEvents) {
    const docRef = db.collection('live_events').doc(event.id);
    batch.set(docRef, event, { merge: true });
  }

  await batch.commit();
  console.log("✅ Firestore batch update completed successfully!");
}

updateSportsEvents()
  .then(() => {
    console.log("🎉 All Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Fatal Execution Error:", err);
    process.exit(1);
  });
