'use strict';

/* ============================================================
   0. Boot-time sanity + global error handling
   ============================================================ */
function showFatalError(title, detail) {
  var root = document.getElementById('root');
  var pre = detail ? '<pre class="fatal-detail">' + escapeHtml(String(detail)) + '</pre>' : '';
  var html =
    '<div class="fatal-box">' +
    '<div class="fatal-badge">APP ERROR</div>' +
    '<h2>' + escapeHtml(title) + '</h2>' +
    '<p>ページを再読み込みしても解決しない場合は、下のエラー内容を開発者にお伝えください。' +
    'このアプリはPWAのためオフラインでも動作しますが、初回はネットワーク接続が必要です。</p>' +
    pre +
    '</div>';
  if (root) root.innerHTML = html; else document.body.innerHTML = html;
}
window.addEventListener('error', function (e) {
  showFatalError('予期しないエラーが発生しました', (e && e.message) ? (e.message + '\n' + (e.filename || '') + ':' + (e.lineno || '')) : e);
});
window.addEventListener('unhandledrejection', function (e) {
  showFatalError('予期しないエラーが発生しました（非同期処理）', e && e.reason ? e.reason : e);
});
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
   1. Base path resolution (works at repo root OR a GitHub Pages
      project subpath like /my-repo/) and course registry loading
   ============================================================ */
var BASE_URL = (function () {
  var path = window.location.pathname;
  return path.substring(0, path.lastIndexOf('/') + 1);
})();
function coursesUrl() { return BASE_URL + 'courses/courses.json'; }
function courseMetaUrl(id) { return BASE_URL + 'courses/' + id + '/course.json'; }
function courseFileUrl(id, filename) { return BASE_URL + 'courses/' + id + '/' + filename; }

function fetchJSON(url) {
  return fetch(url, { cache: 'no-cache' }).then(function (res) {
    if (!res.ok) throw new Error('取得に失敗しました (' + res.status + '): ' + url);
    return res.json();
  });
}

/* ============================================================
   2. LocalStorage persistence (namespaced per course)
   ============================================================ */
var LS_THEME = 'medlearn_theme_v1';
var LS_LANG = 'medlearn_lang_v1';
var storageAvailable = true;
function testStorage() { try { var k = '__ml_test__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } }
storageAvailable = testStorage();

function progressKey(courseId) { return 'medlearn_progress_v1__' + courseId; }
var PROGRESS_KEY_PREFIX = 'medlearn_progress_v1__';
function freshProgress() { return { items: {}, chapters: {}, totals: { answered: 0, correct: 0, streak: 0, maxStreak: 0, lastStudyAt: null } }; }
function loadCourseProgress(courseId) {
  if (!storageAvailable) return freshProgress();
  try {
    var raw = localStorage.getItem(progressKey(courseId));
    if (!raw) return freshProgress();
    var parsed = JSON.parse(raw);
    if (!parsed.items) parsed.items = {};
    if (!parsed.chapters) parsed.chapters = {};
    if (!parsed.totals) parsed.totals = freshProgress().totals;
    return parsed;
  } catch (e) { console.warn('progress load failed for', courseId, e); return freshProgress(); }
}
function saveCourseProgress(courseId, p) { if (!storageAvailable) return; try { localStorage.setItem(progressKey(courseId), JSON.stringify(p)); } catch (e) { console.warn('progress save failed', e); } }
function loadTheme() { if (!storageAvailable) return 'light'; try { return localStorage.getItem(LS_THEME) || 'light'; } catch (e) { return 'light'; } }
function saveTheme(t) { if (!storageAvailable) return; try { localStorage.setItem(LS_THEME, t); } catch (e) {} }
function loadLang() { if (!storageAvailable) return 'ja'; try { return localStorage.getItem(LS_LANG) || 'ja'; } catch (e) { return 'ja'; } }
function saveLang(l) { if (!storageAvailable) return; try { localStorage.setItem(LS_LANG, l); } catch (e) {} }

var DAY_MS = 24 * 60 * 60 * 1000;
var SRS_INTERVALS = [1, 3, 7];
function getItemRecord(progress, key) {
  return progress.items[key] || { attempts: 0, correct: 0, incorrect: 0, status: 'unanswered', correctStreak: 0, bookmarked: false, nextReviewAt: null, lastAnsweredAt: null };
}
function getChapterProgress(progress, chapterId) {
  return progress.chapters[chapterId] || { attempts: 0, quizBestPct: 0, passed: false, cardsDone: false };
}
function persist() { if (CTX.course) saveProgressStore(CTX.course.id, CTX.course.progress); }

/* ============================================================
   2b. Progress store abstraction — local now, cloud-sync-ready
   ------------------------------------------------------------
   Every read/write of course progress in this file goes through
   loadProgressStore() / saveProgressStore() rather than calling
   the localStorage helpers directly. To add remote sync later
   (e.g. Supabase), implement loadCloudProgress()/saveCloudProgress()
   below (they already exist as stubs) and wire them into these two
   wrapper functions — e.g. write-through to cloud on save, or
   merge local+cloud on load using mergeProgress(). No other code
   in this file needs to change.
   ============================================================ */
function loadProgressStore(courseId) {
  // Future: var cloud = await loadCloudProgress(courseId);
  //         return cloud ? mergeProgress(loadCourseProgress(courseId), cloud) : loadCourseProgress(courseId);
  return loadCourseProgress(courseId);
}
function saveProgressStore(courseId, progress) {
  saveCourseProgress(courseId, progress);
  // Future: saveCloudProgress(courseId, progress);
}
function loadCloudProgress(courseId) {
  // Placeholder for a future backend (e.g. Supabase) integration.
  return Promise.resolve(null);
}
function saveCloudProgress(courseId, progress) {
  // Placeholder for a future backend (e.g. Supabase) integration.
  return Promise.resolve();
}

/* ============================================================
   2c. Progress export / import (merge-safe, all courses at once)
   ============================================================ */
function getAllStoredCourseIds() {
  var ids = [];
  if (storageAvailable) {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PROGRESS_KEY_PREFIX) === 0) ids.push(k.substring(PROGRESS_KEY_PREFIX.length));
      }
    } catch (e) { console.warn('failed to enumerate stored courses', e); }
  }
  CTX.registry.forEach(function (r) { if (ids.indexOf(r.id) === -1) ids.push(r.id); });
  return ids;
}

function mergeProgress(a, b) {
  a = a || freshProgress(); b = b || freshProgress();
  var result = freshProgress();

  var itemKeys = {};
  Object.keys(a.items || {}).forEach(function (k) { itemKeys[k] = true; });
  Object.keys(b.items || {}).forEach(function (k) { itemKeys[k] = true; });
  Object.keys(itemKeys).forEach(function (k) {
    var ra = (a.items || {})[k], rb = (b.items || {})[k];
    if (ra && !rb) { result.items[k] = ra; return; }
    if (rb && !ra) { result.items[k] = rb; return; }
    if (!ra && !rb) return;
    var newer = (rb.lastAnsweredAt || 0) >= (ra.lastAnsweredAt || 0) ? rb : ra;
    result.items[k] = {
      attempts: Math.max(ra.attempts || 0, rb.attempts || 0),
      correct: Math.max(ra.correct || 0, rb.correct || 0),
      incorrect: Math.max(ra.incorrect || 0, rb.incorrect || 0),
      status: newer.status || 'unanswered',
      correctStreak: newer.correctStreak || 0,
      bookmarked: !!ra.bookmarked || !!rb.bookmarked,
      nextReviewAt: newer.nextReviewAt || null,
      lastAnsweredAt: Math.max(ra.lastAnsweredAt || 0, rb.lastAnsweredAt || 0) || null,
    };
  });

  var chKeys = {};
  Object.keys(a.chapters || {}).forEach(function (k) { chKeys[k] = true; });
  Object.keys(b.chapters || {}).forEach(function (k) { chKeys[k] = true; });
  Object.keys(chKeys).forEach(function (id) {
    var ca = (a.chapters || {})[id], cb = (b.chapters || {})[id];
    if (ca && !cb) { result.chapters[id] = ca; return; }
    if (cb && !ca) { result.chapters[id] = cb; return; }
    if (!ca && !cb) return;
    result.chapters[id] = {
      attempts: Math.max(ca.attempts || 0, cb.attempts || 0),
      quizBestPct: Math.max(ca.quizBestPct || 0, cb.quizBestPct || 0),
      passed: !!ca.passed || !!cb.passed,
      cardsDone: !!ca.cardsDone || !!cb.cardsDone,
    };
  });

  var ta = a.totals || {}, tb = b.totals || {};
  var newerTotals = (tb.lastStudyAt || 0) >= (ta.lastStudyAt || 0) ? tb : ta;
  result.totals = {
    answered: Math.max(ta.answered || 0, tb.answered || 0),
    correct: Math.max(ta.correct || 0, tb.correct || 0),
    streak: newerTotals.streak || 0,
    maxStreak: Math.max(ta.maxStreak || 0, tb.maxStreak || 0),
    lastStudyAt: Math.max(ta.lastStudyAt || 0, tb.lastStudyAt || 0) || null,
  };
  return result;
}

