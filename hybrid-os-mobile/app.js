document.addEventListener('DOMContentLoaded', () => {
  initPWAInstall();
  initNavigation();
  initReadinessAndWeeklyGrid();
  initNotionTaskDatabase();
  initWeeklyChecklist();
  initLongTermGoals();
  initModalsAndTimer();
  initModalBackButton();
  initBackup();
});

/* -------------------------------------------------------------
 * HELPERS: safe HTML, safe storage, toast
 * (declared before any state below because the state is loaded at script start)
 * ------------------------------------------------------------- */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// Everything the user types is escaped before it goes into innerHTML, so a "<" in a task title
// (or in an imported backup file) can never break the page.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const TASK_CATEGORIES = ['work', 'training', 'dance', 'personal'];
const clip = (v, max) => String(v ?? '').slice(0, max);

function uniqueIds(items) {
  const seen = new Set();
  return items.map((item, i) => {
    // ids end up in data-id="..." and come back through parseInt, so only plain safe integers are kept
    const n = Math.trunc(Number(item.id));
    let id = Number.isSafeInteger(n) ? n : Date.now() + i;
    while (seen.has(id)) id++;
    seen.add(id);
    return { ...item, id };
  });
}

function sanitizeTasks(arr) {
  if (!Array.isArray(arr)) return [];
  return uniqueIds(arr.slice(0, 500).filter((t) => t && String(t.title ?? '').trim()).map((t) => ({
    id: t.id,
    title: clip(t.title, 200).trim(),
    duration: clip(t.duration, 20).trim(),
    done: !!t.done,
    category: TASK_CATEGORIES.includes(t.category) ? t.category : 'personal'
  })));
}

function sanitizeChecklist(arr) {
  if (!Array.isArray(arr)) return [];
  return uniqueIds(arr.slice(0, 200).filter((i) => i && String(i.text ?? '').trim()).map((i) => ({
    id: i.id,
    text: clip(i.text, 200).trim(),
    done: !!i.done
  })));
}

function sanitizeGoals(arr) {
  if (!Array.isArray(arr)) return [];
  return uniqueIds(arr.slice(0, 100).filter((g) => g && String(g.title ?? '').trim()).map((g) => ({
    id: g.id,
    timeframe: clip(g.timeframe || 'GOAL', 40).trim(),
    title: clip(g.title, 100).trim(),
    desc: clip(g.desc, 240).trim(),
    progress: Math.min(100, Math.max(0, Math.round(Number(g.progress) || 0)))
  })));
}

// Reads a list from localStorage. Missing or corrupt data falls back to the defaults instead of
// crashing the whole app; an empty list you saved on purpose stays empty.
function loadStored(key, sanitizer, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return sanitizer(raw === null ? fallback : JSON.parse(raw));
  } catch (e) {
    return sanitizer(fallback);
  }
}

function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* -------------------------------------------------------------
 * 0. PWA INSTALL & SERVICE WORKER HANDLER
 * ------------------------------------------------------------- */
function initPWAInstall() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Ask the browser not to evict this app's data when the phone runs low on storage
  // (Chrome normally grants this automatically once the app is installed)
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  let deferredPrompt = null;
  const installBtn = document.getElementById('pwa-install-btn');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  if (isStandalone) {
    if (installBtn) installBtn.style.display = 'none';
    return;
  }

  // Show install button by default in web browser mode
  if (installBtn) {
    installBtn.style.display = 'inline-flex';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // Once installed (from the button or Chrome's own menu), the button is no longer needed
  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.style.display = 'none';
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        if (choiceResult.outcome === 'accepted') {
          installBtn.style.display = 'none';
        }
        deferredPrompt = null;
      } else {
        alert("📱 Mobile Installation Instructions:\n\n• On Android (Chrome): Tap the 3 dots menu at top right ➔ Tap 'Add to Home screen' or 'Install app'.\n\n• On iPhone (Safari): Tap the Share button [↑] at bottom ➔ Tap 'Add to Home Screen'.");
      }
    });
  }
}

/* -------------------------------------------------------------
 * 1. STRICT 2-PAGE NAVIGATION
 * ------------------------------------------------------------- */
function initNavigation() {
  const tabBtns = document.querySelectorAll('.nav-tab-btn');
  const pages = document.querySelectorAll('.page-view');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPageId = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove('active'));
      pages.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPage = document.getElementById(targetPageId);
      if (targetPage) targetPage.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/* -------------------------------------------------------------
 * 2. READINESS ENGINE & WEEKLY SCHEDULE
 * ------------------------------------------------------------- */
