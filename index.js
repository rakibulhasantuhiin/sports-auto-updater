import admin from 'firebase-admin';
import fetch from 'node-fetch';

// Firebase Admin Setup
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Default Team Logos Map
const TEAM_LOGOS = {
  "Bangladesh": "https://upload.wikimedia.org/wikipedia/commons/f/f9/Flag_of_Bangladesh.svg",
  "India": "https://upload.wikimedia.org/wikipedia/en/4/41/Flag_of_India.svg",
  "Pakistan": "https://upload.wikimedia.org/wikipedia/commons/3/32/Flag_of_Pakistan.svg",
  "Australia": "https://upload.wikimedia.org/wikipedia/commons/8/88/Flag_of_Australia_%28converted%29.svg",
  "England": "https://upload.wikimedia.org/wikipedia/en/b/be/Flag_of_England.svg",
  "Real Madrid": "https://upload.wikimedia.org/wikipedia/en/5/56/Real_Madrid_CF.svg",
  "Barcelona": "https://upload.wikimedia.org/wikipedia/en/4/47/FC_Barcelona.svg",
  "Manchester City": "https://upload.wikimedia.org/wikipedia/en/e/eb/Manchester_City_FC_badge.svg",
  "Manchester United": "https://upload.wikimedia.org/wikipedia/en/7/7a/Manchester_United_FC_crest.svg",
  "PSG": "https://upload.wikimedia.org/wikipedia/en/a/a7/Paris_Saint-Germain_F.C..svg",
  "Argentina": "https://upload.wikimedia.org/wikipedia/commons/1/1a/Flag_of_Argentina.svg",
  "Brazil": "https://upload.wikimedia.org/wikipedia/commons/0/05/Flag_of_Brazil.svg"
};

