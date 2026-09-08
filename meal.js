// ─────────────────────────────────────────────────────────────
//  Monthly Meal Register v2  –  meal.js
//  Auth: Firebase Google Sign-In (one manager per month)
//  DB:   Firebase Realtime Database
// ─────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
    apiKey: "AIzaSyBCL4AUrRQ0puDGCY5cjajzuIfAbTNx4i8",
    authDomain: "meal-register.firebaseapp.com",
    databaseURL: "https://meal-register-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "meal-register",
    storageBucket: "meal-register.firebasestorage.app",
    messagingSenderId: "341789648553",
    appId: "1:341789648553:web:c6ff59c9f2353bc75babb8",
    measurementId: "G-97V9KR8JLZ"
};

const COLLECTION_NAME = "meal_register";
const LOCAL_FALLBACK_KEY = "mealRegistersLocalFallback";
const MAX_DAYS = 31;

// ── Super Admin ──────────────────────────────────────────────
// No password needed: Google Sign-In already proves this Gmail's
// owner is signing in (Firebase verifies it). We just check the
// verified email against this constant. It's not a secret — it's
// an identifier — so it's fine to keep in client code. Real
// enforcement (so no one can fake it via devtools) should live in
// Firebase Realtime Database Security Rules — see note at bottom
// of this file / chat.
const SUPER_ADMIN_EMAIL = "katunnahida8@gmail.com"; // <-- put your Gmail here

// ── DOM refs ─────────────────────────────────────────────────
const table               = document.getElementById("meal-register-table");
const monthHeader         = document.getElementById("month-header");
const monthSelector       = document.getElementById("month-selector");
const membersInput        = document.getElementById("total-members-input");
const marquee             = document.getElementById("monthMarquee");
const managerModeIndicator= document.getElementById("manager-mode-indicator");
const managerNameInput    = document.getElementById("manager-name-input");
const fixedMealInput      = document.getElementById("fixed-meal-input");
const fixedMealSaveBtn    = document.getElementById("fixed-meal-save-btn");
const managerOnlyMembers  = document.getElementById("manager-only-total-members");
const bazarToggleBtn      = document.getElementById("bazar-toggle-btn");
const bazarPanel          = document.getElementById("bazar-panel");
const bazarEditor         = document.getElementById("bazar-editor");
const bazarRowsContainer  = document.getElementById("bazar-rows");
const bazarAddRowBtn      = document.getElementById("bazar-add-row-btn");
const bazarCostTotalEl    = document.getElementById("bazar-cost-total");
const noteToggleBtn       = document.getElementById("note-toggle-btn");
const notesPanel          = document.getElementById("notes-panel");
const notesEditor         = document.getElementById("notes-editor");
const notesRowsContainer  = document.getElementById("notes-rows");
const notesAddRowBtn      = document.getElementById("notes-add-row-btn");
const notesCostTotalEl    = document.getElementById("notes-cost-total");
const depositToggleBtn    = document.getElementById("deposit-toggle-btn");
const depositPanel        = document.getElementById("deposit-panel");
const depositList         = document.getElementById("deposit-list");
const depositTotal        = document.getElementById("deposit-total");
const bazarDateToggleBtn  = document.getElementById("bazardate-toggle-btn");
const bazarDatePanel      = document.getElementById("bazardate-panel");
const bazarDateRowsContainer = document.getElementById("bazardate-rows");
const bazarDateAddRowBtn  = document.getElementById("bazardate-add-row-btn");
const googleSigninBtn     = document.getElementById("google-signin-btn");
const managerLogoutBtn    = document.getElementById("manager-logout-btn");
const changeManagerBtn    = document.getElementById("change-manager-btn");
const authError           = document.getElementById("auth-error");
const authErrorText       = document.getElementById("auth-error-text");
const skeletonOverlay     = document.getElementById("skeleton-overlay");

// ── State ─────────────────────────────────────────────────────
let db                 = null;
let isFirebaseMode     = false;
let monthDocRef        = null;
let unsubscribeMonth   = null;

let numPeople          = 20;
let fixedMeal          = 60;
let mealData           = [];
let isManagerMode      = false;
let isBazarVisible     = false;
let isNoteVisible      = false;
let isDepositVisible   = false;
let isBazarDateVisible = false;
let bazarCostText      = "";
let monthNote          = "";
let bazarRows          = [];   // legacy/unused now that Bazar Cost rows are derived from bazarDates (see renderBazarCostRows) — kept only so the shared notepad-row helpers below still type-check for "notes"
let noteRows           = [];   // parsed rows for the Additional Cost notepad editor
let costRowSeq         = 0;
let depositData        = [];
let bazarDates         = [];   // [{id, date:"YYYY-MM-DD", names}] — Bazarer Date entries
let bazarDateRowSeq    = 0;
let selectedMonthDate  = monthStart(new Date());
let selectedMonthDays  = getDaysInMonth(selectedMonthDate);
let currentUser        = null;   // firebase.auth().currentUser
let storedManagerEmail = "";     // from Firebase for the selected month
let cleanupAttempted = false;

// ── Date helpers ──────────────────────────────────────────────
function monthStart(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }
function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}
function parseMonthKey(key) { const [y,m]=key.split("-").map(Number); return new Date(y,m-1,1); }
function getMonthLabel(date) { return date.toLocaleDateString("en-US",{month:"long",year:"numeric"}); }
function getDaysInMonth(date) { return new Date(date.getFullYear(),date.getMonth()+1,0).getDate(); }
function isCurrentMonthView() { return getMonthKey(selectedMonthDate)===getMonthKey(monthStart(new Date())); }
function isReadOnlyForUser() { return !isSuperAdmin() && !isCurrentMonthView(); }
function getTodayDay() { return new Date().getDate(); }

// ── Bazarer Date helpers ────────────────────────────────────────
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
// Parsed with explicit Y/M/D (not `new Date(str)`) so the date is always
// local midnight — a plain ISO-string parse can land on UTC midnight,
// which silently shifts a day backwards for anyone east of UTC.
function parseISODateLocal(str) {
    if (typeof str !== "string") return null;
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
}
function formatBazarDateDisplay(str) {
    const d = parseISODateLocal(str);
    if (!d) return "Pick a date";
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = String(d.getFullYear()).slice(-2);
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    return weekday;
}
// "DD/MM/YY" form used to mirror a Bazarer Date row into Bazar Cost
// (e.g. "01/09/26"), distinct from formatBazarDateDisplay's weekday label.
function formatBazarDateDDMMYY(str) {
    const d = parseISODateLocal(str);
    if (!d) return "";
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
}
// No date entered yet (brand-new row) is never treated as "past" — it's
// only locked once a real date has actually elapsed.
function isBazarDatePast(str) {
    const d = parseISODateLocal(str);
    if (!d) return false;
    return d.getTime() < parseISODateLocal(todayISO()).getTime();
}
// Manager/Super Admin only — kept this way on purpose, do not loosen to
// let normal members add/edit rows.
function canEditBazarDateRow(row) {
    return isManagerMode;
}

function canAddBazarDate() {
    return isManagerMode;
}

// The date field is now "type just the day, month/year auto-fill" (e.g.
// type "06", shown as "06 /09/26") instead of a native date picker —
// month/year always come from whichever month is currently open.
function getBazarDateSuffix() {
    const mm = String(selectedMonthDate.getMonth()+1).padStart(2,"0");
    const yy = String(selectedMonthDate.getFullYear()).slice(-2);
    return `/${mm}/${yy}`;
}
function getBazarDateDayPart(dateStr) {
    const d = parseISODateLocal(dateStr);
    return d ? String(d.getDate()).padStart(2,"0") : "";
}
function buildBazarDateFromDay(dayNum) {
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > selectedMonthDays) return "";
    const y = selectedMonthDate.getFullYear();
    const m = selectedMonthDate.getMonth();
    return `${y}-${String(m+1).padStart(2,"0")}-${String(dayNum).padStart(2,"0")}`;
}

// ── Number helpers ────────────────────────────────────────────
function parseInput(v) { const n=parseFloat(v); return Number.isFinite(n)&&n>=0?n:0; }
function formatNumber(n) { return Number.isInteger(n)?String(n):n.toFixed(1); }

// ── Toast ─────────────────────────────────────────────────────
const toast = document.getElementById("toast");
let toastTimer = null;
function showMessage(text, isError=false) {
    toast.textContent = (isError ? "✗ " : "✓ ") + text;
    toast.className = "visible " + (isError ? "error" : "success");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ toast.className=""; }, 2200);
}

// ── Auth error chip ───────────────────────────────────────────
function showAuthError(text) {
    authErrorText.textContent = text;
    authError.classList.remove("hidden");
    authError.classList.add("flex");
    setTimeout(()=>{
        authError.classList.add("hidden");
        authError.classList.remove("flex");
    }, 4000);
}

// ── Skeleton ──────────────────────────────────────────────────
function hideSkeleton() { if (skeletonOverlay) skeletonOverlay.style.display="none"; }

// ── Data defaults ─────────────────────────────────────────────
function getDefaultMember(i) {
    return {
        name: `Member ${i+1}`,
        nameLocked: false,
        meals: Array(MAX_DAYS).fill(0),
        guestMeals: Array(MAX_DAYS).fill(0),
        mealLocked: Array(MAX_DAYS).fill(false),
        guestMealLocked: Array(MAX_DAYS).fill(false),
        fixedMealOff: false,
        customFixedMeal: null
    };
}

function normalizeArray(raw, len, def) {
    const src = Array.isArray(raw)?raw:[];
    const out = src.slice(0,len);
    while(out.length<len) out.push(def);
    return out;
}

function normalizeMember(m, i) {
    const base = getDefaultMember(i);
    const s = m&&typeof m==="object"?m:{};
    const name = typeof s.name==="string"&&s.name.trim()?s.name.trim():base.name;
    const customFixedMeal = (typeof s.customFixedMeal==="number" && Number.isFinite(s.customFixedMeal) && s.customFixedMeal>=0)
        ? s.customFixedMeal
        : null;
    return {
        name,
        nameLocked: Boolean(s.nameLocked),
        meals: normalizeArray(s.meals,MAX_DAYS,0).map(parseInput),
        guestMeals: normalizeArray(s.guestMeals,MAX_DAYS,0).map(parseInput),
        mealLocked: normalizeArray(s.mealLocked,MAX_DAYS,false).map(Boolean),
        guestMealLocked: normalizeArray(s.guestMealLocked,MAX_DAYS,false).map(Boolean),
        fixedMealOff: Boolean(s.fixedMealOff),
        customFixedMeal
    };
}

