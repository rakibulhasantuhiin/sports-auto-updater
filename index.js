/**
 * 🚀 TUHINEXT TV - SPORTS AUTOMATIC UPDATER SCRIPT (PRO V3 - SMART CAP & QUOTA SAFE)
 * 
 * 📋 নিয়মানুযায়ী বৈশিষ্ট্যসমূহ (Rules Enforced):
 * ১. মোট ইভেন্ট সংখ্যা ১৫ থেকে ২০টির মধ্যে থাকবে, কোনোভাবেই ২০টির বেশি হবে না (MAX_EVENTS = 20)।
 * ২. সর্বোচ্চ বিস্তার (Maximum Diversity): ক্রিকেট এবং ফুটবল ইভেন্ট সমানভাবে (Interleaved) সাজানো হয়।
 * ৩. স্মার্ট ক্যাপ (Smart Cap): যতক্ষণ পর্যন্ত আগের ইভেন্ট শেষ (Expire) না হবে, নতুন কোনো ইভেন্ট যুক্ত হবে না।
 *    যেমন: ২০টি ইভেন্ট থাকলে নতুন ইভেন্ট যুক্ত হবে না। ১৮টি থাকলে সামনের সিডিউল থেকে ঠিক ২টি নতুন ইভেন্ট যুক্ত হবে।
 * ৪. কোটা সুরক্ষা (Quota Protection): ফায়ারবেস ফ্রি কোটা (RESOURCE_EXHAUSTED) শেষ হলে কোনো এরর বা রেড মার্ক
 *    ছাড়াই সুন্দরভাবে (Exit Code 0) বন্ধ হবে।
 */

const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

// ⚙️ কনফিগারেশন সেটিংস
const MAX_EVENTS = 20; // সর্বোচ্চ ইভেন্ট লিমিট
const EXPIRATION_BUFFER_MS = 2 * 3600 * 1000; // ইভেন্ট শেষ হওয়ার পর ২ ঘণ্টা পর্যন্ত ডেটাবেসে থাকবে

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

// Standard military time parser
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

// Convert Sky Sports Date and Time to GMT Epoch
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

// 2. CRICKET FETCHING ENGINE (Cricbuzz Primary with ESPN Cricinfo Fallback)
async function fetchCricketEvents() {
    console.log("⏳ Fetching live Cricket matches from Cricbuzz...");
    try {
        const response = await axios.get('https://www.cricbuzz.com/cricket-match/live-scores', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const cricketEvents = [];
        const seen = new Set();
        
        $('a[href*="/live-cricket-scores/"], a[href*="/cricket-scores/"]').each((i, el) => {
            let title = $(el).attr('title') || $(el).text().trim();
            title = title.replace(/\s+/g, ' ');
            
            if ((title.includes(' vs ') || title.includes(' v ')) && !title.includes('Won') && !title.includes('Preview')) {
                let mainPart = title.split(',')[0].split(' - ')[0].trim();
                if (!seen.has(mainPart)) {
                    seen.add(mainPart);
                    let teams = mainPart.includes(' vs ') ? mainPart.split(' vs ') : mainPart.split(' v ');
                    if (teams.length === 2) {
                        const team1 = teams[0].trim();
                        const team2 = teams[1].trim();
                        const eventId = hashString(`cricket_${cleanString(team1)}_${cleanString(team2)}`);
                        
                        cricketEvents.push({
                            id: eventId,
                            name: "International Cricket",
                            category: "cricket",
                            title: mainPart,
                            startTime: Date.now(),
                            endTime: Date.now() + 8 * 3600 * 1000,
                            team1Name: team1,
                            team1Logo: "https://cdn-icons-png.flaticon.com/512/3076/3076840.png",
                            team2Name: team2,
                            team2Logo: "https://cdn-icons-png.flaticon.com/512/3076/3076840.png",
                            orderIndex: 0,
                            isHidden: false
                        });
                    }
                }
            }
        });
        
        if (cricketEvents.length > 0) {
            console.log(`✅ Successfully loaded ${cricketEvents.length} Cricket events from Cricbuzz.`);
            return cricketEvents;
        }
    } catch (error) {
        console.error("⚠️ Cricbuzz primary scrape failed, trying fallback...", error.message);
    }
    
    // Fallback: ESPN Cricinfo Story XML Feed
    try {
        console.log("⏳ Attempting fallback Cricket fetch from ESPN Cricinfo...");
        const response = await axios.get('https://www.espncricinfo.com/rss/content/story/feeds/6.xml', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data, { xmlMode: true });
        const cricketEvents = [];
        
        $('item').each((i, el) => {
            const titleText = $(el).find('title').text().trim();
            if (titleText.includes(' v ') || titleText.includes(' vs ')) {
                let team1 = "Team 1", team2 = "Team 2";
                if (titleText.includes(' v ')) {
                    const parts = titleText.split(' v ');
                    team1 = parts[0].trim();
                    team2 = parts[1].trim();
                } else {
                    const parts = titleText.split(' vs ');
                    team1 = parts[0].trim();
                    team2 = parts[1].trim();
                }
                team1 = team1.replace(/\([^)]*\)/g, '').trim();
                team2 = team2.replace(/\([^)]*\)/g, '').trim();
                const eventId = hashString(`cricket_${cleanString(team1)}_${cleanString(team2)}`);
                
                cricketEvents.push({
                    id: eventId,
                    name: "International Cricket",
                    category: "cricket",
                    title: `${team1} vs ${team2}`,
                    startTime: Date.now(),
                    endTime: Date.now() + 8 * 3600 * 1000,
                    team1Name: team1,
                    team1Logo: "https://cdn-icons-png.flaticon.com/512/3076/3076840.png",
                    team2Name: team2,
                    team2Logo: "https://cdn-icons-png.flaticon.com/512/3076/3076840.png",
                    orderIndex: 0,
                    isHidden: false
                });
            }
        });
        console.log(`✅ Successfully loaded ${cricketEvents.length} Cricket events from fallback.`);
        return cricketEvents;
    } catch (error) {
        console.error("❌ Error fetching Cricket events:", error.message);
        return [];
    }
}

