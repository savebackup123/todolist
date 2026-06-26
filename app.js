// LifeFlow - Application Logic (Firebase Auth & Cloud Firestore Integration)

import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithRedirect, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, addDoc, getDocs, onSnapshot, query, where, deleteDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- INITIALIZE FIREBASE ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- STATE MANAGEMENT ---
const state = {
    tasks: [],
    categories: [],
    currentMode: 'work', // 'work' | 'personal'
    themeMode: 'light',  // 'light' | 'dark'
    currentFilter: 'all', // 'all' | categoryId
    currentUser: null,
    categoriesInitialized: false
};

// Listeners unsubscribe references
let unsubscribeTasks = null;
let unsubscribeCategories = null;

// --- DEFAULT CATEGORIES ---
const DEFAULT_CATEGORIES = [
    // Work Mode Categories
    { name: 'อาชีพโปรแกรมเมอร์', color: '#3b82f6', mode: 'work' },
    { name: 'งานฟรีแลนซ์', color: '#8b5cf6', mode: 'work' },
    { name: 'งานประชุม/ธุรการ', color: '#f59e0b', mode: 'work' },
    
    // Personal Mode Categories
    { name: 'สุขภาพ & ออกกำลังกาย', color: '#10b981', mode: 'personal' },
    { name: 'การเงิน & ช็อปปิ้ง', color: '#ef4444', mode: 'personal' },
    { name: 'งานอดิเรก & เที่ยว', color: '#ec4899', mode: 'personal' }
];

