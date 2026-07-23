const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin SDK using Environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Popular Football & Cricket Leagues on TheSportsDB
const LEAGUES = [
  { id: '4328', name: 'English Premier League', cat: 'Football' },
  { id: '4335', name: 'Spanish La Liga', cat: 'Football' },
  { id: '4331', name: 'German Bundesliga', cat: 'Football' },
  { id: '4332', name: 'Italian Serie A', cat: 'Football' },
  { id: '4334', name: 'French Ligue 1', cat: 'Football' },
  { id: '4387', name: 'UEFA Champions League', cat: 'Football' },
  { id: '4424', name: 'International Cricket', cat: 'Cricket' },
  { id: '4425', name: 'IPL Cricket', cat: 'Cricket' },
  { id: '4572', name: 'ICC T20 World Cup / ODIs', cat: 'Cricket' }
];

// Fallback Real Teams & Official PNG Logos
const CRICKET_TEAMS = [
  { name: 'India', logo: 'https://www.thesportsdb.com/images/media/team/badge/uwsttw1420658421.png' },
  { name: 'Australia', logo: 'https://www.thesportsdb.com/images/media/team/badge/vsqstx1420658309.png' },
  { name: 'England', logo: 'https://www.thesportsdb.com/images/media/team/badge/trvtwv1420658380.png' },
  { name: 'Pakistan', logo: 'https://www.thesportsdb.com/images/media/team/badge/xyxywy1420658474.png' },
  { name: 'Bangladesh', logo: 'https://www.thesportsdb.com/images/media/team/badge/1vtuxd1527083049.png' },
  { name: 'South Africa', logo: 'https://www.thesportsdb.com/images/media/team/badge/rqwxux1420658514.png' },
  { name: 'New Zealand', logo: 'https://www.thesportsdb.com/images/media/team/badge/rrqtwv1420658448.png' },
  { name: 'Sri Lanka', logo: 'https://www.thesportsdb.com/images/media/team/badge/wrxypv1420658557.png' }
];

const FOOTBALL_TEAMS = [
  { name: 'Real Madrid', logo: 'https://www.thesportsdb.com/images/media/team/badge/9514e21685741639.png' },
  { name: 'Barcelona', logo: 'https://www.thesportsdb.com/images/media/team/badge/3v5y8v1685741584.png' },
  { name: 'Manchester City', logo: 'https://www.thesportsdb.com/images/media/team/badge/1q995n1593006450.png' },
  { name: 'Arsenal', logo: 'https://www.thesportsdb.com/images/media/team/badge/uy236a1571212891.png' },
  { name: 'Liverpool', logo: 'https://www.thesportsdb.com/images/media/team/badge/m0u6e61567158739.png' },
  { name: 'Manchester United', logo: 'https://www.thesportsdb.com/images/media/team/badge/xz9f0h1567158700.png' },
  { name: 'Bayern Munich', logo: 'https://www.thesportsdb.com/images/media/team/badge/8r0g7a1593006498.png' },
  { name: 'PSG', logo: 'https://www.thesportsdb.com/images/media/team/badge/rqvswy1567158863.png' },
  { name: 'Inter Milan', logo: 'https://www.thesportsdb.com/images/media/team/badge/e4m8w21617267926.png' },
  { name: 'Juventus', logo: 'https://www.thesportsdb.com/images/media/team/badge/3f59y81685741829.png' }
];

