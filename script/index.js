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
const headerDayEl = document.getElementById('dayoftheweek');

// Modal Elements
const noteModal = document.getElementById('note-modal');
const modalTitle = document.getElementById('modal-title');
const noteTitleInput = document.getElementById('note-title-input');
const noteBodyInput = document.getElementById('note-body-input');
const closeModalBtn = document.getElementById('close-modal-btn');
const saveNoteBtn = document.getElementById('save-note-btn');
const insertNumListBtn = document.getElementById('insert-numbered-list-btn');
const insertBulletListBtn = document.getElementById('insert-bullet-list-btn');

// --- Helper Functions ---

function formatDayOfWeek(date = new Date()) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
}

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

function getNoteDay(note) {
    if (note.day) return note.day;
    if (note.created_at) {
        const d = new Date(note.created_at);
        if (!isNaN(d.getTime())) return formatDayOfWeek(d);
    }
    if (note.date) {
        const parts = note.date.split('/');
        if (parts.length === 3) {
            const d = new Date(parts[2], parts[1] - 1, parts[0]);
            if (!isNaN(d.getTime())) return formatDayOfWeek(d);
        }
    }
    return formatDayOfWeek(new Date());
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

// Convert note text into formatted HTML with real list elements (<ol>, <ul>, <li>)
function formatNoteBodyToHTML(bodyText) {
    if (!bodyText) return '';

    const lines = bodyText.split('\n');
    let html = '';
    let inOl = false;
    let inUl = false;

    lines.forEach((line) => {
        const trimmed = line.trim();
        // 1. Numbered list line: e.g. "1.text" or "1. text"
        const numMatch = line.match(/^(\s*)(\d+)\.\s*(.*)$/);
        // 2. Bullet list line: e.g. ".text" or ". text" or "• text" or "- text"
        const dotMatch = !numMatch && line.match(/^(\s*)([\u2022\-\*]|\.(?!\.))\s*(.*)$/);

        if (numMatch) {
            if (inUl) {
                html += '</ul>';
                inUl = false;
            }
            if (!inOl) {
                html += '<ol class="note-body-list note-body-ol">';
                inOl = true;
            }
            html += `<li>${escapeHTML(numMatch[3])}</li>`;
        } else if (dotMatch) {
            if (inOl) {
                html += '</ol>';
                inOl = false;
            }
            if (!inUl) {
                html += '<ul class="note-body-list note-body-ul">';
                inUl = true;
            }
            html += `<li>${escapeHTML(dotMatch[3])}</li>`;
        } else {
            if (inOl) {
                html += '</ol>';
                inOl = false;
            }
            if (inUl) {
                html += '</ul>';
                inUl = false;
            }
            if (trimmed) {
                html += `<div class="note-body-line">${escapeHTML(line)}</div>`;
            } else {
                html += '<div class="note-body-spacer"></div>';
            }
        }
    });

    if (inOl) html += '</ol>';
    if (inUl) html += '</ul>';

    return html;
}

function updateHeaderClock() {
    const now = new Date();
    if (headerDayEl) headerDayEl.textContent = formatDayOfWeek(now);
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
            notes = getLocalNotes();
            renderNotes();
            return;
        }

        notes = (data || []).map(note => ({
            ...note,
            day: getNoteDay(note)
        }));
        saveLocalNotes(notes);
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
    const currentDay = formatDayOfWeek(now);

    isSaving = true;
    if (saveNoteBtn) {
        saveNoteBtn.textContent = 'Saving...';
        saveNoteBtn.disabled = true;
    }

    try {
        const notePayload = {
            title: title || 'Untitled Note',
            body: body,
            date: currentDate,
            time: currentTime
        };

        if (db) {
            let err = null;
            try {
                // Try sending with 'day' field
                const res = editingNoteId
                    ? await db.from('notes').update({ ...notePayload, day: currentDay }).eq('id', editingNoteId)
                    : await db.from('notes').insert([{ ...notePayload, day: currentDay }]);
                err = res.error;
            } catch (e) {
                err = e;
            }

            // If Supabase schema does not yet have 'day' column (PGRST204), retry without it
            if (err && (err.code === 'PGRST204' || (err.message && err.message.includes('day')))) {
                const fallbackRes = editingNoteId
                    ? await db.from('notes').update(notePayload).eq('id', editingNoteId)
                    : await db.from('notes').insert([notePayload]);
                if (fallbackRes.error) throw fallbackRes.error;
            } else if (err) {
                throw err;
            }

            await fetchNotes();
        } else {
            // Local storage fallback
            if (editingNoteId) {
                const idx = notes.findIndex(n => String(n.id) === String(editingNoteId));
                if (idx !== -1) {
                    notes[idx].title = title || 'Untitled Note';
                    notes[idx].body = body;
                    notes[idx].date = currentDate;
                    notes[idx].time = currentTime;
                    notes[idx].day = currentDay;
                }
            } else {
                notes.unshift({
                    id: Date.now(),
                    title: title || 'Untitled Note',
                    body: body,
                    date: currentDate,
                    time: currentTime,
                    day: currentDay
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

        const noteDay = getNoteDay(note);
        const formattedBodyHTML = formatNoteBodyToHTML(note.body || '');

        li.innerHTML = `
            <div class="note-hero">
                <h1 class="note-header">${escapeHTML(note.title)}</h1>
                <div id="note-timeDate">
                    <span class="dayoftheweek">${escapeHTML(noteDay)}</span>:
                    <span id="Note-date">${escapeHTML(note.date || '')}</span>,
                    <span id="Note-time">${escapeHTML(note.time || '')}</span>
                </div>
                <div class="note-body">${formattedBodyHTML}</div>
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

// --- Auto-List (Auto-Numbering & Auto-Bullet) in Textarea ---

function setupAutoList(textarea) {
    if (!textarea) return;

    textarea.addEventListener('keydown', (e) => {
        const isEnter = (e.key === 'Enter' || e.keyCode === 13 || e.which === 13);
        if (isEnter && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            const cursorPos = textarea.selectionStart;
            const textBefore = textarea.value.substring(0, cursorPos);
            const textAfter = textarea.value.substring(textarea.selectionEnd);

            const lastNewline = textBefore.lastIndexOf('\n');
            const currentLine = textBefore.substring(lastNewline + 1);

            // 1. Match numbered list: e.g. "1.text", "1. text", "1."
            const numMatch = currentLine.match(/^(\s*)(\d+)\.(\s*)(.*)$/);
            // 2. Match dot/bullet list: e.g. ".text", ". text", "." (excluding ellipsis "...")
            const dotMatch = !numMatch && currentLine.match(/^(\s*)([\u2022\-\*]|\.(?!\.))(\s*)(.*)$/);

            if (numMatch) {
                const indent = numMatch[1];
                const num = parseInt(numMatch[2], 10);
                const space = numMatch[3];
                const content = numMatch[4];

                e.preventDefault();

                // If line has no text, exit the numbered list
                if (content.trim() === '') {
                    const lineStart = lastNewline + 1;
                    textarea.value = textarea.value.substring(0, lineStart) + textAfter;
                    textarea.selectionStart = textarea.selectionEnd = lineStart;
                    return;
                }

                // Continue numbering: e.g. 1.text -> 2., 1. text -> 2. 
                const nextPrefix = indent + (num + 1) + '.' + space;
                const insertText = '\n' + nextPrefix;
                textarea.value = textBefore + insertText + textAfter;
                const newCursor = cursorPos + insertText.length;
                textarea.selectionStart = textarea.selectionEnd = newCursor;
                return;
            }

            if (dotMatch) {
                const indent = dotMatch[1];
                const bullet = dotMatch[2];
                const space = dotMatch[3];
                const content = dotMatch[4];

                e.preventDefault();

                // If line has no text, exit the dot/bullet list
                if (content.trim() === '') {
                    const lineStart = lastNewline + 1;
                    textarea.value = textarea.value.substring(0, lineStart) + textAfter;
                    textarea.selectionStart = textarea.selectionEnd = lineStart;
                    return;
                }

                // Continue dot/bullet: e.g. .text -> ., . text -> . 
                const nextPrefix = indent + bullet + space;
                const insertText = '\n' + nextPrefix;
                textarea.value = textBefore + insertText + textAfter;
                const newCursor = cursorPos + insertText.length;
                textarea.selectionStart = textarea.selectionEnd = newCursor;
                return;
            }
        }
    });
}

// Helper to insert list prefix from modal toolbar buttons
function insertListPrefix(prefix) {
    if (!noteBodyInput) return;
    noteBodyInput.focus();
    const cursorPos = noteBodyInput.selectionStart;
    const textBefore = noteBodyInput.value.substring(0, cursorPos);
    const textAfter = noteBodyInput.value.substring(noteBodyInput.selectionEnd);

    // If not at the beginning of a line, insert on a new line
    const needsNewline = cursorPos > 0 && textBefore[cursorPos - 1] !== '\n';
    const textToInsert = (needsNewline ? '\n' : '') + prefix;

    noteBodyInput.value = textBefore + textToInsert + textAfter;
    const newPos = cursorPos + textToInsert.length;
    noteBodyInput.selectionStart = noteBodyInput.selectionEnd = newPos;
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
    // 1. Clock and Day of Week
    updateHeaderClock();
    setInterval(updateHeaderClock, 1000);

    // 2. Fetch notes from Supabase database
    fetchNotes();

    // 3. Listen for realtime database changes across all devices
    setupRealtime();

    // 4. Setup auto-numbering and auto-bulleting in note body textarea
    setupAutoList(noteBodyInput);

    // 5. Connect list toolbar buttons
    if (insertNumListBtn) {
        insertNumListBtn.addEventListener('click', () => insertListPrefix('1. '));
    }
    if (insertBulletListBtn) {
        insertBulletListBtn.addEventListener('click', () => insertListPrefix('. '));
    }

    // 6. Modal event listeners
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