function getLogo(teamName, defaultUrl) {
  if (!teamName) return defaultUrl || "https://picsum.photos/200";
  for (const [key, logo] of Object.entries(TEAM_LOGOS)) {
    if (teamName.toLowerCase().includes(key.toLowerCase())) {
      return logo;
    }
  }
  return defaultUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(teamName)}&background=random&size=128`;
}

// Fetch API Events
async function fetchSportsEvents() {
  const events = [];
  const now = Date.now();

  try {
    // 1. Fetch Cricket Scoreboard
    const cricketRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/cricket/8881/scoreboard');
    if (cricketRes.ok) {
      const data = await cricketRes.json();
      const cricketItems = data.events || [];
      cricketItems.forEach((ev, idx) => {
        const comp = ev.competitions?.[0] || {};
        const team1 = comp.competitors?.[0]?.team?.name || "Team A";
        const team2 = comp.competitors?.[1]?.team?.name || "Team B";
        const logo1 = comp.competitors?.[0]?.team?.logo || getLogo(team1);
        const logo2 = comp.competitors?.[1]?.team?.logo || getLogo(team2);
        
        const startTime = ev.date ? new Date(ev.date).getTime() : (now + idx * 7200000);
        const endTime = startTime + (6 * 3600000); // 6 hours match duration

        events.push({
          id: `cricket_${ev.id || idx}`,
          name: `${team1} vs ${team2}`,
          category: "Cricket",
          title: ev.season?.displayName || ev.league?.name || "International Cricket",
          team1Name: team1,
          team1Logo: logo1,
          team2Name: team2,
          team2Logo: logo2,
          status: startTime <= now && now <= endTime ? "Live" : (startTime > now ? "Upcoming" : "Finished"),
          startTime: Number(startTime),
          endTime: Number(endTime),
          isHidden: false
        });
      });
    }
  } catch (e) {
    console.log("Cricket API Error:", e.message);
  }

  try {
    // 2. Fetch Soccer Scoreboard
    const soccerRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard');
    if (soccerRes.ok) {
      const data = await soccerRes.json();
      const soccerItems = data.events || [];
      soccerItems.forEach((ev, idx) => {
        const comp = ev.competitions?.[0] || {};
        const team1 = comp.competitors?.[0]?.team?.name || "Home Team";
        const team2 = comp.competitors?.[1]?.team?.name || "Away Team";
        const logo1 = comp.competitors?.[0]?.team?.logo || getLogo(team1);
        const logo2 = comp.competitors?.[1]?.team?.logo || getLogo(team2);

        const startTime = ev.date ? new Date(ev.date).getTime() : (now + (idx + 1) * 10800000);
        const endTime = startTime + (2.5 * 3600000); // 2.5 hours duration

        events.push({
          id: `football_${ev.id || idx}`,
          name: `${team1} vs ${team2}`,
          category: "Football",
          title: ev.season?.displayName || ev.league?.name || "Football World League",
          team1Name: team1,
          team1Logo: logo1,
          team2Name: team2,
          team2Logo: logo2,
          status: startTime <= now && now <= endTime ? "Live" : (startTime > now ? "Upcoming" : "Finished"),
          startTime: Number(startTime),
          endTime: Number(endTime),
          isHidden: false
        });
      });
    }
  } catch (e) {
    console.log("Soccer API Error:", e.message);
  }

  // 3. Fallback Famous Matches (Guarantees exactly 10 high-value matches at all times)
  const famousPresets = [
    { cat: "Cricket", title: "Asia Cup 2026", t1: "Bangladesh", t2: "India" },
    { cat: "Cricket", title: "T20 International Series", t1: "Pakistan", t2: "Australia" },
    { cat: "Football", title: "UEFA Champions League", t1: "Real Madrid", t2: "Barcelona" },
    { cat: "Football", title: "Premier League", t1: "Manchester City", t2: "Manchester United" },
    { cat: "Cricket", title: "IPL 2026", t1: "Chennai Super Kings", t2: "Mumbai Indians" },
    { cat: "Football", title: "Ligue 1", t1: "PSG", t2: "Marseille" },
    { cat: "Football", title: "International Friendly", t1: "Brazil", t2: "Argentina" },
    { cat: "Cricket", title: "ODI World Cup Qualifiers", t1: "Bangladesh", t2: "England" },
    { cat: "Football", title: "La Liga Santander", t1: "Barcelona", t2: "Atletico Madrid" },
    { cat: "Cricket", title: "T20 Trophy", t1: "India", t2: "Australia" }
  ];

  let presetIdx = 0;
  while (events.length < 10) {
    const p = famousPresets[presetIdx % famousPresets.length];
    const offsetHours = (presetIdx + 1) * 3; // Spread out every 3 hours
    const startTime = now + (offsetHours * 3600000);
    const endTime = startTime + (4 * 3600000);

    events.push({
      id: `preset_${presetIdx}_${now}`,
      name: `${p.t1} vs ${p.t2}`,
      category: p.cat,
      title: p.title,
      team1Name: p.t1,
      team1Logo: getLogo(p.t1),
      team2Name: p.t2,
      team2Logo: getLogo(p.t2),
      status: presetIdx === 0 ? "Live" : "Upcoming",
      startTime: Number(presetIdx === 0 ? now - 1800000 : startTime), // Make 1st live
      endTime: Number(presetIdx === 0 ? now + 7200000 : endTime),
      isHidden: false
    });
    presetIdx++;
  }

  // Filter out expired events and keep top 10 unique events sorted by startTime
  const validEvents = events
    .filter(ev => ev.endTime > now)
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, 10);

  return validEvents;
}

async function updateFirestore() {
  console.log("Starting Auto Sports Sync...");
  const matches = await fetchSportsEvents();
  console.log(`Prepared ${matches.length} matches for Firestore.`);

  const batch = db.batch();
  const collectionRef = db.collection('live_events');

  // Clear old documents to prevent duplicates
  const oldDocs = await collectionRef.get();
  oldDocs.forEach(doc => {
    batch.delete(doc.ref);
  });

  // Insert exactly 10 updated matches
  matches.forEach(match => {
    const docRef = collectionRef.doc(match.id);
    batch.set(docRef, match);
  });

  await batch.commit();
  console.log("Successfully updated 10 live events in Firebase!");
}

updateFirestore().catch(err => {
  console.error("Fatal Error updating Firebase:", err);
  process.exit(1);
});
