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
const noteToggleBtn       = document.getElementById("note-toggle-btn");
const notesPanel          = document.getElementById("notes-panel");
const notesEditor         = document.getElementById("notes-editor");
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

let numPeople          = 15;
let fixedMeal          = 60;
let mealData           = [];
let isManagerMode      = false;
let isBazarVisible     = false;
let isNoteVisible      = false;
let bazarCostText      = "";
let monthNote          = "";
let selectedMonthDate  = monthStart(new Date());
let selectedMonthDays  = getDaysInMonth(selectedMonthDate);
let currentUser        = null;   // firebase.auth().currentUser
let storedManagerEmail = "";     // from Firebase for the selected month

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
        fixedMealOff: false
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
    return {
        name,
        nameLocked: Boolean(s.nameLocked),
        meals: normalizeArray(s.meals,MAX_DAYS,0).map(parseInput),
        guestMeals: normalizeArray(s.guestMeals,MAX_DAYS,0).map(parseInput),
        mealLocked: normalizeArray(s.mealLocked,MAX_DAYS,false).map(Boolean),
        guestMealLocked: normalizeArray(s.guestMealLocked,MAX_DAYS,false).map(Boolean),
        fixedMealOff: Boolean(s.fixedMealOff)
    };
}

function normalizeMembers(members, count) {
    const src = Array.isArray(members)?members:[];
    return Array.from({length:count},(_,i)=>normalizeMember(src[i],i));
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
    if (changeManagerBtn) changeManagerBtn.classList.toggle("hidden", !isManager);

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

    if (managerNameInput) {
        managerNameInput.readOnly = !isManager;
        managerNameInput.classList.toggle("manager-name-locked", !isManager);
    }

    renderTable();
}

// ── Header / notice ───────────────────────────────────────────
function updateHeaderAndNotice() {
    const label = getMonthLabel(monthStart(new Date()));
    monthHeader.textContent = label;
    if (marquee) marquee.textContent = `${label} — Time Left`;
}

// ── Render panels ─────────────────────────────────────────────
function renderBazarCost() {
    bazarPanel.classList.toggle("visible", isBazarVisible);
    bazarEditor.value = bazarCostText;
    bazarEditor.disabled = !isManagerMode || isReadOnlyForUser();
}

function renderNotes() {
    notesPanel.classList.toggle("visible", isNoteVisible);
    notesEditor.value = monthNote;
    notesEditor.disabled = !isManagerMode || isReadOnlyForUser();
}

// ── Table rendering ───────────────────────────────────────────
function renderTable() {
    table.innerHTML = "";
    renderTableHeader();
    renderTableBody();
}

function renderTableHeader() {
    const head = table.createTHead();
    const row  = head.insertRow();
    const today = getTodayDay();

    row.insertCell().outerHTML = '<th class="sticky-col-left sticky-header serial-cell text-center">S/N</th>';
    row.insertCell().outerHTML = '<th class="sticky-col-left sticky-header name-cell text-center" style="min-width:140px;padding:8px 12px;">Name</th>';

    for (let d=1; d<=selectedMonthDays; d++) {
        const isToday = isCurrentMonthView() && d===today;
        row.insertCell().outerHTML = `<th class="sticky-header text-center p-2${isToday?' today-col':''}">${d}${isToday?'<br><span class="today-label">TODAY</span>':''}</th>`;
    }

    row.insertCell().outerHTML = '<th class="sticky-col-right sticky-header text-center p-2" style="min-width:90px;">Total<br><span id="grand-total" class="font-bold text-cyan-300">0</span></th>';
}

