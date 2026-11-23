(function () {
    const SESSION_KEY = 'cg_supabase_session';

    let activeGallery = null;
    let sessionToken = null;
    let selectedSet = new Set();
    let photoNotes = {};
    let currentFilter = 'all'; // 'all' | 'selected'
    let lightboxIndex = -1;
    let visibleImages = [];

    function draftStorageKey(galleryId) {
        return `cg_draft_${galleryId}`;
    }

    function loadDraft() {
        if (!activeGallery) return;
        try {
            const raw = localStorage.getItem(draftStorageKey(activeGallery.galleryId));
            if (!raw) return;
            const parsed = JSON.parse(raw);
            selectedSet = new Set(Array.isArray(parsed.selected) ? parsed.selected : []);
            photoNotes = parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {};
        } catch {
            selectedSet = new Set();
            photoNotes = {};
        }
    }

    function saveDraft() {
        if (!activeGallery) return;
        localStorage.setItem(
            draftStorageKey(activeGallery.galleryId),
            JSON.stringify({
                selected: Array.from(selectedSet),
                notes: photoNotes,
            })
        );
    }

    function showError(msg) {
        const errEl = document.getElementById('cg-login-error');
        if (!errEl) return;
        errEl.textContent = msg;
        errEl.style.display = msg ? 'block' : 'none';
    }

    async function handleUnlock(e) {
        e.preventDefault();
        const pwInput = document.getElementById('cg-password');
        const btn = document.getElementById('cg-unlock-btn');
        const password = (pwInput.value || '').trim();
        if (!password) return;

        showError('');
        btn.disabled = true;
        btn.textContent = 'Unlocking...';

        try {
            const res = await fetch('/api/gallery-unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const text = await res.text();
            let data = null;
            try { data = text ? JSON.parse(text) : {}; } catch {
                throw new Error('Gallery API is unavailable here (make sure you are viewing the Vercel deployment).');
            }
            if (!res.ok) {
                throw new Error(data.error || 'Incorrect gallery password.');
            }
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
            pwInput.value = '';
            openGallery(data.gallery, data.token);
        } catch (err) {
            showError(err.message || 'Incorrect gallery password. Please check your password and try again.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Unlock Gallery';
        }
    }

    function openGallery(gallery, token) {
        activeGallery = gallery;
        sessionToken = token;
        selectedSet = new Set();
        photoNotes = {};
        currentFilter = 'all';
        loadDraft();

        document.getElementById('cg-login-view').style.display = 'none';
        document.getElementById('cg-gallery-view').style.display = 'block';

        document.getElementById('cg-session-title').textContent = gallery.sessionTitle || 'Your Proof Gallery';
        document.getElementById('cg-client-subtitle').textContent = `Prepared for ${gallery.clientName || 'Client'} \u2022 ${(gallery.images || []).length} photos`;
        document.getElementById('cg-instructions').textContent = gallery.instructions || '';

        const maxLabel = document.getElementById('cg-max-label');
        maxLabel.textContent = gallery.maxSelections ? ` / ${gallery.maxSelections} included` : '';

        document.getElementById('cg-filter-all').classList.add('active');
        document.getElementById('cg-filter-selected').classList.remove('active');

        renderGrid();
        updateCounter();
    }

    function lockGallery() {
        activeGallery = null;
        sessionToken = null;
        selectedSet = new Set();
        photoNotes = {};
        sessionStorage.removeItem(SESSION_KEY);
        document.getElementById('cg-gallery-view').style.display = 'none';
        document.getElementById('cg-login-view').style.display = 'block';
        document.getElementById('cg-grid').innerHTML = '';
        showError('');
    }

    function updateCounter() {
        const countEl = document.getElementById('cg-selected-count');
        const submitBtn = document.getElementById('cg-open-submit');
        const count = selectedSet.size;
        if (countEl) countEl.textContent = String(count);
        if (submitBtn) submitBtn.disabled = count === 0;
    }

    function toggleSelect(imageName) {
        if (selectedSet.has(imageName)) {
            selectedSet.delete(imageName);
        } else {
            if (activeGallery && activeGallery.maxSelections && selectedSet.size >= activeGallery.maxSelections) {
                alert(`Your package includes up to ${activeGallery.maxSelections} photos. Deselect one first to choose another, or note extra picks in the submission notes.`);
                return false;
            }
            selectedSet.add(imageName);
        }
        saveDraft();
        updateCounter();
        syncCardStates();
        if (currentFilter === 'selected') {
            renderGrid();
        }
        return true;
    }

    function syncCardStates() {
        document.querySelectorAll('.cg-card').forEach(card => {
            const name = card.dataset.name;
            const isSelected = selectedSet.has(name);
            card.classList.toggle('selected', isSelected);
            const btn = card.querySelector('.cg-select-btn');
            if (btn) {
                btn.classList.toggle('selected', isSelected);
                btn.textContent = isSelected ? '\u2713 Selected' : 'Select';
            }
        });
        if (lightboxIndex >= 0 && visibleImages[lightboxIndex]) {
            updateLightboxSelectBtn(visibleImages[lightboxIndex].name);
        }
    }

    function renderGrid() {
        const grid = document.getElementById('cg-grid');
        if (!activeGallery || !grid) return;

        const allImages = activeGallery.images || [];
        visibleImages = currentFilter === 'selected'
            ? allImages.filter(img => selectedSet.has(img.name))
            : allImages;

        if (!visibleImages.length) {
            grid.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #666;">
                ${currentFilter === 'selected' ? 'No photos selected yet. Click "All Photos" to browse your gallery.' : 'No images found in this gallery yet.'}
            </p>`;
            return;
        }

        grid.innerHTML = '';
        visibleImages.forEach((imgObj, idx) => {
            const isSelected = selectedSet.has(imgObj.name);
            const noteVal = photoNotes[imgObj.name] || '';

            const card = document.createElement('div');
            card.className = `cg-card${isSelected ? ' selected' : ''}`;
            card.dataset.name = imgObj.name;

            const thumbWrap = document.createElement('div');
            thumbWrap.className = 'cg-thumb-wrap';
            thumbWrap.setAttribute('oncontextmenu', 'return false;');
            thumbWrap.onclick = () => openLightbox(idx);

            const img = document.createElement('img');
            img.src = imgObj.url;
            img.alt = imgObj.name;
            img.loading = 'lazy';
            img.draggable = false;

            const watermark = document.createElement('div');
            watermark.className = 'cg-watermark';
            watermark.textContent = 'PROOF \u2022 Capture A Storm';

            thumbWrap.appendChild(img);
            thumbWrap.appendChild(watermark);

            const footer = document.createElement('div');
            footer.className = 'cg-card-footer';

            const topRow = document.createElement('div');
            topRow.className = 'cg-card-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'cg-filename';
            nameSpan.textContent = imgObj.name;
            nameSpan.title = imgObj.name;

            const selBtn = document.createElement('button');
            selBtn.type = 'button';
            selBtn.className = `cg-select-btn${isSelected ? ' selected' : ''}`;
            selBtn.textContent = isSelected ? '\u2713 Selected' : 'Select';
            selBtn.onclick = (ev) => {
                ev.stopPropagation();
                toggleSelect(imgObj.name);
            };

            topRow.appendChild(nameSpan);
            topRow.appendChild(selBtn);

            const noteInput = document.createElement('input');
            noteInput.type = 'text';
            noteInput.className = 'cg-note-input';
            noteInput.placeholder = 'Optional edit note (e.g. B&W)...';
            noteInput.value = noteVal;
            noteInput.oninput = () => {
                const val = noteInput.value.trim();
                if (val) {
                    photoNotes[imgObj.name] = val;
                } else {
                    delete photoNotes[imgObj.name];
                }
                saveDraft();
            };

            footer.appendChild(topRow);
            footer.appendChild(noteInput);

            card.appendChild(thumbWrap);
            card.appendChild(footer);
            grid.appendChild(card);
        });
    }

    function openLightbox(idx) {
        if (!visibleImages.length) return;
        lightboxIndex = idx;
        renderLightboxImage();
        document.getElementById('cgLightbox').style.display = 'block';
    }

    function closeLightbox() {
        document.getElementById('cgLightbox').style.display = 'none';
        lightboxIndex = -1;
    }

    function renderLightboxImage() {
        const imgObj = visibleImages[lightboxIndex];
        if (!imgObj) return;
        document.getElementById('cg-lb-img').src = imgObj.url;
        document.getElementById('cg-lb-img').alt = imgObj.name;
        document.getElementById('cg-lb-filename').textContent = `${imgObj.name} (${lightboxIndex + 1} / ${visibleImages.length})`;
        updateLightboxSelectBtn(imgObj.name);
    }

    function updateLightboxSelectBtn(name) {
        const btn = document.getElementById('cg-lb-select-btn');
        const isSelected = selectedSet.has(name);
        btn.classList.toggle('selected', isSelected);
        btn.textContent = isSelected ? '\u2713 Selected' : 'Select Photo';
    }

    function stepLightbox(delta) {
        if (!visibleImages.length) return;
        lightboxIndex = (lightboxIndex + delta + visibleImages.length) % visibleImages.length;
        renderLightboxImage();
    }

    function getSelectedPhotoObjects() {
        return (activeGallery.images || [])
            .filter(img => selectedSet.has(img.name))
            .map(img => ({
                photoId: img.id,
                filename: img.name,
                note: photoNotes[img.name] || '',
            }));
    }

    function buildSelectionSummaryText(clientName, clientEmail, generalNotes) {
        const picks = getSelectedPhotoObjects();
        const lines = [
            `Client Gallery Selection`,
            `Session: ${activeGallery.sessionTitle || 'Proof Gallery'}`,
            `Client Name: ${clientName}`,
            `Client Email: ${clientEmail}`,
            `Total Selected: ${picks.length}${activeGallery.maxSelections ? ` / ${activeGallery.maxSelections}` : ''}`,
            ``,
            `Selected Photos:`,
            ...picks.map((p, i) => `${i + 1}. ${p.filename}${p.note ? ` — Note: ${p.note}` : ''}`),
        ];

        if (generalNotes) {
            lines.push('', `General Notes:`, generalNotes);
        }
        return lines.join('\n');
    }

    function openSubmitModal() {
        const listEl = document.getElementById('cg-review-list');
        const picks = getSelectedPhotoObjects();

        listEl.innerHTML = picks.map((p, i) => {
            const note = p.note ? `<span class="cg-review-note"> — ${escapeHtml(p.note)}</span>` : '';
            return `<div class="cg-review-item"><strong>${i + 1}. ${escapeHtml(p.filename)}</strong>${note}</div>`;
        }).join('');

        const nameInput = document.getElementById('cg-submit-name');
        if (!nameInput.value && activeGallery.clientName) {
            nameInput.value = activeGallery.clientName;
        }

        const statusEl = document.getElementById('cg-submit-status');
        statusEl.style.display = 'none';
        statusEl.textContent = '';
        statusEl.className = 'cg-submit-status';

        document.getElementById('cgSubmitModal').style.display = 'block';
    }

    function closeSubmitModal() {
        document.getElementById('cgSubmitModal').style.display = 'none';
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function handleSubmitSelection(e) {
        e.preventDefault();
        if (!activeGallery || !sessionToken) return;

        const clientName = document.getElementById('cg-submit-name').value.trim();
        const clientEmail = document.getElementById('cg-submit-email').value.trim();
        const generalNotes = document.getElementById('cg-submit-notes').value.trim();
        const selectedPhotos = getSelectedPhotoObjects();

        const sendBtn = document.getElementById('cg-send-btn');
        const statusEl = document.getElementById('cg-submit-status');

        sendBtn.disabled = true;
        sendBtn.textContent = 'Submitting...';

        try {
            const res = await fetch('/api/gallery-submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: sessionToken,
                    clientName,
                    clientEmail,
                    selectedPhotos,
                    generalNotes,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Could not submit selection.');
            }
            statusEl.textContent = 'Your selections have been saved! Thank you — I will be in touch once your edits are ready.';
            statusEl.className = 'cg-submit-status success';
            statusEl.style.display = 'block';
        } catch (err) {
            statusEl.textContent = err.message || 'Could not submit automatically. Please use "Copy List" and email captureastorm@gmail.com.';
            statusEl.className = 'cg-submit-status error';
            statusEl.style.display = 'block';
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Selection';
        }
    }

    window.initClientGallery = function () {
        const loginForm = document.getElementById('cgLoginForm');
        if (!loginForm) return;

        loginForm.addEventListener('submit', handleUnlock);

        document.getElementById('cg-toggle-pw').addEventListener('click', function () {
            const pw = document.getElementById('cg-password');
            const isPw = pw.type === 'password';
            pw.type = isPw ? 'text' : 'password';
            this.textContent = isPw ? 'Hide' : 'Show';
        });

        document.getElementById('cg-logout-btn').addEventListener('click', lockGallery);

        document.getElementById('cg-filter-all').addEventListener('click', function () {
            currentFilter = 'all';
            this.classList.add('active');
            document.getElementById('cg-filter-selected').classList.remove('active');
            renderGrid();
        });

        document.getElementById('cg-filter-selected').addEventListener('click', function () {
            currentFilter = 'selected';
            this.classList.add('active');
            document.getElementById('cg-filter-all').classList.remove('active');
            renderGrid();
        });

        document.getElementById('cg-open-submit').addEventListener('click', openSubmitModal);
        document.getElementById('cg-submit-close').addEventListener('click', closeSubmitModal);
        document.getElementById('cgSubmitModal').addEventListener('click', function (e) {
            if (e.target === this) closeSubmitModal();
        });
        document.getElementById('cgSubmitForm').addEventListener('submit', handleSubmitSelection);

        document.getElementById('cg-copy-btn').addEventListener('click', async function () {
            if (!activeGallery) return;
            const clientName = document.getElementById('cg-submit-name').value.trim() || activeGallery.clientName || 'Client';
            const clientEmail = document.getElementById('cg-submit-email').value.trim() || 'Not provided';
            const generalNotes = document.getElementById('cg-submit-notes').value.trim();
            const text = buildSelectionSummaryText(clientName, clientEmail, generalNotes);
            try {
                await navigator.clipboard.writeText(text);
                this.textContent = 'Copied!';
                setTimeout(() => { this.textContent = 'Copy List'; }, 2000);
            } catch {
                alert('Could not copy automatically. Please try again.');
            }
        });

        document.getElementById('cg-lb-close').addEventListener('click', closeLightbox);
        document.getElementById('cg-lb-prev').addEventListener('click', () => stepLightbox(-1));
        document.getElementById('cg-lb-next').addEventListener('click', () => stepLightbox(1));
        document.getElementById('cg-lb-select-btn').addEventListener('click', () => {
            if (lightboxIndex >= 0 && visibleImages[lightboxIndex]) {
                toggleSelect(visibleImages[lightboxIndex].name);
            }
        });
        document.getElementById('cgLightbox').addEventListener('click', function (e) {
            if (e.target === this) closeLightbox();
        });

        document.addEventListener('keydown', function (e) {
            const lb = document.getElementById('cgLightbox');
            if (lb && lb.style.display === 'block') {
                if (e.key === 'Escape') closeLightbox();
                if (e.key === 'ArrowLeft') stepLightbox(-1);
                if (e.key === 'ArrowRight') stepLightbox(1);
            }
            const sm = document.getElementById('cgSubmitModal');
            if (sm && sm.style.display === 'block' && e.key === 'Escape') {
                closeSubmitModal();
            }
        });

        const cached = sessionStorage.getItem(SESSION_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.gallery && parsed.token) {
                    openGallery(parsed.gallery, parsed.token);
                }
            } catch {
                sessionStorage.removeItem(SESSION_KEY);
            }
        }
    };
})();
