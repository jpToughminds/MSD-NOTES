// MSD NOTES - Supabase Cloud Database & App Logic

// Supabase Configuration
const SUPABASE_URL = "https://jwodxxdddsfofexlrmuy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dZOxxh2RGw6Y9jXIfeyBIQ_pcYzsQz1";

// Initialize Supabase Client
const db = (window.supabase && typeof window.supabase.createClient === 'function')
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

const LOCAL_STORAGE_KEY = 'msd_notes';

// State
let notes = [];
let editingNoteId = null;
let isSaving = false;

// DOM Elements
const heroList = document.querySelector('.hero-list');
const addNoteBtn = document.getElementById('add-notes');
const headerDateEl = document.getElementById('date');
const headerTimeEl = document.getElementById('time');

// Modal Elements
const noteModal = document.getElementById('note-modal');
const modalTitle = document.getElementById('modal-title');
const noteTitleInput = document.getElementById('note-title-input');
const noteBodyInput = document.getElementById('note-body-input');
const closeModalBtn = document.getElementById('close-modal-btn');
const saveNoteBtn = document.getElementById('save-note-btn');

// --- Helper Functions ---

function formatDate(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function formatTime(date = new Date()) {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function updateHeaderClock() {
    const now = new Date();
    if (headerDateEl) headerDateEl.textContent = formatDate(now);
    if (headerTimeEl) headerTimeEl.textContent = formatTime(now);
}

// Local Storage Fallback Helpers
function getLocalNotes() {
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveLocalNotes(arr) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {}
}

// --- Database Operations ---

// 1. Fetch notes from Supabase (with fallback to local storage)
async function fetchNotes() {
    if (!db) {
        console.warn('Supabase client not available, using local storage.');
        notes = getLocalNotes();
        renderNotes();
        return;
    }

    try {
        const { data, error } = await db
            .from('notes')
            .select('*')
            .order('id', { ascending: false });

        if (error) {
            console.error('Supabase error fetching notes:', error.message);
            // If table doesn't exist yet, fall back to local storage
            notes = getLocalNotes();
            renderNotes();
            return;
        }

        notes = data || [];
        saveLocalNotes(notes); // Keep local cache up to date
        renderNotes();
    } catch (err) {
        console.error('Failed to connect to Supabase:', err);
        notes = getLocalNotes();
        renderNotes();
    }
}

// 2. Save (Create or Update) note
async function handleSaveNote() {
    if (isSaving) return;

    const title = noteTitleInput ? noteTitleInput.value.trim() : '';
    const body = noteBodyInput ? noteBodyInput.value.trim() : '';

    if (!title && !body) {
        alert('Please enter a title or note content.');
        return;
    }

    const now = new Date();
    const currentDate = formatDate(now);
    const currentTime = formatTime(now);

    isSaving = true;
    if (saveNoteBtn) {
        saveNoteBtn.textContent = 'Saving...';
        saveNoteBtn.disabled = true;
    }

    try {
        if (db) {
            if (editingNoteId) {
                // Update in database
                const { error } = await db
                    .from('notes')
                    .update({
                        title: title || 'Untitled Note',
                        body: body,
                        date: currentDate,
                        time: currentTime
                    })
                    .eq('id', editingNoteId);

                if (error) throw error;
            } else {
                // Insert into database
                const { error } = await db
                    .from('notes')
                    .insert([{
                        title: title || 'Untitled Note',
                        body: body,
                        date: currentDate,
                        time: currentTime
                    }]);

                if (error) throw error;
            }

            await fetchNotes();
        } else {
            // Local fallback
            if (editingNoteId) {
                const idx = notes.findIndex(n => String(n.id) === String(editingNoteId));
                if (idx !== -1) {
                    notes[idx].title = title || 'Untitled Note';
                    notes[idx].body = body;
                    notes[idx].date = currentDate;
                    notes[idx].time = currentTime;
                }
            } else {
                notes.unshift({
                    id: Date.now(),
                    title: title || 'Untitled Note',
                    body: body,
                    date: currentDate,
                    time: currentTime
                });
            }
            saveLocalNotes(notes);
            renderNotes();
        }

        closeModal();
    } catch (err) {
        console.error('Error saving note:', err);
        alert('Failed to save note to database: ' + (err.message || 'Please check your connection or table setup.'));
    } finally {
        isSaving = false;
        if (saveNoteBtn) {
            saveNoteBtn.textContent = 'Save Note';
            saveNoteBtn.disabled = false;
        }
    }
}

// 3. Delete note
async function deleteNote(noteId) {
    const note = notes.find(n => String(n.id) === String(noteId));
    const titleText = note ? `"${note.title}"` : 'this note';

    if (!confirm(`Are you sure you want to delete ${titleText}?`)) {
        return;
    }

    try {
        if (db) {
            const { error } = await db
                .from('notes')
                .delete()
                .eq('id', noteId);

            if (error) throw error;
            await fetchNotes();
        } else {
            notes = notes.filter(n => String(n.id) !== String(noteId));
            saveLocalNotes(notes);
            renderNotes();
        }
    } catch (err) {
        console.error('Error deleting note:', err);
        alert('Failed to delete note: ' + (err.message || 'Error'));
    }
}

// --- Render Notes on the Page ---

function renderNotes() {
    if (!heroList) return;

    // Remove existing note items while preserving #add-notes button
    const noteItems = heroList.querySelectorAll('.note');
    noteItems.forEach(item => item.remove());

    if (notes.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'note empty-notes';
        emptyItem.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; color: #000; padding: 20px; box-sizing: border-box;">
                <p style="font-weight: bold; font-size: 15px; margin: 0 0 5px 0;">No notes found</p>
                <p style="font-size: 13px; margin: 0;">Click "ADD NOTE" above to create your first note.</p>
            </div>
        `;
        heroList.appendChild(emptyItem);
        return;
    }

    notes.forEach(note => {
        const li = document.createElement('li');
        li.className = 'note';
        li.dataset.id = note.id;

        li.innerHTML = `
            <div class="note-hero">
                <h1 class="note-header">${escapeHTML(note.title)}</h1>
                <div id="note-timeDate">
                    <span id="Note-date">${escapeHTML(note.date || '')}</span>
                    <span id="Note-time">${escapeHTML(note.time || '')}</span>
                </div>
                <p class="note-body">${escapeHTML(note.body || '')}</p>
            </div>
            <div class="note-settings">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">
                    <path d="M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z" />
                </svg>
                <div class="The-settings-options">
                    <div class="note-edit">Edit</div>
                    <div class="note-delete">Delete</div>
                </div>
            </div>
        `;

        const noteHero = li.querySelector('.note-hero');
        const settingsSvg = li.querySelector('.note-settings svg');
        const settingsOptions = li.querySelector('.The-settings-options');
        const editBtn = li.querySelector('.note-edit');
        const deleteBtn = li.querySelector('.note-delete');

        // Toggle 3-dots settings dropdown
        settingsSvg.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.The-settings-options.active').forEach(el => {
                if (el !== settingsOptions) el.classList.remove('active');
            });
            settingsOptions.classList.toggle('active');
        });

        // Edit button click
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsOptions.classList.remove('active');
            openModal(note.id);
        });

        // Delete button click
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsOptions.classList.remove('active');
            deleteNote(note.id);
        });

        // Clicking the note body opens modal in edit mode
        noteHero.addEventListener('click', () => {
            openModal(note.id);
        });

        heroList.appendChild(li);
    });
}

// Close any open settings dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.note-settings')) {
        document.querySelectorAll('.The-settings-options.active').forEach(el => {
            el.classList.remove('active');
        });
    }
});

// --- Modal Popup Operations ---

function openModal(noteId = null) {
    if (!noteModal) return;

    editingNoteId = noteId;

    if (noteId) {
        const note = notes.find(n => String(n.id) === String(noteId));
        if (note) {
            if (modalTitle) modalTitle.textContent = 'Edit Note';
            if (noteTitleInput) noteTitleInput.value = note.title || '';
            if (noteBodyInput) noteBodyInput.value = note.body || '';
        }
    } else {
        if (modalTitle) modalTitle.textContent = 'Add Note';
        if (noteTitleInput) noteTitleInput.value = '';
        if (noteBodyInput) noteBodyInput.value = '';
    }

    noteModal.classList.add('open');
    if (noteTitleInput) {
        setTimeout(() => noteTitleInput.focus(), 50);
    }
}

function closeModal() {
    if (!noteModal) return;
    noteModal.classList.remove('open');
    if (noteTitleInput) noteTitleInput.value = '';
    if (noteBodyInput) noteBodyInput.value = '';
    editingNoteId = null;
}

// --- Live Realtime Synchronization ---

function setupRealtime() {
    if (!db) return;

    try {
        db.channel('public:notes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => {
                fetchNotes();
            })
            .subscribe();
    } catch (e) {
        console.warn('Realtime subscription not supported:', e);
    }
}

// --- App Initialization ---

function init() {
    // 1. Clock
    updateHeaderClock();
    setInterval(updateHeaderClock, 1000);

    // 2. Fetch notes from Supabase database
    fetchNotes();

    // 3. Listen for realtime database changes across all devices
    setupRealtime();

    // 4. Modal event listeners
    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', () => openModal(null));
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }

    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', handleSaveNote);
    }

    if (noteModal) {
        noteModal.addEventListener('click', (e) => {
            if (e.target === noteModal) closeModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (noteModal && noteModal.classList.contains('open')) {
            if (e.key === 'Escape') closeModal();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSaveNote();
        }
    });
}

// Start app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
