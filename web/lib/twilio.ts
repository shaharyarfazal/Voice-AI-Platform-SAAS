import "server-only";

// The platform's own Twilio account, used two ways:
// - Selling numbers: workspaces search and buy numbers that go straight onto the platform's Elastic
//   SIP trunk (TWILIO_TRUNK_SID), which already sends calls to our SIP server.
// - Proving ownership of a client's own number: Twilio's caller ID verification phones the number and
//   asks for a code shown in the dashboard. Only someone who can answer that phone can add it, and a
//   verified number can also be the caller ID for outbound calls through the same trunk.

const API = "https://api.twilio.com/2010-04-01";

function account() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? { sid, auth: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } : null;
}

/** Numbers can be verified (needs the account) and sold (also needs the trunk). */
export function twilioStatus(): { verify: boolean; sell: boolean } {
  const verify = account() !== null;
  return { verify, sell: verify && Boolean(process.env.TWILIO_TRUNK_SID) };
}

export class TwilioError extends Error {
  constructor(message: string, readonly code: number | null, readonly status: number) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, string>): Promise<T> {
  const acct = account();
  if (!acct) throw new TwilioError("Twilio isn't set up on this platform yet.", null, 503);
  const url = new URL(`${API}/Accounts/${acct.sid}${path}`);
  let body: URLSearchParams | undefined;
  if (params && method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else if (params) body = new URLSearchParams(params);
  const res = await fetch(url, { method, body, headers: { authorization: acct.auth }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new TwilioError(data.message ?? `Twilio answered ${res.status}`, data.code ?? null, res.status);
  return data as T;
}

export type AvailableNumber = { e164: string; locality: string; region: string };

/** Countries numbers can be bought in without extra regulatory paperwork. */
export const SELL_COUNTRIES = [
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
] as const;

export async function searchNumbers(country: string, opts: { areaCode?: string; contains?: string }): Promise<AvailableNumber[]> {
  const params: Record<string, string> = { VoiceEnabled: "true", PageSize: "20" };
  if (opts.areaCode) params.AreaCode = opts.areaCode;
  if (opts.contains) params.Contains = opts.contains;
  const data = await call<{ available_phone_numbers: { phone_number: string; locality: string | null; region: string | null }[] }>(
    "GET",
    `/AvailablePhoneNumbers/${country}/Local.json`,
    params,
  );
  return data.available_phone_numbers.map((n) => ({ e164: n.phone_number, locality: n.locality ?? "", region: n.region ?? "" }));
}

/** Buys a number and puts it on the platform's SIP trunk. Returns its Twilio SID. */
export async function buyNumber(e164: string, label: string): Promise<string> {
  const data = await call<{ sid: string }>("POST", "/IncomingPhoneNumbers.json", {
    PhoneNumber: e164,
    TrunkSid: process.env.TWILIO_TRUNK_SID!,
    FriendlyName: label.slice(0, 64),
  });
  return data.sid;
}

/** Gives a bought number back to Twilio. Already gone counts as done. */
export async function releaseNumber(sid: string): Promise<void> {
  try {
    await call("DELETE", `/IncomingPhoneNumbers/${sid}.json`);
  } catch (e) {
    if (!(e instanceof TwilioError && e.status === 404)) throw e;
  }
}

async function callerIdSid(e164: string): Promise<string | null> {
  const data = await call<{ outgoing_caller_ids: { sid: string }[] }>("GET", "/OutgoingCallerIds.json", { PhoneNumber: e164 });
  return data.outgoing_caller_ids[0]?.sid ?? null;
}

/** True once whoever answers the number has entered the code. */
export async function isCallerIdVerified(e164: string): Promise<boolean> {
  return (await callerIdSid(e164)) !== null;
}

export async function removeCallerId(e164: string): Promise<void> {
  const sid = await callerIdSid(e164).catch(() => null);
  if (sid) await call("DELETE", `/OutgoingCallerIds/${sid}.json`).catch(() => {});
}

/**
 * Starts verification: Twilio phones `e164` and asks for the returned code on the keypad.
 * An earlier verification (by someone else, or a number removed since) is dropped first, so the
 * person adding the number now has to answer the phone themselves.
 */
export async function startCallerIdVerification(e164: string, label: string): Promise<string> {
  await removeCallerId(e164);
  const data = await call<{ validation_code: string }>("POST", "/OutgoingCallerIds.json", {
    PhoneNumber: e164,
    FriendlyName: label.slice(0, 64),
    CallDelay: "5",
  });
  return data.validation_code;
}