const defaultWeeklySchedule = [
  {
    day: "MON",
    sub: "NEURAL & CLIMB",
    workouts: [
      {
        id: "mon-1",
        title: "Overcoming Isometrics",
        time: "Morning • 30 Mins",
        sport: "climb",
        sportLabel: "CLIMBING & NEURAL",
        summary: "3x5s Max effort locks + 7s Crimp hangs",
        instructions: [
          "Immovable Bar Lockout (90°): 4 sets x 5-sec 100% max force pull against immovable strap/bar (Rest 2.5 mins).",
          "Hangboard Half-Crimp ISO: 5 sets x 7-sec hold on 20mm edge (RPE 8, rest 2 mins).",
          "Rule: Zero muscle pump or failure. Stop immediately if grip speed drops."
        ],
        timerPresetIndex: 0
      },
      {
        id: "mon-2",
        title: "Bouldering Projecting",
        time: "Lunch • 45 Mins",
        sport: "climb",
        sportLabel: "ROCK CLIMBING",
        summary: "Hard technical bouldering burns",
        instructions: [
          "10 Mins Warmup: Easy wall traverses, arm circles, light wrist rolls.",
          "35 Mins Projecting: Max 4-5 attempts on limit boulder problems.",
          "Mandatory Rest: Rest full 3 minutes between every single burn to keep CNS fresh.",
          "Stop criteria: Stop session when finger contact strength drops 10%."
        ]
      }
    ]
  },
  {
    day: "TUE",
    sub: "Z2 CARDIO & COMBAT",
    workouts: [
      {
        id: "tue-1",
        title: "Zone 2 Run (Triathlon)",
        time: "Morning • 30 Mins",
        sport: "triathlon",
        sportLabel: "TRIATHLON (RUN)",
        summary: "Nasal breathing easy pace run",
        instructions: [
          "Keep breathing strictly through your nose (Zone 2 aerobic threshold).",
          "Post-Run: 3 sets x 30-sec single-leg isometric calf holds (Achilles tendon stiffener)."
        ]
      },
      {
        id: "tue-2",
        title: "Solo Muay Thai Micro-Flow",
        time: "Afternoon • 25 Mins",
        sport: "combat",
        sportLabel: "MUAY THAI & KICKBOXING",
        summary: "5 Rounds x 3 Mins (60s Rest between rounds)",
        instructions: [
          "Format: 5 Rounds x 3 Minutes work with EXACTLY 60 SECONDS REST between rounds.",
          "Rest interval rule: Stand relaxed, shake out arms/legs, deep nasal breathing for 60 seconds.",
          "Round 1-2: Shadowboxing fast jab-cross-hook combinations + footwork slips.",
          "Round 3-4: Heavy bag lead Teep & low kick snaps (focus on kinetic rotation).",
          "Round 5: High speed 100-punch shadowboxing burn (relaxed hands).",
          "Solo Defense Tip: Use a Slip Bag or hanging tennis ball to practice slipping jabs!"
        ],
        timerPresetIndex: 3
      },
      {
        id: "tue-3",
        title: "Bachata Social Night",
        time: "Evening • 2 Hours",
        sport: "dance",
        sportLabel: "BACHATA DANCE & FLOW",
        summary: "Active recovery & dynamic balance",
        instructions: [
          "Enjoy social dancing as fluid active recovery for mind & body.",
          "Helps unwind tight hips from cycling and running!",
          "Pre-dance: Eat a light complex-carb meal for steady energy."
        ]
      }
    ]
  },
  {
    day: "WED",
    sub: "CALISTHENICS & SWIM",
    workouts: [
      {
        id: "wed-1",
        title: "Calisthenics Static Holds",
        time: "Morning • 30 Mins",
        sport: "calisthenics",
        sportLabel: "CALISTHENICS STATIC",
        summary: "Front Lever tuck & Planche leans",
        instructions: [
          "Front Lever Tuck Hold: 4 sets x 8-sec hold (Rest 2 mins). Stop RIR 2.",
          "Planche Lean / Wall ISO: 4 sets x 8-sec hold (Rest 2 mins).",
          "L-Sit / V-Sit Hold: 3 sets x 12-sec hold (Rest 90s)."
        ],
        timerPresetIndex: 2
      },
      {
        id: "wed-2",
        title: "Zone 2 Swim (Triathlon)",
        time: "Lunch • 40 Mins",
        sport: "triathlon",
        sportLabel: "TRIATHLON (SWIM)",
        summary: "Smooth freestyle lat flush",
        instructions: [
          "Easy smooth freestyle laps in Zone 2 aerobic pace.",
          "Zero impact on joints. Flushes out lats, forearms, and shoulder girdle."
        ]
      }
    ]
  },
  {
    day: "THU",
    sub: "RECOVERY & BIKE",
    workouts: [
      {
        id: "thu-1",
        title: "Zone 2 Bike Ride",
        time: "Morning • 45 Mins",
        sport: "triathlon",
        sportLabel: "TRIATHLON (BIKE)",
        summary: "Spin 90+ RPM cadence",
        instructions: [
          "High-cadence (90+ RPM) low-gear spinning.",
          "Vascular leg flushing without hypertrophy or quad soreness."
        ]
      },
      {
        id: "thu-2",
        title: "Bachata Social / Rest",
        time: "Evening",
        sport: "dance",
        sportLabel: "BACHATA DANCE",
        summary: "Light movement & active rest",
        instructions: [
          "Light social dancing or soft hip/ankle mobility flow."
        ]
      }
    ]
  },
  {
    day: "FRI",
    sub: "BOULDER & SPEED COMBAT",
    workouts: [
      {
        id: "fri-1",
        title: "Bouldering Density Flow",
        time: "Lunch • 50 Mins",
        sport: "climb",
        sportLabel: "ROCK CLIMBING",
        summary: "Moderate volume climbing flow",
        instructions: [
          "Climb moderate grade problems focusing on foot precision & crimp density.",
          "Rest 2.5 minutes between climbs."
        ]
      },
      {
        id: "fri-2",
        title: "Heavy Bag Kickboxing Flow",
        time: "Afternoon • 20 Mins",
        sport: "combat",
        sportLabel: "KICKBOXING FLOW",
        summary: "4 Rounds x 3 Mins (60s Rest)",
        instructions: [
          "4 Rounds x 3 Mins with 60 SECONDS REST between rounds.",
          "Focus on punch speed, recoil, and lead low kicks."
        ],
        timerPresetIndex: 3
      }
    ]
  },
  {
    day: "SAT",
    sub: "BRICK & ISOMETRICS",
    workouts: [
      {
        id: "sat-1",
        title: "Triathlon Brick (Z2)",
        time: "Morning • 60 Mins",
        sport: "triathlon",
        sportLabel: "TRIATHLON (BIKE + RUN)",
        summary: "40m Easy Bike + 20m Easy Run",
        instructions: [
          "40 Mins Zone 2 Bike transition immediately into 20 Mins Zone 2 Run.",
          "Pure cardiovascular conditioning."
        ]
      },
      {
        id: "sat-2",
        title: "Overcoming Push-up Drive",
        time: "Afternoon • 15 Mins",
        sport: "calisthenics",
        sportLabel: "NEURAL STRENGTH",
        summary: "Static strap push-up 3x5s",
        instructions: [
          "Overcoming Push-up Strap Drive: 3 sets x 5s max effort drive (Rest 2.5 mins)."
        ],
        timerPresetIndex: 0
      }
    ]
  },
  {
    day: "SUN",
    sub: "FULL DELOAD",
    workouts: [
      {
        id: "sun-1",
        title: "Full Body Deload & Walk",
        time: "All Day",
        sport: "dance",
        sportLabel: "ACTIVE REST & RECOVERY",
        summary: "Walking, light Bachata, collagen repair",
        instructions: [
          "Complete systemic rest. Walking, light mobility, and good nutrition for tendon collagen repair."
        ]
      }
    ]
  }
];

