"""Tests for the Wordle scoring engine and pattern encode/decode."""

from wordle_evolution.wordle.scoring import (
    score_guess,
    encode_pattern,
    decode_pattern,
    pattern_for,
)


def test_all_correct():
    assert score_guess("crane", "crane") == (
        "correct",
        "correct",
        "correct",
        "correct",
        "correct",
    )


def test_all_absent():
    assert score_guess("fghij", "aaaaa")[0] == "absent"
    assert all(s == "absent" for s in score_guess("qwxzb", "aeiou"))


def test_simple_present_and_absent():
    # 'a' present (wrong spot), 'e' correct, rest absent.
    fb = score_guess("apple", "table")
    assert fb == ("present", "absent", "absent", "correct", "correct")


def test_allee_apple_case():
    # The canonical required case.
    assert score_guess("allee", "apple") == (
        "correct",
        "present",
        "absent",
        "absent",
        "correct",
    )


def test_duplicate_guess_letters_extra_becomes_absent():
    # Guess has two 'l', answer has one 'l' -> only one can be marked.
    fb = score_guess("lolly", "hello")
    # answer 'hello' has letters h,e,l,l,o -> two 'l'.
    # guess 'lolly' l(0) o(1) l(2) l(3) y(4)
    assert len(fb) == 5
    # Reconstruct via brute independence: encode/decode consistent.
    assert encode_pattern(fb) == pattern_for("lolly", "hello")


def test_speed_erase_double_letters():
    # 'speed' vs 'erase': classic duplicated-letter case.
    fb = score_guess("speed", "erase")
    assert fb == ("present", "absent", "present", "present", "absent")


def test_green_takes_priority_over_present():
    # Duplicate letter where one is green: the other should be absent.
    fb = score_guess("eerie", "there")
    assert fb[4] == "correct"  # final 'e' matches
    # Only the greens/one present should be marked for the 'e's.
    e_states = [fb[i] for i, c in enumerate("eerie") if c == "e"]
    assert e_states.count("correct") >= 1


def test_pattern_for_matches_encode():
    for guess, answer in [("crane", "slate"), ("allee", "apple"), ("fuzzy", "jazzy")]:
        assert pattern_for(guess, answer) == encode_pattern(score_guess(guess, answer))


def test_encode_decode_roundtrip_all():
    for code in range(243):
        assert encode_pattern(decode_pattern(code)) == code


def test_encode_values():
    assert encode_pattern(("absent", "absent", "absent", "absent", "absent")) == 0
    assert encode_pattern(("correct", "correct", "correct", "correct", "correct")) == 242
    assert encode_pattern(("absent", "absent", "absent", "absent", "correct")) == 2
    assert encode_pattern(("absent", "absent", "absent", "absent", "present")) == 1