function exportAllProgress() {
  var ids = getAllStoredCourseIds();
  var courses = {};
  ids.forEach(function (id) { courses[id] = loadProgressStore(id); });
  var payload = { version: 1, exportedAt: Date.now(), app: 'MedLearn', courses: courses };
  try {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = 'medlearn_progress_' + ts + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  } catch (e) {
    window.alert('書き出しに失敗しました: ' + ((e && e.message) ? e.message : e));
  }
}

function importProgressFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var parsed = JSON.parse(reader.result);
      var courses = (parsed && parsed.courses) ? parsed.courses : parsed;
      if (!courses || typeof courses !== 'object') throw new Error('ファイル形式が正しくありません');
      var count = 0;
      Object.keys(courses).forEach(function (id) {
        var incoming = courses[id];
        if (!incoming || typeof incoming !== 'object') return;
        var existing = loadProgressStore(id);
        var merged = mergeProgress(existing, incoming);
        saveProgressStore(id, merged);
        count += 1;
      });
      if (CTX.course && courses[CTX.course.id]) {
        CTX.course.progress = loadProgressStore(CTX.course.id);
      }
      window.alert(count + '件の教材の進捗を読み込み、既存の記録とマージしました。');
      render();
    } catch (e) {
      window.alert('進捗ファイルの読み込みに失敗しました: ' + ((e && e.message) ? e.message : e));
    }
  };
  reader.onerror = function () { window.alert('ファイルの読み込みに失敗しました。'); };
  reader.readAsText(file);
}

/* ============================================================
   3. Course context — everything specific to the active course
      lives here. Nothing about course *content* lives outside
      of files under /courses.
   ============================================================ */
var CTX = {
  registry: [],   // [{id, meta}] — lightweight, loaded at boot
  course: null,   // active course: {id, meta, cards, quiz, cardIndex, quizIndex, allCardItems, allQuizItems, itemIndex, categories, chapterOrder, bonusChapters, allChapters, progress}
};

function wrapCard(c) { return { key: 'card:' + c.id, kind: 'card', id: c.id, category: c.category, importance: c.importance, difficulty: null, qtype: null, data: c }; }
function wrapQuiz(q) { return { key: 'quiz:' + q.id, kind: 'quiz', id: q.id, category: q.category, importance: q.importance, difficulty: q.difficulty, qtype: q.type, data: q }; }

function loadCourseRegistry() {
  return fetchJSON(coursesUrl()).then(function (reg) {
    var ids = (reg && reg.courses) || [];
    return Promise.all(ids.map(function (id) {
      return fetchJSON(courseMetaUrl(id)).then(function (meta) { return { id: id, meta: meta }; }).catch(function (e) {
        console.warn('course metadata failed to load:', id, e);
        return null;
      });
    })).then(function (list) { return list.filter(Boolean); });
  });
}

function openCourse(courseId) {
  var entry = CTX.registry.find(function (r) { return r.id === courseId; });
  if (!entry) { showFatalError('教材が見つかりません', courseId); return Promise.reject(new Error('course not found')); }
  var meta = entry.meta;
  STATE.screen = 'loading';
  render();
  return Promise.all([
    fetchJSON(courseFileUrl(courseId, meta.cardsFile || 'atomic_cards.json')),
    fetchJSON(courseFileUrl(courseId, meta.quizFile || 'quiz_questions.json')),
  ]).then(function (results) {
    var cards = results[0], quiz = results[1];
    var allCardItems = cards.map(wrapCard);
    var allQuizItems = quiz.map(wrapQuiz);
    var itemIndex = {};
    allCardItems.forEach(function (it) { itemIndex[it.key] = it; });
    allQuizItems.forEach(function (it) { itemIndex[it.key] = it; });
    var categories = Array.from(new Set(cards.map(function (c) { return c.category; }).concat(quiz.map(function (q) { return q.category; })))).sort();
    var chapterOrder = (meta.chapters && meta.chapters.length) ? meta.chapters : categories.slice();
    var bonusChapters = meta.bonusChapters || [];
    var allChapters = chapterOrder.concat(bonusChapters);

    CTX.course = {
      id: courseId, meta: meta, cards: cards, quiz: quiz,
      allCardItems: allCardItems, allQuizItems: allQuizItems, itemIndex: itemIndex,
      categories: categories, chapterOrder: chapterOrder, bonusChapters: bonusChapters, allChapters: allChapters,
      importanceLevels: Array.from(new Set(cards.map(function (c) { return c.importance; }).concat(quiz.map(function (q) { return q.importance; })))).sort(function (a, b) { return b - a; }),
      difficultyLevels: Array.from(new Set(quiz.map(function (q) { return q.difficulty; }))).sort(),
      passThreshold: meta.passThreshold || 70,
      chapterQuizSize: meta.chapterQuizSize || 8,
      progress: loadProgressStore(courseId),
    };
    STATE.screen = 'course-home';
    render();
  }).catch(function (e) {
    showFatalError('教材データの読み込みに失敗しました', (e && e.message) ? e.message : e);
  });
}

var QUIZ_TYPE_LABEL = { multiple_choice: '四択', true_false: '○×', fill_blank: '穴埋め' };

/* ============================================================
   4. Item pool resolution (generic — works for any course)
   ============================================================ */
var MODE_DEFS = [
  { id: 'card', title: '一問一答', desc: 'カードをランダムに復習', icon: '📇', wide: true },
  { id: 'mc', title: '四択', desc: 'multiple choice', icon: '🅰️' },
  { id: 'tf', title: '○×', desc: 'true / false', icon: '⭕' },
  { id: 'fb', title: '穴埋め', desc: 'fill in the blank', icon: '✏️' },
  { id: 'quizall', title: 'クイズ総合', desc: '四択・○×・穴埋めミックス', icon: '🧩' },
  { id: 'wrong', title: '間違えた問題だけ復習', desc: '直近で不正解だった問題', icon: '🔁', wide: true },
  { id: 'bookmark', title: 'ブックマーク復習', desc: '保存した問題だけを解く', icon: '🔖' },
  { id: 'preop5', title: '重要事項のみ', desc: '★5の最重要事項だけ', icon: '🚨' },
];
function modeDefById(id) { for (var i = 0; i < MODE_DEFS.length; i++) if (MODE_DEFS[i].id === id) return MODE_DEFS[i]; return {}; }

function baseItemsForMode(modeId) {
  var c = CTX.course;
  switch (modeId) {
    case 'card': return c.allCardItems;
    case 'mc': return c.allQuizItems.filter(function (i) { return i.qtype === 'multiple_choice'; });
    case 'tf': return c.allQuizItems.filter(function (i) { return i.qtype === 'true_false'; });
    case 'fb': return c.allQuizItems.filter(function (i) { return i.qtype === 'fill_blank'; });
    case 'quizall': return c.allQuizItems;
    case 'wrong': return c.allCardItems.concat(c.allQuizItems);
    case 'bookmark': return c.allCardItems.concat(c.allQuizItems);
    case 'preop5': {
      var top = Math.max.apply(null, c.importanceLevels.length ? c.importanceLevels : [5]);
      return c.allCardItems.filter(function (i) { return i.importance === top; }).concat(c.allQuizItems.filter(function (i) { return i.importance === top; }));
    }
    default: return [];
  }
}
function itemsForMode(modeId, progress, filters) {
  var pool = baseItemsForMode(modeId);
  if (modeId === 'wrong') pool = pool.filter(function (it) { return getItemRecord(progress, it.key).status === 'incorrect'; });
  if (modeId === 'bookmark') pool = pool.filter(function (it) { return getItemRecord(progress, it.key).bookmarked; });
  if (filters) {
    if (filters.categories && filters.categories.length) pool = pool.filter(function (it) { return filters.categories.indexOf(it.category) !== -1; });
    if (filters.importance && filters.importance.length) pool = pool.filter(function (it) { return filters.importance.indexOf(it.importance) !== -1; });
    if (filters.difficulty && filters.difficulty.length) pool = pool.filter(function (it) { return it.difficulty === null || filters.difficulty.indexOf(it.difficulty) !== -1; });
    if (filters.qtypes && filters.qtypes.length && modeId === 'quizall') pool = pool.filter(function (it) { return it.qtype === null || filters.qtypes.indexOf(it.qtype) !== -1; });
    if (filters.status && filters.status !== 'all') {
      pool = pool.filter(function (it) {
        var rec = getItemRecord(progress, it.key);
        if (filters.status === 'unanswered') return rec.status === 'unanswered';
        if (filters.status === 'correct') return rec.status === 'correct';
        if (filters.status === 'incorrect') return rec.status === 'incorrect';
        return true;
      });
    }
  }
  return pool;
}
function sortForReview(pool, progress) {
  var now = Date.now();
  return pool.slice().sort(function (a, b) {
    var ra = getItemRecord(progress, a.key), rb = getItemRecord(progress, b.key);
    var overdueA = ra.nextReviewAt && ra.nextReviewAt <= now ? 1 : 0;
    var overdueB = rb.nextReviewAt && rb.nextReviewAt <= now ? 1 : 0;
    if (overdueA !== overdueB) return overdueB - overdueA;
    var wrongA = ra.status === 'incorrect' ? 1 : 0, wrongB = rb.status === 'incorrect' ? 1 : 0;
    if (wrongA !== wrongB) return wrongB - wrongA;
    return (ra.nextReviewAt || 0) - (rb.nextReviewAt || 0);
  });
}
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function computeOverallStats(progress) {
  var totals = progress.totals || { answered: 0, correct: 0, streak: 0 };
  var accuracy = totals.answered > 0 ? Math.round((totals.correct / totals.answered) * 100) : 0;
  var bookmarks = 0, wrong = 0, due = 0, now = Date.now();
  Object.keys(progress.items || {}).forEach(function (k) {
    var rec = progress.items[k];
    if (rec.bookmarked) bookmarks++;
    if (rec.status === 'incorrect') wrong++;
    if (rec.nextReviewAt && rec.nextReviewAt <= now) due++;
  });
  return { accuracy: accuracy, answered: totals.answered, streak: totals.streak, bookmarks: bookmarks, wrong: wrong, due: due };
}
function countForMode(modeId, progress) { return itemsForMode(modeId, progress, null).length; }

