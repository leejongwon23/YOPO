const PredictionCore = {
    analyze: async (symbol) => {
        const data = await ApiManager.fetchFullData(symbol); // 15m, 4h, 1d 데이터 수집
        
        // 1. 단기 (15m/1h): RSI + 볼린저 밴드 역추세 혹은 돌파
        const shortSide = IndicatorEngine.checkScalping(data.m15);
        
        // 2. 중기 (4h): MFI + EMA 크로스오버
        const midSide = IndicatorEngine.checkSwing(data.h4);
        
        // 3. 장기 (1d): 시장 도미넌스 + 거시 추세
        const longSide = IndicatorEngine.checkTrend(data.d1);

        return {
            short: { side: shortSide, yield: "1.2%" },
            mid: { side: midSide, yield: "4.5%" },
            long: { side: longSide, yield: "12.0%" }
        };
    }
};
