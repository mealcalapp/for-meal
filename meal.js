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
        const MANAGER_NAME_STORAGE_KEY_PREFIX = "mealRegisterManagerName";
        const MASTER_MANAGER_PASSWORD = "sk77";
        const MAX_DAYS = 31;

        const table = document.getElementById("meal-register-table");
        const monthHeader = document.getElementById("month-header");
        const messageBox = document.getElementById("message-box");
        const monthSelector = document.getElementById("month-selector");
        const membersInput = document.getElementById("total-members-input");
        const marquee = document.getElementById("monthMarquee");
        const managerLoginBtn = document.getElementById("manager-login-btn");
        const managerLogoutBtn = document.getElementById("manager-logout-btn");
        const managerModeIndicator = document.getElementById("manager-mode-indicator");
        const managerNameInput = document.getElementById("manager-name-input");
        const managerLoginPanel = document.getElementById("manager-login-panel");
        const managerPasswordInput = document.getElementById("manager-password");
        const managerSubmitBtn = document.getElementById("manager-submit-btn");
        const fixedMealInput = document.getElementById("fixed-meal-input");
        const fixedMealSaveBtn = document.getElementById("fixed-meal-save-btn");
        const managerOnlyControls = document.querySelectorAll("#manager-only-total-members");
        const managerHistoryControl = document.getElementById("manager-only-history");
        const bazarToggleBtn = document.getElementById("bazar-toggle-btn");
        const bazarPanel = document.getElementById("bazar-panel");
        const bazarEditor = document.getElementById("bazar-editor");
        const noteToggleBtn = document.getElementById("note-toggle-btn");
        const notesPanel = document.getElementById("notes-panel");
        const notesEditor = document.getElementById("notes-editor");

        let db = null;
        let analytics = null;
        let monthDocRef = null;
        let unsubscribeMonth = null;
        let isFirebaseMode = false;

        let numPeople = 20;
        let fixedMeal = 60;
        let mealData = [];
        let isManagerMode = false;
        let isBazarVisible = true;
        let isNoteVisible = true;
        let bazarCostText = "";
        let monthNote = "";
        let selectedMonthDate = monthStart(new Date());
        let selectedMonthDays = getDaysInMonth(selectedMonthDate);

        function monthStart(date) {
            return new Date(date.getFullYear(), date.getMonth(), 1);
        }

        function addMonths(date, months) {
            return new Date(date.getFullYear(), date.getMonth() + months, 1);
        }

        function getMonthKey(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            return `${year}-${month}`;
        }

        function parseMonthKey(key) {
            const [year, month] = key.split("-").map(Number);
            return new Date(year, month - 1, 1);
        }

        function getMonthLabel(date) {
            return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        }

        function getDaysInMonth(date) {
            return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        }

        function parseInput(value) {
            const num = parseFloat(value);
            return Number.isFinite(num) && num >= 0 ? num : 0;
        }

        function getCurrentMonthManagerKey() {
            return `${MANAGER_NAME_STORAGE_KEY_PREFIX}:${getMonthKey(monthStart(new Date()))}`;
        }

        function getSavedManagerName() {
            return (localStorage.getItem(getCurrentMonthManagerKey()) || "").trim();
        }

        function saveManagerName(name) {
            localStorage.setItem(getCurrentMonthManagerKey(), name.trim());
        }

        function getActiveManagerName() {
            return (managerNameInput?.value || "").trim();
        }

        function getExpectedManagerPassword() {
            const managerPrefix = getSavedManagerName().slice(0, 3).toLowerCase();
            const monthPrefix = monthStart(new Date())
                .toLocaleDateString("en-US", { month: "long" })
                .slice(0, 3)
                .toLowerCase();
            return `${managerPrefix}${monthPrefix}`;
        }

        function formatNumber(num) {
            return Number.isInteger(num) ? String(num) : num.toFixed(1);
        }

        function isCurrentMonthView() {
            return getMonthKey(selectedMonthDate) === getMonthKey(monthStart(new Date()));
        }

        function isReadOnlyForUser() {
            return !isCurrentMonthView();
        }

        function getDefaultMember(index) {
            return {
                name: `Member ${index + 1}`,
                nameLocked: false,
                meals: Array(MAX_DAYS).fill(0),
                guestMeals: Array(MAX_DAYS).fill(0),
                mealLocked: Array(MAX_DAYS).fill(false),
                guestMealLocked: Array(MAX_DAYS).fill(false)
            };
        }

        function normalizeArray(raw, length, defaultValue) {
            const source = Array.isArray(raw) ? raw : [];
            const out = source.slice(0, length);
            while (out.length < length) out.push(defaultValue);
            return out;
        }

        function normalizeMember(member, index) {
            const base = getDefaultMember(index);
            const safe = member && typeof member === "object" ? member : {};
            const name = typeof safe.name === "string" && safe.name.trim() ? safe.name.trim() : base.name;
            return {
                name,
                nameLocked: Boolean(safe.nameLocked),
                meals: normalizeArray(safe.meals, MAX_DAYS, 0).map(parseInput),
                guestMeals: normalizeArray(safe.guestMeals, MAX_DAYS, 0).map(parseInput),
                mealLocked: normalizeArray(safe.mealLocked, MAX_DAYS, false).map(Boolean),
                guestMealLocked: normalizeArray(safe.guestMealLocked, MAX_DAYS, false).map(Boolean)
            };
        }

        function normalizeMembers(members, count) {
            const source = Array.isArray(members) ? members : [];
            const out = [];
            for (let i = 0; i < count; i += 1) {
                out.push(normalizeMember(source[i], i));
            }
            return out;
        }

        function updateHeaderAndNotice() {
            // Header/notice should always show running month name, even when viewing history data.
            const label = getMonthLabel(monthStart(new Date()));
            monthHeader.textContent = label;
            if (marquee) marquee.textContent = `${label} - Time Left`;
        }

        function showMessage(text, isError = false) {
            if (!messageBox) return;
            messageBox.classList.remove("hidden", "bg-green-500", "bg-red-500", "opacity-0");
            messageBox.classList.add(isError ? "bg-red-500" : "bg-green-500", "opacity-100");
            messageBox.textContent = text;

            clearTimeout(messageBox.timeoutId);
            messageBox.timeoutId = setTimeout(() => {
                messageBox.classList.remove("opacity-100");
                messageBox.classList.add("opacity-0");
                setTimeout(() => messageBox.classList.add("hidden"), 300);
            }, 1800);
        }

        function updateManagerUI() {
            if (isManagerMode) {
                managerModeIndicator.innerHTML = 'Manager Mode <span class="manager-badge"></span>';
                managerLoginBtn.classList.add("hidden");
                managerLogoutBtn.classList.remove("hidden");
                managerLoginPanel.classList.add("hidden");
                fixedMealSaveBtn.classList.remove("hidden");
                managerOnlyControls.forEach((el) => el.classList.remove("hidden"));
                if (managerHistoryControl) managerHistoryControl.classList.add("hidden");
            } else {
                managerModeIndicator.textContent = "";
                managerLoginBtn.classList.remove("hidden");
                managerLogoutBtn.classList.add("hidden");
                fixedMealSaveBtn.classList.add("hidden");
                managerOnlyControls.forEach((el) => el.classList.add("hidden"));
                if (managerHistoryControl) managerHistoryControl.classList.remove("hidden");
            }
            if (managerNameInput) {
                managerNameInput.readOnly = !isManagerMode;
                managerNameInput.classList.toggle("manager-name-saved", !isManagerMode);
            }
            fixedMealInput.disabled = !isManagerMode || isReadOnlyForUser();
            fixedMealSaveBtn.disabled = !isManagerMode || isReadOnlyForUser();
            if (bazarEditor) bazarEditor.disabled = !isManagerMode || isReadOnlyForUser();
            if (notesEditor) notesEditor.disabled = !isManagerMode || isReadOnlyForUser();
            renderTable();
        }

        function renderBazarCost() {
            if (bazarPanel) {
                bazarPanel.classList.toggle("visible", isBazarVisible);
            }
            if (bazarEditor) {
                bazarEditor.value = bazarCostText;
                bazarEditor.disabled = !isManagerMode || isReadOnlyForUser();
            }
        }

        function renderNotes() {
            if (notesPanel) {
                notesPanel.classList.toggle("visible", isNoteVisible);
            }
            if (notesEditor) {
                notesEditor.value = monthNote;
                notesEditor.disabled = !isManagerMode || isReadOnlyForUser();
            }
        }

        function readLocalStore() {
            try {
                const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
                const parsed = raw ? JSON.parse(raw) : {};
                return parsed && typeof parsed === "object" ? parsed : {};
            } catch (error) {
                console.error(error);
                return {};
            }
        }

        function writeLocalStore(store) {
            localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(store));
        }

        function initFirebase() {
            if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) {
                isFirebaseMode = false;
                return false;
            }

            if (!firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
            db = firebase.database();
            if (typeof firebase.analytics === "function") {
                try {
                    analytics = firebase.analytics();
                } catch (error) {
                    console.warn("Firebase analytics unavailable", error);
                }
            }
            isFirebaseMode = true;
            return true;
        }

        async function cleanupOldMonths() {
            const currentMonth = monthStart(new Date());
            const previousMonth = addMonths(currentMonth, -1);
            const thresholdKey = getMonthKey(previousMonth);
            if (!db) {
                const store = readLocalStore();
                Object.keys(store).forEach((key) => {
                    if (key < thresholdKey) delete store[key];
                });
                writeLocalStore(store);
                return;
            }

            const snapshot = await db.ref(COLLECTION_NAME).once("value");
            const data = snapshot.val() || {};
            const deletes = Object.keys(data)
                .filter((key) => key < thresholdKey)
                .map((key) => db.ref(`${COLLECTION_NAME}/${key}`).remove());
            await Promise.all(deletes);
        }

        async function loadMonthOptions() {
            const currentMonth = monthStart(new Date());
            const previousMonth = addMonths(currentMonth, -1);
            const keyToDate = new Map([
                [getMonthKey(currentMonth), currentMonth],
                [getMonthKey(previousMonth), previousMonth]
            ]);

            if (!db) {
                const store = readLocalStore();
                Object.keys(store).forEach((key) => {
                    const maybeDate = parseMonthKey(key);
                    if (!Number.isNaN(maybeDate.getTime())) keyToDate.set(key, maybeDate);
                });
            } else {
                const snapshot = await db.ref(COLLECTION_NAME).once("value");
                const data = snapshot.val() || {};
                Object.keys(data).forEach((key) => {
                    const maybeDate = parseMonthKey(key);
                    if (!Number.isNaN(maybeDate.getTime())) keyToDate.set(key, maybeDate);
                });
            }

            const sortedKeys = Array.from(keyToDate.keys()).sort((a, b) => (a < b ? 1 : -1));
            monthSelector.innerHTML = "";
            sortedKeys.forEach((key) => {
                const option = document.createElement("option");
                option.value = key;
                option.textContent = getMonthLabel(keyToDate.get(key));
                monthSelector.appendChild(option);
            });

            const currentKey = getMonthKey(selectedMonthDate);
            monthSelector.value = keyToDate.has(currentKey) ? currentKey : sortedKeys[0];
            selectedMonthDate = parseMonthKey(monthSelector.value);
            selectedMonthDays = getDaysInMonth(selectedMonthDate);
            updateHeaderAndNotice();
        }

        function buildPayload() {
            return {
                monthKey: getMonthKey(selectedMonthDate),
                monthLabel: getMonthLabel(selectedMonthDate),
                memberCount: numPeople,
                fixedMeal,
                managerName: getActiveManagerName(),
                bazarCost: bazarCostText,
                note: monthNote,
                members: mealData,
                updatedAt: Date.now()
            };
        }

        async function saveMonthData(showFeedback = true) {
            if (!db) {
                const key = getMonthKey(selectedMonthDate);
                const store = readLocalStore();
                store[key] = buildPayload();
                writeLocalStore(store);
                // disabled save message
                return;
            }
            if (!monthDocRef) return;
            await monthDocRef.set(buildPayload());
            // disabled save message
        }

        async function openMonth(date) {
            selectedMonthDate = monthStart(date);
            selectedMonthDays = getDaysInMonth(selectedMonthDate);
            updateHeaderAndNotice();

            const monthKey = getMonthKey(selectedMonthDate);
            if (!db) {
                const store = readLocalStore();
                const data = store[monthKey];
                if (!data) {
                    numPeople = 20;
                    fixedMeal = 60;
                    bazarCostText = "";
                    monthNote = "";
                    mealData = Array.from({ length: numPeople }, (_, index) => getDefaultMember(index));
                    membersInput.value = String(numPeople);
                    fixedMealInput.value = String(fixedMeal);
                    if (managerNameInput) managerNameInput.value = getSavedManagerName();
                    renderBazarCost();
                    renderNotes();
                    renderTable();
                    await saveMonthData(false);
                    return;
                }
                const incomingCount = Number.isInteger(data.memberCount) && data.memberCount > 0 ? data.memberCount : 20;
                const incomingFixed = Number.isFinite(Number(data.fixedMeal)) ? parseInput(data.fixedMeal) : 60;
                const incomingManagerName = typeof data.managerName === "string" ? data.managerName.trim() : "";
                numPeople = incomingCount;
                fixedMeal = incomingFixed;
                bazarCostText = typeof data.bazarCost === "string" ? data.bazarCost : "";
                monthNote = typeof data.note === "string" ? data.note : "";
                mealData = normalizeMembers(data.members, incomingCount);
                membersInput.value = String(numPeople);
                fixedMealInput.value = String(fixedMeal);
                if (managerNameInput) managerNameInput.value = incomingManagerName || getSavedManagerName();
                if (isCurrentMonthView()) saveManagerName(incomingManagerName);
                renderBazarCost();
                renderNotes();
                renderTable();
                return;
            }

            if (unsubscribeMonth) unsubscribeMonth();
            monthDocRef = db.ref(`${COLLECTION_NAME}/${monthKey}`);
            const activeMonthRef = monthDocRef;
            const handleSnapshot = async (snapshot) => {
                if (!snapshot.exists()) {
                    numPeople = 20;
                    fixedMeal = 60;
                    bazarCostText = "";
                    monthNote = "";
                    mealData = Array.from({ length: numPeople }, (_, index) => getDefaultMember(index));
                    membersInput.value = String(numPeople);
                    fixedMealInput.value = String(fixedMeal);
                    if (managerNameInput) managerNameInput.value = getSavedManagerName();
                    renderBazarCost();
                    renderNotes();
                    renderTable();
                    await saveMonthData(false);
                    return;
                }

                const data = snapshot.val() || {};
                const incomingCount = Number.isInteger(data.memberCount) && data.memberCount > 0 ? data.memberCount : 20;
                const incomingFixed = Number.isFinite(Number(data.fixedMeal)) ? parseInput(data.fixedMeal) : 60;
                const incomingManagerName = typeof data.managerName === "string" ? data.managerName.trim() : "";
                numPeople = incomingCount;
                fixedMeal = incomingFixed;
                bazarCostText = typeof data.bazarCost === "string" ? data.bazarCost : "";
                monthNote = typeof data.note === "string" ? data.note : "";
                mealData = normalizeMembers(data.members, incomingCount);
                membersInput.value = String(numPeople);
                fixedMealInput.value = String(fixedMeal);
                if (managerNameInput) managerNameInput.value = incomingManagerName || getSavedManagerName();
                if (isCurrentMonthView()) saveManagerName(incomingManagerName);
                renderBazarCost();
                renderNotes();
                renderTable();
            };
            const handleError = (error) => {
                console.error(error);
                showMessage("Realtime sync error", true);
            };
            activeMonthRef.on("value", handleSnapshot, handleError);
            unsubscribeMonth = () => activeMonthRef.off("value", handleSnapshot);
        }

        function renderTable() {
            membersInput.disabled = isReadOnlyForUser();
            fixedMealInput.value = String(formatNumber(fixedMeal));
            table.innerHTML = "";
            renderTableHeader();
            renderTableBody();
        }

        function renderTableHeader() {
            const head = table.createTHead();
            const row = head.insertRow();
            row.insertCell().outerHTML = '<th class="sticky-col-left sticky-header text-center" style="min-width: 44px; width: 44px;">S/N</th>';
            row.insertCell().outerHTML = '<th class="sticky-col-left sticky-header name-cell text-center" style="min-width: 140px; padding: 8px 12px;">Name</th>';

            for (let day = 1; day <= selectedMonthDays; day += 1) {
                row.insertCell().outerHTML = `<th class="sticky-header text-center p-2">${day}</th>`;
            }

            row.insertCell().outerHTML = '<th class="sticky-col-right sticky-header text-center p-2">T M: <span id="grand-total" class="font-bold text-primary-blue">0</span></th>';
        }

        function createMealInput(personIndex, dayIndex, type, value, locked) {
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.step = "0.5";
            input.className = `meal-input ${type === "meal" ? "text-gray-800" : "text-pink-700"}`;
            input.dataset.person = String(personIndex);
            input.dataset.day = String(dayIndex);
            input.dataset.type = type;
            input.value = value === 0 ? "" : formatNumber(value);
            input.disabled = locked || isReadOnlyForUser();
            if (input.disabled) input.classList.add("locked-input");
            input.addEventListener("input", handleMealInputChange);
            return input;
        }

        function renderTableBody() {
            const body = table.createTBody();
            mealData.forEach((person, personIndex) => {
                const defaultName = `Member ${personIndex + 1}`;

                const mealRow = body.insertRow();
                if (personIndex < numPeople - 1) mealRow.classList.add("border-b-0");

                const serialCell = mealRow.insertCell();
                serialCell.classList.add("sticky-col-left", "serial-cell", "text-center", "font-medium", "p-3");
                serialCell.rowSpan = 2;
                serialCell.textContent = String(personIndex + 1);

                const nameCell = mealRow.insertCell();
                nameCell.classList.add("sticky-col-left", "name-cell", "text-left");
                const nameWrap = document.createElement("div");
                nameWrap.className = "flex flex-col h-full w-full justify-center";
                const nameInput = document.createElement("input");
                nameInput.type = "text";
                nameInput.className = "name-input";
                nameInput.placeholder = defaultName;
                nameInput.value = person.name.startsWith("Member ") ? "" : person.name;
                nameInput.dataset.person = String(personIndex);
                nameInput.disabled = (person.nameLocked && !isManagerMode) || isReadOnlyForUser();
                if (nameInput.disabled) nameInput.classList.add("locked-input");
                nameInput.addEventListener("change", handleNameInputChange);
                nameWrap.appendChild(nameInput);
                nameCell.appendChild(nameWrap);

                for (let day = 0; day < selectedMonthDays; day += 1) {
                    const cell = mealRow.insertCell();
                    const locked = person.mealLocked[day] && !isManagerMode;
                    cell.appendChild(createMealInput(personIndex, day, "meal", person.meals[day], locked));
                }

                const totalCell = mealRow.insertCell();
                totalCell.classList.add("sticky-col-right", "text-sm", "text-gray-800");
                totalCell.rowSpan = 2;
                totalCell.id = `total-display-${personIndex}`;

                const guestRow = body.insertRow();
                guestRow.classList.add("guest-row", "text-xs", "text-gray-500");
                if (personIndex < numPeople - 1) guestRow.classList.add("person-group-end");

                const guestLabelCell = guestRow.insertCell();
                guestLabelCell.classList.add("sticky-col-left", "name-cell", "text-left", "italic", "p-3");
                guestLabelCell.textContent = "Guest Meal";

                for (let day = 0; day < selectedMonthDays; day += 1) {
                    const cell = guestRow.insertCell();
                    const locked = person.guestMealLocked[day] && !isManagerMode;
                    cell.appendChild(createMealInput(personIndex, day, "guest", person.guestMeals[day], locked));
                }
            });

            mealData.forEach((_, index) => updateTotal(index));
            updateGrandTotal();
        }

        function sumByDays(arr) {
            return arr.slice(0, selectedMonthDays).reduce((sum, value) => sum + parseInput(value), 0);
        }

        function getBillingTotal(person) {
            const realMeal = sumByDays(person.meals);
            const guestMeal = sumByDays(person.guestMeals);
            const baseMeal = realMeal < fixedMeal ? fixedMeal : realMeal;
            return baseMeal + guestMeal;
        }

        function updateTotal(personIndex) {
            const person = mealData[personIndex];
            const totalMeal = sumByDays(person.meals);
            const totalGuestMeal = sumByDays(person.guestMeals);
            const totalCombined = getBillingTotal(person);

            const rightDisplayCell = document.getElementById(`total-display-${personIndex}`);
            if (rightDisplayCell) {
                rightDisplayCell.innerHTML = `
                    <div class="p-2">
                        <div class="total-cell-tm flex justify-between"><span>Real:</span><span>${formatNumber(totalMeal)}</span></div>
                        <div class="total-cell-gm flex justify-between"><span>Guest:</span><span>${formatNumber(totalGuestMeal)}</span></div>
                        <div class="total-cell-combined flex justify-between"><span>Total:</span><span>${formatNumber(totalCombined)}</span></div>
                    </div>
                `;
            }
            updateGrandTotal();
        }

        function updateGrandTotal() {
            const total = mealData.reduce((sum, person) => sum + getBillingTotal(person), 0);
            const display = document.getElementById("grand-total");
            if (display) display.textContent = formatNumber(total);
        }

        async function handleTotalMembersChange(event) {
            if (isReadOnlyForUser()) {
                event.target.value = String(numPeople);
                showMessage("History month is read-only", true);
                return;
            }

            let newCount = parseInt(event.target.value, 10);
            if (!Number.isInteger(newCount) || newCount < 1) newCount = 1;
            event.target.value = String(newCount);
            if (newCount === numPeople) return;

            const resized = [];
            for (let i = 0; i < newCount; i += 1) {
                resized.push(normalizeMember(mealData[i], i));
            }
            mealData = resized;
            numPeople = newCount;
            renderTable();
            await saveMonthData(true);
        }

        async function handleNameInputChange(event) {
            if (isReadOnlyForUser()) return;

            const input = event.target;
            const personIndex = parseInt(input.dataset.person, 10);
            const member = mealData[personIndex];
            if (!member) return;

            if (member.nameLocked && !isManagerMode) {
                input.disabled = true;
                return;
            }

            const value = input.value.trim();
            if (!value && !isManagerMode) return;

            if (!value && isManagerMode) {
                member.name = `Member ${personIndex + 1}`;
                member.nameLocked = false;
            } else {
                member.name = value;
                if (!isManagerMode) member.nameLocked = true;
            }

            await saveMonthData(true);
            renderTable();
        }

        async function handleMealInputChange(event) {
            if (isReadOnlyForUser()) return;

            const input = event.target;
            const personIndex = parseInt(input.dataset.person, 10);
            const dayIndex = parseInt(input.dataset.day, 10);
            const type = input.dataset.type;
            const member = mealData[personIndex];
            if (!member) return;

            const lockArr = type === "meal" ? member.mealLocked : member.guestMealLocked;
            const targetArr = type === "meal" ? member.meals : member.guestMeals;

            if (lockArr[dayIndex] && !isManagerMode) {
                input.disabled = true;
                return;
            }

            const raw = input.value.trim();
            if (!raw) {
                if (isManagerMode) {
                    targetArr[dayIndex] = 0;
                    lockArr[dayIndex] = false;
                    saveMonthData(false);
updateTotal(personIndex);
                }
                return;
            }

            const value = parseInput(raw);
            targetArr[dayIndex] = value;
            if (!isManagerMode) lockArr[dayIndex] = true;

            await saveMonthData(true);
            renderTable();
        }

        async function handleMonthSelection(event) {
            const selectedKey = event.target.value;
            if (!selectedKey) return;
            await openMonth(parseMonthKey(selectedKey));
            updateManagerUI();
        }

        async function handleFixedMealSave() {
            if (!isManagerMode) {
                showMessage("Only manager can set fixed meal", true);
                return;
            }
            if (isReadOnlyForUser()) {
                showMessage("History month is read-only", true);
                fixedMealInput.value = String(formatNumber(fixedMeal));
                return;
            }
            let value = parseInput(fixedMealInput.value);
            if (!Number.isFinite(value) || value < 0) value = 0;
            fixedMeal = value;
            fixedMealInput.value = String(formatNumber(fixedMeal));
            renderTable();
            await saveMonthData(true);
        }

        function evaluateNoteExpression(line) {
            const match = line.match(/^([0-9+\-*/().\s]+)=\s*(?:.*)?$/);
            if (!match) return line;

            const expression = match[1].trim();
            if (!expression) return line;

            try {
                const result = Function(`"use strict"; return (${expression})`)();
                if (!Number.isFinite(result)) return line;
                return `${expression}=${formatNumber(result)}`;
            } catch (error) {
                return line;
            }
        }

        function normalizeNoteText(value) {
            return value
                .split("\n")
                .map((line) => {
                    const trimmed = line.trim();
                    return trimmed.endsWith("=") || /^[0-9+\-*/().\s]+=/.test(trimmed)
                        ? evaluateNoteExpression(trimmed)
                        : line;
                })
                .join("\n");
        }

        async function saveNoteText(rawValue, showFeedback = false) {
            const normalized = normalizeNoteText(rawValue);
            monthNote = normalized;
            if (notesEditor && notesEditor.value !== normalized) {
                const cursor = notesEditor.selectionStart;
                notesEditor.value = normalized;
                if (typeof cursor === "number") {
                    notesEditor.selectionStart = notesEditor.selectionEnd = Math.min(cursor, normalized.length);
                }
            }
            await saveMonthData(showFeedback);
        }

        async function saveBazarCostText(rawValue, showFeedback = false) {
            const normalized = normalizeNoteText(rawValue);
            bazarCostText = normalized;
            if (bazarEditor && bazarEditor.value !== normalized) {
                const cursor = bazarEditor.selectionStart;
                bazarEditor.value = normalized;
                if (typeof cursor === "number") {
                    bazarEditor.selectionStart = bazarEditor.selectionEnd = Math.min(cursor, normalized.length);
                }
            }
            await saveMonthData(showFeedback);
        }

        function bindEvents() {
            membersInput.addEventListener("change", (event) => {
                handleTotalMembersChange(event).catch((err) => {
                    console.error(err);
                    showMessage("Member update failed", true);
                });
            });

            monthSelector.addEventListener("change", (event) => {
                handleMonthSelection(event).catch((err) => {
                    console.error(err);
                    showMessage("Month load failed", true);
                });
            });

            fixedMealSaveBtn.addEventListener("click", () => {
                handleFixedMealSave().catch((err) => {
                    console.error(err);
                    showMessage("Fixed meal update failed", true);
                });
            });

            managerLoginBtn.addEventListener("click", () => {
                managerLoginPanel.classList.toggle("hidden");
                managerPasswordInput.value = "";
                managerPasswordInput.focus();
            });

            managerSubmitBtn.addEventListener("click", () => {
                const pass = managerPasswordInput.value.trim();
                const managerName = getSavedManagerName();
                const hasManagerName = managerName.length >= 3;
                const isMasterPass = !hasManagerName && pass.toLowerCase() === MASTER_MANAGER_PASSWORD;
                const isMonthlyManagerPass = hasManagerName && pass.toLowerCase() === getExpectedManagerPassword();

                if (isMasterPass || isMonthlyManagerPass) {
                    isManagerMode = true;
                    updateManagerUI();
                    showMessage(isMasterPass ? "Main manager login success" : "Manager login success");
                } else {
                    if (pass.toLowerCase() === MASTER_MANAGER_PASSWORD && hasManagerName) {
                        showMessage("Main pass disabled after manager name is set", true);
                        return;
                    }
                    if (!hasManagerName) {
                        showMessage("No manager name set. Use main pass (sk77) first.", true);
                        return;
                    }
                    showMessage("Wrong manager password", true);
                }
            });

            managerLogoutBtn.addEventListener("click", () => {
                isManagerMode = false;
                openMonth(monthStart(new Date()))
                    .then(() => {
                        monthSelector.value = getMonthKey(selectedMonthDate);
                        updateManagerUI();
                        showMessage("Manager logout success");
                    })
                    .catch((err) => {
                        console.error(err);
                        updateManagerUI();
                        showMessage("Manager lock failed", true);
                    });
            });

            const fab = document.getElementById("floatingButton");
            if (fab) {
                fab.addEventListener("click", () => {
                    window.open("https://mealcalapp.github.io/for-all/", "_blank");
                });
            }

            if (managerNameInput) {
                managerNameInput.addEventListener("input", () => {
                    if (!isManagerMode) {
                        managerNameInput.value = getSavedManagerName();
                        return;
                    }
                    saveManagerName(managerNameInput.value);
                });

                managerNameInput.addEventListener("change", () => {
                    if (!isManagerMode || isReadOnlyForUser()) return;
                    saveMonthData(true).catch((err) => {
                        console.error(err);
                        showMessage("Manager name save failed", true);
                    });
                });
            }

            if (noteToggleBtn) {
                noteToggleBtn.addEventListener("click", () => {
                    isNoteVisible = true;
                    renderNotes();
                    if (notesPanel) {
                        notesPanel.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                });
            }

            if (bazarToggleBtn) {
                bazarToggleBtn.addEventListener("click", () => {
                    isBazarVisible = true;
                    renderBazarCost();
                    if (bazarPanel) {
                        bazarPanel.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                });
            }

            if (bazarEditor) {
                bazarEditor.addEventListener("input", () => {
                    if (!isManagerMode || isReadOnlyForUser()) {
                        bazarEditor.value = bazarCostText;
                        return;
                    }
                    saveBazarCostText(bazarEditor.value).catch((err) => {
                        console.error(err);
                        showMessage("Bazar cost save failed", true);
                    });
                });

                bazarEditor.addEventListener("blur", () => {
                    if (!isManagerMode || isReadOnlyForUser()) return;
                    saveBazarCostText(bazarEditor.value, true).catch((err) => {
                        console.error(err);
                        showMessage("Bazar cost save failed", true);
                    });
                });
            }

            if (notesEditor) {
                notesEditor.addEventListener("input", () => {
                    if (!isManagerMode || isReadOnlyForUser()) {
                        notesEditor.value = monthNote;
                        return;
                    }
                    saveNoteText(notesEditor.value).catch((err) => {
                        console.error(err);
                        showMessage("Note save failed", true);
                    });
                });

                notesEditor.addEventListener("blur", () => {
                    if (!isManagerMode || isReadOnlyForUser()) return;
                    saveNoteText(notesEditor.value, true).catch((err) => {
                        console.error(err);
                        showMessage("Note save failed", true);
                    });
                });
            }
        }

        async function boot() {
            try {
                if (managerNameInput) {
                    managerNameInput.value = getSavedManagerName();
                }
                renderBazarCost();
                renderNotes();
                bindEvents();
                const firebaseReady = initFirebase();
                await cleanupOldMonths();
                await loadMonthOptions();
                await openMonth(selectedMonthDate);
                if (!firebaseReady) {
                    showMessage("Firebase config missing. Running Local Mode.", true);
                }
                updateManagerUI();
            } catch (error) {
                console.error(error);
                showMessage(error.message || "Initialization failed", true);
            }
        }

        window.addEventListener("load", () => {
            boot();
        });