"""Pydantic v2 models + builders enforcing the camelCase JSON contract.

Internally the trainer speaks snake_case; EVERY value that crosses to the
frontend (REST, WebSocket payloads, artifact files) is camelCase. Models use
``alias_generator=to_camel`` and are dumped with ``by_alias=True``. Feature-weight
dict keys are converted separately via :func:`to_camel_weights`.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from ..wordle.types import FEATURE_ORDER, to_camel_weights, to_snake_weights
from ..wordle.scoring import encode_pattern
from ..wordle.candidate_filter import filter_candidates
from ..wordle.scoring import score_guess_cached


# --------------------------------------------------------------------------- #
# Base model
# --------------------------------------------------------------------------- #
class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    def dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class CamelInModel(BaseModel):
    """Input model: accepts camelCase (or snake), ignores unknown extra fields."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


# --------------------------------------------------------------------------- #
# Output models (exact JSON shapes)
# --------------------------------------------------------------------------- #
class ChromosomeJSON(CamelModel):
    id: str
    weights: dict[str, float]
    mutation_rate: float
    generation_born: int
    species: Optional[str] = None


class StatsJSON(CamelModel):
    games: int
    wins: int
    win_rate: float
    failure_rate: float
    avg_guesses: float
    solved_in_3_or_less_rate: float
    avg_remaining_after_guess2: float
    hard_word_success_rate: float
    histogram: list[int]


class ChampionJSON(CamelModel):
    chromosome: ChromosomeJSON
    fitness: float
    stats: StatsJSON
    nickname: str


class PopulationMemberJSON(CamelModel):
    id: str
    fitness: float
    win_rate: float
    avg_guesses: float
    mutation_rate: float
    generation_born: int
    distance_from_champion: float
    nickname: str


class GenerationReportJSON(CamelModel):
    generation: int
    evaluations: int
    best_fitness: float
    avg_fitness: float
    median_fitness: float
    win_rate: float
    avg_guesses: float
    diversity_score: float
    champion: ChampionJSON
    population: list[PopulationMemberJSON]
    elapsed_ms: int


class TopCandidateJSON(CamelModel):
    word: str
    score: float


class GuessDecisionJSON(CamelModel):
    guess: str
    score: float
    features: dict[str, float]
    weighted_breakdown: dict[str, float]
    top_candidates: list[TopCandidateJSON]


class ReplayTurnJSON(CamelModel):
    guess: str
    feedback: list[str]
    pattern: int
    candidates_before: int
    candidates_after: int
    decision: Optional[GuessDecisionJSON] = None


class ReplayMatchJSON(CamelModel):
    label: str
    bot_kind: str
    answer: str
    solved: bool
    guess_count: int
    turns: list[ReplayTurnJSON]


class BaselineSummaryJSON(CamelModel):
    key: str
    name: str
    win_rate: float
    avg_guesses: float
    failures: int
    games: int
    histogram: list[int]
    fitness: float


class EvolutionConfigJSON(CamelModel):
    population_size: int
    generations: int
    elite_count: int
    tournament_size: int
    mutation_rate: float
    large_mutation_chance: float
    training_sample_size: int
    validation_sample_size: int
    seed: str
    use_entropy: bool
    max_turns: int


class FitnessConfigJSON(CamelModel):
    win_rate_weight: float
    avg_guesses_weight: float
    failure_rate_weight: float
    solved_in_3_weight: float
    avg_remaining_after_guess2_weight: float
    hard_word_success_weight: float


class ExperimentSummaryJSON(CamelModel):
    run_id: str
    seed: str
    config: EvolutionConfigJSON
    generations: int
    timestamp: str
    duration_ms: int
    final_champion_id: str
    best_fitness: float


# --------------------------------------------------------------------------- #
# Input models
# --------------------------------------------------------------------------- #
class FitnessCoeffsIn(CamelInModel):
    win_rate_weight: Optional[float] = None
    avg_guesses_weight: Optional[float] = None
    failure_rate_weight: Optional[float] = None
    solved_in_3_weight: Optional[float] = None
    avg_remaining_after_guess2_weight: Optional[float] = None
    hard_word_success_weight: Optional[float] = None


