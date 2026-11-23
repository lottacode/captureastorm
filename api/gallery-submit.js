import { supabaseRest, verifyGalleryToken } from './_lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { token, clientName, clientEmail, selectedPhotos, generalNotes } = req.body || {};
        const galleryId = verifyGalleryToken(token);
        if (!galleryId) {
            return res.status(401).json({ error: 'Session expired. Please unlock your gallery again.' });
        }

        if (!clientName || !clientEmail || !Array.isArray(selectedPhotos) || !selectedPhotos.length) {
            return res.status(400).json({ error: 'Name, email, and at least one selected photo are required.' });
        }

        const inserted = await supabaseRest('client_selections', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: {
                gallery_id: galleryId,
                client_name: String(clientName).trim(),
                client_email: String(clientEmail).trim(),
                selected_photos: selectedPhotos,
                general_notes: generalNotes ? String(generalNotes).trim() : null,
            },
        });

        // Optional: also email via Web3Forms if WEB3FORMS_KEY is configured in Vercel
        const web3Key = process.env.WEB3FORMS_KEY;
        if (web3Key) {
            const lines = selectedPhotos.map((p, i) =>
                `${i + 1}. ${p.filename}${p.note ? ` — Note: ${p.note}` : ''}`
            );
            const message = [
                `Client: ${clientName} (${clientEmail})`,
                `Total Selected: ${selectedPhotos.length}`,
                '',
                ...lines,
                generalNotes ? `\nGeneral Notes:\n${generalNotes}` : '',
            ].join('\n');

            fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    access_key: web3Key,
                    subject: `New Photo Selections from ${clientName}`,
                    from_name: clientName,
                    email: clientEmail,
                    message,
                }),
            }).catch(err => console.error('Web3Forms notify error:', err));
        }

        return res.status(200).json({
            ok: true,
            submissionId: inserted && inserted[0] ? inserted[0].id : null,
        });
    } catch (err) {
        console.error('gallery-submit error:', err);
        return res.status(500).json({ error: 'Failed to save your selection.' });
    }
}
