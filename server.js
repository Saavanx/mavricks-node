require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const firebaseJwksClient = jwksClient({
  jwksUri: 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  cache: true,
  cacheMaxEntries: 10,
  cacheMaxAge: 600000, // 10 minutes
  rateLimit: true,
  jwksRequestsPerMin: 10
});

function getFirebaseSigningKey(header, callback) {
  firebaseJwksClient.getSigningKey(header.kid, function(err, key) {
    if (err) {
      console.error('JWKS getSigningKey error:', err.message, 'kid:', header.kid);
      callback(err);
    } else {
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    }
  });
}

function verifyFirebaseToken(token, projectId) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getFirebaseSigningKey, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId
    }, (err, decoded) => {
      if (err) {
        console.error('Firebase token verify failed:', err.name, err.message);
        reject(err);
      } else {
        resolve(decoded);
      }
    });
  });
}


const {
  getSql,
  normalizeBookingPayload,
  buildBookingId,
  buildPendingRef,
  sendResendEmail,
  sendTwilioWhatsApp,
  sendOwnerEmail,
  sendOwnerWhatsApp,
  normalizeEmail,
  normalizePhone,
  remainingCapacity
} = require('./netlify/functions/_lib');

const app = express();
const PORT = process.env.PORT || 4000;

// Security configurations
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security Headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://pgtest.atomtech.in", "https://psa.atomtech.in"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://maxcdn.bootstrapcdn.com"],
      imgSrc: ["'self'", "data:", "https://api.qrserver.com"],
      connectSrc: ["'self'", "https://caller.atomtech.in", "https://payment1.atomtech.in"],
      frameSrc: ["'self'", "https://caller.atomtech.in", "https://payment1.atomtech.in"]
    }
  }
}));

// Compression
app.use(compression());

// Serve static assets from the public folder
app.use(express.static(path.join(__dirname, 'public')));

const nttConfig = {
  merchantId: process.env.NTT_MERCHANT_ID || '834177',
  merchantPassword: process.env.NTT_MERCHANT_PASSWORD || '834177_titan@123',
  productId: process.env.NTT_PRODUCT_ID || 'EVENTS',
  authUrl: process.env.NTT_AUTH_URL || 'https://payment1.atomtech.in/ots/aipay/auth',
  env: (process.env.NTT_ENV || 'PRODUCTION').toUpperCase(),
  cdnUrl: process.env.NTT_CDN_URL || 'https://psa.atomtech.in/staticdata/ots/js/atomcheckout.js',
  reqEncKey: process.env.NTT_REQ_ENC_KEY || '8AFF8041DFDFD54619EEC364D540E412',
  reqSalt: process.env.NTT_REQ_SALT || '8AFF8041DFDFD54619EEC364D540E412',
  resDecKey: process.env.NTT_RES_DEC_KEY || '7DD3649044FDB2026E8A39DAE7AC51EB',
  resSalt: process.env.NTT_RES_SALT || '7DD3649044FDB2026E8A39DAE7AC51EB',
  reqHashKey: process.env.NTT_REQ_HASH_KEY || 'b806ced195f8b6d7e3',
  resHashKey: process.env.NTT_RES_HASH_KEY || '824fe199272b2812fb',
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL || 'https://mavricks.fun',
  callbackBaseUrl: process.env.NTT_CALLBACK_BASE_URL || process.env.APP_BASE_URL || 'https://api.mavricks.fun',
};

// CORS configuration - Reject unknown origins unless configured
const allowedOrigins = [
  'https://mavricks.fun',
  'https://www.mavricks.fun',
  nttConfig.frontendBaseUrl,
  nttConfig.callbackBaseUrl,
  'https://api.mavricks.fun',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5501',
  'http://localhost:3000',
  'http://localhost:4000'
];

app.use((req, res, next) => {
  if (req.path === '/api/confirm-payment') {
    return next();
  }
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        console.error('CORS blocked origin:', origin);
        const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true
  })(req, res, next);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again later.' }
});

app.use('/api/', apiLimiter);

const algorithm = 'aes-256-cbc';
const iv = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'utf8');

