const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabaseUrl = process.env.SUPABASE_URL || config.supabaseUrl;
const supabaseKey = process.env.SUPABASE_KEY || config.supabaseKey;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

const db = {
    // 🤖 Bot Configs (Telegram/Facebook Tokens)
    async getBotConfigs() {
        if (!supabase) return [];
        const { data, error } = await supabase.from('bot_configs').select('*').eq('is_active', true);
        if (error) { console.error('[Supabase] Error fetching bot_configs:', error.message); return []; }
        return data;
    },

    // 💬 WhatsApp Auth (Sessions & Pairing Codes)
    async getWhatsAppAuth(phoneNumber) {
        if (!supabase) return null;
        const { data, error } = await supabase.from('whatsapp_auth').select('*').eq('phone_number', phoneNumber).single();
        if (error) return null;
        return data;
    },

    async getAllWhatsAppAuth() {
        if (!supabase) return [];
        const { data, error } = await supabase.from('whatsapp_auth').select('*');
        if (error) return [];
        return data;
    },

    async updateWhatsAppSession(phoneNumber, sessionData) {
        if (!supabase) return;
        const { error } = await supabase.from('whatsapp_auth').upsert({
            phone_number: phoneNumber,
            session_data: sessionData,
            updated_at: new Date().toISOString()
        }, { onConflict: 'phone_number' });
        if (error) console.error('[Supabase] Error updating WA session:', error.message);
    },

    async updatePairingCode(phoneNumber, pairingCode, status = 'connecting') {
        if (!supabase) return;
        const { error } = await supabase.from('whatsapp_auth').upsert({
            phone_number: phoneNumber,
            pairing_code: pairingCode,
            status: status,
            updated_at: new Date().toISOString()
        }, { onConflict: 'phone_number' });
        if (error) console.error('[Supabase] Error updating pairing code:', error.message);
    },

    async updateWAStatus(phoneNumber, status) {
        if (!supabase) return;
        const { error } = await supabase.from('whatsapp_auth').update({ status }).eq('phone_number', phoneNumber);
        if (error) console.error('[Supabase] Error updating WA status:', error.message);
    },

    // 📊 Bot Stats
    async updateStats(stats) {
        if (!supabase) return;
        const { error } = await supabase.from('bot_stats').upsert({
            id: 'ae6b896b-0b1a-42c2-b5e1-06103b6e82a3', // Use a fixed ID for global stats or manage per bot
            ...stats,
            last_update: new Date().toISOString()
        });
        if (error) console.error('[Supabase] Error updating stats:', error.message);
    },

    async getStats() {
        if (!supabase) return null;
        const { data, error } = await supabase.from('bot_stats').select('*').single();
        if (error) return null;
        return data;
    },
    // 🧠 AI Memory Management
    async getAIMemory(jid) {
        if (!supabase) return { jid, history: [], last_image: null };
        try {
            const { data, error } = await supabase.from('ai_memory').select('*').eq('jid', jid).single();
            if (error && error.code !== 'PGRST116') throw error;
            return data || { jid, history: [], last_image: null };
        } catch (e) { return { jid, history: [], last_image: null }; }
    },

    async updateAIMemory(jid, history, lastImage) {
        if (!supabase) return;
        try {
            const { error } = await supabase.from('ai_memory').upsert({
                jid,
                history,
                last_image: lastImage,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;
        } catch (e) { console.error('[Supabase AI Error]:', e.message); }
    },

    // ⚙️ Config & Bot Management
    async updateBotConfig(id, data) {
        if (!supabase) return false;
        try {
            const { error } = await supabase.from('bot_configs').update(data).eq('id', id);
            if (error) throw error;
            return true;
        } catch (e) { return false; }
    },

    async deleteWhatsAppSession(phoneNumber) {
        if (!supabase) return false;
        try {
            const { error } = await supabase.from('whatsapp_auth').delete().eq('phone_number', phoneNumber);
            if (error) throw error;
            return true;
        } catch (e) { return false; }
    }
};

module.exports = { db };
