import {
    createSignedUploadUrl,
    deleteStorageFile,
    hashPassword,
    supabaseRest,
    verifyAdminUser,
} from './_lib/supabase.js';

export default async function handler(req, res) {
    try {
        const user = await verifyAdminUser(req.headers.authorization);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized. Please sign in as admin.' });
        }

        if (req.method === 'GET') {
            const [galleries, photos, selections, inquiries] = await Promise.all([
                supabaseRest('galleries?order=created_at.desc&select=id,client_name,session_title,max_selections,instructions,created_at'),
                supabaseRest('gallery_photos?order=sort_order.asc,created_at.asc&select=id,gallery_id,filename,storage_path,external_url'),
                supabaseRest('client_selections?order=submitted_at.desc&select=id,gallery_id,client_name,client_email,selected_photos,general_notes,submitted_at'),
                supabaseRest('contact_inquiries?order=created_at.desc&select=id,name,email,phone,session_type,package_type,message,created_at'),
            ]);

            const photosByGallery = {};
            for (const p of photos || []) {
                if (!photosByGallery[p.gallery_id]) photosByGallery[p.gallery_id] = [];
                photosByGallery[p.gallery_id].push(p);
            }

            return res.status(200).json({
                user: { email: user.email },
                galleries: (galleries || []).map(g => ({
                    ...g,
                    photoCount: (photosByGallery[g.id] || []).length,
                    photos: photosByGallery[g.id] || [],
                })),
                selections: selections || [],
                inquiries: inquiries || [],
            });
        }

        if (req.method === 'POST') {
            const body = req.body || {};

            if (body.action === 'create_gallery') {
                const { clientName, sessionTitle, password, maxSelections, instructions } = body;
                if (!clientName || !sessionTitle || !password) {
                    return res.status(400).json({ error: 'Client name, session title, and password are required.' });
                }
                const created = await supabaseRest('galleries', {
                    method: 'POST',
                    headers: { Prefer: 'return=representation' },
                    body: {
                        client_name: String(clientName).trim(),
                        session_title: String(sessionTitle).trim(),
                        password_hash: hashPassword(password),
                        max_selections: maxSelections ? Number(maxSelections) : null,
                        instructions: instructions ? String(instructions).trim() : null,
                    },
                });
                return res.status(201).json({ gallery: created[0] });
            }

            if (body.action === 'sign_upload') {
                const { galleryId, filename } = body;
                if (!galleryId || !filename) {
                    return res.status(400).json({ error: 'galleryId and filename are required.' });
                }
                const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
                const storagePath = `${galleryId}/${Date.now()}_${safeName}`;
                const upload = await createSignedUploadUrl(storagePath);
                return res.status(200).json(upload);
            }

            if (body.action === 'add_photo') {
                const { galleryId, filename, storagePath, externalUrl, sortOrder } = body;
                if (!galleryId || !filename || (!storagePath && !externalUrl)) {
                    return res.status(400).json({ error: 'Missing photo details.' });
                }
                const created = await supabaseRest('gallery_photos', {
                    method: 'POST',
                    headers: { Prefer: 'return=representation' },
                    body: {
                        gallery_id: galleryId,
                        filename,
                        storage_path: storagePath || null,
                        external_url: externalUrl || null,
                        sort_order: typeof sortOrder === 'number' ? sortOrder : 0,
                    },
                });
                return res.status(201).json({ photo: created[0] });
            }

            return res.status(400).json({ error: 'Unknown action.' });
        }

        if (req.method === 'DELETE') {
            const photoId = req.query && req.query.photoId;
            if (photoId) {
                const rows = await supabaseRest(`gallery_photos?id=eq.${encodeURIComponent(photoId)}&select=id,storage_path`);
                if (rows && rows[0] && rows[0].storage_path) {
                    await deleteStorageFile(rows[0].storage_path);
                }
                await supabaseRest(`gallery_photos?id=eq.${encodeURIComponent(photoId)}`, {
                    method: 'DELETE',
                });
                return res.status(200).json({ ok: true });
            }

            const id = req.query && req.query.id;
            if (!id) {
                return res.status(400).json({ error: 'Gallery id or photoId is required.' });
            }
            const photos = await supabaseRest(`gallery_photos?gallery_id=eq.${encodeURIComponent(id)}&select=storage_path`);
            for (const p of photos || []) {
                if (p.storage_path) await deleteStorageFile(p.storage_path);
            }
            await supabaseRest(`galleries?id=eq.${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });
            return res.status(200).json({ ok: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('admin api error:', err);
        return res.status(500).json({ error: err.message || 'Server error.' });
    }
}