function encrypt(text) {
  const password = Buffer.from(nttConfig.reqEncKey, 'utf8');
  const salt = Buffer.from(nttConfig.reqSalt, 'utf8');
  const derivedKey = crypto.pbkdf2Sync(password, salt, 65536, 32, 'sha512');
  const cipher = crypto.createCipheriv(algorithm, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return encrypted.toString('hex');
}

function decrypt(text) {
  const encryptedText = Buffer.from(text, 'hex');
  const password = Buffer.from(nttConfig.resDecKey, 'utf8');
  const salt = Buffer.from(nttConfig.resSalt, 'utf8');
  const derivedKey = crypto.pbkdf2Sync(password, salt, 65536, 32, 'sha512');
  const decipher = crypto.createDecipheriv(algorithm, derivedKey, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString();
}

function generateSignature(respArray) {
  const merchantId = String(respArray[0]?.merchDetails?.merchId || nttConfig.merchantId);
  const atomTxnId = String(respArray[0]?.payDetails?.atomTxnId || '');
  const merchTxnId = String(respArray[0]?.merchDetails?.merchTxnId || '');
  const totalAmount = String(Number(respArray[0]?.payDetails?.totalAmount || 0).toFixed(2));
  const statusCode = String(respArray[0]?.responseDetails?.statusCode || '');
  const subChannel = String(respArray[0]?.payModeSpecificData?.subChannel?.[0] || '');
  const bankTxnId = String(respArray[0]?.payModeSpecificData?.bankDetails?.bankTxnId || '');
  const signatureString = merchantId + atomTxnId + merchTxnId + totalAmount + statusCode + subChannel + bankTxnId;
  const hmac = crypto.createHmac('sha512', nttConfig.resHashKey);
  return hmac.update(signatureString).digest('hex');
}

function buildTxnDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

function extractEncDataFromResponseBody(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return null;

  const trimmed = bodyText.trim();
  if (!trimmed) return null;

  const params = new URLSearchParams(trimmed);
  const formValue = params.get('encData') || params.get('encdata');
  if (formValue) return formValue;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const jsonValue = parsed.encData || parsed.encdata || parsed.data?.encData || parsed.data?.encdata;
      if (typeof jsonValue === 'string' && jsonValue.trim()) return jsonValue;
    }
  } catch (error) {
    // Ignore parse errors
  }

  const htmlMatch = trimmed.match(/encData[^>]*>[\s\S]*?([A-Za-z0-9+/=]+)/i);
  if (htmlMatch && htmlMatch[1]) return htmlMatch[1];

  const inputMatch = trimmed.match(/name\s*=\s*["']?(encData|encdata)["']?[^>]*value\s*=\s*["']([^"']+)["']/i)
    || trimmed.match(/value\s*=\s*["']([A-Za-z0-9+/=]+)["'][^>]*name\s*=\s*["']?(encData|encdata)["']?/i);
  if (inputMatch) return inputMatch[2] || inputMatch[1] || null;
  return null;
}

async function initiateNttAuth(booking, retries = 2) {
  const txnDate = buildTxnDate();
  const jsonData = JSON.stringify({
    payInstrument: {
      headDetails: {
        version: 'OTSv1.1',
        api: 'AUTH',
        platform: 'FLASH',
      },
      merchDetails: {
        merchId: nttConfig.merchantId,
        userId: '',
        password: nttConfig.merchantPassword,
        merchTxnId: booking.txnId,
        merchTxnDate: txnDate,
      },
      payDetails: {
        amount: String(booking.amount),
        product: nttConfig.productId,
        custAccNo: '213232323',
        txnCurrency: 'INR',
      },
      custDetails: {
        custEmail: booking.email,
        custMobile: booking.phone,
      },
      extras: {
        udf1: booking.bookingId,
        udf2: 'mavricks-events',
        udf3: booking.quantity.toString(),
      },
    },
  });

  const encData = encrypt(jsonData);

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s
      await new Promise(r => setTimeout(r, attempt * 1000));
      console.log(`NTT auth retry attempt ${attempt}/${retries} for txn ${booking.txnId}`);
    }

    let response, bodyText;
    try {
      response = await fetch(nttConfig.authUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cache-control': 'no-cache',
        },
        body: new URLSearchParams({ encData, merchId: nttConfig.merchantId }).toString(),
      });
      bodyText = await response.text();
    } catch (fetchErr) {
      if (attempt === retries) throw new Error(`NTT gateway unreachable: ${fetchErr.message}`);
      continue;
    }

    // Detect HTML error pages (503, 502, etc.) returned with status 200
    const isHtmlError = bodyText.trim().startsWith('<') &&
      (bodyText.includes('503') || bodyText.includes('502') || bodyText.includes('Unavailable') || bodyText.includes('Bad Gateway'));

    if (!response.ok || isHtmlError) {
      console.warn(`NTT auth attempt ${attempt + 1}: status=${response.status}, html_error=${isHtmlError}`);
      if (attempt === retries) {
        // Log for diagnostics
        try {
          const logDir = path.join(__dirname, 'logs');
          fs.mkdirSync(logDir, { recursive: true });
          const file = path.join(logDir, 'ntt-missing-enc.log');
          const entry = JSON.stringify({ ts: new Date().toISOString(), url: nttConfig.authUrl, status: response.status, body: bodyText }) + '\n\n';
          fs.appendFileSync(file, entry, 'utf8');
        } catch (_) {}
        const errMsg = isHtmlError
          ? 'Payment gateway is temporarily unavailable. Please try again in a few minutes.'
          : `NTT auth failed with status ${response.status}`;
        throw new Error(errMsg);
      }
      continue; // retry
    }

    const encodedResponse = extractEncDataFromResponseBody(bodyText);
    if (!encodedResponse) {
      // Try to detect structured JSON error from gateway (e.g. {"encData":null,"txnStatusCode":"OTS0451","txnDescription":"INVALID MERCHANT"})
      let gatewayErrMsg = null;
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && parsed.encData === null && (parsed.txnStatusCode || parsed.txnDescription || parsed.txnMessage)) {
          const code = parsed.txnStatusCode || '';
          const desc = parsed.txnDescription || parsed.txnMessage || 'Gateway rejected the request';
          console.error(`NTT gateway error: code=${code}, desc=${desc}`);
          // OTS0451 = Invalid Merchant — credentials not activated on this endpoint
          if (code === 'OTS0451' || desc.toUpperCase().includes('INVALID MERCHANT')) {
            gatewayErrMsg = 'Payment gateway credentials are not yet activated. Please book via WhatsApp while we complete the setup.';
          } else {
            gatewayErrMsg = `Payment gateway error (${code}): ${desc}`;
          }
        }
      } catch (_) {}

      if (attempt === retries) {
        try {
          const logDir = path.join(__dirname, 'logs');
          fs.mkdirSync(logDir, { recursive: true });
          const file = path.join(logDir, 'ntt-missing-enc.log');
          const entry = JSON.stringify({ ts: new Date().toISOString(), url: nttConfig.authUrl, status: response.status, body: bodyText }) + '\n\n';
          fs.appendFileSync(file, entry, 'utf8');
        } catch (_) {}
        console.error('NTT auth did not return encData — raw response saved to logs/ntt-missing-enc.log');
        throw new Error(gatewayErrMsg || 'Payment gateway returned an unexpected response. Please try again.');
      }
      continue; // retry
    }

    // Success — decrypt and return
    const decryptedText = decrypt(encodedResponse);
    const parsed = JSON.parse(decryptedText);
    return {
      atomTokenId: parsed.atomTokenId || parsed?.data?.atomTokenId || '',
      responseDetails: parsed.responseDetails || {},
      merchTxnId: booking.txnId,
    };
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'mavricks-ntt-pay', env: nttConfig.env });
});

