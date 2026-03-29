const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const moment = require('moment-timezone');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NEWS_CACHE_FILE = path.join(DATA_DIR, 'last_news.json');

async function fetchBreakingNews() {
    try {
        const res = await axios.get("https://www.aljazeera.net/rss", { 
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        const $ = cheerio.load(res.data, { xmlMode: true });
        const news = [];

        $('item').each((i, el) => {
            if (i < 5) { // Only top 5 fresh news
                const title = $(el).find('title').text().trim();
                const pubDate = $(el).find('pubDate').text().trim();
                if (title) news.push({ title, time: pubDate });
            }
        });
        return news;
    } catch (e) {
        console.error("[newsAutoPoster] Fetch error:", e.message);
        return [];
    }
}

async function postToFacebook(text) {
    const pages = [];
    const id1 = process.env.FB_PAGE_ID || config.fbPageId;
    const tok1 = config.fbPageAccessToken;
    if (id1 && tok1) pages.push({ id: id1, token: tok1 });

    for (let i = 2; i <= 5; i++) {
        const id = process.env[`FB_PAGE_ID${i}`];
        const tok = process.env[`PAGE_ACCESS_TOKEN${i}`];
        if (id && tok) pages.push({ id, token: tok });
    }

    for (const page of pages) {
        try {
            await axios.post(`https://graph.facebook.com/v19.0/${page.id}/feed`, {
                message: text,
                access_token: page.token
            });
            console.log(`[newsAutoPoster] Posted to FB Page: ${page.id}`);
        } catch (e) {
            console.error(`[newsAutoPoster] FB Post failed for ${page.id}:`, e.response?.data || e.message);
        }
    }
}

async function postToTelegram(text) {
    if (!config.telegramToken) return;
    const targetId = config.ownerNumber[0]; // Or a dedicated channel ID if provided
    try {
        await axios.post(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
            chat_id: targetId,
            text: text,
            parse_mode: "Markdown"
        });
        console.log(`[newsAutoPoster] Posted to Telegram`);
    } catch (e) {
        console.error(`[newsAutoPoster] TG Post failed:`, e.message);
    }
}

function getCache() {
    fs.ensureDirSync(DATA_DIR);
    if (!fs.existsSync(NEWS_CACHE_FILE)) return { lastTitles: [] };
    return fs.readJsonSync(NEWS_CACHE_FILE);
}

function saveCache(cache) {
    fs.writeJsonSync(NEWS_CACHE_FILE, cache);
}

async function checkAndPostNews() {
    console.log("[newsAutoPoster] Checking for new breaking news...");
    const latestNews = await fetchBreakingNews();
    if (latestNews.length === 0) return;

    const cache = getCache();
    const newItems = latestNews.filter(item => !cache.lastTitles.includes(item.title));

    if (newItems.length > 0) {
        console.log(`[newsAutoPoster] Found ${newItems.length} new items!`);
        
        for (const item of newItems) {
            const postText = `🚨 *خبر عاجل:*\n━━━━━━━━━━━━━━\n\n📢 ${item.title}\n\n🕒 الوقت: ${item.time}\n📍 المصدر: الجزيرة\n\n🛡️ _تم النشر آلياً عبر بوت ${config.botName}_`;
            
            await postToFacebook(postText);
            await postToTelegram(postText);
            
            // Add to cache
            cache.lastTitles.push(item.title);
        }

        // Keep cache small (last 50 titles)
        if (cache.lastTitles.length > 50) cache.lastTitles = cache.lastTitles.slice(-50);
        saveCache(cache);
    } else {
        console.log("[newsAutoPoster] No new news found.");
    }
}

function startNewsScheduler() {
    // Check every 30 minutes
    setInterval(checkAndPostNews, 30 * 60 * 1000);
    // Run once immediately on start
    setTimeout(checkAndPostNews, 10000);
    console.log("[newsAutoPoster] 🗞️ News Auto-Poster Scheduler started (30m interval).");
}

module.exports = { startNewsScheduler };
