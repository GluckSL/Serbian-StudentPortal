/**
 * utils/emailTemplates.js
 *
 * Branded HTML email templates for the Glück Global portal.
 * All templates are consistent with the existing credential email style.
 */

/**
 * OTP email for self-service password reset.
 * @param {object} params
 * @param {string} params.name          - Recipient's full name
 * @param {string} params.otp           - 6-digit OTP string
 * @param {number} params.expiresMinutes - OTP validity window in minutes
 */
function buildPasswordResetOtpEmail({ name, otp, expiresMinutes = 15 }) {
  return {
    subject: 'Vaš kod za resetovanje lozinke - Glück Global',
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resetovanje lozinke</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global
              </h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                Vaš partner za učenje nemačkog
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Zdravo <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.6;">
                Primili smo zahtev za resetovanje lozinke za vaš Glück Global nalog.
                Koristite jednokratni kod ispod da nastavite. Važi
                <strong>${expiresMinutes} minuta</strong>.
              </p>

              <!-- OTP Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:8px 0 32px;">
                    <div style="display:inline-block;background:#f0ebff;border:2px solid #8b5cf6;
                                border-radius:12px;padding:20px 40px;">
                      <p style="margin:0 0 6px;color:#6c3fc5;font-size:12px;
                                 font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                        Vaš kod za resetovanje
                      </p>
                      <p style="margin:0;color:#1a1a2e;font-size:36px;
                                 font-weight:800;letter-spacing:8px;font-family:'Courier New',monospace;">
                        ${escapeHtml(otp)}
                      </p>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.6;">
                Unesite ovaj kod na stranici za resetovanje lozinke zajedno sa novom lozinkom.
              </p>

              <!-- Security warning -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background:#fff8f0;border-left:4px solid #f59e0b;
                              border-radius:4px;padding:14px 18px;margin-bottom:24px;">
                    <p style="margin:0;color:#92400e;font-size:13px;line-height:1.5;">
                      <strong>Niste tražili ovo?</strong> Slobodno ignorišite ovaj e-mail.
                      Vaša lozinka neće biti promenjena ukoliko ne završite proces resetovanja.
                      Nikada ne delite ovaj kod ni sa kim.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                Glück Global Pvt Ltd &nbsp;·&nbsp;
                <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#8b5cf6;text-decoration:none;">
                  ${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}
                </a>
                <br />
                Ovo je automatska poruka. Molimo vas da ne odgovarate na ovaj e-mail.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const { formatSubscriptionLabel } = require('./studentSubscriptionPlans');

/** OTP sent to current email when student requests an email change during setup. */
function buildEmailChangeOtpEmail({ name, otp, newEmail, expiresMinutes = 15 }) {
  return {
    subject: 'Potvrdite promenu e-mail adrese - Glück Global',
    html: `
<div style="font-family:Arial,sans-serif;color:#000;line-height:1.6;max-width:560px;margin:0 auto;">
  <p>Zdravo <strong>${escapeHtml(name)}</strong>,</p>
  <p>Zatražili ste promenu e-mail adrese portala na <strong>${escapeHtml(newEmail)}</strong>.</p>
  <p>Vaš verifikacioni kod je:</p>
  <p style="font-size:32px;font-weight:800;letter-spacing:8px;color:#6c3fc5;font-family:monospace;">${escapeHtml(otp)}</p>
  <p>Ovaj kod ističe za <strong>${expiresMinutes} minuta</strong>. Ako niste tražili ovo, ignorišite ovaj e-mail.</p>
  <p>S poštovanjem,<br><strong>Glück Global Pvt Ltd</strong></p>
</div>`.trim(),
  };
}

/** Credentials email after student completes first-login password setup. */
function buildPortalCredentialsEmail({ name, regNo, email, password, isOneTimeNote = false }) {
  const oneTimeNote = isOneTimeNote
    ? '<p style="color:#92400e;background:#fff8f0;padding:12px;border-left:4px solid #f59e0b;"><strong>Napomena:</strong> Vaša početna lozinka je bila jednokratna. Koristite lozinku ispod koju ste postavili tokom podešavanja.</p>'
    : '';
  return {
    subject: 'Vaši podaci za prijavu na Glück Global portal',
    html: `
<div style="font-family:Arial,sans-serif;color:#000;line-height:1.6;max-width:560px;margin:0 auto;">
  <p>Zdravo <strong>${escapeHtml(name)}</strong>,</p>
  <p>Vaš nalog na <strong>Glück Global Studentski portal</strong> je spreman. Evo vaših podataka za prijavu:</p>
  ${oneTimeNote}
  <ul>
    <li><strong>Web App ID:</strong> ${escapeHtml(regNo)}</li>
    <li><strong>E-mail:</strong> ${escapeHtml(email)}</li>
    <li><strong>Lozinka:</strong> ${escapeHtml(password)}</li>
  </ul>
  <p>Možete se prijaviti svojom <strong>e-mail adresom</strong> ili <strong>Web App ID</strong> i lozinkom iznad.</p>
  <p>Portal: <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}">${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}</a></p>
  <p>Molimo vas da čuvate ove podatke i ne delite ih ni sa kim.</p>
  <p>S poštovanjem,<br><strong>Glück Global Pvt Ltd</strong></p>
</div>`.trim(),
  };
}

/** Welcome email for new students — one-time password; must change on first login. */
function buildWelcomeOneTimePasswordEmail({ name, regNo, email, password }) {
  return {
    subject: 'Dobrodošli u Glück Global Studentski portal',
    html: `
<div style="font-family:Arial,sans-serif;color:#000;line-height:1.6;max-width:560px;margin:0 auto;">
  <p>Zdravo <strong>${escapeHtml(name)}</strong>,</p>
  <p>Dobrodošli u <strong>Glück Global Studentski portal</strong>. Vaš nalog je kreiran.</p>
  <ul>
    <li><strong>Web App ID:</strong> ${escapeHtml(regNo)}</li>
    <li><strong>E-mail:</strong> ${escapeHtml(email)}</li>
    <li><strong>Jednokratna lozinka:</strong> ${escapeHtml(password)}</li>
  </ul>
  <p style="color:#92400e;background:#fff8f0;padding:12px;border-left:4px solid #f59e0b;">
    <strong>Važno:</strong> Lozinka iznad je samo za <strong>prvu prijavu</strong>.
    Bićete zamoljeni da postavite sopstvenu trajnu lozinku pre nego što možete koristiti portal.
  </p>
  <p>Portal: <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}">${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}</a></p>
  <p>S poštovanjem,<br><strong>Glück Global Pvt Ltd</strong></p>
</div>`.trim(),
  };
}

// ─── Shared HTML header / footer helpers ─────────────────────────────────────

function emailHeader(title = '') {
  return `<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0"
           style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <tr>
        <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Glück Global</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Vaš partner za učenje nemačkog</p>
        </td>
      </tr>
      <tr><td style="padding:32px 40px;">`;
}

function emailFooter() {
  return `
      </td></tr>
      <tr>
        <td style="background:#f8fafc;padding:16px 40px;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">© Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Signup: invite link (admin sends to prospective student) ────────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.signupUrl  - full URL including token
 */
function buildSignupLinkEmail({ name, signupUrl }) {
  return {
    subject: 'Vaš link za registraciju - Glück Global',
    html: emailHeader('Link za registraciju') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">Zdravo <strong>${escapeHtml(name || 'tu')}</strong>,</p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Pozvani ste da se pridružite <strong>Glück Global Studentskom portalu</strong>.
        Kliknite dugme ispod da završite registraciju u nekoliko koraka.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 28px;">
          <a href="${signupUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Završi registraciju →
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Ili kopirajte ovaj link u vaš pregledač:</p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:12px;color:#6c3fc5;">${escapeHtml(signupUrl)}</p>
      <p style="margin:0;color:#9ca3af;font-size:12px;">Ovaj link ističe za 30 dana. Ako niste tražili ovo, slobodno ignorišite ovaj e-mail.</p>
    ` + emailFooter(),
  };
}

/**
 * Admin invite email — links to the public /register wizard.
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.registerUrl
 */
function buildRegisterInviteEmail({ name, registerUrl }) {
  return {
    subject: 'Pozvani ste da se registrujete za Glück Global',
    html: emailHeader('Pozivnica za registraciju') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">Zdravo <strong>${escapeHtml(name || 'tu')}</strong>,</p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Pozvani ste da se registrujete za <strong>Glück Global</strong>.
        Kliknite dugme ispod da se upišete i završite registraciju na našem studentskom portalu.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 28px;">
          <a href="${registerUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Upiši se
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Ili kopirajte ovaj link u vaš pregledač:</p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:12px;color:#6c3fc5;">${escapeHtml(registerUrl)}</p>
      <p style="margin:0;color:#9ca3af;font-size:12px;">Ako niste očekivali ovu pozivnicu, slobodno ignorišite ovaj e-mail.</p>
    ` + emailFooter(),
  };
}

// ─── Signup: email OTP verification ──────────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.otp
 * @param {number} params.expiresMinutes
 */
function buildSignupEmailOtpEmail({ name, otp, expiresMinutes = 10 }) {
  return {
    subject: 'Verifikujte vaš e-mail — Glück Global',
    html: emailHeader('Verifikacija e-maila') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">Zdravo <strong>${escapeHtml(name || 'tu')}</strong>,</p>
      <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.6;">
        Koristite jednokratni kod ispod da verifikujete vašu e-mail adresu tokom registracije.
        Važi <strong>${expiresMinutes} minuta</strong>.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 28px;">
          <div style="display:inline-block;background:#f3f0ff;border:2px dashed #8b5cf6;border-radius:10px;padding:18px 40px;font-size:36px;font-weight:900;letter-spacing:12px;color:#6c3fc5;font-family:monospace;">
            ${escapeHtml(otp)}
          </div>
        </td></tr>
      </table>
      <p style="margin:0;color:#9ca3af;font-size:12px;">Ne delite ovaj kod. Ako ga niste tražili, slobodno ignorišite ovaj e-mail.</p>
    ` + emailFooter(),
  };
}

// ─── Signup: admin notification when proof is uploaded ───────────────────────

function proofDetailRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;width:160px;font-weight:600;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#1e293b;font-size:13px;">${escapeHtml(String(value))}</td>
        </tr>`;
}

/**
 * @param {object} params
 * @param {string} params.studentName
 * @param {string} params.studentEmail
 * @param {string} [params.regNo]
 * @param {string} [params.phoneNumber]
 * @param {string} [params.whatsappNumber]
 * @param {string} [params.nationality]
 * @param {string} [params.address]
 * @param {string} [params.learnFromLanguage]
 * @param {string} params.level
 * @param {string} params.subscription
 * @param {number} params.amount
 * @param {string} params.currency
 * @param {string} [params.paymentMethod]
 * @param {string} [params.proofFileName]
 * @param {string} [params.proofNote]
 * @param {string} params.adminUrl  - direct link to Req Payment pending approvals
 */
function buildSignupProofReceivedAdminEmail({
  studentName,
  studentEmail,
  regNo,
  phoneNumber,
  whatsappNumber,
  nationality,
  address,
  learnFromLanguage,
  level,
  subscription,
  amount,
  currency,
  paymentMethod,
  proofFileName,
  proofNote,
  adminUrl,
}) {
  const amountStr =
    amount != null && Number.isFinite(Number(amount))
      ? `${currency || ''} ${Number(amount).toLocaleString('en-IN')}`.trim()
      : '';

  const detailRows = [
    proofDetailRow('Ime studenta', studentName),
    proofDetailRow('E-mail', studentEmail),
    proofDetailRow('Web App ID', regNo),
    proofDetailRow('Telefon', phoneNumber),
    proofDetailRow('WhatsApp', whatsappNumber),
    proofDetailRow('Nacionalnost', nationality),
    proofDetailRow('Adresa', address),
    proofDetailRow('Jezik učenja', learnFromLanguage),
    proofDetailRow('Nivo nemačkog', level),
    proofDetailRow('Plan', formatSubscriptionLabel(subscription)),
    proofDetailRow('Iznos', amountStr),
    proofDetailRow('Način plaćanja', paymentMethod || 'Bankarski transfer (ručni dokaz)'),
    proofDetailRow('Fajl dokaza', proofFileName),
  ].join('');

  return {
    subject: `Novi dokaz o uplati za registraciju — ${escapeHtml(studentName)}`,
    html: emailHeader('Novi dokaz o uplati za registraciju') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Student je dostavio <strong>ručni dokaz o uplati</strong> tokom samostalne registracije. Pregledajte priloženi snimak ekrana i odobrite u admin panelu.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:10px;">
        ${detailRows}
      </table>
      ${proofNote ? `<p style="margin:0 0 20px;color:#64748b;font-size:13px;">${escapeHtml(proofNote)}</p>` : ''}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:4px 0 24px;">
          <a href="${adminUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 30px;border-radius:8px;">
            Pregledaj u admin panelu →
          </a>
        </td></tr>
      </table>
    ` + emailFooter(),
  };
}