/* ============================================================
   5. Chapter helpers (generic — driven by course.json)
   ============================================================ */
function chapterCards(chapterId) { return CTX.course.allCardItems.filter(function (i) { return i.category === chapterId; }); }
function chapterQuizPool(chapterId) { return CTX.course.allQuizItems.filter(function (i) { return i.category === chapterId; }); }
function buildChapterQuizQueue(chapterId) {
  var pool = chapterQuizPool(chapterId);
  var cap = CTX.course.chapterQuizSize;
  var target = pool.length <= cap ? pool.length : cap;
  var byImp = {};
  pool.forEach(function (i) { (byImp[i.importance] = byImp[i.importance] || []).push(i); });
  var tiers = Object.keys(byImp).map(Number).sort(function (a, b) { return b - a; });
  var ordered = [];
  tiers.forEach(function (t) { ordered = ordered.concat(shuffle(byImp[t])); });
  var selected = shuffle(ordered.slice(0, target));
  return selected.map(function (it) { return it.key; });
}
function courseCompletionPct(courseId, meta) {
  var progress = loadProgressStore(courseId);
  var order = (meta.chapters && meta.chapters.length) ? meta.chapters : [];
  if (order.length === 0) return 0;
  var passed = order.filter(function (id) { return getChapterProgress(progress, id).passed; }).length;
  return Math.round((passed / order.length) * 100);
}

/* ============================================================
   6. Global application state
   ============================================================ */
var STATE = {
  theme: loadTheme(),
  lang: loadLang(), // 'ja' | 'en'
  screen: 'loading', // loading | courses | course-home | learn | chapter-intro | setup | session | stats
  setup: null,
  session: null,
  statsTab: 'overview',
  learnChapterId: null,
  loadError: null,
};

/* ============================================================
   7. Answer recording / bookmarking
   ============================================================ */
function recordAnswer(key, isCorrect) {
  var progress = CTX.course.progress;
  var rec = Object.assign({}, getItemRecord(progress, key));
  rec.attempts += 1;
  var now = Date.now();
  if (isCorrect) {
    rec.correct += 1; rec.correctStreak += 1; rec.status = 'correct';
    var stage = Math.min(rec.correctStreak, SRS_INTERVALS.length);
    rec.nextReviewAt = now + SRS_INTERVALS[stage - 1] * DAY_MS;
  } else {
    rec.incorrect += 1; rec.correctStreak = 0; rec.status = 'incorrect'; rec.nextReviewAt = now;
  }
  rec.lastAnsweredAt = now;
  progress.items[key] = rec;
  progress.totals.answered += 1;
  if (isCorrect) { progress.totals.correct += 1; progress.totals.streak += 1; progress.totals.maxStreak = Math.max(progress.totals.maxStreak || 0, progress.totals.streak); }
  else { progress.totals.streak = 0; }
  progress.totals.lastStudyAt = now;
  persist();
}
function toggleBookmark(key) {
  var progress = CTX.course.progress;
  var rec = Object.assign({}, getItemRecord(progress, key));
  rec.bookmarked = !rec.bookmarked;
  progress.items[key] = rec;
  persist();
}
function resetProgress() {
  if (!window.confirm('この教材の学習履歴をすべて削除します。よろしいですか？')) return;
  CTX.course.progress = freshProgress(); persist(); render();
}

/* ============================================================
   8. Navigation helpers
   ============================================================ */
function goCourses() { STATE.screen = 'courses'; CTX.course = null; render(); refreshRegistryProgress(); }
function goCourseHome() { STATE.screen = 'course-home'; STATE.setup = null; STATE.session = null; render(); }
function goSetup(modeId) {
  STATE.screen = 'setup';
  STATE.setup = { mode: modeId, categories: [], importance: [], difficulty: [], qtypes: [], status: 'all', order: 'shuffle' };
  render();
}
function goStats() { STATE.screen = 'stats'; STATE.statsTab = 'overview'; render(); }
function goSession(modeId, queueKeys) {
  STATE.screen = 'session';
  STATE.session = { mode: modeId, queue: queueKeys, index: 0, answeredMap: {}, sessionCorrect: 0, sessionAnswered: 0, cardRevealed: false, fbDraft: '', isChapter: false };
  render();
}
function goLearn() { STATE.screen = 'learn'; render(); }
function goChapterIntro(chapterId) { STATE.screen = 'chapter-intro'; STATE.learnChapterId = chapterId; render(); }

function startChapterCards(chapterId) {
  var cards = chapterCards(chapterId);
  STATE.screen = 'session';
  STATE.session = {
    mode: 'chapter', queue: cards.map(function (c) { return c.key; }), index: 0, answeredMap: {},
    sessionCorrect: 0, sessionAnswered: 0, cardRevealed: false, fbDraft: '',
    isChapter: true, chapterId: chapterId, chapterPhase: 'cards',
  };
  render();
}
function beginChapterQuiz() {
  var chapterId = STATE.session.chapterId;
  var queue = buildChapterQuizQueue(chapterId);
  STATE.session = {
    mode: 'chapter', queue: queue, index: 0, answeredMap: {}, sessionCorrect: 0, sessionAnswered: 0,
    cardRevealed: false, fbDraft: '', isChapter: true, chapterId: chapterId, chapterPhase: 'quiz',
  };
  render();
}

/* ============================================================
   9. Fill-blank answer checking
   ============================================================ */
function normalizeAnswer(s) { return (s || '').trim().toLowerCase().replace(/\s+/g, '').replace(/　/g, ''); }
function checkFillBlank(userInput, quizData) {
  var norm = normalizeAnswer(userInput);
  if (!norm) return false;
  var candidates = [quizData.correct_answer].concat(quizData.accepted_answers || []).filter(Boolean).map(normalizeAnswer);
  return candidates.indexOf(norm) !== -1;
}

/* ============================================================
   10. Small render helpers
   ============================================================ */
function stars(n) { return '★'.repeat(n); }
function fmtDate(ts) { return ts ? new Date(ts).toLocaleString('ja-JP') : '-'; }
function tag(text, extraClass) { return '<span class="tag' + (extraClass ? ' ' + extraClass : '') + '">' + escapeHtml(text) + '</span>'; }
function chip(label, value, active, groupAttr) {
  return '<button class="chip' + (active ? ' on' : '') + '" data-action="' + groupAttr + '" data-value="' + escapeHtml(String(value)) + '">' + escapeHtml(label) + '</button>';
}
function detailBlock(label, body, extraClass) {
  return '<div class="detail-block' + (extraClass ? ' ' + extraClass : '') + '"><div class="dt-label">' + escapeHtml(label) + '</div><div class="dt-body">' + escapeHtml(body) + '</div></div>';
}

/* -- i18n helpers ---------------------------------------------
   If the active language is 'en' and a "<field>_en" property
   exists (and is non-empty) on the source object, use it.
   Otherwise fall back to the Japanese field. This keeps every
   course JSON backward compatible — courses without *_en fields
   simply keep showing Japanese regardless of the language toggle.
   -------------------------------------------------------------- */
