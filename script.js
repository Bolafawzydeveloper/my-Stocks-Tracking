/**
 * Stock & Portfolio Manager - Firebase Cloud Edition
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// 2. إعدادات مشروعك
const firebaseConfig = {
  apiKey: "AIzaSyCpys_z-Xe9bnuW1vr3TQ8wXmMaujeDm4w",
  authDomain: "bf-digital-stocks.firebaseapp.com",
  projectId: "bf-digital-stocks",
  storageBucket: "bf-digital-stocks.firebasestorage.app",
  messagingSenderId: "746996934484",
  appId: "1:746996934484:web:d41ce18e0cf336e920cac1",
  measurementId: "G-LNV02YX08H"
};

// 3. تهيئة النظام
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;

// ==========================================
// DEFAULT DATA (Zeroed Out for New Users)
// ==========================================
const DEFAULT_SECTIONS = [
  { id: "gold", title: "صناديق الذهب", ratio: 0.15, rule: "تحوط وتأمين - شراء دوري ثابت" },
  { id: "equityFunds", title: "صناديق الأسهم", ratio: 0.20, rule: "تنمية رأس المال طويلة المدى" },
  { id: "longTerm", title: "الأسهم طويلة المدى (استثمار)", ratio: 0.40, rule: "أفق 3 - 10 سنوات" },
  { id: "speculative", title: "الأسهم قصيرة المدى والمضاربة", ratio: 0.25, rule: "التزام صارم بوقف الخسارة" }
];

// تصفير كافة الأرقام الافتراضية
const DEFAULT_DEPOSIT = {
  baseAmount: 0,
  growthRate: 20,
  totalDeposited: 0,
  freeCash: 0,
  month: "الحالي",
  year: new Date().getFullYear(),
  lastMonthIndex: new Date().getMonth(),
  isCompleted: false
};
const DEFAULT_STOCKS = [];

let sections = [];
let stocks = [];
let depositData = {};
let activeStockForDetails = null;
let dismissedAlerts = [];
const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// ==========================================
// CLOUD STORAGE & SYNC
// ==========================================
async function loadStateFromCloud(uid) {
  try {
    const docRef = doc(db, "users", uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      sections = data.sections || DEFAULT_SECTIONS;
      stocks = data.stocks || [];
      depositData = data.depositData || DEFAULT_DEPOSIT;
      dismissedAlerts = data.dismissedAlerts || [];
    } else {
      sections = DEFAULT_SECTIONS;
      stocks = DEFAULT_STOCKS;
      depositData = DEFAULT_DEPOSIT;
      dismissedAlerts = [];
      await saveToCloud();
    }

    const currentMonthIdx = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    // --- الإصلاح القوي: تأمين البيانات المفقودة من الحفظ القديم ---
    if (depositData.year === undefined) depositData.year = currentYear;
    if (depositData.lastMonthIndex === undefined) depositData.lastMonthIndex = currentMonthIdx;
    if (depositData.isCompleted === undefined) depositData.isCompleted = false;

    // فحص دخول شهر جديد أو سنة جديدة
    if (Number(depositData.lastMonthIndex) !== currentMonthIdx || Number(depositData.year) !== currentYear) {
      const growthDecimal = (Number(depositData.growthRate) || 0) / 100;
      depositData.baseAmount = Number((Number(depositData.baseAmount) * (1 + growthDecimal)).toFixed(2));

      // تحديث الشهر، وتفعيل التنبيه الأحمر من جديد!
      depositData.lastMonthIndex = currentMonthIdx;
      depositData.month = monthNames[currentMonthIdx];
      depositData.year = currentYear;
      // إعادة التنبيه فقط إذا كان هناك بالفعل تغيير حقيقي في الشهر أو السنة
      depositData.isCompleted = false;

      saveToCloud();
    }

    renderAll();
  } catch (error) {
    console.error("Error loading from cloud:", error);
  }
}

async function saveToCloud() {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, "users", currentUser.uid), {
      sections,
      stocks,
      depositData,
      dismissedAlerts,
      lastUpdated: new Date().toISOString()
    }, { merge: true }); // <--  هنا يمنع مسح باقي البيانات
  } catch (error) {
    console.error("Error saving to cloud:", error);
  }
}

function saveSections() { saveToCloud(); }
function saveStocks() { saveToCloud(); }
function saveDeposit() { saveToCloud(); }

// ==========================================
// RENDER KPI & DASHBOARD
// ==========================================
function renderDashboardSummary() {
  let totalStockCost = 0;
  let totalStockValue = 0;

  stocks.forEach(s => {
    if (s.section && !s.section.startsWith("watchlist") && s.quantity && s.quantity > 0) {
      const q = Number(s.quantity);
      const buy = Number(s.buyPrice || 0);
      const curr = Number(s.currentPrice || 0);
      totalStockCost += q * buy;
      totalStockValue += q * curr;
    }
  });

  const freeCash = Number(depositData.freeCash || 0);
  const totalDeposited = Number(depositData.totalDeposited || 0);

  // إجمالي المحفظة = قيمة الأسهم السوقية الحالية + الكاش الحر
  const totalAssets = totalStockValue + freeCash;

  // التعديل الجديد: الربح الكلي يحسب بناءً على الفرق بين إجمالي الأصول وإجمالي ما قمت بإيداعه فعلياً
  const totalProfitLoss = totalAssets - totalDeposited;
  const profitPct = totalDeposited > 0 ? (totalProfitLoss / totalDeposited) * 100 : 0;
  const isPos = totalProfitLoss >= 0;

  const assetsEl = document.getElementById("kpi-total-assets");
  const pnlEl = document.getElementById("kpi-pnl-pill");
  if (assetsEl) assetsEl.innerText = totalAssets.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (pnlEl) {
    pnlEl.className = `profit-pill ${isPos ? "profit-pos" : "profit-neg"}`;
    pnlEl.innerHTML = `<span>${isPos ? "▲ +" : "▼ "}${totalProfitLoss.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م</span><span>(${isPos ? "+" : ""}${profitPct.toFixed(2)}%)</span>`;
  }

  const depEl = document.getElementById("kpi-total-deposited");
  if (depEl) depEl.innerText = totalDeposited.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const cashEl = document.getElementById("kpi-free-cash");
  const cashPctEl = document.getElementById("kpi-cash-pct");
  if (cashEl) cashEl.innerText = freeCash.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cashPctEl && totalAssets > 0) cashPctEl.innerText = `${((freeCash / totalAssets) * 100).toFixed(1)}% من إجمالي المحفظة`;

  const monthlyEl = document.getElementById("kpi-monthly-deposit");
  const monthNameEl = document.getElementById("kpi-deposit-month-name");
  const statusEl = document.getElementById("kpi-deposit-status");
  const alertBox = document.getElementById("monthly-deposit-alert");
  const alertAmount = document.getElementById("alert-deposit-amount");

  if (monthlyEl) monthlyEl.innerText = Number(depositData.baseAmount || 0).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (monthNameEl) monthNameEl.innerText = `هدف شهر ${monthNames[depositData.lastMonthIndex || 0]}`;

  // تحديث حالة السداد
  if (statusEl) {
    if (depositData.isCompleted) {
      statusEl.innerText = "✅ مكتمل";
      statusEl.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
      statusEl.style.color = "var(--accent-emerald)";
    } else {
      statusEl.innerText = "⏳ بانتظار الإيداع";
      statusEl.style.backgroundColor = "rgba(245, 158, 11, 0.2)";
      statusEl.style.color = "var(--accent-amber)";
    }
  }
  // التحكم في ظهور التنبيه القوي
  if (alertBox && alertAmount) {
    if (!depositData.isCompleted && depositData.baseAmount > 0) {
      alertAmount.innerText = Number(depositData.baseAmount).toLocaleString("ar-EG", { minimumFractionDigits: 2 });
      alertBox.style.display = "block";
    } else {
      alertBox.style.display = "none";
    }
  }
}

// ==========================================
// GLOBAL EDIT FUNCTIONS (Fixes the undefined error)
// ==========================================
window.editFreeCash = function () {
  openValueEditModal("تعديل السيولة النقدية الحرة", "المبلغ بالجنيه", depositData.freeCash, (val) => {
    depositData.freeCash = val;
    saveToCloud();
    renderAll();
  });
};

window.editTotalDeposited = function () {
  openValueEditModal("تعديل مجموع الإيداعات", "المبلغ بالجنيه", depositData.totalDeposited, (val) => {
    depositData.totalDeposited = val;
    saveToCloud();
    renderAll();
  });
};

openValueEditModal("تعديل الإيداع الشهري المستهدف", "المبلغ بالجنيه", depositData.baseAmount, (val) => {
  depositData.baseAmount = val;
  saveToCloud();
  renderAll();
});
// ==========================================
// REST OF RENDERING & LOGIC
// ==========================================
function updateDateDisplay() {
  const dateEl = document.getElementById("current-date-text");
  if (dateEl) {
    const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    dateEl.innerText = new Date().toLocaleDateString("ar-EG", options);
  }
}

function getStockAlerts() {
  const alerts = [];
  stocks.forEach(stock => {
    const curr = Number(stock.currentPrice);
    if (!curr) return;
    if (stock.target1 && curr >= Number(stock.target1)) {
      const key = `${stock.id}-target-${stock.target1}`;
      if (!dismissedAlerts.includes(key)) alerts.push({ stockId: stock.id, symbol: stock.symbol, type: "target", key: key, text: `🎯 حقق السهم هدفه الأول (${stock.target1} ج.م)`, className: "alert-target" });
    }
    if (stock.stopLoss && curr <= Number(stock.stopLoss)) {
      const key = `${stock.id}-stoploss-${stock.stopLoss}`;
      if (!dismissedAlerts.includes(key)) alerts.push({ stockId: stock.id, symbol: stock.symbol, type: "stoploss", key: key, text: `🛑 كسر السهم مستوى وقف الخسارة (${stock.stopLoss} ج.م)!`, className: "alert-stoploss" });
    }
    if (stock.fib60) {
      const fib = Number(stock.fib60);
      if (Math.abs(curr - fib) / fib <= 0.02) {
        const key = `${stock.id}-fib60-${stock.fib60}`;
        if (!dismissedAlerts.includes(key)) alerts.push({ stockId: stock.id, symbol: stock.symbol, type: "fib", key: key, text: `🌟 يختبر الدعم الذهبي لفيبوناتشي 60% (${stock.fib60} ج.م)`, className: "alert-fib" });
      }
    }
    if (stock.fib50) {
      const fib = Number(stock.fib50);
      if (Math.abs(curr - fib) / fib <= 0.02) {
        const key = `${stock.id}-fib50-${stock.fib50}`;
        if (!dismissedAlerts.includes(key)) alerts.push({ stockId: stock.id, symbol: stock.symbol, type: "fib", key: key, text: `📉 يختبر دعم فيبوناتشي 50% (${stock.fib50} ج.م)`, className: "alert-fib" });
      }
    }
    if (stock.rsi && Number(stock.rsi) <= 32) {
      const key = `${stock.id}-rsi-over-${stock.rsi}`;
      if (!dismissedAlerts.includes(key)) alerts.push({ stockId: stock.id, symbol: stock.symbol, type: "rsi", key: key, text: `⚡ RSI = ${stock.rsi} (فرصة ارتداد)`, className: "alert-rsi" });
    }
    if (stock.rsi && Number(stock.rsi) >= 70) {
      const key = `${stock.id}-rsi-under-${stock.rsi}`;
      if (!dismissedAlerts.includes(key)) alerts.push({ stockId: stock.id, symbol: stock.symbol, type: "rsi", key: key, text: `⚠️ RSI = ${stock.rsi} (جني أرباح محتمل)`, className: "alert-rsi" });
    }
  });
  return alerts;
}

function renderAlertsTicker() {
  const container = document.getElementById("alerts-container");
  const badgeCount = document.getElementById("header-alert-count");
  const alerts = getStockAlerts();
  if (badgeCount) badgeCount.innerText = `${alerts.length} تنبيه`;
  if (!container) return;
  if (alerts.length === 0) {
    container.innerHTML = `<span class="alert-badge-label">⚡ تنبيهات فنية</span><span style="font-size:0.75rem; color:var(--text-dim);">لا توجد تنبيهات عاجلة حالياً.</span>`;
    return;
  }
  let html = `<span class="alert-badge-label">⚡ تنبيهات نشطة (${alerts.length})</span>`;
  alerts.forEach(alert => {
    html += `<div class="alert-item ${alert.className}" onclick="openStockDetailsById('${alert.stockId}')"><strong>${alert.symbol}:</strong><span>${alert.text}</span><button onclick="dismissAlert(event, '${alert.key}')" class="dismiss-alert-btn">✖</button></div>`;
  });
  container.innerHTML = html;
}

function renderSections() {
  const container = document.getElementById("sections-container");
  if (!container) return;
  const baseDeposit = Number(depositData.baseAmount || 0);
  let html = "";
  sections.forEach(sec => {
    const sectionStocks = stocks.filter(s => s.section === sec.id);
    const reqDeposit = Math.round(baseDeposit * (sec.ratio || 0));
    let secValue = 0;
    sectionStocks.forEach(s => { secValue += Number(s.quantity || 0) * Number(s.currentPrice || 0); });

    html += `
      <div class="section-block" id="section-${sec.id}">
        <div class="section-head">
          <div class="section-title-wrap">
            <h3 class="section-title">${sec.title}</h3>
            <span class="ratio-badge">${Math.round(sec.ratio * 100)}% تخصيص</span>
            <span class="deposit-req-badge">مطلوب إيداع: ${reqDeposit.toLocaleString("ar-EG")} ج.م</span>
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">| القيمة الحالية: ${secValue.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} ج.م</span>
          </div>
          <div class="section-head-actions">
            <button class="btn btn-secondary" onclick="openSectionConfigModal('${sec.id}')">⚙️ ضبط الخطة</button>
            <button class="btn btn-primary" onclick="openAddStockModal('${sec.id}')">➕ إضافة سهم</button>
          </div>
          <div class="section-rule">📋 <strong>الاستراتيجية والقاعدة:</strong> ${sec.rule}</div>
        </div>
        <div class="stocks-grid">
          ${sectionStocks.length > 0 ? sectionStocks.map(stock => renderStockCard(stock)).join("") : `<div class="empty-placeholder">لا توجد أسهم مضافة في هذا القسم حالياً.</div>`}
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderWatchlist() {
  const container = document.getElementById("watchlist-container");
  if (!container) return;
  const longStocks = stocks.filter(s => s.section === "watchlistLong");
  const shortStocks = stocks.filter(s => s.section === "watchlistShort");
  const oldWatchlist = stocks.filter(s => s.section === "watchlist");
  if (oldWatchlist.length > 0) shortStocks.push(...oldWatchlist);

  let html = `
    <div><h4 class="watchlist-sub-title">🛡️ أسهم مراقبة (استثمار طويل المدى)</h4><div class="stocks-grid" style="padding: 0;">${longStocks.length > 0 ? longStocks.map(stock => renderStockCard(stock, true)).join("") : `<div class="empty-placeholder" style="border-color: rgba(168,85,247,0.3);">لا توجد أسهم طويلة المدى قيد المراقبة.</div>`}</div></div>
    <div><h4 class="watchlist-sub-title">⚡ أسهم مراقبة (مضاربة وقصيرة المدى)</h4><div class="stocks-grid" style="padding: 0;">${shortStocks.length > 0 ? shortStocks.map(stock => renderStockCard(stock, true)).join("") : `<div class="empty-placeholder" style="border-color: rgba(168,85,247,0.3);">لا توجد أسهم قصيرة المدى قيد المراقبة.</div>`}</div></div>
  `;
  container.innerHTML = html;
}

function renderStockCard(stock, isWatchlist = false) {
  const q = Number(stock.quantity || 0); const buy = Number(stock.buyPrice || 0); const curr = Number(stock.currentPrice || 0);
  const totalVal = q * curr; const pnl = (curr - buy) * q; const pnlPct = buy > 0 ? ((curr - buy) / buy) * 100 : 0; const isPos = pnl >= 0;

  let alertBanner = "";
  const targetKey = `${stock.id}-target-${stock.target1}`;
  const stopLossKey = `${stock.id}-stoploss-${stock.stopLoss}`;

  if (stock.target1 && curr >= Number(stock.target1) && !dismissedAlerts.includes(targetKey)) {
    alertBanner = `<div class="alert-banner-anim" style="background-color: var(--accent-emerald-bg); color: var(--accent-emerald); padding: 0.4rem 1rem; font-size: 0.75rem; font-weight: 700; border-bottom: 1px solid rgba(16, 185, 129, 0.2); display: flex; justify-content: space-between; align-items: center;"><span>✅ السهم وصل أو تجاوز الهدف</span><button onclick="dismissAlert(event, '${targetKey}')" class="dismiss-alert-btn">✖</button></div>`;
  } else if (stock.stopLoss && curr <= Number(stock.stopLoss) && !dismissedAlerts.includes(stopLossKey)) {
    alertBanner = `<div class="alert-banner-anim" style="background-color: var(--accent-rose-bg); color: var(--accent-rose); padding: 0.4rem 1rem; font-size: 0.75rem; font-weight: 700; border-bottom: 1px solid rgba(244, 63, 94, 0.2); display: flex; justify-content: space-between; align-items: center;"><span>🛑 السهم كسر مستوى الدعم / الوقف</span><button onclick="dismissAlert(event, '${stopLossKey}')" class="dismiss-alert-btn">✖</button></div>`;
  }

  return `
    <div class="stock-card" onclick="openStockDetailsById('${stock.id}')" style="padding: 0; overflow: hidden;">
      ${alertBanner}
      <div style="padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
        <div class="stock-card-top">
          <div class="stock-identity">
            <span class="stock-symbol-tag">${stock.symbol}</span>
            <div>
              <h4 class="stock-name-title">${stock.name}</h4>
              ${stock.sector ? `<span style="font-size:0.75rem; color:#94a3b8; display:block; margin-top:2px;">🏢 ${stock.sector}</span>` : ""}
              ${stock.customNotes ? `<span style="font-size:0.68rem; color:var(--text-dim); display:block; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">📝 ${stock.customNotes}</span>` : ""}
            </div>
          </div>
          <div class="stock-price-display">
            <div class="current-price-val">${curr.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} <span class="price-currency">ج.م</span></div>
            ${!isWatchlist ? `<span class="profit-pill ${isPos ? "profit-pos" : "profit-neg"}">${isPos ? "+" : ""}${pnlPct.toFixed(1)}%</span>` : `<span style="font-size:0.68rem; color:var(--accent-amber); font-weight:700;">قيد المراقبة ⭐</span>`}
          </div>
        </div>
        ${!isWatchlist ? `
          <div class="stats-matrix">
            <div class="matrix-item"><span class="matrix-label">الكمية</span><span class="matrix-val">${q.toLocaleString("ar-EG")}</span></div>
            <div class="matrix-item"><span class="matrix-label">متوسط الشراء</span><span class="matrix-val">${buy.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} ج.م</span></div>
            <div class="matrix-item"><span class="matrix-label">إجمالي القيمة</span><span class="matrix-val">${totalVal.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} ج.م</span></div>
            <div class="matrix-item"><span class="matrix-label">الربح/الخسارة</span><span class="matrix-val" style="color:${isPos ? "var(--accent-emerald)" : "var(--accent-rose)"}">${isPos ? "+" : ""}${pnl.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} ج.م</span></div>
          </div>
        ` : `
          <div class="stats-matrix">
            <div class="matrix-item"><span class="matrix-label">القيمة العادلة</span><span class="matrix-val">${stock.fairValue ? stock.fairValue + " ج.م" : "غير محددة"}</span></div>
            <div class="matrix-item"><span class="matrix-label">الهدف الأول</span><span class="matrix-val" style="color:var(--accent-emerald)">${stock.target1 ? stock.target1 + " ج.م" : "-"}</span></div>
          </div>
        `}
        <div class="indicator-tags-row">
          ${stock.target1 ? `<span class="badge-tag tag-target">🎯 هدف: ${stock.target1}</span>` : ""}
          ${stock.stopLoss ? `<span class="badge-tag tag-stoploss">🛑 وقف: ${stock.stopLoss}</span>` : ""}
          ${stock.fib60 ? `<span class="badge-tag tag-fib">🌟 فيبو: ${stock.fib60}</span>` : ""}
          ${stock.rsi ? `<span class="badge-tag tag-rsi">RSI: ${stock.rsi}</span>` : ""}
        </div>
        <div class="stock-card-footer" onclick="event.stopPropagation()">
          <span>اضغط لعرض كافة التفاصيل</span>
          <div class="card-actions-mini"><button class="btn-mini" onclick="openEditStockModal('${stock.id}')">تعديل ✏️</button><button class="btn-mini btn-mini-danger" onclick="deleteStock('${stock.id}')">حذف 🗑️</button></div>
        </div>
      </div>
    </div>
  `;
}

function renderAll() {
  updateDateDisplay();
  renderAlertsTicker();
  renderDashboardSummary();
  renderSections();
  renderWatchlist();
}

function openModal(modalId) { const el = document.getElementById(modalId); if (el) el.classList.add("active"); }
function closeModal(modalId) { const el = document.getElementById(modalId); if (el) el.classList.remove("active"); }

function openAddStockModal(defaultSection = "longTerm") {
  document.getElementById("stock-form").reset();
  document.getElementById("stock-form-id").value = "";
  document.getElementById("stock-modal-title").innerText = "➕ إضافة أصل / سهم جديد";
  document.getElementById("stock-form-section").value = defaultSection;
  if (document.getElementById("stock-form-sector")) document.getElementById("stock-form-sector").value = "";
  document.getElementById("stock-chart-preview").innerHTML = `<span style="font-size:0.75rem; color:var(--text-dim);">لم يتم إرفاق صورة شارت بعد</span>`;
  document.getElementById("stock-form-image-base64").value = "";
  openModal("stock-form-modal");
}

function openEditStockModal(stockId) {
  const stock = stocks.find(s => s.id === stockId); if (!stock) return;
  document.getElementById("stock-form-id").value = stock.id;
  document.getElementById("stock-modal-title").innerText = `✏️ تعديل بيانات السهم (${stock.symbol})`;
  document.getElementById("stock-form-section").value = stock.section;
  if (document.getElementById("stock-form-sector")) document.getElementById("stock-form-sector").value = stock.sector || "";
  document.getElementById("stock-form-symbol").value = stock.symbol;
  document.getElementById("stock-form-name").value = stock.name;
  document.getElementById("stock-form-quantity").value = stock.quantity || 0;
  document.getElementById("stock-form-buy-price").value = stock.buyPrice || 0;
  document.getElementById("stock-form-current-price").value = stock.currentPrice || 0;
  document.getElementById("stock-form-fair-value").value = stock.fairValue || "";
  document.getElementById("stock-form-target1").value = stock.target1 || "";
  document.getElementById("stock-form-target2").value = stock.target2 || "";
  document.getElementById("stock-form-target3").value = stock.target3 || "";
  document.getElementById("stock-form-stoploss").value = stock.stopLoss || "";
  document.getElementById("stock-form-fib50").value = stock.fib50 || "";
  document.getElementById("stock-form-fib60").value = stock.fib60 || "";
  document.getElementById("stock-form-rsi").value = stock.rsi || "";
  document.getElementById("stock-form-macd").value = stock.macd || "";
  document.getElementById("stock-form-ma").value = stock.ma || "";
  document.getElementById("stock-form-volume").value = stock.volume || "";
  document.getElementById("stock-form-notes").value = stock.customNotes || "";
  document.getElementById("stock-form-image-url").value = stock.imageUrl || "";
  document.getElementById("stock-form-image-base64").value = stock.imageBase64 || "";
  const previewBox = document.getElementById("stock-chart-preview");
  if (stock.imageBase64 || stock.imageUrl) previewBox.innerHTML = `<img src="${stock.imageBase64 || stock.imageUrl}" alt="الشارت الفني" />`;
  else previewBox.innerHTML = `<span style="font-size:0.75rem; color:var(--text-dim);">لم يتم إرفاق صورة شارت</span>`;
  openModal("stock-form-modal");
}

function handleStockFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("stock-form-id").value || `stock-${Date.now()}`;
  const newStock = {
    id,
    section: document.getElementById("stock-form-section").value,
    sector: document.getElementById("stock-form-sector") ? document.getElementById("stock-form-sector").value : "",
    symbol: document.getElementById("stock-form-symbol").value.trim().toUpperCase(),
    name: document.getElementById("stock-form-name").value.trim(),
    quantity: parseFloat(document.getElementById("stock-form-quantity").value) || 0,
    buyPrice: parseFloat(document.getElementById("stock-form-buy-price").value) || 0,
    currentPrice: parseFloat(document.getElementById("stock-form-current-price").value) || 0,
    fairValue: parseFloat(document.getElementById("stock-form-fair-value").value) || null,
    target1: parseFloat(document.getElementById("stock-form-target1").value) || null,
    target2: parseFloat(document.getElementById("stock-form-target2").value) || null,
    target3: parseFloat(document.getElementById("stock-form-target3").value) || null,
    stopLoss: parseFloat(document.getElementById("stock-form-stoploss").value) || null,
    fib50: parseFloat(document.getElementById("stock-form-fib50").value) || null,
    fib60: parseFloat(document.getElementById("stock-form-fib60").value) || null,
    rsi: parseFloat(document.getElementById("stock-form-rsi").value) || null,
    macd: document.getElementById("stock-form-macd").value.trim() || null,
    ma: document.getElementById("stock-form-ma").value.trim() || null,
    volume: document.getElementById("stock-form-volume").value.trim() || null,
    customNotes: document.getElementById("stock-form-notes").value.trim() || "",
    imageUrl: document.getElementById("stock-form-image-url").value.trim() || "",
    imageBase64: document.getElementById("stock-form-image-base64").value || ""
  };
  const existingIdx = stocks.findIndex(s => s.id === id);
  if (existingIdx > -1) stocks[existingIdx] = newStock; else stocks.unshift(newStock);
  saveStocks(); renderAll(); closeModal("stock-form-modal");
  if (activeStockForDetails && activeStockForDetails.id === id) openStockDetailsById(id);
}

function deleteStock(stockId) {
  if (confirm("هل أنت متأكد من حذف هذا السهم من المحفظة؟")) {
    stocks = stocks.filter(s => s.id !== stockId);
    saveStocks(); renderAll(); closeModal("stock-details-modal");
  }
}

function openStockDetailsById(stockId) {
  const stock = stocks.find(s => s.id === stockId);
  if (!stock) return;
  activeStockForDetails = stock;

  const curr = Number(stock.currentPrice || 0);
  const buy = Number(stock.buyPrice || 0);
  const q = Number(stock.quantity || 0);
  const totalCost = q * buy;
  const totalVal = q * curr;
  const pnl = totalVal - totalCost;
  const pnlPct = buy > 0 ? ((curr - buy) / buy) * 100 : 0;
  const isPos = pnl >= 0;
  const isWatch = stock.section && stock.section.startsWith("watchlist");
  const sec = sections.find(s => s.id === stock.section);
  const secName = isWatch ? "قائمة المراقبة ⭐" : (sec ? sec.title : "عام");

  let riskRewardText = "غير محدد";
  if (stock.target1 && stock.stopLoss && curr > stock.stopLoss) {
    const gain = Number(stock.target1) - curr;
    const loss = curr - Number(stock.stopLoss);
    if (loss > 0) {
      const rr = (gain / loss).toFixed(2);
      riskRewardText = `1 : ${rr} ${rr >= 2 ? "✅" : "⚠️"}`;
    }
  }

  document.getElementById("details-stock-symbol").innerText = stock.symbol;
  document.getElementById("details-stock-name").innerText = stock.name;
  document.getElementById("details-stock-section").innerText = secName;
  document.getElementById("details-stock-price").innerText = `${curr.toLocaleString("ar-EG", { minimumFractionDigits: 2 })} ج.م`;

  document.getElementById("details-summary-matrix").innerHTML = `
    <div class="details-stat-card"><span class="details-stat-label">حالة السهم</span><span class="details-stat-val">${isWatch ? "مراقبة" : "مملوك"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">القطاع</span><span class="details-stat-val">${stock.sector || "غير محدد"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">الكمية</span><span class="details-stat-val">${isWatch ? "-" : q.toLocaleString("ar-EG")}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">متوسط الشراء</span><span class="details-stat-val">${isWatch ? "-" : buy.toLocaleString("ar-EG", { minimumFractionDigits: 2 }) + " ج.م"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">إجمالي القيمة</span><span class="details-stat-val">${isWatch ? "-" : totalVal.toLocaleString("ar-EG", { minimumFractionDigits: 2 }) + " ج.م"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">الربح/الخسارة</span><span class="details-stat-val" style="color:${isPos ? "var(--accent-emerald)" : "var(--accent-rose)"}">${isWatch ? "-" : (isPos ? "+" : "") + pnl.toLocaleString("ar-EG", { minimumFractionDigits: 2 }) + " ج.م"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">القيمة العادلة</span><span class="details-stat-val">${stock.fairValue ? stock.fairValue + " ج.م" : "غير مدخلة"}</span></div>
  `;

  document.getElementById("details-tech-matrix").innerHTML = `
    <div class="details-stat-card"><span class="details-stat-label">🎯 هدف 1</span><span class="details-stat-val" style="color:var(--accent-emerald)">${stock.target1 || "-"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">🛑 وقف</span><span class="details-stat-val" style="color:var(--accent-rose)">${stock.stopLoss || "-"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">⚖️ R:R</span><span class="details-stat-val">${riskRewardText}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">🌟 فيبو 60%</span><span class="details-stat-val" style="color:var(--accent-amber)">${stock.fib60 || "-"}</span></div>
    <div class="details-stat-card"><span class="details-stat-label">⚡ RSI</span><span class="details-stat-val">${stock.rsi !== null && stock.rsi !== undefined ? stock.rsi : "-"}</span></div>
  `;

  const chartBox = document.getElementById("details-chart-container");
  if (stock.imageBase64 || stock.imageUrl) {
    chartBox.innerHTML = `<div class="chart-preview-box" style="max-height:360px;"><img src="${stock.imageBase64 || stock.imageUrl}" alt="شارت" /></div>`;
    chartBox.style.display = "block";
  } else {
    chartBox.style.display = "none";
  }

  const notesBox = document.getElementById("details-notes-container");
  if (stock.customNotes) {
    notesBox.innerHTML = `<div style="background:var(--bg-inner); padding:0.75rem; border-radius:var(--radius-sm); font-size:0.8rem; color:#ffffff;">${stock.customNotes}</div>`;
    notesBox.style.display = "block";
  } else {
    notesBox.style.display = "none";
  }

  document.getElementById("details-edit-btn").onclick = () => {
    closeModal("stock-details-modal");
    openEditStockModal(stock.id);
  };
  document.getElementById("details-delete-btn").onclick = () => {
    deleteStock(stock.id);
  };

  openModal("stock-details-modal");
}

let activeSectionConfigId = null;
function openSectionConfigModal(sectionId) {
  const sec = sections.find(s => s.id === sectionId); if (!sec) return;
  activeSectionConfigId = sectionId;
  document.getElementById("section-cfg-title").value = sec.title;
  document.getElementById("section-cfg-ratio").value = Math.round(sec.ratio * 100);
  document.getElementById("section-cfg-rule").value = sec.rule;
  openModal("section-config-modal");
}

function handleSectionConfigSubmit(e) {
  e.preventDefault(); if (!activeSectionConfigId) return;
  const sec = sections.find(s => s.id === activeSectionConfigId); if (!sec) return;
  sec.title = document.getElementById("section-cfg-title").value.trim();
  sec.ratio = (parseFloat(document.getElementById("section-cfg-ratio").value) || 0) / 100;
  sec.rule = document.getElementById("section-cfg-rule").value.trim();
  saveSections(); renderAll(); closeModal("section-config-modal");
}

var activeValueEditCallback = null;
function openValueEditModal(title, label, initialVal, onSave) {
  document.getElementById("value-edit-title").innerText = title;
  document.getElementById("value-edit-label").innerText = label;
  document.getElementById("value-edit-input").value = initialVal || 0;
  activeValueEditCallback = onSave; openModal("value-edit-modal");
}

function handleValueEditSubmit(e) {
  e.preventDefault(); const val = parseFloat(document.getElementById("value-edit-input").value);
  if (!isNaN(val) && activeValueEditCallback) { activeValueEditCallback(val); renderAll(); closeModal("value-edit-modal"); }
}

function openSearchModal() { document.getElementById("search-input").value = ""; renderSearchResults(""); openModal("search-modal"); setTimeout(() => document.getElementById("search-input").focus(), 50); }
function handleSearchInput(e) { renderSearchResults(e.target.value.trim().toLowerCase()); }
function renderSearchResults(query) {
  const container = document.getElementById("search-results-list"); if (!container) return;
  const filtered = query ? stocks.filter(s => s.symbol.toLowerCase().includes(query) || s.name.toLowerCase().includes(query) || (s.customNotes && s.customNotes.toLowerCase().includes(query))) : stocks;
  if (filtered.length === 0) { container.innerHTML = `<div style="text-align:center; padding:1.5rem; color:var(--text-dim); font-size:0.8rem;">لم يتم العثور على أي سهم.</div>`; return; }
  let html = "";
  filtered.forEach(stock => {
    const sec = sections.find(s => s.id === stock.section); const secName = stock.section && stock.section.startsWith("watchlist") ? "قائمة المراقبة ⭐" : (sec ? sec.title : "عام");
    html += `<div class="search-item" onclick="closeModal('search-modal'); openStockDetailsById('${stock.id}')"><div style="display:flex; align-items:center; gap:0.6rem;"><span class="stock-symbol-tag">${stock.symbol}</span><div><div style="font-weight:700; font-size:0.85rem; color:#ffffff;">${stock.name}</div><div style="font-size:0.7rem; color:var(--accent-amber);">${secName}</div></div></div><div style="text-align:left;"><span style="font-weight:700; font-size:0.85rem; color:#ffffff;">${Number(stock.currentPrice).toLocaleString("ar-EG", { minimumFractionDigits: 2 })} ج.م</span></div></div>`;
  });
  container.innerHTML = html;
}

function dismissAlert(e, alertKey) {
  e.stopPropagation();
  if (!dismissedAlerts.includes(alertKey)) {
    dismissedAlerts.push(alertKey);
    saveToCloud();
    renderAll();
  }
}

// Window Attachments
window.openSearchModal = openSearchModal;
window.openAddStockModal = openAddStockModal;
window.openEditStockModal = openEditStockModal;
window.deleteStock = deleteStock;
window.openStockDetailsById = openStockDetailsById;
window.openSectionConfigModal = openSectionConfigModal;
window.openValueEditModal = openValueEditModal;
window.dismissAlert = dismissAlert;
window.closeModal = closeModal;

// دوال الإيداع التراكمي (مربوطة بالـ window لكي يراها HTML)
window.markDepositCompleted = function () {
  depositData.isCompleted = true;
  saveToCloud();
  renderAll();
};

window.openDepositSettingsModal = function () {
  document.getElementById("dep-month-input").value = depositData.lastMonthIndex || 0;
  document.getElementById("dep-amount-input").value = depositData.baseAmount || 0;
  document.getElementById("dep-growth-input").value = depositData.growthRate !== undefined ? depositData.growthRate : 20;
  openModal("deposit-settings-modal");
};
// في حال نسينا ربط الدالة الخاصة بحفظ نموذج الإيداع
const depForm = document.getElementById("deposit-settings-form");
if (depForm) {
  depForm.addEventListener("submit", (e) => {
    e.preventDefault();
    depositData.lastMonthIndex = parseInt(document.getElementById("dep-month-input").value);
    depositData.baseAmount = parseFloat(document.getElementById("dep-amount-input").value) || 0;
    depositData.growthRate = parseFloat(document.getElementById("dep-growth-input").value) || 0;

    // إعادة تفعيل التنبيه عند تعديل الخطة
    depositData.isCompleted = false;

    saveToCloud();
    renderAll();
    closeModal("deposit-settings-modal");
  });
}
// ==========================================
// INITIALIZATION & LISTENERS
// ==========================================
document.addEventListener("DOMContentLoaded", function () {

  const auth = getAuth();
  const db = getFirestore();

  // مراقبة حالة المستخدم
  onAuthStateChanged(auth, async (user) => {
    const pendingScreen = document.getElementById("pendingApprovalScreen");
    const mainApp = document.getElementById("mainApp"); // العنصر الحاوي للوحة التحكم
    const loginOverlay = document.getElementById("login-overlay"); // شاشة تسجيل الدخول

    if (user) {
      // --- حالة: المستخدم مسجل الدخول ---
      
      // [إصلاح هام]: تعيين المستخدم الحالي لكي تعمل دالة الحفظ saveToCloud
      currentUser = user; 

      // إخفاء شاشة تسجيل الدخول
      if (loginOverlay) loginOverlay.style.display = 'none';

      // التعديل الجديد: تحديث عنوان المحفظة باسم المستخدم
      const userName = user.displayName || "مستخدم جديد";
      const headerTitle = document.getElementById('main-app-title');
      if (headerTitle) headerTitle.innerText = `لوحة تحكم المحفظة الاستثمارية (الخاصة بـ ${userName})`;
      
      // تحميل بيانات الحالة من التخزين السحابي (هذه الدالة تقوم بجلب البيانات وتشغيل renderAll تلقائياً)
      await loadStateFromCloud(user.uid);

      // التحقق من حالة المستخدم في قاعدة البيانات (Firestore)
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      let userData;

      if (!userSnap.exists()) {
        // إذا كان مستخدم جديد لأول مرة: يتم حفظه بحالة pending
        userData = {
          email: user.email,
          displayName: user.displayName || "",
          status: "pending",
          role: "user",
          createdAt: new Date().toISOString()
        };
        await setDoc(userRef, userData);
      } else {
        userData = userSnap.data();
      }

      // التحقق من الموافقة
      if (userData.status === "approved" || userData.role === "admin") {
        if (pendingScreen) pendingScreen.style.display = "none";
        if (mainApp) mainApp.style.display = "block";
        // تم حذف loadPortfolioData() لأن الكود السحابي قام بالمطلوب
      } else {
        // المستخدم ما زال قيد الانتظار
        if (pendingScreen) pendingScreen.style.display = "flex";
        if (mainApp) mainApp.style.display = "none";
      }

    } else {
      // --- حالة: لم يسجل الدخول ---
      currentUser = null;

      if (pendingScreen) pendingScreen.style.display = "none";
      if (mainApp) mainApp.style.display = "none";
      if (loginOverlay) loginOverlay.style.display = 'flex'; // إظهار شاشة الدخول
      
      // تم حذف showLoginScreen() غير المعرفة

      // تفريغ البيانات المحلية
      sections = [];
      stocks = [];
      depositData = {};
    }
  }); 

});

  // دوال إعدادات الحساب
  window.openAccountSettingsModal = function () {
    if (currentUser) {
      // تعبئة البيانات الحالية
      document.getElementById("acc-name-input").value = currentUser.displayName || "";
      document.getElementById("acc-email-input").value = currentUser.email || "";
      document.getElementById("acc-photo-input").value = currentUser.photoURL || "";

      // تحديث صورة العرض
      const preview = document.getElementById("acc-profile-pic-preview");
      if (preview) {
        preview.src = currentUser.photoURL || "https://via.placeholder.com/80";
      }

      openModal("account-settings-modal");
    }
  };

  const accForm = document.getElementById("account-settings-form");
  if (accForm) {
    accForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newName = document.getElementById("acc-name-input").value.trim();
      const newPhoto = document.getElementById("acc-photo-input").value.trim();

      if (currentUser && newName) {
        try {
          // تحديث الاسم والصورة في قاعدة بيانات Firebase Auth
          await updateProfile(currentUser, {
            displayName: newName,
            photoURL: newPhoto
          });

          // تحديث العنوان الفوري
          const headerTitle = document.getElementById('main-app-title');
          if (headerTitle) headerTitle.innerText = `لوحة تحكم المحفظة الاستثمارية (الخاصة بـ ${newName})`;

          // تحديث صورة العرض المصغرة
          const preview = document.getElementById("acc-profile-pic-preview");
          if (preview) preview.src = newPhoto || "https://via.placeholder.com/80";

          closeModal("account-settings-modal");
          alert("تم تحديث بيانات حسابك الشاملة بنجاح! 🌟");
        } catch (err) {
          console.error(err);
          alert("حدث خطأ أثناء تحديث البيانات.");
        }
      }
    });
  }

  const googleLoginBtn = document.getElementById('google-login-btn');
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
      signInWithPopup(auth, provider).catch(error => alert("فشل تسجيل الدخول: " + error.message));
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => signOut(auth).then(() => alert("تم تسجيل الخروج.")));
  }

  // نماذج الإدخال
  const stockForm = document.getElementById("stock-form"); if (stockForm) stockForm.addEventListener("submit", handleStockFormSubmit);
  const secCfgForm = document.getElementById("section-config-form"); if (secCfgForm) secCfgForm.addEventListener("submit", handleSectionConfigSubmit);
  const valEditForm = document.getElementById("value-edit-form"); if (valEditForm) valEditForm.addEventListener("submit", handleValueEditSubmit);
  const searchInput = document.getElementById("search-input"); if (searchInput) searchInput.addEventListener("input", handleSearchInput);

  window.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearchModal(); }
    if (e.key === "Escape") document.querySelectorAll(".modal-overlay.active").forEach(m => m.classList.remove("active"));
  });

  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("active"); });
  });
  window.forceLogout = function() {
  const currentAuth = getAuth();
  signOut(currentAuth).then(() => {
    console.log("تم تسجيل الخروج بنجاح");
    window.location.reload(); // تحديث الصفحة لإجبار النظام على مسح الشاشة
  }).catch((error) => {
    alert("حدث خطأ أثناء تسجيل الخروج: " + error.message);
  });
};