let currentDifficultyMode = {
  level: 100,
  badgeText: "100% PEAK INTENSITY",
  guidanceText: "⚡ System operating at 100% capacity. Proceed with full effort on scheduled workouts."
};

// Today's readiness as a "how bad" number per body system (0 fine, 1 a bit, 2 a lot),
// plus the time you have for one session.
//   tendon: Fresh 0, Mild 1, Sore 2   |   cns: Low 1, otherwise 0   |   muscle (DOMS): None 0, Mild 1, Heavy 2
let readinessState = { tendon: 0, cns: 0, muscle: 0, budget: 60 };

// How much each workout taxes each system: 0 = not at all, 0.5 = a little, 1 = fully.
// A workout's score is its worst weighted system: >= 1 -> REDUCE, >= 2 -> SKIP / SWAP.
// (Sore tendons skip finger/neural work; low CNS only trims it; heavy DOMS skips legs/combat, etc.)
const WORKOUT_PROFILE = {
  'mon-1': { load: 'neural',   tendon: 1, cns: 1, muscle: 0 },
  'mon-2': { load: 'finger',   tendon: 1, cns: 1, muscle: 0 },
  'tue-1': { load: 'aerobic',  tendon: 0, cns: 0, muscle: 1, skip: 'Swap for an easy swim or bike' },
  'tue-2': { load: 'combat',   tendon: 0, cns: 1, muscle: 1 },
  'tue-3': { load: 'recovery', tendon: 0, cns: 0, muscle: 0 },
  'wed-1': { load: 'neural',   tendon: 1, cns: 1, muscle: 1 },
  'wed-2': { load: 'aerobic',  tendon: 0, cns: 0, muscle: 0 },
  'thu-1': { load: 'aerobic',  tendon: 0, cns: 0, muscle: 0 },
  'thu-2': { load: 'recovery', tendon: 0, cns: 0, muscle: 0 },
  'fri-1': { load: 'finger',   tendon: 1, cns: 0, muscle: 0 },
  'fri-2': { load: 'combat',   tendon: 0, cns: 1, muscle: 1 },
  'sat-1': { load: 'aerobic',  tendon: 0, cns: 0, muscle: 0.5, reduce: 'Bike only, skip the run' },
  'sat-2': { load: 'neural',   tendon: 1, cns: 1, muscle: 0 },
  'sun-1': { load: 'recovery', tendon: 0, cns: 0, muscle: 0 }
};

const ADVICE = {
  neural:  { reduce: '−1 set, stop at the first speed drop', skip: 'Skip. Easy Z2 swim or bike instead' },
  finger:  { reduce: 'Easier grades, no crimp hangs',        skip: 'Skip. Easy Z2 swim or bike instead' },
  combat:  { reduce: 'Technique only, no power, −1 round',   skip: 'Skip. Mobility or a light Z2 flush' },
  aerobic: { reduce: 'Cut a third, stay easy',               skip: 'Skip. Walk or light mobility' }
};

