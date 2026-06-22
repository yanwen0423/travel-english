/* ============================
   Travel Translation Quiz - App
   ============================ */

(function () {
  'use strict';

  // ---- Constants ----
  const LS_KEYS = {
    apiKey: 'anthropic-api-key',
    model: 'grading-model',
    theme: 'theme',
    drafts: 'quiz-drafts',
    history: 'quiz-history',
  };

  const DEFAULT_MODEL = 'claude-sonnet-4-6';

  const GRADING_SYSTEM_PROMPT = `You are an expert English-as-a-second-language teacher specializing in travel English. Grade the user's Chinese-to-English translation semantically, not just by exact word match.

Evaluate based on:
1. Grammar correctness
2. Vocabulary/word choice accuracy (especially travel-specific terms)
3. Natural style and register (appropriate formality for the context)
4. Completeness (all meaning from the Chinese is conveyed)

Return your evaluation as structured JSON.`;

  const GRADING_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
      score: { type: 'integer', description: '0-100' },
      grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
      grammar_feedback: { type: 'string' },
      vocabulary_feedback: { type: 'string' },
      style_feedback: { type: 'string' },
      improved_translation: { type: 'string' },
      phrase_analysis: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            phrase: { type: 'string' },
            correct: { type: 'boolean' },
            note: { type: 'string' },
          },
          required: ['phrase', 'correct', 'note'],
          additionalProperties: false,
        },
      },
    },
    required: ['score', 'grade', 'grammar_feedback', 'vocabulary_feedback', 'style_feedback', 'improved_translation', 'phrase_analysis'],
    additionalProperties: false,
  };

  // ---- State ----
  let state = {
    currentView: 'quiz',
    currentDate: '',
    questions: [],
    currentIndex: 0,
    grading: false,
  };

  // ---- DOM References ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ---- Utility ----
  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch { /* ignore */ }
  }

  function lsGetJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function lsSetJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---- Router ----
  function navigate(view) {
    state.currentView = view;
    $$('.view').forEach((v) => v.classList.remove('active'));
    const target = $(`#view-${view}`);
    if (target) target.classList.add('active');
    $$('.nav-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.view === view);
    });
    if (view === 'history') renderHistory();
    if (view === 'settings') loadSettings();
  }

  function handleHash() {
    const hash = location.hash.slice(1) || 'quiz';
    navigate(hash);
  }

  // ---- Theme ----
  function initTheme() {
    const saved = lsGet(LS_KEYS.theme);
    if (saved) {
      document.documentElement.dataset.theme = saved;
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
    }
    updateThemeIcon();
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    lsSet(LS_KEYS.theme, next);
    updateThemeIcon();
  }

  function updateThemeIcon() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    $('.theme-icon').textContent = isDark ? '☀️' : '🌙';
  }

  // ---- Quiz: Load Questions ----
  async function loadQuestions(dateStr) {
    state.currentDate = dateStr || getTodayStr();
    $('#quizDate').textContent = state.currentDate;

    try {
      const resp = await fetch(`questions/${state.currentDate}.json`);
      if (!resp.ok) throw new Error('Not found');
      const data = await resp.json();
      state.questions = data.questions || [];
      showQuiz();
    } catch {
      showUnavailable();
    }
  }

  function showUnavailable() {
    $('#unavailableCard').style.display = '';
    $('#questionCard').style.display = 'none';
    $('#gradeCard').style.display = 'none';
    $('#questionNav').style.display = 'none';
  }

  function showQuiz() {
    $('#unavailableCard').style.display = 'none';
    $('#questionCard').style.display = '';
    $('#questionNav').style.display = '';
    renderQuestion();
  }

  // ---- Quiz: Render ----
  function renderQuestion() {
    const q = state.questions[state.currentIndex];
    if (!q) return;

    // Category tag
    const tag = $('#categoryTag');
    tag.textContent = q.category_label_zh || q.category;
    tag.dataset.cat = q.category;

    // Question number
    $('#questionNumber').textContent = `${state.currentIndex + 1} / ${state.questions.length}`;

    // Chinese sentence
    $('#chineseSentence').textContent = q.chinese;

    // Answer input - restore draft
    const drafts = lsGetJSON(LS_KEYS.drafts) || {};
    const dayDrafts = drafts[state.currentDate] || {};
    $('#answerInput').value = dayDrafts[q.id] || '';

    // Grade button state
    updateGradeBtn();

    // Show/hide grade card
    const history = lsGetJSON(LS_KEYS.history) || {};
    const dayGrades = (history[state.currentDate] || {}).grades || {};
    if (dayGrades[q.id]) {
      showGradeResult(dayGrades[q.id]);
    } else {
      $('#gradeCard').style.display = 'none';
    }

    // Progress
    updateProgress();

    // Dots
    renderDots();

    // Nav buttons
    $('#prevBtn').disabled = state.currentIndex === 0;
    $('#nextBtn').disabled = state.currentIndex === state.questions.length - 1;
  }

  function updateGradeBtn() {
    const btn = $('#gradeBtn');
    const apiKey = lsGet(LS_KEYS.apiKey);
    const hasText = $('#answerInput').value.trim().length > 0;
    btn.disabled = !hasText || !apiKey || state.grading;
  }

  function updateProgress() {
    const history = lsGetJSON(LS_KEYS.history) || {};
    const dayData = history[state.currentDate] || {};
    const grades = dayData.grades || {};
    const completed = Object.keys(grades).length;
    $('#quizProgress').textContent = `${completed}/${state.questions.length} 已批改`;
  }

  function renderDots() {
    const dots = $('#questionDots');
    dots.innerHTML = '';
    const history = lsGetJSON(LS_KEYS.history) || {};
    const dayGrades = (history[state.currentDate] || {}).grades || {};
    const drafts = lsGetJSON(LS_KEYS.drafts) || {};
    const dayDrafts = drafts[state.currentDate] || {};

    state.questions.forEach((q, i) => {
      const dot = document.createElement('span');
      dot.className = 'q-dot';
      if (i === state.currentIndex) dot.classList.add('active');
      if (dayGrades[q.id]) dot.classList.add('graded');
      else if (dayDrafts[q.id]) dot.classList.add('completed');
      dot.title = `第 ${i + 1} 题`;
      dot.addEventListener('click', () => {
        state.currentIndex = i;
        renderQuestion();
      });
      dots.appendChild(dot);
    });
  }

  // ---- Quiz: Save Draft ----
  const saveDraft = debounce(() => {
    const q = state.questions[state.currentIndex];
    if (!q) return;
    const drafts = lsGetJSON(LS_KEYS.drafts) || {};
    if (!drafts[state.currentDate]) drafts[state.currentDate] = {};
    drafts[state.currentDate][q.id] = $('#answerInput').value;
    lsSetJSON(LS_KEYS.drafts, drafts);
    updateGradeBtn();
    renderDots();
  }, 500);

  // ---- Quiz: Grading ----
  async function gradeCurrentQuestion() {
    const q = state.questions[state.currentIndex];
    if (!q) return;
    const userAnswer = $('#answerInput').value.trim();
    if (!userAnswer) return;

    const apiKey = lsGet(LS_KEYS.apiKey);
    if (!apiKey) {
      alert('请先在设置中填写 Anthropic API Key');
      navigate('settings');
      return;
    }

    const model = lsGet(LS_KEYS.model) || DEFAULT_MODEL;

    // Show loading
    state.grading = true;
    const btn = $('#gradeBtn');
    btn.disabled = true;
    btn.querySelector('.btn-text').textContent = '批改中...';
    btn.querySelector('.spinner').style.display = '';

    // Build grading prompt
    const userPrompt = `Please grade this Chinese-to-English translation:

**Original Chinese:** ${q.chinese}

**Reference translation(s):**
${q.reference_answers.map((a, i) => `${i + 1}. ${a}`).join('\n')}

**Key phrases to check:**
${q.key_phrases.map((p) => `- "${p.chinese}" → "${p.english}"`).join('\n')}

**Grading focus:**
${q.grading_focus.map((f) => `- ${f}`).join('\n')}

**User's translation:** ${userAnswer}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 2048,
          system: GRADING_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 401) throw new Error('API Key 无效，请检查设置');
        if (response.status === 429) throw new Error('请求过快，请稍等一分钟后重试');
        throw new Error(errData.error?.message || `API 错误 (${response.status})`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      let gradeResult;

      // Try to parse JSON from response
      try {
        // Try direct parse
        gradeResult = JSON.parse(text);
      } catch {
        // Try to extract JSON from markdown code block
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          gradeResult = JSON.parse(jsonMatch[1].trim());
        } else {
          throw new Error('无法解析批改结果');
        }
      }

      // Save to history
      saveGradeResult(q.id, userAnswer, gradeResult);
      showGradeResult(gradeResult);
    } catch (err) {
      alert(`批改失败：${err.message}`);
    } finally {
      state.grading = false;
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '批改';
      btn.querySelector('.spinner').style.display = 'none';
      updateGradeBtn();
    }
  }

  function saveGradeResult(qId, userAnswer, gradeResult) {
    const history = lsGetJSON(LS_KEYS.history) || {};
    if (!history[state.currentDate]) {
      history[state.currentDate] = { answers: {}, grades: {}, summary: {} };
    }
    history[state.currentDate].answers[qId] = {
      text: userAnswer,
      timestamp: new Date().toISOString(),
    };
    history[state.currentDate].grades[qId] = gradeResult;

    // Update summary
    const grades = history[state.currentDate].grades;
    const ids = Object.keys(grades);
    const scores = ids.map((id) => grades[id].score);
    const gradeDist = {};
    ids.forEach((id) => {
      const g = grades[id].grade;
      gradeDist[g] = (gradeDist[g] || 0) + 1;
    });
    history[state.currentDate].summary = {
      completed: ids.length,
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      grade_distribution: gradeDist,
    };

    lsSetJSON(LS_KEYS.history, history);
    updateProgress();
    renderDots();
  }

  function showGradeResult(result) {
    const card = $('#gradeCard');
    card.style.display = '';

    // Grade badge
    const badge = $('#gradeBadge');
    badge.textContent = result.grade;
    badge.className = 'grade-badge grade-' + result.grade;

    // Score
    $('#gradeScore').textContent = `${result.score} / 100`;

    // Feedback
    $('#grammarFeedback').textContent = result.grammar_feedback || '无';
    $('#vocabularyFeedback').textContent = result.vocabulary_feedback || '无';
    $('#styleFeedback').textContent = result.style_feedback || '无';
    $('#improvedTranslation').textContent = result.improved_translation || '无';

    // Phrase analysis
    const paDiv = $('#phraseAnalysis');
    paDiv.innerHTML = '';
    if (result.phrase_analysis && result.phrase_analysis.length) {
      result.phrase_analysis.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'phrase-item';
        item.innerHTML = `
          <span class="phrase-icon">${p.correct ? '✅' : '❌'}</span>
          <span class="phrase-text">${p.phrase}</span>
          <span class="phrase-note">${p.note}</span>
        `;
        paDiv.appendChild(item);
      });
    } else {
      paDiv.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">无关键短语分析</p>';
    }

    // Reference answers
    const refDiv = $('#referenceAnswers');
    refDiv.innerHTML = '';
    const q = state.questions[state.currentIndex];
    if (q && q.reference_answers) {
      q.reference_answers.forEach((a) => {
        const div = document.createElement('div');
        div.className = 'ref-answer';
        div.textContent = a;
        refDiv.appendChild(div);
      });
    }
  }

  // ---- History ----
  function renderHistory() {
    const history = lsGetJSON(LS_KEYS.history) || {};
    const dates = Object.keys(history).sort().reverse();

    if (dates.length === 0) {
      $('#historyEmpty').style.display = '';
      $('#historyList').innerHTML = '';
      return;
    }

    $('#historyEmpty').style.display = 'none';
    const list = $('#historyList');
    list.innerHTML = '';

    dates.forEach((date) => {
      const dayData = history[date];
      const summary = dayData.summary || {};
      const item = document.createElement('div');
      item.className = 'history-item';

      const gradeDist = summary.grade_distribution || {};
      const gradeStr = Object.entries(gradeDist).map(([g, c]) => `${g}×${c}`).join('  ');

      item.innerHTML = `
        <div class="history-item-header">
          <span class="history-date">${date}</span>
          <span class="history-summary">${summary.completed || 0}题 · 均分 ${summary.avg_score || 0} · ${gradeStr}</span>
        </div>
        <div class="history-detail" id="detail-${date}"></div>
      `;

      item.addEventListener('click', () => toggleHistoryDetail(date, dayData));
      list.appendChild(item);
    });
  }

  function toggleHistoryDetail(date, dayData) {
    const detail = $(`#detail-${date}`);
    if (detail.classList.contains('show')) {
      detail.classList.remove('show');
      return;
    }
    detail.classList.add('show');

    const grades = dayData.grades || {};
    const answers = dayData.answers || {};
    let html = '';

    // Try to load original questions for Chinese text
    const drafts = lsGetJSON(LS_KEYS.drafts) || {};

    Object.keys(grades).forEach((qId) => {
      const g = grades[qId];
      const a = answers[qId] || {};
      html += `
        <div class="history-q-item">
          <div class="history-q-chinese"><strong>Q${qId}:</strong></div>
          <div class="history-q-answer">你的翻译：${a.text || '—'}</div>
          <div class="history-q-answer">改进建议：${g.improved_translation || '—'}</div>
          <span class="history-q-grade grade-${g.grade}">${g.grade} (${g.score})</span>
        </div>
      `;
    });

    detail.innerHTML = html;
  }

  function exportHistory() {
    const history = lsGetJSON(LS_KEYS.history) || {};
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz-history-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Settings ----
  function loadSettings() {
    const apiKey = lsGet(LS_KEYS.apiKey) || '';
    $('#apiKeyInput').value = apiKey;

    const model = lsGet(LS_KEYS.model) || DEFAULT_MODEL;
    $('#modelSelect').value = model;
    $('#keyStatus').textContent = '';
  }

  async function testApiKey() {
    const key = $('#apiKeyInput').value.trim();
    const status = $('#keyStatus');
    if (!key) {
      status.textContent = '请输入 API Key';
      status.className = 'settings-status error';
      return;
    }

    status.textContent = '测试中...';
    status.className = 'settings-status';

    try {
      // Use a minimal messages call to test
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      if (resp.ok || resp.status === 200) {
        status.textContent = '✅ API Key 有效';
        status.className = 'settings-status success';
      } else if (resp.status === 401) {
        status.textContent = '❌ API Key 无效';
        status.className = 'settings-status error';
      } else {
        const err = await resp.json().catch(() => ({}));
        // Some non-401 errors might still mean the key is valid
        if (resp.status === 400) {
          status.textContent = '✅ Key 可连接（请求格式问题）';
          status.className = 'settings-status success';
        } else {
          status.textContent = `⚠️ ${err.error?.message || '未知错误'}`;
          status.className = 'settings-status error';
        }
      }
    } catch (e) {
      status.textContent = `❌ 网络错误: ${e.message}`;
      status.className = 'settings-status error';
    }
  }

  function saveApiKey() {
    const key = $('#apiKeyInput').value.trim();
    lsSet(LS_KEYS.apiKey, key);
    const status = $('#keyStatus');
    if (key) {
      status.textContent = '✅ 已保存';
      status.className = 'settings-status success';
    } else {
      status.textContent = '已清除';
      status.className = 'settings-status';
    }
    updateGradeBtn();
  }

  function toggleKeyVisibility() {
    const input = $('#apiKeyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  function saveModel() {
    lsSet(LS_KEYS.model, $('#modelSelect').value);
  }

  function clearAllHistory() {
    if (!confirm('确定要清空所有历史记录吗？此操作不可撤销。')) return;
    localStorage.removeItem(LS_KEYS.history);
    localStorage.removeItem(LS_KEYS.drafts);
    renderHistory();
    alert('已清空');
  }

  // ---- Event Bindings ----
  function bindEvents() {
    // Navigation
    $$('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const view = tab.dataset.view;
        location.hash = view;
      });
    });

    window.addEventListener('hashchange', handleHash);

    // Theme
    $('#themeToggle').addEventListener('click', toggleTheme);

    // Quiz
    $('#retryBtn').addEventListener('click', () => loadQuestions());
    $('#answerInput').addEventListener('input', () => {
      updateGradeBtn();
      saveDraft();
    });
    $('#gradeBtn').addEventListener('click', gradeCurrentQuestion);
    $('#prevBtn').addEventListener('click', () => {
      if (state.currentIndex > 0) {
        state.currentIndex--;
        renderQuestion();
      }
    });
    $('#nextBtn').addEventListener('click', () => {
      if (state.currentIndex < state.questions.length - 1) {
        state.currentIndex++;
        renderQuestion();
      }
    });

    // History
    $('#exportBtn').addEventListener('click', exportHistory);

    // Settings
    $('#saveKeyBtn').addEventListener('click', saveApiKey);
    $('#testKeyBtn').addEventListener('click', testApiKey);
    $('#toggleKeyBtn').addEventListener('click', toggleKeyVisibility);
    $('#modelSelect').addEventListener('change', saveModel);
    $('#clearHistoryBtn').addEventListener('click', clearAllHistory);

    // Keyboard shortcut: Ctrl+Enter to grade
    $('#answerInput').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!$('#gradeBtn').disabled) gradeCurrentQuestion();
      }
    });
  }

  // ---- Init ----
  function init() {
    initTheme();
    bindEvents();
    handleHash();
    loadQuestions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();