function normalizeMembers(members, count) {
    const src = Array.isArray(members)?members:[];
    return Array.from({length:count},(_,i)=>normalizeMember(src[i],i));
}

function normalizeDeposits(deposits, count) {
    const src = Array.isArray(deposits)
        ? deposits
        : (deposits && typeof deposits==="object" ? deposits : {});
    return Array.from({length:count},(_,i)=>parseInput(src[i]));
}

function nextBazarDateRowId() { return `bd${++bazarDateRowSeq}`; }

// Firebase can hand back an array or (if entries were removed leaving
// gaps) an object keyed by index — accept either. Missing/blank ids get
// a fresh local id so rows always have something unique to key off of.
function normalizeBazarDates(raw) {
    const src = Array.isArray(raw)
        ? raw
        : (raw && typeof raw==="object" ? Object.values(raw) : []);
    return src
        .filter(r => r && typeof r==="object")
        .map(r => ({
            id: typeof r.id==="string" && r.id ? r.id : nextBazarDateRowId(),
            date: typeof r.date==="string" ? r.date : "",
            names: typeof r.names==="string" ? r.names : "",
            amount: parseCostAmount(r.amount)
        }));
}

// ── Firebase init ─────────────────────────────────────────────
function initFirebase() {
    if (!FIREBASE_CONFIG?.apiKey) { isFirebaseMode=false; return false; }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    try { firebase.analytics(); } catch(e) {}
    isFirebaseMode = true;
    return true;
}

// ── Auth helpers ──────────────────────────────────────────────
function isSuperAdmin() {
    return Boolean(currentUser) && currentUser.email === SUPER_ADMIN_EMAIL;
}

function computeManagerMode() {
    if (!currentUser) { isManagerMode=false; return; }
    isManagerMode = isSuperAdmin() || (
        isCurrentMonthView() &&
        storedManagerEmail !== "" &&
        currentUser.email === storedManagerEmail
    );
}

// ── updateManagerUI ───────────────────────────────────────────
function updateManagerUI() {
    computeManagerMode();
    const isManager = isManagerMode;
    const readOnly  = isReadOnlyForUser();

    // Auth buttons
    if (currentUser) {
        googleSigninBtn.classList.add("hidden");
        managerLogoutBtn.classList.remove("hidden");
    } else {
        googleSigninBtn.classList.remove("hidden");
        managerLogoutBtn.classList.add("hidden");
    }
    if (changeManagerBtn) changeManagerBtn.classList.toggle("hidden", !isSuperAdmin());

    // Mode indicator
    const photoHTML = currentUser?.photoURL
        ? `<img src="${currentUser.photoURL}" class="avatar" alt="">`
        : `<i class="fas fa-user-shield text-xs"></i>`;

    if (isSuperAdmin()) {
        managerModeIndicator.innerHTML = `${photoHTML} Super Admin <span class="manager-badge">★</span>`;
    } else if (isManager) {
        managerModeIndicator.innerHTML = `${photoHTML} Manager Mode <span class="manager-badge">✓</span>`;
    } else if (currentUser && !isManager && isCurrentMonthView()) {
        managerModeIndicator.innerHTML = `<i class="fas fa-eye text-xs"></i> Viewer (another manager is set)`;
    } else if (!isCurrentMonthView()) {
        managerModeIndicator.innerHTML = `<i class="fas fa-history text-xs"></i> History (read-only)`;
    } else {
        managerModeIndicator.textContent = "";
    }

    // Manager-only controls
    fixedMealSaveBtn.classList.toggle("hidden", !isManager);
    managerOnlyMembers.classList.toggle("hidden", !isManager);

    // Disable/enable inputs
    fixedMealInput.disabled  = !isManager || readOnly;
    membersInput.disabled    = !isManager || readOnly;
    if (bazarEditor) bazarEditor.disabled  = !isManager || readOnly;
    if (notesEditor) notesEditor.disabled  = !isManager || readOnly;
    const costEditable = isManager && !readOnly;
    if (bazarRowsContainer) {
        bazarRowsContainer.querySelectorAll(".cost-desc-input, .cost-amount-input, .cost-row-delete")
            .forEach(el => { el.disabled = !costEditable; });
    }
    if (bazarAddRowBtn) bazarAddRowBtn.disabled = !costEditable;
    if (notesRowsContainer) {
        notesRowsContainer.querySelectorAll(".cost-desc-input, .cost-amount-input, .cost-row-delete")
            .forEach(el => { el.disabled = !costEditable; });
    }
    if (notesAddRowBtn) notesAddRowBtn.disabled = !costEditable;
    if (depositList) {
        depositList.querySelectorAll(".deposit-input").forEach(input => {
            input.disabled = !isManager || readOnly;
        });
    }

    if (managerNameInput) {
        managerNameInput.readOnly = !isManager;
        managerNameInput.classList.toggle("manager-name-locked", !isManager);
    }

    renderTable();
    renderBazarDates();
}

// ── Header / notice ───────────────────────────────────────────
function updateHeaderAndNotice() {
    const label = getMonthLabel(monthStart(new Date()));
    monthHeader.textContent = label;
    if (marquee) marquee.textContent = `${label} — Time Left`;
}

// ── Render panels ─────────────────────────────────────────────
// Bazar Cost rows are now derived straight from bazarDates — see
// renderBazarCostRows() further down, next to the rest of the
// Bazarer Date → Bazar Cost sync logic.
function renderBazarCost() {
    renderBazarCostRows();
}

function renderNotes() {
    notesPanel.classList.toggle("visible", isNoteVisible);
    if (notesEditor) {
        notesEditor.value = monthNote;
        notesEditor.disabled = !isManagerMode || isReadOnlyForUser();
    }
    if (notesRowsContainer && notesRowsContainer.contains(document.activeElement)) return;
    if (serializeRows(noteRows) !== monthNote) {
        noteRows = parseRowsFromText(monthNote);
    }
    renderCostRows("notes");
}

// ── Ruled notepad row editor (Bazar Cost / Additional Cost) ────
function nextRowId() { return `r${++costRowSeq}`; }

// Grows the description textarea to fit wrapped text (instead of letting
// long item names run under the amount box) — resets to "auto" first so
// it can shrink back down too when text is edited shorter.
function autoResizeDescInput(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
}

// /for-all's totals page scans each saved line for a literal ASCII "="
// followed by digits, ANYWHERE in the line — not just the amount we
// intentionally write. So a stray "=" the user types into the
// description itself (e.g. testing "=500") would still get counted as
// a real cost there even with the "- " prefix below. Swap it for a
// look-alike full-width "＝" (different character, same look) whenever
// it's not our own deliberate amount marker, and swap back on read —
// so what the manager sees is untouched, but only a genuine amount
// (from the ৳ box) can ever reach /for-all's total.
const STORAGE_EQUALS_ESCAPE = "＝";
function escapeDescForStorage(desc) { return (desc || "").replace(/=/g, STORAGE_EQUALS_ESCAPE); }
function unescapeDescFromStorage(desc) { return (desc || "").replace(/＝/g, "="); }