// "Morning • 30 Mins" -> 30, "Evening • 2 Hours" -> 120, "All Day" -> null
function parseWorkoutMinutes(timeStr) {
  const h = /(\d+(?:\.\d+)?)\s*hours?/i.exec(timeStr || '');
  const m = /(\d+)\s*mins?/i.exec(timeStr || '');
  if (!h && !m) return null;
  return (h ? parseFloat(h[1]) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
}

// Decides what today's readiness means for one workout card.
function assessWorkout(w) {
  const p = WORKOUT_PROFILE[w.id] || { load: 'aerobic', tendon: 0, cns: 0, muscle: 0 };
  const s = readinessState;
  const score = Math.max(p.tendon * s.tendon, p.cns * s.cns, p.muscle * s.muscle);
  const advice = ADVICE[p.load] || {};

  let status = 'full';
  let label = 'Full Effort';
  let note = '';

  if (p.load === 'recovery') {
    label = 'Active Recovery';
  } else if (score >= 2) {
    status = 'skip';
    label = 'Skip / swap';
    note = p.skip || advice.skip || '';
  } else if (score >= 1) {
    status = 'reduce';
    label = 'Reduce';
    note = p.reduce || advice.reduce || '';
  } else if (currentDifficultyMode.level < 100 && p.load === 'aerobic') {
    label = 'Ideal today'; // easy aerobic work is exactly what a tired system should do
  }

  // Time Available caps how long ONE session can be
  const mins = parseWorkoutMinutes(w.time);
  const timeNote = (p.load !== 'recovery' && status !== 'skip' && mins && s.budget < 90 && mins > s.budget)
    ? `Fit to ${s.budget} min`
    : '';

  return { status, label, note, timeNote };
}

function buildReadinessMode(tendonVal, cnsVal, domsVal) {
  if (tendonVal === 3) {
    return {
      level: 50,
      badgeText: "50% TENDON DELOAD MODE",
      guidanceText: "⚠️ Finger/Forearm tendons sore! Skipped crimp hangs & heavy bouldering. Focus on Zone 2 Swim/Bike & Bachata."
    };
  }
  if (domsVal === 3) {
    return {
      level: 50,
      badgeText: "50% MUSCLE DELOAD MODE",
      guidanceText: "⚠️ Muscles heavily sore. Skip running, kickboxing and static holds today. An easy Zone 2 swim or bike flushes them out, then light Bachata or mobility."
    };
  }
  if (cnsVal === 1) {
    return {
      level: 75,
      badgeText: "75% MODERATE ADJUST",
      guidanceText: "🌱 CNS energy low. Reduce sets by 1 and focus on smooth technical flow (Muay Thai bag & light Z2 cardio)."
    };
  }
  if (tendonVal === 2 || domsVal === 2) {
    return {
      level: 90,
      badgeText: "90% LIGHT TRIM",
      guidanceText: "🌤️ Mild soreness. Keep the plan but trim it: −1 set on the affected sessions, hold back to RPE 7, no max efforts."
    };
  }
  return {
    level: 100,
    badgeText: "100% PEAK INTENSITY",
    guidanceText: "⚡ System operating at 100% capacity. Proceed with full effort on scheduled workouts."
  };
}

function initReadinessAndWeeklyGrid() {
  const gridContainer = document.getElementById('weekly-grid');
  const multiplierText = document.getElementById('readiness-multiplier-text');
  const guidanceBanner = document.getElementById('readiness-guidance');
  const dayStrip = document.getElementById('day-strip');
  const readinessBanner = document.getElementById('readiness-banner');
  const readinessToggle = document.getElementById('readiness-toggle');

  // Mon=0 ... Sun=6 (JS getDay() is Sun=0). On phones only the selected day is shown; it starts on today.
  const getTodayIdx = () => (new Date().getDay() + 6) % 7;
  let todayIdx = getTodayIdx();
  let selectedDay = todayIdx;

  // Phones: the 4 readiness controls stay folded away until you tap "Adjust"
  if (readinessToggle && readinessBanner) {
    readinessToggle.addEventListener('click', () => {
      const collapsed = readinessBanner.classList.toggle('collapsed');
      readinessToggle.setAttribute('aria-expanded', String(!collapsed));
      readinessToggle.textContent = collapsed ? 'Adjust' : 'Done';
    });
  }

  if (dayStrip) {
    dayStrip.addEventListener('click', (e) => {
      const pill = e.target.closest('.day-pill');
      if (!pill) return;
      selectedDay = parseInt(pill.dataset.day);
      renderWeeklyGrid();
    });
  }

  // A phone app can stay open in the background for days: re-check "today" when you come back to it
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const t = getTodayIdx();
    if (t !== todayIdx) {
      todayIdx = t;
      selectedDay = t;
      renderWeeklyGrid();
    }
  });

  document.querySelectorAll('.btn-group-selector').forEach(container => {
    const btns = container.querySelectorAll('.select-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        calculateDifficulty();
      });
    });
  });

  const timeSelect = document.getElementById('time-select');
  if (timeSelect) timeSelect.addEventListener('change', calculateDifficulty);

  function calculateDifficulty() {
    const pick = (param) => parseInt(document.querySelector(`[data-param="${param}"] .select-btn.active`).dataset.val);
    const tendonVal = pick('tendons');
    const cnsVal = pick('cns');
    const domsVal = pick('doms');
    const budget = parseInt(timeSelect ? timeSelect.value : '60', 10) || 60;

    readinessState = {
      tendon: tendonVal - 1,
      cns: cnsVal === 1 ? 1 : 0,
      muscle: domsVal - 1,
      budget
    };
    currentDifficultyMode = buildReadinessMode(tendonVal, cnsVal, domsVal);

    // Only mention the time window when it actually shortens something in the week
    let guidance = currentDifficultyMode.guidanceText;
    const capped = budget < 90 && defaultWeeklySchedule.some(d => d.workouts.some(w => {
      const mins = parseWorkoutMinutes(w.time);
      const load = (WORKOUT_PROFILE[w.id] || {}).load;
      return load !== 'recovery' && mins && mins > budget;
    }));
    if (capped) guidance += ` Time window ${budget} min: longer sessions are trimmed to fit.`;

    if (multiplierText) multiplierText.textContent = currentDifficultyMode.badgeText;
    if (guidanceBanner) guidanceBanner.innerHTML = `<span>${guidance}</span>`;

    renderWeeklyGrid();
  }

  function renderWeeklyGrid() {
    if (dayStrip) {
      dayStrip.innerHTML = defaultWeeklySchedule.map((d, i) => `
        <button type="button" role="tab" class="day-pill${i === selectedDay ? ' active' : ''}${i === todayIdx ? ' is-today' : ''}" data-day="${i}" aria-selected="${i === selectedDay}">
          <span>${d.day}</span><i class="dot"></i>
        </button>
      `).join('');
    }

    gridContainer.innerHTML = defaultWeeklySchedule.map((dayObj, i) => `
      <div class="day-column${i === todayIdx ? ' is-today' : ''}${i === selectedDay ? ' selected' : ''}" data-day="${i}">
        <div class="day-head">
          <div class="day-title">${dayObj.day}${i === todayIdx ? '<span class="today-flag">TODAY</span>' : ''}</div>
          <div class="day-sub">${dayObj.sub}</div>
        </div>
        ${dayObj.workouts.map(w => {
          const a = assessWorkout(w);
          return `
          <div class="workout-card${a.status === 'skip' ? ' is-skip' : ''}" data-id="${w.id}">
            <div class="w-type-tag tag-${w.sport}">${w.sportLabel}</div>
            <div class="w-title">${w.title}</div>
            <div class="w-time">${w.time}</div>
            <div class="w-badges">
              <span class="w-diff-badge diff-${a.status}">${a.label}</span>
              ${a.timeNote ? `<span class="w-diff-badge diff-time">${a.timeNote}</span>` : ''}
            </div>
            ${a.note ? `<div class="w-note">${a.note}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `).join('');

    gridContainer.querySelectorAll('.workout-card').forEach(card => {
      card.addEventListener('click', () => {
        const workoutId = card.dataset.id;
        let targetWorkout = null;
        defaultWeeklySchedule.forEach(d => {
          d.workouts.forEach(w => {
            if (w.id === workoutId) targetWorkout = w;
          });
        });

        if (targetWorkout) openWorkoutModal(targetWorkout);
      });
    });
  }

  calculateDifficulty();
}

/* -------------------------------------------------------------
 * 3. NOTION-STYLE DAILY TASK DATABASE TABLE SYSTEM (Kasdienės užduotys)
 * ------------------------------------------------------------- */
