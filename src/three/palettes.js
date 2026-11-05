/**
 * Colour palettes for the lily.
 *
 * `lily` drives the flower itself:
 *   throat   – deep colour where the petals meet the centre
 *   inner    – the cool glow along the middle of each petal
 *   main     – the dominant petal colour
 *   edge     – the lighter, satin rim of each petal
 *   rib      – the pale stripe down the centre of the inner petals
 *   speck    – the small dark spots near the throat
 *   filament – stamen stalks
 *   anther   – the pollen tips at the end of each stamen
 *   pistil   – the long central stalk and its tip
 *
 * `petals` feeds the swatches on the Change Palette button and the halo,
 * `centre` tints the intro particles and floating dust.
 */
export const PALETTES = [
  {
    name: 'Velvet Lily',
    petals: ['#b0279a', '#7b5cff', '#ff7ad9', '#e070c8', '#4b0f4a'],
    centre: '#ffb3e6',
    stem: '#2f6b3a',
    lily: {
      throat: '#3a0a32',
      inner: '#6f58e8',
      main: '#b0279a',
      edge: '#f08ad8',
      rib: '#f6e4ff',
      speck: '#2a0526',
      filament: '#d0306e',
      anther: '#3b2210',
      pistil: '#f0b08a',
    },
  },
  {
    name: 'Romantic Classic',
    petals: ['#ff5e78', '#ff8fab', '#ffd6e0', '#ffd166', '#c77dff'],
    centre: '#ffea8a',
    stem: '#3f9e4d',
    lily: {
      throat: '#6e0f2a',
      inner: '#ffc2d1',
      main: '#ff4f72',
      edge: '#ffb3c6',
      rib: '#fff3f6',
      speck: '#7a0f30',
      filament: '#ff9aae',
      anther: '#5a2a10',
      pistil: '#ffe0b0',
    },
  },
  {
    name: 'Sunset Dream',
    petals: ['#ff6b6b', '#ffa94d', '#ffc9c9', '#b197fc', '#fff3bf'],
    centre: '#ffe066',
    stem: '#4caf50',
    lily: {
      throat: '#7a1e0a',
      inner: '#ffd08a',
      main: '#ff6a4d',
      edge: '#ffb08a',
      rib: '#fff1d6',
      speck: '#6a1505',
      filament: '#ff9a6a',
      anther: '#4a1e08',
      pistil: '#ffe6a8',
    },
  },
  {
    name: 'Midnight Garden',
    petals: ['#9d4edd', '#5a189a', '#ff006e', '#c77dff', '#e0aaff'],
    centre: '#ffd166',
    stem: '#2e7d32',
    lily: {
      throat: '#12052e',
      inner: '#4a6bff',
      main: '#6a1bb5',
      edge: '#c77dff',
      rib: '#e6dcff',
      speck: '#0e0322',
      filament: '#b04ae0',
      anther: '#2a1608',
      pistil: '#ffd6a0',
    },
  },
  {
    name: 'Golden Hour',
    petals: ['#eab308', '#f97316', '#fb7185', '#fde68a', '#fef9c3'],
    centre: '#fff7cc',
    stem: '#558b2f',
    lily: {
      throat: '#8a3a05',
      inner: '#fff0b0',
      main: '#f5b30a',
      edge: '#ffd96a',
      rib: '#fffbe6',
      speck: '#6e2205',
      filament: '#f59e0b',
      anther: '#4a1e05',
      pistil: '#fff3c4',
    },
  },
];
