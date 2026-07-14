let neon = null;
try {
  ({ neon } = require("@neondatabase/serverless"));
} catch {
  neon = null;
}
const crypto = require("crypto");

const EVENT_CATALOG = {
  "march-madness": {
    eventName: "March Madness - Rooftop Splash",
    eventDate: "2026-03-21",
    ticketLimit: 250,
    packagePrices: { stag: 2299, female: 499, couple: 2799 },
    tablePrices: { "": 0, regular: 14999, vvip: 22999 },
    addOnPrices: { hukkah: 5000, bottle: 10000, mixer: 500 },
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(data, statusCode = 200) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(data),
  };
}

function fail(message, statusCode = 400) {
  return json({ ok: false, error: message }, statusCode);
}

function optionsResponse() {
  return { statusCode: 204, headers: corsHeaders(), body: "" };
}

function parseJson(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function getSql() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL_UNPOOLED;

  if (!connectionString) {
    throw new Error("Missing environment variable: DATABASE_URL");
  }
  if (!neon) {
    throw new Error("Neon driver is not available in this environment");
  }
  return neon(connectionString);
}

function phonePeApiBase() {
  return process.env.PHONEPE_ENV === "PROD"
    ? "https://api.phonepe.com/apis/pg"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";
}

function phonePeIdentityBase() {
  return "https://api.phonepe.com/apis/identity-manager";
}

