"""Costruisce data/words.json dalle liste ufficiali HSK 2.0 (revisione 2012).

Fonte: hskhsk.com "HSK Official With Definitions 2012 L1-L3", verificata contro il PDF
hanzistroke HSK 2.0 Level 3 (stesse 300 voci).

Uso:  python -I -X utf8 tools/build_words.py
"""
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Lettura e significato corretti per voce (livello, hanzi) quando la lista fonde più letture.
OVERRIDE = {
    (1, "喂"): ("wei4", "hello (on the phone); hey"),
    (2, "长"): ("chang2", "long; length"),
    (3, "长"): ("zhang3", "to grow; chief; head"),
    (3, "地"): ("de5", "-ly (particle linking adverb and verb)"),
    (3, "发"): ("fa1", "to send (e.g. an email); to issue"),
    (3, "分"): ("fen1", "minute; point (score); cent; to divide"),
    (3, "教"): ("jiao1", "to teach"),
    (3, "角"): ("jiao3", "horn; corner; jiao (0.1 yuan)"),
    (3, "只"): ("zhi3", "only; just"),
    (3, "还"): ("huan2", "to return (something); to give back"),
    (3, "过"): ("guo5", "(particle: past experience)"),
    (3, "带"): ("dai4", "to take along; to bring; belt"),
}

# Solo il significato, quando il primo senso del dizionario non è quello dell'HSK.
DEF_FIX = {
    (2, "黑"): "black; dark",
    (2, "新"): "new",
    (2, "红"): "red",
    (2, "从"): "from",
    (2, "让"): "to let; to make (sb do sth); to ask",
    (3, "才"): "only then; (not until); just",
    (3, "只有"): "only if (只有…才)",
    (3, "包"): "bag; package; to wrap",
    (3, "种"): "kind; type; sort",
    (3, "极"): "extremely (…极了)",
    (3, "差"): "poor; bad; to lack; short of (time)",
    (3, "元"): "yuan (Chinese currency)",
    (3, "又"): "again; both… and… (又…又…)",
}

VOWELS = "aeiouü"
MARKS = {
    "a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ",
}


def syllable_mark(syl, tone):
    """'hao', 3 -> 'hǎo'."""
    syl = syl.replace("u:", "ü").replace("v", "ü")
    if tone in (0, 5) or not any(c in VOWELS for c in syl.lower()):
        return syl  # tono neutro, o "r" di erhua
    low = syl.lower()
    if "a" in low:
        idx = low.index("a")
    elif "e" in low:
        idx = low.index("e")
    elif "ou" in low:
        idx = low.index("o")
    else:
        idx = max(i for i, c in enumerate(low) if c in VOWELS)
    ch = low[idx]
    marked = MARKS[ch][tone - 1]
    if syl[idx].isupper():
        marked = marked.upper()
    return syl[:idx] + marked + syl[idx + 1:]


def parse_numeric(num):
    """'Bei3jing1' -> [('bei',3),('jing',1)]  (minuscolo)."""
    out = []
    for syl, tone in re.findall(r"([a-zü:]+?)([1-5])", num.lower().replace("'", "").replace(" ", "")):
        out.append((syl, int(tone)))
    return out


def render(sylls):
    out = ""
    for i, (s, t) in enumerate(sylls):
        if i and s[0] in "aeo":
            out += "'"  # nǚ'ér
        out += syllable_mark(s, t)
    return out


def tone_distractors(sylls, rng, n=3):
    """Varianti con toni sbagliati: stesse sillabe, toni diversi (allena i toni)."""
    target = render(sylls)
    cands = set()
    for i, (s, t) in enumerate(sylls):
        for nt in (1, 2, 3, 4):
            if nt != t:
                v = list(sylls)
                v[i] = (s, nt)
                cands.add(render(v))
    if len(sylls) > 1:
        for _ in range(30):
            v = [(s, rng.choice([1, 2, 3, 4])) for s, _ in sylls]
            cands.add(render(v))
    cands.discard(target)
    cands = sorted(cands)
    rng.shuffle(cands)
    return cands[:n]


def clean_def(d):
    parts = [p.strip() for p in re.split(r";|\|", d) if p.strip()]
    parts = [re.sub(r"\s*\(Kangxi radical \d+\)", "", p) for p in parts]
    out, total = [], 0
    for p in parts:
        if total + len(p) > 55 and out:
            break
        out.append(p)
        total += len(p) + 2
        if len(out) == 3:
            break
    return "; ".join(out)


def main():
    rng = random.Random(7)
    words = []
    for level in (1, 2, 3):
        src = ROOT / "tools" / f"hsk2012_L{level}.txt"
        for i, line in enumerate(src.read_text(encoding="utf-8").splitlines()):
            line = line.lstrip("﻿")
            if not line.strip():
                continue
            hz, _trad, num, _py, definition = line.split("\t")[:5]
            num = num.split(",")[0].strip()
            if (level, hz) in OVERRIDE:
                num, definition = OVERRIDE[(level, hz)]
            definition = DEF_FIX.get((level, hz), definition)
            sylls = parse_numeric(num)
            if not sylls:
                raise SystemExit(f"pinyin non leggibile: {hz} {num}")
            py = render(sylls)
            if num[0].isupper():
                py = py[0].upper() + py[1:]  # nomi propri: Běijīng
            words.append({
                "id": f"L{level}-{i + 1:03d}",
                "lv": level,
                "hz": hz,
                "py": py,
                "tones": [t for _, t in sylls],
                "def": clean_def(definition),
                "pyAlt": tone_distractors(sylls, rng),
            })
    counts = {lv: sum(1 for w in words if w["lv"] == lv) for lv in (1, 2, 3)}
    out = ROOT / "data" / "words.json"
    out.write_text(json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")
    print("scritte", counts, "->", out)


if __name__ == "__main__":
    main()