class TrainConfig(CamelInModel):
    population_size: int = 80
    generations: int = 100
    elite_count: int = 8
    tournament_size: int = 5
    mutation_rate: float = 0.15
    large_mutation_chance: float = 0.03
    training_sample_size: int = 150
    validation_sample_size: int = 150
    seed: str = "codebullet-wordle"
    use_entropy: bool = True
    max_turns: int = 6
    fitness: Optional[FitnessCoeffsIn] = None


class ReplayRequest(CamelInModel):
    weights: dict[str, float]
    mutation_rate: float = 0.0
    answer: str


class BaselinesCompareRequest(CamelInModel):
    sample_size: int = 100
    keys: Optional[list[str]] = None
    champion_weights: Optional[dict[str, float]] = None


class WordsValidateRequest(CamelInModel):
    text: Optional[str] = None
    words: Optional[list[str]] = None


class WordsImportRequest(CamelInModel):
    answers: Optional[str] = None
    guesses: Optional[str] = None


# --------------------------------------------------------------------------- #
# Config translation (camelCase input -> internal snake_case config)
# --------------------------------------------------------------------------- #
def build_evolution_config(tc: "TrainConfig"):
    """Map a camelCase :class:`TrainConfig` to an internal ``EvolutionConfig``."""
    from ..ga.evolution import EvolutionConfig
    from ..ga.fitness import FitnessConfig

    fitness_config = FitnessConfig()
    if tc.fitness is not None:
        overrides = {k: v for k, v in tc.fitness.model_dump().items() if v is not None}
        for key, value in overrides.items():
            setattr(fitness_config, key, value)

    return EvolutionConfig(
        population_size=tc.population_size,
        generations=tc.generations,
        elite_count=min(tc.elite_count, tc.population_size),
        tournament_size=tc.tournament_size,
        mutation_rate=tc.mutation_rate,
        large_mutation_chance=tc.large_mutation_chance,
        training_sample_size=tc.training_sample_size,
        validation_sample_size=tc.validation_sample_size,
        seed=tc.seed,
        use_entropy=tc.use_entropy,
        max_turns=tc.max_turns,
        fitness_config=fitness_config,
    )


# --------------------------------------------------------------------------- #
# Builders: internal objects -> JSON-ready dicts
# --------------------------------------------------------------------------- #
def chromosome_model(chrom) -> ChromosomeJSON:
    return ChromosomeJSON(
        id=chrom.id,
        weights=to_camel_weights(chrom.weights),
        mutation_rate=chrom.mutation_rate,
        generation_born=chrom.generation_born,
        species=chrom.species,
    )


def stats_model(stats) -> StatsJSON:
    return StatsJSON(
        games=stats.games,
        wins=stats.wins,
        win_rate=stats.win_rate,
        failure_rate=stats.failure_rate,
        avg_guesses=stats.avg_guesses,
        solved_in_3_or_less_rate=stats.solved_in_3_or_less_rate,
        avg_remaining_after_guess2=stats.avg_remaining_candidates_after_guess_2,
        hard_word_success_rate=stats.hard_word_success_rate,
        histogram=list(stats.histogram),
    )


def champion_model(champion) -> ChampionJSON:
    return ChampionJSON(
        chromosome=chromosome_model(champion.chromosome),
        fitness=champion.fitness,
        stats=stats_model(champion.stats),
        nickname=champion.nickname,
    )


def population_member_model(member) -> PopulationMemberJSON:
    return PopulationMemberJSON(
        id=member.id,
        fitness=member.fitness,
        win_rate=member.win_rate,
        avg_guesses=member.avg_guesses,
        mutation_rate=member.mutation_rate,
        generation_born=member.generation_born,
        distance_from_champion=member.distance_from_champion,
        nickname=member.nickname,
    )