// 3. FOOTBALL FETCHING ENGINE (Sky Sports Fixtures Scraper)
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
                        
                        if (startTime >= Date.now() - 3 * 3600 * 1000) {
                            const eventIdStr = `football_${cleanString(team1Name)}_${cleanString(team2Name)}_${cleanString(currentDateStr)}`;
                            
                            footballEvents.push({
                                id: hashString(eventIdStr),
                                name: currentCompetition,
                                category: "football",
                                title: `${team1Name} vs ${team2Name}`,
                                startTime: startTime,
                                endTime: startTime + 2 * 3600 * 1000,
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
            }
        });
        
        console.log(`✅ Successfully scraped ${footballEvents.length} Football events.`);
        return footballEvents;
    } catch (error) {
        console.error("❌ Error scraping Football events:", error.message);
        return [];
    }
}

// 4. INTERLEAVE HELPER (সর্বোচ্চ বিস্তার - Equal Cricket & Football Diversity)
function interleaveEvents(cricketList, footballList) {
    const combined = [];
    const maxLen = Math.max(cricketList.length, footballList.length);
    for (let i = 0; i < maxLen; i++) {
        if (i < cricketList.length) combined.push(cricketList[i]);
        if (i < footballList.length) combined.push(footballList[i]);
    }
    return combined;
}