function parseCostAmount(str) {
    if (str === null || str === undefined) return null;
    const cleaned = String(str).replace(/,/g, "").trim();
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

// Best-effort parse of a saved text line into {desc, amount}. Understands
// the new "Item = Amount" / "Item: Amount" row format, and degrades
// gracefully for older freeform notes (kept as a description-only row)
// so previously saved Bazar/Additional Cost text stays readable.
function parseCostLine(line) {
    const raw = line.replace(/\r$/, "");
    const m = raw.match(/^(.*?)[:=]\s*৳?\s*(-?[\d][\d,.]*)\s*$/);
    if (m) {
        const amount = parseCostAmount(m[2]);
        if (amount !== null) {
            return { desc: unescapeDescFromStorage(m[1].replace(/[-–:]\s*$/, "").trim()), amount };
        }
    }
    let desc = raw.trim();
    // Strip the "- " marker serializeRows adds to description-only lines
    // (see there for why) so it doesn't show up in the item box on reload.
    if (desc.startsWith("- ")) desc = desc.slice(2).trim();
    return { desc: unescapeDescFromStorage(desc), amount: null };
}

function parseRowsFromText(text) {
    return (text || "").split("\n")
        .filter(l => l.trim() !== "")
        .map(l => ({ id: nextRowId(), ...parseCostLine(l) }));
}

// Mirrors parseCostLine's format so round-tripping through the row editor
// keeps writing into the same bazarCost/note text fields /for-all reads.
// /for-all's totals page sums any line containing "=<number>" AND any
// line that is a bare stand-alone number — so a description-only row
// (no amount entered yet) is always prefixed with "- " to guarantee it's
// neither, otherwise typing a plain number as an item name would get
// silently counted into the total there.
function serializeRows(rows) {
    return rows
        .filter(r => (r.desc && r.desc.trim() !== "") || r.amount !== null)
        .map(r => {
            const desc = escapeDescForStorage((r.desc || "").trim());
            if (r.amount !== null && Number.isFinite(r.amount)) {
                return desc ? `${desc} = ${formatNumber(r.amount)}` : `= ${formatNumber(r.amount)}`;
            }
            return `- ${desc}`;
        })
        .join("\n");
}

function sumRows(rows) {
    return rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
}

function renderCostRows(kind) {
    const isBazar   = kind === "bazar";
    const rows      = isBazar ? bazarRows : noteRows;
    const container = isBazar ? bazarRowsContainer : notesRowsContainer;
    const totalEl   = isBazar ? bazarCostTotalEl : notesCostTotalEl;
    if (!container) return;

    const editable = isManagerMode && !isReadOnlyForUser();
    if (rows.length === 0) rows.push({ id: nextRowId(), desc: "", amount: null });

    // Preserve focus/selection across a rebuild (e.g. the Firebase listener
    // re-firing on our own save) so typing isn't interrupted.
    const active = document.activeElement;
    let focusInfo = null;
    if (active && container.contains(active)) {
        const rowEl = active.closest(".cost-row");
        if (rowEl) {
            focusInfo = {
                rowId: rowEl.dataset.rowId,
                field: active.classList.contains("cost-desc-input") ? "desc" : "amount",
                selStart: active.selectionStart,
                selEnd: active.selectionEnd
            };
        }
    }

    container.innerHTML = "";
    rows.forEach(row => {
        const rowEl = document.createElement("div");
        rowEl.className = "cost-row";
        rowEl.dataset.rowId = row.id;

        const descInput = document.createElement("textarea");
        descInput.rows = 1;
        descInput.className = "cost-desc-input";
        descInput.placeholder = "Name";
        descInput.value = row.desc || "";
        descInput.disabled = !editable;

        const amountWrap = document.createElement("div");
        amountWrap.className = "cost-amount-wrap";
        const currency = document.createElement("span");
        currency.className = "cost-currency";
        currency.textContent = "৳";
        const amountInput = document.createElement("input");
        amountInput.type = "number";
        amountInput.className = "cost-amount-input";
        amountInput.placeholder = "0";
        amountInput.min = "0";
        amountInput.step = "any";
        amountInput.value = row.amount !== null ? row.amount : "";
        amountInput.disabled = !editable;
        amountWrap.append(currency, amountInput);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "cost-row-delete";
        delBtn.title = "Remove row";
        delBtn.innerHTML = '<i class="fas fa-times"></i>';
        delBtn.disabled = !editable;

        rowEl.append(descInput, amountWrap, delBtn);
        container.appendChild(rowEl);
        autoResizeDescInput(descInput);
    });

    if (focusInfo) {
        const rowEl  = container.querySelector(`.cost-row[data-row-id="${focusInfo.rowId}"]`);
        const input  = rowEl && rowEl.querySelector(focusInfo.field === "desc" ? ".cost-desc-input" : ".cost-amount-input");
        if (input) {
            input.focus();
            if (input.type === "text" && typeof input.setSelectionRange === "function") {
                try { input.setSelectionRange(focusInfo.selStart, focusInfo.selEnd); } catch (e) {}
            }
        }
    }

    const addBtn = isBazar ? bazarAddRowBtn : notesAddRowBtn;
    if (addBtn) addBtn.disabled = !editable;

    if (totalEl) totalEl.textContent = `৳ ${formatNumber(sumRows(rows))}`;
}

function getCostState(kind) {
    const isBazar = kind === "bazar";
    return {
        isBazar,
        rows:        isBazar ? bazarRows : noteRows,
        container:   isBazar ? bazarRowsContainer : notesRowsContainer,
        totalEl:     isBazar ? bazarCostTotalEl : notesCostTotalEl,
        saveKey:     isBazar ? "bazarCost" : "note",
        debounceKey: isBazar ? "bazar-cost-text" : "note-text"
    };
}

function saveCostRows(kind, showFeedback = false) {
    const st = getCostState(kind);
    const text = serializeRows(st.rows);
    if (st.isBazar) bazarCostText = text; else monthNote = text;
    return saveFields({ [st.saveKey]: text }, showFeedback);
}

function handleCostRowInput(kind, event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const st = getCostState(kind);
    const target = event.target;
    const rowEl = target.closest(".cost-row");
    if (!rowEl) return;
    const idx = st.rows.findIndex(r => r.id === rowEl.dataset.rowId);
    if (idx === -1) return;

    if (target.classList.contains("cost-desc-input")) {
        st.rows[idx].desc = target.value;
        autoResizeDescInput(target);
    } else if (target.classList.contains("cost-amount-input")) {
        st.rows[idx].amount = parseCostAmount(target.value);
    } else {
        return;
    }

    if (st.totalEl) st.totalEl.textContent = `৳ ${formatNumber(sumRows(st.rows))}`;

    debounceKeyed(st.debounceKey, () => {
        saveCostRows(kind).catch(err => { console.error(err); showMessage("Save failed", true); });
    }, 350);
}

function handleCostRowBlur(kind, event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const target = event.target;
    if (!target.classList || (!target.classList.contains("cost-desc-input") && !target.classList.contains("cost-amount-input"))) return;
    saveCostRows(kind, true).catch(err => { console.error(err); showMessage("Save failed", true); });
}

function handleCostRowClick(kind, event) {
    const delBtn = event.target.closest(".cost-row-delete");
    if (!delBtn) return;
    if (!isManagerMode || isReadOnlyForUser()) return;
    const st = getCostState(kind);
    const rowEl = delBtn.closest(".cost-row");
    const idx = st.rows.findIndex(r => r.id === rowEl?.dataset.rowId);
    if (idx === -1) return;
    st.rows.splice(idx, 1);
    if (st.rows.length === 0) st.rows.push({ id: nextRowId(), desc: "", amount: null });
    renderCostRows(kind);
    saveCostRows(kind, true).catch(err => { console.error(err); showMessage("Save failed", true); });
}

function handleCostAddRow(kind) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const st = getCostState(kind);
    const row = { id: nextRowId(), desc: "", amount: null };
    st.rows.push(row);
    renderCostRows(kind);
    const input = st.container?.querySelector(`.cost-row[data-row-id="${row.id}"] .cost-desc-input`);
    if (input) input.focus();
}

function handleCostRowKeydown(kind, event) {
    if (event.key !== "Enter") return;
    const target = event.target;
    if (!target.classList.contains("cost-desc-input") && !target.classList.contains("cost-amount-input")) return;
    event.preventDefault();
    const st = getCostState(kind);
    const rowEl = target.closest(".cost-row");
    const idx = st.rows.findIndex(r => r.id === rowEl?.dataset.rowId);
    if (idx === -1) return;

    if (target.classList.contains("cost-desc-input")) {
        rowEl.querySelector(".cost-amount-input")?.focus();
        return;
    }
    if (idx === st.rows.length - 1) {
        handleCostAddRow(kind);
    } else {
        st.container.children[idx + 1]?.querySelector(".cost-desc-input")?.focus();
    }
}

function renderDeposits() {
    if (!depositPanel || !depositList) return;
    depositPanel.classList.toggle("visible", isDepositVisible);
    depositData = normalizeDeposits(depositData, numPeople);

    // Same fix as the table/cost rows: don't tear down a deposit input
    // while the manager is actively typing in it (echo of our own or
    // another device's save). The total already stays live via
    // handleDepositInputChange, so just skip the rebuild until they
    // move to a different field.
    if (document.activeElement && depositList.contains(document.activeElement)) {
        updateDepositTotal();
        return;
    }

    depositList.innerHTML = "";
    mealData.forEach((person, pi) => {
        const row = document.createElement("div");
        row.className = "deposit-row";

        const serial = document.createElement("div");
        serial.className = "deposit-serial";
        serial.textContent = String(pi+1);

        const name = document.createElement("div");
        name.className = "deposit-name";
        name.textContent = person.name;
        name.title = person.name;

        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.className = "deposit-input";
        input.dataset.person = String(pi);
        input.value = depositData[pi] ? formatNumber(depositData[pi]) : "";
        input.placeholder = "0";
        input.disabled = !isManagerMode || isReadOnlyForUser();

        row.append(serial, name, input);
        depositList.appendChild(row);
    });

    updateDepositTotal();
}

function updateDepositTotal() {
    if (!depositTotal) return;
    const total = depositData.reduce((sum, value) => sum + parseInput(value), 0);
    depositTotal.textContent = `${formatNumber(total)} Tk`;
}

// ── Bazarer Date panel ──────────────────────────────────────────
// A free-form, addable/removable list (not one column per calendar day)
// since bazar trips aren't necessarily daily — could be every 2-3 days
// or irregular. Each row is a date + who went. Anyone can add/edit a
// row for today or a future date; once that date passes, only the
// Manager/Super Admin can still touch that specific row (see
// canEditBazarDateRow above) — editability is per-row, not per-month.
// A brand-new month (or one with every row deleted) always keeps at
// least one blank editable row around, both here and in Bazar Cost.
function ensureBazarDatesNotEmpty() {
    if (bazarDates.length === 0) bazarDates.push({ id: nextBazarDateRowId(), date: "", names: "", amount: null });
}

