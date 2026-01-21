const PerformanceTracker = {
    saveAnalysis: (symbol, price, side, target) => {
        const record = {
            id: Date.now(),
            symbol,
            entryPrice: price,
            side, // LONG or SHORT
            targetPrice: target,
            status: 'PENDING',
            timestamp: new Date().toISOString()
        };
        let history = JSON.parse(localStorage.getItem('yopo_history') || '[]');
        history.push(record);
        localStorage.setItem('yopo_history', JSON.stringify(history));
    },
    updateStats: () => {
        const history = JSON.parse(localStorage.getItem('yopo_history') || '[]');
        const closed = history.filter(h => h.status !== 'PENDING');
        const wins = closed.filter(h => h.status === 'WIN').length;
        const rate = closed.length ? (wins / closed.length * 100).toFixed(1) : 0;
        
        document.getElementById('win-rate').innerText = `${rate}%`;
        document.getElementById('total-trades').innerText = `${closed.length} trades`;
        document.getElementById('win-rate-bar').style.width = `${rate}%`;
    }
};
