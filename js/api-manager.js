const ApiManager = {
    async fetchCandles(symbol, interval = '240', limit = 100) {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`);
            const data = await res.json();
            return data.result.list.reverse().map(k => ({
                time: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
            }));
        } catch (e) { console.error("API Error", e); return []; }
    }
};
