(function () {
    const ADMIN_TOKEN_KEY = 'cas_admin_jwt';
    let supabaseConfig = null;
    let adminJwt = null;
    let galleriesCache = [];

    async function getConfig() {
        if (supabaseConfig) return supabaseConfig;
        const res = await fetch('/api/config');
        supabaseConfig = await res.json();
        return supabaseConfig;
    }

    function showLoginError(msg) {
        const el = document.getElementById('admin-login-error');
        if (!el) return;
        el.textContent = msg;
        el.style.display = msg ? 'block' : 'none';
    }

    async function handleAdminLogin(e) {
        e.preventDefault();
        const email = document.getElementById('admin-email').value.trim();
        const password = document.getElementById('admin-password').value;
        const btn = document.getElementById('admin-login-btn');

        showLoginError('');
        btn.disabled = true;
        btn.textContent = 'Signing in...';

        try {
            const cfg = await getConfig();
            const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    apikey: cfg.supabasePublishableKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok || !data.access_token) {
                throw new Error(data.error_description || data.msg || 'Invalid login credentials.');
            }
            adminJwt = data.access_token;
            sessionStorage.setItem(ADMIN_TOKEN_KEY, adminJwt);
            await loadDashboard();
        } catch (err) {
            showLoginError(err.message || 'Sign in failed.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    }

    function adminLogout() {
        adminJwt = null;
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        document.getElementById('admin-dashboard-view').style.display = 'none';
        document.getElementById('admin-login-view').style.display = 'block';
    }

    async function apiAdmin(method, body, query = '') {
        const res = await fetch(`/api/admin${query}`, {
            method,
            headers: {
                Authorization: `Bearer ${adminJwt}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (res.status === 401) {
            adminLogout();
            throw new Error(data.error || 'Session expired. Please sign in again.');
        }
        if (!res.ok) {
            throw new Error(data.error || 'Request failed.');
        }
        return data;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function loadDashboard() {
        const data = await apiAdmin('GET');
        document.getElementById('admin-login-view').style.display = 'none';
        document.getElementById('admin-dashboard-view').style.display = 'block';
        document.getElementById('admin-user-label').textContent = `Signed in as ${data.user.email}`;

        galleriesCache = data.galleries || [];
        renderGallerySelect();
        renderGalleriesList(galleriesCache);
        renderSelectionsList(data.selections || [], galleriesCache);
        renderInquiriesList(data.inquiries || []);
    }

    function renderGallerySelect() {
        const sel = document.getElementById('au-gallery-select');
        if (!galleriesCache.length) {
            sel.innerHTML = '<option value="">Create a gallery first</option>';
            return;
        }
        sel.innerHTML = galleriesCache
            .map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.client_name)} — ${escapeHtml(g.session_title)}</option>`)
            .join('');
    }

    function renderGalleriesList(galleries) {
        const container = document.getElementById('admin-galleries-list');
        if (!galleries.length) {
            container.innerHTML = '<p style="color: #666;">No galleries yet.</p>';
            return;
        }
        container.innerHTML = galleries.map(g => {
            const photosHtml = (g.photos || []).map(p => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 0.9rem;">
                    <span>${escapeHtml(p.filename)}</span>
                    <button type="button" class="cg-filter-btn admin-del-photo-btn" data-photo-id="${escapeHtml(p.id)}" style="padding: 4px 10px; font-size: 0.8rem;">Remove</button>
                </div>
            `).join('');

            return `
                <div class="admin-card" style="flex-direction: column; align-items: stretch;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                        <div>
                            <strong style="color: #2c3e50; font-size: 1.1rem;">${escapeHtml(g.client_name)} — ${escapeHtml(g.session_title)}</strong>
                            <div style="color: #666; font-size: 0.9rem; margin-top: 4px;">
                                ${g.photoCount} photo(s) &bull;
                                Limit: ${g.max_selections ? g.max_selections : 'Unlimited'} &bull;
                                Created: ${new Date(g.created_at).toLocaleDateString()}
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            ${g.photoCount ? `<button type="button" class="cg-filter-btn admin-toggle-photos" data-id="${escapeHtml(g.id)}">Manage Photos</button>` : ''}
                            <button type="button" class="cg-secondary-btn admin-del-btn" data-id="${escapeHtml(g.id)}">Delete Gallery</button>
                        </div>
                    </div>
                    <div class="admin-photos-drawer" id="drawer-${escapeHtml(g.id)}" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e1e8ed;">
                        ${photosHtml}
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.admin-toggle-photos').forEach(btn => {
            btn.addEventListener('click', () => {
                const drawer = document.getElementById(`drawer-${btn.dataset.id}`);
                if (!drawer) return;
                const open = drawer.style.display === 'block';
                drawer.style.display = open ? 'none' : 'block';
                btn.textContent = open ? 'Manage Photos' : 'Hide Photos';
            });
        });

        container.querySelectorAll('.admin-del-photo-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Remove this photo from the gallery?')) return;
                await apiAdmin('DELETE', null, `?photoId=${encodeURIComponent(btn.dataset.photoId)}`);
                await loadDashboard();
            });
        });

        container.querySelectorAll('.admin-del-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this gallery and all its photo records/submissions?')) return;
                await apiAdmin('DELETE', null, `?id=${encodeURIComponent(btn.dataset.id)}`);
                await loadDashboard();
            });
        });
    }

    function renderInquiriesList(inquiries) {
        const container = document.getElementById('admin-inquiries-list');
        if (!container) return;
        if (!inquiries.length) {
            container.innerHTML = '<p style="color: #666;">No contact inquiries yet.</p>';
            return;
        }
        container.innerHTML = inquiries.map(inq => `
            <div class="admin-card" style="flex-direction: column; align-items: stretch;">
                <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 0.5rem;">
                    <div>
                        <strong style="color: #2c3e50; font-size: 1.05rem;">${escapeHtml(inq.name)} (${escapeHtml(inq.email)})</strong>
                        <div style="color: #666; font-size: 0.9rem;">
                            ${inq.phone ? `Phone: ${escapeHtml(inq.phone)} &bull; ` : ''}
                            Session: ${escapeHtml(inq.session_type || 'Any')} &bull;
                            Package: ${escapeHtml(inq.package_type || 'Any')} &bull;
                            ${new Date(inq.created_at).toLocaleString()}
                        </div>
                    </div>
                </div>
                ${inq.message ? `<p style="color: #2c3e50; background: #f8f9fa; padding: 10px 12px; border-radius: 8px; font-size: 0.95rem;">${escapeHtml(inq.message)}</p>` : ''}
            </div>
        `).join('');
    }

    function renderSelectionsList(selections, galleries) {
        const container = document.getElementById('admin-selections-list');
        if (!selections.length) {
            container.innerHTML = '<p style="color: #666;">No client submissions yet.</p>';
            return;
        }
        const byId = Object.fromEntries(galleries.map(g => [g.id, g]));
        container.innerHTML = selections.map(s => {
            const g = byId[s.gallery_id];
            const title = g ? `${g.client_name} (${g.session_title})` : 'Gallery';
            const picks = Array.isArray(s.selected_photos) ? s.selected_photos : [];
            const filenames = picks.map(p => p.filename).join(', ');
            const itemsHtml = picks.map((p, i) => `
                <li><strong>${i + 1}. ${escapeHtml(p.filename)}</strong>${p.note ? ` — <em>${escapeHtml(p.note)}</em>` : ''}</li>
            `).join('');

            return `
                <div class="admin-card" style="flex-direction: column; align-items: stretch;">
                    <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 0.75rem;">
                        <div>
                            <strong style="color: #2c3e50; font-size: 1.1rem;">${escapeHtml(s.client_name)} (${escapeHtml(s.client_email)})</strong>
                            <div style="color: #666; font-size: 0.9rem;">${escapeHtml(title)} &bull; ${new Date(s.submitted_at).toLocaleString()}</div>
                        </div>
                        <button type="button" class="cg-secondary-btn admin-copy-picks" data-picks="${escapeHtml(filenames)}">Copy Filenames</button>
                    </div>
                    <ul style="padding-left: 1.25rem; color: #2c3e50; margin-bottom: 0.5rem;">${itemsHtml}</ul>
                    ${s.general_notes ? `<p style="color: #555; font-size: 0.95rem; background: #f8f9fa; padding: 8px 12px; border-radius: 8px;"><strong>Notes:</strong> ${escapeHtml(s.general_notes)}</p>` : ''}
                </div>
            `;
        }).join('');

        container.querySelectorAll('.admin-copy-picks').forEach(btn => {
            btn.addEventListener('click', async () => {
                await navigator.clipboard.writeText(btn.dataset.picks);
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy Filenames'; }, 2000);
            });
        });
    }

    async function handleCreateGallery(e) {
        e.preventDefault();
        const clientName = document.getElementById('ag-client-name').value.trim();
        const sessionTitle = document.getElementById('ag-session-title').value.trim();
        const password = document.getElementById('ag-password').value.trim();
        const maxSelections = document.getElementById('ag-max').value;
        const instructions = document.getElementById('ag-instructions').value.trim();

        await apiAdmin('POST', {
            action: 'create_gallery',
            clientName,
            sessionTitle,
            password,
            maxSelections: maxSelections ? Number(maxSelections) : null,
            instructions,
        });

        e.target.reset();
        await loadDashboard();
        alert(`Gallery created! Share password "${password}" with ${clientName}.`);
    }

    async function handleUploadPhotos(e) {
        e.preventDefault();
        const galleryId = document.getElementById('au-gallery-select').value;
        const files = Array.from(document.getElementById('au-files').files || []);
        const statusEl = document.getElementById('au-status');
        const btn = document.getElementById('au-upload-btn');

        if (!galleryId || !files.length) return;

        btn.disabled = true;
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                statusEl.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name}...`;

                const { signedUrl, path } = await apiAdmin('POST', {
                    action: 'sign_upload',
                    galleryId,
                    filename: file.name,
                });

                const putRes = await fetch(signedUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': file.type || 'image/jpeg' },
                    body: file,
                });
                if (!putRes.ok) {
                    throw new Error(`Upload failed for ${file.name}`);
                }

                await apiAdmin('POST', {
                    action: 'add_photo',
                    galleryId,
                    filename: file.name,
                    storagePath: path,
                    sortOrder: i + 1,
                });
            }

            statusEl.textContent = `Uploaded ${files.length} photo(s) successfully!`;
            e.target.reset();
            await loadDashboard();
        } catch (err) {
            statusEl.textContent = err.message || 'Upload error.';
        } finally {
            btn.disabled = false;
        }
    }

    window.initAdminPage = function () {
        const loginForm = document.getElementById('adminLoginForm');
        if (!loginForm) return;

        loginForm.addEventListener('submit', handleAdminLogin);
        document.getElementById('admin-logout-btn').addEventListener('click', adminLogout);
        document.getElementById('adminCreateForm').addEventListener('submit', handleCreateGallery);
        document.getElementById('adminUploadForm').addEventListener('submit', handleUploadPhotos);

        const cachedJwt = sessionStorage.getItem(ADMIN_TOKEN_KEY);
        if (cachedJwt) {
            adminJwt = cachedJwt;
            loadDashboard().catch(() => adminLogout());
        }
    };
})();