function L(obj, field) {
  if (!obj) return '';
  if (STATE.lang === 'en') {
    var enVal = obj[field + '_en'];
    if (enVal !== undefined && enVal !== null && enVal !== '') return enVal;
  }
  return obj[field];
}
function Lchoices(q) {
  if (STATE.lang === 'en' && Array.isArray(q.choices_en) && q.choices_en.length === q.choices.length) return q.choices_en;
  return q.choices;
}

/* ============================================================
   11. Top bar
   ============================================================ */
function renderTopBar() {
  var inCourse = !!CTX.course;
  var brandLabel = inCourse ? (CTX.course.meta.shortTitle || CTX.course.meta.title) : 'MedLearn';
  var brandIcon = inCourse ? (CTX.course.meta.icon || '📚') : '📚';
  return (
    '<div class="topbar">' +
      '<button class="brand" data-action="' + (inCourse ? 'go-course-home' : 'go-courses') + '" style="background:none;border:none;color:inherit;">' +
        '<span class="brand-mark">' + brandIcon + '</span>' + escapeHtml(brandLabel) + '<span class="brand-sub">' + (inCourse ? '見学準備' : '医療学習プラットフォーム') + '</span>' +
      '</button>' +
      '<div class="topbar-actions">' +
        (inCourse ? '<button class="icon-btn" data-action="go-courses" title="教材一覧" aria-label="教材一覧">📚</button>' : '') +
        (inCourse && STATE.screen !== 'stats' ? '<button class="icon-btn" data-action="go-stats" title="学習履歴" aria-label="学習履歴">📊</button>' : '') +
        '<button class="icon-btn" data-action="toggle-lang" title="言語切替 / Switch language" aria-label="言語切替">' + (STATE.lang === 'en' ? '🇯🇵 JA' : '🇺🇸 EN') + '</button>' +
        '<button class="icon-btn" data-action="toggle-theme" title="テーマ切替" aria-label="テーマ切替">' + (STATE.theme === 'dark' ? '☀️' : '🌙') + '</button>' +
      '</div>' +
    '</div>'
  );
}

/* ============================================================
   12. Course picker (app home)
   ============================================================ */
function renderIoRow() {
  return (
    '<div class="progress-io-row" style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 8px;">' +
      '<button class="btn btn-ghost" data-action="export-progress">⬇️ 進捗を書き出す</button>' +
      '<button class="btn btn-ghost" data-action="import-progress">⬆️ 進捗を読み込む</button>' +
    '</div>'
  );
}
function renderCoursePicker() {
  if (STATE.loadError) {
    return (
      '<div class="course-empty">' +
        '<div class="ei" style="font-size:34px;margin-bottom:14px;">⚠️</div>' +
        '<h3 style="font-family:var(--font-display);color:var(--text);">教材一覧の読み込みに失敗しました</h3>' +
        '<p>' + escapeHtml(STATE.loadError) + '</p>' +
        '<button class="btn btn-primary" data-action="retry-registry">再読み込み</button>' +
      '</div>' + renderIoRow()
    );
  }
  if (CTX.registry.length === 0) {
    return '<div class="course-empty"><div style="font-size:34px;margin-bottom:14px;">📭</div><h3 style="font-family:var(--font-display);color:var(--text);">教材がまだ登録されていません</h3><p>courses/courses.json に教材IDを追加してください。</p></div>' + renderIoRow();
  }
  var cards = CTX.registry.map(function (entry) {
    var meta = entry.meta;
    var pct = courseCompletionPct(entry.id, meta);
    return (
      '<button class="course-card" style="--course-color:' + escapeHtml(meta.color || '#3B5FE0') + ';" data-action="open-course" data-course="' + escapeHtml(entry.id) + '">' +
        '<div class="cc-icon">' + (meta.icon || '📚') + '</div>' +
        '<div class="cc-title">' + escapeHtml(meta.title || entry.id) + '</div>' +
        '<div class="cc-desc">' + escapeHtml(meta.description || '') + '</div>' +
        '<div class="cc-progress-track"><div class="cc-progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="cc-progress-label">' + pct + '% クリア</div>' +
      '</button>'
    );
  }).join('');

  return (
    '<div class="hero">' +
      '<div class="eyebrow">Medical Learning Platform</div>' +
      '<h1>教材を選んで学習を始める。</h1>' +
      '<p>Atomic Knowledge Card と クイズによる反復学習アプリです。教材ごとに学習履歴は分離して保存されます。</p>' +
    '</div>' +
    renderIoRow() +
    '<div class="section-label">教材一覧</div>' +
    '<div class="course-grid">' + cards + '</div>'
  );
}

/* ============================================================
   13. Course home (per-course landing: Learn Mode CTA + Random Review)
   ============================================================ */
function currentChapterForCta() {
  var order = CTX.course.chapterOrder;
  for (var i = 0; i < order.length; i++) {
    if (!getChapterProgress(CTX.course.progress, order[i]).passed) return { id: order[i], index: i };
  }
  return null;
}
function renderCourseHome() {
  var course = CTX.course;
  var stats = computeOverallStats(course.progress);
  var order = course.chapterOrder;
  var passedCount = order.filter(function (id) { return getChapterProgress(course.progress, id).passed; }).length;
  var pct = order.length ? Math.round((passedCount / order.length) * 100) : 0;
  var next = currentChapterForCta();

  var ctaHtml;
  if (next) {
    ctaHtml =
      '<button class="learn-cta" data-action="go-learn" style="background:' + escapeHtml(course.meta.color || '#3B5FE0') + ';">' +
        '<div class="lc-eyebrow">Learn Mode · Chapter ' + (next.index + 1) + ' / ' + order.length + '</div>' +
        '<div class="lc-title">' + (course.meta.icon || '📘') + ' ' + escapeHtml(next.id) + '</div>' +
        '<div class="lc-sub">教材の流れに沿って、カード学習→章末クイズの順に進めます</div>' +
        '<div class="lc-progress-track"><div class="lc-progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="lc-progress-label">' + passedCount + ' / ' + order.length + ' 章 クリア</div>' +
      '</button>';
  } else {
    ctaHtml =
      '<button class="learn-cta" data-action="go-learn" style="background:' + escapeHtml(course.meta.color || '#3B5FE0') + ';">' +
        '<div class="lc-eyebrow">Learn Mode · Complete</div>' +
        '<div class="lc-title">🎉 全' + order.length + '章クリア！</div>' +
        '<div class="lc-sub">お疲れさまでした。ボーナス章や復習モードで知識を定着させましょう</div>' +
        '<div class="lc-progress-track"><div class="lc-progress-fill" style="width:100%"></div></div>' +
        '<div class="lc-progress-label">' + passedCount + ' / ' + order.length + ' 章 クリア</div>' +
      '</button>';
  }

  var quickCards = MODE_DEFS.map(function (m) {
    var cls = 'quick-card' + (m.wide ? ' wide' : '');
    return (
      '<button class="' + cls + '" data-action="select-mode" data-mode="' + m.id + '">' +
        '<div class="qi">' + m.icon + '</div>' +
        '<div class="qtxt">' +
          '<div class="qt">' + escapeHtml(m.title) + '</div>' +
          '<div class="qd">' + escapeHtml(m.desc) + '</div>' +
          '<div class="qc">' + countForMode(m.id, course.progress) + '問 対象</div>' +
        '</div>' +
      '</button>'
    );
  }).join('');

  return (
    '<button class="back-link" data-action="go-courses">← 教材一覧に戻る</button>' +
    '<div class="hero">' +
      '<div class="eyebrow">' + escapeHtml(course.meta.title) + '</div>' +
      '<h1>' + escapeHtml(course.meta.longDescription || course.meta.description || '') + '</h1>' +
    '</div>' +
    '<div class="stat-row">' +
      '<div class="stat-chip"><div class="n">' + stats.answered + '</div><div class="l">総回答数</div></div>' +
      '<div class="stat-chip"><div class="n">' + stats.accuracy + '%</div><div class="l">正答率</div></div>' +
      '<div class="stat-chip"><div class="n">' + stats.streak + '</div><div class="l">連続正解</div></div>' +
      '<div class="stat-chip"><div class="n">' + stats.due + '</div><div class="l">復習期限超過</div></div>' +
    '</div>' +
    '<div class="section-label">Learn Mode（推奨）</div>' +
    ctaHtml +
    '<div class="section-label">Random Review（自由演習・独立モード）</div>' +
    '<div class="quick-grid">' + quickCards + '</div>' +
    '<div class="section-label">学習履歴</div>' +
    '<button class="quick-card wide" data-action="go-stats">' +
      '<div class="qi">📈</div>' +
      '<div class="qtxt">' +
        '<div class="qt">統計・苦手カテゴリを見る</div>' +
        '<div class="qd">' + (stats.answered > 0 ? '最終学習: ' + escapeHtml(fmtDate(course.progress.totals.lastStudyAt)) : 'まだ学習履歴がありません。Learn Modeから始めましょう。') + '</div>' +
      '</div>' +
    '</button>'
  );
}

