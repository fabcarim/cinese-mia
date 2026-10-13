"""Controlla i file di contenuto (JSONL) contro il lessico HSK 2.0 livelli 1-3.

Ogni campo cinese ("zh", e "zh" dentro "lines"/"answers"/"opts" ecc.) deve usare solo
caratteri presenti nelle parole HSK 1-3, più pochi nomi propri ammessi.

Uso:  python -I -X utf8 tools/check_content.py data/content/*.jsonl
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORDS = json.loads((ROOT / "data" / "words.json").read_text(encoding="utf-8"))
ALLOWED = set("".join(w["hz"] for w in WORDS))
# Nomi propri tipici dei test HSK.
ALLOWED |= set("王李明丽红华")
HAN = re.compile(r"[一-鿿]")


def chinese_strings(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("zh", "q", "a", "opts", "answers", "model", "stmt") or k.startswith("zh"):
                yield from chinese_strings(v)
            elif isinstance(v, (dict, list)):
                yield from chinese_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from chinese_strings(v)
    elif isinstance(obj, str):
        yield obj


def main(paths):
    by_id = {w["id"]: w for w in WORDS}
    bad = 0
    total = 0
    for p in paths:
        for n, line in enumerate(Path(p).read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            total += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"{p}:{n} JSON non valido: {e}")
                bad += 1
                continue
            problems = []
            for s in chinese_strings(obj):
                extra = sorted({c for c in s if HAN.match(c) and c not in ALLOWED})
                if extra:
                    problems.append(f"fuori lessico {''.join(extra)} in «{s}»")
            wid = obj.get("w")
            if wid:
                w = by_id.get(wid)
                if not w:
                    problems.append(f"id parola sconosciuto {wid}")
                else:
                    tokens = obj.get("zh", "").split()
                    target = w["hz"]
                    if target not in tokens and not any(target in t for t in tokens):
                        problems.append(f"manca la parola {target}")
                    elif len(target) == 1 and target not in tokens:
                        problems.append(f"{target} deve essere un token separato")
            for f in ("py", "en"):
                if "zh" in obj and not obj.get(f):
                    problems.append(f"campo {f} mancante")
            if problems:
                bad += 1
                print(f"{p}:{n} [{obj.get('w') or obj.get('id')}] " + " | ".join(problems))
    print(f"\n{total} righe, {bad} con problemi")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
