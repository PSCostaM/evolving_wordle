"""The 12 heuristic features, the scoring pool, and explainable guess selection.

``extract_features`` returns raw NON-NEGATIVE magnitudes (weights carry sign).
``choose_guess`` min-max normalizes each feature across the per-turn pool, so
features are comparable, then picks the deterministic weighted-sum argmax.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache

from ..wordle.scoring import score_guess_cached
from ..wordle.types import FEATURE_ORDER, GuessRecord, VOWELS
from ..wordle.words import GUESSES, ANSWERS
from .entropy import (
    pattern_distribution,
    shannon_entropy_from_dist,
    expected_remaining_from_dist,
)
from .frequency import (
    letter_frequencies,
    positional_frequencies,
    letter_frequency_score as _lf_score,
    positional_frequency_score as _pf_score,
)


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
@dataclass
class FeatureConfig:
    """Tunable knobs for individual feature magnitudes."""

    unique_letter_decay_turn: int = 2  # after this turn, unique-letter bonus decays
    unique_letter_decay_per_turn: float = 0.25
    endgame_threshold: int = 10  # candidate count below which endgame pressure ramps
    vowels: frozenset[str] = field(default_factory=lambda: VOWELS)


@dataclass
class PlayerConfig:
    """How the heuristic player builds pools and evaluates features."""

    max_turns: int = 6
    use_entropy: bool = True
    pool_cap: int = 200  # cap on the per-turn scoring pool (candidates + probes)
    opener_pool_cap: int = 300  # cap on the turn-1 opener pool
    entropy_subsample_cap: int = 64  # cap on candidates used for entropy estimate
    feature_config: FeatureConfig = field(default_factory=FeatureConfig)


# --------------------------------------------------------------------------- #
# Explainability data structures
# --------------------------------------------------------------------------- #
@dataclass
class ScoredGuess:
    word: str
    score: float
    features: dict[str, float]


@dataclass
class GuessDecision:
    guess: str
    score: float
    features: dict[str, float]
    weighted_breakdown: dict[str, float]
    top_candidates: list[ScoredGuess]


# --------------------------------------------------------------------------- #
# Known information derived from history
# --------------------------------------------------------------------------- #
@dataclass
class KnownInfo:
    greens: dict[int, str]  # position -> confirmed letter
    present_letters: set[str]  # letters known to be in the answer
    absent_letters: set[str]  # letters known NOT in the answer
    tried_wrong_positions: dict[str, set[int]]  # letter -> positions ruled out


def known_info_from_history(history: list[GuessRecord]) -> KnownInfo:
    greens: dict[int, str] = {}
    present: set[str] = set()
    tried_wrong: dict[str, set[int]] = {}
    absent_any: set[str] = set()

    for record in history:
        for i, (letter, state) in enumerate(zip(record.guess, record.feedback)):
            if state == "correct":
                greens[i] = letter
                present.add(letter)
            elif state == "present":
                present.add(letter)
                tried_wrong.setdefault(letter, set()).add(i)
            else:  # absent
                absent_any.add(letter)

    # A letter is only truly "absent" if it is never present/green anywhere.
    absent = {letter for letter in absent_any if letter not in present}
    return KnownInfo(
        greens=greens,
        present_letters=present,
        absent_letters=absent,
        tried_wrong_positions=tried_wrong,
    )


# --------------------------------------------------------------------------- #
# Probe words (information-dense non-candidate guesses)
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=1)
def _probe_words(limit: int = 400) -> tuple[str, ...]:
    """Globally high-information guesses ranked by distinct-letter answer coverage."""
    # Overall presence frequency of each letter across the answer list.
    freqs = letter_frequencies(ANSWERS)

    def probe_value(word: str) -> float:
        # Distinct letters only (duplicates give no new coverage).
        return sum(freqs.get(letter, 0.0) for letter in set(word))

    ranked = sorted(GUESSES, key=lambda w: (-probe_value(w), w))
    return tuple(ranked[:limit])


# --------------------------------------------------------------------------- #
# Pool construction
# --------------------------------------------------------------------------- #
def build_pool(
    valid_guesses,
    possible_answers,
    turn: int,
    config: PlayerConfig,
) -> list[str]:
    """Build the deterministic per-turn scoring pool.

    Pool = (subsampled) remaining candidates, then probe words filling any
    leftover capacity, capped at ``pool_cap`` (or ``opener_pool_cap`` on turn 1).
    """
    from .entropy import subsample_candidates

    cap = config.opener_pool_cap if turn <= 1 else config.pool_cap
    cand = list(possible_answers)
    if len(cand) > cap:
        cand = subsample_candidates(cand, cap)

    pool = list(cand)
    seen = set(pool)
    valid_set = set(valid_guesses) if valid_guesses is not None else None
    for probe in _probe_words():
        if len(pool) >= cap:
            break
        if probe in seen:
            continue
        if valid_set is not None and probe not in valid_set:
            continue
        pool.append(probe)
        seen.add(probe)

    return sorted(seen)


# --------------------------------------------------------------------------- #
# Feature extraction
# --------------------------------------------------------------------------- #
def _duplicate_letter_penalty(guess: str, cand_letter_pair_freq: dict[str, float]) -> float:
    """Magnitude of repeated letters, discounted when duplicates look plausible."""
    counts = Counter(guess)
    penalty = 0.0
    for letter, count in counts.items():
        if count <= 1:
            continue
        # Fraction of candidates that actually contain this letter twice+.
        plausible = cand_letter_pair_freq.get(letter, 0.0)
        # Each extra occurrence beyond the first, discounted by plausibility.
        penalty += (count - 1) * (1.0 - plausible)
    return penalty


def _pair_frequencies(candidates) -> dict[str, float]:
    """Fraction of candidates containing each letter at least twice."""
    n = len(candidates)
    if n == 0:
        return {}
    counts: Counter[str] = Counter()
    for word in candidates:
        letter_counts = Counter(word)
        for letter, c in letter_counts.items():
            if c >= 2:
                counts[letter] += 1
    return {letter: c / n for letter, c in counts.items()}


def extract_features(
    guess: str,
    possible_answers,
    history: list[GuessRecord],
    turn: int,
    config: PlayerConfig,
    *,
    known: KnownInfo | None = None,
    letter_freqs: dict[str, float] | None = None,
    pos_freqs: list[dict[str, float]] | None = None,
    pair_freqs: dict[str, float] | None = None,
    candidate_set: set[str] | None = None,
    entropy_candidates=None,
) -> dict[str, float]:
    """Return the 12 raw (non-negative) feature magnitudes for a guess.

    The optional precomputed arguments let the per-turn caller share expensive
    aggregates across every guess in the pool. ``entropy_candidates`` is the
    (already subsampled) answer list used for the pattern distribution.
    """
    fc = config.feature_config
    if known is None:
        known = known_info_from_history(history)
    if candidate_set is None:
        candidate_set = set(possible_answers)
    if letter_freqs is None:
        letter_freqs = letter_frequencies(possible_answers)
    if pos_freqs is None:
        pos_freqs = positional_frequencies(possible_answers)
    if pair_freqs is None:
        pair_freqs = _pair_frequencies(possible_answers)
    if entropy_candidates is None:
        from .entropy import subsample_candidates

        entropy_candidates = subsample_candidates(
            list(possible_answers), config.entropy_subsample_cap
        )

    n = len(possible_answers)
    is_candidate = guess in candidate_set
    distinct = set(guess)

    features: dict[str, float] = {}

    # 1. candidate_bonus
    features["candidate_bonus"] = 1.0 if is_candidate else 0.0

    # 2 & 3. entropy + expected remaining (share one pattern distribution)
    if config.use_entropy and entropy_candidates:
        dist = pattern_distribution(guess, entropy_candidates, 0)
        features["entropy_score"] = shannon_entropy_from_dist(dist)
        features["expected_remaining_penalty"] = expected_remaining_from_dist(dist)
    else:
        features["entropy_score"] = 0.0
        # Without entropy still expose expected remaining as a magnitude of 0.
        features["expected_remaining_penalty"] = 0.0

    # 4. letter_frequency_score
    features["letter_frequency_score"] = _lf_score(guess, letter_freqs)

    # 5. positional_frequency_score
    features["positional_frequency_score"] = _pf_score(guess, pos_freqs)

    # 6. unique_letter_bonus (decays after early turns)
    decay = 1.0
    if turn > fc.unique_letter_decay_turn:
        decay = max(0.0, 1.0 - fc.unique_letter_decay_per_turn * (turn - fc.unique_letter_decay_turn))
    features["unique_letter_bonus"] = len(distinct) * decay

    # 7. duplicate_letter_penalty
    features["duplicate_letter_penalty"] = _duplicate_letter_penalty(guess, pair_freqs)

    # 8. vowel_coverage_score (distinct vowels not yet known)
    known_vowels = (known.present_letters | set(known.greens.values())) & fc.vowels
    features["vowel_coverage_score"] = len((distinct & fc.vowels) - known_vowels)

    # 9. known_green_bonus
    features["known_green_bonus"] = sum(
        1 for pos, letter in known.greens.items() if guess[pos] == letter
    )

    # 10. known_yellow_bonus (present letters reused in NEW positions)
    yellow = 0
    for i, letter in enumerate(guess):
        if letter in known.present_letters:
            if i in known.greens:
                continue  # this slot is already a (possibly different) green
            if i in known.tried_wrong_positions.get(letter, ()):  # already ruled out here
                continue
            yellow += 1
    features["known_yellow_bonus"] = float(yellow)

    # 11. known_absent_penalty (occurrences of known-absent letters)
    features["known_absent_penalty"] = float(
        sum(1 for letter in guess if letter in known.absent_letters)
    )

    # 12. endgame_candidate_pressure
    pressure = 0.0
    if is_candidate and n <= fc.endgame_threshold:
        pressure = (fc.endgame_threshold - n + 1) / fc.endgame_threshold
    features["endgame_candidate_pressure"] = max(0.0, pressure)

    return features


# --------------------------------------------------------------------------- #
# Guess selection (explainable)
# --------------------------------------------------------------------------- #
def _normalize_pool_features(
    raw: dict[str, dict[str, float]],
) -> dict[str, dict[str, float]]:
    """Min-max normalize each feature across the pool. Constant features -> 0."""
    mins: dict[str, float] = {}
    maxs: dict[str, float] = {}
    for feats in raw.values():
        for key, value in feats.items():
            if key not in mins or value < mins[key]:
                mins[key] = value
            if key not in maxs or value > maxs[key]:
                maxs[key] = value

    normalized: dict[str, dict[str, float]] = {}
    for word, feats in raw.items():
        norm: dict[str, float] = {}
        for key, value in feats.items():
            lo = mins[key]
            hi = maxs[key]
            span = hi - lo
            norm[key] = (value - lo) / span if span > 1e-12 else 0.0
        normalized[word] = norm
    return normalized


def _effective_weights(chromosome, config: PlayerConfig) -> dict[str, float]:
    weights = {f: float(chromosome.weights.get(f, 0.0)) for f in FEATURE_ORDER}
    if not config.use_entropy:
        weights["entropy_score"] = 0.0
        weights["expected_remaining_penalty"] = 0.0
    return weights


def choose_guess(
    chromosome,
    valid_guesses,
    possible_answers,
    history: list[GuessRecord],
    turn: int,
    config: PlayerConfig,
) -> GuessDecision:
    """Deterministically pick a guess and return an explainable decision.

    Ties break lexicographically (earliest word wins).
    """
    pool = build_pool(valid_guesses, possible_answers, turn, config)
    if not pool:
        pool = sorted(set(possible_answers)) or sorted(set(valid_guesses or []))

    from .entropy import subsample_candidates

    known = known_info_from_history(history)
    candidate_set = set(possible_answers)
    letter_freqs = letter_frequencies(possible_answers)
    pos_freqs = positional_frequencies(possible_answers)
    pair_freqs = _pair_frequencies(possible_answers)
    # Subsample the candidate set ONCE per turn (shared by every pooled guess).
    entropy_candidates = (
        subsample_candidates(list(possible_answers), config.entropy_subsample_cap)
        if config.use_entropy
        else []
    )

    raw: dict[str, dict[str, float]] = {}
    for word in pool:
        raw[word] = extract_features(
            word,
            possible_answers,
            history,
            turn,
            config,
            known=known,
            letter_freqs=letter_freqs,
            pos_freqs=pos_freqs,
            pair_freqs=pair_freqs,
            candidate_set=candidate_set,
            entropy_candidates=entropy_candidates,
        )

    normalized = _normalize_pool_features(raw)
    weights = _effective_weights(chromosome, config)

    scored: list[ScoredGuess] = []
    for word in pool:
        norm = normalized[word]
        breakdown = {f: weights[f] * norm.get(f, 0.0) for f in FEATURE_ORDER}
        total = sum(breakdown.values())
        scored.append(ScoredGuess(word=word, score=total, features=dict(raw[word])))

    # Deterministic argmax: highest score, ties -> lexicographically earliest.
    scored.sort(key=lambda sg: (-sg.score, sg.word))
    best = scored[0]

    best_norm = normalized[best.word]
    weighted_breakdown = {f: weights[f] * best_norm.get(f, 0.0) for f in FEATURE_ORDER}

    return GuessDecision(
        guess=best.word,
        score=best.score,
        features=dict(best.features),
        weighted_breakdown=weighted_breakdown,
        top_candidates=scored[:5],
    )