const DEFAULT_TASKS = [
  { id: 1, title: "🏃 Zone 2 run (nasal breathing)", duration: "00:30", done: false, category: "training" },
  { id: 2, title: "🧗 Hangboard & isometric session", duration: "00:30", done: false, category: "training" },
  { id: 3, title: "💻 Deep work block", duration: "02:00", done: false, category: "work" },
  { id: 4, title: "📧 Answer emails & messages", duration: "00:30", done: false, category: "work" },
  { id: 5, title: "🛒 Groceries", duration: "00:45", done: false, category: "personal" },
  { id: 6, title: "🧹 Tidy up & laundry", duration: "01:00", done: false, category: "personal" },
  { id: 7, title: "🥊 Shadowboxing & bag rounds", duration: "00:25", done: false, category: "training" },
  { id: 8, title: "💃 Bachata social night", duration: "02:00", done: false, category: "dance" }
];

let notionTasks = loadStored('hybrid_notion_tasks', sanitizeTasks, DEFAULT_TASKS);

function initNotionTaskDatabase() {
  const tableBody = document.getElementById('notion-table-body');
  const summaryPill = document.getElementById('table-summary-pill');
  const selectAll = document.getElementById('toggle-all-chk');

  const inlineTitle = document.getElementById('inline-task-title');
  const inlineDuration = document.getElementById('inline-task-duration');
  const inlineCategory = document.getElementById('inline-task-category');
  const inlineAddBtn = document.getElementById('inline-add-btn');

  const editModal = document.getElementById('edit-task-modal');
  const editForm = document.getElementById('edit-task-form');
  const closeEditModal = document.getElementById('close-edit-task-modal');

  function parseMinutes(durationStr) {
    if (!durationStr) return 0;
    const str = durationStr.toLowerCase().replace('val', '').trim();

    // The edit form promises "09:00 - 10:30" works: that is a 1h30 task (past midnight wraps around)
    const range = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/.exec(str);
    if (range) {
      const from = Number(range[1]) * 60 + Number(range[2]);
      const to = Number(range[3]) * 60 + Number(range[4]);
      return to >= from ? to - from : to + 1440 - from;
    }

    // "45m" / "45 min" = minutes
    const minutes = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins)$/.exec(str);
    if (minutes) return parseFloat(minutes[1]);

    if (str.includes(':')) {
      const parts = str.split(':').map(Number);
      return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : 0;
    }
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num * 60;
  }

  function formatTotalTime(totalMins) {
    const hours = Math.floor(totalMins / 60);
    const mins = Math.round(totalMins % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} val`;
  }

  function saveAndRender() {
    localStorage.setItem('hybrid_notion_tasks', JSON.stringify(notionTasks));
    renderTable();
    renderTimelineGraphic();
  }

  function renderTable() {
    let totalMins = 0;
    let completedCount = 0;

    tableBody.innerHTML = notionTasks.map(t => {
      if (t.done) completedCount++;
      const mins = parseMinutes(t.duration);
      totalMins += mins;

      return `
        <tr class="${t.done ? 'completed-row' : ''}">
          <td class="col-chk">
            <input type="checkbox" class="task-chk" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done">
          </td>
          <td class="col-title task-title-cell">${esc(t.title)}</td>
          <td class="col-duration">${esc(t.duration) || '—'}</td>
          <td class="col-category">
            <span class="task-tag tag-${t.category}">${t.category}</span>
          </td>
          <td class="col-actions">
            <button class="table-action-btn edit-btn" data-id="${t.id}" title="Edit Task" aria-label="Edit task">✏️</button>
            <button class="table-action-btn del-btn" data-id="${t.id}" title="Delete Task" aria-label="Delete task">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');

    if (summaryPill) {
      summaryPill.innerHTML = `<span>Completed: ${completedCount}/${notionTasks.length}</span> • <strong id="total-duration-sum">${formatTotalTime(totalMins)} total</strong>`;
    }

    // The header checkbox mirrors the list: ticked when everything is done, "dash" when only some are
    if (selectAll) {
      const n = notionTasks.length;
      selectAll.disabled = n === 0;
      selectAll.checked = n > 0 && completedCount === n;
      selectAll.indeterminate = completedCount > 0 && completedCount < n;
    }

    tableBody.querySelectorAll('.task-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = parseInt(chk.dataset.id);
        notionTasks = notionTasks.map(t => t.id === id ? { ...t, done: chk.checked } : t);
        saveAndRender();
      });
    });

    tableBody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const task = notionTasks.find(t => t.id === id);
        if (task) openEditModal(task);
      });
    });

    tableBody.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        notionTasks = notionTasks.filter(t => t.id !== id);
        saveAndRender();
      });
    });
  }

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const done = selectAll.checked;
      notionTasks = notionTasks.map(t => ({ ...t, done }));
      saveAndRender();
    });
  }

  function renderTimelineGraphic() {
    const timelineBarEl = document.getElementById('timeline-bar');
    const filledHoursEl = document.getElementById('timeline-filled-hours');
    if (!timelineBarEl) return;

    timelineBarEl.innerHTML = '';
    let accumulatedMins = 480;
    let totalScheduledMins = 0;

    notionTasks.forEach(t => {
      const durationMins = parseMinutes(t.duration) || 45;
      totalScheduledMins += durationMins;

      const leftPercent = (accumulatedMins / 1440) * 100;
      const widthPercent = (durationMins / 1440) * 100;

      const block = document.createElement('div');
      block.className = `timeline-block block-${t.category}`;
      block.style.left = `${leftPercent}%`;
      block.style.width = `${Math.max(0, Math.min(widthPercent, 100 - leftPercent))}%`;
      block.title = `${t.title} (${t.duration || '45m'})`;
      timelineBarEl.appendChild(block);

      accumulatedMins += durationMins + 15;
    });

    const hours = (totalScheduledMins / 60).toFixed(1);
    if (filledHoursEl) filledHoursEl.textContent = `${hours} hrs scheduled`;
  }

  function handleInlineAdd() {
    const title = inlineTitle.value.trim();
    if (!title) return;

    const duration = inlineDuration.value.trim() || "01:00";
    const category = inlineCategory.value;

    notionTasks.push({
      id: Date.now(),
      title,
      duration,
      done: false,
      category
    });

    inlineTitle.value = '';
    inlineDuration.value = '';
    saveAndRender();
  }

  if (inlineAddBtn) inlineAddBtn.addEventListener('click', handleInlineAdd);

  if (inlineTitle) {
    inlineTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleInlineAdd();
    });
  }

  function openEditModal(task) {
    document.getElementById('edit-task-id').value = task.id;
    document.getElementById('edit-task-title').value = task.title;
    document.getElementById('edit-task-duration').value = task.duration || '';
    document.getElementById('edit-task-category').value = task.category;
    editModal.classList.add('open');
  }

  if (closeEditModal) {
    closeEditModal.addEventListener('click', () => editModal.classList.remove('open'));
  }

  if (editForm) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = parseInt(document.getElementById('edit-task-id').value);
      const title = document.getElementById('edit-task-title').value.trim();
      const duration = document.getElementById('edit-task-duration').value.trim();
      const category = document.getElementById('edit-task-category').value;
      if (!title) return;

      notionTasks = notionTasks.map(t => t.id === id ? { ...t, title, duration, category } : t);
      editModal.classList.remove('open');
      saveAndRender();
    });
  }

  saveAndRender();
}

