/*
 * Safaricom Daraja client — the raw HTTP surface of M-Pesa, nothing else.
 *
 *   OAuth token        cached for its lifetime (minus a margin)
 *   STK push           Lipa na M-Pesa Online: prompt a customer's handset for a payment
 *   STK query          the state of a push whose callback has not arrived
 *   C2B register       tell Safaricom where the paybill validation/confirmation callbacks go
 *
 * Configuration is by environment (.env.local.example): MPESA_ENV sandbox|production,
 * MPESA_CONSUMER_KEY/SECRET, MPESA_SHORTCODE (paybill/till), MPESA_PASSKEY (STK),
 * MPESA_CALLBACK_SECRET (a random token every callback URL carries — Daraja does not sign
 * callbacks, so this is how lib/mpesa/index.ts tells Safaricom from a stranger), and APP_URL
 * (public base of the callback URLs). Unset key/secret = mpesaConfigured() is false and the
 * screens say so instead of failing at the gateway.
 */
import 'server-only';

export interface DarajaConfig {
  env: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackSecret: string;
  appUrl: string;
}

export function mpesaConfig(): DarajaConfig | null {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  if (!consumerKey || !consumerSecret || !shortcode) return null;
  return {
    env: process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
    consumerKey, consumerSecret, shortcode,
    passkey: process.env.MPESA_PASSKEY ?? '',
    callbackSecret: process.env.MPESA_CALLBACK_SECRET ?? '',
    appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  };
}
export const mpesaConfigured = (): boolean => mpesaConfig() !== null;

const baseUrl = (c: DarajaConfig): string => (c.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

/** Callback URLs carry the secret in the path, so a callback without it is dropped before parsing. */
export const callbackUrl = (c: DarajaConfig, kind: 'stk' | 'c2b/validation' | 'c2b/confirmation'): string =>
  `${c.appUrl}/api/mpesa/${kind}/${encodeURIComponent(c.callbackSecret || 'unset')}`;

/* ------------------------------------------------------------------ OAuth */

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(c: DarajaConfig): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value;
  const auth = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString('base64');
  const res = await fetch(`${baseUrl(c)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`M-Pesa authentication failed (${res.status})`);
  const body = await res.json() as { access_token: string; expires_in: string };
  token = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in || 3600) - 60) * 1000 };
  return token.value;
}

async function post<T>(c: DarajaConfig, path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${baseUrl(c)}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(c)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = body as { errorMessage?: string; errorCode?: string } | null;
    throw new Error(err?.errorMessage ? `M-Pesa: ${err.errorMessage} (${err.errorCode ?? res.status})` : `M-Pesa request failed (${res.status})`);
  }
  return body as T;
}

/* ------------------------------------------------------------------ STK push */

/** Daraja's timestamp: YYYYMMDDHHmmss in Nairobi time. */
export function darajaTimestamp(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

const stkPassword = (c: DarajaConfig, ts: string): string => Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString('base64');

/** Daraja wants a bare 2547XXXXXXXX. */
export function darajaMsisdn(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

export interface StkPushResult { MerchantRequestID: string; CheckoutRequestID: string; ResponseCode: string; ResponseDescription: string; CustomerMessage: string }

export async function stkPush(c: DarajaConfig, input: { phone: string; amountShillings: number; accountReference: string; description: string }): Promise<StkPushResult> {
  if (!c.passkey) throw new Error('MPESA_PASSKEY is not set — STK push is not configured');
  const ts = darajaTimestamp();
  return post<StkPushResult>(c, '/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: c.shortcode,
    Password: stkPassword(c, ts),
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.max(1, Math.round(input.amountShillings)),
    PartyA: darajaMsisdn(input.phone),
    PartyB: c.shortcode,
    PhoneNumber: darajaMsisdn(input.phone),
    CallBackURL: callbackUrl(c, 'stk'),
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: input.description.slice(0, 13),
  });
}

export interface StkQueryResult { ResponseCode: string; ResponseDescription: string; MerchantRequestID: string; CheckoutRequestID: string; ResultCode: string; ResultDesc: string }

export async function stkQuery(c: DarajaConfig, checkoutRequestId: string): Promise<StkQueryResult> {
  const ts = darajaTimestamp();
  return post<StkQueryResult>(c, '/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: c.shortcode, Password: stkPassword(c, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId,
  });
}

/* ------------------------------------------------------------------ C2B */

export async function registerC2bUrls(c: DarajaConfig): Promise<{ ResponseDescription?: string; OriginatorCoversationID?: string }> {
  return post(c, '/mpesa/c2b/v1/registerurl', {
    ShortCode: c.shortcode,
    ResponseType: 'Completed',
    ConfirmationURL: callbackUrl(c, 'c2b/confirmation'),
    ValidationURL: callbackUrl(c, 'c2b/validation'),
  });
}

/* ------------------------------------------------------------------ callback shapes */

/** The C2B confirmation/validation body Safaricom posts. */
export interface C2bPayload {
  TransactionType?: string;
  TransID: string;
  TransTime: string;
  TransAmount: string | number;
  BusinessShortCode: string;
  BillRefNumber?: string;
  InvoiceNumber?: string;
  OrgAccountBalance?: string;
  ThirdPartyTransID?: string;
  MSISDN: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
}

/** The STK callback body. */
export interface StkCallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: { Name: string; Value?: string | number }[] };
    };
  };
}

export function stkMetadata(p: StkCallbackPayload): { amount: number | null; receipt: string | null; phone: string | null; transactionDate: string | null } {
  const items = p.Body.stkCallback.CallbackMetadata?.Item ?? [];
  const find = (name: string) => items.find((i) => i.Name === name)?.Value;
  const amount = find('Amount');
  const receipt = find('MpesaReceiptNumber');
  const phone = find('PhoneNumber');
  const date = find('TransactionDate');
  return {
    amount: amount == null ? null : Number(amount),
    receipt: receipt == null ? null : String(receipt),
    phone: phone == null ? null : String(phone),
    transactionDate: date == null ? null : String(date),
  };
}