// Shared ordering (date order, blank/undated rows last) used by both the
// Bazarer Date panel and the Bazar Cost panel below, so the two stay in
// perfect lock-step without reordering the underlying array (Firebase
// array indices don't need to match display order here).
function orderBazarDates() {
    ensureBazarDatesNotEmpty();
    return [...bazarDates].sort((a,b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
}

function renderBazarDates() {
    if (!bazarDatePanel || !bazarDateRowsContainer) return;
    bazarDatePanel.classList.toggle("visible", isBazarDateVisible);

    // Only skip the rebuild while someone is actively TYPING in a day or
    // name field (so a Firebase echo of our own save doesn't yank the
    // cursor mid-keystroke). A focused delete button must NOT trigger
    // this skip, or clicking delete would splice the row out of the
    // array but never rebuild the DOM to reflect it — which is exactly
    // what made the ✕ button look broken.
    const active = document.activeElement;
    if (active && bazarDateRowsContainer.contains(active) &&
        (active.classList.contains("bazardate-day-input") || active.classList.contains("bazardate-name-input"))) {
        return;
    }

    // NOTE: intentionally NOT orderBazarDates() here. This panel is an
    // input list, not a report — sorting it by date meant a row's
    // on-screen position jumped the instant its date changed (or even
    // mid-keystroke, before the date was finished). The manager would
    // finish typing a date, tap into what looked like the same row's
    // name field, and actually be typing into a different row that had
    // shifted into that screen position. Keeping insertion order fixes
    // that; orderBazarDates() is still used below for the Bazar Cost
    // mirror, so that view stays sorted by date as before.
    ensureBazarDatesNotEmpty();
    const ordered = bazarDates;
    const suffix = getBazarDateSuffix();

    bazarDateRowsContainer.innerHTML = "";
    ordered.forEach(row => {
        const editable = canEditBazarDateRow(row);

        const rowEl = document.createElement("div");
        rowEl.className = "bazardate-row" + (editable ? "" : " bazardate-row-locked");
        rowEl.dataset.rowId = row.id;

        const dateBlock = document.createElement("div");
        dateBlock.className = "bazardate-date-block";

        const dateWrap = document.createElement("div");
        dateWrap.className = "bazardate-date-input-wrap";

        const dayInput = document.createElement("input");
        dayInput.type = "text";
        dayInput.inputMode = "numeric";
        dayInput.pattern = "[0-9]*";
        dayInput.maxLength = 2;
        dayInput.className = "bazardate-day-input";
        dayInput.placeholder = "DD";
        dayInput.value = getBazarDateDayPart(row.date);
        dayInput.disabled = !editable;

        const suffixSpan = document.createElement("span");
        suffixSpan.className = "bazardate-date-suffix";
        suffixSpan.textContent = suffix;

        dateWrap.append(dayInput, suffixSpan);

        const dayLabel = document.createElement("div");
        dayLabel.className = "bazardate-day-label";
        dayLabel.textContent = row.date ? formatBazarDateDisplay(row.date) : "Pick a day";

        dateBlock.append(dateWrap, dayLabel);

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "bazardate-name-input";
        nameInput.placeholder = "Bazar Karir Nam";
        nameInput.value = row.names || "";
        nameInput.disabled = !editable;

        const trailing = document.createElement("div");
        trailing.className = "bazardate-row-trailing";
        if (editable) {
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "bazardate-row-delete";
            delBtn.title = "Remove row";
            delBtn.innerHTML = '<i class="fas fa-times"></i>';
            trailing.appendChild(delBtn);
        } else {
            const lockIcon = document.createElement("span");
            lockIcon.className = "bazardate-lock-icon";
            lockIcon.title = "This date has passed — only Manager/Super Admin can edit it now";
            lockIcon.innerHTML = '<i class="fas fa-lock"></i>';
            trailing.appendChild(lockIcon);
        }

        rowEl.append(dateBlock, nameInput, trailing);
        bazarDateRowsContainer.appendChild(rowEl);
    });

    if (bazarDateAddRowBtn) bazarDateAddRowBtn.disabled = !canAddBazarDate();
}

// Writes the bazarDates array AND the bazarCost text mirror derived from
// it (see regenerateBazarCostText) in the same update, so the two never
// drift apart. Unlike saveFields(), this is intentionally NOT gated
// behind isManagerMode — normal members are meant to be able to log a
// bazar date/name themselves, and that should be reflected in Bazar Cost
// immediately too. Per-row edit permission is enforced before this is
// ever called (see canEditBazarDateRow / the handlers below); real
// enforcement against a malicious client still belongs in Firebase
// Security Rules, same caveat as the rest of this file. Only the ৳
// amount itself stays manager-gated — see saveBazarCostAmounts below.
async function saveBazarDates(showFeedback=false) {
    if (isReadOnlyForUser() && !isManagerMode) return; // whole-month history: blocked for non-admins
    const monthKey = getMonthKey(selectedMonthDate);
    regenerateBazarCostText();
    const payload = { bazarDates, bazarCost: bazarCostText, updatedAt: Date.now() };
    if (!db) {
        mergeLocalFields(monthKey, payload);
        if (showFeedback) showMessage("Saved!");
        return;
    }
    if (!monthDocRef) return;
    await monthDocRef.update(payload);
    if (showFeedback) showMessage("Saved!");
}

function findBazarDateRow(id) { return bazarDates.find(r => r.id === id); }

function handleBazarDateInput(event) {
    const target = event.target;
    const rowEl = target.closest(".bazardate-row");
    if (!rowEl) return;
    const row = findBazarDateRow(rowEl.dataset.rowId);
    if (!row || !canEditBazarDateRow(row)) return;

    if (target.classList.contains("bazardate-day-input")) {
        const digits = target.value.replace(/\D/g,"").slice(0,2);
        if (digits !== target.value) target.value = digits;
        const label = rowEl.querySelector(".bazardate-day-label");

        // A single digit ("1") could still turn into "15" — don't commit
        // row.date, mirror it into Bazar Cost, or fire a save off just
        // one digit. Wait for the day to be complete (2 digits); a lone
        // leftover digit still gets committed on blur (see
        // handleBazarDateBlur) so e.g. day "5" alone still saves.
        if (digits.length < 2) {
            if (label) label.textContent = "Pick a day";
            return;
        }
        const dayNum = parseInt(digits,10);
        row.date = buildBazarDateFromDay(dayNum);
        if (label) label.textContent = row.date ? formatBazarDateDisplay(row.date) : "Pick a day";
    } else if (target.classList.contains("bazardate-name-input")) {
        row.names = target.value;
    } else {
        return;
    }

    // Live-mirror the date/name text into Bazar Cost as they type, so the
    // row already reads e.g. "01/09/26 Jsim+Karim" the moment it's typed
    // here — the actual DB write is still debounced below.
    renderBazarCostRows();

    // Require both date AND name before anything gets written to
    // Firebase — a row with just a date typed in (name still empty)
    // should stay local-only until the name is filled in too.
    if (!row.date || !(row.names || "").trim()) return;

    debounceKeyed("bazarDates", () => {
        saveBazarDates().catch(err => { console.error(err); showMessage("Save failed", true); });
    }, 400);
}

function handleBazarDateBlur(event) {
    const target = event.target;
    if (!target.classList || (!target.classList.contains("bazardate-day-input") && !target.classList.contains("bazardate-name-input"))) return;
    const rowEl = target.closest(".bazardate-row");
    const row = rowEl && findBazarDateRow(rowEl.dataset.rowId);
    if (!row || !canEditBazarDateRow(row)) return;

    if (target.classList.contains("bazardate-day-input")) {
        const digits = target.value.replace(/\D/g,"").slice(0,2);
        if (digits.length === 1) {
            const dayNum = parseInt(digits,10);
            row.date = buildBazarDateFromDay(dayNum);
            const label = rowEl.querySelector(".bazardate-day-label");
            if (label) label.textContent = row.date ? formatBazarDateDisplay(row.date) : "Pick a day";
            renderBazarCostRows();
        }
    }

    // Same rule as typing: leaving the field with only a date (no name
    // yet) — or only a name (no date yet) — should NOT save.
    if (!row.date || !(row.names || "").trim()) return;

    saveBazarDates(true).catch(err => { console.error(err); showMessage("Save failed", true); });
}

function handleBazarDateClick(event) {
    const delBtn = event.target.closest(".bazardate-row-delete");
    if (!delBtn) return;
    const rowEl = delBtn.closest(".bazardate-row");
    const row = rowEl && findBazarDateRow(rowEl.dataset.rowId);
    if (!row || !canEditBazarDateRow(row)) return;
    const idx = bazarDates.findIndex(r => r.id === row.id);
    if (idx === -1) return;
    bazarDates.splice(idx, 1);
    ensureBazarDatesNotEmpty();
    // Move focus off the (about-to-be-removed) delete button first so the
    // active-element check above never sees it as "still being edited".
    if (document.activeElement === delBtn) delBtn.blur();
    renderBazarDates();
    renderBazarCostRows();
    saveBazarDates(true).catch(err => { console.error(err); showMessage("Save failed", true); });
}

function handleBazarDateAddRow() {
    if (!canAddBazarDate()) return;
    const row = { id: nextBazarDateRowId(), date: "", names: "", amount: null };
    bazarDates.push(row);
    renderBazarDates();
    renderBazarCostRows();
    const input = bazarDateRowsContainer?.querySelector(`.bazardate-row[data-row-id="${row.id}"] .bazardate-day-input`);
    if (input) input.focus();
}

// ── Bazar Cost — derived 1:1 from Bazarer Date ─────────────────
// Bazar Cost no longer has its own independent list of names: every row
// in Bazarer Date produces exactly one mirrored row here, with the exact
// same date + name text (e.g. a Bazarer Date row "01/09/26  Jsim+Karim"
// shows up here as "01/09/26 Jsim+Karim"). Nobody adds/removes/renames a
// row from inside Bazar Cost any more — that all happens over in
// Bazarer Date. The Manager/Super Admin's only job here is typing in the
// ৳ amount for each row.
function formatBazarCostLabel(row) {
    const datePart = formatBazarDateDDMMYY(row.date);
    const dayNamePart = row.date ? formatBazarDateDisplay(row.date) : "";
    const namesPart = (row.names || "").trim();
    return [datePart, dayNamePart, namesPart].filter(Boolean).join(" ");
}

// Mirrors parseCostLine's "desc = amount" / "- desc" format so the saved
// bazarCost text stays readable by /for-all's totals page exactly like
// before, just with the description always sourced from the linked
// Bazarer Date row instead of being typed independently.
function buildBazarCostLineForDate(row) {
    const desc = escapeDescForStorage(formatBazarCostLabel(row));
    if (!desc) return null;
    if (row.amount !== null && Number.isFinite(row.amount)) {
        return `${desc} = ${formatNumber(row.amount)}`;
    }
    return `- ${desc}`;
}

function regenerateBazarCostText() {
    bazarCostText = orderBazarDates()
        .map(buildBazarCostLineForDate)
        .filter(line => line !== null)
        .join("\n");
}

function sumBazarDateAmounts() {
    return bazarDates.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
}

// Same three-part label as formatBazarCostLabel, but for on-screen
// display only — inserts a small arrow icon right before the person's
// name, as a visual pointer to "who went". This never touches the saved
// bazarCost text (formatBazarCostLabel stays plain), so parseCostLine /
// the /for-all totals page are unaffected.
function renderBazarCostDisplayLabel(descEl, row) {
    const datePart = formatBazarDateDDMMYY(row.date);
    const dayNamePart = row.date ? formatBazarDateDisplay(row.date) : "";
    const namesPart = (row.names || "").trim();

    descEl.textContent = "";
    const lead = [datePart, dayNamePart].filter(Boolean).join(" ");
    if (lead) descEl.appendChild(document.createTextNode(lead + (namesPart ? " " : "")));
    if (namesPart) {
        const arrow = document.createElement("i");
        arrow.className = "fas fa-arrow-right";
        arrow.style.margin = "0 4px";
        arrow.style.fontSize = "0.85em";
        arrow.style.opacity = "0.65";
        descEl.appendChild(arrow);
        descEl.appendChild(document.createTextNode(" " + namesPart));
    }
}

function renderBazarCostRows() {
    if (!bazarPanel) return;
    bazarPanel.classList.toggle("visible", isBazarVisible);
    if (!bazarRowsContainer) return;

    const editable = isManagerMode && !isReadOnlyForUser();

    // Same focus-preservation pattern as the rest of the app: while the
    // manager is actively typing an amount, just keep the live total
    // ticking over and skip the full rebuild so a Firebase echo of our
    // own save doesn't yank the cursor mid-keystroke.
    const active = document.activeElement;
    if (active && bazarRowsContainer.contains(active) && active.classList.contains("cost-amount-input")) {
        if (bazarCostTotalEl) bazarCostTotalEl.textContent = `৳ ${formatNumber(sumBazarDateAmounts())}`;
        return;
    }

    // Only rows that actually have a date and/or a name typed in Bazarer
    // Date show up here — an untouched blank placeholder row has nothing
    // to attach an amount to yet.
    const ordered = orderBazarDates().filter(row => row.date || (row.names || "").trim());

    bazarRowsContainer.innerHTML = "";
    ordered.forEach(row => {
        const rowEl = document.createElement("div");
        rowEl.className = "cost-row";
        rowEl.dataset.rowId = row.id;

        const descEl = document.createElement("div");
        descEl.className = "cost-desc-input cost-desc-display";
        renderBazarCostDisplayLabel(descEl, row);
        descEl.title = "Set from Bazarer Date";

        const amountWrap = document.createElement("div");
        amountWrap.className = "cost-amount-wrap";
        const currency = document.createElement("span");
        currency.className = "cost-currency";
        currency.textContent = "৳";
        const amountInput = document.createElement("input");
        amountInput.type = "number";
        amountInput.className = "cost-amount-input";
        amountInput.placeholder = "0";
        amountInput.min = "0";
        amountInput.step = "any";
        amountInput.value = row.amount !== null ? row.amount : "";
        amountInput.disabled = !editable;
        amountWrap.append(currency, amountInput);

        rowEl.append(descEl, amountWrap);
        bazarRowsContainer.appendChild(rowEl);
        autoResizeDescInput(descEl);
    });

    if (ordered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "cost-empty-hint";
        empty.textContent = "Add a date in Bazarer Date to create a row here.";
        bazarRowsContainer.appendChild(empty);
    }

    // Rows are only ever created from Bazarer Date now, so there's
    // nothing left to manually add here.
    if (bazarAddRowBtn) bazarAddRowBtn.style.display = "none";

    if (bazarCostTotalEl) bazarCostTotalEl.textContent = `৳ ${formatNumber(sumBazarDateAmounts())}`;
}

// Writes the amount (and, via regenerateBazarCostText, the bazarCost
// mirror) for the current bazarDates — this IS manager-gated through
// saveFields, since typing in the ৳ amount is the one thing that's still
// Manager/Super Admin only in this panel.
async function saveBazarCostAmounts(showFeedback = false) {
    regenerateBazarCostText();
    return saveFields({ bazarCost: bazarCostText, bazarDates }, showFeedback);
}

function handleBazarCostAmountInput(event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const target = event.target;
    if (!target.classList.contains("cost-amount-input")) return;
    const rowEl = target.closest(".cost-row");
    const row = rowEl && findBazarDateRow(rowEl.dataset.rowId);
    if (!row) return;
    row.amount = parseCostAmount(target.value);
    if (bazarCostTotalEl) bazarCostTotalEl.textContent = `৳ ${formatNumber(sumBazarDateAmounts())}`;
    debounceKeyed("bazar-cost-amount", () => {
        saveBazarCostAmounts().catch(err => { console.error(err); showMessage("Save failed", true); });
    }, 350);
}

function handleBazarCostAmountBlur(event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const target = event.target;
    if (!target.classList.contains("cost-amount-input")) return;
    saveBazarCostAmounts(true).catch(err => { console.error(err); showMessage("Save failed", true); });
}

// ── Table rendering ───────────────────────────────────────────
function renderTable() {
    // While actively editing a meal count or a name cell, skip the
    // rebuild entirely — the same fix as Bazar/Additional Cost above.
    // Every save (ours or another manager's) echoes back through the
    // Firebase listener → updateManagerUI() → here, and a full rebuild
    // mid-keystroke is what causes the cursor to jump / keyboard to
    // flicker on mobile. Local handlers (handleMealInputChange /
    // handleNameInputChange) already update totals live without needing
    // this render, so it's safe to just wait until the field is blurred.
    const active = document.activeElement;
    if (active && table.contains(active) &&
        (active.classList.contains("meal-input") || active.classList.contains("name-input"))) {
        return;
    }

    table.innerHTML = "";
    renderTableHeader();
    renderTableBody();
    scrollTodayColumnIntoView();
}

function scrollTodayColumnIntoView() {
    const container = document.getElementById('table-container');
    if (!container) return;
    const todayHeader = table.querySelector('th.today-col');
    if (!todayHeader) return;

    const containerRect = container.getBoundingClientRect();
    const headerRect = todayHeader.getBoundingClientRect();
    const offset = headerRect.left - containerRect.left;
    const centerOffset = Math.round((container.clientWidth - headerRect.width) / 2);
    const desiredScroll = container.scrollLeft + offset - centerOffset;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);

    container.scrollTo({ left: Math.min(maxScroll, Math.max(0, desiredScroll)), behavior: 'auto' });
}

function renderTableHeader() {
    const head = table.createTHead();
    const row  = head.insertRow();
    const today = getTodayDay();

    row.insertCell().outerHTML = '<th class="sticky-col-left sticky-header serial-cell text-center">S/N</th>';
    row.insertCell().outerHTML = '<th class="sticky-col-left sticky-header name-cell text-center" style="min-width:140px;padding:8px 12px;">Name</th>';

    for (let d=1; d<=selectedMonthDays; d++) {
        const isToday = isCurrentMonthView() && d===today;
        const dayName = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth(), d)
            .toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
        row.insertCell().outerHTML = `<th class="sticky-header text-center p-2${isToday?' today-col':''}">${d}<br><span class="day-name-label">${dayName}</span>${isToday?'<br><span class="today-label">TODAY</span>':''}</th>`;
    }

    row.insertCell().outerHTML = '<th class="sticky-col-right sticky-header text-center p-2" style="min-width:90px;">Total<br><span id="grand-total" class="font-bold text-cyan-300">0</span></th>';
}