/* -------------------------------------------------------------
 * 4. WEEKLY CHECKLIST (With Delete Functionality)
 * ------------------------------------------------------------- */
const DEFAULT_CHECKLIST = [
  { id: 1, text: "Perform 2x Overcoming ISO Sessions", done: false },
  { id: 2, text: "Log 3x Zone 2 Cardio Sessions (Nasal)", done: true },
  { id: 3, text: "Complete Solo Muay Thai Bag Flow", done: false },
  { id: 4, text: "Bachata Social Dance Night", done: true },
  { id: 5, text: "Refuel collagen & clean protein", done: false }
];

let weeklyChecklist = loadStored('hybrid_weekly_checklist', sanitizeChecklist, DEFAULT_CHECKLIST);

function initWeeklyChecklist() {
  const container = document.getElementById('weekly-checklist');
  const addBtn = document.getElementById('add-weekly-item-btn');

  const sheet = document.getElementById('weekly-item-modal');
  const form = document.getElementById('weekly-item-form');
  const input = document.getElementById('weekly-item-text');
  const closeSheet = document.getElementById('close-weekly-item-modal');

  function saveAndRender() {
    localStorage.setItem('hybrid_weekly_checklist', JSON.stringify(weeklyChecklist));
    
    if (weeklyChecklist.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 8px;">No weekly checklist tasks. Click '+ Add' above.</p>`;
      return;
    }

    container.innerHTML = weeklyChecklist.map(item => `
      <div class="chk-item ${item.done ? 'done' : ''}">
        <div class="chk-toggle" data-id="${item.id}">
          <div class="chk-box">${item.done ? '✓' : ''}</div>
          <div class="chk-text">${esc(item.text)}</div>
        </div>
        <button class="chk-del-btn" data-id="${item.id}" title="Delete Task" aria-label="Delete item">&times;</button>
      </div>
    `).join('');

    container.querySelectorAll('.chk-toggle').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id);
        weeklyChecklist = weeklyChecklist.map(i => i.id === id ? { ...i, done: !i.done } : i);
        saveAndRender();
      });
    });

    container.querySelectorAll('.chk-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        weeklyChecklist = weeklyChecklist.filter(i => i.id !== id);
        saveAndRender();
      });
    });
  }

  // "+ Add" opens a bottom sheet (the old version used the browser's prompt() popup)
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      form.reset();
      sheet.classList.add('open');
    });
  }
  if (closeSheet) closeSheet.addEventListener('click', () => sheet.classList.remove('open'));
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      weeklyChecklist.push({ id: Date.now(), text, done: false });
      sheet.classList.remove('open');
      saveAndRender();
    });
  }

  saveAndRender();
}

/* -------------------------------------------------------------
 * 5. INTERACTIVE LONG-TERM GOALS (Dynamic Progress Bar)
 * ------------------------------------------------------------- */
const DEFAULT_GOALS = [
  { id: 1, timeframe: "IRONMAN READYNESS", title: "Complete Full Ironman Triathlon", desc: "3.8k Swim + 180k Bike + 42.2k Run in Zone 2.", progress: 45 },
  { id: 2, timeframe: "6-MONTH ATHLETIC", title: "Master Front Lever 15s Hold", desc: "Pure neural relative strength without gaining muscle mass.", progress: 70 },
  { id: 3, timeframe: "LIFE & MOVEMENT", title: "Bachata Flow & V7 Boulder", desc: "Balance fluid dance movement with V7 crimp density.", progress: 80 }
];

let longTermGoals = loadStored('hybrid_long_term_goals', sanitizeGoals, DEFAULT_GOALS);