async function updateLiveEvents() {
  console.log('🔄 Starting 10-Event Smart Rolling Queue Sync...');

  const now = Date.now();
  const eventsRef = db.collection('live_events');

  // 1. Get current events from Firestore
  const snapshot = await eventsRef.get();
  let existingEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 2. Remove finished events (ended > 2 hours ago)
  for (const event of existingEvents) {
    if (event.endTime && event.endTime < (now - 2 * 60 * 60 * 1000)) {
      console.log(`🗑️ Removing expired event: ${event.name}`);
      await eventsRef.doc(event.id).delete();
    }
  }

  // Refresh active events list after cleanup
  const activeSnapshot = await eventsRef.get();
  let activeEvents = activeSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  console.log(`📌 Currently active events in Database: ${activeEvents.length} / 10`);

  if (activeEvents.length >= 10) {
    console.log('✅ Queue is full (10 events). No new events needed right now.');
    return;
  }

  const slotsNeeded = 10 - activeEvents.length;
  console.log(`🔎 Searching for ${slotsNeeded} new upcoming events...`);

  const fetchedEvents = [];

  // Helper function to check duplicate matches
  const isDuplicate = (name) => {
    const clean = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = clean(name);
    return activeEvents.some(e => clean(e.name) === target) ||
           fetchedEvents.some(e => clean(e.name) === target);
  };

  // 3. Try Fetching Real Events from Sports API
  for (const league of LEAGUES) {
    if (fetchedEvents.length >= slotsNeeded) break;
    try {
      const response = await axios.get(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${league.id}`);
      const events = response.data?.events;
      if (events && Array.isArray(events)) {
        for (const item of events) {
          if (fetchedEvents.length >= slotsNeeded) break;

          const team1 = item.strHomeTeam || item.strEvent?.split('vs')[0] || 'Team A';
          const team2 = item.strAwayTeam || item.strEvent?.split('vs')[1] || 'Team B';
          const eventName = `${team1} vs ${team2}`;

          if (isDuplicate(eventName)) continue;

          let startTime = now + (fetchedEvents.length + 1) * 3600000;
          if (item.strTimestamp) {
            const parsed = new Date(item.strTimestamp).getTime();
            if (!isNaN(parsed) && parsed > now - 3600000) {
              startTime = parsed;
            }
          } else if (item.dateEvent && item.strTime) {
            const parsed = new Date(`${item.dateEvent}T${item.strTime}`).getTime();
            if (!isNaN(parsed) && parsed > now - 3600000) {
              startTime = parsed;
            }
          }

          const team1Logo = item.strHomeTeamBadge || item.strThumb || 'https://www.thesportsdb.com/images/media/team/badge/9514e21685741639.png';
          const team2Logo = item.strAwayTeamBadge || item.strThumb || 'https://www.thesportsdb.com/images/media/team/badge/3v5y8v1685741584.png';

          fetchedEvents.push({
            name: eventName,
            category: league.cat,
            title: item.strLeague || league.name,
            team1Name: team1,
            team1Logo: team1Logo,
            team2Name: team2,
            team2Logo: team2Logo,
            startTime: startTime,
            endTime: startTime + (league.cat === 'Cricket' ? 6 * 3600000 : 3 * 3600000),
            isHidden: false
          });
          console.log(`✨ Found live event: ${eventName} (${league.name})`);
        }
      }
    } catch (err) {
      // Continue to next league if single league fetch fails
    }
  }

  // 4. Guaranteed Real Team Scheduler (Fills queue up to 10 if API live list is short)
  let hourOffset = 1;
  while (fetchedEvents.length < slotsNeeded) {
    const isCricket = fetchedEvents.length % 2 === 0;
    const pool = isCricket ? CRICKET_TEAMS : FOOTBALL_TEAMS;
    const t1 = pool[Math.floor(Math.random() * pool.length)];
    let t2 = pool[Math.floor(Math.random() * pool.length)];
    while (t2.name === t1.name) {
      t2 = pool[Math.floor(Math.random() * pool.length)];
    }

    const eventName = `${t1.name} vs ${t2.name}`;
    if (isDuplicate(eventName)) {
      hourOffset++;
      if (hourOffset > 50) break;
      continue;
    }

    const category = isCricket ? 'Cricket' : 'Football';
    const title = isCricket ? 'ICC / T20 International League' : 'UEFA Champions League / Premier League';
    const startTime = now + (hourOffset * 3600000);

    fetchedEvents.push({
      name: eventName,
      category: category,
      title: title,
      team1Name: t1.name,
      team1Logo: t1.logo,
      team2Name: t2.name,
      team2Logo: t2.logo,
      startTime: startTime,
      endTime: startTime + (isCricket ? 5 * 3600000 : 3 * 3600000),
      isHidden: false
    });
    console.log(`📌 Generated upcoming match: ${eventName}`);
    hourOffset += 2;
  }

  // 5. Insert events into Firebase
  for (const event of fetchedEvents) {
    const docRef = eventsRef.doc();
    await docRef.set({
      id: docRef.id,
      ...event
    });
    console.log(`✅ Saved to Firebase: ${event.name}`);
  }

  console.log('🎉 Smart Rolling Queue update finished successfully!');
}

updateLiveEvents().catch(err => {
  console.error('❌ Error updating live events:', err);
  process.exit(1);
});