/* ============================================================
   14. Learn Mode — dashboard / chapter intro
   ============================================================ */
function renderLearnDashboard() {
  var course = CTX.course;
  var rows = course.allChapters.map(function (chId, idx) {
    var isBonus = course.chapterOrder.indexOf(chId) === -1;
    var prog = getChapterProgress(course.progress, chId);
    var unlocked = idx === 0 ? true : getChapterProgress(course.progress, course.allChapters[idx - 1]).passed;
    var rowCls = 'chapter-row';
    var statusHtml, badgeContent;
    if (prog.passed) {
      rowCls += ' complete clickable';
      statusHtml = '<span class="chapter-status complete">✓ 合格 (最高' + prog.quizBestPct + '%)</span>';
      badgeContent = '✓';
    } else if (unlocked) {
      rowCls += ' current clickable';
      statusHtml = prog.attempts > 0 ? '<span class="chapter-status current">挑戦中 · 最高' + prog.quizBestPct + '%</span>' : '<span class="chapter-status current">開始する →</span>';
      badgeContent = String(idx + 1);
    } else {
      rowCls += ' locked';
      statusHtml = '<span class="chapter-status locked">🔒 ロック中</span>';
      badgeContent = '🔒';
    }
    var cardCount = chapterCards(chId).length;
    var quizCount = chapterQuizPool(chId).length;
    var titlePrefix = isBonus ? 'ボーナス · ' : ('Chapter ' + (idx + 1) + ' · ');
    return (
      '<button class="' + rowCls + '" ' + (unlocked ? 'data-action="open-chapter" data-chapter="' + escapeHtml(chId) + '"' : 'disabled') + '>' +
        '<div class="chapter-num">' + badgeContent + '</div>' +
        '<div class="chapter-body"><div class="chapter-title">' + titlePrefix + escapeHtml(chId) + '</div>' +
        '<div class="chapter-meta">カード ' + cardCount + '枚 ・ 章末クイズ ' + quizCount + '問</div></div>' +
        statusHtml +
      '</button>'
    );
  }).join('');

  var passedCount = course.chapterOrder.filter(function (id) { return getChapterProgress(course.progress, id).passed; }).length;

  return (
    '<button class="back-link" data-action="go-course-home">← ' + escapeHtml(course.meta.shortTitle || course.meta.title) + ' トップに戻る</button>' +
    '<div class="hero" style="margin-bottom:22px;">' +
      '<div class="eyebrow">Learn Mode</div>' +
      '<h1 style="font-size:22px;">教材の流れに沿って学習</h1>' +
      '<p>各章はカードでの一問一答→章末クイズ（合格ライン' + course.passThreshold + '%）の順に進みます。合格すると次の章が解放されます。</p>' +
    '</div>' +
    '<div class="stat-row" style="grid-template-columns:1fr;">' +
      '<div class="stat-chip" style="text-align:left;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;">' +
        '<span class="l" style="font-size:12px;">全体の進捗</span><span class="n" style="font-size:16px;">' + passedCount + ' / ' + course.chapterOrder.length + ' 章クリア</span>' +
      '</div>' +
    '</div>' +
    '<div class="chapter-list" style="margin-top:18px;">' + rows + '</div>'
  );
}

function renderChapterIntro() {
  var course = CTX.course;
  var chId = STATE.learnChapterId;
  var idx = course.allChapters.indexOf(chId);
  var isBonus = course.chapterOrder.indexOf(chId) === -1;
  var prog = getChapterProgress(course.progress, chId);
  var cardCount = chapterCards(chId).length;
  var quizCount = chapterQuizPool(chId).length;
  var quizTarget = quizCount <= course.chapterQuizSize ? quizCount : course.chapterQuizSize;

  var btnLabel = prog.passed ? '復習する' : (prog.attempts > 0 ? 'もう一度挑戦する' : 'この章を始める');
  var desc = prog.passed
    ? 'この章はすでに合格済みです（最高スコア ' + prog.quizBestPct + '%）。復習として何度でも学習できます。'
    : 'まず ' + cardCount + '枚のAtomic Knowledge Cardを順番に学習し、続けて章末クイズ（' + quizTarget + '問・合格ライン' + course.passThreshold + '%）に挑戦します。';

  return (
    '<button class="back-link" data-action="go-learn">← Learn Modeに戻る</button>' +
    '<div class="card">' +
      '<div class="chapter-intro-box">' +
        '<div class="ci-num">' + (isBonus ? 'Bonus Chapter' : 'Chapter ' + (idx + 1) + ' / ' + course.chapterOrder.length) + '</div>' +
        '<h2>' + escapeHtml(chId) + '</h2>' +
        '<p>' + escapeHtml(desc) + '</p>' +
        '<div class="chapter-intro-stats">' +
          '<div class="cs"><div class="csn">' + cardCount + '</div><div class="csl">カード</div></div>' +
          '<div class="cs"><div class="csn">' + quizTarget + '</div><div class="csl">章末クイズ</div></div>' +
          '<div class="cs"><div class="csn">' + course.passThreshold + '%</div><div class="csl">合格ライン</div></div>' +
        '</div>' +
        '<button class="btn btn-primary btn-block" data-action="start-chapter" data-chapter="' + escapeHtml(chId) + '">' + btnLabel + ' →</button>' +
      '</div>' +
    '</div>'
  );
}

/* ============================================================
   15. Random Review — filter setup screen
   ============================================================ */
function renderModeSetup() {
  var course = CTX.course;
  var setup = STATE.setup;
  var modeDef = modeDefById(setup.mode);
  var filters = { categories: setup.categories, importance: setup.importance, difficulty: setup.difficulty, qtypes: setup.qtypes, status: setup.status };
  var matched = itemsForMode(setup.mode, course.progress, filters);
  var isCardMode = setup.mode === 'card' || setup.mode === 'wrong' || setup.mode === 'bookmark' || setup.mode === 'preop5';

  var catChips = course.categories.map(function (c) { return chip(c, c, setup.categories.indexOf(c) !== -1, 'toggle-category'); }).join('');
  var impChips = course.importanceLevels.map(function (lv) { return chip(stars(lv), lv, setup.importance.indexOf(lv) !== -1, 'toggle-importance'); }).join('');
  var diffChips = course.difficultyLevels.map(function (lv) { return chip('Lv.' + lv, lv, setup.difficulty.indexOf(lv) !== -1, 'toggle-difficulty'); }).join('');
  var qtypeChips = Object.keys(QUIZ_TYPE_LABEL).map(function (k) { return chip(QUIZ_TYPE_LABEL[k], k, setup.qtypes.indexOf(k) !== -1, 'toggle-qtype'); }).join('');
  var statusOptions = [['all', 'すべて'], ['unanswered', '未回答'], ['correct', '正解済み'], ['incorrect', '不正解']];
  var statusChips = statusOptions.map(function (pair) {
    return '<button class="chip' + (setup.status === pair[0] ? ' on' : '') + '" data-action="set-status" data-value="' + pair[0] + '">' + pair[1] + '</button>';
  }).join('');

  return (
    '<button class="back-link" data-action="go-course-home">← 戻る</button>' +
    '<div class="hero" style="margin-bottom:18px;">' +
      '<div class="eyebrow">Random Review</div>' +
      '<h1 style="font-size:22px;">' + modeDef.icon + ' ' + escapeHtml(modeDef.title) + '</h1>' +
      '<p>' + escapeHtml(modeDef.desc) + '</p>' +
    '</div>' +
    '<div class="panel">' +
      '<h3>絞り込み</h3>' +
      '<p class="sub">条件を選ぶと対象問題数がリアルタイムに更新されます。</p>' +
      '<div class="filter-group"><div class="fg-label">Category</div><div class="chip-row">' + catChips + '</div></div>' +
      '<div class="filter-group"><div class="fg-label">Importance</div><div class="chip-row">' + impChips + '</div></div>' +
      (!isCardMode ? '<div class="filter-group"><div class="fg-label">Difficulty</div><div class="chip-row">' + diffChips + '</div></div>' : '') +
      (setup.mode === 'quizall' ? '<div class="filter-group"><div class="fg-label">Question Type</div><div class="chip-row">' + qtypeChips + '</div></div>' : '') +
      '<div class="filter-group"><div class="fg-label">回答状況</div><div class="chip-row">' + statusChips + '</div></div>' +
      '<div class="filter-group"><div class="fg-label">出題順</div><div class="chip-row">' +
        '<button class="chip' + (setup.order === 'shuffle' ? ' on' : '') + '" data-action="set-order" data-value="shuffle">ランダム</button>' +
        '<button class="chip' + (setup.order === 'review' ? ' on' : '') + '" data-action="set-order" data-value="review">復習期限優先</button>' +
        '<button class="chip' + (setup.order === 'sequential' ? ' on' : '') + '" data-action="set-order" data-value="sequential">教材順（動画順）</button>' +
      '</div></div>' +
      '<div class="start-row">' +
        '<div class="match-count">対象: <b>' + matched.length + '</b>問</div>' +
        '<button class="btn btn-primary" data-action="start-session" ' + (matched.length === 0 ? 'disabled' : '') + '>学習を開始 →</button>' +
      '</div>' +
    '</div>'
  );
}

