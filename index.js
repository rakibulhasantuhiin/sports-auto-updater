/**
 * Sports Auto Updater Scraper for Cricket and Football
 */

const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

// ১. Firebase Admin SDK ইনিশিয়ালাইজ করা
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
    console.log("✅ Firebase Admin successfully initialized!");
} catch (error) {
    console.error("❌ Failed to initialize Firebase:", error.message);
    process.exit(1);
}

// ইউনিক আইডি বানানোর জন্য হ্যাশ ফাংশন
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

// Sky Sports ডেট-টাইম পার্স করার ফাংশন
function parseSkySportsDateTime(dateStr, timeStr) {
    try {
        let cleanDate = dateStr.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/, '');
        cleanDate = cleanDate.replace(/(\d+)(st|nd|rd|th)/, '$1');
        
        const combined = `${cleanDate} ${timeStr || '12:00'} GMT`;
        const parsed = Date.parse(combined);
        if (!isNaN(parsed)) {
            return parsed;
        }
    } catch (e) {
        console.error("Error parsing date-time:", dateStr, timeStr);
    }
    return Date.now() + 3600000;
}

// ২. ক্রিকেট কালেকশন ইঞ্জিন (ESPN Cricinfo API - সম্পূর্ণ অটোমেটিক ও শক্তিশালী)
async function fetchCricketEvents() {
    console.log("⏳ Fetching cricket matches from ESPN Cricinfo...");
    const url = 'https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en';
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://www.espncricinfo.com',
                'Referer': 'https://www.espncricinfo.com/'
            },
            timeout: 10000
        });
        
        // Cricinfo এপিআই রেসপন্স দুইভাবে ডাটা দিতে পারে, তাই আমরা দুটি পথই চেক করে নিব যেন কখনো ডাটা মিস না হয়
        let matches = [];
        if (response.data) {
            if (Array.isArray(response.data.matches)) {
                matches = response.data.matches;
            } else if (response.data.content && Array.isArray(response.data.content.matches)) {
                matches = response.data.content.matches;
            }
        }
        
        console.log(`ℹ️ Found ${matches.length} total matches in raw Cricinfo API.`);
        const cricketEvents = [];
        
        matches.forEach(m => {
            // যদি ম্যাচের রেজাল্ট চলে আসে (অর্থাৎ খেলা শেষ), তাহলে স্কিপ করবে
            if (m.status === 'RESULT') {
                console.log(`   Skip completed: ${m.title || 'Match'} (${m.slug || 'no-slug'})`);
                return; 
            }
            
            const matchId = `cricket_${m.objectId}`;
            const seriesName = m.series ? (m.series.name || m.series.shortName || "Cricket Series") : "Cricket Series";
            const title = m.title || "Match";
            
            const startTime = m.startTime ? new Date(m.startTime).getTime() : Date.now();
            const endTime = m.endTime ? new Date(m.endTime).getTime() : startTime + 8 * 3600 * 1000; // Default 8 hours for cricket
            
            const team1Obj = m.teams && m.teams[0] ? m.teams[0].team : null;
            const team2Obj = m.teams && m.teams[1] ? m.teams[1].team : null;
            
            if (!team1Obj || !team2Obj) {
                console.log(`   Skip match due to missing teams: ${title}`);
                return;
            }
            
            const team1Name = team1Obj.name || team1Obj.longName || "Team 1";
            const team1Logo = team1Obj.logo ? (team1Obj.logo.url || "") : "";
            const team2Name = team2Obj.name || team2Obj.longName || "Team 2";
            const team2Logo = team2Obj.logo ? (team2Obj.logo.url || "") : "";
            
            console.log(`   ➕ Adding Cricket Match: ${team1Name} vs ${team2Name} (${seriesName})`);
            
            cricketEvents.push({
                id: hashString(matchId),
                name: seriesName,
                category: "cricket",
                title: title,
                startTime: startTime,
                endTime: endTime,
                team1Name: team1Name,
                team1Logo: team1Logo,
                team2Name: team2Name,
                team2Logo: team2Logo,
                orderIndex: 0,
                isHidden: false
            });
        });
        
        console.log(`✅ Successfully compiled ${cricketEvents.length} active/upcoming Cricket events.`);
        return cricketEvents;
    } catch (error) {
        console.error("❌ Error fetching Cricket events:", error.message);
        return [];
    }
}

// ৩. ফুটবল স্ক্র্যাপিং ইঞ্জিন (Sky Sports Football Fixtures)
async function fetchFootballEvents() {
    console.log("⏳ Scraping football matches from Sky Sports...");
    const url = 'https://www.skysports.com/football/fixtures';
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            },
            timeout: 10000
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
                        endTime: startTime + 2 * 3600 * 1000, // 2 Hours
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
        
        console.log(`✅ Successfully compiled ${footballEvents.length} Football events.`);
        return footballEvents;
    } catch (error) {
        console.error("❌ Error scraping Football events:", error.message);
        return [];
    }
}

// ৪. মেইন কন্ট্রোলার (ডাটা ফায়ারবেসে সিঙ্ক করার জন্য)
async function syncAllEvents() {
    console.log("🚀 Starting Sports Events Sync...");
    
    // ক্রিকেট এবং ফুটবল দুইটাই একসাথে রান হবে
    const [cricketEvents, footballEvents] = await Promise.all([
        fetchCricketEvents(),
        fetchFootballEvents()
    ]);
    
    const allEvents = [...cricketEvents, ...footballEvents];
    
    if (allEvents.length === 0) {
        console.log("⚠️ No active or upcoming events to sync.");
        return;
    }
    
    console.log(`⏳ Uploading ${allEvents.length} total events to Firestore...`);
    
    try {
        const batch = db.batch();
        const collectionRef = db.collection('live_events');
        
        allEvents.forEach(event => {
            const docRef = collectionRef.doc(event.id);
            batch.set(docRef, event, { merge: true });
        });
        
        await batch.commit();
        console.log("🎉 SUCCESS! Firestore successfully updated with Cricket & Football matches!");
    } catch (error) {
        console.error("❌ Failed to update Firestore batch:", error.message);
    }
}

syncAllEvents();
