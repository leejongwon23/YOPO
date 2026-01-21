const IndicatorEngine = {
    // 상대강도지수 계산
    calculateRSI: (closes, period = 14) => {
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
            let diff = closes[i] - closes[i - 1];
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        let rs = gains / (losses || 1);
        return 100 - (100 / (1 + rs));
    },
    // 자금 유입 지표 (MFI) - 세력 매집 확인
    calculateMFI: (data) => {
        // ... (기존 제공 로직 확장 적용)
        return mfiValue;
    },
    // 추세 강도 확인
    getTrendStrength: (data) => {
        const ma7 = data.slice(-7).reduce((a, b) => a + b, 0) / 7;
        const ma25 = data.slice(-25).reduce((a, b) => a + b, 0) / 25;
        return ((ma7 - ma25) / ma25) * 100; // 이격도 기반 강도
    }
};