function createMealInput(personIndex, dayIndex, type, value, locked) {
    const input = document.createElement("input");
    input.type = "number";
    input.min  = "1";
    input.max  = "4";
    const isToday = isCurrentMonthView() && (dayIndex+1)===getTodayDay();
    input.className = `meal-input ${type==="meal"?"text-gray-800":"text-pink-700"}${isToday?" today-col":""}`;
    input.dataset.person = String(personIndex);
    input.dataset.day    = String(dayIndex);
    input.dataset.type   = type;
    input.value = value===0 ? "" : formatNumber(value);
    // Only manager can ever edit — everyone else is always locked
    input.disabled = !isManagerMode || locked || isReadOnlyForUser();
    if (input.disabled) input.classList.add("locked-input");
    input.addEventListener("input", handleMealInputChange);
    input.addEventListener("wheel", (e) => {
        e.preventDefault(); 
    });
    return input;
}

function renderTableBody() {
    const body = table.createTBody();

    mealData.forEach((person, pi) => {
        const defaultName = `Member ${pi+1}`;

        // ── Meal row
        const mealRow = body.insertRow();

        // Serial
        const serialCell = mealRow.insertCell();
        serialCell.classList.add("sticky-col-left","serial-cell","text-center","font-medium","p-3");
        serialCell.rowSpan = 2;
        serialCell.textContent = String(pi+1);

        // Name
        const nameCell = mealRow.insertCell();
        nameCell.classList.add("sticky-col-left","name-cell","text-left");
        nameCell.rowSpan = 1;
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "name-input";
        nameInput.placeholder = defaultName;
        nameInput.value = person.name.startsWith("Member ") ? "" : person.name;
        nameInput.dataset.person = String(pi);
        nameInput.disabled = !isManagerMode || isReadOnlyForUser();
        if (nameInput.disabled) nameInput.classList.add("locked-input");
        nameInput.addEventListener("input", handleNameInputChange);
        nameCell.appendChild(nameInput);

        // Meal cells
        for (let d=0; d<selectedMonthDays; d++) {
            const cell = mealRow.insertCell();
            const locked = person.mealLocked[d] && !isManagerMode;
            cell.appendChild(createMealInput(pi, d, "meal", person.meals[d], locked));
        }

        // Total display (rowSpan 2)
        const totalCell = mealRow.insertCell();
        totalCell.classList.add("sticky-col-right","text-sm");
        totalCell.rowSpan = 2;
        totalCell.id = `total-display-${pi}`;

        // ── Guest row
        const guestRow = body.insertRow();
        guestRow.classList.add("guest-row","text-xs","text-gray-500");
        if (pi < numPeople-1) guestRow.classList.add("person-group-end");

        const guestLabel = guestRow.insertCell();
        guestLabel.classList.add("sticky-col-left","name-cell","text-left","italic","p-2","text-xs");
        guestLabel.style.background="#fef2f2";
        guestLabel.textContent = "Guest Meal";

        for (let d=0; d<selectedMonthDays; d++) {
            const cell = guestRow.insertCell();
            const locked = person.guestMealLocked[d] && !isManagerMode;
            cell.appendChild(createMealInput(pi, d, "guest", person.guestMeals[d], locked));
        }
    });

    // Grand total row
    const grandRow = body.insertRow();
    grandRow.classList.add("grand-total-row");
    const lCell = grandRow.insertCell();
    lCell.colSpan = 2;
    lCell.classList.add("sticky-col-left");
    lCell.style.background="linear-gradient(90deg,#1e293b,#0f172a)";
    lCell.style.color="#f8fafc";
    lCell.style.fontWeight="700";
    lCell.style.padding="10px 16px";
    lCell.textContent = "Total Meals";

    for (let d=0; d<selectedMonthDays; d++) {
        const c = grandRow.insertCell();
        c.style.background="linear-gradient(90deg,#1e293b,#0f172a)";
        c.style.borderColor="#334155";
    }

    const rCell = grandRow.insertCell();
    rCell.classList.add("sticky-col-right");
    rCell.style.background="linear-gradient(90deg,#0f172a,#1e293b)";
    rCell.style.color="#67e8f9";
    rCell.style.fontWeight="800";
    rCell.style.padding="10px 12px";
    rCell.style.textAlign="center";
    rCell.id = "grand-total-cell";

    mealData.forEach((_,i)=>updateTotal(i));
    updateGrandTotal();
}

