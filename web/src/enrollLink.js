// A setup or recovery link's token, kept for this tab once /enroll has read it from
// the address fragment (pages/Enroll.jsx), so a reload carries on after the fragment
// is cleared. It goes as soon as nobody here needs it: the link is used or dead, the
// page says this device already has a passkey, or the browser signs out. Otherwise
// the next person at a shared computer could press Back and finish the link.
const KEY = 'om_enroll';

export const enrollLink = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (token) => {
    try {
      sessionStorage.setItem(KEY, token);
    } catch {
      // Private browsing: a reload will need the link again.
    }
  },
  forget: () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Nothing was kept.
    }
  },
};
