const admin = require('firebase-admin');
const axios = require('axios');

// ১. ফায়ারবেস অ্যাডমিন ইনিশিয়ালাইজেশন
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  console.error("❌ Firebase Service Account Error! Ensure FIREBASE_SERVICE_ACCOUNT is set in GitHub Secrets.");
  process.exit(1);
}

const db = admin.firestore();

// ২. গুরুত্বপূর্ণ ও হাইপ থাকা দল বা টুর্নামেন্টের কিওয়ার্ড (শুধুমাত্র এগুলোই অ্যাড হবে)
const NOTABLE_KEYWORDS = [
  // Cricket Hype
  "ipl", "bpl", "psl", "t20", "world cup", "asia cup", "champions trophy", "odi", "test",
  "bangladesh", "india", "pakistan", "australia", "england", "south africa", "new zealand", "sri lanka", "west indies", "afghanistan",
  "ban", "ind", "pak", "aus", "eng", "sa", "nz", "sl", "wi", "afg",
  // Football Hype
  "real madrid", "barcelona", "manchester", "united", "city", "liverpool", "chelsea", "arsenal", "tottenham",
  "bayern", "dortmund", "psg", "paris", "juventus", "milan", "inter", "atletico",
  "al nassr", "al hilal", "inter miami", "argentina", "brazil", "portugal", "france", "spain", "germany",
  "champions league", "ucl", "premier league", "la liga", "serie a", "bundesliga", "copa america", "euro"
];

function isNotableEvent(title, t1, t2, tournament) {
  const text = `${title} ${t1} ${t2} ${tournament}`.toLowerCase();
  return NOTABLE_KEYWORDS.some(kw => text.includes(kw));
}

// ৩. ESPN ফ্রি পাবলিক API থেকে খেলা সংগ্রহ করা
async function fetchSportsEvents() {
  const events = [];
  const now = Date.now();

  // API Endpoints (ESPN Public JSON APIs)
  const endpoints = [
    { url: "https://site.api.espn.com/apis/site/v2/sports/cricket/8039/scoreboard", category: "Cricket" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard", category: "Football" }
  ];

  for (const ep of endpoints) {
    try {
      console.log(`📡 Fetching ${ep.category} events...`);
      const res = await axios.get(ep.url);
      const data = res.data;

      if (data && data.events) {
        for (const ev of data.events) {
          const comp = ev.competitions ? ev.competitions[0] : null;
          if (!comp) continue;

          // সঠিক UTC টাইমস্ট্যাম্প (যা অ্যাপে স্বয়ংক্রিয়ভাবে বাংলাদেশ সময় হয়ে যাবে)
          const startTime = new Date(ev.date).getTime();
          if (isNaN(startTime)) continue;

          // খেলা শেষ হওয়ার সময় (ডিফল্ট ৪ ঘণ্টা পর)
          const endTime = startTime + (4 * 60 * 60 * 1000);

          // পুরনো বা শেষ হয়ে যাওয়া ম্যাচ বাদ দেওয়া
          if (now > endTime) continue;

          const competitors = comp.competitors || [];
          const t1 = competitors[0] || {};
          const t2 = competitors[1] || {};

          const team1Name = t1.team?.displayName || t1.team?.name || "Team 1";
          const team1Logo = t1.team?.logo || "";
          const team2Name = t2.team?.displayName || t2.team?.name || "Team 2";
          const team2Logo = t2.team?.logo || "";

          const tournamentName = ev.season?.displayName || ev.name || ep.category;
          const matchTitle = ev.shortName || `${team1Name} vs ${team2Name}`;

          // শুধুমাত্র উল্লেখযোগ্য (High Hype) ম্যাচ ফিল্টার করা
          if (!isNotableEvent(matchTitle, team1Name, team2Name, tournamentName)) {
            console.log(`⏭️ Skipping non-hype match: ${team1Name} vs ${team2Name}`);
            continue;
          }

          // ইউনিক ID তৈরি
          const id = `auto_${ep.category.toLowerCase()}_${ev.id}`;

          events.push({
            id: id,
            name: `${team1Name} vs ${team2Name}`,
            category: ep.category,
            title: tournamentName,
            startTime: startTime,
            endTime: endTime,
            team1Name: team1Name,
            team1Logo: team1Logo,
            team2Name: team2Name,
            team2Logo: team2Logo,
            orderIndex: startTime, // সময়ের ক্রমানুসারে সাজানো
            isHidden: false
          });
        }
      }
    } catch (err) {
      console.error(`⚠️ Error fetching ${ep.category}:`, err.message);
    }
  }

  return events;
}

// ৪. ফায়ারবেস ডেটাবেস আপডেট করা
async function updateDatabase() {
  console.log("🚀 Starting Auto Sports Update...");
  const newEvents = await fetchSportsEvents();
  console.log(`🎯 Found ${newEvents.length} notable high-hype events!`);

  const batch = db.batch();
  const eventsRef = db.collection("live_events");

  // পুরনো ও মেয়াদোত্তীর্ণ অটো-ইভেন্টগুলো ডিলিট করা
  const snapshot = await eventsRef.get();
  const now = Date.now();

  snapshot.forEach(doc => {
    const data = doc.data();
    // যদি অটো-অ্যাড করা ইভেন্ট হয় এবং সময় শেষ হয়ে যায়, তবে রিমুভ করবে
    if (doc.id.startsWith("auto_") && (data.endTime < now || data.startTime < now - 6*3600*1000)) {
      batch.delete(doc.ref);
    }
  });

  // নতুন ইভেন্টগুলো যুক্ত করা (Upsert)
  newEvents.forEach(ev => {
    const docRef = eventsRef.document(ev.id);
    batch.set(docRef, ev, { merge: true });
  });

  await batch.commit();
  console.log("✅ Successfully updated live_events in Firebase!");
  process.exit(0);
}

updateDatabase();
