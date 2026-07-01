"""Tests for candidate filtering."""

from wordle_evolution.wordle.candidate_filter import filter_candidates
from wordle_evolution.wordle.scoring import score_guess
from wordle_evolution.wordle.words import ANSWERS


def test_filter_keeps_exactly_matching_feedback():
    guess = "crane"
    answer = "slate"
    feedback = score_guess(guess, answer)
    candidates = list(ANSWERS[:500])
    if answer not in candidates:
        candidates.append(answer)

    survivors = filter_candidates(candidates, guess, feedback)

    # The true answer must survive.
    assert answer in survivors
    # Every survivor reproduces the exact feedback, and nothing else does.
    expected = [w for w in candidates if score_guess(guess, w) == feedback]
    assert survivors == expected
    for w in survivors:
        assert score_guess(guess, w) == feedback


def test_filter_all_correct_leaves_only_answer():
    guess = "table"
    feedback = score_guess(guess, guess)
    survivors = filter_candidates(["table", "cable", "fable"], guess, feedback)
    assert survivors == ["table"]


def test_filter_empty_when_no_match():
    # Feedback that no candidate can satisfy (all-correct for a word not present).
    feedback = score_guess("zzzzz", "zzzzz")
    survivors = filter_candidates(["apple", "crane"], "zzzzz", feedback)
    assert survivors == []


def test_filter_accepts_list_or_tuple_feedback():
    guess = "crane"
    answer = "trace"
    fb = score_guess(guess, answer)
    assert filter_candidates([answer], guess, list(fb)) == [answer]
    assert filter_candidates([answer], guess, tuple(fb)) == [answer]
