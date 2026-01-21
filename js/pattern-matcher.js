const PatternMatcher = {
    calculateSimilarity(currentPattern, historyPattern) {
        // 유클리드 거리 기반 유사도 연산
        let sum = 0;
        for(let i=0; i<currentPattern.length; i++) {
            sum += Math.pow(currentPattern[i] - historyPattern[i], 2);
        }
        return (100 - (Math.sqrt(sum) * 10)).toFixed(1);
    }
};
