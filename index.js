import admin from 'firebase-admin';
import fetch from 'node-fetch';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function fetchLiveEvents() {
  console.log("⚡ Fetching live/upcoming sports events from API...");
  
  const events = [];
  
  try {
    const sports = [
      { name: "Cricket", category: "Cricket", url: "https://site.api.espn.com/apis/site/v2/sports/cricket/13/scoreboard" },
      { name: "Football Premier League", category: "Football", url: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard" },
      { name: "Champions League", category: "Football", url: "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard" },
      { name: "La Liga", category: "Football", url: "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard" }
    ];

    for (const sport of sports) {
      try {
        const res = await fetch(sport.url);
        const data = await res.json();
        
        if (data && data.events) {
          for (const ev of data.events) {
            const comp = ev.competitions?.[0];
            if (!comp) continue;
            
            const team1 = comp.competitors?.[0]?.team?.shortDisplayName || comp.competitors?.[0]?.team?.name || "Team A";
            const team2 = comp.competitors?.[1]?.team?.shortDisplayName || comp.competitors?.[1]?.team?.name || "Team B";
            const team1Logo = comp.competitors?.[0]?.team?.logo || "";
            const team2Logo = comp.competitors?.[1]?.team?.logo || "";
            
            const matchTime = new Date(ev.date).getTime();
            const now = Date.now();
            
            // 4 ঘন্টার বেশি পুরনো ম্যাচ স্কিপ করবে
            if (matchTime + (4 * 3600 * 1000) < now) continue;
            
            events.push({
              name: `${team1} vs ${team2}`,
              title: `${team1} vs ${team2}`,
              category: sport.category,
              team1Name: team1,
              team2Name: team2,
              team1Logo: team1Logo,
              team2Logo: team2Logo,
              startTime: matchTime,
              endTime: matchTime + (3 * 3600 * 1000),
              isHidden: false
            });
          }
        }
      } catch (err) {
        console.log(`Failed fetching ${sport.name}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Error fetching APIs:", error);
  }

  // Duplicate রিমুভ এবং সময়ের ক্রমানুসারে ১০টি সাজানো
  const uniqueMap = new Map();
  events.forEach(e => {
    const key = `${e.team1Name.toLowerCase()}_vs_${e.team2Name.toLowerCase()}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, e);
    }
  });

  const sortedEvents = Array.from(uniqueMap.values())
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, 10);

  return sortedEvents;
}

async function updateFirestore() {
  try {
    const newEvents = await fetchLiveEvents();
    console.log(`Found ${newEvents.length} events to sync.`);

    if (newEvents.length === 0) {
      console.log("No new events found.");
      return;
    }

    const batch = db.batch();

    // ফিক্সড ID ব্যবহার করা হচ্ছে যাতে কোটা অতিরিক্ত খরচ না হয়
    newEvents.forEach((event, index) => {
      const docRef = db.collection('live_events').doc(`event_${index + 1}`);
      batch.set(docRef, {
        id: `event_${index + 1}`,
        name: event.name,
        title: event.title,
        category: event.category,
        team1Name: event.team1Name,
        team2Name: event.team2Name,
        team1Logo: event.team1Logo,
        team2Logo: event.team2Logo,
        startTime: event.startTime,
        endTime: event.endTime,
        isHidden: false
      }, { merge: true });
    });

    await batch.commit();
    console.log("✅ Successfully updated 10 events in Firestore with minimum quota usage!");
  } catch (err) {
    console.error("❌ Error updating Firestore:", err);
    process.exit(1);
  }
}

updateFirestore();
