/* 无浏览器依赖的随机化、计分与导出函数，便于独立核对。 */
(function (root) {
  'use strict';
  function hash(text) {
    let value = 2166136261;
    for (const char of String(text)) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }
  function seededRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(array, random) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function assignment(subjectId) {
    const tail = String(subjectId).match(/(\d+)$/);
    // 尾号取模，避免超大编号转 Number 后丢失精度。
    const cell = tail ? Number(BigInt(tail[1]) % 4n) : hash(subjectId) % 4;
    return { cell, selfLonelyFirst: cell % 2 === 0, lonelyLeft: cell < 2 };
  }
  function validateConfig(config) {
    if (config.counts.length !== 7 || config.keys.left === config.keys.right) throw new Error('Invalid block or key configuration');
    if (config.itiMs < 0 || config.maxRun < 1) throw new Error('Invalid timing configuration');
    const seen = new Set();
    for (const category of ['self', 'other', 'lonely', 'connected']) {
      if (!config.labels[category] || config.stimuli[category].length < 4) throw new Error('Each category needs at least four words');
      for (const word of config.stimuli[category]) {
        if (!word || seen.has(word)) throw new Error('Words must be nonempty and unique across categories');
        seen.add(word);
      }
    }
    config.counts.forEach((n, i) => {
      if (!Number.isInteger(n) || n <= 0 || n % ([2, 3, 5, 6].includes(i) ? 4 : 2)) throw new Error('Trial counts must divide equally across categories');
    });
  }
  function makeBlocks(subjectId, config) {
    validateConfig(config);
    const assigned = assignment(subjectId);
    const lonelySide = assigned.lonelyLeft ? 'left' : 'right';
    const connectedSide = assigned.lonelyLeft ? 'right' : 'left';
    function mapping(selfLonely) {
      return { lonely: lonelySide, connected: connectedSide, self: selfLonely ? lonelySide : connectedSide, other: selfLonely ? connectedSide : lonelySide };
    }
    return config.counts.map((count, index) => {
      const combined = [2, 3, 5, 6].includes(index);
      const selfLonely = index < 4 ? assigned.selfLonelyFirst : !assigned.selfLonelyFirst;
      const map = mapping(selfLonely);
      const categories = combined ? ['self', 'other', 'lonely', 'connected'] : index === 1 ? ['lonely', 'connected'] : ['self', 'other'];
      const labels = side => categories.filter(c => map[c] === side).map(c => config.labels[c]);
      return {
        block: index + 1, count, combined, categories, mapping: map,
        condition: combined ? (selfLonely ? 'self_lonely' : 'self_connected') : index === 1 ? 'attribute_practice' : 'target_practice',
        block_type: [3, 6].includes(index) ? 'test' : 'practice',
        leftLabels: labels('left'), rightLabels: labels('right'),
        assignment: assigned
      };
    });
  }
  function hasLongRun(rows, property, maxRun) {
    let previous, run = 0;
    for (const row of rows) {
      run = row[property] === previous ? run + 1 : 1;
      previous = row[property];
      if (run > maxRun) return true;
    }
    return false;
  }
  function makeTrials(block, seed, config) {
    const random = seededRandom(seed);
    const pool = [];
    for (const category of block.categories) {
      let words = [];
      while (words.length < block.count / block.categories.length) words = words.concat(shuffle(config.stimuli[category], random));
      for (const word of words.slice(0, block.count / block.categories.length)) {
        const side = block.mapping[category];
        pool.push({ stimulus: word, category, side, correct_response: config.keys[side], domain: ['self', 'other'].includes(category) ? 'target' : 'attribute' });
      }
    }
    for (let attempt = 0; attempt < config.maxShuffleAttempts; attempt++) {
      let ordered;
      if (block.combined) {
        const target = shuffle(pool.filter(r => r.domain === 'target'), random);
        const attribute = shuffle(pool.filter(r => r.domain === 'attribute'), random);
        const first = random() < 0.5 ? target : attribute;
        const second = first === target ? attribute : target;
        ordered = first.flatMap((row, i) => [row, second[i]]);
      } else ordered = shuffle(pool, random);
      if (!hasLongRun(ordered, 'category', config.maxRun) && !hasLongRun(ordered, 'side', config.maxRun)) {
        return ordered.map((row, i) => ({ ...row, block: block.block, trial: i + 1, condition: block.condition, block_type: block.block_type, seed }));
      }
    }
    throw new Error('Unable to generate a valid trial sequence; check the configuration');
  }
  const mean = numbers => numbers.reduce((a, b) => a + b, 0) / numbers.length;
  function sampleSd(numbers) {
    const average = mean(numbers);
    return Math.sqrt(numbers.reduce((sum, x) => sum + (x - average) ** 2, 0) / (numbers.length - 1));
  }
  function score(rows, config, sessionStatus = 'completed') {
    const fail = (reason, extra = {}) => ({ valid: false, d: null, reason, algorithm: 'D600_first_response', ...extra });
    if (sessionStatus !== 'completed') return fail('Session is incomplete');
    const combinedBlocks = [3, 4, 6, 7];
    const completed = rows.filter(r => r.task === 'iat' && r.trial_status === 'completed');
    const expectedTotal = config.counts.reduce((a, b) => a + b, 0);
    if (completed.length !== expectedTotal || new Set(completed.map(r => `${r.block}:${r.trial}`)).size !== expectedTotal) return fail('Trials are missing or duplicated');
    for (let i = 0; i < 7; i++) {
      const group = completed.filter(r => r.block === i + 1);
      if (group.length !== config.counts[i] || group.some(r => !Number.isInteger(r.trial) || r.trial < 1 || r.trial > config.counts[i])) return fail('One or more blocks are incomplete');
    }
    const raw = completed.filter(r => combinedBlocks.includes(r.block));
    if (raw.some(r => !Number.isFinite(r.rt) || r.rt < 0 || ![0, 1].includes(r.accuracy))) return fail('Invalid response data in scored trials');
    if (raw.some(r => r.focus_interrupted)) return fail('A scored trial lost window focus; review the data and repeat the task');
    const kept = raw.filter(r => r.rt <= config.scoring.maxRt);
    const fastFraction = kept.filter(r => r.rt < config.scoring.fastRt).length / kept.length;
    const detail = { combined_trials: raw.length, removed_slow: raw.length - kept.length, fast_fraction: fastFraction, error_rate: mean(raw.map(r => 1 - r.accuracy)) };
    if (!kept.length || fastFraction > config.scoring.fastFraction) return fail('More than 10% of retained scored responses are below 300 ms', detail);
    const groups = new Map(combinedBlocks.map(b => [b, kept.filter(r => r.block === b)]));
    const corrected = new Map();
    for (const [b, group] of groups) {
      const condition = b < 5 ? completed.find(r => r.block === 3).condition : completed.find(r => r.block === 6).condition;
      if (!group.length || group.some(r => r.condition !== condition) || !['self_lonely', 'self_connected'].includes(condition)) return fail('Invalid block conditions', detail);
      const correct = group.filter(r => r.accuracy === 1);
      if (!correct.length) return fail('A scored block has no correct responses', detail);
      const errorRt = mean(correct.map(r => r.rt)) + config.scoring.errorPenalty;
      corrected.set(b, group.map(r => r.accuracy === 1 ? r.rt : errorRt));
    }
    const components = [];
    for (const [a, b] of [[3, 6], [4, 7]]) {
      if (groups.get(a)[0].condition === groups.get(b)[0].condition) return fail('Combined conditions were not correctly reversed', detail);
      // D600 的 inclusive SD 使用错误替换前、慢反应剔除后的原始首次 RT。
      const sd = sampleSd([...groups.get(a), ...groups.get(b)].map(r => r.rt));
      if (!Number.isFinite(sd) || sd === 0) return fail('Reaction time standard deviation is zero or undefined', detail);
      const sign = groups.get(a)[0].condition === 'self_lonely' ? 1 : -1;
      components.push(sign * (mean(corrected.get(b)) - mean(corrected.get(a))) / sd);
    }
    return { valid: true, d: mean(components), d_practice: components[0], d_test: components[1], reason: '', algorithm: 'D600_first_response', ...detail };
  }
  function csv(rows) {
    if (!rows.length) return '';
    const columns = [...new Set(rows.flatMap(Object.keys))];
    const encode = value => {
      if (value === null || value === undefined) return '""';
      const string = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return '"' + string.replace(/"/g, '""') + '"';
    };
    return columns.map(encode).join(',') + '\r\n' + rows.map(row => columns.map(key => encode(row[key])).join(',')).join('\r\n');
  }
  const api = { hash, seededRandom, assignment, makeBlocks, makeTrials, hasLongRun, sampleSd, score, csv, validateConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IAT_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
