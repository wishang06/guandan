import {
  applyAction,
  createMatch,
  makeCardFactory,
  makeCards,
  sortCards,
  startNextHand,
  timeoutAction,
  type Action,
  type Card,
  type MatchState,
  type Seat,
} from '@guandan/shared';

/**
 * Scripted moments for the effects preview. Each scene builds a real match with
 * rigged hands and a list of timed moves, so the effects run through exactly the same
 * path as a live game: rules engine → events → director.
 *
 * Seats: 0 is you, 1 sits to your right, 2 is your partner (top), 3 is on your left.
 */
export interface Step {
  /** Milliseconds after the previous step. */
  wait: number;
  run: (m: MatchState) => MatchState;
}

export interface SceneSetup {
  match: MatchState;
  script: Step[];
  /** Give your first turn a deadline this many ms away (for the timer scene). */
  deadlineIn?: number;
}

export interface Scene {
  id: string;
  en: string;
  zh: string;
  build: () => SceneSetup;
}

function hands(specs: string[]): Card[][] {
  const f = makeCardFactory();
  return specs.map((s) => makeCards(s, f));
}

interface MatchOpts {
  level?: number;
  levels?: [number, number];
  leader?: Seat;
  /** Keep the deal event so the hand is dealt in on screen. */
  deal?: boolean;
}

function makeMatch(specs: string[], o: MatchOpts = {}): MatchState {
  const m = createMatch({ hands: hands(specs), firstLeader: o.leader ?? 0, seed: 11 });
  const levels = o.levels ?? [o.level ?? 9, 5];
  m.levels = levels;
  m.declarer = 0;
  m.hand.declarer = 0;
  m.hand.level = levels[0];
  m.hand.hands = m.hand.hands.map((h) => sortCards(h, m.hand.level));
  if (!o.deal) m.events = [];
  return m;
}

function idsOf(m: MatchState, seat: Seat, specs: string): number[] {
  const want = makeCards(specs, makeCardFactory());
  const pool = [...m.hand.hands[seat]!];
  return want.map((w) => {
    const i = pool.findIndex((c) => c.suit === w.suit && c.rank === w.rank);
    if (i < 0) throw new Error(`scene: seat ${seat} has no ${specs}`);
    return pool.splice(i, 1)[0]!.id;
  });
}

function act(m: MatchState, seat: Seat, action: Action): MatchState {
  const r = applyAction(m, seat, action);
  if (!r.ok) {
    // A rejected step means the scene's hands and script have drifted apart.
    console.warn(`scene step rejected: seat ${seat} ${action.type} → ${r.error}`);
    return m;
  }
  return r.state;
}

const play = (wait: number, seat: Seat, specs: string): Step => ({
  wait,
  run: (m) => act(m, seat, { type: 'play', cardIds: idsOf(m, seat, specs) }),
});
const pass = (wait: number, seat: Seat): Step => ({ wait, run: (m) => act(m, seat, { type: 'pass' }) });
const auto = (wait: number, seat: Seat): Step => ({
  wait,
  run: (m) => {
    const a = timeoutAction(m, seat);
    return a ? act(m, seat, a) : m;
  },
});
const passes = (seats: Seat[], wait = 650): Step[] => seats.map((s) => pass(wait, s));

/** Finish a tiny hand off-screen so the next one starts with tribute. */
function finished(order: 'weWon' | 'weLost'): MatchState {
  let m =
    order === 'weWon'
      ? makeMatch(['S3', 'S4', 'S5', 'S9 S10'], { leader: 0 })
      : makeMatch(['S9 S10', 'S3', 'S4', 'S5'], { leader: 1 });
  const seq: Seat[] = order === 'weWon' ? [0, 1, 2] : [1, 2, 3];
  for (const s of seq) m = act(m, s, { type: 'play', cardIds: [m.hand.hands[s]![0]!.id] });
  return m;
}

const FILL_ME = 'S3 D4 C5 S6 D8 C10 SJ DQ CK SA D2 C2';

