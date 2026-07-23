const admin = require('firebase-admin');

// 1. Initialize Firebase Admin safely
let serviceAccount;
try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing in GitHub Repository Secrets!");
  }
  const rawSecret = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
  serviceAccount = JSON.parse(rawSecret);
} catch (err) {
  console.error("❌ Firebase Secret Error:", err.message);
  console.error("👉 Please ensure FIREBASE_SERVICE_ACCOUNT secret in GitHub settings contains valid JSON key content.");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Helpers
function formatTeamName(name) {
  if (!name) return "Team";
  return name.replace(/\b(FC|SC|United|City|CF)\b/gi, '').trim() || name;
}

function getLogoUrl(teamName) {
  const clean = encodeURIComponent(formatTeamName(teamName));
  return `https://ui-avatars.com/api/?name=${clean}&background=0D8ABC&color=fff&size=128&bold=true`;
}

// Multi-Source Fetching (Cricket + Football)
async function fetchSportsEvents() {
  const events = [];
  const now = Date.now();

  // 1. Fetch Football & Multi-Sports from ESPN
  const espnLeagues = [
    'soccer/eng.1', 'soccer/esp.1', 'soccer/ita.1', 'soccer/ger.1', 
    'soccer/fra.1', 'soccer/usa.1', 'soccer/uefa.champions',
    'cricket/icc'
  ];

  for (const league of espnLeagues) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`);
      if (!res.ok) continue;
      const data = await res.json();
      
      if (data.events && Array.isArray(data.events)) {
        for (const ev of data.events) {
          const competition = ev.competitions?.[0];
          if (!competition) continue;

          const team1 = competition.competitors?.[0];
          const team2 = competition.competitors?.[1];

          const t1Name = team1?.team?.displayName || team1?.team?.name || "Team A";
          const t2Name = team2?.team?.displayName || team2?.team?.name || "Team B";

          const t1Logo = team1?.team?.logo || getLogoUrl(t1Name);
          const t2Logo = team2?.team?.logo || getLogoUrl(t2Name);

          const eventTime = new Date(ev.date).getTime();
          if (isNaN(eventTime)) continue;

          // Category determination
          const category = league.includes('cricket') ? 'Cricket' : 'Football';
          const matchTitle = `${t1Name} vs ${t2Name}`;

          events.push({
            id: `auto_${ev.id || Math.random().toString(36).substring(2, 9)}`,
            name: matchTitle,
            category: category,
            title: ev.name || matchTitle,
            team1Name: t1Name,
            team2Name: t2Name,
            team1Flag: t1Logo,
            team2Flag: t2Logo,
            matchTime: eventTime,
            endTime: eventTime + (3 * 60 * 60 * 1000), // 3 hours duration
            stream_url: "",
            isHidden: false
          });
        }
      }
    } catch (e) {
      console.log(`Fetch skipped for ${league}:`, e.message);
    }
  }

  // Deduplicate by name & team combination
  const uniqueEvents = [];
  const seenKeys = new Set();

  for (const ev of events) {
    const key = `${ev.team1Name.toLowerCase()}_vs_${ev.team2Name.toLowerCase()}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueEvents.push(ev);
    }
  }

  // Sort upcoming & live events chronologically
  uniqueEvents.sort((a, b) => a.matchTime - b.matchTime);

  // Filter out events that finished over 2 hours ago
  const validEvents = uniqueEvents.filter(ev => ev.matchTime + (3 * 60 * 60 * 1000) > now);

  // Take top 10 rolling matches
  return validEvents.slice(0, 10);
}

async function run() {
  console.log("🚀 Starting Sports Auto Updater...");
  
  try {
    const freshEvents = await fetchSportsEvents();
    console.log(`⚽ Found ${freshEvents.length} fresh events from Sports API.`);

    if (freshEvents.length === 0) {
      console.log("⚠️ No events fetched. Skipping database update.");
      return;
    }

    // Read current existing live_events in Firestore to preserve existing stream_urls
    const snapshot = await db.collection('live_events').get();
    const existingMap = new Map();
    snapshot.docs.forEach(doc => {
      existingMap.set(doc.id, doc.data());
    });

    const batch = db.batch();

    // 1. Clear old non-matching docs to keep exact 10 rolling queue
    const freshIds = new Set(freshEvents.map(e => e.id));
    snapshot.docs.forEach(doc => {
      if (!freshIds.has(doc.id)) {
        batch.delete(doc.ref);
      }
    });

    // 2. Set/Update fresh 10 events
    for (const ev of freshEvents) {
      const docRef = db.collection('live_events').doc(ev.id);
      const existing = existingMap.get(ev.id);

      // Preserve manually entered stream_url if present
      if (existing && existing.stream_url && existing.stream_url.length > 0) {
        ev.stream_url = existing.stream_url;
      }

      batch.set(docRef, ev, { merge: true });
    }

    await batch.commit();
    console.log(`✅ Successfully updated Firestore with ${freshEvents.length} rolling events!`);
  } catch (error) {
    console.error("❌ Error running updater:", error);
    process.exit(1);
  }
}

run();
