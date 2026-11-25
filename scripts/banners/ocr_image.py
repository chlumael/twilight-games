#!/usr/bin/env python3
"""그림 속 글자를 읽어 JSON으로 출력한다 (명일방주 공지 배너용).

    python3 scripts/banners/ocr_image.py <그림 파일>
    → [{"text": "스테인리스", "score": 1.0, "x": 599, "y": 545, "h": 87}, ...]

필요: pip install rapidocr onnxruntime (한국어 인식 모델은 처음 실행할 때 내려받는다)
"""
import json
import sys

from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

engine = RapidOCR(params={
    "Rec.lang_type": LangRec.KOREAN,
    "Rec.ocr_version": OCRVersion.PPOCRV5,
    "Rec.model_type": ModelType.MOBILE,
    "Global.log_level": "error",
})
result = engine(sys.argv[1])
out = []
if result.txts:
    for text, score, box in zip(result.txts, result.scores, result.boxes):
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        out.append({"text": text, "score": round(float(score), 3), "x": round(min(xs)), "y": round(min(ys)), "h": round(max(ys) - min(ys))})
json.dump(out, sys.stdout, ensure_ascii=False)