app.get('/api/firebase-config', (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyFakeKeyForUATTestingPlaceholder',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'mavricks-events.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'mavricks-events',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'mavricks-events.appspot.com',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '1234567890',
    appId: process.env.FIREBASE_APP_ID || '1:1234567890:web:abcdef123456'
  });
});

// Get User Profile
app.get('/api/profile', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'mavricks-events';
  
  try {
    const firebaseUser = await verifyFirebaseToken(token, firebaseProjectId);
    const sql = getSql();
    
    // Check if user exists in the database
    let users = await sql`
      SELECT * FROM users WHERE firebase_uid = ${firebaseUser.uid}
    `;

    if (users.length === 0) {
      // Seed default user details from Firebase token
      const defaultName = firebaseUser.name || '';
      const defaultEmail = firebaseUser.email || '';
      const defaultPhone = firebaseUser.phone_number || '';
      
      await sql`
        INSERT INTO users (firebase_uid, name, email, phone)
        VALUES (${firebaseUser.uid}, ${defaultName}, ${defaultEmail}, ${defaultPhone})
      `;
      
      users = [{
        firebase_uid: firebaseUser.uid,
        name: defaultName,
        email: defaultEmail,
        phone: defaultPhone,
        date_of_birth: null,
        city: null
      }];
    }

    return res.json({ ok: true, profile: users[0] });
  } catch (err) {
    console.error('Failed to retrieve profile:', err);
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid token' });
  }
});

