import { supabaseRest } from './_lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { name, email, phone, sessionType, packageType, message } = req.body || {};
        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email are required.' });
        }

        await supabaseRest('contact_inquiries', {
            method: 'POST',
            body: {
                name: String(name).trim(),
                email: String(email).trim(),
                phone: phone ? String(phone).trim() : null,
                session_type: sessionType ? String(sessionType).trim() : null,
                package_type: packageType ? String(packageType).trim() : null,
                message: message ? String(message).trim() : null,
            },
        });

        // Optional email alert via Web3Forms if configured
        const web3Key = process.env.WEB3FORMS_KEY;
        if (web3Key) {
            const text = [
                `Name: ${name}`,
                `Email: ${email}`,
                `Phone: ${phone || 'Not provided'}`,
                `Session Type: ${sessionType || 'Not specified'}`,
                `Package: ${packageType || 'Not specified'}`,
                '',
                `Message:\n${message || '(none)'}`,
            ].join('\n');

            fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    access_key: web3Key,
                    subject: `Photography Inquiry - ${sessionType || 'General'} (${name})`,
                    from_name: name,
                    email,
                    message: text,
                }),
            }).catch(err => console.error('Web3Forms contact notify error:', err));
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('contact error:', err);
        return res.status(500).json({ error: 'Failed to send inquiry. Please try again.' });
    }
}