// ─── Job portal: new application (operations inbox) ─────────────────────────

/**
 * @param {object} params
 * @param {string} params.studentName
 * @param {string} params.studentEmail
 * @param {string} [params.studentRegNo]
 * @param {string} [params.studentBatch]
 * @param {string} [params.phone]
 * @param {string} [params.linkedIn]
 * @param {string} [params.coverLetter]
 * @param {string} [params.resumeFileName]
 * @param {string} params.companyName
 * @param {string} params.jobTitle
 * @param {string} [params.jobType]
 * @param {string} [params.location]
 * @param {string} [params.locationType]
 * @param {string} [params.salary]
 * @param {string} params.appliedAt
 * @param {string} params.adminUrl
 * @param {string} [params.resumeNote]
 */
function buildJobApplicationReceivedAdminEmail({
  studentName,
  studentEmail,
  studentRegNo,
  studentBatch,
  phone,
  linkedIn,
  coverLetter,
  resumeFileName,
  companyName,
  jobTitle,
  jobType,
  location,
  locationType,
  salary,
  appliedAt,
  adminUrl,
  resumeNote,
}) {
  const locationStr = [locationType, location].filter(Boolean).join(' · ');
  const coverRaw = String(coverLetter || '').trim();
  const coverShort =
    coverRaw.length > 2000 ? `${coverRaw.slice(0, 2000)}…` : coverRaw;
  const coverHtml = coverShort
    ? escapeHtml(coverShort).replace(/\n/g, '<br/>')
    : '';

  const detailRows = [
    proofDetailRow('Student', studentName),
    proofDetailRow('E-mail', studentEmail),
    proofDetailRow('Web App ID', studentRegNo),
    proofDetailRow('Grupa', studentBatch),
    proofDetailRow('Telefon', phone),
    proofDetailRow('LinkedIn', linkedIn),
    proofDetailRow('Kompanija', companyName),
    proofDetailRow('Naziv pozicije', jobTitle),
    proofDetailRow('Vrsta posla', jobType),
    proofDetailRow('Lokacija', locationStr),
    proofDetailRow('Plata', salary),
    proofDetailRow('Fajl CV-a', resumeFileName),
    proofDetailRow('Datum prijave', appliedAt),
  ].join('');

  return {
    subject: `Nova prijava za posao — ${escapeHtml(studentName)} · ${escapeHtml(jobTitle || 'Pozicija')}`,
    html:
      emailHeader('Nova prijava za posao') +
      `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Student je podneo prijavu za <strong>${escapeHtml(jobTitle || 'poziciju')}</strong>
        u kompaniji <strong>${escapeHtml(companyName || '—')}</strong>. Pregledajte detalje ispod.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:10px;">
        ${detailRows}
      </table>
      ${
        coverHtml
          ? `<p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:700;">Propratno pismo</p>
      <div style="margin:0 0 20px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#1e293b;font-size:14px;line-height:1.6;">${coverHtml}</div>`
          : ''
      }
      ${resumeNote ? `<p style="margin:0 0 20px;color:#64748b;font-size:13px;">${escapeHtml(resumeNote)}</p>` : ''}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:4px 0 24px;">
          <a href="${adminUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 30px;border-radius:8px;">
            Pogledaj prijave u adminu →
          </a>
        </td></tr>
      </table>
    ` +
      emailFooter(),
  };
}