/* ============================================================
   16. Session (shared by Random Review + Learn Mode chapters)
   ============================================================ */
function renderSession() {
  var course = CTX.course;
  var s = STATE.session;
  var currentKey = s.queue[s.index];
  var item = course.itemIndex[currentKey];

  if (!item && s.queue.length === 0) {
    return (
      '<div class="empty-state"><div class="ei">🗂️</div><h3>対象の問題がありません</h3>' +
        '<p>フィルター条件に一致する問題が見つかりませんでした。条件を変えて再度お試しください。</p>' +
        '<button class="btn btn-primary" data-action="go-course-home">戻る</button></div>'
    );
  }

  var total = s.queue.length;
  if (s.index >= total) {
    if (s.isChapter && s.chapterPhase === 'cards') { beginChapterQuiz(); return '<div class="empty-state"><div class="ei">⏳</div><p>読み込み中...</p></div>'; }
    if (s.isChapter && s.chapterPhase === 'quiz') {
      if (!s.resultRecorded) {
        var pct = s.sessionAnswered > 0 ? Math.round((s.sessionCorrect / s.sessionAnswered) * 100) : 0;
        var passed = pct >= course.passThreshold;
        var chProg = Object.assign({}, getChapterProgress(course.progress, s.chapterId));
        chProg.attempts = (chProg.attempts || 0) + 1;
        chProg.quizBestPct = Math.max(chProg.quizBestPct || 0, pct);
        chProg.cardsDone = true;
        if (passed) chProg.passed = true;
        course.progress.chapters[s.chapterId] = chProg;
        persist();
        s.resultRecorded = true; s.lastPct = pct; s.lastPassed = passed;
      }
      return renderChapterQuizResult(s.chapterId, s.lastPct, s.lastPassed);
    }
    var sessAcc = s.sessionAnswered > 0 ? Math.round((s.sessionCorrect / s.sessionAnswered) * 100) : 0;
    return (
      '<div class="complete-box"><div class="cn">' + s.sessionAnswered + '</div><h2>セッション完了</h2>' +
        '<p>お疲れさまでした。今回のセッションの結果です。</p>' +
        '<div class="complete-stats">' +
          '<div class="stat-chip"><div class="n">' + s.sessionAnswered + '</div><div class="l">回答数</div></div>' +
          '<div class="stat-chip"><div class="n">' + sessAcc + '%</div><div class="l">正答率</div></div>' +
          '<div class="stat-chip"><div class="n">' + s.sessionCorrect + '</div><div class="l">正解数</div></div>' +
        '</div>' +
        '<button class="btn btn-primary btn-block" data-action="go-course-home">戻る</button></div>'
    );
  }

  var progressPct = Math.round((s.index / total) * 100);
  var sessAcc2 = s.sessionAnswered > 0 ? Math.round((s.sessionCorrect / s.sessionAnswered) * 100) : 0;
  var rec = getItemRecord(course.progress, currentKey);
  var answered = s.answeredMap[s.index];
  var body = item.kind === 'card' ? renderCardQuestion(item, rec, answered) : renderQuizQuestion(item, rec, answered);

  var phaseLabel = '';
  if (s.isChapter) phaseLabel = s.chapterPhase === 'cards' ? escapeHtml(s.chapterId) + ' · カード学習' : escapeHtml(s.chapterId) + ' · 章末クイズ';
  var backAction = s.isChapter ? 'data-action="go-learn"' : 'data-action="go-course-home"';
  var backLabel = s.isChapter ? '← 中断してLearn Modeへ' : '← 中断して戻る';

  return (
    '<button class="back-link" ' + backAction + '>' + backLabel + '</button>' +
    '<div class="session-header">' +
      (phaseLabel ? '<div class="eyebrow" style="margin-bottom:8px;">' + phaseLabel + '</div>' : '') +
      '<div class="progress-track"><div class="progress-fill" style="width:' + progressPct + '%"></div></div>' +
      '<div class="session-meta"><span>' + (s.index + 1) + ' / ' + total + '</span><span>残り ' + (total - s.index - 1) + '問</span><span class="acc">セッション正答率 ' + sessAcc2 + '%</span></div>' +
    '</div>' +
    body +
    '<div class="session-footer"><div class="nav-btns">' +
      '<button class="btn btn-ghost" data-action="session-prev" ' + (s.index === 0 ? 'disabled' : '') + '>← 前へ</button>' +
      '<button class="btn btn-ghost" data-action="session-next">' + (answered ? '次へ →' : 'スキップ →') + '</button>' +
    '</div></div>'
  );
}

function renderChapterQuizResult(chapterId, pct, passed) {
  var course = CTX.course;
  var idx = course.chapterOrder.indexOf(chapterId);
  var hasNext = idx !== -1 && idx < course.allChapters.length - 1;
  var nextId = hasNext ? course.allChapters[idx + 1] : null;
  var actions = '';
  if (passed) {
    actions += '<button class="btn btn-primary btn-block" data-action="chapter-result-next" data-chapter="' + escapeHtml(chapterId) + '">' + (nextId ? '次の章へ (' + escapeHtml(nextId) + ') →' : 'Learn Modeの一覧に戻る →') + '</button>';
    actions += '<button class="btn btn-ghost btn-block" data-action="go-learn">章一覧に戻る</button>';
  } else {
    actions += '<button class="btn btn-primary btn-block" data-action="retry-chapter-quiz">クイズにもう一度挑戦する</button>';
    actions += '<button class="btn btn-ghost btn-block" data-action="start-chapter" data-chapter="' + escapeHtml(chapterId) + '">カードを復習してからもう一度</button>';
    actions += '<button class="btn btn-ghost btn-block" data-action="go-learn">章一覧に戻る</button>';
  }
  return (
    '<div class="card"><div class="quiz-result-box ' + (passed ? 'pass' : 'fail') + '">' +
      '<div class="qr-pct">' + pct + '%</div><h2>' + (passed ? '✓ 合格しました！' : 'もう一歩です') + '</h2>' +
      '<p>' + escapeHtml(chapterId) + ' の章末クイズの結果です（合格ライン ' + course.passThreshold + '%）。' + (passed ? '' : 'カードを見直してから再挑戦しましょう。') + '</p>' +
      '<div class="quiz-result-actions">' + actions + '</div>' +
    '</div></div>'
  );
}

/* ============================================================
   17. Card question (一問一答, self-assessed)
   ============================================================ */
function renderCardQuestion(item, rec, answered) {
  var c = item.data;
  var revealed = !!answered || !!STATE.session.cardRevealed;
  var html =
    '<div class="card"><div class="tag-row">' + tag(c.category) + tag(stars(c.importance), c.importance === (CTX.course.importanceLevels[0]) ? 'imp5' : '') +
      '<div style="flex:1;"></div><button class="bookmark-btn' + (rec.bookmarked ? ' on' : '') + '" data-action="toggle-bookmark" data-key="' + item.key + '" title="ブックマーク" aria-label="ブックマーク">' + (rec.bookmarked ? '★' : '☆') + '</button></div>' +
      '<p class="q-text">' + escapeHtml(L(c, 'question')) + '</p>';

  if (!revealed) {
    html += '<button class="reveal-btn" data-action="reveal-card">タップして答えを見る</button>';
  } else {
    html += '<div class="answer-box"><div class="ans-label">Answer</div><div class="ans-text">' + escapeHtml(L(c, 'answer')) + '</div></div>';
    if (c.explanation) html += detailBlock('Explanation', L(c, 'explanation'), '');
    if (c.clinical_pearl) html += detailBlock('💡 Clinical Pearl', L(c, 'clinical_pearl'), 'pearl');
    if (c.common_mistake) html += detailBlock('⚠️ Common Mistake', L(c, 'common_mistake'), 'mistake');
    if (c.related && c.related.length > 0) {
      html += '<div class="detail-block"><div class="dt-label">Related</div><div class="src-ids">' + c.related.map(function (r) { return '<span class="src-chip">' + escapeHtml(r) + '</span>'; }).join('') + '</div></div>';
    }
    if (!answered) {
      html += '<div class="self-grade"><button class="g-good" data-action="grade-card" data-value="good">✓ 分かった（正解扱い）</button><button class="g-bad" data-action="grade-card" data-value="bad">✗ わからなかった</button></div>';
    } else {
      html += '<div class="result-banner ' + (answered.isCorrect ? 'good' : 'bad') + '">' + (answered.isCorrect ? '✓ 「分かった」として記録済み' : '✗ 「わからなかった」として記録済み（復習キューへ）') + '</div>';
    }
  }
  html += '</div>';
  return html;
}

