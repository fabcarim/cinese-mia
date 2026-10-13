"""Genera l'audio (voci neurali Microsoft via edge-tts) per parole, frasi, dialoghi e HSKK.

Salta i file già esistenti: si può rilanciare dopo aver aggiunto contenuti.
Scrive anche data/audio_index.json con l'elenco dei file, usato dal service worker.

Uso:  python -X utf8 tools/gen_audio.py [w s d k]   (default: tutto)
"""
import asyncio
import json
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"
VOICE = {
    "F": "zh-CN-XiaoxiaoNeural",
    "M": "zh-CN-YunxiNeural",
    "N": "zh-CN-YunyangNeural",  # narratore: domande dei dialoghi
}

# Caratteri singoli che la sintesi leggerebbe con la lettura sbagliata:
# si legge un omofono con la stessa sillaba e lo stesso tono.
HOMOPHONE = {
    "L2-009": ("长", "常"),  # 长 cháng
    "L3-278": ("长", "掌"),  # 长 zhǎng
    "L3-101": ("还", "环"),  # 还 huán
    "L3-118": ("教", "交"),  # 教 jiāo
    "L3-119": ("角", "脚"),  # 角 jiǎo
    "L3-229": ("为", "位"),  # 为 wèi
    "L3-283": ("只", "纸"),  # 只 zhǐ
    "L3-289": ("种", "肿"),  # 种 zhǒng
}
# Particelle a tono neutro: isolate non hanno una pronuncia sensata.
NO_AUDIO_HZ = {"地", "得", "着", "过"}


def plain(zh):
    return zh.replace(" ", "")


def load_jsonl(name):
    p = ROOT / "data" / "content" / name
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def jobs():
    words = json.loads((ROOT / "data" / "words.json").read_text(encoding="utf-8"))
    by_id = {w["id"]: w for w in words}
    for wid, (hz, _) in HOMOPHONE.items():
        assert by_id[wid]["hz"] == hz, f"HOMOPHONE: {wid} non è {hz}"
    for w in words:
        if w["hz"] in NO_AUDIO_HZ and w["lv"] >= 2 and w["py"] in ("de", "zhe", "guo"):
            continue
        yield f"w/{w['id']}.mp3", HOMOPHONE.get(w["id"], (None, w["hz"]))[1], "F", "-10%"
    i = 0
    for name in ("sent_A.jsonl", "sent_B.jsonl", "sent_C.jsonl", "sent_D.jsonl"):
        for s in load_jsonl(name):
            i += 1
            yield f"s/{s['w']}.mp3", plain(s["zh"]), "F" if i % 2 else "M", "+0%"
    for d in load_jsonl("listen.jsonl"):
        for n, line in enumerate(d["lines"]):
            yield f"d/{d['id']}-{n}.mp3", plain(line["zh"]), line["s"], "+0%"
        if d.get("q"):
            yield f"d/{d['id']}-q.mp3", plain(d["q"]), "N", "+0%"
    for k in load_jsonl("hskk.jsonl"):
        yield f"k/{k['id']}.mp3", plain(k["zh"]), "N" if k["part"] == 2 else "F", "+0%"
        for n, a in enumerate(k.get("answers", [])):
            yield f"k/{k['id']}-a{n}.mp3", plain(a["zh"]), "F", "+0%"
        if k.get("model"):
            yield f"k/{k['id']}-m.mp3", plain(k["model"]["zh"]), "F", "-5%"


async def synth(sem, done, path, text, voice, rate):
    out = AUDIO / path
    key = f"{voice}|{rate}|{text}"
    if out.exists() and out.stat().st_size > 0 and done.get(path) == key:
        return "skip"
    out.parent.mkdir(parents=True, exist_ok=True)
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICE[voice], rate=rate).save(str(out))
                done[path] = key
                return "ok"
            except Exception as e:  # rete instabile: riprova
                if attempt == 3:
                    print("ERRORE", path, text, e)
                    return "err"
                await asyncio.sleep(2 * (attempt + 1))


async def main(only=None):
    sem = asyncio.Semaphore(8)
    texts = AUDIO / "_texts.json"  # testo usato per ogni file: rigenera se cambia
    done = json.loads(texts.read_text(encoding="utf-8")) if texts.exists() else {}
    todo = [j for j in jobs() if not only or j[0].split("/")[0] in only]
    try:
        res = await asyncio.gather(*(synth(sem, done, *j) for j in todo))
    finally:
        texts.write_text(json.dumps(done, ensure_ascii=False, indent=0), encoding="utf-8")
    print({r: res.count(r) for r in set(res)})


if __name__ == "__main__":
    import sys
    asyncio.run(main(set(sys.argv[1:]) or None))  # es.: gen_audio.py w s
