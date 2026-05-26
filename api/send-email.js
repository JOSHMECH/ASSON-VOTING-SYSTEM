const nodemailer = require('nodemailer');

module.exports = async function(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // Handle Options preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Vercel pre-parses req.body, but fallback to parsing if it is passed as a string
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const { to, subject, html } = body || {};

    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'Missing to, subject, or html parameter' });
    }

    // Resolve 'admin' to the admin's email (check database first)
    let recipient = to;
    if (to === 'admin') {
      try {
        const sbUrl = process.env.SUPABASE_URL || 'https://vkiykdykzgcfylvxlcud.supabase.co';
        const sbKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZraXlrZHlremdjZnlsdnhsY3VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MTIzNjksImV4cCI6MjA5NTI4ODM2OX0.aR6dAGYdf6SX9DvAZeMZNj9G2pFTCMxUIVlokx3PpFM';
        
        const dbRes = await fetch(`${sbUrl}/rest/v1/bank_details?is_active=eq.true&limit=1`, {
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`
          }
        });
        
        if (dbRes.ok) {
          const details = await dbRes.json();
          if (details && details.length > 0 && details[0].admin_email) {
            recipient = details[0].admin_email;
          }
        }
      } catch (err) {
        console.error('Error fetching admin email from database:', err);
      }
      
      if (recipient === 'admin') {
        recipient = process.env.ADMIN_EMAIL || 'joshmech851@gmail.com';
      }
    }

    // Sanitize recipient list (split, trim, filter, join with comma)
    recipient = recipient.split(',').map(e => e.trim()).filter(Boolean).join(', ');

    // 1. Try Resend API if API key is configured
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL || 'ASSON Voting <onboarding@resend.dev>',
          to: recipient,
          subject,
          html
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Resend API returned an error');
      }

      return res.status(200).json({ success: true, message: 'Email sent via Resend API', id: data.id });
    }

    // 2. Try Nodemailer SMTP fallback if configured
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpHost && smtpPort && smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort, 10),
        secure: parseInt(smtpPort, 10) === 465, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      const info = await transporter.sendMail({
        from: process.env.FROM_EMAIL || `"ASSON Voting" <${smtpUser}>`,
        to: recipient,
        subject,
        html
      });

      return res.status(200).json({ success: true, message: 'Email sent via SMTP', messageId: info.messageId });
    }

    // 3. Neither is configured
    return res.status(500).json({ error: 'No email service provider configured. Set RESEND_API_KEY or SMTP_* environment variables.' });

  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: error.message });
  }
};
