/**
 * Tuhinext TV app-এর জন্য ক্রিকেট এবং ফুটবলের রিয়েল-টাইম স্ক্রিপ্ট।
 * এটি ESPN Cricinfo API এবং Sky Sports থেকে ডাটা নিয়ে সরাসরি Firebase Firestore-এ আপলোড করে।
 */

const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

// Firebase Admin SDK ইনিশিয়াল করা
let db;
try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable!");
    }
    
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson))
    });
    db = admin.firestore();
    console.log("✅ Firebase Admin initialized successfully!");
} catch (error) {
    console.error("❌ Failed to initialize Firebase:", error.message);
    process.exit(1);
}

// ইউনিক ডক আইডি জেনারেট করার জন্য হ্যাশ ফাংশন
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString();
}

function cleanString(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

// Sky Sports-এর টাইম জোন এবং ফরম্যাট অনুযায়ী টাইমস্ট্যাম্প বের করা
function parseSkySportsDateTime(dateStr, timeStr) {
    try {
        let cleanDate = dateStr.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/, '');
        cleanDate = cleanDate.replace(/(\d+)(st|nd|rd|th)/, '$1'); // "24th" -> "24"
        
        const combined = `${cleanDate} ${timeStr || '12:00'} GMT`; // UK time (GMT)
        const parsed = Date.parse(combined);
        if (!isNaN(parsed)) {
            return parsed;
        }
    } catch (e) {
        console.error("Error parsing date-time:", dateStr, timeStr);
    }
    return Date.now() + 3600000;
}

// ১. ক্রিকেট ম্যাচ নিয়ে আসার ইঞ্জিন (ESPN Cricinfo API - ১০০% নির্ভরযোগ্য এবং কোনো API Key ছাড়াই চলে!)
async function fetchCricketEvents() {
    console.log("⏳ ESPN Cricinfo থেকে ক্রিকেটের ম্যাচ ডাটা আনা হচ্ছে...");
    const url = 'https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en';
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            }
        });
        
        const matches = response.data.matches || [];
        const cricketEvents = [];
        
        matches.forEach(m => {
            // শুধুমাত্র লাইভ অথবা আপকামিং ম্যাচগুলো নেওয়া হচ্ছে (রেজাল্ট হয়ে গেছে এমন ম্যাচ ফিল্টার করা হচ্ছে)
            if (m.status === 'RESULT') return; 
            
            const matchId = `cricket_${m.objectId}`;
            const seriesName = m.series ? m.series.name : "Cricket Match";
            const title = m.title || "Match";
            
            const startTime = new Date(m.startTime).getTime();
            const endTime = m.endTime ? new Date(m.endTime).getTime() : startTime + 8 * 3600 * 1000; // ক্রিকেট ম্যাচ সাধারণ ৮ ঘণ্টার ধরা হয়েছে
            
            const team1 = m.teams[0] ? m.teams[0].team : null;
            const team2 = m.teams[1] ? m.teams[1].team : null;
            
            if (!team1 || !team2) return;
            
            cricketEvents.push({
                id: hashString(matchId),
                name: seriesName,
                category: "cricket",
                title: title,
                startTime: startTime,
                endTime: endTime,
                team1Name: team1.name,
                team1Logo: team1.logo ? team1.logo.url : "",
                team2Name: team2.name,
                team2Logo: team2.logo ? team2.logo.url : "",
                orderIndex: 0,
                isHidden: false
            });
        });
        
        console.log(`✅ ${cricketEvents.length} টি ক্রিকেট ম্যাচ পাওয়া গেছে।`);
        return cricketEvents;
    } catch (error) {
        console.error("❌ ক্রিকেট ডাটা আনতে সমস্যা হয়েছে:", error.message);
        return [];
    }
}

// ২. ফুটবল ম্যাচ স্ক্র্যাপ করার ইঞ্জিন (Sky Sports Fixtures Scraper)
async function fetchFootballEvents() {
    console.log("⏳ Sky Sports থেকে ফুটবল ম্যাচ স্ক্র্যাপ করা হচ্ছে...");
    const url = 'https://www.skysports.com/football/fixtures';
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        const footballEvents = [];
        
        let currentDateStr = '';
        let currentCompetition = 'Football';
        
        $('.fixres__header1, .fixres__header2, .fixres__item').each((i, elem) => {
            const $elem = $(elem);
            if ($elem.hasClass('fixres__header1')) {
                currentDateStr = $elem.text().trim();
            } else if ($elem.hasClass('fixres__header2')) {
                currentCompetition = $elem.text().trim();
            } else if ($elem.hasClass('fixres__item')) {
                const team1Name = $elem.find('.matches__item-col--home .swap-text__target').text().trim();
                const team2Name = $elem.find('.matches__item-col--away .swap-text__target').text().trim();
                
                let team1Logo = $elem.find('.matches__item-col--home img.logo').attr('src') || '';
                let team2Logo = $elem.find('.matches__item-col--away img.logo').attr('src') || '';
                
                const timeText = $elem.find('.matches__date').text().trim();
                
                if (team1Name && team2Name && currentDateStr) {
                    const startTime = parseSkySportsDateTime(currentDateStr, timeText);
                    const eventIdStr = `football_${cleanString(team1Name)}_${cleanString(team2Name)}_${startTime}`;
                    
                    footballEvents.push({
                        id: hashString(eventIdStr),
                        name: currentCompetition,
                        category: "football",
                        title: "Match",
                        startTime: startTime,
                        endTime: startTime + 2 * 3600 * 1000, // ফুটবল ম্যাচ ২ ঘণ্টা সময় দেওয়া হয়েছে
                        team1Name: team1Name,
                        team1Logo: team1Logo,
                        team2Name: team2Name,
                        team2Logo: team2Logo,
                        orderIndex: 0,
                        isHidden: false
                    });
                }
            }
        });
        
        console.log(`✅ ${footballEvents.length} টি ফুটবল ম্যাচ স্ক্র্যাপ করা হয়েছে।`);
        return footballEvents;
    } catch (error) {
        console.error("❌ ফুটবল ডাটা স্ক্র্যাপ করতে সমস্যা হয়েছে:", error.message);
        return [];
    }
}

// ৩. সিঙ্ক কন্ট্রোলার
async function syncAllEvents() {
    console.log("🚀 স্পোর্টস ইভেন্ট সিঙ্ক করার প্রক্রিয়া শুরু হচ্ছে...");
    
    // ক্রিকেট এবং ফুটবল দুটোই একসাথে আনা হচ্ছে
    const [cricketEvents, footballEvents] = await Promise.all([
        fetchCricketEvents(),
        fetchFootballEvents()
    ]);
    
    const allEvents = [...cricketEvents, ...footballEvents];
    
    if (allEvents.length === 0) {
        console.log("⚠️ কোনো লাইভ বা আপকামিং ম্যাচ পাওয়া যায়নি।");
        return;
    }
    
    console.log(`⏳ মোট ${allEvents.length} টি ম্যাচ Firestore-এ আপলোড করা হচ্ছে...`);
    
    try {
        const batch = db.batch();
        const collectionRef = db.collection('live_events');
        
        allEvents.forEach(event => {
            const docRef = collectionRef.doc(event.id);
            batch.set(docRef, event, { merge: true });
        });
        
        await batch.commit();
        console.log("🎉 চমৎকার! ক্রিকেট এবং ফুটবল উভয় ম্যাচের ডাটা Firestore-এ আপলোড সম্পন্ন হয়েছে!");
    } catch (error) {
        console.error("❌ Firestore আপডেট করতে সমস্যা হয়েছে:", error.message);
    }
}

syncAllEvents();