// ─── Signup: rejection email (bank-transfer proof not approved) ─────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {number} [params.amount]
 * @param {string} [params.currency]
 * @param {string} [params.rejectionReason]
 * @param {string} params.signupUrl — link to resume signup and re-upload proof
 */
function buildSignupRejectedEmail({ name, email, amount, currency, rejectionReason, signupUrl }) {
  signupUrl = signupUrl || `${process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.serbia.gluckglobal.com'}/signup/apply`;
  const curr = String(currency || 'INR').toUpperCase();
  const amt = Number(amount);
  const amountLine =
    Number.isFinite(amt) && amt > 0
      ? `<tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Navedeni iznos</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;border-top:1px solid #e2e8f0;">${escapeHtml(curr)} ${amt.toLocaleString('en-IN')}</td>
        </tr>`
      : '';
  const reasonBlock = rejectionReason?.trim()
    ? `<div style="background:#fff5f5;border-left:4px solid #dc2626;border-radius:8px;padding:14px 18px;margin:0 0 20px;">
        <p style="margin:0 0 6px;font-weight:700;color:#991b1b;font-size:14px;">Razlog od našeg finansijskog tima</p>
        <p style="margin:0;color:#444;font-size:15px;line-height:1.55;">${escapeHtml(rejectionReason.trim())}</p>
      </div>`
    : `<p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Molimo pregledajte podatke o uplati i pošaljite ispravljen snimak ekrana koristeći link ispod.
      </p>`;

  return {
    subject: 'Ažuriranje uplate za registraciju — Glück Global',
    html: emailHeader('Uplata nije odobrena') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Zdravo <strong>${escapeHtml(name)}</strong>,
      </p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Hvala vam što ste se registrovali u Glück Global. Nakon pregleda vašeg dokaza o uplati, nismo mogli da odobrimo vašu registraciju u ovom trenutku.
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;width:140px;">E-mail</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;">${escapeHtml(email)}</td>
        </tr>
        ${amountLine}
      </table>
      ${reasonBlock}
      <p style="margin:0 0 8px;color:#444;font-size:14px;">Možete se vratiti na stranicu za registraciju, ispraviti podatke o uplati i poslati novi dokaz:</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:12px 0 28px;">
          <a href="${signupUrl}" style="display:inline-block;background:linear-gradient(135deg,#b91c1c,#dc2626);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Ponovo pošalji dokaz o uplati →
          </a>
        </td></tr>
      </table>
      <p style="margin:0;color:#9ca3af;font-size:12px;">Ako smatrate da je ovo greška, kontaktirajte nas na info@gluckglobal.com.</p>
    ` + emailFooter(),
  };
}

// ─── Signup: welcome email after approval ────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.regNo
 * @param {string} params.email
 * @param {string} params.password  - the password the student chose
 * @param {string} params.loginUrl
 */
function buildSignupApprovedWelcomeEmail({ name, regNo, email, password, loginUrl }) {
  loginUrl = loginUrl || `${process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.serbia.gluckglobal.com'}/login`;
  return {
    subject: 'Dobrodošli u Glück Global — Vaš nalog je spreman!',
    html: emailHeader('Nalog odobren') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Zdravo <strong>${escapeHtml(name)}</strong>,
      </p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Vaša registracija i uplata su <strong style="color:#16a34a;">odobreni</strong>!
        Vaši dokumenti i podaci su pregledani. Dobrodošli u Glück Global Studentski portal — evo vaših podataka za prijavu:
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;width:140px;">Web App ID</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;font-weight:700;">${escapeHtml(regNo)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">E-mail</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;border-top:1px solid #e2e8f0;">${escapeHtml(email)}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Lozinka</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;border-top:1px solid #e2e8f0;">${escapeHtml(password)}</td>
        </tr>
      </table>
      <p style="margin:0 0 8px;color:#444;font-size:14px;">Možete se prijaviti svojom <strong>e-mail adresom</strong> ili <strong>Web App ID</strong> i lozinkom iznad.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:12px 0 28px;">
          <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Prijava na portal →
          </a>
        </td></tr>
      </table>
      <p style="margin:0;color:#9ca3af;font-size:12px;">Molimo čuvajte vaše podatke. Ako imate pitanja, kontaktirajte naš tim za podršku.</p>
    ` + emailFooter(),
  };
}

/**
 * Reminder for incomplete journey-day tasks (language tracking admin).
 * @param {number} [currentCourseDay] — student's actual journey day when reminding about an earlier day
 */
function buildJourneyDayReminderEmail({
  name,
  day,
  currentCourseDay,
  incompleteTasks,
  doneTasks,
  totalTasks,
  loginUrl,
}) {
  const tasks = Array.isArray(incompleteTasks) ? incompleteTasks : [];
  const reminderDay = Number(day);
  const studentDay = Number(currentCourseDay);
  const isPastDayReminder =
    Number.isFinite(reminderDay) &&
    Number.isFinite(studentDay) &&
    studentDay > reminderDay;

  const listHtml = tasks
    .map((t, i) => {
      const title = escapeHtml(t.title || 'Zadatak');
      return `
        <tr>
          <td style="padding:10px 16px;border-top:1px solid #e2e8f0;vertical-align:top;width:28px;color:#6c3fc5;font-weight:700;">${i + 1}.</td>
          <td style="padding:10px 16px;border-top:1px solid #e2e8f0;color:#1e293b;font-size:15px;font-weight:600;">${title}</td>
        </tr>`;
    })
    .join('');

  const progressNote =
    Number.isFinite(totalTasks) && totalTasks > 0
      ? `<p style="margin:0 0 20px;color:#64748b;font-size:14px;">Završili ste <strong>${doneTasks}</strong> od <strong>${totalTasks}</strong> zadataka za Dan ${reminderDay}.</p>`
      : '';

  const introParagraph = isPastDayReminder
    ? `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">
        Nalazite se na <strong>Danu ${studentDay}</strong> kursa, ali još niste završili zadatke za <strong>Dan ${reminderDay}</strong>. Molimo završite sledeće stavke:
      </p>`
    : `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">
        Nalazite se na <strong>Danu ${reminderDay}</strong> kursa. Sledeće stavke su još uvek nedovršene i zahtevaju vašu pažnju:
      </p>`;

  const subject = isPastDayReminder
    ? `Podsetnik: Završite zadatke za Dan ${reminderDay} (nalazite se na Danu ${studentDay})`
    : `Podsetnik: Završite zadatke za Dan ${reminderDay} pre večeras`;

  return {
    subject,
    html:
      emailHeader('Podsetnik o napretku') +
      `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Zdravo <strong>${escapeHtml(name)}</strong>,
      </p>
      ${introParagraph}
      ${progressNote}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="margin:0 0 24px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        ${listHtml}
      </table>
      <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">
        Molimo završite vežbe i module navedene iznad <strong>pre večeras</strong> kako biste ostali na pravom putu sa vašom grupom.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 20px;">
          <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Otvori studentski portal →
          </a>
        </td></tr>
      </table>
      <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
        Ako ste već završili ove zadatke, slobodno ignorišite ovaj e-mail. Za pomoć, odgovorite na ovu poruku ili kontaktirajte vašeg koordinatora.
      </p>
    ` +
      emailFooter(),
  };
}

/**
 * Reminder for incomplete journey-week tasks (language tracking admin).
 * @param {Array<{ day: number, incompleteTasks: object[] }>} daysWithTasks
 */
function buildJourneyWeekReminderEmail({
  name,
  week,
  weekStartDay,
  weekEndDay,
  currentCourseDay,
  daysWithTasks,
  totalIncomplete,
  loginUrl,
}) {
  const days = Array.isArray(daysWithTasks) ? daysWithTasks : [];
  const weekNum = Number(week);
  const studentDay = Number(currentCourseDay);

  const daysHtml = days
    .map((d) => {
      const tasks = Array.isArray(d.incompleteTasks) ? d.incompleteTasks : [];
      const taskRows = tasks
        .map(
          (t, i) => `
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #e2e8f0;vertical-align:top;width:24px;color:#6c3fc5;font-weight:700;">${i + 1}.</td>
          <td style="padding:8px 12px;border-top:1px solid #e2e8f0;color:#1e293b;font-size:14px;font-weight:600;">${escapeHtml(t.title || 'Zadatak')}</td>
        </tr>`,
        )
        .join('');
      return `
      <tr>
        <td colspan="2" style="padding:14px 16px 6px;background:#f8fafc;color:#475569;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">
          Dan ${d.day}
        </td>
      </tr>
      ${taskRows}`;
    })
    .join('');

  const rangeLabel =
    Number.isFinite(weekStartDay) && Number.isFinite(weekEndDay)
      ? `Dani ${weekStartDay}–${weekEndDay}`
      : `Nedelja ${weekNum}`;

  return {
    subject: `Podsetnik: Završite zadatke iz Nedelje ${weekNum} (${totalIncomplete} preostalo)`,
    html:
      emailHeader('Nedeljni podsetnik o napretku') +
      `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Zdravo <strong>${escapeHtml(name)}</strong>,
      </p>
      <p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">
        Nalazite se na <strong>Danu ${studentDay}</strong> kursa. Još uvek imate
        <strong>${totalIncomplete}</strong> nedovršen${totalIncomplete === 1 ? '' : 'ih'} zadatak${totalIncomplete === 1 ? '' : 'a'} iz
        <strong>Nedelje ${weekNum}</strong> (${rangeLabel}) koji zahtevaju vašu pažnju:
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="margin:0 0 24px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        ${daysHtml}
      </table>
      <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">
        Molimo završite vežbe i module navedene iznad kako biste ostali na pravom putu sa vašom grupom.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 20px;">
          <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Otvori studentski portal →
          </a>
        </td></tr>
      </table>
      <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
        Ako ste već završili ove zadatke, slobodno ignorišite ovaj e-mail. Za pomoć, odgovorite na ovu poruku ili kontaktirajte vašeg koordinatora.
      </p>
    ` +
      emailFooter(),
  };
}

/**
 * Admin-initiated password reset: student must log in and complete OTP + new password.
 */
function buildForcePasswordResetEmail({ name, regNo, otp, loginUrl, expiresMinutes = 15 }) {
  return {
    subject: 'Potrebna akcija: postavite novu lozinku za Glück Global portal',
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0"
             style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Studentski portal</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
              Zdravo <strong>${escapeHtml(name)}</strong>,
            </p>
            <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6;">
              Vaš administrator je zatražio ažuriranje lozinke. Vaša trenutna sesija je odjavljena.
              Molimo prijavite se na portal koristeći vaš <strong>App ID</strong> i vašu <strong>trenutnu lozinku</strong>,
              zatim unesite verifikacioni kod ispod i izaberite novu lozinku.
            </p>
            <p style="margin:0 0 8px;color:#444;font-size:14px;"><strong>App ID:</strong> ${escapeHtml(regNo)}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td align="center" style="padding:16px 0 24px;">
                <div style="display:inline-block;background:#f0ebff;border:2px solid #8b5cf6;border-radius:12px;padding:18px 36px;">
                  <p style="margin:0 0 6px;color:#6c3fc5;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Verifikacioni kod</p>
                  <p style="margin:0;color:#1a1a2e;font-size:32px;font-weight:800;letter-spacing:6px;font-family:'Courier New',monospace;">${escapeHtml(otp)}</p>
                </div>
              </td></tr>
            </table>
            <p style="margin:0 0 20px;color:#64748b;font-size:13px;">Ovaj kod ističe za <strong>${expiresMinutes} minuta</strong>.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td align="center" style="padding:4px 0 20px;">
                <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
                  Idi na prijavu →
                </a>
              </td></tr>
            </table>
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">
              Ako niste očekivali ovaj e-mail, kontaktirajte vašeg koordinatora. Ne delite ovaj kod ni sa kim.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Motivational re-engagement email for students who haven't logged in for 3+ days.
 * @param {object} params
 * @param {string} params.name      - Student's full name
 * @param {number} params.daysSince - Number of days since last login
 * @param {string} params.loginUrl  - Portal login URL
 */
function buildPortalAbsenceReminderEmail({ name, daysSince, loginUrl, reminderNumber = 1 }) {
  const messages = [
    {
      headline: 'Jedan korak vas deli od sna! 🌟',
      body: `Tečnost nemačkog ne dolazi čekanjem — dolazi dolaskom, dan za danom. Radili ste odlično, i ne želimo da izgubite taj zamah. Prijavite se danas i nastavite tamo gde ste stali!`,
    },
    {
      headline: 'Nedostajete nam na času! 💙',
      body: `Vaše nemačko putovanje čeka na vas. Svaki čas koji pohađate vas vodi bliže životu za koji radite. Čak i 15 minuta danas može napraviti ogromnu razliku — vratite se i nastavite!`,
    },
    {
      headline: 'Ne dozvolite da vaš trud izblijedi! 🔥',
      body: `Već ste uložili toliko truda u učenje nemačkog. Propuštanje nekoliko dana je sasvim normalno — ali ključ je brzo vraćanje na pravi put. Prijavite se sada i nastavimo zajedno graditi ka vašem cilju.`,
    },
    {
      headline: 'Vaš nemački san je još uvek na dohvat ruke! 🎯',
      body: `Svaki odličan učenik jezika prolazi kroz trenutke pauze — ali oni koji uspevaju su oni koji se odluče da se vrate. Verujemo u vas. Prijavite se danas, makar i za kratku sesiju, i osetite kako napredak ponovo plamti!`,
    },
  ];

  const pick = messages[(Math.max(1, reminderNumber) - 1) % messages.length];

  return {
    subject: `Nedostajete nam, ${name}! Vratite se na vaše nemačko putovanje 💙`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nedostajete nam!</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global
              </h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                Vaš partner za učenje nemačkog
              </p>
            </td>
          </tr>

          <!-- Illustration row -->
          <tr>
            <td style="background:linear-gradient(135deg,#f3eeff 0%,#ede9fe 100%);padding:28px 40px;text-align:center;">
              <p style="margin:0;font-size:48px;line-height:1;">✈️</p>
              <p style="margin:8px 0 0;color:#6c3fc5;font-size:18px;font-weight:700;">
                ${escapeHtml(pick.headline)}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Zdravo <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.7;">
                ${escapeHtml(pick.body)}
              </p>

              <!-- Absence info pill -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;padding:8px 20px;border-radius:20px;border:1px solid #fcd34d;">
                      Niste posetili portal <strong>${daysSince} dan${daysSince !== 1 ? 'a' : ''}</strong>
                    </span>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <a href="${escapeHtml(loginUrl)}"
                       style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 44px;border-radius:10px;letter-spacing:0.3px;">
                      Prijavite se i nastavite učenje →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.6;text-align:center;">
                Vaš tim u Glück Global navija za vas na svakom koraku. 🙌
              </p>
            </td>
          </tr>

          ${emailFooter()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Nightly digest email for the Language Team listing every student with
 * 2+ consecutive class absences.
 *
 * @param {object}   params
 * @param {Array}    params.absentStudents  - Array of student absence records
 * @param {string}   params.absentStudents[].name
 * @param {string}   params.absentStudents[].email
 * @param {string}   params.absentStudents[].batch
 * @param {number}   params.absentStudents[].streak          - consecutive absences count
 * @param {string}   [params.absentStudents[].lastAttended]  - ISO date string of last attended class, or null
 * @param {string}   [params.absentStudents[].assignedTeacher] - teacher's name
 * @param {string}   params.reportDate  - human-readable date string shown in the email header
 */
function buildConsecutiveAbsenceLanguageTeamEmail({ absentStudents = [], reportDate }) {
  const dateLabel = escapeHtml(reportDate || new Date().toDateString());

  const tableRows = absentStudents
    .map((s, idx) => {
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8f5ff';
      const streakColor = s.streak >= 5 ? '#dc2626' : s.streak >= 3 ? '#d97706' : '#6c3fc5';
      const lastAttendedLabel = s.lastAttended
        ? escapeHtml(new Date(s.lastAttended).toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: 'short', year: 'numeric' }))
        : '<span style="color:#9ca3af;font-style:italic;">Nije zabeleženo</span>';
      return `
      <tr style="background:${rowBg};">
        <td style="padding:11px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #ede9fe;">${escapeHtml(s.name)}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;">${escapeHtml(s.email || '—')}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#ede9fe;color:#6c3fc5;font-weight:700;font-size:12px;padding:3px 10px;border-radius:20px;">
            ${escapeHtml(String(s.batch || '—'))}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#fff1f2;color:${streakColor};font-weight:800;font-size:13px;padding:3px 12px;border-radius:20px;border:1px solid ${streakColor}33;">
            ${s.streak} čas${s.streak !== 1 ? 'ova' : ''}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;">${lastAttendedLabel}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;">${escapeHtml(s.assignedTeacher || '—')}</td>
      </tr>`;
    })
    .join('');

  const totalCount = absentStudents.length;
  const highRisk = absentStudents.filter((s) => s.streak >= 4).length;

  return {
    subject: `[Potrebna akcija] ${totalCount} Student${totalCount !== 1 ? 'a' : ''} sa 2+ uzastopnih odsustva — ${dateLabel}`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Izveštaj o uzastopnim odsustvima</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global — Jezički tim
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.88);font-size:14px;">
                Izveštaj o uzastopnim odsustvima &nbsp;·&nbsp; ${dateLabel}
              </p>
            </td>
          </tr>

          <!-- Summary pills -->
          <tr>
            <td style="background:#f3eeff;padding:20px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <span style="display:inline-block;background:#6c3fc5;color:#fff;font-size:13px;font-weight:700;padding:8px 22px;border-radius:20px;margin:0 6px;">
                      ${totalCount} student${totalCount !== 1 ? 'a' : ''} označeno
                    </span>
                    ${
                      highRisk > 0
                        ? `<span style="display:inline-block;background:#dc2626;color:#fff;font-size:13px;font-weight:700;padding:8px 22px;border-radius:20px;margin:0 6px;">
                        ${highRisk} visoki rizik (4+ odsustva)
                      </span>`
                        : ''
                    }
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0 0;text-align:center;">
                    <p style="margin:0;color:#6c3fc5;font-size:13px;line-height:1.5;">
                      Sledeći studenti su bili odsutni sa <strong>2 ili više uzastopnih</strong> živih časova.<br/>
                      Molimo pratite ih što pre.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:28px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <!-- Table header -->
                <thead>
                  <tr style="background:#6c3fc5;">
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Ime studenta</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">E-mail</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Grupa</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Uzastopna odsustva</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Poslednji pohađan</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Dodeljeni nastavnik</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `
                  <tr>
                    <td colspan="6" style="padding:24px;text-align:center;color:#9ca3af;font-size:14px;">
                      Nema studenata sa uzastopnim odsustvima danas. 🎉
                    </td>
                  </tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer note -->
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">
                Ovaj izveštaj se automatski generiše svake noći u ponoć (IST) od strane Glück Global studentskog portala.<br/>
                Studenti su uključeni ako su propustili poslednja 2 ili više uzastopnih živih časova.
              </p>
            </td>
          </tr>

          <!-- Brand footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">© Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Morning digest for Language Team — students who missed 2+ live classes in the last 10 days.
 * @param {object} params
 * @param {Array<{ name: string, batch: string, missedCount: number, missedDates: Date[] }>} params.flaggedStudents
 * @param {Array<{ name: string, batch: string, batchClassDays: number }>} [params.unscheduledStudents]
 *        Active students whose batch held classes but who were on none of the rosters.
 * @param {string} params.reportDate
 * @param {number} [params.lookbackDays=10]
 */
function buildMissedLiveClassMorningReportEmail({
  flaggedStudents = [],
  unscheduledStudents = [],
  reportDate,
  lookbackDays = 10,
}) {
  const dateLabel = escapeHtml(reportDate || new Date().toDateString());

  const tableRows = flaggedStudents
    .map((s, idx) => {
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8f5ff';
      const countColor = s.missedCount >= 5 ? '#dc2626' : s.missedCount >= 3 ? '#d97706' : '#6c3fc5';
      const lastTwoMissed = (s.missedDates || [])
        .slice(0, 2)
        .map((d) =>
          new Date(d).toLocaleDateString('sr-Latn-RS', {
            day: '2-digit',
            month: 'short',
            timeZone: 'Asia/Colombo',
          })
        )
        .join(' · ');

      return `
      <tr style="background:${rowBg};">
        <td style="padding:11px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #ede9fe;font-weight:600;">${escapeHtml(s.name)}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#ede9fe;color:#6c3fc5;font-weight:700;font-size:12px;padding:3px 10px;border-radius:20px;">
            ${escapeHtml(String(s.batch || '—'))}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#fff1f2;color:${countColor};font-weight:800;font-size:13px;padding:3px 12px;border-radius:20px;border:1px solid ${countColor}33;">
            ${s.missedCount}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;white-space:nowrap;">
          ${escapeHtml(lastTwoMissed || '—')}
        </td>
      </tr>`;
    })
    .join('');

  const totalCount = flaggedStudents.length;

  const unscheduledSection = unscheduledStudents.length
    ? `
          <tr>
            <td style="padding:0 32px 28px;">
              <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px 18px;">
                <p style="margin:0 0 10px;color:#92400e;font-size:13px;font-weight:700;">
                  ⚠️ ${unscheduledStudents.length} aktivan student${unscheduledStudents.length !== 1 ? 'a' : ''} nije na nijednom rasporedu časova
                </p>
                <p style="margin:0 0 12px;color:#92400e;font-size:12px;line-height:1.5;">
                  Grupe ovih studenata su imale žive časove u poslednjih ${lookbackDays} dana, ali nisu bili raspoređeni ni u jedan od njih — molimo proverite njihove rasporede časova.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${unscheduledStudents
                    .map(
                      (s) => `
                  <tr>
                    <td style="padding:6px 8px;font-size:13px;color:#78350f;border-bottom:1px solid #fde68a;font-weight:600;">${escapeHtml(s.name)}</td>
                    <td style="padding:6px 8px;font-size:12px;color:#92400e;border-bottom:1px solid #fde68a;text-align:center;">Grupa ${escapeHtml(String(s.batch || '—'))}</td>
                    <td style="padding:6px 8px;font-size:12px;color:#92400e;border-bottom:1px solid #fde68a;text-align:right;">${s.batchClassDays} dan${s.batchClassDays !== 1 ? 'a' : ''} nastave</td>
                  </tr>`
                    )
                    .join('')}
                </table>
              </div>
            </td>
          </tr>`
    : '';

  return {
    subject: `[Jutarnji izveštaj] ${totalCount} Student${totalCount !== 1 ? 'a' : ''} sa 2+ propuštenih živih časova (poslednjih ${lookbackDays} dana) — ${dateLabel}`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Izveštaj o propuštenim živim časovima</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="760" cellspacing="0" cellpadding="0"
               style="max-width:760px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global — Izveštaj o propuštenim živim časovima
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.88);font-size:14px;">
                Jutarnji pregled &nbsp;·&nbsp; ${dateLabel}
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f3eeff;padding:20px 40px;text-align:center;">
              <span style="display:inline-block;background:#6c3fc5;color:#fff;font-size:13px;font-weight:700;padding:8px 22px;border-radius:20px;">
                ${totalCount} student${totalCount !== 1 ? 'a' : ''} označeno
              </span>
              <p style="margin:12px 0 0;color:#6c3fc5;font-size:13px;line-height:1.5;">
                Studenti navedeni ispod su propustili <strong>2 ili više živih časova</strong> u <strong>poslednjih ${lookbackDays} dana</strong> (potpuno odsutni, 0% prisustvo).<br/>
                Molimo pratite ih što pre.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#6c3fc5;">
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Ime studenta</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Grupa</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Propušteni časovi</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Poslednji propušteni</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `
                  <tr>
                    <td colspan="4" style="padding:24px;text-align:center;color:#9ca3af;font-size:14px;">
                      Nema studenata sa 2+ propuštenih živih časova u poslednjih ${lookbackDays} dana danas. 🎉
                    </td>
                  </tr>`}
                </tbody>
              </table>
            </td>
          </tr>
${unscheduledSection}
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">
                Ovaj izveštaj se automatski generiše svako jutro u 10:00 (IST) od strane Glück Global studentskog portala.<br/>
                Računaju se samo živi časovi iz poslednjih ${lookbackDays} dana. Čas se smatra propuštenim kada je student bio raspoređen za njega, prisustvo je zabeleženo i student je bio potpuno odsutan (0% učešće). Maksimalno jedan propušteni čas se računa po danu.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f8fafc;padding:16px 40px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">© Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Milestone day absence alert — sent to the language team when students
 * miss their Day 1, 3, or 6 live class.
 *
 * @param {object} params
 * @param {Array}  params.groups     - Array of { batchName, courseDay, dateLabel, absentStudents: [{name, email}] }
 * @param {string} params.reportDate - Human-readable report date
 */
function buildMilestoneAbsenceAlertEmail({ groups, reportDate }) {
  const totalAbsent = groups.reduce((s, g) => s + g.absentStudents.length, 0);

  const groupRows = groups
    .map(
      (g) => `
      <!-- Group header -->
      <tr>
        <td colspan="2" style="padding:14px 0 6px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#6c3fc5;text-transform:uppercase;letter-spacing:0.5px;">
            ${escapeHtml(g.batchName)} &nbsp;·&nbsp; Dan ${escapeHtml(String(g.courseDay))}
            &nbsp;<span style="font-weight:400;color:#94a3b8;">(${escapeHtml(g.dateLabel)})</span>
          </p>
        </td>
      </tr>
      ${g.absentStudents
        .map(
          (s, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:10px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
      </tr>`,
        )
        .join('')}`,
    )
    .join('');

  return {
    subject: `⚠️ Dan ${groups.map((g) => g.courseDay).join('/')} Upozorenje o odsustvu – ${totalAbsent} student${totalAbsent !== 1 ? 'a' : ''} propustilo čas`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Upozorenje o ključnom odsustvu</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0"
               style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Jezički tim</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Upozorenje o ključnom odsustvu</p>
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background:#fff7ed;padding:18px 40px;border-bottom:2px solid #fed7aa;">
              <p style="margin:0;font-size:15px;color:#9a3412;font-weight:600;">
                ⚠️ ${totalAbsent} student${totalAbsent !== 1 ? 'a' : ''} propustilo ključni živi čas dana ${escapeHtml(reportDate)}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#c2410c;">
                Praćeni ključni dani: Dan 1, Dan 3, Dan 6
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Ime studenta</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">E-mail</th>
                  </tr>
                </thead>
                <tbody>
                  ${groupRows || `<tr><td colspan="2" style="padding:20px;text-align:center;color:#9ca3af;font-size:14px;">Nema zabeleženih odsustva.</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Automatski generisano od strane Glück Global portala · ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd ·
                <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Weekly missed-classes digest — sent every Monday to the language team.
 *
 * @param {object} params
 * @param {string} params.weekRange    - e.g. "23 Jun – 29 Jun 2026"
 * @param {Array}  params.students     - Array of { name, batch, missedCount, missedDays: [{courseDay, dateLabel, topic}] }
 * @param {string} params.reportDate   - Human-readable run date
 */
function buildWeeklyMissedClassesEmail({ weekRange, students, reportDate }) {
  const tableRows = students
    .map((s, i) => {
      const dayPills = s.missedDays
        .map(
          (d) =>
            `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:3px 8px;border-radius:10px;margin:2px 2px 2px 0;border:1px solid #fcd34d;">
              Dan ${escapeHtml(String(d.courseDay))} · ${escapeHtml(d.dateLabel)}
            </span>`,
        )
        .join('');

      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:11px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.batch || '—')}
        </td>
        <td style="padding:11px 12px;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:center;">
          <span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:13px;font-weight:700;padding:3px 12px;border-radius:12px;">
            ${s.missedCount}
          </span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
          ${dayPills}
        </td>
      </tr>`;
    })
    .join('');

  return {
    subject: `📊 Nedeljni pregled odsustva – ${weekRange} – ${students.length} student${students.length !== 1 ? 'a' : ''} sa propuštenim časovima`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nedeljni pregled odsustva</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Jezički tim</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Nedeljni pregled odsustva</p>
            </td>
          </tr>

          <!-- Week range banner -->
          <tr>
            <td style="background:#eff6ff;padding:16px 40px;border-bottom:2px solid #bfdbfe;">
              <p style="margin:0;font-size:15px;color:#1e40af;font-weight:600;">
                📅 Nedelja: ${escapeHtml(weekRange)}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#3b82f6;">
                ${students.length} student${students.length !== 1 ? 'a' : ''} propustilo najmanje jedan živi čas ove nedelje
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;width:25%;">Student</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;width:18%;">Grupa</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;width:10%;">Propušteno</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Propušteni časovi</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `<tr><td colspan="4" style="padding:24px;text-align:center;color:#9ca3af;font-size:14px;">Nema propuštenih časova ove nedelje. 🎉</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Automatski generisano svakog ponedeljka · Izveštaj za ${escapeHtml(weekRange)}<br/>
                © Glück Global Pvt Ltd ·
                <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Day 6 weekly test low-score alert — sent when a student scores < 60% on the weekly test.
 *
 * @param {object} params
 * @param {Array}  params.students  - [{ name, email, batch, score, exerciseTitle }]
 * @param {string} params.reportDate
 */
function buildWeeklyTestLowScoreEmail({ students, reportDate }) {
  const tableRows = students
    .map((s, i) => {
      const scoreColor = s.score < 40 ? '#991b1b' : '#92400e';
      const scoreBg    = s.score < 40 ? '#fee2e2' : '#fef3c7';
      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:11px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.batch)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:11px 12px;text-align:center;border-bottom:1px solid #e2e8f0;">
          <span style="display:inline-block;background:${scoreBg};color:${scoreColor};font-size:13px;font-weight:700;padding:4px 14px;border-radius:12px;">
            ${s.score}%
          </span>
        </td>
      </tr>`;
    })
    .join('');

  return {
    subject: `⚠️ Nedeljni test Dana 6 – ${students.length} student${students.length !== 1 ? 'a' : ''} postiglo manje od 60%`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Upozorenje o niskom rezultatu nedeljnog testa</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="660" cellspacing="0" cellpadding="0"
               style="max-width:660px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Jezički tim</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Nedeljni test Dana 6 · Upozorenje o niskom rezultatu</p>
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background:#fff7ed;padding:16px 40px;border-bottom:2px solid #fed7aa;">
              <p style="margin:0;font-size:15px;color:#9a3412;font-weight:600;">
                ⚠️ ${students.length} student${students.length !== 1 ? 'a' : ''} postiglo manje od 60% na nedeljnom testu Dana 6
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#c2410c;">
                Ovi studenti možda trebaju dodatnu podršku pre napredovanja.
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Student</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Grupa</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">E-mail</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Rezultat</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `<tr><td colspan="4" style="padding:20px;text-align:center;color:#9ca3af;">Nema podataka.</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Prag prolaza: 60% · Automatski generisano ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Day 6 content-not-completed alert — students who reached Day 8 without finishing Day 6 content.
 *
 * @param {object} params
 * @param {Array}  params.students  - [{ name, email, batch, completionPct, completedItems, totalItems, currentDay }]
 * @param {string} params.reportDate
 */
function buildDay6CompletionCheckEmail({ students, reportDate }) {
  const tableRows = students
    .map((s, i) => {
      const pct = s.completionPct;
      const barColor = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:11px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.batch)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:11px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">
          <span style="font-size:12px;color:#64748b;">${s.completedItems}/${s.totalItems}</span>
        </td>
        <td style="padding:11px 16px;border-bottom:1px solid #e2e8f0;min-width:140px;">
          <div style="background:#e2e8f0;border-radius:4px;height:10px;width:100%;overflow:hidden;">
            <div style="width:${pct}%;background:${barColor};height:10px;border-radius:4px;"></div>
          </div>
          <p style="margin:3px 0 0;font-size:11px;color:#64748b;text-align:right;">${pct}%</p>
        </td>
      </tr>`;
    })
    .join('');

  return {
    subject: `📋 Upozorenje o završetku Dana 6 – ${students.length} student${students.length !== 1 ? 'a' : ''} nije završilo aktivnosti Dana 6`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Upozorenje o završetku Dana 6</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Jezički tim</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Završetak aktivnosti Dana 6 · Provera kraja 1. nedelje</p>
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background:#fef9c3;padding:16px 40px;border-bottom:2px solid #fde047;">
              <p style="margin:0;font-size:15px;color:#713f12;font-weight:600;">
                📋 ${students.length} student${students.length !== 1 ? 'a' : ''} prešlo na Dan 8 bez završavanja svih aktivnosti Dana 6
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#92400e;">
                Rok: Kraj Dana 7 · Aktivnosti uključuju vežbe i DG Bot module na putovanju Dana 6.
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Student</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Grupa</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">E-mail</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Završeno</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;min-width:140px;">Napredak</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `<tr><td colspan="5" style="padding:20px;text-align:center;color:#9ca3af;">Nema podataka.</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Broji vežbe + DG Bot module na putovanju Dana 6 · Automatski generisano ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Day-1 batch launch reminder email.
 * @param {object} params
 * @param {string} params.name       - Student's name
 * @param {string} params.batchName  - Batch identifier
 * @param {string} params.type       - 'eve' (day before) or 'day1' (launch day)
 * @param {string} params.startDate  - Formatted date string e.g. "30 June 2026"
 */
function buildBatchDay1ReminderEmail({ name, batchName, type, startDate }) {
  const isEve = type === 'eve';

  const subject = isEve
    ? `🎉 Sutra je vaš Dan 1 – Da li ste spremni, ${name.split(' ')[0]}?`
    : `🚀 Danas je Dan 1 – Vaše nemačko putovanje počinje SADA!`;

  const headline = isEve
    ? 'Vaši živi časovi počinju sutra! 🎉'
    : 'Danas je Dan 1 – Idemo! 🚀';

  const emoji = isEve ? '🗓️' : '🎯';

  const bodyText = isEve
    ? `Dobro se naspavajte i budite spremni za učenje — sutra, <strong>${escapeHtml(startDate)}</strong>, je vaš prvi Dan 1 živih časova nemačkog! Vaš nastavnik i kolege su sve pripremili i čekaju vas. Toliko smo uzbuđeni što ste na ovom putovanju.`
    : `Evo ga — <strong>${escapeHtml(startDate)}</strong> je vaš zvanični Dan 1! Vaši živi časovi nemačkog počinju danas. Prijavite se na portal, proverite raspored i pridružite se prvom času. Čekali ste ovaj trenutak — idite i iskoristite ga!`;

  const pillText = isEve
    ? `Živi časovi počinju sutra · ${escapeHtml(startDate)}`
    : `Dan 1 je DANAS · ${escapeHtml(startDate)}`;

  const pillColor = isEve ? '#ecfdf5' : '#eff6ff';
  const pillBorder = isEve ? '#6ee7b7' : '#93c5fd';
  const pillTextColor = isEve ? '#065f46' : '#1e40af';

  const loginUrl = process.env.PORTAL_URL
    ? `${process.env.PORTAL_URL}/login`
    : process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/login`
    : 'https://portal.serbia.gluckglobal.com/login';

  return {
    subject,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isEve ? 'Dan 1 sutra!' : 'Dan 1 danas!'}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global
              </h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                Vaš partner za učenje nemačkog
              </p>
            </td>
          </tr>

          <!-- Hero banner -->
          <tr>
            <td style="background:linear-gradient(135deg,#f3eeff 0%,#ede9fe 100%);padding:28px 40px;text-align:center;">
              <p style="margin:0;font-size:52px;line-height:1;">${emoji}</p>
              <p style="margin:10px 0 0;color:#6c3fc5;font-size:20px;font-weight:700;">
                ${escapeHtml(headline)}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Zdravo <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.7;">
                ${bodyText}
              </p>

              <!-- Date pill -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <span style="display:inline-block;background:${pillColor};color:${pillTextColor};font-size:13px;font-weight:600;padding:10px 22px;border-radius:20px;border:1px solid ${pillBorder};">
                      ${escapeHtml(pillText)}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 8px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.3px;">
                      ${isEve ? 'Proveri raspored' : 'Idi na portal sada'}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;">
                Grupa: <strong style="color:#6c3fc5;">${escapeHtml(batchName)}</strong>
              </p>
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © Glück Global Pvt Ltd ·
                <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Short daily task reminder sent at 12 PM when a student hasn't completed today's exercises / DG bot.
 *
 * @param {object} params
 * @param {string} params.name            - Student name
 * @param {number} params.day             - Journey day number
 * @param {Array}  params.incompleteTasks - [{ kind, title }] (max 3 shown)
 * @param {string} params.portalUrl       - Portal base URL
 */
function buildDailyTaskReminderEmail({ name, day, incompleteTasks = [], portalUrl }) {
  const loginUrl = `${(portalUrl || process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.serbia.gluckglobal.com').replace(/\/$/, '')}/login`;
  const shown = (incompleteTasks || []).slice(0, 3);
  const taskListHtml = shown.length
    ? `<ul style="margin:12px 0 20px;padding-left:22px;color:#374151;font-size:15px;line-height:1.8;">
        ${shown.map((t) => `<li>${escapeHtml(t.title || 'Zadatak')}</li>`).join('')}
       </ul>`
    : '';

  return {
    subject: `Završite zadatke Dana ${day} — Glück Global`,
    html: `<!DOCTYPE html>
<html lang="sr-Latn">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#000e89 0%,#6c3fc5 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Dnevni podsetnik za zadatke</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Zdravo <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                Još uvek imate zadatke za završiti za <strong>Dan ${day}</strong>. Završite ih pre kraja dana da bi vaš niz i napredak ostali na pravom putu!
              </p>
              ${taskListHtml}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;background:#000e89;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;">
                      Otvori portal i završi zadatke
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
                Doslednost je ključ — svaki zadatak koji završite vas vodi bliže tečnosti. Vidimo se na portalu!
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8f9ff;padding:18px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Zdravo ${name},\n\nJoš uvek imate zadatke za završiti za Dan ${day}. Prijavite se na portal i završite ih danas:\n${loginUrl}\n\nNastavite sjajnim radom!\n\n— Glück Global`,
  };
}

/**
 * Weekly Test Incomplete Reminder — sent directly to the student at 8 AM
 * on the morning of Day 7 (or any weekly boundary day) when they haven't
 * completed the Weekly Test from the previous day.
 *
 * @param {object} params
 * @param {string} params.name         - Student's display name
 * @param {number} params.testDay      - The courseDay of the missed weekly test (e.g. 6)
 * @param {number} params.currentDay   - Student's current courseDay (e.g. 7)
 * @param {string[]} params.missingItems - Titles of uncompleted weekly-test items
 * @param {string} params.portalUrl    - Portal base URL
 */
function buildWeeklyTestIncompleteReminderEmail({ name, testDay, currentDay, missingItems = [], portalUrl }) {
  const loginUrl = `${(portalUrl || process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.serbia.gluckglobal.com').replace(/\/$/, '')}/login`;
  const week = Math.ceil(currentDay / 7);
  const itemListHtml = missingItems.length
    ? `<ul style="margin:12px 0 20px;padding-left:22px;color:#374151;font-size:15px;line-height:1.8;">
        ${missingItems.slice(0, 5).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
       </ul>`
    : '';

  return {
    subject: `⏰ Ne zaboravite test Nedelje ${week} — završite ga da otključate module Dana ${currentDay}!`,
    html: `<!DOCTYPE html>
<html lang="sr-Latn">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#000e89 0%,#6c3fc5 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Podsetnik za nedeljni test</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Zdravo <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                Čini se da još niste završili <strong>Nedeljni test Nedelje ${week}</strong> od Dana ${testDay}.
                Molimo završite ga da u potpunosti otključate module Dana ${currentDay} i ostanete na pravom putu učenja!
              </p>
              ${itemListHtml}
              <div style="background:#fff8e1;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">
                  ⚠️ <strong>Ne čekajte!</strong> Završavanje nedeljnog testa vam pomaže da konsolidujete sve što ste naučili i priprema vas za sadržaj sledeće nedelje.
                </p>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:4px 0 24px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;background:#000e89;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;">
                      Završi nedeljni test sada
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
                Doslednost je ključ tečnosti — svaki test koji završite vas vodi jedan korak bliže cilju!
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8f9ff;padding:18px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Zdravo ${name},\n\nJoš niste završili Nedeljni test Nedelje ${week} od Dana ${testDay}. Molimo završite ga da otključate module Dana ${currentDay}!\n\nPrijavite se ovde: ${loginUrl}\n\n— Glück Global`,
  };
}

module.exports = {
  buildPasswordResetOtpEmail,
  buildEmailChangeOtpEmail,
  buildPortalCredentialsEmail,
  buildWelcomeOneTimePasswordEmail,
  buildForcePasswordResetEmail,
  buildSignupLinkEmail,
  buildRegisterInviteEmail,
  buildSignupEmailOtpEmail,
  buildSignupProofReceivedAdminEmail,
  buildJobApplicationReceivedAdminEmail,
  buildSignupApprovedWelcomeEmail,
  buildSignupRejectedEmail,
  buildDailyTaskReminderEmail,
  buildJourneyDayReminderEmail,
  buildJourneyWeekReminderEmail,
  buildPortalAbsenceReminderEmail,
  buildConsecutiveAbsenceLanguageTeamEmail,
  buildMissedLiveClassMorningReportEmail,
  buildBatchDay1ReminderEmail,
  buildMilestoneAbsenceAlertEmail,
  buildWeeklyMissedClassesEmail,
  buildWeeklyTestLowScoreEmail,
  buildDay6CompletionCheckEmail,
  buildLateJoinEarlyExitEmail,
  buildWeeklyTestIncompleteReminderEmail,
};

/**
 * Late join / early exit alert for Day 1 and Day 3 classes.
 *
 * @param {object} params
 * @param {string} params.batchName
 * @param {number} params.courseDay
 * @param {string} params.classDate        - e.g. "Mon, 30 Jun 2026"
 * @param {string} params.classTopic       - meeting topic/title
 * @param {string} params.classDuration    - e.g. "120 min"
 * @param {Array}  params.lateJoiners      - [{ name, email, lateByMinutes }]
 * @param {Array}  params.earlyExiters     - [{ name, email, attendedMinutes, leftEarlyByMinutes, attendedPct }]
 * @param {string} params.reportDate
 */
function buildLateJoinEarlyExitEmail({
  batchName, courseDay, classDate, classTopic, classDuration,
  lateJoiners, earlyExiters, reportDate,
}) {
  const hasLate = lateJoiners.length > 0;
  const hasEarly = earlyExiters.length > 0;

  const lateRows = lateJoiners
    .map((s, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:10px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:10px 12px;text-align:center;border-bottom:1px solid #e2e8f0;">
          <span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;padding:4px 12px;border-radius:12px;">
            +${s.lateByMinutes} min kasno
          </span>
        </td>
      </tr>`)
    .join('');

  const earlyRows = earlyExiters
    .map((s, i) => {
      const pct = s.attendedPct;
      const barColor = pct >= 60 ? '#f59e0b' : '#ef4444';
      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:10px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:center;">
          ${s.attendedMinutes} min
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">
          <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;padding:4px 12px;border-radius:12px;">
            otišlo ${s.leftEarlyByMinutes} min ranije
          </span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;min-width:120px;">
          <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;">
            <div style="width:${pct}%;background:${barColor};height:8px;border-radius:4px;"></div>
          </div>
          <p style="margin:2px 0 0;font-size:11px;color:#64748b;text-align:right;">${pct}%</p>
        </td>
      </tr>`;
    })
    .join('');

  const totalFlags = lateJoiners.length + earlyExiters.length;
  const dayLabel = `Dan ${courseDay}`;

  return {
    subject: `🕐 Upozorenje za čas ${dayLabel} – ${lateJoiners.length} kasno pridružen${lateJoiners.length !== 1 ? 'ih' : 'ih'}, ${earlyExiters.length} rano otiš${earlyExiters.length !== 1 ? 'lo' : 'lo'} · ${escapeHtml(batchName)}`,
    html: `
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Upozorenje o prisustvu na času ${dayLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Jezički tim</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${dayLabel} čas · Izveštaj o kasnom dolasku i ranom odlasku</p>
            </td>
          </tr>

          <!-- Class summary pill -->
          <tr>
            <td style="background:#f0ebff;padding:16px 40px;border-bottom:2px solid #c4b5fd;">
              <p style="margin:0;font-size:15px;color:#4c1d95;font-weight:600;">
                📅 ${escapeHtml(batchName)} · ${dayLabel} &nbsp;|&nbsp; ${escapeHtml(classDate)}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#6d28d9;">
                ${escapeHtml(classTopic || 'Živi čas')} &nbsp;·&nbsp; Trajanje: ${escapeHtml(classDuration)}
                &nbsp;·&nbsp; <strong>${totalFlags}</strong> student${totalFlags !== 1 ? 'a' : ''} označeno
              </p>
            </td>
          </tr>

          <tr><td style="padding:0 32px;">

          ${hasLate ? `
          <!-- Late Joiners -->
          <p style="margin:24px 0 10px;font-size:14px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;">
            🕐 Kasni dolasci (${lateJoiners.length})
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                 style="border-radius:8px;overflow:hidden;border:1px solid #fecaca;">
            <thead>
              <tr style="background:#fef2f2;">
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#991b1b;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Student</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#991b1b;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">E-mail</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#991b1b;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Pristigao</th>
              </tr>
            </thead>
            <tbody>${lateRows}</tbody>
          </table>` : ''}

          ${hasEarly ? `
          <!-- Early Exits -->
          <p style="margin:24px 0 10px;font-size:14px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">
            🚪 Rani odlasci (${earlyExiters.length})
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                 style="border-radius:8px;overflow:hidden;border:1px solid #fed7aa;">
            <thead>
              <tr style="background:#fff7ed;">
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Student</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">E-mail</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Vreme ulaska</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Rano otišlo</th>
                <th style="padding:10px 14px;font-size:12px;font-weight:700;color:#92400e;text-align:left;text-transform:uppercase;letter-spacing:0.4px;min-width:120px;">Prisustvovalo</th>
              </tr>
            </thead>
            <tbody>${earlyRows}</tbody>
          </table>` : ''}

          </td></tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;margin-top:8px;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Prag kasnog dolaska: 10 min nakon početka časa · Rani odlazak: otišlo pre 75% časa<br/>
                Automatski generisano nakon završetka časa ${dayLabel} · ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd · <a href="${process.env.PORTAL_URL || 'https://portal.gluckglobal.rs'}" style="color:#6c3fc5;">${(process.env.PORTAL_URL || 'https://portal.gluckglobal.rs').replace(/^https?:\/\//, '')}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}