function initLongTermGoals() {
  const gridEl = document.getElementById('goals-grid');
  const addBtn = document.getElementById('add-goal-btn');

  const sheet = document.getElementById('goal-modal');
  const form = document.getElementById('goal-form');
  const closeSheet = document.getElementById('close-goal-modal');

  function saveAndRender() {
    localStorage.setItem('hybrid_long_term_goals', JSON.stringify(longTermGoals));
    gridEl.innerHTML = longTermGoals.map(g => `
      <div class="goal-card" data-id="${g.id}">
        <div>
          <div class="goal-timeframe">${esc(g.timeframe)}</div>
          <div class="goal-title">${esc(g.title)}</div>
          <div class="goal-desc">${esc(g.desc)}</div>
        </div>
        <div class="goal-progress-section">
          <div class="goal-prog-row">
            <span>Progress</span>
            <div class="prog-controls">
              <button class="prog-btn minus-btn" data-id="${g.id}" aria-label="Decrease progress">-</button>
              <span style="font-weight: 800; min-width: 38px; text-align: center;">${g.progress}%</span>
              <button class="prog-btn plus-btn" data-id="${g.id}" aria-label="Increase progress">+</button>
            </div>
          </div>
          <div class="goal-prog-bar"><div class="goal-prog-fill" style="width: ${g.progress}%;"></div></div>
        </div>
      </div>
    `).join('');

    gridEl.querySelectorAll('.minus-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        longTermGoals = longTermGoals.map(g => g.id === id ? { ...g, progress: Math.max(0, g.progress - 10) } : g);
        saveAndRender();
      });
    });

    gridEl.querySelectorAll('.plus-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        longTermGoals = longTermGoals.map(g => g.id === id ? { ...g, progress: Math.min(100, g.progress + 10) } : g);
        saveAndRender();
      });
    });
  }

  // "+ New Goal" opens a bottom sheet (the old version chained three prompt() popups)
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      form.reset();
      sheet.classList.add('open');
    });
  }
  if (closeSheet) closeSheet.addEventListener('click', () => sheet.classList.remove('open'));
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('goal-title').value.trim();
      if (!title) return;
      longTermGoals.push({
        id: Date.now(),
        timeframe: document.getElementById('goal-timeframe').value.trim() || "GOAL",
        title,
        desc: document.getElementById('goal-desc').value.trim(),
        progress: 25
      });
      sheet.classList.remove('open');
      saveAndRender();
    });
  }

  saveAndRender();
}

/* -------------------------------------------------------------
 * 6. MODALS & ISOMETRIC TIMER
 * ------------------------------------------------------------- */
function openWorkoutModal(w) {
  const modal = document.getElementById('workout-modal');
  document.getElementById('modal-workout-title').textContent = w.title;
  document.getElementById('modal-workout-time').textContent = w.time;
  document.getElementById('modal-sport-tag').textContent = w.sportLabel;

  // Today's readiness verdict for this workout, shown above the instructions when it changes anything
  const a = assessWorkout(w);
  const adviceHtml = (a.status !== 'full' || a.timeNote) ? `
    <div class="modal-advice diff-${a.status === 'full' ? 'time' : a.status}">
      ${a.status !== 'full' ? `<strong>${a.label}</strong>${a.note ? ': ' + a.note : ''}` : ''}
      ${a.timeNote ? `<div>${a.timeNote}: do the key work first, then stop.</div>` : ''}
    </div>` : '';

  document.getElementById('modal-workout-body').innerHTML = `
    ${adviceHtml}
    <p style="margin-bottom: 12px; font-weight: 800; color: #fff;">${w.summary}</p>
    <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px;">
      ${w.instructions.map(inst => `<li style="padding-left: 18px; position: relative;"><span style="position: absolute; left: 0; color: var(--emerald-primary);">⚡</span>${inst}</li>`).join('')}
    </ul>
  `;

  const timerBtn = document.getElementById('modal-launch-timer-btn');
  timerBtn.style.display = (w.timerPresetIndex !== undefined) ? 'inline-flex' : 'none';
  timerBtn.onclick = () => {
    modal.classList.remove('open');
    openTimerModal(w.timerPresetIndex);
  };

  modal.classList.add('open');
}

function openTimerModal(presetIndex = 0) {
  const modal = document.getElementById('timer-modal');
  modal.classList.add('open');
  const presets = document.querySelectorAll('.btn-preset');
  if (presets[presetIndex]) presets[presetIndex].click();
}