export const SCENES: Scene[] = [
  {
    id: 'deal',
    en: 'The deal',
    zh: '发牌',
    build: () => ({ match: createMatch({ seed: 2026, firstLeader: 1 }), script: [] }),
  },
  {
    id: 'plays',
    en: 'Ordinary plays and a trick swept up',
    zh: '普通出牌与收牌',
    build: () => ({
      match: makeMatch(
        [
          'S3 D3 C6 S8 D10 SJ CQ DK SA HA S4 D5 C5',
          'SJ D3 C4 H5 D6 S7 C8 DQ S2 H2',
          'C5 S6 H7 D8 C9 H10 CK C2',
          'S5 H3 C3 DA CA H4 H6 D7',
        ],
        { leader: 3 },
      ),
      script: [
        play(700, 3, 'S5'),
        play(950, 0, 'S8'),
        play(950, 1, 'SJ'),
        ...passes([2, 3, 0], 750),
        play(1200, 1, 'D3 C4 H5 D6 S7'),
        play(1500, 2, 'C5 S6 H7 D8 C9'),
        ...passes([3, 0, 1], 750),
        play(1200, 2, 'C2'),
        play(1000, 3, 'DA'),
      ],
    }),
  },
  {
    id: 'combos',
    en: 'Full house, three pairs, two triples',
    zh: '三带二 · 木板 · 钢板',
    build: () => ({
      match: makeMatch(
        [
          'S3 D5 C7 S8 H8 D2 C2 HQ S5 DJ',
          'S4 D4 C4 S6 D6 S10 D10 SJ DJ SQ DQ SK DK CK SA DA CA S2',
          'H3 H4 H5 C8 C10 CJ',
          'C3 D3 H6 D7 H10 HJ',
        ],
        { leader: 1 },
      ),
      script: [
        play(700, 1, 'S4 D4 C4 S6 D6'),
        ...passes([2, 3, 0]),
        play(1100, 1, 'S10 D10 SJ DJ SQ DQ'),
        ...passes([2, 3, 0]),
        play(1100, 1, 'SK DK CK SA DA CA'),
      ],
    }),
  },
  {
    id: 'bombs',
    en: 'Bombs: four, five, then six',
    zh: '炸弹：四张、五张、六张',
    build: () => ({
      match: makeMatch(
        [
          `S7 D7 C7 H7 S7 ${FILL_ME}`,
          'S10 D10 C10 H10 S10 D10 S3 D5 C4 HJ HQ',
          'SK DK H3 H4 C4 D3 C8',
          'S8 D8 C8 H8 C3 D3 H5 C6 CJ',
        ],
        { leader: 2 },
      ),
      script: [play(700, 2, 'SK DK'), play(1300, 3, 'S8 D8 C8 H8'), play(2200, 0, 'S7 D7 C7 H7 S7'), play(2300, 1, 'S10 D10 C10 H10 S10 D10')],
    }),
  },
  {
    id: 'bomb8',
    en: 'An eight-card bomb',
    zh: '八张炸弹',
    build: () => ({
      match: makeMatch(
        ['S3 D4 C5 S6 D8 C10 SJ CK SA D2 C2 H3', 'S5 D5 S7 D8 C9 HJ', 'SQ DQ CQ HQ SQ DQ CQ HQ S4 D6', 'C3 D3 H5 S8 CJ SK'],
        { leader: 1 },
      ),
      script: [play(700, 1, 'S5 D5'), play(1400, 2, 'SQ DQ CQ HQ SQ DQ CQ HQ')],
    }),
  },
  {
    id: 'flush',
    en: 'Straight flush',
    zh: '同花顺',
    build: () => ({
      match: makeMatch(
        ['S9 S10 SJ SQ SK D3 C4 D6 C7 H8 DA C2 D2', 'S5 D5 S7 D8 HJ', 'S4 D6 C8 CJ', 'S3 D4 C5 H6 S7 C3 SA'],
        { leader: 3 },
      ),
      script: [play(700, 3, 'S3 D4 C5 H6 S7'), play(1800, 0, 'S9 S10 SJ SQ SK')],
    }),
  },
  {
    id: 'jokers',
    en: 'Four jokers',
    zh: '天王炸',
    build: () => ({
      match: makeMatch(
        ['JS JS JB JB S3 D4 C5 S6 D8 C10 SJ DQ CK', 'S5 D5 S7 D8 HJ', 'S4 D6 C8 CJ', 'SA DA C3 D3 H5 S8'],
        { leader: 3 },
      ),
      script: [play(700, 3, 'SA DA'), play(1700, 0, 'JS JS JB JB')],
    }),
  },
  {
    id: 'jiefeng',
    en: 'Partner goes out first — you take the lead',
    zh: '队友上游 · 接风',
    build: () => ({
      match: makeMatch([FILL_ME, 'S5 D5 S7 D8 HJ C3', 'SA', 'C4 D6 H8 SJ S2'], { leader: 1 }),
      script: [play(700, 1, 'S5'), play(1100, 2, 'SA'), ...passes([3, 0, 1], 900)],
    }),
  },
  {
    id: 'alerts',
    en: 'Card-count alerts',
    zh: '报牌提醒',
    build: () => ({
      match: makeMatch(
        [FILL_ME, 'S3 D3 S4 D4 C4 S6 D6 SJ DQ CK SA C2', 'H3 H4 H5 C8 C10 CJ D7 S8', 'C3 H6 D7 H10 HJ D5 S7 C9'],
        { leader: 1 },
      ),
      script: [play(700, 1, 'S3 D3'), ...passes([2, 3, 0], 700), play(1200, 1, 'S4 D4 C4 S6 D6')],
    }),
  },
  {
    id: 'timer',
    en: 'The last five seconds of your turn',
    zh: '最后五秒',
    build: () => ({
      match: makeMatch([FILL_ME, 'S5 D5 S7 D8 HJ C3', 'S4 D6 C8 CJ', 'C4 D6 H8 SJ S2'], { leader: 0 }),
      script: [auto(7400, 0)],
      deadlineIn: 7400,
    }),
  },
  {
    id: 'tributeIn',
    en: 'Receiving tribute',
    zh: '收贡 · 还贡',
    build: () => ({
      match: (() => {
        const m = startNextHand(finished('weWon'), {
          hands: hands([FILL_ME, 'S5 D5 S7 D8 HJ C3 H10', 'S4 D6 C8 CJ H3 HQ', 'JB C4 D6 H8 SJ S2 DK']),
        });
        m.events = [];
        return m;
      })(),
      script: [auto(1100, 3), auto(2600, 0)],
    }),
  },
  {
    id: 'tributeOut',
    en: 'Paying tribute',
    zh: '进贡',
    build: () => ({
      match: (() => {
        const m = startNextHand(finished('weLost'), {
          hands: hands([FILL_ME, 'S5 D5 S7 D8 HJ C3 H10', 'S4 D6 C8 CJ H3 HQ', 'C4 D6 H8 SJ S2 DK HA']),
        });
        m.events = [];
        return m;
      })(),
      script: [auto(2200, 0), auto(2200, 1)],
    }),
  },
  {
    id: 'anti',
    en: 'Tribute refused (both big jokers)',
    zh: '抗贡',
    build: () => ({
      match: startNextHand(finished('weWon'), {
        hands: hands([FILL_ME, 'S5 D5 S7 D8 HJ C3 H10', 'S4 D6 C8 CJ H3 HQ', 'JB JB C4 D6 H8 SJ S2']),
      }),
      script: [],
    }),
  },
  {
    id: 'win',
    en: 'Winning a hand first and second',
    zh: '双下获胜',
    build: () => ({
      match: makeMatch(['SA', 'S5 D5 S7 D8 HJ C3', 'SK', 'C4 D6 H8 SJ S2'], { leader: 1 }),
      script: [play(700, 1, 'S5'), play(1100, 2, 'SK'), pass(900, 3), play(1100, 0, 'SA')],
    }),
  },
  {
    id: 'lose',
    en: 'Losing a hand',
    zh: '输掉一局',
    build: () => ({
      match: makeMatch([FILL_ME, 'SA', 'S4 D6 C8 CJ', 'D9'], { leader: 1 }),
      script: [play(700, 1, 'SA'), pass(900, 2), play(1000, 3, 'D9')],
    }),
  },
  {
    id: 'match',
    en: 'Winning the match at A',
    zh: '打A过关',
    build: () => ({
      match: makeMatch(['SK', 'S5 D5 S7 D8 HJ C3', 'SQ', 'C4 D6 H8 SJ S2'], { leader: 1, levels: [14, 9] }),
      script: [play(700, 1, 'S5'), play(1100, 2, 'SQ'), pass(900, 3), play(1100, 0, 'SK')],
    }),
  },
];
