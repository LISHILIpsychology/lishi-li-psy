/* 英文词表为候选研究材料；正式使用前需预测试。 */
(function (root) {
  const config = {
    version: '1.1.0-en',
    title: 'Word Classification Task',
    keys: { left: 'e', right: 'i' },
    counts: [20, 20, 20, 40, 40, 20, 40],
    itiMs: 250,
    maxRun: 3,
    maxShuffleAttempts: 5000,
    font: { autoDetect: true, manualFamily: 'Arial' },
    stimulusSizePx: 48,
    labels: { self: 'SELF', other: 'OTHER', lonely: 'LONELY', connected: 'CONNECTED' },
    stimuli: {
      self: ['I', 'me', 'my', 'mine', 'myself'],
      other: ['they', 'them', 'their', 'theirs', 'others'],
      lonely: ['lonely', 'alone', 'isolated', 'excluded', 'disconnected'],
      connected: ['connected', 'included', 'supported', 'close', 'together']
    },
    scoring: { maxRt: 10000, fastRt: 300, fastFraction: 0.10, errorPenalty: 600 },
    storagePrefix: 'loneliness-iat-en-v1:',
    demoCounts: [4, 4, 4, 8, 8, 4, 8],
    minViewport: { width: 700, height: 500 },
    anticipatoryThreshold: 100
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  else root.IAT_CONFIG = config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
