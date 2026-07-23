const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function fetchAndSyncEvents() {
  try {
    console.log("Fetching live & upcoming sports events...");
    
    // Fetch Cricket and Football events from TheSportsDB
    const [cricketRes, footballRes] = await Promise.all([
      axios.get('https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4391').catch(() => ({ data: { events: [] } })),
      axios.get('https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328').catch(() => ({ data: { events: [] } }))
    ]);

    const rawEvents = [
      ...(cricketRes.data?.events || []).map(e => ({ ...e, sport: 'Cricket' })),
      ...(footballRes.data?.events || []).map(e => ({ ...e, sport: 'Football' }))
    ];

    // Sort by event time and take top 10
    const now = Date.now();
    const sortedEvents = rawEvents
      .map(event => {
        const timeStr = `${event.strDate}T${event.strTime || '00:00:00'}`;
        const matchTimestamp = new Date(timeStr).getTime() || (now + 3600000);
        return {
          id: event.idEvent || `event_${Math.random().toString(36).substring(2, 9)}`,
          name: event.strEvent || `${event.strHomeTeam} vs ${event.strAwayTeam}`,
          category: event.sport || 'Sports',
          title: event.strLeague || 'Live Match',
          team1Name: event.strHomeTeam || 'Team A',
          team2Name: event.strAwayTeam || 'Team B',
          team1Logo: event.strHomeTeamBadge || '',
          team2Logo: event.strAwayTeamBadge || '',
          startTime: matchTimestamp,
          endTime: matchTimestamp + (3 * 60 * 60 * 1000), // 3 hours duration
          streamUrl: '',
          isHidden: false
        };
      })
      .filter(e => e.endTime > now) // Only active or future events
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, 10);

    console.log(`Found ${sortedEvents.length} events to sync.`);

    // Batch update to Firestore (Optimized Writes)
    const batch = db.batch();
    
    // Get existing events in live_events collection
    const snapshot = await db.collection('live_events').get();
    
    // Clear old expired events if count exceeds 10
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (!sortedEvents.some(se => se.id === doc.id) && snapshot.size > 10) {
        batch.delete(doc.ref);
      }
    });

    // Upsert the 10 rolling events
    sortedEvents.forEach(event => {
      const docRef = db.collection('live_events').doc(event.id);
      batch.set(docRef, event, { merge: true });
    });

    await batch.commit();
    console.log("Successfully updated 10 rolling live events to Firebase!");
    process.exit(0);

  } catch (error) {
    console.error("Error updating live events:", error);
    process.exit(1);
  }
}

fetchAndSyncEvents();
