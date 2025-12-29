const $ = (id) => document.getElementById(id);

const els = {
  setup: $("setup"),
  quiz: $("quiz"),
  result: $("result"),

  userName: $("userName"),
  saveUserBtn: $("saveUserBtn"),

  level: $("level"),
  mode: $("mode"),

  startBtn: $("startBtn"),
  reviewBtn: $("reviewBtn"),
  resetBtn: $("resetBtn"),

  totalOk: $("totalOk"),
  totalAns: $("totalAns"),
  acc: $("acc"),
  missCnt: $("missCnt"),
  streak: $("streak"),
  badge: $("badge"),

  progress: $("progress"),
  qTypePill: $("qTypePill"),
  qText: $("qText"),

  choices: $("choices"),

  typing: $("typing"),
  typeInput: $("typeInput"),
  checkBtn: $("checkBtn"),

  feedback: $("feedback"),
  nextBtn: $("nextBtn"),
  quitBtn: $("quitBtn"),

  resultText: $("resultText"),
  backBtn: $("backBtn"),
  retryMissBtn: $("retryMissBtn"),
  missList: $("missList")
};

const LS_KEY = "vocabTrainer_users_v2";
const QUIZ_TOTAL = 10;
const MCQ_COUNT = 8;
const TYPE_COUNT = 2;

let DATA = null;
let currentUser = null; // string
let users = loadUsers();
let currentQuiz = null;

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveUsers() {
  localStorage.setItem(LS_KEY, JSON.stringify(users));
}

function ensureUser(name) {
  if (!users[name]) {
    users[name] = {
      totalAns: 0,
      totalOk: 0,
      miss: {}, // key=enLower -> {en, ja, missCount, lastMissAt}
      lastStudyDate: null,
      streak: 0
    };
    saveUsers();
  }
}

function getUser() {
  return users[currentUser];
}

