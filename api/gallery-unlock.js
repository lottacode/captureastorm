import {
    hashPassword,
    signGalleryToken,
    supabaseRest,
    supabaseRestAll,
} from './_lib/supabase.js';
import { createR2SignedReadUrls } from './_lib/r2.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password } = req.body || {};
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ error: 'Password is required.' });
        }

        const pwHash = hashPassword(password);
        const rows = await supabaseRest(
            `galleries?password_hash=eq.${pwHash}&select=id,client_name,session_title,max_selections,instructions&limit=1`
        );

        if (!rows || !rows.length) {
            return res.status(401).json({ error: 'Incorrect gallery password.' });
        }

        const gallery = rows[0];
        const photos = await supabaseRestAll(
            `gallery_photos?gallery_id=eq.${gallery.id}&order=sort_order.asc,created_at.asc&select=id,filename,storage_path,external_url`
        );

        const storagePaths = (photos || [])
            .map(p => p.storage_path)
            .filter(Boolean);
        const signedMap = await createR2SignedReadUrls(storagePaths, 7200);

        const images = (photos || []).map(p => ({
            id: p.id,
            name: p.filename,
            url: p.storage_path ? signedMap[p.storage_path] : p.external_url,
        })).filter(img => Boolean(img.url));

        const token = signGalleryToken(gallery.id);

        return res.status(200).json({
            token,
            gallery: {
                galleryId: gallery.id,
                clientName: gallery.client_name,
                sessionTitle: gallery.session_title,
                maxSelections: gallery.max_selections,
                instructions: gallery.instructions || 'Select the photos you would like edited and submit your choices when ready.',
                images,
            },
        });
    } catch (err) {
        console.error('gallery-unlock error:', err);
        return res.status(500).json({ error: 'Server error unlocking gallery.' });
    }
}
