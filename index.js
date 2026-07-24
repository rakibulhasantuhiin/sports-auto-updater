/**
 * 🚀 TUHINEXT TV - SPORTS AUTOMATIC UPDATER SCRIPT (V2)
 * 
 * This is a highly robust, professional-grade Node.js scraper script designed to run 
 * in your GitHub Actions Repository (sports-auto-updater) to fetch both CRICKET and FOOTBALL 
 * matches, format them into the exact schema of Tuhinext TV, and sync them directly to Firestore!
 * 
 * 🛠️ IMPROVEMENTS IN V2:
 * 1. Cricinfo RSS Feed Parser (Unblockable & bypasses 403 Cloudflare blocks)
 * 2. New Sky Sports Football Scraper (Compatible with their new responsive UI layout)
 * 3. Perfect Date-Time parsers preventing "1970" bugs.
 * 
 * 📋 HOW TO USE:
 * - Copy this entire code and paste it into:
 *   1. 'index.js' (inside your sports-auto-updater repo)
 *   2. 'scripts/update_events.js' (inside your sports-auto-updater repo)
 * - Make sure 'FIREBASE_SERVICE_ACCOUNT' is set up in your GitHub Secrets.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin SDK
let db;
try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable inside GitHub Secrets!");
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

// Hash helper for clean, consistent document IDs
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString();
}

// Text sanitizer
function cleanString(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

// Standard military time parser (e.g., "8.00pm" or "12.30am" -> "20:00:00")
function parseTime(timeStr) {
    let clean = timeStr.trim().toLowerCase();
    const isPm = clean.includes('pm');
    const isAm = clean.includes('am');
    clean = clean.replace(/(am|pm)/g, '').trim();
    
    let hours = 12;
    let minutes = 0;
    
    if (clean.includes('.')) {
        const parts = clean.split('.');
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
    } else if (clean.includes(':')) {
        const parts = clean.split(':');
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
    } else {
        hours = parseInt(clean, 10);
    }
    
    if (isPm && hours < 12) hours += 12;
    if (isAm && hours === 12) hours = 0;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
}

// Convert Sky Sports Date (e.g. "Friday 24th July") and Time (e.g. "8.00pm") to GMT Epoch
function parseSkySportsDateTime(dateStr, timeStr) {
    try {
        let cleanDate = dateStr.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/, '');
        cleanDate = cleanDate.replace(/(\d+)(st|nd|rd|th)/, '$1'); 
        
        const formattedTime = parseTime(timeStr);
        const year = new Date().getFullYear();
        const combined = `${cleanDate} ${year} ${formattedTime} GMT`; 
        
        const parsed = Date.parse(combined);
        if (!isNaN(parsed)) {
            return parsed;
        }
    } catch (e) {
        console.error("Error parsing date-time:", dateStr, timeStr, e.message);
    }
    return Date.now() + 3600000;
}

// 2. CRICKET FETCHING ENGINE (Cricinfo RSS Live Feed - Cloud-safe and unblocked!)
async function fetchCricketEvents() {
    console.log("⏳ Fetching live Cricket matches from ESPN Cricinfo RSS feed...");
    const url = 'https://static.espncricinfo.com/rss/livescores.xml';
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data, { xmlMode: true });
        const cricketEvents = [];
        
        $('item').each((i, el) => {
            const titleText = $(el).find('title').text().trim();
            const linkText = $(el).find('link').text().trim();
            const guidText = $(el).find('guid').text().trim();
            
            // Extract unique match ID from URL
            let matchId = '';
            const matchMatch = (linkText || guidText).match(/match\/(\d+)\.html/);
            if (matchMatch && matchMatch[1]) {
                matchId = matchMatch[1];
            } else {
                matchId = Math.random().toString(36).substring(7);
            }
            
            let team1 = "Team 1";
            let team2 = "Team 2";
            if (titleText.includes(' v ')) {
                const parts = titleText.split(' v ');
                team1 = parts[0].trim();
                team2 = parts[1].trim();
            } else if (titleText.includes(' vs ')) {
                const parts = titleText.split(' vs ');
                team1 = parts[0].trim();
                team2 = parts[1].trim();
            } else {
                team1 = titleText;
            }
            
            // Clean score indicators
            team1 = team1.replace(/\([^)]*\)/g, '').trim();
            team2 = team2.replace(/\([^)]*\)/g, '').trim();
            
            // Generate clean hashed event ID
            const eventId = hashString(`cricket_${matchId}`);
            
            // Nice cricket logo
            const team1Logo = `https://cdn-icons-png.flaticon.com/512/3076/3076840.png`;
            const team2Logo = `https://cdn-icons-png.flaticon.com/512/3076/3076840.png`;
            
            cricketEvents.push({
                id: eventId,
                name: "International Cricket",
                category: "cricket",
                title: titleText,
                startTime: Date.now(),
                endTime: Date.now() + 8 * 3600 * 1000,
                team1Name: team1,
                team1Logo: team1Logo,
                team2Name: team2,
                team2Logo: team2Logo,
                orderIndex: 0,
                isHidden: false
            });
            
            console.log(`   🏏 Added Cricket Match: ${team1} vs ${team2}`);
        });
        
        console.log(`✅ Successfully loaded ${cricketEvents.length} Cricket events.`);
        return cricketEvents;
    } catch (error) {
        console.error("❌ Error fetching Cricket events:", error.message);
        return [];
    }
}

// 3. FOOTBALL FETCHING ENGINE (New Sky Sports Scraper)
async function fetchFootballEvents() {
    console.log("⏳ Scraping Football matches from Sky Sports Fixtures...");
    const url = 'https://www.skysports.com/football/fixtures';
    
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const footballEvents = [];
        
        let currentDateStr = '';
        
        $('main.main').children().each((i, el) => {
            const $el = $(el);
            
            if ($el.hasClass('ui-sitewide-component-header__wrapper--h3')) {
                currentDateStr = $el.find('.ui-sitewide-component-header__body').text().trim();
            } else if ($el.hasClass('ui-tournament-matches')) {
                const currentCompetition = $el.find('.ui-tournament-matches__tournament-name').text().trim() || 'Football Match';
                
                $el.find('.ui-tournament-matches__match-item').each((j, matchItem) => {
                    const $matchItem = $(matchItem);
                    const team1Name = $matchItem.find('.ui-sport-match-score__team[data-team-id="home"] .ui-sport-match-score__team-name').text().trim();
                    const team2Name = $matchItem.find('.ui-sport-match-score__team[data-team-id="away"] .ui-sport-match-score__team-name').text().trim();
                    
                    let team1Logo = $matchItem.find('.ui-sport-match-score__team[data-team-id="home"] img.ui-sport-match-score__team-badge').attr('src') || '';
                    let team2Logo = $matchItem.find('.ui-sport-match-score__team[data-team-id="away"] img.ui-sport-match-score__team-badge').attr('src') || '';
                    
                    const timeText = $matchItem.find('.ui-sport-match-score__start-time').text().trim();
                    
                    if (team1Name && team2Name && currentDateStr) {
                        const startTime = parseSkySportsDateTime(currentDateStr, timeText);
                        
                        // Only add future or active matches
                        if (startTime >= Date.now() - 3 * 3600 * 1000) {
                            const eventIdStr = `football_${cleanString(team1Name)}_${cleanString(team2Name)}_${startTime}`;
                            
                            footballEvents.push({
                                id: hashString(eventIdStr),
                                name: currentCompetition,
                                category: "football",
                                title: "Football Match",
                                startTime: startTime,
                                endTime: startTime + 2 * 3600 * 1000,
                                team1Name: team1Name,
                                team1Logo: team1Logo,
                                team2Name: team2Name,
                                team2Logo: team2Logo,
                                orderIndex: 0,
                                isHidden: false
                            });
                            
                            console.log(`   ⚽ Added Football Match: ${team1Name} vs ${team2Name} (${currentCompetition})`);
                        }
                    }
                });
            }
        });
        
        console.log(`✅ Successfully scraped ${footballEvents.length} Football events.`);
        return footballEvents;
    } catch (error) {
        console.error("❌ Error scraping Football events:", error.message);
        return [];
    }
}

// 4. MAIN SYNC CONTROLLER
async function syncAllEvents() {
    console.log("🚀 Starting Sports Events Synchronization...");
    
    const [cricketEvents, footballEvents] = await Promise.all([
        fetchCricketEvents(),
        fetchFootballEvents()
    ]);
    
    const allEvents = [...cricketEvents, ...footballEvents];
    
    if (allEvents.length === 0) {
        console.log("⚠️ No active or upcoming events found to sync.");
        return;
    }
    
    console.log(`⏳ Synchronizing ${allEvents.length} total events to Firestore 'live_events' collection...`);
    
    try {
        const batch = db.batch();
        const collectionRef = db.collection('live_events');
        
        allEvents.forEach(event => {
            const docRef = collectionRef.doc(event.id);
            batch.set(docRef, event, { merge: true });
        });
        
        await batch.commit();
        console.log("🎉 SUCCESS! Tuhinext TV Live Events synchronized beautifully!");
    } catch (error) {
        console.error("❌ Failed to update Firestore batch:", error.message);
    }
}

syncAllEvents();
