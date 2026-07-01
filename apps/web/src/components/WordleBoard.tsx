// A Wordle board: up to `maxTurns` rows of 5 tiles, with a staggered flip
// animation as guesses land.

import { Feedback } from '../engine/types';
import { Tile } from './primitives';

export interface BoardTurn {
  guess: string;
  feedback: Feedback;
}

export function WordleBoard({
  turns,
  maxTurns = 6,
  animate = true,
  compact = false,
}: {
  turns: BoardTurn[];
  maxTurns?: number;
  animate?: boolean;
  compact?: boolean;
}) {
  const rows = Array.from({ length: maxTurns }, (_, i) => turns[i]);

  return (
    <div className={`inline-grid gap-1.5 ${compact ? 'scale-90' : ''}`}>
      {rows.map((turn, r) => (
        <div key={r} className="flex gap-1.5">
          {Array.from({ length: 5 }, (_, c) => (
            <Tile
              key={c}
              letter={turn?.guess[c]}
              state={turn?.feedback[c]}
              animate={animate}
              delayMs={(r * 5 + c) * 45}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
