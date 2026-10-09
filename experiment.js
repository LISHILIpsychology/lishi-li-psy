/* 实验骨架：初始化 → 预加载 → 指导语 → 七区组 → 增量保存 → 结束。 */
(function () {
  'use strict';
  const config = IAT_CONFIG;
  const core = IAT_CORE;
  const byId = id => document.getElementById(id);
  let engine = null, session = null, active = null, activeMeta = null;
  let running = false, storageHealthy = true;

  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stamp = () => new Date().toISOString();
  const totalCount = counts => counts.reduce((sum, n) => sum + n, 0);
  function newId() {
    const numbers = crypto.getRandomValues(new Uint32Array(4));
    return Array.from(numbers, x => x.toString(16).padStart(8, '0')).join('');
  }
  function download(filename, text, type) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type }));
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    // 下载 URL 不立即回收，避免浏览器尚未读取 Blob 时下载失败；页面关闭后自动释放。
  }
  function summary(saved) {
    const result = saved.mode === 'demo' ? { valid: false, d: null, reason: 'Practice preview data are not scored' } : core.score(saved.rows, saved.config, saved.status);
    return {
      subject_id: saved.subject_id, session_id: saved.session_id, mode: saved.mode,
      status: saved.status, version: saved.config.version, seed: saved.seed,
      counterbalance_cell: saved.assignment.cell,
      self_lonely_first: saved.assignment.selfLonelyFirst,
      lonely_left: saved.assignment.lonelyLeft,
      started_at: saved.started_at, ended_at: saved.ended_at || null,
      completed_trials: saved.rows.filter(r => r.trial_status === 'completed').length,
      expected_trials: totalCount(saved.config.counts),
      ...result
    };
  }
  function exportRows(saved) {
    return saved.rows.map(row => ({ ...row, session_status: saved.status, mode: saved.mode }));
  }
  function filePrefix(saved) { return `iat_${saved.subject_id}_${saved.session_id}`; }
  function exportTrials(saved) {
    download(`${filePrefix(saved)}_trials.csv`, '\uFEFF' + core.csv(exportRows(saved)), 'text/csv;charset=utf-8');
  }
  function exportJson(saved) {
    download(`${filePrefix(saved)}_backup.json`, JSON.stringify({ ...saved, summary: summary(saved) }, null, 2), 'application/json;charset=utf-8');
  }
  function exportSummary(saved) {
    download(`${filePrefix(saved)}_summary.csv`, '\uFEFF' + core.csv([summary(saved)]), 'text/csv;charset=utf-8');
  }
  function upsert(row) {
    const index = session.rows.findIndex(r => r.block === row.block && r.trial === row.trial);
    if (index >= 0) session.rows[index] = row;
    else session.rows.push(row);
  }
  function persist() {
    if (!session || !storageHealthy) return;
    session.updated_at = stamp();
    try { localStorage.setItem(config.storagePrefix + session.session_id, JSON.stringify(session)); }
    catch (error) {
      storageHealthy = false;
      session.storage_error = 'Browser backup could not be saved: ' + error.message;
      if (running) stop('storage_error');
    }
  }
  function pendingSnapshot(status = 'in_progress') {
    if (!active || !activeMeta) return null;
    return { ...activeMeta, ...active.snapshot(), trial_status: status };
  }
  function markInterrupted() {
    if (!session || !running) return;
    // beforeunload、blur、pagehide 的顺序因浏览器而异，先关闭写入中的实验状态。
    running = false;
    const row = pendingSnapshot('interrupted');
    if (row) upsert(row);
    for (const saved of session.rows) {
      if (saved.trial_status === 'in_progress') saved.trial_status = 'interrupted';
    }
    active = null;
    session.status = 'interrupted';
    session.ended_at = stamp();
    persist();
  }
  function stop(status = 'aborted') {
    if (!running) return;
    running = false;
    session.status = status;
    session.ended_at = stamp();
    const row = pendingSnapshot('aborted');
    if (row) upsert(row);
    active = null;
    persist();
    engine.endExperiment('', row || { task: 'abort', trial_status: 'aborted' });
  }
  async function finish() {
    running = false;
    if (session.status === 'running') session.status = 'completed';
    session.ended_at = stamp();
    persist();
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (_) { /* 全屏退出失败不阻止导出。 */ }
    }
    byId('jspsych-target').hidden = true;
    const result = byId('result');
    result.hidden = false;
    result.innerHTML = `<div class="eyebrow">Session saved</div><h1>${session.status === 'completed' ? 'Task complete' : 'Task ended'}</h1>
      <p>${session.rows.filter(r => r.trial_status === 'completed').length} of ${totalCount(session.config.counts)} classifications completed.</p>
      <p>${storageHealthy ? 'A backup of this session is stored in this browser. Please download and keep your data files.' : 'The browser backup failed. Your data are still available on this page. Download the CSV and full backup now.'}</p>
      <div id="downloads"></div>
      <p class="muted">Download your files before closing this page, and follow the return instructions you were given.</p>
      <button id="again">Return to start</button>`;
    const downloads = byId('downloads');
    for (const [label, action] of [['Download trial data (CSV)', exportTrials], ['Download score summary (CSV)', exportSummary], ['Download full backup (JSON)', exportJson]]) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('click', () => action(session)); downloads.appendChild(button);
    }
    byId('again').addEventListener('click', () => location.reload());
    exportTrials(session);
  }
  function renderRecovery() {
    const backups = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(config.storagePrefix)) {
          try {
            const saved = JSON.parse(localStorage.getItem(key));
            if (saved && saved.config && Array.isArray(saved.rows)) backups.push(saved);
          } catch (_) { /* 一份损坏的备份不阻止读取其余会话。 */ }
        }
      }
    } catch (_) { byId('setup-error').textContent = 'This browser does not allow local backups. Use a browser with local storage enabled.'; }
    backups.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    byId('recovery').hidden = !backups.length;
    for (const saved of backups) {
      const row = document.createElement('div'); row.className = 'backup-row';
      const text = document.createElement('div');
      text.textContent = `${saved.subject_id} · ${saved.started_at} · ${saved.rows.filter(r => r.trial_status === 'completed').length} trials · ${saved.status === 'completed' ? 'completed' : 'incomplete'}`;
      row.appendChild(text);
      for (const [label, action] of [['Download CSV', exportTrials], ['Download backup', exportJson]]) {
        const button = document.createElement('button'); button.textContent = label;
        button.addEventListener('click', () => action(saved)); row.appendChild(button);
      }
      byId('backup-list').appendChild(row);
    }
  }
  function labels(block, side) {
    return block.categories.filter(c => block.mapping[c] === side).map(c => `<span class="category ${['self', 'other'].includes(c) ? 'target' : 'attribute'}">${escapeHtml(config.labels[c])}</span>`).join('<br>or<br>');
  }
  function trialHtml(block, row = null) {
    return `<div class="trial-screen">
      <div class="trial-label left"><span class="key">${escapeHtml(config.keys.left.toUpperCase())} key</span>${labels(block, 'left')}</div>
      <div class="trial-label right"><span class="key">${escapeHtml(config.keys.right.toUpperCase())} key</span>${labels(block, 'right')}</div>
      <div class="word ${row ? (row.domain === 'target' ? 'category target' : 'category attribute') : ''}">${row ? escapeHtml(row.stimulus) : ''}</div>
      <div class="error-feedback" aria-label="Incorrect classification">×</div>
      <div class="trial-footer">Part ${block.block} of 7 · Respond quickly and accurately</div>
    </div>`;
  }
  function instruction(block) {
    const change = block.block === 5 ? '<p><strong>The SELF and OTHER categories have switched sides.</strong>Check the new key assignments carefully.</p>' : '';
    const intro = block.block === 1 ? '<p>Words will appear one at a time. Decide which category each word belongs to, then press the matching key.</p><p>If a red × appears, press the correct key to continue to the next word.</p>' : '';
    return {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `<div class="instruction"><h1>Part ${block.block} of 7</h1>${intro}${change}
        <p>This part contains ${block.count} classifications. The category labels remain visible. Follow the key assignments shown below.</p>
        <div class="mapping"><div><kbd>${config.keys.left.toUpperCase()}</kbd><br>${labels(block, 'left')}</div><div><kbd>${config.keys.right.toUpperCase()}</kbd><br>${labels(block, 'right')}</div></div>
        <p>Place your left index finger on ${config.keys.left.toUpperCase()} and your right index finger on ${config.keys.right.toUpperCase()}. Respond as quickly and accurately as you can.</p>
        <p class="continue">Press SPACE when ready. You may take a break here.</p></div>`,
      choices: [' '], data: { task: 'instruction', block: block.block }
    };
  }
  function buildTimeline(localConfig) {
    const blocks = core.makeBlocks(session.subject_id, localConfig);
    session.assignment = blocks[0].assignment;
    const timeline = [{ type: jsPsychPreload, auto_preload: true, data: { task: 'preload' } }];
    for (const block of blocks) {
      const sequence = core.makeTrials(block, core.hash(`${session.seed}:${block.block}`), localConfig);
      session.sequence.push(...sequence);
      timeline.push(instruction(block));
      for (const row of sequence) {
        const metadata = {
          ...row, task: 'iat', subject_id: session.subject_id, session_id: session.session_id,
          experiment_version: localConfig.version, counterbalance_cell: session.assignment.cell,
          left_key_label: block.leftLabels.join(' / '), right_key_label: block.rightLabels.join(' / ')
        };
        timeline.push({
          type: jsPsychLonelinessIat, stimulus: trialHtml(block, row),
          left_key: config.keys.left, right_key: config.keys.right, correct_response: row.correct_response,
          data: metadata,
          on_start: () => { activeMeta = metadata; },
          checkpoint: state => { upsert({ ...metadata, ...state }); persist(); },
          register_active: controller => { active = controller; },
          on_finish: data => {
            Object.assign(data, metadata);
            upsert({ ...metadata, timestamp: data.timestamp, response: data.response, rt: data.rt,
              accuracy: data.accuracy, error_trial: data.error_trial, correction_rt: data.correction_rt,
              total_rt: data.total_rt, correction_response: data.correction_response,
              wrong_presses: data.wrong_presses, response_history: data.response_history,
              focus_interrupted: data.focus_interrupted, trial_status: data.trial_status,
              anticipatory: Number.isFinite(data.rt) && data.rt < localConfig.anticipatoryThreshold });
            persist();
          }
        });
        timeline.push({
          type: jsPsychHtmlKeyboardResponse,
          stimulus: trialHtml(block), choices: 'NO_KEYS', trial_duration: localConfig.itiMs,
          data: { task: 'iti', block: block.block }, on_start: () => { activeMeta = null; }
        });
      }
    }
    return timeline;
  }
  byId('setup').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button'); button.disabled = true;
    byId('setup-error').textContent = '';
    try {
      if (innerWidth < config.minViewport.width || innerHeight < config.minViewport.height) throw new Error('Use a computer with a keyboard and enlarge the browser window before starting.');
      core.validateConfig(config);
      const probe = config.storagePrefix + 'probe-' + newId();
      localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
      await document.fonts.ready;
      if (byId('fullscreen').checked && document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); }
        catch (_) { /* 未获全屏权限时继续窗口模式，记录最终显示状态。 */ }
      }
      const mode = byId('mode').value;
      const localConfig = JSON.parse(JSON.stringify(config));
      if (mode === 'demo') localConfig.counts = config.demoCounts.slice();
      session = {
        subject_id: byId('subject').value.trim(), session_id: newId(),
        started_at: stamp(), status: 'running', mode, seed: crypto.getRandomValues(new Uint32Array(1))[0],
        config: localConfig, rows: [], sequence: [], interactions: [],
        browser: navigator.userAgent, platform: navigator.platform,
        viewport: { width: innerWidth, height: innerHeight, fullscreen: !!document.fullscreenElement }
      };
      const timeline = buildTimeline(localConfig);
      engine = initJsPsych({
        display_element: 'jspsych-target', minimum_valid_rt: 0,
        on_finish: finish,
        on_trial_finish: () => persist(),
        on_close: markInterrupted
      });
      byId('landing').hidden = true;
      byId('jspsych-target').hidden = false;
      running = true;
      persist();
      if (running) engine.run(timeline).catch(error => { session.runtime_error = error.message; stop('runtime_error'); });
    } catch (error) {
      byId('setup-error').textContent = error.message;
      button.disabled = false;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && running) { event.preventDefault(); event.stopImmediatePropagation(); stop(); }
  }, true);
  function focusLost(kind) {
    if (!running) return;
    session.interactions.push({ kind, timestamp: stamp(), block: activeMeta?.block || null, trial: activeMeta?.trial || null });
    if (active) active.interrupt();
    persist();
  }
  window.addEventListener('blur', () => focusLost('blur'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) focusLost('hidden'); });
  window.addEventListener('pagehide', markInterrupted);
  if (!config.font.autoDetect) document.documentElement.style.setProperty('--font', config.font.manualFamily + ', sans-serif');
  document.documentElement.style.setProperty('--stimulus-size', config.stimulusSizePx + 'px');
  renderRecovery();
})();