/* ============================================================
   18. Quiz question (mc / tf / fb)
   ============================================================ */
function renderQuizQuestion(item, rec, answered) {
  var q = item.data;
  var locked = !!answered;
  var selected = answered ? answered.userAnswer : null;
  var html =
    '<div class="card"><div class="tag-row">' + tag(q.category) + tag(stars(q.importance), q.importance === CTX.course.importanceLevels[0] ? 'imp5' : '') + tag(QUIZ_TYPE_LABEL[q.type]) +
      '<div style="flex:1;"></div><button class="bookmark-btn' + (rec.bookmarked ? ' on' : '') + '" data-action="toggle-bookmark" data-key="' + item.key + '" title="ブックマーク" aria-label="ブックマーク">' + (rec.bookmarked ? '★' : '☆') + '</button></div>' +
      '<p class="q-text">' + escapeHtml(L(q, 'question')) + '</p>';

  if (q.type === 'multiple_choice') {
    var choices = Lchoices(q);
    html += '<div class="choices">';
    choices.forEach(function (c, idx) {
      var cls = 'choice-btn';
      if (locked) { if (idx === q.correct_answer) cls += ' correct'; else if (idx === selected) cls += ' incorrect'; }
      else if (idx === selected) cls += ' selected';
      html += '<button class="' + cls + '" ' + (locked ? 'disabled' : '') + ' data-action="answer-mc" data-idx="' + idx + '"><span class="cl">' + String.fromCharCode(65 + idx) + '</span><span>' + escapeHtml(c) + '</span></button>';
    });
    html += '</div>';
  } else if (q.type === 'true_false') {
    html += '<div class="tf-row">';
    [true, false].forEach(function (val) {
      var cls = 'tf-btn';
      if (locked) { if (val === q.correct_answer) cls += ' correct'; else if (val === selected) cls += ' incorrect'; }
      else if (val === selected) cls += ' selected';
      html += '<button class="' + cls + '" ' + (locked ? 'disabled' : '') + ' data-action="answer-tf" data-value="' + val + '">' + (val ? '○ True' : '× False') + '</button>';
    });
    html += '</div>';
  } else if (q.type === 'fill_blank') {
    var isCorrectOverall = answered ? answered.isCorrect : null;
    var inputCls = 'fb-input' + (locked ? (isCorrectOverall ? ' correct' : ' incorrect') : '');
    var val = locked ? (answered.userAnswer || '') : (STATE.session.fbDraft || '');
    html += '<input class="' + inputCls + '" type="text" id="fb-input-live" placeholder="回答を入力..." value="' + escapeHtml(val) + '" ' + (locked ? 'disabled' : '') + ' autocomplete="off" />';
    if (!locked) html += '<button class="btn btn-primary btn-block" style="margin-top:12px;" data-action="answer-fb" id="fb-submit-btn" ' + (!STATE.session.fbDraft || !STATE.session.fbDraft.trim() ? 'disabled' : '') + '>回答を確定</button>';
  }

  if (locked) {
    html += '<div class="result-banner ' + (answered.isCorrect ? 'good' : 'bad') + '">' + (answered.isCorrect ? '✓ 正解！' : '✗ 不正解') + '</div>';
    if (q.type === 'fill_blank') html += '<div class="answer-box"><div class="ans-label">正解</div><div class="ans-text">' + escapeHtml(q.correct_answer) + '</div></div>';
    html += detailBlock('Explanation', L(q, 'explanation'), '');
    if (q.clinical_pearl) html += detailBlock('💡 Clinical Pearl', L(q, 'clinical_pearl'), 'pearl');
    if (q.source_card_ids && q.source_card_ids.length > 0) {
      html += '<div class="detail-block"><div class="dt-label">Source Cards</div><div class="src-ids">' + q.source_card_ids.map(function (sid) { return '<span class="src-chip">' + escapeHtml(sid) + '</span>'; }).join('') + '</div></div>';
    }
  }
  html += '</div>';
  return html;
}

/* ============================================================
   19. Stats screen
   ============================================================ */
function renderStats() {
  var course = CTX.course;
  var progress = course.progress;
  var stats = computeOverallStats(progress);
  var tab = STATE.statsTab;
  var allItems = course.allCardItems.concat(course.allQuizItems);

  var catMap = {}; course.categories.forEach(function (c) { catMap[c] = { total: 0, correct: 0 }; });
  allItems.forEach(function (it) {
    var rec = progress.items[it.key];
    if (!rec || rec.attempts === 0) return;
    catMap[it.category].total += rec.attempts; catMap[it.category].correct += rec.correct;
  });
  var categoryStats = course.categories.map(function (c) {
    var t = catMap[c].total, co = catMap[c].correct;
    return { category: c, total: t, correct: co, pct: t > 0 ? Math.round((co / t) * 100) : null };
  }).filter(function (c) { return c.total > 0; }).sort(function (a, b) { return (a.pct === null ? 100 : a.pct) - (b.pct === null ? 100 : b.pct); });
  var weakCategories = categoryStats.filter(function (c) { return c.pct !== null && c.pct < 70; }).slice(0, 5);
  var wrongItems = allItems.filter(function (it) { var r = progress.items[it.key]; return r && r.status === 'incorrect'; });

  var tabsHtml =
    '<div class="tabs">' +
      '<button class="tab-btn' + (tab === 'overview' ? ' on' : '') + '" data-action="set-stats-tab" data-value="overview">概要</button>' +
      '<button class="tab-btn' + (tab === 'category' ? ' on' : '') + '" data-action="set-stats-tab" data-value="category">カテゴリ別</button>' +
      '<button class="tab-btn' + (tab === 'wrong' ? ' on' : '') + '" data-action="set-stats-tab" data-value="wrong">誤答一覧</button>' +
    '</div>';

  var body = '';
  if (tab === 'overview') {
    body =
      '<div class="stat-big-grid">' +
        '<div class="stat-big"><div class="n">' + stats.answered + '</div><div class="l">総回答数</div></div>' +
        '<div class="stat-big"><div class="n">' + stats.accuracy + '%</div><div class="l">全体正答率</div></div>' +
        '<div class="stat-big"><div class="n">' + stats.streak + '</div><div class="l">現在の連続正解</div></div>' +
        '<div class="stat-big"><div class="n">' + (progress.totals.maxStreak || 0) + '</div><div class="l">最長連続正解</div></div>' +
        '<div class="stat-big"><div class="n">' + stats.bookmarks + '</div><div class="l">ブックマーク数</div></div>' +
        '<div class="stat-big"><div class="n">' + stats.due + '</div><div class="l">復習期限超過</div></div>' +
      '</div>' +
      '<div class="panel"><h3>最終学習日時</h3><p class="sub" style="margin-bottom:0;">' + escapeHtml(fmtDate(progress.totals.lastStudyAt)) + '</p></div>' +
      (weakCategories.length > 0 ? '<div class="panel"><h3>苦手カテゴリ（正答率70%未満）</h3><div>' + weakCategories.map(function (c) { return '<span class="weak-badge">⚠ ' + escapeHtml(c.category) + ' ' + c.pct + '%</span>'; }).join('') + '</div></div>' : '') +
      '<button class="btn btn-ghost btn-block" data-action="reset-progress">この教材の学習履歴をリセット</button>';
  } else if (tab === 'category') {
    body = '<div class="panel"><h3>カテゴリ別正答率</h3><p class="sub">回答実績があるカテゴリのみ表示（正答率の低い順）</p>' +
      (categoryStats.length === 0 ? '<p class="sub">まだ回答記録がありません。</p>' :
        categoryStats.map(function (c) {
          var color = c.pct >= 80 ? 'var(--good)' : c.pct >= 50 ? 'var(--accent)' : 'var(--bad)';
          return '<div class="cat-row"><div class="cn">' + escapeHtml(c.category) + '</div><div class="cat-bar-track"><div class="cat-bar-fill" style="width:' + c.pct + '%;background:' + color + ';"></div></div><div class="cp">' + c.pct + '%</div></div>';
        }).join('')) + '</div>';
  } else if (tab === 'wrong') {
    if (wrongItems.length === 0) {
      body = '<div class="empty-state"><div class="ei">🎉</div><h3>誤答問題はありません</h3><p>現在「不正解」ステータスの問題はありません。素晴らしいです。</p></div>';
    } else {
      body = wrongItems.map(function (it) {
        var typeLabel = it.kind === 'card' ? '一問一答' : QUIZ_TYPE_LABEL[it.qtype];
        return '<div class="wrong-list-item"><div class="wtxt">' + escapeHtml(L(it.data, 'question')) + '</div><div class="wcat">' + escapeHtml(it.category) + ' ・ ' + typeLabel + ' ・ ' + escapeHtml(it.id) + '</div></div>';
      }).join('');
    }
  }

  return (
    '<button class="back-link" data-action="go-course-home">← 戻る</button>' +
    '<div class="hero" style="margin-bottom:18px;"><div class="eyebrow">Learning Stats · ' + escapeHtml(course.meta.shortTitle || course.meta.title) + '</div><h1 style="font-size:22px;">学習履歴</h1></div>' +
    tabsHtml + body
  );
}

