// Passkeys in the browser: a thin layer over @simplewebauthn/browser, plus the
// words people see when something goes wrong. The server decides everything; this
// only asks the phone or computer to create or use a passkey.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

// In-app browsers (Facebook, Instagram, LinkedIn, Line, Snapchat, TikTok, the
// Google app, WeChat, and the plain web view other Android apps show pages in, which
// says "; wv)") often expose the passkey API and then fail. Best effort, by user
// agent. One that isn't listed is offered Copy link once it has refused
// (anotherBrowserMayHelp).
const IN_APP_BROWSER = /FBAN|FBAV|Instagram|LinkedInApp|Line\/|Snapchat|TikTok|musical_ly|GSA\/|MicroMessenger|; wv\)/;

export function supportsPasskeys() {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential !== 'function') return false;
  return !IN_APP_BROWSER.test(navigator.userAgent || '');
}

// Both must be called straight from a click handler, before anything is awaited:
// Safari only lets a page ask for a passkey in response to a tap.
export const createPasskey = (optionsJSON) => startRegistration({ optionsJSON });
export const signInWithPasskey = (optionsJSON) => startAuthentication({ optionsJSON });

// Challenges last five minutes on the server. Fetch new options before then, and
// when the page comes back into view with options that are getting old.
const REFRESH_AFTER = 4.5 * 60 * 1000;
const STALE_AFTER = 4 * 60 * 1000;

// Options for one ceremony, fetched before the tap and kept fresh. `data` is the
// whole response; `error` the last failure to fetch it. Call `reload({ spent: true })`
// after the server has taken the challenge (any finish, or ceremony-expired):
// `spent` stays true until fresh options arrive, so nobody signs the old challenge.
export function useCeremonyOptions(fetchOptions, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, spent: false });
  const fetchedAt = useRef(0);
  const latest = useRef(0);

  const reload = useCallback((opts) => {
    const id = ++latest.current;
    const spent = opts?.spent === true;
    setState((s) => ({ ...s, loading: true, spent: s.spent || spent }));
    return fetchOptions().then(
      (data) => {
        if (id !== latest.current) return;
        fetchedAt.current = Date.now();
        setState({ data, error: null, loading: false, spent: false });
      },
      (error) => {
        if (id === latest.current) setState({ data: null, error, loading: false, spent: false });
      },
    );
  }, [fetchOptions]);

  useEffect(() => {
    if (enabled) reload();
    // A response arriving after unmount, or after `enabled` went false, is ignored.
    return () => {
      latest.current += 1;
    };
  }, [enabled, reload]);

  const { data } = state;
  useEffect(() => {
    if (!enabled || !data) return undefined;
    const timer = setTimeout(reload, Math.max(0, REFRESH_AFTER - (Date.now() - fetchedAt.current)));
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedAt.current > STALE_AFTER) reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, data, reload]);

  return { ...state, reload };
}

// What to say when the phone or computer said no. null: say nothing (a newer
// attempt replaced this one).
export function browserProblem(err, { creating = false } = {}) {
  if (err?.code === 'ERROR_CEREMONY_ABORTED' || err?.name === 'AbortError') return null;
  if (err?.name === 'NotAllowedError') return 'Cancelled or timed out. Try again.';
  if (err?.name === 'SecurityError') {
    // The relying party ID doesn't match this address: a server setting, not the person.
    console.error('Passkeys refused this address. Check WEBAUTHN_RP_ID and DOMAIN in deploy/.env (PUBLIC_URL outside Docker).', err);
    return "This address can't use passkeys.";
  }
  console.error(err);
  return creating
    ? "Your phone or computer couldn't create a passkey. Try again, or open the link on another phone or computer."
    : "Your phone or computer couldn't use a passkey just now. Try again.";
}

// Whether to offer Copy link for Safari or Chrome after the browser said no. An app's
// built-in browser that isn't listed above refuses every time, as a cancelled or
// timed-out attempt does (NotAllowedError), so any refusal offers it. Not an attempt a
// newer one replaced, and not an address that can't use passkeys in any browser.
export function anotherBrowserMayHelp(err) {
  if (err?.code === 'ERROR_CEREMONY_ABORTED' || err?.name === 'AbortError') return false;
  return err?.name !== 'SecurityError';
}

// What to say when the cinema said no. Codes the page handles itself (expired or
// used links, a passkey that already exists) are left to the page.
export function serverProblem(err, cinemaName) {
  const host = `whoever runs ${cinemaName || 'this cinema'}`;
  switch (err?.code) {
    case 'ceremony-expired':
      return 'That took a little too long. Try again.';
    case 'passkeys-unavailable':
      return `Passkeys aren't working here at the moment. Ask ${host}.`;
    case 'too-many-requests':
      return 'Too many attempts from this connection. Wait a few minutes, then try again.';
    case 'busy':
      return 'Lots of people are signing in right now. Wait a minute, then try again.';
    case 'passkey-unknown':
      return `That passkey doesn't work here any more: it may have been removed. Try another, or ask ${host}.`;
    case 'sign-in-failed':
      return `That passkey didn't work. Try again, or ask ${host}.`;
    case 'account-disabled':
      return `This account has been turned off. Ask ${host}.`;
    case 'try-again':
      return "That didn't go through. Try again.";
    case 'passkey-invalid':
      return "Your passkey couldn't be checked. Try again.";
    default:
      if (!err?.status || err.status >= 500) return "Couldn't reach the cinema just now. Check your connection, then try again.";
      return 'Something went wrong. Try again.';
  }
}
