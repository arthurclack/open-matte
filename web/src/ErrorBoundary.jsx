import { Component, lazy } from 'react';

// A part of the app that's only fetched when it's needed: the player and the admin.
// Each build names their files by their contents and a deploy removes the old ones,
// so a page opened before a deploy can't fetch them afterwards.
class PartMissing extends Error {}
export const lazyPart = (load) =>
  lazy(() =>
    load().catch((err) => {
      throw new PartMissing(err?.message, { cause: err });
    }),
  );

// In place of a page that couldn't be drawn (a part that didn't load, a mangled link,
// a mistake in the app), something to read and a way on, rather than a blank page.
// It tries again when `resetKey` changes: the viewer site gives it the address.
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const missing = error instanceof PartMissing;
    return (
      <div className="narrow" style={{ paddingTop: '15vh' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.8rem' }}>{missing ? 'This page needs reloading' : 'Something went wrong'}</h1>
        <p className="dim">
          {missing ? "Part of it didn't load. The site may have just been updated." : "This page couldn't be shown."} Reload it to carry on.
        </p>
        <div className="row" style={{ gap: '0.6rem' }}>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a className="btn" href="/">
            Go to the front page
          </a>
        </div>
      </div>
    );
  }
}
