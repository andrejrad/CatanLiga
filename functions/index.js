const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const RECIPIENTS_PER_BATCH = 50;

function getMailSenderUser() {
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "").trim();

  if (projectId === "catan-liga-staging") {
    return "catanligastaging@gmail.com";
  }

  return "catanligazagreb@gmail.com";
}

function getMailFromHeader() {
  return `Catan Liga Zagreb <${getMailSenderUser()}>`;
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function ensurePost(req, res) {
  if (req.method === "POST") {
    return true;
  }

  res.status(405).json({ ok: false, error: "Method not allowed" });
  return false;
}

function buildTransporter() {
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  const gmailUser = getMailSenderUser();

  if (!gmailAppPassword) {
    throw new Error("Missing GMAIL_APP_PASSWORD secret.");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailAppPassword
    }
  });
}

async function verifyAdminPassword(adminPassword) {
  const provided = normalize(adminPassword);
  if (!provided) {
    throw new Error("Nedostaje admin lozinka.");
  }

  const settingsDoc = await db.collection("adminSettings").doc("access").get();
  if (!settingsDoc.exists) {
    throw new Error("Admin postavke nisu dostupne.");
  }

  const data = settingsDoc.data() || {};
  if (String(data.password || "") !== provided) {
    throw new Error("Admin lozinka nije točna.");
  }
}

async function collectDistinctEmails(options) {
  const mode = options.mode;
  const tournamentId = options.tournamentId;

  let snapshot;
  if (mode === "tournament") {
    snapshot = await db.collection("registrations").where("tournamentId", "==", tournamentId).get();
  } else {
    snapshot = await db.collection("registrations").get();
  }

  const seen = {};
  const emails = [];

  snapshot.forEach(function (doc) {
    const data = doc.data() || {};
    const email = normalizeEmail(data.email);
    if (!email || seen[email]) {
      return;
    }

    seen[email] = true;
    emails.push(email);
  });

  return emails;
}

function splitIntoChunks(items, chunkSize) {
  const chunks = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  return chunks;
}

async function sendBulkByBatches(transporter, payload) {
  const recipients = payload.recipients;
  const subject = payload.subject;
  const html = payload.html;
  const text = payload.text;

  const chunks = splitIntoChunks(recipients, RECIPIENTS_PER_BATCH);
  const mailFrom = getMailFromHeader();
  const senderUser = getMailSenderUser();

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];

    await transporter.sendMail({
      from: mailFrom,
      to: senderUser,
      bcc: chunk,
      subject: subject,
      text: text,
      html: html
    });
  }

  return {
    totalRecipients: recipients.length,
    batches: chunks.length
  };
}

function sanitizeMultilineText(value) {
  return normalize(value).replace(/\r\n/g, "\n");
}

function toSimpleHtml(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .split("\n")
    .map(function (line) {
      return `<p style=\"margin:0 0 10px 0;\">${line || "&nbsp;"}</p>`;
    })
    .join("");
}

exports.sendRegistrationConfirmation = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    cors: true,
    secrets: ["GMAIL_APP_PASSWORD"],
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (req, res) => {
    if (!ensurePost(req, res)) {
      return;
    }

    try {
      const firstName = normalize(req.body && req.body.firstName);
      const lastName = normalize(req.body && req.body.lastName);
      const email = normalizeEmail(req.body && req.body.email);
      const tournamentLabel = normalize(req.body && req.body.tournamentLabel);

      if (!firstName || !lastName || !email || email.indexOf("@") === -1) {
        res.status(400).json({ ok: false, error: "Neispravni podaci za potvrdu prijave." });
        return;
      }

      const transporter = buildTransporter();
      const mailFrom = getMailFromHeader();
      const playerName = `${firstName} ${lastName}`.trim();
      const subject = "Potvrda prijave - Catan Liga Zagreb";
      const intro = "Uspješno smo zaprimili Vašu prijavu za sudjelovanje.";
      const details = tournamentLabel ? `Prijavljeni turnir: ${tournamentLabel}` : "Prijavljeni turnir: evidentiran u sustavu";
      const detailsHtml = tournamentLabel
        ? `<p><strong>Prijavljeni turnir:</strong> <strong>${tournamentLabel}</strong></p>`
        : "<p><strong>Prijavljeni turnir:</strong> <strong>evidentiran u sustavu</strong></p>";
      const text = [
        `Poštovani/a ${playerName},`,
        "",
        intro,
        "",
        details,
        "",
        "Veselimo se Vašem dolasku i dobrim partijama Catana! \u{1F60A}",
        "",
        "Lijep pozdrav,",
        "Catan Liga Zagreb",
        "Instagram: @catanliga_zagreb",
        "Web: www.catanligazagreb.com"
      ].join("\n");

      const html = [
        `<p>Poštovani/a ${playerName},</p>`,
        `<p>${intro}</p>`,
        detailsHtml,
        "<p>Veselimo se Vašem dolasku i dobrim partijama Catana! 😊</p>",
        "<p>Lijep pozdrav,<br/>Catan Liga Zagreb<br/>Instagram: @catanliga_zagreb<br/>Web: www.catanligazagreb.com</p>"
      ].join("");

      await transporter.sendMail({
        from: mailFrom,
        to: email,
        subject: subject,
        text: text,
        html: html
      });

      res.json({ ok: true });
    } catch (error) {
      logger.error("sendRegistrationConfirmation failed", error);
      res.status(500).json({ ok: false, error: "Slanje potvrde nije uspjelo." });
    }
  }
);