/* ============================================================
   20. Master render
   ============================================================ */
function render() {
  document.documentElement.setAttribute('data-theme', STATE.theme);
  document.documentElement.setAttribute('data-lang', STATE.lang);
  var root = document.getElementById('root');
  var body;
  if (STATE.screen === 'loading') body = '<div class="loading-state"><div class="loading-spinner"></div><p>読み込み中...</p></div>';
  else if (STATE.screen === 'courses') body = renderCoursePicker();
  else if (STATE.screen === 'course-home') body = renderCourseHome();
  else if (STATE.screen === 'learn') body = renderLearnDashboard();
  else if (STATE.screen === 'chapter-intro') body = renderChapterIntro();
  else if (STATE.screen === 'setup') body = renderModeSetup();
  else if (STATE.screen === 'session') body = renderSession();
  else if (STATE.screen === 'stats') body = renderStats();
  else body = renderCoursePicker();

  root.innerHTML = '<div class="app-shell">' + renderTopBar() + '<div class="main">' + body + '</div>' +
    '<input type="file" id="import-file-input" accept="application/json,.json" style="display:none;" />' +
    '</div>';

  var fbInput = document.getElementById('fb-input-live');
  if (fbInput) {
    fbInput.addEventListener('input', function () {
      STATE.session.fbDraft = fbInput.value;
      var btn = document.getElementById('fb-submit-btn');
      if (btn) btn.disabled = !fbInput.value.trim();
    });
    fbInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitFillBlank(); } });
    fbInput.focus();
  }

  var importInput = document.getElementById('import-file-input');
  if (importInput) {
    importInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) importProgressFile(file);
      importInput.value = '';
    });
  }
}

/* ============================================================
   21. Session action handlers
   ============================================================ */
function requeueWrong(key) { var s = STATE.session; var insertAt = Math.min(s.queue.length, s.index + 4); s.queue.splice(insertAt, 0, key); }
function commitAnswer(isCorrect, userAnswer) {
  var s = STATE.session;
  var currentKey = s.queue[s.index];
  recordAnswer(currentKey, isCorrect);
  s.answeredMap[s.index] = { isCorrect: isCorrect, userAnswer: userAnswer };
  s.sessionAnswered += 1;
  if (isCorrect) s.sessionCorrect += 1;
  else if (!s.isChapter) requeueWrong(currentKey);
}
function revealCard() { STATE.session.cardRevealed = true; render(); }
function gradeCard(good) { commitAnswer(good, null); render(); }
function answerMC(idx) {
  var s = STATE.session; var item = CTX.course.itemIndex[s.queue[s.index]];
  if (s.answeredMap[s.index]) return;
  commitAnswer(idx === item.data.correct_answer, idx); render();
}
function answerTF(val) {
  var s = STATE.session; var item = CTX.course.itemIndex[s.queue[s.index]];
  if (s.answeredMap[s.index]) return;
  commitAnswer(val === item.data.correct_answer, val); render();
}
function submitFillBlank() {
  var s = STATE.session;
  if (s.answeredMap[s.index]) return;
  var draft = s.fbDraft || '';
  if (!draft.trim()) return;
  var item = CTX.course.itemIndex[s.queue[s.index]];
  commitAnswer(checkFillBlank(draft, item.data), draft);
  render();
}
function sessionNext() {
  var s = STATE.session;
  if (s.isChapter && s.chapterPhase === 'cards' && s.index >= s.queue.length - 1) { beginChapterQuiz(); return; }
  s.index += 1; s.cardRevealed = false; s.fbDraft = ''; render();
}
function sessionPrev() { var s = STATE.session; if (s.index > 0) { s.index -= 1; s.cardRevealed = false; s.fbDraft = ''; render(); } }

/* ============================================================
   22. Event delegation
   ============================================================ */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.getAttribute('data-action');

  switch (action) {
    case 'go-courses': goCourses(); break;
    case 'go-course-home': goCourseHome(); break;
    case 'go-stats': goStats(); break;
    case 'go-learn': goLearn(); break;
    case 'toggle-theme': STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark'; saveTheme(STATE.theme); render(); break;
    case 'toggle-lang': STATE.lang = STATE.lang === 'en' ? 'ja' : 'en'; saveLang(STATE.lang); render(); break;
    case 'open-course': openCourse(el.getAttribute('data-course')); break;
    case 'retry-registry': bootRegistry(); break;
    case 'select-mode': goSetup(el.getAttribute('data-mode')); break;

    case 'open-chapter': goChapterIntro(el.getAttribute('data-chapter')); break;
    case 'start-chapter': startChapterCards(el.getAttribute('data-chapter')); break;
    case 'retry-chapter-quiz': beginChapterQuiz(); break;
    case 'chapter-result-next': {
      var chId = el.getAttribute('data-chapter');
      var idx = CTX.course.chapterOrder.indexOf(chId);
      var nextId = (idx !== -1 && idx < CTX.course.allChapters.length - 1) ? CTX.course.allChapters[idx + 1] : null;
      if (nextId) goChapterIntro(nextId); else goLearn();
      break;
    }

    case 'toggle-category': toggleFilterValue(STATE.setup.categories, el.getAttribute('data-value')); render(); break;
    case 'toggle-importance': toggleFilterValue(STATE.setup.importance, Number(el.getAttribute('data-value'))); render(); break;
    case 'toggle-difficulty': toggleFilterValue(STATE.setup.difficulty, Number(el.getAttribute('data-value'))); render(); break;
    case 'toggle-qtype': toggleFilterValue(STATE.setup.qtypes, el.getAttribute('data-value')); render(); break;
    case 'set-status': STATE.setup.status = el.getAttribute('data-value'); render(); break;
    case 'set-order': STATE.setup.order = el.getAttribute('data-value'); render(); break;
    case 'start-session': startSessionFromSetup(); break;

    case 'toggle-bookmark': toggleBookmark(el.getAttribute('data-key')); render(); break;
    case 'reveal-card': revealCard(); break;
    case 'grade-card': gradeCard(el.getAttribute('data-value') === 'good'); break;
    case 'answer-mc': answerMC(Number(el.getAttribute('data-idx'))); break;
    case 'answer-tf': answerTF(el.getAttribute('data-value') === 'true'); break;
    case 'answer-fb': submitFillBlank(); break;
    case 'session-next': sessionNext(); break;
    case 'session-prev': sessionPrev(); break;
    case 'reset-progress': resetProgress(); break;
    case 'set-stats-tab': STATE.statsTab = el.getAttribute('data-value'); render(); break;

    case 'export-progress': exportAllProgress(); break;
    case 'import-progress': {
      var input = document.getElementById('import-file-input');
      if (input) input.click();
      break;
    }
    default: break;
  }
});
function toggleFilterValue(arr, val) { var idx = arr.indexOf(val); if (idx === -1) arr.push(val); else arr.splice(idx, 1); }
function startSessionFromSetup() {
  var setup = STATE.setup;
  var filters = { categories: setup.categories, importance: setup.importance, difficulty: setup.difficulty, qtypes: setup.qtypes, status: setup.status };
  var matched = itemsForMode(setup.mode, CTX.course.progress, filters);
  if (matched.length === 0) return;
  var queue;
  if (setup.order === 'shuffle') queue = shuffle(matched);
  else if (setup.order === 'sequential') queue = matched.slice(); // 教材順 (JSON順) — no reordering
  else queue = sortForReview(matched, CTX.course.progress);
  goSession(setup.mode, queue.map(function (it) { return it.key; }));
}
function refreshRegistryProgress() { /* progress bars are recomputed from localStorage on every render, nothing to prefetch */ }

/* ============================================================
   23. Service worker registration (PWA)
   ============================================================ */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(BASE_URL + 'service-worker.js').catch(function (e) {
        console.warn('Service worker registration failed:', e);
      });
    });
  }
}

/* ============================================================
   24. Boot
   ============================================================ */
function bootRegistry() {
  STATE.screen = 'loading'; STATE.loadError = null; render();
  loadCourseRegistry().then(function (list) {
    CTX.registry = list;
    STATE.screen = 'courses';
    render();
  }).catch(function (e) {
    STATE.loadError = (e && e.message) ? e.message : String(e);
    STATE.screen = 'courses';
    render();
  });
}
function boot() {
  if (!storageAvailable) console.warn('localStorage is not available in this context. Progress will not persist between reloads.');
  registerServiceWorker();
  bootRegistry();
}
try { boot(); } catch (e) { showFatalError('アプリの起動に失敗しました', (e && e.stack) ? e.stack : e); }
