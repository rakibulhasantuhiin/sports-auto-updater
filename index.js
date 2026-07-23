import admin from 'firebase-admin';
import fetch from 'node-fetch';

// Firebase Admin Initialization
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Popular Free Sports API Endpoints (EPL, La Liga, Champions League, World Cricket, IPL, etc.)
const SPORT_LEAGUES = [
  { id: '4328', category: 'Football', name: 'English Premier League' },
  { id: '4335', category: 'Football', name: 'Spanish La Liga' },
  { id: '4331', category: 'Football', name: 'German Bundesliga' },
  { id: '4332', category: 'Football', name: 'Italian Serie A' },
  { id: '4480', category: 'Champions League', name: 'UEFA Champions League' },
  { id: '4424', category: 'Cricket', name: 'International Cricket' },
  { id: '4801', category: 'Cricket', name: 'Indian Premier League' },
  { id: '4502', category: 'Cricket', name: 'T20 World Cup / ODIs' }
];

async function fetchUpcomingEvents() {
  const allEvents = [];
  const now = Date.now();

  for (const league of SPORT_LEAGUES) {
    try {
      const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${league.id}`);
      const data = await res.json();

      if (data && data.events && Array.isArray(data.events)) {
        for (const evt of data.events) {
          if (!evt.strEvent || !evt.strHomeTeam || !evt.strAwayTeam) continue;

          // Parse Match Timestamp
          let matchTime = now;
          if (evt.strTimestamp) {
            matchTime = new Date(evt.strTimestamp).getTime();
          } else if (evt.dateEvent) {
            const timeStr = evt.strTime ? evt.strTime.split('+')[0] : '15:00:00';
            matchTime = new Date(`${evt.dateEvent}T${timeStr}Z`).getTime();
          }

          // Ignore matches older than 3 hours ago
          if (matchTime < now - (3 * 60 * 60 * 1000)) continue;

          const team1Logo = evt.strHomeTeamBadge || evt.strThumb || `https://ui-avatars.com/api/?name=${encodeURIComponent(evt.strHomeTeam)}&background=1E293B&color=FFFFFF`;
          const team2Logo = evt.strAwayTeamBadge || evt.strThumb || `https://ui-avatars.com/api/?name=${encodeURIComponent(evt.strAwayTeam)}&background=1E293B&color=FFFFFF`;

          // Generate unique ID based on team names and match date
          const cleanTeam1 = evt.strHomeTeam.trim();
          const cleanTeam2 = evt.strAwayTeam.trim();
          const dateStr = evt.dateEvent || new Date(matchTime).toISOString().split('T')[0];
          const customId = `event_${cleanTeam1.toLowerCase().replace(/[^a-z0-9]/g, '')}_vs_${cleanTeam2.toLowerCase().replace(/[^a-z0-9]/g, '')}_${dateStr.replace(/-/g, '')}`;

          allEvents.push({
            id: customId,
            name: `${cleanTeam1} VS ${cleanTeam2}`,
            team1Name: cleanTeam1,
            team2Name: cleanTeam2,
            team1Logo: team1Logo,
            team2Logo: team2Logo,
            category: league.category,
            title: `${league.name} - ${cleanTeam1} vs ${cleanTeam2}`,
            startTime: matchTime,
            endTime: matchTime + (3 * 60 * 60 * 1000), // 3 hours duration
            isHidden: false
          });
        }
      }
    } catch (err) {
      console.log(`Failed fetching for league ${league.name}:`, err.message);
    }
  }

  // Remove duplicates
  const uniqueMap = new Map();
  allEvents.forEach(e => {
    if (!uniqueMap.has(e.id)) {
      uniqueMap.set(e.id, e);
    }
  });

  // Sort by match time (ASC)
  const sorted = Array.from(uniqueMap.values()).sort((a, b) => a.startTime - b.startTime);

  // Take maximum top 10 upcoming matches
  return sorted.slice(0, 10);
}

async function updateFirestore() {
  try {
    console.log("Fetching live & upcoming sports events...");
    const upcoming10 = await fetchUpcomingEvents();

    if (upcoming10.length === 0) {
      console.log("No upcoming events found right now.");
      return;
    }

    console.log(`Found ${upcoming10.length} events to sync into Firestore.`);

    const liveEventsRef = db.collection('live_events');
    const existingSnapshot = await liveEventsRef.get();
    
    // Existing IDs in DB
    const existingDocsMap = new Map();
    existingSnapshot.docs.forEach(doc => {
      existingDocsMap.set(doc.id, doc.data());
    });

    const new10Ids = new Set(upcoming10.map(e => e.id));

    // Batch update to minimize Firebase read/write usage
    const batch = db.batch();

    // 1. Insert or update the 10 upcoming events
    for (const evt of upcoming10) {
      const docRef = liveEventsRef.doc(evt.id);
      if (existingDocsMap.has(evt.id)) {
        // Update details but keep existing user data intact
        batch.update(docRef, {
          startTime: evt.startTime,
          endTime: evt.endTime,
          team1Logo: evt.team1Logo,
          team2Logo: evt.team2Logo
        });
      } else {
        // Insert new match
        batch.set(docRef, evt);
      }
    }

    // 2. Remove old expired events that are no longer in top 10 queue
    existingSnapshot.docs.forEach(doc => {
      if (!new10Ids.has(doc.id)) {
        const data = doc.data();
        // Remove if event match finished (more than 3 hours ago)
        if (data.startTime && data.startTime < Date.now() - (3 * 60 * 60 * 1000)) {
          console.log(`Removing finished/passed event: ${doc.id}`);
          batch.delete(doc.ref);
        }
      }
    });

    await batch.commit();
    console.log("Successfully synced top 10 upcoming events into Firebase!");
    process.exit(0);
  } catch (error) {
    console.error("Error updating Firestore:", error);
    process.exit(1);
  }
}

updateFirestore();