exports.sendBulkTournamentEmail = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    cors: true,
    secrets: ["GMAIL_APP_PASSWORD"],
    timeoutSeconds: 540,
    memory: "512MiB"
  },
  async (req, res) => {
    if (!ensurePost(req, res)) {
      return;
    }

    try {
      const adminPassword = req.body && req.body.adminPassword;
      const tournamentId = normalize(req.body && req.body.tournamentId);
      const tournamentLabel = normalize(req.body && req.body.tournamentLabel);
      const subjectRaw = normalize(req.body && req.body.subject);
      const bodyRaw = sanitizeMultilineText(req.body && req.body.body);

      if (!tournamentId) {
        res.status(400).json({ ok: false, error: "Odaberi turnir." });
        return;
      }

      if (!subjectRaw || !bodyRaw) {
        res.status(400).json({ ok: false, error: "Subject i tekst poruke su obavezni." });
        return;
      }

      await verifyAdminPassword(adminPassword);

      const recipients = await collectDistinctEmails({
        mode: "tournament",
        tournamentId: tournamentId
      });

      if (!recipients.length) {
        res.status(400).json({ ok: false, error: "Nema igrača za odabrani turnir." });
        return;
      }

      const transporter = buildTransporter();
      const titleLine = tournamentLabel ? `Kolo: ${tournamentLabel}` : "Kolo Catan Liga Zagreb";
      const text = [titleLine, "", bodyRaw, "", "Catan Liga Zagreb"].join("\n");
      const html = [
        `<p><strong>${titleLine}</strong></p>`,
        toSimpleHtml(bodyRaw),
        "<p style=\"margin-top:14px;\">Catan Liga Zagreb</p>"
      ].join("");

      const result = await sendBulkByBatches(transporter, {
        recipients: recipients,
        subject: subjectRaw,
        text: text,
        html: html
      });

      res.json({ ok: true, result: result });
    } catch (error) {
      logger.error("sendBulkTournamentEmail failed", error);
      res.status(500).json({ ok: false, error: error.message || "Bulk slanje nije uspjelo." });
    }
  }
);

exports.sendBulkAllPlayersEmail = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    cors: true,
    secrets: ["GMAIL_APP_PASSWORD"],
    timeoutSeconds: 540,
    memory: "512MiB"
  },
  async (req, res) => {
    if (!ensurePost(req, res)) {
      return;
    }

    try {
      const adminPassword = req.body && req.body.adminPassword;
      const subjectRaw = normalize(req.body && req.body.subject);
      const bodyRaw = sanitizeMultilineText(req.body && req.body.body);

      if (!subjectRaw || !bodyRaw) {
        res.status(400).json({ ok: false, error: "Subject i tekst poruke su obavezni." });
        return;
      }

      await verifyAdminPassword(adminPassword);

      const recipients = await collectDistinctEmails({ mode: "all" });
      if (!recipients.length) {
        res.status(400).json({ ok: false, error: "U bazi nema registriranih email adresa." });
        return;
      }

      const transporter = buildTransporter();
      const text = [bodyRaw, "", "Catan Liga Zagreb"].join("\n");
      const html = [
        toSimpleHtml(bodyRaw),
        "<p style=\"margin-top:14px;\">Catan Liga Zagreb</p>"
      ].join("");

      const result = await sendBulkByBatches(transporter, {
        recipients: recipients,
        subject: subjectRaw,
        text: text,
        html: html
      });

      res.json({ ok: true, result: result });
    } catch (error) {
      logger.error("sendBulkAllPlayersEmail failed", error);
      res.status(500).json({ ok: false, error: error.message || "Bulk slanje nije uspjelo." });
    }
  }
);
