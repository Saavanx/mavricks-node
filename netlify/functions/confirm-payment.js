const { json, fail, parseJson, getSql, normalizeEmail, normalizePhone, buildReceiptSummary, sendResendEmail, sendTwilioWhatsApp, sendOwnerEmail, sendOwnerWhatsApp } = require('./_lib');

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);

  const body = parseJson(event);
  const payload = body?.data || body || {};
  const paymentRef = payload?.merchantTransactionId || payload?.merchantTransactionId || payload?.transactionId || payload?.paymentRef || '';
  const status = String(payload?.code || payload?.status || 'SUCCESS').toUpperCase();
  const transactionId = payload?.transactionId || payload?.txnId || payload?.merchantTransactionId || '';
  const amount = Number(payload?.amount || payload?.totalAmount || 0) / 100;

  const sql = getSql();

  try {
    const rows = await sql`
      SELECT booking_id, customer_email, customer_phone, event_name, event_date, package_type, quantity, table_type, addons_json, amount, payment_status, payment_ref, transaction_id, created_at
      FROM bookings
      WHERE payment_ref = ${paymentRef}
      LIMIT 1
    `;

    const booking = rows[0];
    if (!booking) return fail('Booking not found', 404);

    const receipt = buildReceiptSummary({
      booking_id: booking.booking_id,
      amount: booking.amount || amount || 0,
      payment_status: status === 'SUCCESS' ? 'paid' : 'failed',
      transaction_id: transactionId || booking.transaction_id || paymentRef,
      created_at: booking.created_at,
    });

    await sql`
      UPDATE bookings
      SET payment_status = ${status === 'SUCCESS' ? 'paid' : 'failed'},
          transaction_id = ${receipt.transactionId},
          status_message = ${status},
          updated_at = NOW()
      WHERE booking_id = ${booking.booking_id}
    `;

    if (status === 'SUCCESS') {
      await Promise.allSettled([
        sendResendEmail({ ...booking, amount: booking.amount || amount || 0, payment_status: 'paid', transaction_id: receipt.transactionId, created_at: booking.created_at }),
        sendTwilioWhatsApp({ ...booking, amount: booking.amount || amount || 0, payment_status: 'paid', transaction_id: receipt.transactionId, created_at: booking.created_at }),
        sendOwnerEmail(`New booking paid - ${booking.booking_id}`, `<p>Booking ${booking.booking_id} was paid successfully.</p><p>Receipt: ${JSON.stringify(receipt)}</p>`),
        sendOwnerWhatsApp(`New booking paid: ${booking.booking_id} | ${receipt.amount} | ${receipt.transactionId}`),
      ]);
    }

    return json({ ok: true, receipt });
  } catch (error) {
    return fail(error.message || 'Unable to confirm payment', 500);
  }
};
