const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const moment = require('moment-timezone');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NEWS_CACHE_FILE = path.join(DATA_DIR, 'last_news.json');

const NEWS_SOURCES = [
    { name: "الجزيرة", url: "https://www.aljazeera.net/rss" },
    { name: "هسبريس", url: "https://www.hespress.com/feed" },
    { name: "Le360", url: "https://ar.le360.ma/arc/outboundfeeds/rss/?outputType=xml" }
];

async function fetchBreakingNews() {
    const allNews = [];
    for (const source of NEWS_SOURCES) {
        try {
            const res = await axios.get(source.url, { 
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const $ = cheerio.load(res.data, { xmlMode: true });

            $('item').each((i, el) => {
                if (i < 3) {
                    const title = $(el).find('title').text().trim();
                    const description = $(el).find('description').text().trim().replace(/<[^>]*>?/gm, '');
                    const link = $(el).find('link').text().trim();
                    let pubDate = $(el).find('pubDate').text().trim();
                    const matchTime = pubDate.match(/\d{2}:\d{2}/);
                    const timeStr = matchTime ? matchTime[0] : "";
                    
                    if (title) allNews.push({ title, description, link, time: timeStr, source: source.name });
                }
            });
        } catch (e) {
            console.error(`[newsAutoPoster] Fetch error for ${source.name}:`, e.message);
        }
    }
    return allNews;
}

async function scrapeContent(url) {
    try {
        const { data } = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        const image = $('meta[property="og:image"]').attr('content') || null;
        
        let fullText = "";
        $('article p, .article-body p, .content p, .post-content p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 50) fullText += txt + "\n\n";
        });

        return { image, fullText: fullText.trim() };
    } catch (e) { return { image: null, fullText: "" }; }
}

async function postComment(postId, pageToken, message) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/${postId}/comments`, {
            message: message,
            access_token: pageToken
        });
        console.log(`[newsAutoPoster] Commented on post ${postId}`);
    } catch (e) {
        console.error(`[newsAutoPoster] Comment failed for ${postId}:`, e.response?.data?.error?.message || e.message);
    }
}

async function postToFacebook(text, imageUrl = null) {
    const pages = [];
    // Primary page
    if (config.fbPageId && config.fbPageAccessToken) {
        pages.push({ id: config.fbPageId, token: config.fbPageAccessToken });
    }
    // Additional pages from env
    for (let i = 2; i <= 10; i++) {
        const id = process.env[`FB_PAGE_ID${i}`];
        const token = process.env[`PAGE_ACCESS_TOKEN${i}`];
        if (id && token) pages.push({ id, token });
    }

    if (pages.length === 0) return;

    for (const page of pages) {
        try {
            let postId = null;
            if (imageUrl) {
                try {
                    const { data } = await axios.post(`https://graph.facebook.com/v19.0/${page.id}/photos`, {
                        url: imageUrl,
                        caption: text,
                        access_token: page.token
                    });
                    postId = data.post_id || data.id;
                } catch (imgErr) {
                    console.error(`[newsAutoPoster] Photo post failed for ${page.id}, falling back to text:`, imgErr.response?.data?.error?.message || imgErr.message);
                }
            }

            // If no photo or photo failed
            if (!postId) {
                const { data } = await axios.post(`https://graph.facebook.com/v19.0/${page.id}/feed`, {
                    message: text,
                    access_token: page.token
                });
                postId = data.id;
            }

            console.log(`[newsAutoPoster] Successful post to ${page.id} (Post ID: ${postId})`);
            
            // Add first comment
            if (postId) {
                const commentMsg = `🔗 زوروا موقعي الرسمي لمزيد من المحتوى:\n${config.portfolio}`;
                await postComment(postId, page.token, commentMsg);
            }
        } catch (e) {
            console.error(`[newsAutoPoster] Total failure for page ${page.id}:`, e.response?.data?.error?.message || e.message);
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
            const { image, fullText } = await scrapeContent(item.link);
            
            // Use full text if available, fallback to short description
            const contentBody = fullText || item.description || "";
            const cleanBody = contentBody.slice(0, 5000); // FB post limit safely
            
            const postText = `📰 *${item.title}*\n━━━━━━━━━━━━━━\n\n${cleanBody}\n\n🕒 ${item.time || 'الآن'} | 📍 المصدر: ${item.source}\n🔗 المصدر الأصلي: ${item.link}\n\n🛡️ *Hamza Amirni*\n📸 Instagram: ${config.instagram}`;
            
            await postToFacebook(postText, image);
            // await postToTelegram(postText); // Disabled per user request
            
            cache.lastTitles.push(item.title);
        }

        if (cache.lastTitles.length > 100) cache.lastTitles = cache.lastTitles.slice(-100);
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
