# Guandan rules as implemented

The rules engine lives in [`shared/src`](../shared/src) and is pure TypeScript (no I/O),
so the server and the client run exactly the same code.

| Module        | Responsibility                                                              |
| ------------- | --------------------------------------------------------------------------- |
| `cards.ts`    | 108-card deck, rank power at a given level, wild detection, sorting          |
| `combos.ts`   | Combo classification, wild interpretation, comparison (`beats`), bomb order  |
| `generate.ts` | Enumerates every play available from a hand (hints, bots, timeouts)         |
| `game.ts`     | Match/hand state machine: turns, 接风, finishing, promotion, A level, tribute |

## Cards and ranks

* Two standard decks plus 2 small and 2 big jokers (108 cards), 27 per player.
  Seats 0 & 2 and 1 & 3 are partners (they sit opposite).
* Order: `2 < 3 < … < K < A < level card < small joker < big joker`.
* The **level card** (级牌) is the rank of the level being played this hand.
* The **heart of the level rank** (红心级牌, 逢人配) is wild: it can stand in for any card
  except a joker. On its own it is just a level card.

## Combos

| Type           | Shape                                   | Compared by          |
| -------------- | --------------------------------------- | -------------------- |
| Single         | 1 card                                  | power                |
| Pair           | 2 of a rank (two identical jokers ok)   | power                |
| Triple         | 3 of a rank                             | power                |
| Triple + pair  | 三带二; the pair may be identical jokers | the triple's power   |
| Straight       | exactly 5 consecutive ranks             | top card             |
| Tube 木板      | 3 consecutive pairs                     | top pair             |
| Plate 钢板     | 2 consecutive triples                   | top triple           |

* In sequences (straight, tube, plate) **A is high or low** (A2345, AA2233, AAA222 are the
  lowest) and the level card plays at its **natural rank**. Sequences never wrap
  (QKA23 is not a straight). Jokers are never part of a sequence.
* You must follow with the **same type and size**, strictly higher.

### Bombs (lowest → highest)

`4 of a kind < 5 of a kind < straight flush < 6 < 7 < 8 < 9 < 10 of a kind < 4 jokers (天王炸)`

A bomb beats any non-bomb. Bombs of the same tier compare by rank (level rank counts
as 15). Wilds can extend a bomb up to 10 cards.

### Wild resolution

`getInterpretations` tries every substitution for the wild cards and returns every
legal reading. Dominated readings are pruned: for one shape only the strongest is
kept (3456+wild is 34567, not 23456), and a plain straight is dropped when the same
cards can be a straight flush (a natural same-suit straight is always a bomb too).
If more than one shape remains (e.g. wild wild 33 44 → tube 334455 **or** plate
333444; wild wild 999 → full house **or** 5-bomb) and more than one of them is legal
right now, the player is asked to choose. A client may still explicitly pick any valid
reading.

## Turn flow

* The leader plays any combo; the others, in turn, beat it or pass.
* When everyone else has passed, the last player to play leads.
* **接风**: if that player has already gone out, their partner leads.
* Players who have gone out are skipped.
* The hand ends as soon as both members of one team are out; the remaining players
  take the last places.

## Promotion

The team of the first finisher wins the hand and goes up by:

| Partner finished | Levels |
| ---------------- | ------ |
| 2nd              | +3     |
| 3rd              | +2     |
| 4th              | +1     |

Levels run 2 → A and are capped at A. The next hand is played at the winning team's
level (that team "declares").

### Winning at A

A team wins the match when it **declares at A** (the hand is played at its A level)
and finishes 1st with its partner 2nd or 3rd. Losing that hand, or finishing 1st & 4th,
is a failed attempt. After **3** failed attempts the team drops back to 2
(`MatchConfig.aMaxFails`, 0 disables the reset).

## Tribute (from the second hand)

* **Single** (the winners did not finish 1st & 2nd): the last finisher gives their
  highest card (never the wild heart; a non-heart level card outranks an A) to the
  first finisher. If several cards tie for highest they choose which.
* **Double-down 双下** (the winners finished 1st & 2nd): both losers pay. The larger
  tribute goes to 1st place, the smaller to 2nd; on a tie, the payer next in turn order
  after 1st place pays 1st place.
* **Return 还贡**: each receiver returns any card of natural rank ≤ 10 to their payer
  (any card if they hold none).
* The player who paid 1st place leads the first trick.
* **Anti-tribute 抗贡**: if the paying side holds both big jokers between them, there is no
  tribute and the first finisher of the previous hand leads.

## Timeouts

When a turn timer expires: following → pass; leading → play the lowest single (not a
wild if avoidable); tribute → the first eligible highest card; return → the lowest
eligible card.

## Simplifications

* "Winning at A" requires the hand to be played at your own A level; finishing 1st at A
  while the opponents declare just makes you the declarer for the next hand.
* After a 1st & 2nd finish the two losers' relative order is not played out (they are
  ranked in turn order); it does not matter for scoring or tribute.
* No 报牌 announcements; card counts are always visible instead.
* The first hand's leader is chosen at random (no card flip).
* A tribute tie in a double-down is broken by seating order rather than by re-dealing or
  a dice roll.
