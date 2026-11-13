// The video shop's look, in one place to import from. See README.md for what each
// piece is and the rules it keeps. The stylesheets (tokens.css, ui.css, objects.css)
// are loaded once by main.jsx; each side's own (friend.css, office.css) by that side.

export { InkFilters, Gun, Hand, LabelTape, Paper, PickCard, PickNote, Rub, ShopName, Sleeve, Sticker, TapeStrip, TillSlip, Typed, TypedLabel, inkVars } from './objects.jsx';
export { ComingBack, CrtScreen, OsdStrip, PLAY_SCREEN_MS, PlayScreen, PlayTile, PxPause, PxPlay, PxStop, StopStrip, VcrMenu } from './crt.jsx';
export { BusyButton, Line, Menu, MenuSep, TabRow, Tri, useBusyNews } from './ui.jsx';
export { BUSY_WORDS, busyProps } from './busy.js';
export { DEADLINE_KEYS, STICKER_TOPS, askHost, endOfDay, forOnly, hostName, nextDeadline, noTapeYet, pickSize, pickedBy, shopName, stickerText, tapeCounter } from './words.js';
export { KINDS, eNumber, embossStrip, gunWheels, objectWear, stickerShift, tapeLines, tillTeeth } from './wear.js';
export { installDevicePixels, pixelPitch } from './devicePixels.js';