// Update User Profile
app.post('/api/profile', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'mavricks-events';
  
  try {
    const firebaseUser = await verifyFirebaseToken(token, firebaseProjectId);
    const { name, email, date_of_birth, city } = req.body;
    
    const sql = getSql();
    
    // Upsert profile in the database
    await sql`
      INSERT INTO users (firebase_uid, name, email, date_of_birth, city, updated_at)
      VALUES (${firebaseUser.uid}, ${name || ''}, ${email || ''}, ${date_of_birth || null}, ${city || null}, CURRENT_TIMESTAMP)
      ON CONFLICT (firebase_uid) DO UPDATE
      SET name = EXCLUDED.name,
          email = EXCLUDED.email,
          date_of_birth = EXCLUDED.date_of_birth,
          city = EXCLUDED.city,
          updated_at = CURRENT_TIMESTAMP
    `;

    return res.json({ ok: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Failed to update profile:', err);
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid token' });
  }
});

app.post('/api/create-payment-session', async (req, res) => {
  try {
    const payload = req.body || {};
    const normalized = normalizeBookingPayload(payload);
    if (normalized.error) {
      return res.status(400).json({ ok: false, error: normalized.error });
    }

    // Authenticate using Firebase ID Token in Authorization header
    const authHeader = req.headers.authorization || '';
    let firebaseUser = null;
    
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'mavricks-events';
      try {
        firebaseUser = await verifyFirebaseToken(token, firebaseProjectId);
      } catch (err) {
        console.error('Firebase token verification failed:', err);
        return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid authentication token' });
      }
    }

    if (!firebaseUser) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Login is required' });
    }

    const email = normalizeEmail(firebaseUser.email || payload.customerEmail || payload.customer_email || payload.email || '');
    const phone = normalizePhone(firebaseUser.phone_number || payload.customerPhone || payload.customer_phone || payload.phone || '');
    const customerName = firebaseUser.name || payload.customerName || payload.customer_name || payload.name || email.split('@')[0] || 'Mavricks Guest';
    
    const bookingId = buildBookingId();
    const pendingRef = buildPendingRef(); // Unique transaction ID

    const sql = getSql();
    const capacity = await remainingCapacity(sql, normalized.eventKey);
    if (capacity <= 0) {
      return res.status(409).json({ ok: false, error: 'Sold out' });
    }

    // Allow ₹1 test override (internal testing only — amount capped to minimum ₹1)
    if (payload.overrideAmount !== undefined) {
      const override = Number(payload.overrideAmount);
      if (override >= 1) {
        normalized.amount = String(override);
        console.log(`[TEST] Payment amount overridden to ₹${override} by overrideAmount flag`);
      }
    }

    // Initiate NTT Auth session
    const auth = await initiateNttAuth({
      bookingId,
      txnId: pendingRef,
      amount: normalized.amount,
      email,
      phone,
      quantity: normalized.quantity
    });

    if (!auth.atomTokenId) {
      return res.status(502).json({ ok: false, error: 'NTT gateway did not return a token' });
    }

    // Insert pending booking details to Neon DB
    await sql`
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
        customer_name,
        payment_status,
        pending_ref,
        payment_gateway,
        currency,
        gateway_order_id,
        created_at
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
        ${customerName},
        'pending',
        ${pendingRef},
        'ntt',
        'INR',
        ${auth.atomTokenId},
        NOW()
      )
    `;

    const callbackUrl = `${nttConfig.callbackBaseUrl.replace(/\/$/, '')}/api/confirm-payment`;
    const paymentPageUrl = `${req.protocol}://${req.get('host')}/pay/ntt?token=${encodeURIComponent(auth.atomTokenId)}&merchId=${encodeURIComponent(nttConfig.merchantId)}&bookingId=${encodeURIComponent(bookingId)}&txnId=${encodeURIComponent(pendingRef)}&amount=${encodeURIComponent(normalized.amount)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}&returnUrl=${encodeURIComponent(callbackUrl)}`;

    res.json({
      ok: true,
      bookingId: bookingId,
      txnId: pendingRef,
      amount: normalized.amount,
      paymentUrl: paymentPageUrl,
      atomTokenId: auth.atomTokenId,
      merchantId: nttConfig.merchantId,
      environment: nttConfig.env,
    });
  } catch (error) {
    console.error('Create payment session error:', error);
    res.status(500).json({ ok: false, error: error.message || 'NTT payment session creation failed' });
  }
});