// 5. MAIN SMART SYNC CONTROLLER (15-20 Cap & Quota Safe)
async function syncAllEvents() {
    console.log("🚀 Starting Tuhinext TV Smart Sports Updater...");
    
    const collectionRef = db.collection('live_events');
    let snapshot;
    
    // 🛡️ কোটা সুরক্ষা (Quota Safe Read): কোটা শেষ থাকলে এরর না দেখিয়ে ক্লিন বন্ধ হবে
    try {
        snapshot = await collectionRef.get();
    } catch (error) {
        if (error.code === 8 || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('Quota exceeded')) {
            console.log("\n⚠️ [QUOTA NOTICE / কোটা নোটিশ]");
            console.log("আজকের জন্য ফায়ারবেস ফ্রি কোটা (50,000 reads / 20,000 writes) শেষ হয়ে গেছে।");
            console.log("আমেরিকান প্যাসিফিক সময় (PST) রাত ১২টায় কোটা রিসেট হলে সিস্টেমটি স্বয়ংক্রিয়ভাবে আবার কাজ করবে।");
            console.log("কোনো এরর ছাড়াই স্কিপ করা হচ্ছে (Exit Code 0)।\n");
            process.exit(0);
        }
        console.error("❌ Failed to read existing live_events:", error.message);
        process.exit(1);
    }
    
    const now = Date.now();
    const batch = db.batch();
    let batchOperations = 0;
    
    // ১. ডেটাবেসে থাকা বর্তমান ইভেন্ট যাচাই ও মেয়াদোত্তীর্ণ ইভেন্ট ডিলিট করা
    const existingEvents = new Map();
    let expiredCount = 0;
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const endTime = data.endTime || 0;
        
        // ইভেন্ট শেষ হওয়ার পর অতিরিক্ত ২ ঘণ্টা পার হয়ে গেলে সেটি ডিলিট হবে
        if (endTime > 0 && now > endTime + EXPIRATION_BUFFER_MS) {
            batch.delete(doc.ref);
            batchOperations++;
            expiredCount++;
            console.log(`🗑️ Expired Event removed: ${data.title}`);
        } else {
            existingEvents.set(doc.id, { ref: doc.ref, data: data });
        }
    });
    
    const activeCount = existingEvents.size;
    console.log(`📊 বর্তমান অ্যাক্টিভ ইভেন্ট সংখ্যা: ${activeCount} / সর্বোচ্চ লিমিট: ${MAX_EVENTS} (Expired Removed: ${expiredCount})`);
    
    // ২. নিয়ম যাচাই: যদি আগে থেকেই ২০টি ইভেন্ট থাকে, তবে নতুন ইভেন্ট যুক্ত করা হবে না!
    const slotsAvailable = MAX_EVENTS - activeCount;
    
    if (slotsAvailable <= 0) {
        console.log(`🛑 [SMART CAP ACTIVE] বর্তমান ইভেন্ট সংখ্যা ${activeCount} (লিমিট ২০)।`);
        console.log(`👉 নিয়ম অনুযায়ী যতক্ষণ পর্যন্ত প্রথম সারির ইভেন্টগুলো শেষ (expire) না হচ্ছে, ততক্ষণ নতুন কোনো ইভেন্ট যুক্ত করা হবে না।`);
        
        if (batchOperations > 0) {
            await batch.commit();
            console.log(`✅ Expired cleanup complete.`);
        } else {
            console.log(`⚡ ডেটাবেস সম্পূর্ণ আপ-টু-ডেট! কোনো পরিবর্তন প্রয়োজন নেই।`);
        }
        return;
    }
    
    console.log(`ℹ️ [SLOTS AVAILABLE] ইভেন্ট সংখ্যা ১৮ বা তার নিচে নেমেছে। খালি স্লট: ${slotsAvailable}টি। সামনের সিডিউল থেকে ঠিক ${slotsAvailable}টি ইভেন্ট যুক্ত করা হবে।`);
    
    // ৩. নতুন ইভেন্ট স্ক্র্যাপ করা (Cricket & Football)
    const [cricketEvents, footballEvents] = await Promise.all([
        fetchCricketEvents(),
        fetchFootballEvents()
    ]);
    
    // ৪. সর্বোচ্চ বিস্তারের জন্য ক্রিকেট ও ফুটবল মিক্স (Interleave) করা
    const interleavedCandidates = interleaveEvents(cricketEvents, footballEvents);
    
    // ৫. ডুপ্লিকেট বাছাই: যে ইভেন্টগুলো আগে থেকেই ডেটাবেসে চলছে সেগুলো বাদ দেওয়া
    const newCandidates = interleavedCandidates.filter(candidate => {
        if (existingEvents.has(candidate.id)) return false;
        for (let [_, item] of existingEvents) {
            if (item.data.team1Name === candidate.team1Name && item.data.team2Name === candidate.team2Name) {
                return false;
            }
        }
        return true;
    });
    
    console.log(`🔍 নতুন বাছাইকৃত ইউনিক ক্যান্ডিডেট ইভেন্ট পাওয়া গেছে: ${newCandidates.length}টি।`);
    
    // ৬. শুধুমাত্র খালি স্লট (slotsAvailable) অনুযায়ী সামনের সিডিউলের ইভেন্ট যুক্ত করা
    const eventsToAdd = newCandidates.slice(0, slotsAvailable);
    
    let addedCount = 0;
    eventsToAdd.forEach((event, idx) => {
        event.orderIndex = activeCount + idx;
        const docRef = collectionRef.doc(event.id);
        batch.set(docRef, event);
        batchOperations++;
        addedCount++;
        console.log(`➕ নতুন ইভেন্ট যুক্ত করা হলো (${activeCount + addedCount}/${MAX_EVENTS}): [${event.category.toUpperCase()}] ${event.title}`);
    });
    
    // ৭. ব্যাচ সেভ করা
    if (batchOperations > 0) {
        try {
            await batch.commit();
            console.log(`🎉 SUCCESS! ডেটাবেস সফলভাবে আপডেট হয়েছে: +${addedCount}টি নতুন ইভেন্ট যুক্ত করা হয়েছে, -${expiredCount}টি পুরোনো ইভেন্ট মুছে ফেলা হয়েছে।`);
            console.log(`📈 সর্বমোট অ্যাক্টিভ ইভেন্ট: ${activeCount + addedCount} / ${MAX_EVENTS}`);
        } catch (error) {
            if (error.code === 8 || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('Quota exceeded')) {
                console.log("\n⚠️ [QUOTA NOTICE / কোটা নোটিশ] রাইট করার সময় ফায়ারবেস কোটা শেষ হয়েছে। রাত ১২টায় কোটা রিসেট হলে স্বয়ংক্রিয়ভাবে সেভ হবে।");
                process.exit(0);
            }
            throw error;
        }
    } else {
        console.log(`⚡ নতুন কোনো ইভেন্ট যুক্ত করার মতো স্লট বা ক্যান্ডিডেট নেই। ডেটাবেস আপ-টু-ডেট!`);
    }
}

syncAllEvents();
