import { useEffect, useRef, useState } from 'react';
import { createFlowerScene } from './three/scene.js';
import { PALETTES } from './three/palettes.js';

export default function App() {
  const mountRef = useRef(null);
  const apiRef = useRef(null);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [bloomed, setBloomed] = useState(false);
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const api = createFlowerScene(mountRef.current, {
      onFirstInteract: () => setInteracted(true),
    });
    apiRef.current = api;
    setPaletteIdx(api.paletteIndex);
    const t = setTimeout(() => setBloomed(true), 20000);
    return () => {
      clearTimeout(t);
      api.dispose();
      apiRef.current = null;
    };
  }, []);

  const handleRestart = () => {
    apiRef.current?.restart();
    setBloomed(false);
    setInteracted(false);
    setTimeout(() => setBloomed(true), 20000);
  };

  const handlePalette = () => {
    const next = apiRef.current?.nextPalette() ?? 0;
    setPaletteIdx(next);
  };

  return (
    <main className="stage" ref={mountRef}>
      <div className="vignette" />

      <header className="hero">
        <p className="eyebrow">A Digital Love Letter</p>
        <h1 className="headline">
          Who needs flowers
          <br />
          when you can <em>code</em> them?
        </h1>
        <p className="sub">grown particle by particle, just for you</p>
      </header>

      <p className={`hint ${bloomed || interacted ? 'gone' : ''}`}>
        move your cursor through the garden
      </p>

      <div className={`palette-tag ${interacted ? 'show' : ''}`}>
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
      </nav>
    </main>
  );
}
