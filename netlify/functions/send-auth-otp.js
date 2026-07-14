const {
  fail,
  fetchWithTimeout,
  json,
  normalizePhone,
  optionsResponse,
  parseJson,
} = require("./_lib");

function msg91BaseUrl() {
  return String(process.env.MSG91_BASE_URL || "https://control.msg91.com").replace(/\/+$/, "");
}

function msg91Mobile(phone) {
  return String(phone || "").replace(/\D+/g, "");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "POST") return fail("Method not allowed", 405);

  const input = parseJson(event);
  const phone = normalizePhone(String(input.phone || "").trim());
  if (!phone) return fail("Valid mobile number is required", 422);

  const authKey = String(process.env.MSG91_AUTH_KEY || "").trim();
  const templateId = String(process.env.MSG91_OTP_TEMPLATE_ID || "").trim();
  const missing = [];
  if (!authKey) missing.push("MSG91_AUTH_KEY");
  if (!templateId) missing.push("MSG91_OTP_TEMPLATE_ID");
  if (missing.length) {
    return fail(`MSG91 OTP is not configured. Missing: ${missing.join(", ")}`, 500);
  }

  const params = new URLSearchParams();
  params.set("authkey", authKey);
  params.set("mobile", msg91Mobile(phone));
  params.set("template_id", templateId);
  if (process.env.MSG91_OTP_LENGTH) {
    params.set("otp_length", String(process.env.MSG91_OTP_LENGTH));
  }
  if (process.env.MSG91_OTP_EXPIRY_MINUTES) {
    params.set("otp_expiry", String(process.env.MSG91_OTP_EXPIRY_MINUTES));
  }

  const url = `${msg91BaseUrl()}/api/v5/otp?${params.toString()}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      authkey: authKey,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const parts = [];
    if (data.code) parts.push(`code=${data.code}`);
    if (data.message) parts.push(String(data.message));
    if (data.details && Array.isArray(data.details) && data.details.length) {
      const first = data.details[0] || {};
      if (first.field) parts.push(`field=${first.field}`);
      if (first.message) parts.push(String(first.message));
    }
    return fail(
      parts.join(" | ") || "Failed to send OTP",
      Number(data.status || 502)
    );
  }

  const typeText = String(data.type || "").toLowerCase();
  const messageText = String(data.message || "").toLowerCase();
  if (
    typeText.includes("error") ||
    typeText.includes("fail") ||
    messageText.includes("error") ||
    messageText.includes("invalid")
  ) {
    return fail(String(data.message || "MSG91 did not accept OTP request"), 502);
  }

  return json({
    ok: true,
    phone,
    status: String(data.type || "success"),
    requestId: String(data.request_id || data.requestId || ""),
  });
};