function normalizeEn(s) {
  return (s ?? "").trim().toLowerCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickN(arr, n) {
  return shuffle(arr).slice(0, Math.min(n, arr.length));
}

function show(section) {
  els.setup.classList.add("hidden");
  els.quiz.classList.add("hidden");
  els.result.classList.add("hidden");
  section.classList.remove("hidden");
}

async function loadData() {
  const res = await fetch("./words.json", { cache: "no-store" });
  DATA = await res.json();

  // difficulty select
  els.level.innerHTML = "";
  for (const lv of DATA.levels) {
    const opt = document.createElement("option");
    opt.value = lv.id;
    opt.textContent = lv.name;
    els.level.appendChild(opt);
  }
}

function getSelectedLevel() {
  const id = els.level.value;
  return DATA.levels.find(l => l.id === id);
}

function updateMotivationUI() {
  if (!currentUser) {
    els.totalAns.textContent = "0";
    els.totalOk.textContent = "0";
    els.acc.textContent = "0%";
    els.missCnt.textContent = "0";
    els.streak.textContent = "0";
    els.badge.textContent = "-";
    return;
  }

  const u = getUser();
  els.totalAns.textContent = String(u.totalAns);
  els.totalOk.textContent = String(u.totalOk);
  els.missCnt.textContent = String(Object.keys(u.miss).length);

  const acc = u.totalAns === 0 ? 0 : Math.round((u.totalOk / u.totalAns) * 100);
  els.acc.textContent = `${acc}%`;

  els.streak.textContent = String(u.streak);

  // バッジ：累計正解数ベース（例）
  const ok = u.totalOk;
  let b = "はじめの一歩";
  if (ok >= 50) b = "継続の達人";
  if (ok >= 150) b = "単語マスター";
  if (ok >= 300) b = "中1〜中2制覇（1セット級）";
  if (ok >= 600) b = "語彙の覇者";
  els.badge.textContent = b;
}

function setUserFromInput() {
  const name = els.userName.value.trim();
  if (!name) {
    alert("ユーザ名を入力してください。");
    return false;
  }
  currentUser = name;
  ensureUser(currentUser);
  users._lastUser = currentUser;
  saveUsers();
  updateMotivationUI();
  return true;
}

function loadLastUser() {
  const last = users._lastUser;
  if (last && typeof last === "string") {
    els.userName.value = last;
    currentUser = last;
    ensureUser(currentUser);
  }
  updateMotivationUI();
}

function updateStreakIfNeeded() {
  const u = getUser();
  const t = todayKey();
  if (!u.lastStudyDate) {
    u.lastStudyDate = t;
    u.streak = 1;
    return;
  }
  if (u.lastStudyDate === t) return;

  // 昨日かどうか判定
  const last = new Date(u.lastStudyDate + "T00:00:00");
  const now = new Date(t + "T00:00:00");
  const diffDays = Math.round((now - last) / (1000 * 60 * 60 * 24));

  if (diffDays === 1) u.streak += 1;
  else u.streak = 1;

  u.lastStudyDate = t;
}

function makeMCQ(word, mode, allWords) {
  const prompt = (mode === "en_to_ja") ? word.en : word.ja;
  const answer = (mode === "en_to_ja") ? word.ja : word.en;

  const pool = allWords.filter(w => ((mode === "en_to_ja") ? w.ja : w.en) !== answer);
  const dummies = pickN(pool, 3).map(w => (mode === "en_to_ja") ? w.ja : w.en);
  const choices = shuffle([answer, ...dummies]);

  return { type: "mcq", prompt, answer, choices, word };
}

// 入力は「日本語→英語（スペル）」に固定
function makeTyping(word) {
  return { type: "type", prompt: word.ja, answer: word.en, word };
}

function buildQuiz(words, mode, forceFromMiss = false) {
  // 10問 = 8 MCQ + 2 Typing
  // Typing用は必ず「日本語→英語」なので、wordsから2語選ぶ
  const pickedForTyping = pickN(words, TYPE_COUNT);
  const remainingPool = words.filter(w => !pickedForTyping.includes(w));

  const pickedForMCQ = pickN(remainingPool.length ? remainingPool : words, MCQ_COUNT);

  const qs = [
    ...pickedForMCQ.map(w => makeMCQ(w, mode, words)),
    ...pickedForTyping.map(w => makeTyping(w))
  ];

  return {
    idx: 0,
    questions: shuffle(qs),
    correct: 0,
    wrongList: [], // {en, ja}
    fromMiss: forceFromMiss
  };
}

function renderQuestion() {
  const qz = currentQuiz;
  const q = qz.questions[qz.idx];

  els.progress.textContent = `${qz.idx + 1} / ${QUIZ_TOTAL}`;
  els.feedback.textContent = "";
  els.nextBtn.disabled = true;

  // reset views
  els.choices.innerHTML = "";
  els.typing.classList.add("hidden");
  els.choices.classList.remove("hidden");

  if (q.type === "mcq") {
    els.qTypePill.textContent = "4択";
    els.qText.textContent = q.prompt;

    q.choices.forEach(choice => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = choice;
      btn.onclick = () => onAnswerMCQ(choice, btn);
      els.choices.appendChild(btn);
    });
  } else {
    els.qTypePill.textContent = "入力";
    els.qText.textContent = `「${q.prompt}」を英語で入力`;
    els.choices.classList.add("hidden");
    els.typing.classList.remove("hidden");

    els.typeInput.value = "";
    els.typeInput.focus();
  }
}

function markMiss(word) {
  const u = getUser();
  const key = normalizeEn(word.en);
  const prev = u.miss[key];
  u.miss[key] = {
    en: word.en,
    ja: word.ja,
    missCount: (prev?.missCount ?? 0) + 1,
    lastMissAt: Date.now()
  };
}

function unmarkMiss(word) {
  const u = getUser();
  const key = normalizeEn(word.en);
  if (u.miss[key]) delete u.miss[key];
}

function commitAnswer(isCorrect, word, correctAnswerText) {
  const u = getUser();
  u.totalAns += 1;

  if (isCorrect) {
    u.totalOk += 1;
    currentQuiz.correct += 1;
    unmarkMiss(word);
    els.feedback.textContent = "正解！";
  } else {
    markMiss(word);
    els.feedback.textContent = `不正解。正解：${correctAnswerText}`;
    currentQuiz.wrongList.push({ en: word.en, ja: word.ja });
  }

  updateStreakIfNeeded();
  saveUsers();
  updateMotivationUI();
  els.nextBtn.disabled = false;
}

