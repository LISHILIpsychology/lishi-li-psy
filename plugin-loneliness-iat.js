/* 基于官方 IAT 插件的 jsPsych 7 接口，扩展逐次纠错记录和退出快照。 */
var jsPsychLonelinessIat = (function (jspsych) {
  'use strict';
  const info = {
    name: 'loneliness-iat',
    parameters: {
      stimulus: { type: jspsych.ParameterType.HTML_STRING, default: undefined },
      left_key: { type: jspsych.ParameterType.KEY, default: 'e' },
      right_key: { type: jspsych.ParameterType.KEY, default: 'i' },
      correct_response: { type: jspsych.ParameterType.KEY, default: undefined },
      checkpoint: { type: jspsych.ParameterType.FUNCTION, default: null },
      register_active: { type: jspsych.ParameterType.FUNCTION, default: null }
    }
  };
  class LonelinessIatPlugin {
    constructor(jsPsych) { this.jsPsych = jsPsych; }
    trial(display, trial) {
      display.innerHTML = trial.stimulus;
      const state = {
        timestamp: new Date().toISOString(), response: null, rt: null,
        accuracy: -1, error_trial: 0, correction_rt: null,
        total_rt: null, correction_response: null, wrong_presses: 0,
        response_history: [], focus_interrupted: false, trial_status: 'in_progress'
      };
      let listener;
      const snapshot = () => JSON.parse(JSON.stringify(state));
      const checkpoint = () => { if (trial.checkpoint) trial.checkpoint(snapshot()); };
      const finish = () => {
        state.trial_status = 'completed';
        this.jsPsych.pluginAPI.cancelKeyboardResponse(listener);
        if (trial.register_active) trial.register_active(null);
        display.innerHTML = '';
        this.jsPsych.finishTrial(snapshot());
      };
      if (trial.register_active) trial.register_active({
        snapshot,
        interrupt: () => { state.focus_interrupted = true; checkpoint(); }
      });
      // 所有反应共用同一个 jsPsych 时钟；首次错误与改正的 RT 都相对词语出现。
      listener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: response => {
          const correct = this.jsPsych.pluginAPI.compareKeys(response.key, trial.correct_response);
          state.response_history.push({ key: response.key, rt: response.rt, correct });
          if (state.response === null) {
            state.response = response.key;
            state.rt = response.rt;
            state.accuracy = correct ? 1 : 0;
            state.error_trial = correct ? 0 : 1;
          }
          if (!correct) {
            state.wrong_presses++;
            display.querySelector('.error-feedback').style.visibility = 'visible';
            checkpoint();
          } else {
            state.total_rt = response.rt;
            if (state.error_trial) {
              state.correction_response = response.key;
              state.correction_rt = response.rt - state.rt;
            }
            finish();
          }
        },
        valid_responses: [trial.left_key, trial.right_key],
        rt_method: 'performance', persist: true, allow_held_key: false, minimum_valid_rt: 0
      });
      checkpoint();
    }
  }
  LonelinessIatPlugin.info = info;
  return LonelinessIatPlugin;
})(jsPsychModule);