async function getPhonePeAccessToken() {
  if (
    !process.env.PHONEPE_CLIENT_ID ||
    !process.env.PHONEPE_CLIENT_SECRET ||
    !process.env.PHONEPE_CLIENT_VERSION
  ) {
    throw new Error("PhonePe credentials are missing");
  }

  const res = await fetch(`${phonePeIdentityBase()}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PHONEPE_CLIENT_ID,
      client_secret: process.env.PHONEPE_CLIENT_SECRET,
      client_version: Number(process.env.PHONEPE_CLIENT_VERSION),
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json().catch(() => ({}));
  const token =
    data?.access_token ||
    data?.data?.accessToken ||
    data?.data?.access_token ||
    "";
  if (!res.ok || !token) {
    throw new Error("Failed to fetch PhonePe access token");
  }
  return token;
}

function randomRef(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function buildPendingRef() {
  return randomRef("PEND");
}

function buildBookingId() {
  return randomRef("MAV-MM");
}

function attendeesForPackage(packageType, quantity) {
  return packageType === "couple" ? quantity * 2 : quantity;
}

async function getTicketLimit(sql, eventKey) {
  const event = EVENT_CATALOG[eventKey];
  if (!event) return 0;
  const rows = await sql`
    SELECT setting_value
    FROM settings
    WHERE setting_key = ${`ticket_limit_${eventKey}`}
    LIMIT 1
  `;
  const custom = Number(rows[0]?.setting_value || 0);
  return custom > 0 ? custom : event.ticketLimit;
}

async function remainingCapacity(sql, eventKey) {
  const limit = await getTicketLimit(sql, eventKey);
  const rows = await sql`
    SELECT COALESCE(SUM(attendees), 0)::int AS sold
    FROM bookings
    WHERE event_key = ${eventKey}
      AND payment_status = 'paid'
  `;
  return Math.max(0, limit - Number(rows[0]?.sold || 0));
}

function normalizeBookingPayload(input) {
  const eventKey = String(input?.eventKey || "march-madness");
  const event = EVENT_CATALOG[eventKey];
  if (!event) return { error: "Unsupported event key" };

  const packageType = String(input?.packageType || "");
  const quantity = Number(input?.quantity || 0);
  const tableType = String(input?.tableType || "");
  const addOns = Array.isArray(input?.addOns) ? input.addOns.map(String) : [];

  if (!Object.prototype.hasOwnProperty.call(event.packagePrices, packageType)) {
    return { error: "Invalid package type" };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    return { error: "Invalid quantity" };
  }
  if (!Object.prototype.hasOwnProperty.call(event.tablePrices, tableType)) {
    return { error: "Invalid table type" };
  }

  const validatedAddOns = addOns.filter((a, i) => {
    return (
      Object.prototype.hasOwnProperty.call(event.addOnPrices, a) &&
      addOns.indexOf(a) === i
    );
  });

  const attendees = attendeesForPackage(packageType, quantity);
  const packageAmount = event.packagePrices[packageType] * quantity;
  const tableAmount = event.tablePrices[tableType] || 0;
  const addOnAmount = validatedAddOns.reduce((sum, a) => {
    return sum + (event.addOnPrices[a] || 0);
  }, 0);

  return {
    eventKey,
    eventName: event.eventName,
    eventDate: event.eventDate,
    packageType,
    quantity,
    attendees,
    tableType,
    addOns: validatedAddOns,
    amount: packageAmount + tableAmount + addOnAmount,
  };
}

function sha256HmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function qrUrl(booking) {
  const payload = [
    booking.booking_id,
    booking.event_name,
    booking.event_date,
    `INR ${booking.amount}`,
  ].join(" | ");
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
}

async function sendResendEmail(booking) {
  const addOns = normalizeAddons(booking.addons_json);
  const addOnLabel = addOns.length ? addOns.join(", ") : "None";
  const tableLabel = String(booking.table_type || "").trim() || "None";
  const packageLabel = String(booking.package_type || "").toUpperCase();
  const customerEmail = normalizeEmail(booking.customer_email);
  if (!customerEmail) return false;

  // Preferred provider: MSG91 Email Flow
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_EMAIL_FLOW_ID) {
    const msg91Ok = await sendMsg91Flow(
      process.env.MSG91_EMAIL_FLOW_ID,
      { email: customerEmail },
      {
        booking_id: booking.booking_id,
        event_name: booking.event_name,
        event_date: booking.event_date,
        package_type: packageLabel,
        quantity: String(booking.quantity || 0),
        table_type: tableLabel,
        addons: addOnLabel,
        amount: String(booking.amount || 0),
      }
    );
    if (msg91Ok) return true;
  }

  // Fallback: Resend
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [customerEmail],
      subject: `Mavricks Booking Confirmed - ${booking.booking_id}`,
      html: `<h2>Booking Confirmed</h2>
<p><strong>ID:</strong> ${booking.booking_id}</p>
<p><strong>Event:</strong> ${booking.event_name}</p>
<p><strong>Date:</strong> ${booking.event_date}</p>
<p><strong>Package:</strong> ${packageLabel} x ${booking.quantity}</p>
<p><strong>Table:</strong> ${tableLabel}</p>
<p><strong>Add-ons:</strong> ${addOnLabel}</p>
<p><strong>Paid:</strong> INR ${booking.amount}</p>`,
    }),
  });

  return res.ok;
}

function normalizePhone(phone) {
  if (!phone) return "";
  const raw = String(phone).trim();
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return "";

  // India-first normalization for local inputs.
  if (digits.length === 10) {
    digits = `91${digits}`;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = `91${digits.slice(1)}`;
  }

  if (digits.length < 10 || digits.length > 15) return "";
  return `+${digits}`;
}

async function sendTwilioWhatsApp(booking) {
  const phone = normalizePhone(booking.customer_phone);
  if (!phone) return false;
  const addOns = normalizeAddons(booking.addons_json);
  const addOnLabel = addOns.length ? addOns.join(", ") : "None";
  const tableLabel = String(booking.table_type || "").trim() || "None";
  const packageLabel = String(booking.package_type || "").toUpperCase();
  const textBody = `Mavricks booking confirmed.
ID: ${booking.booking_id}
Event: ${booking.event_name}
Date: ${booking.event_date}
Package: ${packageLabel} x ${booking.quantity}
Table: ${tableLabel}
Add-ons: ${addOnLabel}
Paid: INR ${booking.amount}`;

  // Preferred provider: MSG91 WhatsApp Flow
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_WHATSAPP_FLOW_ID) {
    const msg91Ok = await sendMsg91Flow(
      process.env.MSG91_WHATSAPP_FLOW_ID,
      { mobiles: msg91MobileFromPhone(phone) },
      {
        booking_id: booking.booking_id,
        event_name: booking.event_name,
        event_date: booking.event_date,
        package_type: packageLabel,
        quantity: String(booking.quantity || 0),
        table_type: tableLabel,
        addons: addOnLabel,
        amount: String(booking.amount || 0),
        body: textBody,
      }
    );
    if (msg91Ok) return true;
  }

  // Fallback: Twilio WhatsApp
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_WHATSAPP_FROM
  ) {
    return false;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`;
  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");
  const form = new URLSearchParams();
  form.set("From", process.env.TWILIO_WHATSAPP_FROM);
  form.set("To", `whatsapp:${phone}`);
  form.set("Body", textBody);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  return res.ok;
}

function normalizeAddons(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function msg91BaseUrl() {
  return String(process.env.MSG91_BASE_URL || "https://control.msg91.com").replace(/\/+$/, "");
}

function msg91MobileFromPhone(phone) {
  return String(phone || "").replace(/\D+/g, "");
}

async function sendMsg91Flow(flowId, recipient, variables) {
  const authKey = String(process.env.MSG91_AUTH_KEY || "").trim();
  const templateId = String(flowId || "").trim();
  if (!authKey || !templateId) return false;

  const payload = {
    template_id: templateId,
    short_url: "0",
    recipients: [
      {
        ...(recipient || {}),
        ...(variables || {}),
      },
    ],
  };

  const res = await fetchWithTimeout(`${msg91BaseUrl()}/api/v5/flow/`, {
    method: "POST",
    headers: {
      authkey: authKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return res.ok;
}

function getHeader(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || "";
}

function getClientIp(event) {
  const cf = getHeader(event, "x-nf-client-connection-ip");
  if (cf) return String(cf).split(",")[0].trim();
  const fwd = getHeader(event, "x-forwarded-for");
  if (fwd) return String(fwd).split(",")[0].trim();
  return "";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function cleanText(value, maxLen) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  if (!maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

function toBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function hashFingerprint(fields) {
  const input = (fields || []).map((v) => cleanText(v, 500)).join("|");
  return crypto.createHash("sha256").update(input).digest("hex");
}

function formatCurrency(amount) {
  const value = Number(amount || 0);
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function buildReceiptSummary(booking) {
  const createdAt = booking?.created_at || booking?.createdAt || new Date().toISOString();
  const date = new Date(createdAt);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return {
    date: validDate.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    status: String(booking?.payment_status || booking?.status || "Pending").trim()
      ? String(booking?.payment_status || booking?.status || "Pending")
          .split(" ")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ")
      : "Pending",
    amount: formatCurrency(booking?.amount || 0),
    transactionId: String(booking?.transaction_id || booking?.transactionId || booking?.payment_ref || "Pending").trim() || "Pending",
    bookingId: String(booking?.booking_id || booking?.bookingId || "").trim(),
  };
}

function getRateLimitConfig() {
  const windowSec = Math.max(
    10,
    Number(process.env.CONTACT_RATE_LIMIT_WINDOW_SEC || 60)
  );
  const max = Math.max(1, Number(process.env.CONTACT_RATE_LIMIT_MAX || 8));
  return { windowSec, max };
}

async function checkRateLimit(sql, tableName, ipAddress, windowSec, max) {
  if (!ipAddress) return { blocked: false, recent: 0 };
  let rows = [];
  if (tableName === "contact_messages") {
    rows = await sql`
      SELECT COUNT(*)::int AS recent
      FROM contact_messages
      WHERE ip_address = ${ipAddress}
        AND created_at >= NOW() - (${windowSec} * INTERVAL '1 second')
    `;
  } else if (tableName === "reservation_requests") {
    rows = await sql`
      SELECT COUNT(*)::int AS recent
      FROM reservation_requests
      WHERE ip_address = ${ipAddress}
        AND created_at >= NOW() - (${windowSec} * INTERVAL '1 second')
    `;
  } else {
    throw new Error("Unsupported rate limit table");
  }
  const recent = Number(rows[0]?.recent || 0);
  return { blocked: recent >= max, recent };
}

async function existsRecentFingerprint(sql, tableName, fingerprint, withinSec) {
  if (!fingerprint) return false;
  let rows = [];
  if (tableName === "contact_messages") {
    rows = await sql`
      SELECT id
      FROM contact_messages
      WHERE fingerprint = ${fingerprint}
        AND created_at >= NOW() - (${withinSec} * INTERVAL '1 second')
      LIMIT 1
    `;
  } else if (tableName === "reservation_requests") {
    rows = await sql`
      SELECT id
      FROM reservation_requests
      WHERE fingerprint = ${fingerprint}
        AND created_at >= NOW() - (${withinSec} * INTERVAL '1 second')
      LIMIT 1
    `;
  } else {
    throw new Error("Unsupported fingerprint table");
  }
  return Boolean(rows[0]?.id);
}

async function sendOwnerEmail(subject, html) {
  const ownerEmail = normalizeEmail(process.env.OWNER_ALERT_EMAIL);
  if (!ownerEmail) return false;

  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_OWNER_EMAIL_FLOW_ID) {
    const msg91Ok = await sendMsg91Flow(
      process.env.MSG91_OWNER_EMAIL_FLOW_ID,
      { email: ownerEmail },
      {
        subject: String(subject || "").slice(0, 180),
        html: String(html || "").slice(0, 4000),
      }
    );
    if (msg91Ok) return true;
  }

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return false;
  }
  const res = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [ownerEmail],
      subject,
      html,
    }),
  });
  return res.ok;
}

async function sendOwnerWhatsApp(bodyText) {
  const to = normalizePhone(process.env.OWNER_ALERT_WHATSAPP);
  if (!to) return false;

  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_OWNER_WHATSAPP_FLOW_ID) {
    const msg91Ok = await sendMsg91Flow(
      process.env.MSG91_OWNER_WHATSAPP_FLOW_ID,
      { mobiles: msg91MobileFromPhone(to) },
      { body: String(bodyText || "").slice(0, 1500) }
    );
    if (msg91Ok) return true;
  }

  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_WHATSAPP_FROM ||
    !process.env.OWNER_ALERT_WHATSAPP
  ) {
    return false;
  }

  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`;
  const form = new URLSearchParams();
  form.set("From", process.env.TWILIO_WHATSAPP_FROM);
  form.set("To", `whatsapp:${to}`);
  form.set("Body", String(bodyText || "").slice(0, 1500));

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  return res.ok;
}

module.exports = {
  EVENT_CATALOG,
  buildBookingId,
  buildPendingRef,
  buildReceiptSummary,
  checkRateLimit,
  cleanText,
  existsRecentFingerprint,
  fail,
  fetchWithTimeout,
  getHeader,
  getClientIp,
  getPhonePeAccessToken,
  getRateLimitConfig,
  getSql,
  getTicketLimit,
  hashFingerprint,
  isValidEmail,
  json,
  normalizeEmail,
  normalizeBookingPayload,
  normalizePhone,
  optionsResponse,
  parseJson,
  phonePeApiBase,
  qrUrl,
  remainingCapacity,
  sendOwnerEmail,
  sendOwnerWhatsApp,
  sendResendEmail,
  sendTwilioWhatsApp,
  sha256HmacHex,
  toBool,
};