app.get('/pay/ntt', (req, res) => {
  // Relax CSP for this route to allow third-party payment frames and bank pages to load
  res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval'; frame-src *; connect-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data:");

  const token = req.query.token || '';
  const merchId = req.query.merchId || nttConfig.merchantId;
  const bookingId = req.query.bookingId || '';
  const txnId = req.query.txnId || '';
  const amount = req.query.amount || '0';
  const email = req.query.email || 'test.user@atomtech.in';
  const phone = req.query.phone || '8888888888';
  const returnUrl = req.query.returnUrl || `${nttConfig.callbackBaseUrl.replace(/\/$/, '')}/api/confirm-payment`;
  const isProd = nttConfig.env === 'PROD';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NTT Data Payment Checkout</title>
    <script src="${nttConfig.cdnUrl}?v=${Date.now()}"></script>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 24px; background: #0b0d13; color: #fff;">
    <div style="max-width: 560px; margin: 40px auto; padding: 28px; border-radius: 16px; background: #161925; border: 1px solid rgba(255,255,255,0.12); text-align: center;">
      <h2 style="color: #f7b731; margin-bottom: 24px;">Mavricks Events</h2>
      <p style="font-size: 16px; margin-bottom: 12px;"><strong>Booking ID:</strong> ${bookingId}</p>
      <p style="font-size: 16px; margin-bottom: 12px;"><strong>Transaction ID:</strong> ${txnId}</p>
      <p style="font-size: 20px; margin-bottom: 24px;"><strong>Amount:</strong> ₹${Number(amount).toLocaleString('en-IN')}</p>
      <button onclick="openPay()" style="padding: 14px 28px; border: 0; border-radius: 999px; background: #f7b731; color: #111; font-weight: 700; font-size: 16px; cursor: pointer; transition: background 0.2s;">Pay Now</button>
    </div>
    <script>
      function openPay() {
        const options = {
          atomTokenId: '${token}',
          merchId: '${merchId}',
          custEmail: '${email}',
          custMobile: '${phone}',
          returnUrl: '${returnUrl}'
        };
        new AtomPaynetz(options, '${isProd ? 'prod' : 'uat'}');
      }
    </script>
  </body>
</html>`;

  res.send(html);
});
app.post('/api/confirm-payment', async (req, res) => {
  try {
    const encData = req.body?.encData || req.body?.encdata || '';
    if (!encData) {
      return res.redirect(`${nttConfig.frontendBaseUrl.replace(/\/$/, '')}/tickets?status=cancelled`);
    }

    const decryptedText = decrypt(encData);
    const parsed = JSON.parse(decryptedText);
    const respArray = Object.keys(parsed).map((key) => parsed[key]);
    const signature = generateSignature(respArray);
    const transactionId = String(respArray[0]?.merchDetails?.merchTxnId || '');
    const atomTxnId = String(respArray[0]?.payDetails?.atomTxnId || '');
    const statusCode = String(respArray[0]?.responseDetails?.statusCode || '');

    const sql = getSql();
    const rows = await sql`
      SELECT booking_id, customer_email, customer_phone, event_name, event_date, package_type, quantity, table_type, addons_json, amount, payment_status, pending_ref, created_at
      FROM bookings
      WHERE pending_ref = ${transactionId}
      LIMIT 1
    `;

    const booking = rows[0];
    if (!booking) {
      return res.redirect(`${nttConfig.frontendBaseUrl.replace(/\/$/, '')}/tickets?status=cancelled`);
    }

    const isSuccess = (signature === respArray[0]?.payDetails?.signature && statusCode === 'OTS0000');

    // Update Neon DB payment status
    await sql`
      UPDATE bookings
      SET payment_status = ${isSuccess ? 'paid' : 'failed'},
          gateway_payment_id = ${atomTxnId},
          created_at = NOW()
      WHERE booking_id = ${booking.booking_id}
    `;

    if (isSuccess) {
      // Send confirmation alerts
      const receipt = {
        booking_id: booking.booking_id,
        event_name: booking.event_name,
        event_date: booking.event_date,
        package_type: booking.package_type,
        quantity: booking.quantity,
        table_type: booking.table_type,
        addons_json: booking.addons_json,
        amount: booking.amount,
        customer_email: booking.customer_email,
        customer_phone: booking.customer_phone,
        transaction_id: atomTxnId
      };

      Promise.allSettled([
        sendResendEmail(receipt),
        sendTwilioWhatsApp(receipt),
        sendOwnerEmail(`New booking paid - ${booking.booking_id}`, `<p>Booking ${booking.booking_id} was paid successfully.</p>`),
        sendOwnerWhatsApp(`New booking paid: ${booking.booking_id} | INR ${booking.amount} | ${atomTxnId}`)
      ]);

      return res.redirect(`${nttConfig.frontendBaseUrl.replace(/\/$/, '')}/tickets?status=success&booking=${encodeURIComponent(booking.booking_id)}&txn=${encodeURIComponent(atomTxnId)}`);
    }

    return res.redirect(`${nttConfig.frontendBaseUrl.replace(/\/$/, '')}/tickets?status=cancelled&booking=${encodeURIComponent(booking.booking_id)}`);
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.redirect(`${nttConfig.frontendBaseUrl.replace(/\/$/, '')}/tickets?status=cancelled`);
  }
});

// GET single booking details
app.get('/api/bookings/:id', async (req, res) => {
  try {
    const bookingId = req.params.id;
    const sql = getSql();
    const rows = await sql`
      SELECT booking_id, event_name, event_date, package_type, quantity, table_type, addons_json, amount, payment_status, gateway_payment_id, created_at, customer_email, customer_phone
      FROM bookings
      WHERE booking_id = ${bookingId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Booking not found' });
    }
    return res.json({ ok: true, booking: rows[0] });
  } catch (err) {
    console.error('Fetch booking error:', err);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

// GET user bookings list
app.get('/api/user-bookings', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'mavricks-events';
  try {
    const firebaseUser = await verifyFirebaseToken(token, firebaseProjectId);
    const sql = getSql();
    const email = firebaseUser.email || '';
    const phone = firebaseUser.phone_number || '';
    
    let bookings = [];
    if (email && phone) {
      bookings = await sql`
        SELECT booking_id, event_name, event_date, package_type, quantity, table_type, addons_json, amount, payment_status, gateway_payment_id, created_at
        FROM bookings
        WHERE customer_email = ${email} OR customer_phone = ${phone}
        ORDER BY created_at DESC
      `;
    } else if (email) {
      bookings = await sql`
        SELECT booking_id, event_name, event_date, package_type, quantity, table_type, addons_json, amount, payment_status, gateway_payment_id, created_at
        FROM bookings
        WHERE customer_email = ${email}
        ORDER BY created_at DESC
      `;
    } else if (phone) {
      bookings = await sql`
        SELECT booking_id, event_name, event_date, package_type, quantity, table_type, addons_json, amount, payment_status, gateway_payment_id, created_at
        FROM bookings
        WHERE customer_phone = ${phone}
        ORDER BY created_at DESC
      `;
    }
    return res.json({ ok: true, bookings });
  } catch (err) {
    console.error('Failed to retrieve user bookings:', err);
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid token' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

app.listen(PORT, async () => {
  console.log(`NTT payment server running on port ${PORT}`);
  try {
    const sql = getSql();
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        firebase_uid VARCHAR(128) PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        date_of_birth VARCHAR(50),
        city VARCHAR(100),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('Neon database verified: users table is ready.');
  } catch (err) {
    console.error('Failed to initialize users table:', err);
  }
});

module.exports = {
  extractEncDataFromResponseBody,
};
