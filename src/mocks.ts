import type { LineWin, SymbolId } from './config';
import type { WinTier } from './winfx';

/** The hooks the mock panel drives (all provided by main.ts). */
export interface MockApi {
  /** Run a full round; pass a forced 3×3 grid or omit for a random spin. */
  round: (grid?: string[][]) => void;
  /** Play a Big/Mega/Epic splash directly (no spin). */
  splash: (tier: WinTier, mult: number) => void;
  /** Show win frames + payline for these lines (no spin). */
  frames: (wins: LineWin[]) => void;
  /** Clear any win highlight. */
  clear: () => void;
  /** Replay the intro. */
  intro: () => void;
  isBusy: () => boolean;
}

type G = SymbolId;
/** Build a 3×3 grid ([reel][cell]) from three columns. */
const grid = (a: G[], b: G[], c: G[]): string[][] => [a, b, c];

const LINE_CELLS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 0], [1, 0], [2, 0]], // top row
  [[0, 1], [1, 1], [2, 1]], // middle row
  [[0, 2], [1, 2], [2, 2]], // bottom row
  [[0, 0], [1, 1], [2, 2]], // ↘
  [[0, 2], [1, 1], [2, 0]], // ↗
];
const asWin = (i: number): LineWin => ({
  line: i,
  symbol: 'heart',
  cells: LINE_CELLS[i]!,
  multiplier: 25,
});

interface Group {
  title: string;
  buttons: Array<{ label: string; run: (api: MockApi) => void }>;
}

const GROUPS: Group[] = [
  {
    title: 'Спины (исход задан)',
    buttons: [
      { label: 'Случайный', run: (a) => a.round() },
      {
        label: 'Мелкий (клевер 4×)',
        run: (a) => a.round(grid(['clover', 'heart', 'spade'], ['clover', 'diamond', 'pear'], ['clover', 'grapes', 'coconut'])),
      },
      {
        label: 'BIG — грейпы 14×',
        run: (a) => a.round(grid(['grapes', 'heart', 'spade'], ['grapes', 'diamond', 'pear'], ['grapes', 'clover', 'coconut'])),
      },
      {
        label: 'MEGA — сердца 25×',
        run: (a) => a.round(grid(['heart', 'clover', 'spade'], ['heart', 'diamond', 'pear'], ['heart', 'grapes', 'coconut'])),
      },
      {
        label: 'EPIC — все сердца 125×',
        run: (a) => a.round(grid(['heart', 'heart', 'heart'], ['heart', 'heart', 'heart'], ['heart', 'heart', 'heart'])),
      },
      {
        label: 'Anticipation (промах)',
        run: (a) => a.round(grid(['heart', 'spade', 'clover'], ['heart', 'diamond', 'pear'], ['spade', 'grapes', 'coconut'])),
      },
    ],
  },
  {
    title: 'Вайлды',
    buttons: [
      {
        label: '2 вайлда (свечение)',
        run: (a) => a.round(grid(['wild', 'spade', 'clover'], ['heart', 'wild', 'diamond'], ['grapes', 'pear', 'strawberry'])),
      },
      {
        label: 'Вайлд-диагональ 50×',
        run: (a) => a.round(grid(['wild', 'spade', 'clover'], ['diamond', 'wild', 'pear'], ['grapes', 'coconut', 'wild'])),
      },
    ],
  },
  {
    title: 'Монетки',
    buttons: [
      {
        label: '3 монетки',
        run: (a) => a.round(grid(['coin', 'spade', 'clover'], ['heart', 'coin', 'diamond'], ['grapes', 'pear', 'coin'])),
      },
      {
        label: 'Монетки + вайлд',
        run: (a) => a.round(grid(['coin', 'wild', 'clover'], ['coin', 'coin', 'diamond'], ['grapes', 'coin', 'coin'])),
      },
      {
        label: 'Hold & Win (бонус)',
        run: (a) => a.round(grid(['coin', 'coin', 'clover'], ['coin', 'heart', 'coin'], ['coin', 'pear', 'diamond'])),
      },
    ],
  },
  {
    title: 'Сплэш (без спина)',
    buttons: [
      { label: 'BIG WIN', run: (a) => a.splash('big', 12) },
      { label: 'MEGA WIN', run: (a) => a.splash('mega', 37) },
      { label: 'EPIC WIN', run: (a) => a.splash('epic', 150) },
    ],
  },
  {
    title: 'Оверлеи',
    buttons: [
      { label: 'Рамки: 1 линия', run: (a) => a.frames([asWin(1)]) },
      { label: 'Рамки: 5 линий', run: (a) => a.frames([0, 1, 2, 3, 4].map(asWin)) },
      { label: 'Очистить', run: (a) => a.clear() },
    ],
  },
  {
    title: 'Прочее',
    buttons: [{ label: 'Intro заново', run: (a) => a.intro() }],
  },
];

const CSS = `
#mocks{position:fixed;top:8px;left:8px;z-index:99999;width:210px;max-height:calc(100vh - 16px);
  overflow:auto;background:rgba(20,16,12,.92);border:1px solid #6b4f2a;border-radius:10px;
  color:#f5e6c8;font:12px/1.3 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);backdrop-filter:blur(3px)}
#mocks header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;
  font-weight:700;cursor:pointer;position:sticky;top:0;background:rgba(30,22,14,.98);border-bottom:1px solid #6b4f2a}
#mocks .body{padding:6px 8px 10px}
#mocks h4{margin:8px 2px 4px;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#c9a86a}
#mocks button{display:block;width:100%;margin:3px 0;padding:6px 8px;text-align:left;cursor:pointer;
  background:#3a2c1a;color:#ffe9c2;border:1px solid #7a5c30;border-radius:6px;font:inherit}
#mocks button:hover{background:#523d22;border-color:#c9a86a}
#mocks button:active{transform:translateY(1px)}
#mocks.collapsed .body{display:none}
#mocks .hint{color:#a98c5c;font-size:10px;padding:2px 2px 4px}
`;

export function mountMocks(api: MockApi): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'mocks';

  const header = document.createElement('header');
  header.innerHTML = '<span>🎬 Anim mocks</span><span id="mk-tgl">▾</span>';
  header.onclick = () => {
    root.classList.toggle('collapsed');
    (header.querySelector('#mk-tgl') as HTMLElement).textContent = root.classList.contains('collapsed') ? '▸' : '▾';
  };
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'body';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Клик — запустить анимацию';
  body.appendChild(hint);

  for (const g of GROUPS) {
    const h = document.createElement('h4');
    h.textContent = g.title;
    body.appendChild(h);
    for (const b of g.buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.onclick = () => b.run(api);
      body.appendChild(btn);
    }
  }
  root.appendChild(body);
  document.body.appendChild(root);
}
