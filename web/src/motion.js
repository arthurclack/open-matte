// Whether the person has asked their device for less motion (Reduce Motion on an
// iPhone or a Mac, Animation effects off in Windows). Asked each time, since it can
// change while the page is open.
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// For scrollIntoView: a glide, or straight there for someone who asked for less motion.
export const scrollBehavior = () => (prefersReducedMotion() ? 'auto' : 'smooth');
