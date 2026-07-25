const admin = require('firebase-admin');
const axios = require('axios');

// ১. ফায়ারবেস ইনিশিয়ালাইজেশন
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// উল্লেখযোগ্য ক্রিকেট ও ফুটবল টিমের কিওয়ার্ড (হাইপ ফিল্টার)
const IMPORTANT_KEYWORDS = [
    // ক্রিকেট
    'ipl', 'bpl', 'psl', 't20', 'world cup', 'asia cup', 'odi', 'icc',
    'india', 'bangladesh', 'pakistan', 'australia', 'england', 'south africa',
    'new zealand', 'sri lanka', 'west indies', 'afghanistan', 'ind', 'ban', 'pak', 'aus', 'eng',
    // ফুটবল
    'real madrid', 'barcelona', 'manchester', 'united', 'city', 'liverpool',
    'chelsea', 'arsenal', 'tottenham', 'psg', 'bayern', 'dortmund', 'juventus',
    'milan', 'inter', 'atletico', 'al nassr', 'al hilal', 'miami', 'champions league',
    'ucl', 'premier league', 'la liga', 'serie a', 'bundesliga', 'copa america', 'world cup'
];

function isNotableEvent(title, category) {
    const text = `${title} ${category}`.toLowerCase();
    return IMPORTANT_KEYWORDS.some(kw => text.includes(kw));
}

async function updateLiveEvents() {
    console.log("🔄 স্পোর্টস ইভেন্ট আপডেট শুরু হচ্ছে...");
    
    try {
        // =========================================================================
        // আপনার সোর্স থেকে ডাটা ফেচ করার কোড এখানে বসান (যেমন API বা Scraping)
        // উদাহরণস্বরূপ আমরা ধরে নিচ্ছি fetchedEvents একটি অ্যারে:
        // =========================================================================
        const fetchedEvents = []; 
        // উদাহরণ:
        // const response = await axios.get('YOUR_API_URL');
        // fetchedEvents = response.data.map(...);

        // শুধুমাত্র গুরুত্বপূর্ণ (হাইপ থাকা) খেলা ফিল্টার করা
        const notableEvents = fetchedEvents.filter(event => 
            isNotableEvent(event.title || event.name, event.category || '')
        );

        console.log(`📊 মোট ইভেন্ট পাওয়া গেছে: ${fetchedEvents.length}, গুরুত্বপূর্ণ ইভেন্ট: ${notableEvents.length}`);

        // ২. ডাটাবেজ থেকে বর্তমান ইভেন্টগুলো পড়া (মাত্র ১ বার রিড হবে)
        const eventsRef = db.collection('live_events');
        const snapshot = await eventsRef.get();
        const existingEventsMap = new Map();
        snapshot.docs.forEach(doc => {
            existingEventsMap.set(doc.id, { id: doc.id, ...doc.data() });
        });

        const batch = db.batch();
        let writeCount = 0;
        let deleteCount = 0;
        const now = Date.now();

        // ৩. নতুন বা পরিবর্তিত ইভেন্টগুলো চেক করে অ্যাড/আপডেট করা
        const currentEventIds = new Set();

        for (const event of notableEvents) {
            // ইউনিক আইডি তৈরি (যেমন: ban_vs_ind_171000000)
            const eventId = event.id || `${event.team1Name}_vs_${event.team2Name}`.toLowerCase().replace(/[^a-z0-9]/g, '_');
            currentEventIds.add(eventId);

            const existing = existingEventsMap.get(eventId);

            // যদি ইভেন্টটি আগে না থাকে, অথবা সময় পরিবর্তন হয়ে থাকে, শুধু তখনই রাইট করা হবে!
            if (!existing || existing.startTime !== event.startTime || existing.title !== event.title) {
                const docRef = eventsRef.doc(eventId);
                batch.set(docRef, {
                    name: event.name || event.title,
                    title: event.title || event.name,
                    category: event.category || 'Sports',
                    startTime: event.startTime, // সোর্স থেকে প্রাপ্ত একদম সঠিক টাইমস্ট্যাম্প (মিলিসেকেন্ড)
                    endTime: event.endTime || (event.startTime + (4 * 3600 * 1000)), // ডিফল্ট ৪ ঘণ্টা
                    team1Name: event.team1Name || '',
                    team1Logo: event.team1Logo || '',
                    team2Name: event.team2Name || '',
                    team2Logo: event.team2Logo || '',
                    isHidden: false,
                    orderIndex: event.startTime // সময়ের ক্রমানুসারে সাজানোর জন্য
                }, { merge: true });
                writeCount++;
            }
        }

        // ৪. যেসব খেলা শেষ হয়ে গেছে (৬ ঘণ্টার বেশি আগে) সেগুলো ডাটাবেজ থেকে ডিলিট করা
        existingEventsMap.forEach((value, key) => {
            const isExpired = value.endTime ? (now > value.endTime + 3600000) : (now > value.startTime + (6 * 3600 * 1000));
            const noLongerInSource = !currentEventIds.has(key) && (now > value.startTime + (4 * 3600 * 1000));

            if (isExpired || noLongerInSource) {
                batch.delete(eventsRef.doc(key));
                deleteCount++;
            }
        });

        // ৫. শুধুমাত্র পরিবর্তন থাকলেই ফায়ারবেসে ব্যাচ কমিট করা হবে
        if (writeCount > 0 || deleteCount > 0) {
            await batch.commit();
            console.log(`✅ সফলভাবে আপডেট হয়েছে! নতুন/পরিবর্তিত রাইট: ${writeCount}টি, ডিলিট: ${deleteCount}টি।`);
        } else {
            console.log("⚡ কোনো নতুন পরিবর্তন নেই। ফায়ারবেস লিমিট ১০০% সেভ হয়েছে!");
        }

    } catch (error) {
        console.error("❌ আপডেট করার সময় এরর হয়েছে:", error);
        process.exit(1);
    }
}

updateLiveEvents();
