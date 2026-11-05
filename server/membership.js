// A person's membership card: the number printed on it and the date they became a
// member. Both come from what the people table already holds, so nothing is stored.
//
// The number is worked out from people.webauthn_user_id: 32 random bytes, made when
// the person is added, that never change, not even when their passkeys are taken back
// and they set up a new one. So the card stays the same card. Never from people.id,
// which only counts members.
//
// It is something printed on a card, not a key: nothing in the app accepts it, and no
// screen asks for it. Only the person themselves (their account, and the page where
// they make their passkey) and the admin are ever sent it.
import crypto from 'node:crypto';

// The check digit that makes the whole number pass the Luhn check: it catches any one
// wrong digit and most swaps of two digits side by side. Counting from the right of
// the payload, every other digit is doubled, starting with the last.
export function luhnDigit(payload) {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    let d = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

export const luhnValid = (digits) => /^\d{2,}$/.test(digits) && luhnDigit(digits.slice(0, -1)) === digits.slice(-1);

// 11 digits: SHA-256 of the id's 32 bytes (decoded, not its text), the first 8 bytes of
// that as a big-endian number, the last 10 digits of it (leading zeros kept), then the
// check digit. Never 16 digits, so it can't be taken for a bank card.
export function membershipNumber(webauthnUserId) {
  const bytes = Buffer.from(webauthnUserId, 'base64url');
  const hash = crypto.createHash('sha256').update(bytes).digest();
  const ten = (hash.readBigUInt64BE(0) % 10_000_000_000n).toString().padStart(10, '0');
  return ten + luhnDigit(ten);
}

// What the person's own pages and the admin's person page are sent: the number, and
// when they were added (people.created_at), which the card shows as a month and year.
export const membershipOf = (person) => ({ number: membershipNumber(person.webauthn_user_id), since: person.created_at });
