"""Unisce i contenuti (data/content/*.jsonl) in data/content.json e indicizza i file
multimediali (audio + tratti) in data/media_index.json con un hash breve, che l'app usa
per scaricarli una volta e aggiornarli solo quando cambiano.

Uso:  python -X utf8 tools/build_content.py
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "data" / "content"


def jsonl(name):
    p = CONTENT / name
    if not p.exists():
        print("manca", name)
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def main():
    sent = {}
    for name in ("sent_A.jsonl", "sent_B.jsonl", "sent_C.jsonl", "sent_D.jsonl"):
        for s in jsonl(name):
            sent[s["w"]] = {"zh": s["zh"], "py": s["py"], "en": s["en"]}
    content = {"sent": sent, "listen": jsonl("listen.jsonl"), "hskk": jsonl("hskk.jsonl")}
    (ROOT / "data" / "content.json").write_text(
        json.dumps(content, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    index = {}
    for folder in ("audio", "strokes"):
        for p in sorted((ROOT / folder).rglob("*")):
            if p.suffix in (".mp3", ".json") and not p.name.startswith("_"):
                index[p.relative_to(ROOT).as_posix()] = hashlib.md5(p.read_bytes()).hexdigest()[:8]
    (ROOT / "data" / "media_index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"frasi {len(sent)}, ascolto {len(content['listen'])}, hskk {len(content['hskk'])}, "
          f"file multimediali {len(index)}")


if __name__ == "__main__":
    main()
