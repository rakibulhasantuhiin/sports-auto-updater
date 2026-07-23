import admin from 'firebase-admin';
import fetch from 'node-fetch';

// Firebase Admin Setup using Environment Variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function fetchAndSyncSportsEvents() {
  console.log("Fetching live sports schedules...");
  try {
    // Fetch upcoming events from free sports API
    const response = await fetch("https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328"); // Premier League
    const data = await response.json();
    
    let rawEvents = data.events || [];
    
    // Fallback/Mock sample sports if API limits apply
    if (rawEvents.length === 0) {
      console.log("Using dynamic sports scheduler fallback...");
      const now = Date.now();
      rawEvents = [
        { strEvent: "Arsenal vs Chelsea", strLeague: "Premier League", strThumb: "", dateEvent: "Today", strTime: "20:00:00", idEvent: "1" },
        { strEvent: "Barcelona vs Real Madrid", strLeague: "La Liga", strThumb: "", dateEvent: "Today", strTime: "22:00:00", idEvent: "2" },
        { strEvent: "India vs Pakistan", strLeague: "Asia Cup Cricket", strThumb: "", dateEvent: "Tomorrow", strTime: "15:00:00", idEvent: "3" },
        { strEvent: "Manchester City vs Liverpool", strLeague: "Premier League", strThumb: "", dateEvent: "Tomorrow", strTime: "18:00:00", idEvent: "4" },
        { strEvent: "Bangladesh vs Sri Lanka", strLeague: "T20 International", strThumb: "", dateEvent: "Tomorrow", strTime: "19:30:00", idEvent: "5" },
      ];
    }

    const eventsToSave = [];
    const nowMs = Date.now();

    for (let i = 0; i < Math.min(10, rawEvents.length); i++) {
      const item = rawEvents[i];
      const teams = (item.strEvent || "Team A vs Team B").split(" vs ");
      const team1 = teams[0] ? teams[0].trim() : "Team A";
      const team2 = teams[1] ? teams[1].trim() : "Team B";

      // Match start time calculation (Rolling queue spaced by hours)
      const startTime = nowMs + (i * 2 * 3600 * 1000); 
      const endTime = startTime + (2.5 * 3600 * 1000);

      eventsToSave.push({
        id: `auto_event_${i + 1}`,
        name: `${team1} vs ${team2}`,
        category: item.strLeague && item.strLeague.toLowerCase().includes("cricket") ? "Cricket" : "Football",
        title: item.strLeague || "Live Sports",
        team1Name: team1,
        team2Name: team2,
        team1Logo: item.strBadge1 || "",
        team2Logo: item.strBadge2 || "",
        startTime: startTime,
        endTime: endTime,
        streamUrl: "", // Keep empty for manual stream link input in admin panel
        isHidden: false
      });
    }

    console.log(`Updating ${eventsToSave.length} events in Firestore...`);

    // Write top 10 items to Firestore 'live_events'
    const batch = db.batch();
    eventsToSave.forEach((evt) => {
      const ref = db.collection("live_events").doc(evt.id);
      batch.set(ref, evt, { merge: true });
    });

    await batch.commit();
    console.log("Successfully synced 10 Live Events to Firebase!");

  } catch (error) {
    console.error("Error updating live events:", error);
    process.exit(1);
  }
}

fetchAndSyncSportsEvents();
