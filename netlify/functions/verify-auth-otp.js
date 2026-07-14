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
  const otp = String(input.otp || "").trim();

  if (!phone) return fail("Valid mobile number is required", 422);
  if (!/^\d{4,8}$/.test(otp)) return fail("Valid OTP is required", 422);

  const authKey = String(process.env.MSG91_AUTH_KEY || "").trim();
  const missing = [];
  if (!authKey) missing.push("MSG91_AUTH_KEY");
  if (missing.length) {
    return fail(`MSG91 OTP is not configured. Missing: ${missing.join(", ")}`, 500);
  }

  const params = new URLSearchParams();
  params.set("authkey", authKey);
  params.set("mobile", msg91Mobile(phone));
  params.set("otp", otp);
  const url = `${msg91BaseUrl()}/api/v5/otp/verify?${params.toString()}`;
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
      parts.join(" | ") || "OTP verification failed",
      Number(data.status || 502)
    );
  }

  const text = `${String(data.type || "")} ${String(data.message || "")}`.toLowerCase();
  if (text.includes("error") || text.includes("invalid")) {
    return fail("Invalid or expired OTP", 401);
  }

  return json({
    ok: true,
    verified: true,
    phone,
  });
};