// ── Totals ────────────────────────────────────────────────────
function sumByDays(arr) {
    return arr.slice(0,selectedMonthDays).reduce((s,v)=>s+parseInput(v),0);
}

function getEffectiveFixedMeal(person) {
    const custom = person.customFixedMeal;
    return (typeof custom === "number" && Number.isFinite(custom) && custom >= 0) ? custom : fixedMeal;
}

function getBillingTotal(person) {
    const real  = sumByDays(person.meals);
    const guest = sumByDays(person.guestMeals);
    const hasStartedEating = real > 0;          // no meal entered yet? no floor yet
    const floorApplies     = hasStartedEating && !person.fixedMealOff;
    const floor  = getEffectiveFixedMeal(person);
    const billed = floorApplies ? (real < floor ? floor : real) : real;
    return billed + guest;
}

function updateTotal(pi) {
    const person = mealData[pi];
    const cell = document.getElementById(`total-display-${pi}`);

    // Don't rebuild this cell out from under an in-progress custom-fixed-meal
    // edit — same focus-preservation pattern used elsewhere in this file.
    // Just patch the "T:M" figure and grand total live; the full render
    // (including normalizing whatever's in the input) catches up on blur.
    if (cell && cell.contains(document.activeElement) && document.activeElement.classList.contains("fm-custom-input")) {
        const tcEl = cell.querySelector(".total-cell-combined span:last-child");
        if (tcEl) tcEl.textContent = formatNumber(getBillingTotal(person));
        updateGrandTotal();
        return;
    }

    const tm = sumByDays(person.meals);
    const gm = sumByDays(person.guestMeals);
    const tc = getBillingTotal(person);
    if (cell) {
        const fmOff = Boolean(person.fixedMealOff);
        const hasCustom = typeof person.customFixedMeal === "number";
        const toggleHTML = isManagerMode
            ? `<button class="fm-toggle-btn" data-person="${pi}"
                 title="${fmOff ? 'Fixed Meal is OFF for this member — click to enable' : 'Fixed Meal is ON — click to disable (bill by real meals only)'}"
                 style="margin-top:5px;width:100%;font-size:10px;font-weight:700;padding:3px 4px;border-radius:6px;cursor:pointer;
                        border:1px solid ${fmOff ? '#f43f5e' : '#16a34a'};
                        color:${fmOff ? '#f43f5e' : '#16a34a'};
                        background:${fmOff ? '#fef2f2' : '#f0fdf4'};">
                 FM: ${fmOff ? 'OFF' : 'ON'}
               </button>`
            : (fmOff
                ? `<div style="margin-top:5px;font-size:10px;font-weight:700;color:#f43f5e;text-align:center;">FM: OFF</div>`
                : (hasCustom
                    ? `<div style="margin-top:5px;font-size:10px;font-weight:700;color:#0369a1;text-align:center;">Fixed: ${formatNumber(getEffectiveFixedMeal(person))}</div>`
                    : ''));

        // Manager-only, and only while Fixed Meal is actually ON for this
        // member — lets a manager give this one person their own fixed-meal
        // floor (e.g. 30/40) instead of the shared value, without affecting
        // anyone else. Blank = follow the shared Fixed Meal amount.
        const customInputHTML = (isManagerMode && !fmOff)
            ? `<input type="number" class="fm-custom-input" data-person="${pi}" min="0" inputmode="decimal"
                 placeholder="${formatNumber(fixedMeal)}" value="${hasCustom ? person.customFixedMeal : ''}"
                 title="Custom fixed meal for this member only (blank = shared ${formatNumber(fixedMeal)})"
                 style="margin-top:4px;width:100%;font-size:10px;font-weight:700;text-align:center;padding:3px 4px;border-radius:6px;border:1px solid #94a3b8;background:#f8fafc;color:#0f172a;">`
            : '';

        cell.innerHTML = `
            <div class="p-2" style="min-width:75px;">
                <div class="total-cell-tm flex justify-between gap-2"><span>Real:</span><span>${formatNumber(tm)}</span></div>
                <div class="total-cell-gm flex justify-between gap-2"><span>Guest:</span><span>${formatNumber(gm)}</span></div>
                <div class="total-cell-combined flex justify-between gap-2"><span>T:M:</span><span>${formatNumber(tc)}</span></div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    ${toggleHTML}
                    ${customInputHTML}
                </div>
            </div>`;

        if (isManagerMode) {
            const btn = cell.querySelector(".fm-toggle-btn");
            if (btn) btn.addEventListener("click", () => {
                handleToggleFixedMeal(pi).catch(err => { console.error(err); showMessage("Failed", true); });
            });
            const customInput = cell.querySelector(".fm-custom-input");
            if (customInput) {
                customInput.addEventListener("input", handleCustomFixedMealInput);
                customInput.addEventListener("blur",  handleCustomFixedMealBlur);
            }
        }
    }
    updateGrandTotal();
}

function updateGrandTotal() {
    const total = mealData.reduce((s,p)=>s+getBillingTotal(p),0);
    const el = document.getElementById("grand-total");
    if (el) el.textContent = formatNumber(total);
    const el2 = document.getElementById("grand-total-cell");
    if (el2) el2.textContent = formatNumber(total);
}

// ── Persistence ───────────────────────────────────────────────
function readLocalStore() {
    try { const r=localStorage.getItem(LOCAL_FALLBACK_KEY); return r?JSON.parse(r):{}; }
    catch(e) { return {}; }
}
function writeLocalStore(store) { localStorage.setItem(LOCAL_FALLBACK_KEY,JSON.stringify(store)); }

// ── Debounce (per-key, so typing in cell A doesn't cancel a pending
//    save for cell B) ────────────────────────────────────────────
const debounceTimers = new Map();
function debounceKeyed(key, fn, waitMs) {
    if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key, setTimeout(() => { debounceTimers.delete(key); fn(); }, waitMs));
}

// Everything needed to initialize a brand-new month document.
// managerEmail is deliberately NOT part of this — it's only ever set via
// the sign-in claim transaction or the release flow, never via a bulk save.
function buildInitialFields() {
    return {
        monthKey:      getMonthKey(selectedMonthDate),
        monthLabel:    getMonthLabel(selectedMonthDate),
        memberCount:   numPeople,
        fixedMeal,
        managerName:   (managerNameInput?.value||"").trim(),
        bazarCost:     bazarCostText,
        note:          monthNote,
        deposits:      depositData,
        bazarDates:    bazarDates,
        members:       mealData
    };
}

function mergeLocalFields(monthKey, fields) {
    const store = readLocalStore();
    store[monthKey] = { ...(store[monthKey]||{}), ...fields };
    writeLocalStore(store);
}

// Save ONLY the given fields/paths — never the whole document. This is
// what makes it safe for the manager and super admin to both be logged in
// and editing at the same time: two saves a few seconds apart (or even
// overlapping) only touch the exact paths that changed, via Firebase's
// multi-location update(), instead of each replacing the entire month
// document and silently discarding whatever the other person just wrote.
// Field keys can be nested paths like `members/3/meals/14`.
async function saveFields(fields, showFeedback=false) {
    if (!isManagerMode) return; // guard: non-managers never write
    const monthKey = getMonthKey(selectedMonthDate);
    const payload = { ...fields, updatedAt: Date.now() };
    if (!db) {
        mergeLocalFields(monthKey, payload);
        if (showFeedback) showMessage("Saved!");
        return;
    }
    if (!monthDocRef) return;
    await monthDocRef.update(payload);
    if (showFeedback) showMessage("Saved!");
}

// ── Month loading ─────────────────────────────────────────────
async function cleanupOldMonths() {
    const threshold = getMonthKey(addMonths(monthStart(new Date()),-2));
    if (!db) {
        const store = readLocalStore();
        Object.keys(store).filter(k=>k<threshold).forEach(k=>delete store[k]);
        writeLocalStore(store);
        return;
    }
    if (!isManagerMode) return;
    const snap = await db.ref(COLLECTION_NAME).once("value");
    const data = snap.val()||{};
    await Promise.all(Object.keys(data).filter(k=>k<threshold).map(k=>db.ref(`${COLLECTION_NAME}/${k}`).remove()));
}

async function loadMonthOptions() {
    const cur  = monthStart(new Date());
    const prev = addMonths(cur,-1);
    const map  = new Map([[getMonthKey(cur),cur],[getMonthKey(prev),prev]]);

    if (!db) {
        Object.keys(readLocalStore()).forEach(k=>{ const d=parseMonthKey(k); if(!isNaN(d)) map.set(k,d); });
    } else {
        const snap = await db.ref(COLLECTION_NAME).once("value");
        Object.keys(snap.val()||{}).forEach(k=>{ const d=parseMonthKey(k); if(!isNaN(d)) map.set(k,d); });
    }

    const sorted = [...map.keys()].sort((a,b)=>a<b?1:-1);
    monthSelector.innerHTML = "";
    sorted.forEach(k=>{
        const o = document.createElement("option");
        o.value = k; o.textContent = getMonthLabel(map.get(k));
        monthSelector.appendChild(o);
    });

    const curKey = getMonthKey(selectedMonthDate);
    monthSelector.value = map.has(curKey)?curKey:sorted[0];
    selectedMonthDate = parseMonthKey(monthSelector.value);
    selectedMonthDays = getDaysInMonth(selectedMonthDate);
    updateHeaderAndNotice();
}

