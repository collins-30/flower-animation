/**
 * Colour palettes for the bouquet.
 * Each palette provides 5 petal colours + centre colour.
 * `petals` is interpolated per-particle (radial gradient centre -> edge)
 * so each flower blends its two assigned colours.
 */
export const PALETTES = [
  {
    name: 'Romantic Classic',
    petals: ['#ff5e78', '#ff8fab', '#ffd6e0', '#ffd166', '#c77dff'],
    centre: '#ffea8a',
    stem: '#3f9e4d',
  },
  {
    name: 'Sunset Dream',
    petals: ['#ff6b6b', '#ffa94d', '#ffc9c9', '#b197fc', '#fff3bf'],
    centre: '#ffe066',
    stem: '#4caf50',
  },
  {
    name: 'Midnight Garden',
    petals: ['#9d4edd', '#5a189a', '#ff006e', '#c77dff', '#e0aaff'],
    centre: '#ffd166',
    stem: '#2e7d32',
  },
  {
    name: 'Golden Hour',
    petals: ['#eab308', '#f97316', '#fb7185', '#fde68a', '#fef9c3'],
    centre: '#fff7cc',
    stem: '#558b2f',
  },
];

// Classic bouquet assignment: red, pink, cream/white, yellow, purple…
export const FLOWER_ORDER = [0, 2, 4, 0, 1, 3, 2, 0, 4, 1, 2];