function createMealInput(personIndex, dayIndex, type, value, locked) {
    const input = document.createElement("input");
    input.type = "number";
    input.min  = "0";
    input.step = "0.5";
    const isToday = isCurrentMonthView() && (dayIndex+1)===getTodayDay();
    input.className = `meal-input ${type==="meal"?"text-gray-800":"text-pink-700"}${isToday?" today-col":""}`;
    input.dataset.person = String(personIndex);
    input.dataset.day    = String(dayIndex);
    input.dataset.type   = type;
    input.value = value===0 ? "" : formatNumber(value);
    // Only manager can ever edit — everyone else is always locked
    input.disabled = !isManagerMode || locked || isReadOnlyForUser();
    if (input.disabled) input.classList.add("locked-input");
    input.addEventListener("change", handleMealInputChange);
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
        nameInput.addEventListener("change", handleNameInputChange);
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

function getBillingTotal(person) {
    const real  = sumByDays(person.meals);
    const guest = sumByDays(person.guestMeals);
    const hasStartedEating = real > 0;          // no meal entered yet? no floor yet
    const floorApplies     = hasStartedEating && !person.fixedMealOff;
    const billed = floorApplies ? (real < fixedMeal ? fixedMeal : real) : real;
    return billed + guest;
}

function updateTotal(pi) {
    const person = mealData[pi];
    const tm = sumByDays(person.meals);
    const gm = sumByDays(person.guestMeals);
    const tc = getBillingTotal(person);
    const cell = document.getElementById(`total-display-${pi}`);
    if (cell) {
        const fmOff = Boolean(person.fixedMealOff);
        const toggleHTML = isManagerMode
            ? `<button class="fm-toggle-btn" data-person="${pi}"
                 title="${fmOff ? 'Fixed Meal is OFF for this member — click to enable' : 'Fixed Meal is ON — click to disable (bill by real meals only)'}"
                 style="margin-top:5px;width:100%;font-size:10px;font-weight:700;padding:3px 4px;border-radius:6px;cursor:pointer;
                        border:1px solid ${fmOff ? '#f43f5e' : '#16a34a'};
                        color:${fmOff ? '#f43f5e' : '#16a34a'};
                        background:${fmOff ? '#fef2f2' : '#f0fdf4'};">
                 FM: ${fmOff ? 'OFF' : 'ON'}
               </button>`
            : (fmOff ? `<div style="margin-top:5px;font-size:10px;font-weight:700;color:#f43f5e;text-align:center;">FM: OFF</div>` : '');

        cell.innerHTML = `
            <div class="p-2" style="min-width:75px;">
                <div class="total-cell-tm flex justify-between gap-2"><span>Real:</span><span>${formatNumber(tm)}</span></div>
                <div class="total-cell-gm flex justify-between gap-2"><span>Guest:</span><span>${formatNumber(gm)}</span></div>
                <div class="total-cell-combined flex justify-between gap-2"><span>T:M:</span><span>${formatNumber(tc)}</span></div>
                ${toggleHTML}
            </div>`;

        if (isManagerMode) {
            const btn = cell.querySelector(".fm-toggle-btn");
            if (btn) btn.addEventListener("click", () => {
                handleToggleFixedMeal(pi).catch(err => { console.error(err); showMessage("Failed", true); });
            });
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

// ── Note / bazar eval ─────────────────────────────────────────
function evaluateNoteExpression(line) {
    const match = line.match(/^([0-9+\-*/().\s]+=)\s*(?:.*)?$/);
    if (!match) return line;
    const expr = match[1].slice(0,-1).trim();
    if (!expr) return line;
    try {
        const result = Function(`"use strict";return(${expr})`)();
        if (!Number.isFinite(result)) return line;
        return `${expr}=${formatNumber(result)}`;
    } catch(e) { return line; }
}

function normalizeNoteText(value) {
    return value.split("\n").map(line => {
        const t = line.trim();
        return (t.endsWith("=") || /^[0-9+\-*/().\s]+=/.test(t))
            ? evaluateNoteExpression(t) : line;
    }).join("\n");
}

// ── Persistence ───────────────────────────────────────────────
function readLocalStore() {
    try { const r=localStorage.getItem(LOCAL_FALLBACK_KEY); return r?JSON.parse(r):{}; }
    catch(e) { return {}; }
}
function writeLocalStore(store) { localStorage.setItem(LOCAL_FALLBACK_KEY,JSON.stringify(store)); }

function buildPayload() {
    return {
        monthKey:      getMonthKey(selectedMonthDate),
        monthLabel:    getMonthLabel(selectedMonthDate),
        memberCount:   numPeople,
        fixedMeal,
        managerName:   (managerNameInput?.value||"").trim(),
        managerEmail:  storedManagerEmail,
        bazarCost:     bazarCostText,
        note:          monthNote,
        members:       mealData,
        updatedAt:     Date.now()
    };
}

async function saveMonthData(showFeedback=true) {
    if (!isManagerMode) return; // guard: non-managers never write
    if (!db) {
        const key = getMonthKey(selectedMonthDate);
        const store = readLocalStore();
        store[key] = buildPayload();
        writeLocalStore(store);
        return;
    }
    if (!monthDocRef) return;
    await monthDocRef.set(buildPayload());
    if (showFeedback) showMessage("Saved!");
}

// ── Month loading ─────────────────────────────────────────────
async function cleanupOldMonths() {
    const threshold = getMonthKey(addMonths(monthStart(new Date()),-1));
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
            renderBazarCost(); renderNotes();
            updateManagerUI();
            await saveMonthData(false);
        } else {
            applyMonthData(data);
            computeManagerMode();
            renderBazarCost(); renderNotes();
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
            renderBazarCost(); renderNotes();
            updateManagerUI();
            // Only manager can init a new month document
            if (isManagerMode) await saveMonthData(false);
        } else {
            applyMonthData(snap.val()||{});
            computeManagerMode();
            renderBazarCost(); renderNotes();
            updateManagerUI();
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
async function handleNameInputChange(event) {
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
    await saveMonthData(true);
    renderTable();
}

async function handleMealInputChange(event) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const input = event.target;
    const pi    = parseInt(input.dataset.person,10);
    const di    = parseInt(input.dataset.day,10);
    const type  = input.dataset.type;
    const member = mealData[pi];
    if (!member) return;

    const lockArr   = type==="meal" ? member.mealLocked : member.guestMealLocked;
    const targetArr = type==="meal" ? member.meals      : member.guestMeals;

    const raw = input.value.trim();
    if (!raw) {
        targetArr[di] = 0;
        lockArr[di]   = false;
        await saveMonthData(false);
        updateTotal(pi);
        return;
    }

    targetArr[di] = parseInput(raw);
    lockArr[di]   = true;
    await saveMonthData(false);
    updateTotal(pi);
}

async function handleTotalMembersChange(event) {
    if (!isManagerMode || isReadOnlyForUser()) { event.target.value=String(numPeople); return; }
    let n = parseInt(event.target.value,10);
    if (!Number.isInteger(n)||n<1) n=1;
    event.target.value = String(n);
    if (n===numPeople) return;
    mealData = Array.from({length:n},(_,i)=>normalizeMember(mealData[i],i));
    numPeople = n;
    renderTable();
    await saveMonthData(true);
}

async function handleToggleFixedMeal(pi) {
    if (!isManagerMode || isReadOnlyForUser()) return;
    const member = mealData[pi];
    if (!member) return;
    member.fixedMealOff = !member.fixedMealOff;
    updateTotal(pi);
    await saveMonthData(true);
}

async function handleFixedMealSave() {
    if (!isManagerMode) { showMessage("Only manager can set fixed meal",true); return; }
    if (isReadOnlyForUser()) { showMessage("History is read-only",true); fixedMealInput.value=formatNumber(fixedMeal); return; }
    let v = parseInput(fixedMealInput.value);
    if (!Number.isFinite(v)||v<0) v=0;
    fixedMeal = v;
    fixedMealInput.value = formatNumber(fixedMeal);
    renderTable();
    await saveMonthData(true);
}

async function saveNoteText(raw, showFeedback=false) {
    const n = normalizeNoteText(raw);
    monthNote = n;
    if (notesEditor && notesEditor.value!==n) {
        const cur = notesEditor.selectionStart;
        notesEditor.value = n;
        if (typeof cur==="number") notesEditor.selectionStart = notesEditor.selectionEnd = Math.min(cur,n.length);
    }
    await saveMonthData(showFeedback);
}

async function saveBazarCostText(raw, showFeedback=false) {
    const n = normalizeNoteText(raw);
    bazarCostText = n;
    if (bazarEditor && bazarEditor.value!==n) {
        const cur = bazarEditor.selectionStart;
        bazarEditor.value = n;
        if (typeof cur==="number") bazarEditor.selectionStart = bazarEditor.selectionEnd = Math.min(cur,n.length);
    }
    await saveMonthData(showFeedback);
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

        // Check current month's managerEmail in Firebase
        const monthKey = getMonthKey(monthStart(new Date()));
        const snap     = await db.ref(`${COLLECTION_NAME}/${monthKey}/managerEmail`).once("value");
        const existingEmail = snap.val()||"";

        if (!existingEmail) {
            // First manager for this month — register
            storedManagerEmail = user.email;
            await db.ref(`${COLLECTION_NAME}/${monthKey}/managerEmail`).set(user.email);
            currentUser = user;
            computeManagerMode();
            updateManagerUI();
            showMessage(`Welcome, Manager ${user.displayName||user.email}!`);
        } else if (existingEmail === user.email) {
            // Re-login as same manager
            storedManagerEmail = existingEmail;
            currentUser = user;
            computeManagerMode();
            updateManagerUI();
            showMessage(`Welcome back, ${user.displayName||user.email}!`);
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
    if (!isManagerMode) return;
    const monthKey = getMonthKey(selectedMonthDate);
    const label = getMonthLabel(selectedMonthDate);

    const ok = window.confirm(
        `Remove the current manager for ${label}?\n\nAfter this, the next person who signs in with Google (with a different Gmail) will become the manager for this month.`
    );
    if (!ok) return;

    storedManagerEmail = "";

    if (db) {
        await db.ref(`${COLLECTION_NAME}/${monthKey}/managerEmail`).set("");
    } else {
        const store = readLocalStore();
        if (store[monthKey]) {
            store[monthKey].managerEmail = "";
            writeLocalStore(store);
        }
    }

    if (!isSuperAdmin()) {
        // A regular manager is giving up their own role — sign them out too
        await firebase.auth().signOut();
        currentUser = null;
    }

    computeManagerMode();
    updateManagerUI();
    showMessage(`Manager removed for ${label}. Waiting for a new sign-in.`);
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
        managerNameInput.addEventListener("change", ()=>{
            if (!isManagerMode || isReadOnlyForUser()) return;
            saveMonthData(true).catch(err=>{ console.error(err); showMessage("Name save failed",true); });
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

    document.getElementById("notes-close-btn").addEventListener("click",()=>{
        isNoteVisible=false; renderNotes();
    });
    document.getElementById("bazar-close-btn").addEventListener("click",()=>{
        isBazarVisible=false; renderBazarCost();
    });

    if (bazarEditor) {
        bazarEditor.addEventListener("input", ()=>{
            if (!isManagerMode||isReadOnlyForUser()) { bazarEditor.value=bazarCostText; return; }
            saveBazarCostText(bazarEditor.value).catch(console.error);
        });
        bazarEditor.addEventListener("blur", ()=>{
            if (!isManagerMode||isReadOnlyForUser()) return;
            saveBazarCostText(bazarEditor.value,true).catch(console.error);
        });
    }

    if (notesEditor) {
        notesEditor.addEventListener("input", ()=>{
            if (!isManagerMode||isReadOnlyForUser()) { notesEditor.value=monthNote; return; }
            saveNoteText(notesEditor.value).catch(console.error);
        });
        notesEditor.addEventListener("blur", ()=>{
            if (!isManagerMode||isReadOnlyForUser()) return;
            saveNoteText(notesEditor.value,true).catch(console.error);
        });
    }

    const fab = document.getElementById("floatingButton");
    if (fab) fab.addEventListener("click", ()=>window.open("https://mealcalapp.github.io/for-all/","_blank"));
}

// ── Boot ──────────────────────────────────────────────────────
async function boot() {
    try {
        renderBazarCost();
        renderNotes();
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

        // Wait for Firebase Auth state before rendering
        await new Promise(resolve => {
            firebase.auth().onAuthStateChanged(async user => {
                currentUser = user || null;
                resolve();
            });
        });

        await loadMonthOptions();
        await openMonth(selectedMonthDate);
        if (isManagerMode) await cleanupOldMonths();
        updateManagerUI();
        hideSkeleton();

    } catch(err) {
        console.error(err);
        showMessage(err.message||"Init failed",true);
        hideSkeleton();
    }
}

window.addEventListener("load", boot);