function applyMonthData(data) {
    const count      = Number.isInteger(data?.memberCount)&&data.memberCount>0 ? data.memberCount : 20;
    const fixed      = Number.isFinite(Number(data?.fixedMeal)) ? parseInput(data.fixedMeal) : 60;
    const mgrName    = typeof data?.managerName==="string" ? data.managerName.trim() : "";
    const mgrEmail   = typeof data?.managerEmail==="string" ? data.managerEmail.trim() : "";

    numPeople        = count;
    fixedMeal        = fixed;
    bazarCostText    = typeof data?.bazarCost==="string" ? data.bazarCost : "";
    monthNote        = typeof data?.note==="string" ? data.note : "";
    mealData         = normalizeMembers(data?.members, count);
    depositData      = normalizeDeposits(data?.deposits, count);

    // A row only gets written to Firebase once BOTH date and name are
    // filled in (see the completeness guard in handleBazarDateInput /
    // handleBazarDateBlur). Until then it exists only in local memory —
    // so blindly replacing `bazarDates` with whatever the server has
    // right now (which won't include it yet) would silently delete
    // whatever the manager is still typing, the moment ANY other save
    // echoes back (e.g. finishing a different row, or even this same
    // row's own date-then-name sequence). Keep those in-progress rows
    // around instead of dropping them.
    const incoming = normalizeBazarDates(data?.bazarDates);
    const incomingIds = new Set(incoming.map(r => r.id));
    const stillPending = bazarDates.filter(r =>
        !incomingIds.has(r.id) && (r.date || (r.names || "").trim())
    );
    bazarDates = [...incoming, ...stillPending];

    storedManagerEmail = mgrEmail;

    membersInput.value        = String(numPeople);
    fixedMealInput.value      = String(formatNumber(fixedMeal));
    if (managerNameInput) managerNameInput.value = mgrName;
}

function applyDefaultMonth() {
    numPeople        = 20;
    fixedMeal        = 60;
    bazarCostText    = "";
    monthNote        = "";
    depositData      = Array(numPeople).fill(0);
    bazarDates       = [];
    storedManagerEmail = "";
    mealData         = Array.from({length:numPeople},(_,i)=>getDefaultMember(i));
    membersInput.value        = "20";
    fixedMealInput.value      = "60";
    if (managerNameInput) managerNameInput.value = "";
}

async function openMonth(date) {
    selectedMonthDate = monthStart(date);
    selectedMonthDays = getDaysInMonth(selectedMonthDate);
    updateHeaderAndNotice();

    const monthKey = getMonthKey(selectedMonthDate);

    if (!db) {
        const data = readLocalStore()[monthKey];
        if (!data) {
            applyDefaultMonth();
            renderBazarCost(); renderNotes(); renderDeposits();
            updateManagerUI();
            await saveFields(buildInitialFields(), false);
        } else {
            applyMonthData(data);
            computeManagerMode();
            renderBazarCost(); renderNotes(); renderDeposits();
            updateManagerUI();
        }
        return;
    }

    if (unsubscribeMonth) { unsubscribeMonth(); unsubscribeMonth=null; }

    monthDocRef = db.ref(`${COLLECTION_NAME}/${monthKey}`);
    const activeRef = monthDocRef;

    const handleSnap = async (snap) => {
    if (!snap.exists()) {
        applyDefaultMonth();
        renderBazarCost(); renderNotes(); renderDeposits();
        updateManagerUI();
        // Only manager can init a new month document
        if (isManagerMode) await saveFields(buildInitialFields(), false);
    } else {
        applyMonthData(snap.val()||{});
        computeManagerMode();
        renderBazarCost(); renderNotes(); renderDeposits();
        updateManagerUI();

        if (!cleanupAttempted) {
            cleanupAttempted = true;
            if (isManagerMode) {
                cleanupOldMonths().catch(err => console.error("cleanupOldMonths failed", err));
            }
        }
    }
    hideSkeleton();
};

activeRef.on("value", handleSnap, err => {
    console.error(err);
    showMessage("Sync error", true);
    hideSkeleton();
});
unsubscribeMonth = ()=>activeRef.off("value", handleSnap);
}
    
// ── Event handlers ────────────────────────────────────────────
// Fires on every keystroke (not just on blur), so a name change is saved
// within ~400ms without the manager needing to click elsewhere. Table is
// NOT re-rendered here — that would rebuild the input mid-keystroke and
// kick the manager out of the field they're typing in.
function handleNameInputChange(event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const input = event.target;
    const pi    = parseInt(input.dataset.person,10);
    const member = mealData[pi];
    if (!member) return;

    const value = input.value.trim();
    if (!value) {
        member.name = `Member ${pi+1}`;
        member.nameLocked = false;
    } else {
        member.name = value;
        member.nameLocked = true;
    }
    renderDeposits();
    debounceKeyed(`name-${pi}`, () => {
        saveFields({
            [`members/${pi}/name`]:       member.name,
            [`members/${pi}/nameLocked`]: member.nameLocked
        }).catch(err => { console.error(err); showMessage("Name save failed", true); });
    }, 400);
}

// Fires on every keystroke. Local total updates instantly; the actual
// network save is debounced per-cell (~350ms after the last keystroke) so
// typing "25" doesn't fire three separate saves, but nothing needs a
// click or blur to be saved.
function handleMealInputChange(event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const input = event.target;
    const pi    = parseInt(input.dataset.person,10);
    const di    = parseInt(input.dataset.day,10);
    const type  = input.dataset.type;
    const member = mealData[pi];
    if (!member) return;

    const lockKey   = type==="meal" ? "mealLocked" : "guestMealLocked";
    const targetKey = type==="meal" ? "meals"      : "guestMeals";

    const raw = input.value.trim();
    if (!raw) {
        member[targetKey][di] = 0;
        member[lockKey][di]   = false;
    } else {
        member[targetKey][di] = parseInput(raw);
        member[lockKey][di]   = true;
    }
    updateTotal(pi);

    debounceKeyed(`meal-${pi}-${di}-${type}`, () => {
        saveFields({
            [`members/${pi}/${targetKey}/${di}`]: member[targetKey][di],
            [`members/${pi}/${lockKey}/${di}`]:   member[lockKey][di]
        }).catch(err => { console.error(err); showMessage("Save failed", true); });
    }, 350);
}

async function handleTotalMembersChange(event) {
    if (!isManagerMode || isReadOnlyForUser()) { event.target.value=String(numPeople); return; }
    let n = parseInt(event.target.value,10);
    if (!Number.isInteger(n)||n<1) n=1;
    event.target.value = String(n);
    if (n===numPeople) return;
    mealData = Array.from({length:n},(_,i)=>normalizeMember(mealData[i],i));
    depositData = normalizeDeposits(depositData, n);
    numPeople = n;
    renderTable();
    renderDeposits();
    await saveFields({ members: mealData, deposits: depositData, memberCount: numPeople }, true);
}

async function handleToggleFixedMeal(pi) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const member = mealData[pi];
    if (!member) return;
    member.fixedMealOff = !member.fixedMealOff;
    updateTotal(pi);
    await saveFields({ [`members/${pi}/fixedMealOff`]: member.fixedMealOff }, true);
}

// Per-member override for the shared Fixed Meal floor (e.g. shared is 50,
// but this one member should be floored at 30/40 instead). Blank clears
// the override and falls back to the shared amount — see
// getEffectiveFixedMeal. Fires on every keystroke like handleMealInputChange;
// the network save is debounced, updateTotal() is guarded against rebuilding
// this very input mid-keystroke (see the focus check inside updateTotal).
function handleCustomFixedMealInput(event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const input = event.target;
    const pi = parseInt(input.dataset.person, 10);
    const member = mealData[pi];
    if (!member) return;
    const raw = input.value.trim();
    member.customFixedMeal = raw === "" ? null : parseInput(raw);
    updateTotal(pi);
    debounceKeyed(`customFixedMeal-${pi}`, () => {
        saveFields({ [`members/${pi}/customFixedMeal`]: member.customFixedMeal }, true)
            .catch(err => { console.error(err); showMessage("Save failed", true); });
    }, 350);
}

// Once the manager is done typing, do a full re-render of the cell so the
// input reflects the normalized value (e.g. a cleared field snapping back
// to blank/placeholder rather than whatever partial text was left).
function handleCustomFixedMealBlur(event) {
    const pi = parseInt(event.target.dataset.person, 10);
    if (Number.isInteger(pi)) updateTotal(pi);
}

async function handleFixedMealSave() {
    if (!isManagerMode) { showMessage("Only manager can set fixed meal",true); return; }
    if (isReadOnlyForUser()) { showMessage("History is read-only",true); fixedMealInput.value=formatNumber(fixedMeal); return; }
    let v = parseInput(fixedMealInput.value);
    if (!Number.isFinite(v)||v<0) v=0;
    fixedMeal = v;
    fixedMealInput.value = formatNumber(fixedMeal);
    renderTable();
    await saveFields({ fixedMeal }, true);
}

function handleDepositInputChange(event) {
    const input = event.target;
    if (!input.classList.contains("deposit-input")) return;
    const pi = parseInt(input.dataset.person, 10);
    if (!Number.isInteger(pi) || pi < 0 || pi >= depositData.length) return;
    if (!isManagerMode || isReadOnlyForUser()) {
        input.value = depositData[pi] ? formatNumber(depositData[pi]) : "";
        return;
    }

    const value = parseInput(input.value);
    depositData[pi] = Number.isFinite(value) && value >= 0 ? value : 0;
    updateDepositTotal();

    debounceKeyed(`deposit-${pi}`, () => {
        saveFields({ [`deposits/${pi}`]: depositData[pi] })
            .catch(err => { console.error(err); showMessage("Deposit save failed", true); });
    }, 350);
}

// ── Google Auth ───────────────────────────────────────────────
async function handleGoogleSignIn() {
    if (!isFirebaseMode) { showMessage("Firebase not configured",true); return; }
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result   = await firebase.auth().signInWithPopup(provider);
        const user     = result.user;

        if (user.email === SUPER_ADMIN_EMAIL) {
            // Super Admin: full control over every month, no claim needed
            currentUser = user;
            computeManagerMode();
            updateManagerUI();
            showMessage(`Welcome, Super Admin ${user.displayName||user.email}!`);
            return;
        }

        // Check current month's managerEmail in Firebase — done as an atomic
        // transaction so two people signing in at nearly the same moment can't
        // both "win" (a plain read-then-write has that race).
        const monthKey = getMonthKey(monthStart(new Date()));
        const managerRef = db.ref(`${COLLECTION_NAME}/${monthKey}/managerEmail`);

        const tx = await managerRef.transaction(current => {
            if (!current) return user.email;            // nobody manages this month yet — claim it
            if (current === user.email) return current;  // already you — no-op re-login
            return; // someone else already manages this month — abort, don't touch it
        });

        const finalEmail = tx.snapshot.val() || "";

        if (finalEmail === user.email) {
            storedManagerEmail = user.email;
            currentUser = user;
            computeManagerMode();
            updateManagerUI();
            showMessage(`Welcome, Manager ${user.displayName||user.email}!`);
        } else {
            // Different manager already registered
            await firebase.auth().signOut();
            currentUser = null;
            showAuthError("Manager is already set for this month by another account.");
            updateManagerUI();
        }
    } catch(e) {
        console.error(e);
        showMessage(e.message||"Sign-in failed",true);
    }
}