// --- DOM ELEMENTS ---
const DOM = {
    body: document.body,
    authContainer: document.getElementById('auth-container'),
    appContainer: document.getElementById('app-container'),
    btnLoginGoogle: document.getElementById('btn-login-google'),
    userProfile: document.getElementById('user-profile'),
    userAvatar: document.getElementById('user-avatar'),
    userName: document.getElementById('user-name'),
    btnLogout: document.getElementById('btn-logout'),
    
    btnModeWork: document.getElementById('btn-mode-work'),
    btnModePersonal: document.getElementById('btn-mode-personal'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    btnAddTask: document.getElementById('btn-add-task'),
    btnManageCategories: document.getElementById('btn-manage-categories'),
    filterCategory: document.getElementById('filter-category'),
    
    // Columns & Counters
    columns: {
        todo: document.getElementById('tasks-todo'),
        progress: document.getElementById('tasks-progress'),
        done: document.getElementById('tasks-done')
    },
    counters: {
        todo: document.getElementById('count-todo'),
        progress: document.getElementById('count-progress'),
        done: document.getElementById('count-done')
    },
    
    // Task Modal
    modalTask: document.getElementById('modal-task'),
    formTask: document.getElementById('form-task'),
    taskIdInput: document.getElementById('task-id'),
    taskTitleInput: document.getElementById('task-title'),
    taskDescInput: document.getElementById('task-desc'),
    taskCategorySelect: document.getElementById('task-category'),
    taskPrioritySelect: document.getElementById('task-priority'),
    taskDateInput: document.getElementById('task-date'),
    btnCancelTask: document.getElementById('btn-cancel-task'),
    btnCloseTaskModal: document.getElementById('btn-close-task-modal'),
    taskModalTitle: document.getElementById('task-modal-title'),
    labelTaskCategory: document.getElementById('label-task-category'),
    
    // Category Modal
    modalCategory: document.getElementById('modal-category'),
    formAddCategory: document.getElementById('form-add-category'),
    categoryNameInput: document.getElementById('category-name'),
    categoryColorInput: document.getElementById('category-color'),
    categoryListItems: document.getElementById('category-list-items'),
    btnCloseCategoryModal: document.getElementById('btn-close-category-modal'),
    categoryModalTitle: document.getElementById('category-modal-title')
};

// --- INITIALIZATION ---
function init() {
    setupAuthListener();
    setupEventListeners();
    loadLocalSettings();
    applyTheme();
}

// --- LOCAL STORAGE (SETTINGS ONLY) ---
function loadLocalSettings() {
    const savedMode = localStorage.getItem('lifeflow_current_mode');
    const savedTheme = localStorage.getItem('lifeflow_theme');
    
    state.currentMode = savedMode ? savedMode : 'work';
    state.themeMode = savedTheme ? savedTheme : 'light';
    state.currentFilter = 'all';
}

function saveLocalSettings() {
    localStorage.setItem('lifeflow_current_mode', state.currentMode);
    localStorage.setItem('lifeflow_theme', state.themeMode);
}

// --- FIREBASE AUTHENTICATION ---
async function checkAndSeedCategories(uid) {
    if (state.categoriesInitialized) return;
    
    try {
        const qCat = query(collection(db, 'categories'), where('userId', '==', uid));
        const snapshot = await getDocs(qCat);
        
        if (snapshot.empty) {
            state.categoriesInitialized = true;
            const batch = writeBatch(db);
            DEFAULT_CATEGORIES.forEach(cat => {
                const newId = 'cat-' + Date.now() + Math.random().toString(36).substr(2, 5);
                batch.set(doc(db, 'categories', newId), {
                    name: cat.name,
                    color: cat.color,
                    mode: cat.mode,
                    userId: uid
                });
            });
            await batch.commit();
        } else {
            state.categoriesInitialized = true;
            
            // Premium Cleanup: Find duplicate categories by Name & Mode and delete them
            const uniqueCategories = {};
            const duplicatesToDelete = [];
            
            snapshot.forEach(document => {
                const cat = document.data();
                const key = `${cat.name.trim()}_${cat.mode}`;
                if (uniqueCategories[key]) {
                    // Already saw this category name in this mode, mark for deletion
                    duplicatesToDelete.push(document.ref);
                } else {
                    uniqueCategories[key] = true;
                }
            });
            
            if (duplicatesToDelete.length > 0) {
                const batch = writeBatch(db);
                duplicatesToDelete.forEach(ref => {
                    batch.delete(ref);
                });
                await batch.commit();
                console.log(`Cleaned up ${duplicatesToDelete.length} duplicate categories from database.`);
            }
        }
    } catch (err) {
        console.error("Error checking/seeding categories:", err);
    }
}

function setupAuthListener() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            state.currentUser = user;
            state.categoriesInitialized = false;
            
            // Show app, hide login overlay
            DOM.authContainer.style.display = 'none';
            DOM.appContainer.style.display = 'flex';
            
            // Update User Profile Header UI
            DOM.userAvatar.src = user.photoURL || 'https://www.gravatar.com/avatar/?d=mp';
            DOM.userName.textContent = user.displayName || 'User';
            DOM.userProfile.style.display = 'flex';
            
            // Seed categories if empty, then listen to updates
            checkAndSeedCategories(user.uid).then(() => {
                setupFirestoreListeners(user.uid);
            });
        } else {
            state.currentUser = null;
            
            // Unsubscribe existing listeners
            if (unsubscribeTasks) unsubscribeTasks();
            if (unsubscribeCategories) unsubscribeCategories();
            
            // Hide app, show login overlay
            DOM.appContainer.style.display = 'none';
            DOM.authContainer.style.display = 'flex';
            DOM.userProfile.style.display = 'none';
            
            // Clear tasks/categories state
            state.tasks = [];
            state.categories = [];
        }
    });
}

async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithRedirect(auth, provider);
    } catch (error) {
        console.error("Authentication Error: ", error);
        alert("ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง");
    }
}

async function logout() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Sign Out Error: ", error);
    }
}

