import { useEffect, useRef, useState } from 'react';
import { createFlowerScene } from './three/scene.js';
import { PALETTES } from './three/palettes.js';
import { MESSAGE } from './config/message.js';

export default function App() {
  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return undefined;
    // Single scene, single animation loop for the whole experience.
    const api = createFlowerScene(mountRef.current, {
      onFirstInteract: () => setInteracted(true),
      onIntroDone: () => setIntroDone(true),
      onFullyBloomed: () => setRevealed(true),
      onRestart: () => {
        setRevealed(false);
        setInteracted(false);
        setIntroDone(false);
      },
    });
    apiRef.current = api;
    setPaletteIdx(api.paletteIndex);
    setMuted(!!api.muted);
    return () => {
      api.dispose();
      apiRef.current = null;
    };
  }, []);

  const handleRestart = () => {
    setRevealed(false);
    setInteracted(false);
    setIntroDone(false);
    apiRef.current?.restart();
  };

  const handlePalette = () => {
    const next = apiRef.current?.nextPalette() ?? 0;
    setPaletteIdx(next);
  };

  const handleMute = () => {
    const next = apiRef.current?.toggleMute() ?? false;
    setMuted(!!next);
  };

  const heroVisible = !introDone && !revealed;

  return (
    <main className="stage" ref={mountRef}>
      <div className="vignette" />

      {/* Cinematic intro — plays for INTRO_DURATION, then fades to reveal the hero */}
      <header className={`intro ${heroVisible ? 'intro-visible' : ''}`} aria-hidden={!heroVisible}>
        <p className="intro-line">{MESSAGE.intro}</p>
      </header>

      {/* Hero — appears after the intro completes */}
      <header className={`hero ${introDone && !revealed ? 'hero-visible' : 'hero-hidden'}`}>
        <p className="eyebrow">A Digital Love Letter</p>
        <h1 className="headline">
          Who needs flowers
          <br />
          when you can <em>code</em> them?
        </h1>
        <p className="sub">grown particle by particle, just for you</p>
      </header>

      {/* Final reveal — bouquet stays visible behind the message */}
      <section className={`finale ${revealed ? 'finale-visible' : ''}`} aria-live="polite">
        <p className="finale-line finale-eyebrow">and one more thing&hellip;</p>
        <h2 className="finale-headline">
          {MESSAGE.headlineBefore}
          <em className="finale-name">{MESSAGE.name}</em>
          {MESSAGE.headlineAfter}
        </h2>
        <p className="finale-support">{MESSAGE.supporting}</p>
        <p className="finale-follow">{MESSAGE.followUp}</p>
        <p className="finale-sign">{MESSAGE.signOff}</p>
      </section>

      <footer className={`crafted ${revealed ? 'crafted-visible' : ''}`}>
        {MESSAGE.footer}
      </footer>

      <p className={`hint ${revealed || interacted ? 'gone' : ''}`}>
        move your cursor through the garden
      </p>

      <div className={`palette-tag ${interacted && !revealed ? 'show' : ''}`}>
        {PALETTES[paletteIdx].name}
      </div>

      <nav className="controls" aria-label="Bouquet controls">
        <button type="button" className="btn" onClick={handleRestart}>
          <span className="icon" aria-hidden="true">↻</span>
          Restart Bloom
        </button>
        <button type="button" className="btn" onClick={handlePalette}>
          <span className="sw" aria-hidden="true">
            {PALETTES[paletteIdx].petals.slice(0, 3).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          Change Palette
        </button>
        <button
          type="button"
          className="btn icon-btn"
          onClick={handleMute}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          <span className="icon" aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
        </button>
      </nav>
    </main>
  );
}