async function handleReleaseManager() {
    if (!isSuperAdmin()) return; // only Super Admin can remove a manager now
    const monthKey = getMonthKey(selectedMonthDate);
    const label = getMonthLabel(selectedMonthDate);

    const ok = window.confirm(
        `Remove the current manager for ${label}?\n\nAfter this, the next person who signs in with Google (with a different Gmail) will become the manager for this month.`
    );
    if (!ok) return;

    try {
        if (db) {
            // remove() (not set("")) so the field is truly gone — an empty
            // string can still "exist" and confuse later existence checks.
            await db.ref(`${COLLECTION_NAME}/${monthKey}/managerEmail`).remove();
        } else {
            const store = readLocalStore();
            if (store[monthKey]) {
                delete store[monthKey].managerEmail;
                writeLocalStore(store);
            }
        }

        storedManagerEmail = "";

        computeManagerMode();
        updateManagerUI();
        showMessage(`Manager removed for ${label}. Waiting for a new sign-in.`);
    } catch(e) {
        console.error(e);
        showMessage(e.message || "Failed to remove manager", true);
    }
}

async function handleManagerLogout() {
    try {
        await firebase.auth().signOut();
    } catch(e) { console.error(e); }
    currentUser   = null;
    isManagerMode = false;
    await openMonth(monthStart(new Date()));
    monthSelector.value = getMonthKey(selectedMonthDate);
    updateManagerUI();
    showMessage("Logged out.");
}

// ── Bind events ───────────────────────────────────────────────
function bindEvents() {
    membersInput.addEventListener("change", e => handleTotalMembersChange(e).catch(err=>{
        console.error(err); showMessage("Member update failed",true);
    }));
    membersInput.addEventListener("input", () => {
        if (!isManagerMode || isReadOnlyForUser()) return;
        debounceKeyed("memberCount", () => {
            handleTotalMembersChange({ target: membersInput }).catch(err=>{
                console.error(err); showMessage("Member update failed",true);
            });
        }, 500);
    });

    monthSelector.addEventListener("change", async e => {
        const key = e.target.value;
        if (!key) return;
        if (unsubscribeMonth) { unsubscribeMonth(); unsubscribeMonth=null; }
        await openMonth(parseMonthKey(key));
        updateManagerUI();
    });

    fixedMealSaveBtn.addEventListener("click", ()=>{
        handleFixedMealSave().catch(err=>{ console.error(err); showMessage("Failed",true); });
    });
    fixedMealInput.addEventListener("input", () => {
        if (!isManagerMode || isReadOnlyForUser()) return;
        debounceKeyed("fixedMeal", () => {
            handleFixedMealSave().catch(err=>{ console.error(err); showMessage("Failed",true); });
        }, 400);
    });

    googleSigninBtn.addEventListener("click", ()=>{
        handleGoogleSignIn().catch(err=>{ console.error(err); showMessage("Sign-in error",true); });
    });

    managerLogoutBtn.addEventListener("click", ()=>{
        handleManagerLogout().catch(err=>{ console.error(err); showMessage("Logout error",true); });
    });

    if (changeManagerBtn) {
        changeManagerBtn.addEventListener("click", ()=>{
            handleReleaseManager().catch(err=>{ console.error(err); showMessage("Failed to change manager",true); });
        });
    }

    if (managerNameInput) {
        managerNameInput.addEventListener("input", ()=>{
            if (!isManagerMode || isReadOnlyForUser()) return;
            const val = managerNameInput.value.trim();
            debounceKeyed("managerName", ()=>{
                saveFields({ managerName: val }).catch(err=>{ console.error(err); showMessage("Name save failed",true); });
            }, 400);
        });
    }

    noteToggleBtn.addEventListener("click", ()=>{
        isNoteVisible = true;
        renderNotes();
        notesPanel.scrollIntoView({behavior:"smooth",block:"start"});
    });

    bazarToggleBtn.addEventListener("click", ()=>{
        isBazarVisible = true;
        renderBazarCost();
        bazarPanel.scrollIntoView({behavior:"smooth",block:"start"});
    });

    if (depositToggleBtn) {
        depositToggleBtn.addEventListener("click", ()=>{
            isDepositVisible = true;
            renderDeposits();
            depositPanel.scrollIntoView({behavior:"smooth",block:"start"});
        });
    }

    if (bazarDateToggleBtn) {
        bazarDateToggleBtn.addEventListener("click", ()=>{
            isBazarDateVisible = true;
            renderBazarDates();
            bazarDatePanel.scrollIntoView({behavior:"smooth",block:"start"});
        });
    }

    document.getElementById("notes-close-btn").addEventListener("click",()=>{
        isNoteVisible=false; renderNotes();
    });
    document.getElementById("bazar-close-btn").addEventListener("click",()=>{
        isBazarVisible=false; renderBazarCost();
    });
    document.getElementById("deposit-close-btn").addEventListener("click",()=>{
        isDepositVisible=false; renderDeposits();
    });
    const bazarDateCloseBtn = document.getElementById("bazardate-close-btn");
    if (bazarDateCloseBtn) {
        bazarDateCloseBtn.addEventListener("click",()=>{
            isBazarDateVisible=false; renderBazarDates();
        });
    }

    if (bazarDateRowsContainer) {
        bazarDateRowsContainer.addEventListener("input",  handleBazarDateInput);
        bazarDateRowsContainer.addEventListener("blur",   handleBazarDateBlur, true);
        bazarDateRowsContainer.addEventListener("click",  handleBazarDateClick);
    }
    if (bazarDateAddRowBtn) bazarDateAddRowBtn.addEventListener("click", handleBazarDateAddRow);

    // Bazar Cost rows are derived from Bazarer Date now (see
    // renderBazarCostRows) — the only thing still editable in here is the
    // ৳ amount per row.
    if (bazarRowsContainer) {
        bazarRowsContainer.addEventListener("input", handleBazarCostAmountInput);
        bazarRowsContainer.addEventListener("blur",  handleBazarCostAmountBlur, true);
    }

    if (notesRowsContainer) {
        notesRowsContainer.addEventListener("input",   e => handleCostRowInput("notes", e));
        notesRowsContainer.addEventListener("blur",    e => handleCostRowBlur("notes", e), true);
        notesRowsContainer.addEventListener("click",   e => handleCostRowClick("notes", e));
        notesRowsContainer.addEventListener("keydown", e => handleCostRowKeydown("notes", e));
    }
    if (notesAddRowBtn) notesAddRowBtn.addEventListener("click", () => handleCostAddRow("notes"));

    // Re-wrap description rows on resize/rotation, since wrap width changes.
    window.addEventListener("resize", () => {
        document.querySelectorAll(".cost-desc-input").forEach(autoResizeDescInput);
    });

    if (depositList) {
        depositList.addEventListener("input", handleDepositInputChange);
        depositList.addEventListener("blur", event => {
            const input = event.target;
            if (!input.classList.contains("deposit-input")) return;
            const pi = parseInt(input.dataset.person, 10);
            if (!Number.isInteger(pi) || pi < 0 || pi >= depositData.length) return;
            input.value = depositData[pi] ? formatNumber(depositData[pi]) : "";
            if (!isManagerMode || isReadOnlyForUser()) return;
            saveFields({ [`deposits/${pi}`]: depositData[pi] }, true)
                .catch(err => { console.error(err); showMessage("Deposit save failed", true); });
        }, true);
    }

    const fab = document.getElementById("floatingButton");
        if (fab) {
        fab.addEventListener("click", () => {
            const month = getMonthKey(selectedMonthDate);
            window.open(`https://mealcalapp.github.io/for-all/?month=${month}`, "_blank");
        });
    }
}

// ── Boot ──────────────────────────────────────────────────────
async function boot() {
    try {
        renderBazarCost();
        renderNotes();
        renderDeposits();
        renderBazarDates();
        bindEvents();

        const firebaseReady = initFirebase();

        if (!firebaseReady) {
            showMessage("Firebase config missing. Local mode.", true);
            await loadMonthOptions();
            await openMonth(selectedMonthDate);
            updateManagerUI();
            hideSkeleton();
            return;
        }

        // Keep the user (super admin or manager) signed in across page
        // reloads / browser restarts until they explicitly log out. This is
        // Firebase's default on web, but we set it explicitly so it never
        // silently falls back to SESSION/NONE.
        try {
            await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        } catch(e) {
            console.error("setPersistence failed", e);
        }

        // Wait for Firebase Auth state before rendering.
        // IMPORTANT: this listener stays alive for the whole session (Firebase
        // never lets you "unsubscribe once and forget" safely) — so every time
        // auth state changes later (sign-in, sign-out, token refresh), we must
        // re-sync isManagerMode and re-render. Previously this only happened on
        // the very first call, so a later silent auth change could leave the UI
        // showing stale manager controls while currentUser had already changed.
        let firstAuthEventHandled = false;
        await new Promise(resolve => {
            firebase.auth().onAuthStateChanged(user => {
                currentUser = user || null;
                if (!firstAuthEventHandled) {
                    firstAuthEventHandled = true;
                    resolve();
                } else {
                    computeManagerMode();
                    updateManagerUI();
                }
            });
        });

        await loadMonthOptions();
        await openMonth(selectedMonthDate);
        updateManagerUI();
        hideSkeleton();

    } catch(err) {
        console.error(err);
        showMessage(err.message||"Init failed",true);
        hideSkeleton();
    }
}

window.addEventListener("load", boot);