// --- FIRESTORE LISTENERS ---
function setupFirestoreListeners(uid) {
    // Unsubscribe existing if any
    if (unsubscribeTasks) unsubscribeTasks();
    if (unsubscribeCategories) unsubscribeCategories();
    
    // Query Categories
    const qCat = query(collection(db, 'categories'), where('userId', '==', uid));
    unsubscribeCategories = onSnapshot(qCat, async (snapshot) => {
        const fetchedCategories = [];
        snapshot.forEach(doc => {
            fetchedCategories.push({ id: doc.id, ...doc.data() });
        });
        
        state.categories = fetchedCategories;
        renderCategories();
        renderTasks();
    }, (error) => {
        console.error("Categories Listener Error:", error);
    });

    // Query Tasks
    const qTasks = query(collection(db, 'tasks'), where('userId', '==', uid));
    unsubscribeTasks = onSnapshot(qTasks, (snapshot) => {
        const fetchedTasks = [];
        snapshot.forEach(doc => {
            fetchedTasks.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort tasks by 'order' index
        fetchedTasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        
        state.tasks = fetchedTasks;
        renderTasks();
    }, (error) => {
        console.error("Tasks Listener Error:", error);
    });
}

// --- THEME & MODE MANAGEMENT ---
function applyTheme() {
    // Mode (Work / Personal)
    if (state.currentMode === 'work') {
        DOM.body.classList.remove('theme-personal');
        DOM.body.classList.add('theme-work');
        DOM.btnModeWork.classList.add('active');
        DOM.btnModePersonal.classList.remove('active');
        DOM.labelTaskCategory.innerHTML = 'งาน / อาชีพย่อย';
    } else {
        DOM.body.classList.remove('theme-work');
        DOM.body.classList.add('theme-personal');
        DOM.btnModePersonal.classList.add('active');
        DOM.btnModeWork.classList.remove('active');
        DOM.labelTaskCategory.innerHTML = 'หมวดหมู่ย่อย';
    }
    
    // Theme (Light / Dark)
    if (state.themeMode === 'dark') {
        DOM.body.classList.add('dark-mode');
        DOM.btnThemeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        DOM.body.classList.remove('dark-mode');
        DOM.btnThemeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
}

function toggleMode(mode) {
    if (state.currentMode === mode) return;
    state.currentMode = mode;
    state.currentFilter = 'all'; // Reset filter on mode change
    saveLocalSettings();
    applyTheme();
    renderCategories();
    renderTasks();
}

function toggleTheme() {
    state.themeMode = state.themeMode === 'light' ? 'dark' : 'light';
    saveLocalSettings();
    applyTheme();
}

// --- RENDER FUNCTIONS ---
function renderCategories() {
    // Filter categories by current mode
    const modeCategories = state.categories.filter(cat => cat.mode === state.currentMode);
    
    // Update Filter dropdown
    let filterHtml = '<option value="all">ทุกงาน / ทุกหมวดหมู่</option>';
    modeCategories.forEach(cat => {
        filterHtml += `<option value="${cat.id}">${cat.name}</option>`;
    });
    DOM.filterCategory.innerHTML = filterHtml;
    DOM.filterCategory.value = state.currentFilter;
    
    // Update Modal select dropdown
    let selectHtml = '<option value="">-- ไม่ระบุ --</option>';
    modeCategories.forEach(cat => {
        selectHtml += `<option value="${cat.id}">${cat.name}</option>`;
    });
    DOM.taskCategorySelect.innerHTML = selectHtml;
    
    // Update Category Modal List
    let listHtml = '';
    if (modeCategories.length === 0) {
        listHtml = `<li class="empty-column-message" style="border: none; padding: 1rem;"><i class="fa-solid fa-folder-open"></i> ยังไม่มีหมวดหมู่ย่อยในโหมดนี้</li>`;
    } else {
        modeCategories.forEach(cat => {
            listHtml += `
                <li class="category-item">
                    <div class="category-info">
                        <span class="category-color-dot" style="background-color: ${cat.color}"></span>
                        <span>${cat.name}</span>
                    </div>
                    <button class="card-action-btn btn-delete" onclick="deleteCategory('${cat.id}')" title="ลบหมวดหมู่">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </li>
            `;
        });
    }
    DOM.categoryListItems.innerHTML = listHtml;
    
    // Update Modal Titles according to mode
    if (state.currentMode === 'work') {
        DOM.categoryModalTitle.textContent = 'จัดการอาชีพ / โปรเจกต์งาน';
        DOM.categoryNameInput.placeholder = 'ระบุชื่อ (เช่น โปรแกรมเมอร์, งานฟรีแลนซ์, งานเอกสาร)...';
    } else {
        DOM.categoryModalTitle.textContent = 'จัดการหมวดหมู่กิจกรรมส่วนตัว';
        DOM.categoryNameInput.placeholder = 'ระบุชื่อ (เช่น ออกกำลังกาย, ท่องเที่ยว, ทำความสะอาดบ้าน)...';
    }
}

function renderTasks() {
    // Clear columns
    DOM.columns.todo.innerHTML = '';
    DOM.columns.progress.innerHTML = '';
    DOM.columns.done.innerHTML = '';
    
    // Filter tasks by current mode
    let filteredTasks = state.tasks.filter(task => task.mode === state.currentMode);
    
    // Filter tasks by category filter dropdown selection
    if (state.currentFilter !== 'all') {
        filteredTasks = filteredTasks.filter(task => task.categoryId === state.currentFilter);
    }
    
    // Group and render tasks into columns
    const columnsData = { todo: [], progress: [], done: [] };
    filteredTasks.forEach(task => {
        if (columnsData[task.status]) {
            columnsData[task.status].push(task);
        }
    });
    
    // Render columns
    Object.keys(columnsData).forEach(status => {
        const columnContainer = DOM.columns[status];
        const taskList = columnsData[status];
        
        if (taskList.length === 0) {
            columnContainer.innerHTML = `
                <div class="empty-column-message">
                    <i class="fa-solid fa-inbox"></i>
                    <span>ไม่มีงานค้างในหน้านี้</span>
                </div>
            `;
        } else {
            taskList.forEach(task => {
                const card = createTaskCard(task);
                columnContainer.appendChild(card);
            });
        }
    });
    
    updateCounters();
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = `task-card priority-${task.priority}`;
    card.draggable = true;
    card.dataset.id = task.id;
    
    // Find category details
    const category = state.categories.find(cat => cat.id === task.categoryId);
    const categoryTag = category 
        ? `<span class="task-tag" style="background-color: ${category.color + '15'}; color: ${category.color}; border-color: ${category.color + '30'};" title="${category.name}">${category.name}</span>`
        : '';
        
    // Date formatting & overdue check
    let dateHtml = '';
    if (task.date) {
        const today = new Date().toISOString().split('T')[0];
        const isOverdue = task.date < today && task.status !== 'done';
        const dateObj = new Date(task.date);
        const formattedDate = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
        
        dateHtml = `
            <span class="task-date ${isOverdue ? 'overdue' : ''}">
                <i class="fa-regular ${isOverdue ? 'fa-circle-exclamation' : 'fa-calendar'}"></i> ${formattedDate}
            </span>
        `;
    }
    
    card.innerHTML = `
        <div class="task-card-header">
            <h4 class="task-title">${escapeHtml(task.title)}</h4>
            <div class="task-actions">
                <button class="card-action-btn btn-edit" onclick="openEditTaskModal('${task.id}')" title="แก้ไขงาน">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="card-action-btn btn-delete" onclick="deleteTask('${task.id}')" title="ลบงาน">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>
        ${task.desc ? `<p class="task-desc">${escapeHtml(task.desc)}</p>` : ''}
        <div class="task-card-footer">
            ${categoryTag}
            ${dateHtml}
        </div>
    `;
    
    // Drag events for card
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    
    return card;
}

function updateCounters() {
    const statuses = ['todo', 'progress', 'done'];
    statuses.forEach(status => {
        let count = state.tasks.filter(task => task.mode === state.currentMode && task.status === status);
        if (state.currentFilter !== 'all') {
            count = count.filter(task => task.categoryId === state.currentFilter);
        }
        DOM.counters[status].textContent = count.length;
    });
}

// --- DRAG AND DROP EVENTS ---
let draggedTaskId = null;

function handleDragStart(e) {
    draggedTaskId = this.dataset.id;
    this.classList.add('dragging');
    e.dataTransfer.setData('text/plain', draggedTaskId);
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedTaskId = null;
    
    Object.values(DOM.columns).forEach(col => {
        col.classList.remove('drag-over');
    });
}

function setupDragContainers() {
    Object.keys(DOM.columns).forEach(status => {
        const container = DOM.columns[status];
        
        container.addEventListener('dragover', e => {
            e.preventDefault();
            container.classList.add('drag-over');
            
            const afterElement = getDragAfterElement(container, e.clientY);
            const draggable = document.querySelector('.dragging');
            if (draggable) {
                if (afterElement == null) {
                    container.appendChild(draggable);
                } else {
                    container.insertBefore(draggable, afterElement);
                }
            }
        });
        
        container.addEventListener('dragleave', () => {
            container.classList.remove('drag-over');
        });
        
        container.addEventListener('drop', e => {
            e.preventDefault();
            container.classList.remove('drag-over');
            
            const id = e.dataTransfer.getData('text/plain') || draggedTaskId;
            if (id) {
                saveTaskOrder();
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function saveTaskOrder() {
    if (!state.currentUser) return;
    
    const statuses = ['todo', 'progress', 'done'];
    const visibleOrderedIds = [];
    
    // Get visible columns order from DOM
    statuses.forEach(status => {
        const container = DOM.columns[status];
        const cards = container.querySelectorAll('.task-card');
        cards.forEach(card => {
            visibleOrderedIds.push(card.dataset.id);
            const task = state.tasks.find(t => t.id === card.dataset.id);
            if (task) {
                task.status = status;
            }
        });
    });
    
    // Separate visible and invisible tasks
    const invisibleTasks = state.tasks.filter(task => {
        const isVisible = (task.mode === state.currentMode) && 
                          (state.currentFilter === 'all' || task.categoryId === state.currentFilter);
        return !isVisible;
    });
    
    const visibleTasks = [];
    visibleOrderedIds.forEach(id => {
        const task = state.tasks.find(t => t.id === id);
        if (task) {
            visibleTasks.push(task);
        }
    });
    
    const combined = [...invisibleTasks, ...visibleTasks];
    
    // Batch update order and status to Firestore
    try {
        const batch = writeBatch(db);
        combined.forEach((task, index) => {
            const taskRef = doc(db, 'tasks', task.id);
            batch.update(taskRef, {
                order: index,
                status: task.status
            });
        });
        await batch.commit();
    } catch (error) {
        console.error("Error committing drag and drop order to Firestore:", error);
    }
}

// --- TASK CRUD ACTIONS ---
window.openAddTaskModal = function() {
    DOM.formTask.reset();
    DOM.taskIdInput.value = '';
    DOM.taskModalTitle.textContent = 'สร้างงานค้างคาใหม่';
    
    renderCategories();
    DOM.modalTask.classList.add('open');
};

window.openEditTaskModal = function(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    
    DOM.taskIdInput.value = task.id;
    DOM.taskTitleInput.value = task.title;
    DOM.taskDescInput.value = task.desc || '';
    
    renderCategories();
    DOM.taskCategorySelect.value = task.categoryId || '';
    DOM.taskPrioritySelect.value = task.priority;
    DOM.taskDateInput.value = task.date || '';
    
    DOM.taskModalTitle.textContent = 'แก้ไขรายละเอียดงาน';
    DOM.modalTask.classList.add('open');
};

function closeTaskModal() {
    DOM.modalTask.classList.remove('open');
}

async function handleTaskFormSubmit(e) {
    e.preventDefault();
    if (!state.currentUser) return;
    
    const id = DOM.taskIdInput.value;
    const title = DOM.taskTitleInput.value.trim();
    const desc = DOM.taskDescInput.value.trim();
    const categoryId = DOM.taskCategorySelect.value;
    const priority = DOM.taskPrioritySelect.value;
    const date = DOM.taskDateInput.value;
    
    if (!title) return;
    
    try {
        if (id) {
            // Edit Mode: Update Firestore Doc
            const taskRef = doc(db, 'tasks', id);
            await updateDoc(taskRef, {
                title,
                desc,
                categoryId,
                priority,
                date
            });
        } else {
            // Create Mode: Add Firestore Doc
            const newId = 'task-' + Date.now() + Math.random().toString(36).substr(2, 5);
            // Put it at the end of the order
            const orderIndex = state.tasks.length;
            await setDoc(doc(db, 'tasks', newId), {
                title,
                desc,
                categoryId,
                priority,
                date,
                status: 'todo',
                mode: state.currentMode,
                userId: state.currentUser.uid,
                order: orderIndex
            });
        }
        closeTaskModal();
    } catch (error) {
        console.error("Error saving task to Firestore:", error);
        alert("ไม่สามารถบันทึกงานได้ในขณะนี้");
    }
}

window.deleteTask = async function(id) {
    if (!state.currentUser) return;
    
    const card = document.querySelector(`.task-card[data-id="${id}"]`);
    if (card) {
        card.style.transform = 'scale(0.8)';
        card.style.opacity = '0';
        card.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 1, 1)';
        
        setTimeout(async () => {
            try {
                await deleteDoc(doc(db, 'tasks', id));
            } catch (error) {
                console.error("Error deleting task in Firestore:", error);
                alert("ไม่สามารถลบงานได้ในขณะนี้");
            }
        }, 300);
    }
};

// --- CATEGORY CRUD ACTIONS ---
window.openCategoryModal = function() {
    DOM.formAddCategory.reset();
    DOM.categoryColorInput.value = getRandomColor();
    renderCategories();
    DOM.modalCategory.classList.add('open');
};

function closeCategoryModal() {
    DOM.modalCategory.classList.remove('open');
}

async function handleAddCategorySubmit(e) {
    e.preventDefault();
    if (!state.currentUser) return;
    
    const name = DOM.categoryNameInput.value.trim();
    const color = DOM.categoryColorInput.value;
    
    if (!name) return;
    
    try {
        const newId = 'cat-' + Date.now() + Math.random().toString(36).substr(2, 5);
        await setDoc(doc(db, 'categories', newId), {
            name,
            color,
            mode: state.currentMode,
            userId: state.currentUser.uid
        });
        
        DOM.formAddCategory.reset();
        DOM.categoryColorInput.value = getRandomColor();
    } catch (error) {
        console.error("Error adding category to Firestore:", error);
        alert("ไม่สามารถเพิ่มหมวดหมู่ได้ในขณะนี้");
    }
}

window.deleteCategory = async function(id) {
    if (!state.currentUser) return;
    
    try {
        const batch = writeBatch(db);
        
        // Unlink this category from all tasks
        const tasksToUpdate = state.tasks.filter(task => task.categoryId === id);
        tasksToUpdate.forEach(task => {
            batch.update(doc(db, 'tasks', task.id), { categoryId: '' });
        });
        
        // Delete category doc
        batch.delete(doc(db, 'categories', id));
        
        await batch.commit();
    } catch (error) {
        console.error("Error deleting category in Firestore:", error);
        alert("ไม่สามารถลบหมวดหมู่ได้ในขณะนี้");
    }
}

// --- HELPERS ---
function setupEventListeners() {
    // Auth actions
    DOM.btnLoginGoogle.addEventListener('click', loginWithGoogle);
    DOM.btnLogout.addEventListener('click', logout);
    
    // Mode triggers
    DOM.btnModeWork.addEventListener('click', () => toggleMode('work'));
    DOM.btnModePersonal.addEventListener('click', () => toggleMode('personal'));
    
    // Theme trigger
    DOM.btnThemeToggle.addEventListener('click', toggleTheme);
    
    // Add Task trigger
    DOM.btnAddTask.addEventListener('click', openAddTaskModal);
    DOM.btnCancelTask.addEventListener('click', closeTaskModal);
    DOM.btnCloseTaskModal.addEventListener('click', closeTaskModal);
    
    // Manage category trigger
    DOM.btnManageCategories.addEventListener('click', openCategoryModal);
    DOM.btnCloseCategoryModal.addEventListener('click', closeCategoryModal);
    
    // Forms
    DOM.formTask.addEventListener('submit', handleTaskFormSubmit);
    DOM.formAddCategory.addEventListener('submit', handleAddCategorySubmit);
    
    // Dropdown filters
    DOM.filterCategory.addEventListener('change', (e) => {
        state.currentFilter = e.target.value;
        renderTasks();
    });
    
    // Close modals on clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === DOM.modalTask) closeTaskModal();
        if (e.target === DOM.modalCategory) closeCategoryModal();
    });
    
    setupDragContainers();
}

function getRandomColor() {
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#14b8a6'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Start application
document.addEventListener('DOMContentLoaded', init);