function onAnswerMCQ(choice, btnEl) {
  const q = currentQuiz.questions[currentQuiz.idx];

  // disable all
  [...els.choices.querySelectorAll(".choice")].forEach(b => b.disabled = true);

  const isCorrect = choice === q.answer;
  if (isCorrect) {
    btnEl.classList.add("correct");
  } else {
    btnEl.classList.add("wrong");
    [...els.choices.querySelectorAll(".choice")].forEach(b => {
      if (b.textContent === q.answer) b.classList.add("correct");
    });
  }

  commitAnswer(isCorrect, q.word, q.answer);
}

function onAnswerTyping() {
  const q = currentQuiz.questions[currentQuiz.idx];
  const input = normalizeEn(els.typeInput.value);
  const ans = normalizeEn(q.answer);

  // ちょい救済：前後空白、大小は無視
  const isCorrect = input === ans;

  if (isCorrect) {
    commitAnswer(true, q.word, q.answer);
  } else {
    commitAnswer(false, q.word, q.answer);
  }
}

function finishQuiz() {
  const total = QUIZ_TOTAL;
  const wrong = total - currentQuiz.correct;

  els.resultText.textContent = `正解 ${currentQuiz.correct} / ${total}（ミス ${wrong}）`;
  els.missList.innerHTML = "";

  const uniq = new Map();
  for (const w of currentQuiz.wrongList) uniq.set(w.en, w);

  if (uniq.size === 0) {
    const li = document.createElement("li");
    li.textContent = "ミスはありませんでした。";
    els.missList.appendChild(li);
  } else {
    for (const w of uniq.values()) {
      const li = document.createElement("li");
      li.textContent = `${w.en} — ${w.ja}`;
      els.missList.appendChild(li);
    }
  }

  show(els.result);
}

function startNormalQuiz() {
  if (!setUserFromInput()) return;

  const lv = getSelectedLevel();
  const mode = els.mode.value;

  if (!lv || !lv.words || lv.words.length < 8) {
    alert("単語数が少なすぎます。words.json の words を増やしてください。");
    return;
  }

  currentQuiz = buildQuiz(lv.words, mode, false);
  show(els.quiz);
  renderQuestion();
}

function startMissQuiz() {
  if (!setUserFromInput()) return;

  const u = getUser();
  const missWords = Object.values(u.miss)
    .sort((a, b) => (b.missCount - a.missCount) || (b.lastMissAt - a.lastMissAt))
    .map(x => ({ en: x.en, ja: x.ja }));

  if (missWords.length === 0) {
    alert("ミス単語がありません。まず通常テストを解いてください。");
    return;
  }

  const mode = els.mode.value;
  currentQuiz = buildQuiz(missWords, mode, true);
  show(els.quiz);
  renderQuestion();
}

els.startBtn.onclick = startNormalQuiz;
els.reviewBtn.onclick = startMissQuiz;

els.nextBtn.onclick = () => {
  currentQuiz.idx += 1;
  if (currentQuiz.idx >= currentQuiz.questions.length) finishQuiz();
  else renderQuestion();
};

els.quitBtn.onclick = () => {
  if (confirm("終了してトップに戻りますか？")) show(els.setup);
};

els.backBtn.onclick = () => show(els.setup);
els.retryMissBtn.onclick = () => startMissQuiz();

els.checkBtn.onclick = onAnswerTyping;
els.typeInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onAnswerTyping();
});

els.saveUserBtn.onclick = () => {
  if (setUserFromInput()) alert("ユーザを保存しました。");
};

els.resetBtn.onclick = () => {
  if (!setUserFromInput()) return;
  if (!confirm(`ユーザ「${currentUser}」の記録をリセットしますか？`)) return;

  users[currentUser] = {
    totalAns: 0,
    totalOk: 0,
    miss: {},
    lastStudyDate: null,
    streak: 0
  };
  saveUsers();
  updateMotivationUI();
  alert("リセットしました。");
};

(async function init() {
  await loadData();
  loadLastUser();
  show(els.setup);
})();
