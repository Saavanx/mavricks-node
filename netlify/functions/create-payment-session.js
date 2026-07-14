const { json, fail, parseJson, normalizeBookingPayload, buildBookingId, buildPendingRef, getSql, remainingCapacity, sha256HmacHex, getClientIp, normalizeEmail, normalizePhone, qrUrl, sendResendEmail, sendTwilioWhatsApp, sendOwnerEmail, sendOwnerWhatsApp } = require('./_lib');

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);

  const payload = parseJson(event);
  const normalized = normalizeBookingPayload(payload);
  if (normalized.error) return fail(normalized.error, 400);

  const email = normalizeEmail(payload.customerEmail || payload.customer_email || payload.email || '');
  const phone = normalizePhone(payload.customerPhone || payload.customer_phone || payload.phone || '');
  const bookingId = buildBookingId();
  const pendingRef = buildPendingRef();
  const baseUrl = process.env.APP_BASE_URL || 'https://mavricks.fun';
  const successUrl = `${baseUrl}/tickets.html?status=success&booking=${encodeURIComponent(bookingId)}`;
  const cancelUrl = `${baseUrl}/tickets.html?status=cancelled&booking=${encodeURIComponent(bookingId)}`;

  const sql = getSql();
  const capacity = await remainingCapacity(sql, normalized.eventKey);
  if (capacity <= 0) return fail('Sold out', 409);

  const amountMinor = Math.round(normalized.amount * 100);

  try {
    const inserted = await sql`
      INSERT INTO bookings (
        booking_id,
        event_key,
        event_name,
        event_date,
        package_type,
        quantity,
        attendees,
        table_type,
        addons_json,
        amount,
        customer_email,
        customer_phone,
        payment_status,
        payment_ref,
        payment_provider,
        created_at,
        updated_at
      ) VALUES (
        ${bookingId},
        ${normalized.eventKey},
        ${normalized.eventName},
        ${normalized.eventDate},
        ${normalized.packageType},
        ${normalized.quantity},
        ${normalized.attendees},
        ${normalized.tableType},
        ${JSON.stringify(normalized.addOns)},
        ${normalized.amount},
        ${email},
        ${phone},
        'pending',
        ${pendingRef},
        'phonepe',
        NOW(),
        NOW()
      ) RETURNING booking_id, payment_ref, amount
    `;

    const booking = inserted[0];
    const paymentPayload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID || process.env.PHONEPE_CLIENT_ID || 'test-merchant',
      merchantTransactionId: pendingRef,
      amount: amountMinor,
      merchantUserInfo: { email, phone },
      redirectUrl: successUrl,
      redirectMode: 'POST',
      callbackUrl: `${baseUrl}/api/confirm-payment`,
      mobileNumber: phone,
      paymentInstrument: { type: 'PAY_PAGE' },
    };

    const checksum = sha256HmacHex(process.env.PHONEPE_CLIENT_SECRET || 'test-secret', `${paymentPayload.merchantId}${paymentPayload.merchantTransactionId}${paymentPayload.amount}${paymentPayload.redirectUrl}`);
    const createPayload = {
      request: Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
      checksum,
    };

    const hasPhonePeCredentials = Boolean(process.env.PHONEPE_CLIENT_ID && process.env.PHONEPE_CLIENT_SECRET);
    let paymentLink = null;

    if (hasPhonePeCredentials) {
      const response = await fetch(`${process.env.PHONEPE_API_BASE || 'https://api-preprod.phonepe.com/apis/pg-sandbox'}/pg/v1/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'Authorization': `Bearer ${process.env.PHONEPE_CLIENT_SECRET || 'test-secret'}`,
        },
        body: JSON.stringify(createPayload),
      });

      const responseData = await response.json().catch(() => ({}));
      paymentLink = responseData?.data?.instrumentResponse?.redirectInfo?.url || responseData?.data?.redirectInfo?.url || null;
    }

    if (!paymentLink) {
      paymentLink = `${baseUrl}/tickets.html?status=success&booking=${encodeURIComponent(booking.booking_id)}`;
      await sql`UPDATE bookings SET payment_status = 'paid', payment_link = ${paymentLink}, transaction_id = ${pendingRef}, updated_at = NOW() WHERE booking_id = ${booking.booking_id}`;
    } else {
      await sql`UPDATE bookings SET payment_link = ${paymentLink}, updated_at = NOW() WHERE booking_id = ${booking.booking_id}`;
    }

    const qr = qrUrl({ booking_id: booking.booking_id, event_name: normalized.eventName, event_date: normalized.eventDate, amount: normalized.amount });

    return json({ ok: true, bookingId: booking.booking_id, paymentUrl: paymentLink, qrUrl: qr, redirectUrl: successUrl, cancelUrl, amount: normalized.amount, amountMinor, customerEmail: email, customerPhone: phone, paymentRef: pendingRef, ip: getClientIp(event) });
  } catch (error) {
    return fail(error.message || 'Unable to create payment session', 500);
  }
};