function initModalsAndTimer() {
  const workoutModal = document.getElementById('workout-modal');
  const timerModal = document.getElementById('timer-modal');
  const protocolsModal = document.getElementById('protocols-modal');

  document.getElementById('close-workout-modal').onclick = () => workoutModal.classList.remove('open');
  document.getElementById('close-workout-modal-2').onclick = () => workoutModal.classList.remove('open');

  document.getElementById('open-timer-btn').onclick = () => openTimerModal(0);
  document.getElementById('close-timer-modal').onclick = () => timerModal.classList.remove('open');

  document.getElementById('open-protocols-btn').onclick = () => protocolsModal.classList.add('open');
  document.getElementById('close-protocols-modal').onclick = () => protocolsModal.classList.remove('open');

  // Tapping the dimmed area closes ANY sheet (the edit-task sheet used to be missed) and Esc closes the top one
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('open');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.modal-overlay.open');
    if (open.length) open[open.length - 1].classList.remove('open');
  });

  // Timer logic
  // Timestamp-based: remaining time is computed from Date.now() instead of counting ticks, so it stays
  // correct even when the phone throttles JavaScript (screen dimming, switching apps).
  let workDuration = 5;
  let restDuration = 180;
  let totalSets = 5;
  let currentSet = 1;
  let isWorkPhase = true;
  let timeRemaining = workDuration;   // whole seconds shown on screen
  let phaseEndsAt = 0;                // ms timestamp when the current phase ends (only while running)
  let timerInterval = null;
  let isRunning = false;
  let isDone = false;
  let wakeLock = null;
  let audioCtx = null;

  const dialEl = document.getElementById('timer-dial');
  const phaseEl = document.getElementById('timer-phase');
  const timeEl = document.getElementById('timer-time');
  const subEl = document.getElementById('timer-sub');

  const startBtn = document.getElementById('btn-timer-start');
  const pauseBtn = document.getElementById('btn-timer-pause');
  const resetBtn = document.getElementById('btn-timer-reset');

  const presets = document.querySelectorAll('.btn-preset');

  presets.forEach(p => {
    p.addEventListener('click', () => {
      presets.forEach(pr => pr.classList.remove('active'));
      p.classList.add('active');

      workDuration = parseInt(p.dataset.work);
      restDuration = parseInt(p.dataset.rest);
      totalSets = parseInt(p.dataset.sets);

      resetTimer();
    });
  });

  function formatTime(sec) {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function updateDisplay() {
    timeEl.textContent = formatTime(timeRemaining);
    subEl.textContent = `Set ${currentSet} of ${totalSets}`;
    dialEl.dataset.phase = isWorkPhase ? 'work' : 'rest'; // dial colour: green = work, blue = rest

    if (isWorkPhase) {
      phaseEl.textContent = workDuration >= 60 ? "ROUND WORK PHASE" : "WORK (100% MAX EFFORT)";
    } else {
      phaseEl.textContent = "REST & RECHARGE";
    }
  }

  // One shared AudioContext (creating a new one per beep leaks contexts on phones)
  function getAudioContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playAudioBeep(freq = 600) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  }

  // Beep + vibration (vibration works on Android: phone on the floor or in a pocket)
  const CUES = {
    start: { freq: 800,  vibe: [80] },
    rest:  { freq: 400,  vibe: [250] },
    work:  { freq: 850,  vibe: [120, 70, 120] },
    done:  { freq: 1000, vibe: [300, 100, 300, 100, 500] }
  };

  function cue(kind) {
    playAudioBeep(CUES[kind].freq);
    try { if (navigator.vibrate) navigator.vibrate(CUES[kind].vibe); } catch (e) {}
  }

  // Keep the screen on while the timer runs (otherwise the phone sleeps mid-hold and the beeps stop)
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }

  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  function completeTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;
    isDone = true;
    startBtn.disabled = false;
    releaseWakeLock();
    phaseEl.textContent = "PROTOCOL COMPLETE! 🎉";
    timeEl.textContent = "DONE";
    subEl.textContent = `Set ${totalSets} of ${totalSets}`;
    cue('done');
  }

  function tick() {
    const now = Date.now();
    let phaseChangedTo = null;

    // "while" (not "if") so a long freeze catches up across several phases instead of stalling
    while (now >= phaseEndsAt) {
      if (isWorkPhase) {
        isWorkPhase = false;
        phaseEndsAt += restDuration * 1000;
        phaseChangedTo = 'rest';
      } else if (currentSet < totalSets) {
        currentSet++;
        isWorkPhase = true;
        phaseEndsAt += workDuration * 1000;
        phaseChangedTo = 'work';
      } else {
        completeTimer();
        return;
      }
    }

    if (phaseChangedTo) cue(phaseChangedTo);
    timeRemaining = Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));
    updateDisplay();
  }

  function startTimer() {
    if (isRunning) return;
    if (isDone) resetTimer(); // Start after "DONE" begins a fresh run instead of doing nothing
    isRunning = true;
    startBtn.disabled = true;
    phaseEndsAt = Date.now() + timeRemaining * 1000;
    acquireWakeLock();
    cue('start');
    updateDisplay();
    timerInterval = setInterval(tick, 250);
  }

  function pauseTimer() {
    if (isRunning) {
      timeRemaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
      updateDisplay();
    }
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;
    startBtn.disabled = false;
    releaseWakeLock();
  }

  function resetTimer() {
    pauseTimer();
    isDone = false;
    currentSet = 1;
    isWorkPhase = true;
    timeRemaining = workDuration;
    phaseEl.textContent = "READY";
    updateDisplay();
  }

  // The browser drops the wake lock when the app is hidden; take it back and catch up on return
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !isRunning) return;
    acquireWakeLock();
    tick();
  });

  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  resetBtn.addEventListener('click', resetTimer);

  updateDisplay();
}

/* -------------------------------------------------------------
 * 7. ANDROID BACK BUTTON CLOSES THE OPEN SHEET
 * Without this, swiping "back" with a sheet open would close the whole installed app.
 * We keep at most ONE extra history entry while any sheet is open.
 * ------------------------------------------------------------- */
function initModalBackButton() {
  const anyOpen = () => document.querySelector('.modal-overlay.open') !== null;
  let holdingEntry = false;

  function sync() {
    if (anyOpen() && !holdingEntry) {
      history.pushState({ hybridSheet: true }, '');
      holdingEntry = true;
    } else if (!anyOpen() && holdingEntry) {
      holdingEntry = false;
      history.back(); // sheet was closed with X / backdrop: drop our history entry again
    }
  }

  // setTimeout(0) so "close one sheet + open another" in the same tick is treated as still-open
  const observer = new MutationObserver(() => setTimeout(sync, 0));
  document.querySelectorAll('.modal-overlay').forEach(m => observer.observe(m, { attributes: true, attributeFilter: ['class'] }));

  window.addEventListener('popstate', () => {
    if (!holdingEntry) return;
    holdingEntry = false; // the back gesture already consumed our entry
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  });
}

/* -------------------------------------------------------------
 * 8. BACKUP: EXPORT / IMPORT
 * Your data lives only in this browser's storage. A backup file lets you move to another phone or
 * host, or recover after clearing site data.
 * ------------------------------------------------------------- */
function initBackup() {
  const flash = sessionStorage.getItem('hybrid_flash');
  if (flash) {
    sessionStorage.removeItem('hybrid_flash');
    showToast(flash);
  }

  const exportBtn = document.getElementById('export-data-btn');
  const importBtn = document.getElementById('import-data-btn');
  const fileInput = document.getElementById('import-data-input');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const payload = {
        app: 'hybrid-os',
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks: notionTasks,
        checklist: weeklyChecklist,
        goals: longTermGoals
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hybrid-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Backup file saved to your downloads');
    });
  }

  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        if (file.size > 1000000) throw new Error('file is too large');
        const data = JSON.parse(await file.text());
        if (!data || data.app !== 'hybrid-os') throw new Error('this is not a Hybrid OS backup');

        const tasks = sanitizeTasks(data.tasks);
        const checklist = sanitizeChecklist(data.checklist);
        const goals = sanitizeGoals(data.goals);

        localStorage.setItem('hybrid_notion_tasks', JSON.stringify(tasks));
        localStorage.setItem('hybrid_weekly_checklist', JSON.stringify(checklist));
        localStorage.setItem('hybrid_long_term_goals', JSON.stringify(goals));
        sessionStorage.setItem('hybrid_flash', `Backup restored: ${tasks.length} tasks, ${checklist.length} checklist items, ${goals.length} goals`);
        location.reload();
      } catch (err) {
        showToast(`Import failed: ${err.message}`);
      }
    });
  }
}
