const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Popular League IDs in TheSportsDB
const LEAGUE_IDS = [
  '4328', // English Premier League
  '4335', // Spanish La Liga
  '4332', // Italian Serie A
  '4331', // German Bundesliga
  '4334', // French Ligue 1
  '4480', // UEFA Champions League
  '4387', // NBA
];

function getDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function fetchEvents() {
  const allEvents = [];
  
  // 1. Fetch upcoming events from major leagues
  for (const leagueId of LEAGUE_IDS) {
    try {
      const url = `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${leagueId}`;
      const res = await axios.get(url, { timeout: 6000 });
      if (res.data && res.data.events) {
        allEvents.push(...res.data.events);
      }
    } catch (e) {
      console.log(`Notice: League ${leagueId} fetch skipped`);
    }
  }

  // 2. Fetch daily events for Today, Tomorrow, and Day after tomorrow for Soccer and Cricket
  const dates = [getDateOffset(0), getDateOffset(1), getDateOffset(2)];
  const sports = ['Soccer', 'Cricket', 'Basketball'];

  for (const date of dates) {
    for (const sport of sports) {
      try {
        const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=${sport}`;
        const res = await axios.get(url, { timeout: 6000 });
        if (res.data && res.data.events) {
          allEvents.push(...res.data.events);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // Deduplicate
  const uniqueMap = new Map();
  for (const ev of allEvents) {
    if (!ev || !ev.strHomeTeam || !ev.strAwayTeam) continue;
    const key = ev.idEvent || `${ev.strHomeTeam}_vs_${ev.strAwayTeam}_${ev.dateEvent}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, ev);
    }
  }

  const uniqueEvents = Array.from(uniqueMap.values());
  
  // Parse match times and sort by match time ascending
  const parsed = uniqueEvents.map(ev => {
    let timestamp = Date.now() + 3600000;
    if (ev.strTimestamp) {
      timestamp = new Date(ev.strTimestamp).getTime();
    } else if (ev.dateEvent) {
      const timeStr = ev.strTime || '18:00:00';
      timestamp = new Date(`${ev.dateEvent}T${timeStr}Z`).getTime();
    }
    
    let category = "Football";
    const strSport = (ev.strSport || "").toLowerCase();
    if (strSport.includes("cricket")) {
      category = "Cricket";
    } else if (strSport.includes("basketball")) {
      category = "Basketball";
    }

    return {
      timestamp: isNaN(timestamp) ? Date.now() + 3600000 : timestamp,
      category: category,
      team1Name: ev.strHomeTeam || "Home Team",
      team1Logo: ev.strHomeTeamBadge || ev.strThumb || "",
      team2Name: ev.strAwayTeam || "Away Team",
      team2Logo: ev.strAwayTeamBadge || "",
      title: `${ev.strHomeTeam || 'Home'} VS ${ev.strAwayTeam || 'Away'}`,
    };
  });

  // Filter out past events
  const now = Date.now();
  const validEvents = parsed.filter(item => item.timestamp > (now - 2 * 3600 * 1000));

  // Sort ascending by time
  validEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Take top 10
  const top10 = validEvents.slice(0, 10);

  console.log(`Found ${top10.length} valid upcoming events!`);

  // Upload to Firestore collection 'live_events'
  for (let i = 0; i < top10.length; i++) {
    const item = top10[i];
    const docId = `auto_event_${i + 1}`;

    const liveEventData = {
      name: item.title,
      category: item.category,
      title: item.title,
      team1Name: item.team1Name,
      team1Logo: item.team1Logo,
      team2Name: item.team2Name,
      team2Logo: item.team2Logo,
      startTime: item.timestamp,
      endTime: item.timestamp + (2.5 * 3600 * 1000),
      isHidden: false
    };

    await db.collection('live_events').doc(docId).set(liveEventData, { merge: true });
    console.log(`[${i + 1}/10] Updated ${docId}: ${item.title}`);
  }

  console.log("Successfully updated 10 live events in Firestore!");
}

fetchEvents().catch(err => {
  console.error("Error updating events:", err);
  process.exit(1);
});