def generation_report_model(report) -> GenerationReportJSON:
    return GenerationReportJSON(
        generation=report.generation,
        evaluations=report.evaluations,
        best_fitness=report.best_fitness,
        avg_fitness=report.avg_fitness,
        median_fitness=report.median_fitness,
        win_rate=report.win_rate,
        avg_guesses=report.avg_guesses,
        diversity_score=report.diversity_score,
        champion=champion_model(report.champion),
        population=[population_member_model(m) for m in report.population],
        elapsed_ms=report.elapsed_ms,
    )


def guess_decision_model(decision) -> GuessDecisionJSON:
    return GuessDecisionJSON(
        guess=decision.guess,
        score=decision.score,
        features=to_camel_weights(decision.features),
        weighted_breakdown=to_camel_weights(decision.weighted_breakdown),
        top_candidates=[
            TopCandidateJSON(word=sg.word, score=sg.score) for sg in decision.top_candidates
        ],
    )


def baseline_summary_model(summary) -> BaselineSummaryJSON:
    return BaselineSummaryJSON(
        key=summary.key,
        name=summary.name,
        win_rate=summary.win_rate,
        avg_guesses=summary.avg_guesses,
        failures=summary.failures,
        games=summary.games,
        histogram=list(summary.histogram),
        fitness=summary.fitness,
    )


def evolution_config_model(config) -> EvolutionConfigJSON:
    return EvolutionConfigJSON(
        population_size=config.population_size,
        generations=config.generations,
        elite_count=config.elite_count,
        tournament_size=config.tournament_size,
        mutation_rate=config.mutation_rate,
        large_mutation_chance=config.large_mutation_chance,
        training_sample_size=config.training_sample_size,
        validation_sample_size=config.validation_sample_size,
        seed=config.seed,
        use_entropy=config.use_entropy,
        max_turns=config.max_turns,
    )


def fitness_config_model(fc) -> FitnessConfigJSON:
    return FitnessConfigJSON(
        win_rate_weight=fc.win_rate_weight,
        avg_guesses_weight=fc.avg_guesses_weight,
        failure_rate_weight=fc.failure_rate_weight,
        solved_in_3_weight=fc.solved_in_3_weight,
        avg_remaining_after_guess2_weight=fc.avg_remaining_after_guess2_weight,
        hard_word_success_weight=fc.hard_word_success_weight,
    )


# --------------------------------------------------------------------------- #
# Replay building (with per-turn explainability)
# --------------------------------------------------------------------------- #
def build_replay_match(
    weights: dict[str, float],
    answer: str,
    answers,
    valid_guesses,
    player_config,
    *,
    label: str = "",
    bot_kind: str = "champion",
    include_decision: bool = True,
    mutation_rate: float = 0.0,
) -> ReplayMatchJSON:
    """Replay a heuristic champion on one answer, capturing per-turn detail."""
    from ..features.feature_extractor import choose_guess
    from ..ga.chromosome import Chromosome
    from ..wordle.types import GuessRecord

    chrom = Chromosome(
        id="replay",
        weights=to_snake_weights(weights),
        mutation_rate=mutation_rate,
        generation_born=0,
        species=None,
    )

    possible = list(answers)
    history: list[GuessRecord] = []
    turns: list[ReplayTurnJSON] = []
    solved = False
    guess_count = player_config.max_turns

    for turn in range(1, player_config.max_turns + 1):
        candidates_before = len(possible)
        decision = choose_guess(chrom, valid_guesses, possible, history, turn, player_config)
        guess = decision.guess
        feedback = score_guess_cached(guess, answer)
        history.append(GuessRecord(guess=guess, feedback=feedback))
        possible = filter_candidates(possible, guess, feedback)
        turns.append(
            ReplayTurnJSON(
                guess=guess,
                feedback=list(feedback),
                pattern=encode_pattern(feedback),
                candidates_before=candidates_before,
                candidates_after=len(possible),
                decision=guess_decision_model(decision) if include_decision else None,
            )
        )
        if guess == answer:
            solved = True
            guess_count = turn
            break

    return ReplayMatchJSON(
        label=label or answer,
        bot_kind=bot_kind,
        answer=answer,
        solved=solved,
        guess_count=guess_count,
        turns=turns,
    )
